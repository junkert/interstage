// Mission state: the pure item state machine (`applyEvent`) and the file I/O under $INTERSTAGE_STATE_DIR.
// Everything that touches the disk is below the "File I/O" marker.

import { appendFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { decideGate, hasApproval } from "./gates";
import { recordOutcome } from "./breaker";
import { isClean } from "./severity";
import { loadConfig } from "./config";
import {
  ENV_STATE_DIR,
  type Approval,
  type ArtifactKind,
  type InterstageConfig,
  type ItemEvent,
  type ItemHistoryEntry,
  type ItemRecord,
  type ItemState,
  type MissionRecord,
  type ReviewFinding,
  type UsageRecord,
} from "./contracts";
import { parseUsageJsonl } from "./budget";

/** Failures at which an item leaves the retry loop. */
export const MAX_FAILURES = 3;
/** Planner revisions allowed before a third failure blocks the item. */
export const MAX_PLANNER_ROUNDS = 2;
/** Conflict rebuilds allowed; the third conflict blocks the item. */
export const MAX_CONFLICTS = 3;

export interface ApplyContext {
  mission: MissionRecord;
  /** Every item of the mission. */
  items: ItemRecord[];
  config: Pick<InterstageConfig, "ship" | "parallel" | "breaker">;
  approvals: Approval[];
  budget: { missionExceeded: boolean };
  /** Extension clock; history timestamps never come from a model. */
  now: () => string;
}

export interface ApplyInput {
  itemId: string;
  event: ItemEvent;
  findings?: ReviewFinding[];
  commit?: string;
  note?: string;
}

export interface ApplyResult {
  ok: boolean;
  mission: MissionRecord;
  /** Every item of the mission after the event (unchanged on failure). */
  items: ItemRecord[];
  text: string;
  next: string | undefined;
}

const SLOT_STATES: Record<ItemState, boolean> = {
  pending: false,
  building: true,
  verifying: true,
  integrating: true,
  failed: false,
  planning: false,
  done: false,
  blocked: false,
};

const EVENT_FROM: Record<ItemEvent, ItemState> = {
  start: "pending",
  builder_done: "building",
  builder_failed: "building",
  verify_clean: "verifying",
  verify_failed: "verifying",
  retry: "failed",
  planner_revised: "planning",
  planner_blocked: "planning",
  integrate_ok: "integrating",
  integrate_conflict: "integrating",
};

function fail(ctx: ApplyContext, text: string, next?: string): ApplyResult {
  return { ok: false, mission: ctx.mission, items: ctx.items, text, next };
}

/** Guards shared by every move into `building` from outside the running slots (`start`, `retry`). */
function enterBuildingGuard(ctx: ApplyContext, item: ItemRecord): { text: string; next: string | undefined } | undefined {
  if (ctx.mission.status !== "running") {
    return { text: `Mission ${ctx.mission.id} is ${ctx.mission.status}; ${item.id} cannot start building.`, next: ctx.mission.status === "complete" || ctx.mission.status === "aborted" ? undefined : "ask CAPCOM to resume the mission" };
  }
  const running = ctx.items.filter(other => SLOT_STATES[other.state]).length;
  if (running >= ctx.config.parallel.worktrees) {
    return { text: `All ${ctx.config.parallel.worktrees} parallel slots are busy; ${item.id} must wait.`, next: "wait for a running item to finish" };
  }
  if (ctx.budget.missionExceeded) {
    return { text: `The mission token budget is exceeded; ${item.id} cannot start building.`, next: "report budget_exceeded to CAPCOM" };
  }
  return undefined;
}

function entry(ctx: ApplyContext, event: ItemHistoryEntry["event"], from: ItemState, to: ItemState, note: string | undefined): ItemHistoryEntry {
  return note === undefined ? { at: ctx.now(), event, from, to } : { at: ctx.now(), event, from, to, note };
}

/**
 * Apply one event from the CONTRACTS section 3 table. Pure: the caller loads state, passes it in and persists
 * `mission` and `items` from the result.
 */
export function applyEvent(ctx: ApplyContext, input: ApplyInput): ApplyResult {
  const index = ctx.items.findIndex(candidate => candidate.id === input.itemId);
  const found = ctx.items[index];
  if (found === undefined) return fail(ctx, `Item ${input.itemId} does not exist.`);
  const expected = EVENT_FROM[input.event];
  if (found.state !== expected) {
    return fail(ctx, `${input.itemId} is ${found.state}; ${input.event} needs ${expected}.`);
  }

  let mission = ctx.mission;
  const item: ItemRecord = { ...found, history: [...found.history], findings: [...found.findings] };
  const move = (event: ItemHistoryEntry["event"], to: ItemState, note: string | undefined = input.note): void => {
    item.history.push(entry(ctx, event, item.state, to, note));
    item.state = to;
  };
  /** A failed attempt: counts the failure, feeds the breaker, then escalates or blocks at the third. */
  const recordFailure = (event: ItemEvent): string => {
    move(event, "failed");
    item.failures += 1;
    const outcome = recordOutcome(mission.breaker, "failure", ctx.config.breaker.consecutiveFailures);
    mission = { ...mission, breaker: outcome.state };
    let text = `${item.id} failed (failure ${item.failures} of ${MAX_FAILURES}).`;
    if (item.failures >= MAX_FAILURES) {
      if (item.plannerRounds < MAX_PLANNER_ROUNDS) {
        move("auto_escalate", "planning", `failed ${MAX_FAILURES} times; planner round ${item.plannerRounds + 1} of ${MAX_PLANNER_ROUNDS}`);
        text += ` Escalated to planning (round ${item.plannerRounds + 1} of ${MAX_PLANNER_ROUNDS}).`;
      } else {
        move("auto_block", "blocked", `failed ${MAX_FAILURES} times after ${item.plannerRounds} planner rounds`);
        text += ` Blocked after ${item.plannerRounds} planner rounds.`;
      }
    }
    if (outcome.tripped && mission.status === "running") {
      const reason = `circuit breaker: ${outcome.state.consecutiveFailures} consecutive failures`;
      mission = { ...mission, status: "halted", statusReason: reason };
      text += ` The circuit breaker tripped (${outcome.state.consecutiveFailures} consecutive failures): the mission is halted until CAPCOM resumes it.`;
    }
    return text;
  };

  let text: string;
  let next: string | undefined;

  switch (input.event) {
    case "start": {
      const unmet = item.depends.filter(id => ctx.items.find(other => other.id === id)?.state !== "done");
      if (unmet.length > 0) return fail(ctx, `${item.id} waits for ${unmet.join(", ")}.`, "start a dependency first");
      const blocked = enterBuildingGuard(ctx, item);
      if (blocked) return fail(ctx, blocked.text, blocked.next);
      if (decideGate("A", { autonomy: mission.autonomy, ship: ctx.config.ship }) === "approve" && !hasApproval(ctx.approvals, "A", "plan")) {
        return fail(ctx, `Gate A needs an approved plan before ${item.id} can start.`, "request approval A with ref plan");
      }
      move("start", "building");
      text = `${item.id} is building.`;
      next = `spawn a builder for ${item.id} in an isolated task named ${item.id}`;
      break;
    }
    case "builder_done":
      move("builder_done", "verifying");
      text = `${item.id} is verifying.`;
      next = `spawn verification for ${item.id}`;
      break;
    case "builder_failed": {
      text = recordFailure("builder_failed");
      next = nextAfterFailure(item, mission);
      break;
    }
    case "verify_clean": {
      const findings = input.findings ?? [];
      if (!isClean(findings)) return fail(ctx, `${item.id} has blocker or major findings; report verify_failed instead.`);
      item.findings = [];
      move("verify_clean", "integrating");
      text = `${item.id} passed verification and is waiting for integration.`;
      next = `integrate ${item.id}: git merge --squash omp/task/${item.id}, then commit`;
      break;
    }
    case "verify_failed": {
      const findings = input.findings ?? [];
      if (isClean(findings)) return fail(ctx, `verify_failed needs at least one blocker or major finding for ${item.id}.`);
      item.findings = findings;
      text = recordFailure("verify_failed");
      next = nextAfterFailure(item, mission);
      break;
    }
    case "retry": {
      if (item.failures >= MAX_FAILURES) return fail(ctx, `${item.id} has failed ${MAX_FAILURES} times and cannot be retried.`);
      const blocked = enterBuildingGuard(ctx, item);
      if (blocked) return fail(ctx, blocked.text, blocked.next);
      move("retry", "building");
      text = `${item.id} is building again (failures: ${item.failures}).`;
      next = `spawn a builder for ${item.id} with the previous findings`;
      break;
    }
    case "planner_revised":
      item.failures = 0;
      item.plannerRounds += 1;
      move("planner_revised", "pending");
      text = `${item.id} was revised (planner round ${item.plannerRounds} of ${MAX_PLANNER_ROUNDS}) and is pending.`;
      next = `start ${item.id}`;
      break;
    case "planner_blocked":
      move("planner_blocked", "blocked");
      text = `${item.id} is blocked: the planner needs user input.`;
      next = "report the open question to CAPCOM";
      break;
    case "integrate_ok": {
      const commit = input.commit?.trim();
      if (commit === undefined || commit === "") return fail(ctx, `integrate_ok needs the commit sha for ${item.id}.`);
      const gates = { autonomy: mission.autonomy, ship: ctx.config.ship };
      if (decideGate("C", gates) === "approve" && !hasApproval(ctx.approvals, "C", `commit:${item.id}`)) {
        return fail(ctx, `Gate C needs approval before ${item.id} lands on the mission branch.`, `request approval C with ref commit:${item.id}`);
      }
      if (decideGate("E", gates) === "approve" && !hasApproval(ctx.approvals, "E", `merge:${item.id}`)) {
        return fail(ctx, `Gate E needs approval to merge the ${item.id} worktree.`, `request approval E with ref merge:${item.id}`);
      }
      item.commit = commit;
      move("integrate_ok", "done");
      mission = { ...mission, breaker: recordOutcome(mission.breaker, "verified", ctx.config.breaker.consecutiveFailures).state };
      text = `${item.id} is done at ${commit}.`;
      break;
    }
    case "integrate_conflict": {
      item.conflicts += 1;
      if (item.conflicts >= MAX_CONFLICTS) {
        move("auto_block", "blocked", `merge conflict ${item.conflicts} of ${MAX_CONFLICTS}`);
        text = `${item.id} hit its third merge conflict and is blocked.`;
        next = "report the conflict to CAPCOM";
      } else {
        move("integrate_conflict", "building");
        text = `${item.id} conflicted (${item.conflicts} of ${MAX_CONFLICTS - 1} rebuilds allowed) and is rebuilding on the updated mission branch.`;
        next = `rebuild ${item.id} on the updated mission branch`;
      }
      break;
    }
  }

  const items = ctx.items.map((candidate, position) => (position === index ? item : candidate));
  if (next === undefined) {
    const open = items.filter(candidate => candidate.state !== "done");
    next = open.length === 0 ? "every item is done: set_status complete" : "start the next ready item";
  }
  return { ok: true, mission, items, text, next };
}

function nextAfterFailure(item: ItemRecord, mission: MissionRecord): string {
  if (mission.status === "halted") return "stop spawning: ask CAPCOM to resume the halted mission";
  if (item.state === "planning") return `spawn pogo to revise ${item.id}`;
  if (item.state === "blocked") return `report ${item.id} as blocked to CAPCOM`;
  return `retry ${item.id}`;
}

// ---------------------------------------------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------------------------------------------

/** The state directory from the environment; throws a readable error when Interstage is not active. */
export function requireStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env[ENV_STATE_DIR];
  if (dir === undefined || dir === "") throw new Error(`${ENV_STATE_DIR} is not set: Interstage is not active in this session.`);
  return dir;
}

export function missionDirOf(stateDir: string, missionId: string): string {
  return join(stateDir, "missions", missionId);
}

/** Directory holding the user's OMP configuration (`PI_CODING_AGENT_DIR` when set, otherwise `~/.omp/agent`). */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_CODING_AGENT_DIR;
  return override !== undefined && override !== "" ? override : join(homedir(), ".omp", "agent");
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentDir(env), "interstage.yml");
}

export function loadEffectiveConfig(stateDir: string, env: NodeJS.ProcessEnv = process.env) {
  return loadConfig({ userPath: userConfigPath(env), projectPath: join(stateDir, "config.yml") });
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** Write through a temp file in the same directory, then rename: readers never see a partial file. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, content);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Serialize read-modify-write cycles on one mission across sessions in this process and other processes:
 * the lock is a directory created with `mkdir`, which is atomic. A lock older than `staleMs` is taken over.
 */
export async function withMissionLock<T>(missionDir: string, fn: () => Promise<T>, staleMs = 15_000): Promise<T> {
  const lock = join(missionDir, ".lock");
  const deadline = Date.now() + staleMs;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await Bun.sleep(5 + Math.random() * 15);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export function loadMission(missionDir: string): Promise<MissionRecord | undefined> {
  return readJson<MissionRecord>(join(missionDir, "mission.json"));
}

export function saveMission(missionDir: string, mission: MissionRecord): Promise<void> {
  return writeJson(join(missionDir, "mission.json"), mission);
}

export async function loadItems(missionDir: string): Promise<ItemRecord[]> {
  let names: string[];
  try {
    names = await readdir(join(missionDir, "items"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const items: ItemRecord[] = [];
  for (const name of names.filter(file => file.endsWith(".json")).sort()) {
    const record = await readJson<ItemRecord>(join(missionDir, "items", name));
    if (record !== undefined) items.push(record);
  }
  return items;
}

export function saveItem(missionDir: string, item: ItemRecord): Promise<void> {
  return writeJson(join(missionDir, "items", `${item.id}.json`), item);
}

export async function loadApprovals(missionDir: string): Promise<Approval[]> {
  return (await readJson<Approval[]>(join(missionDir, "approvals.json"))) ?? [];
}

export function saveApprovals(missionDir: string, approvals: Approval[]): Promise<void> {
  return writeJson(join(missionDir, "approvals.json"), approvals);
}

/** Append one record. `O_APPEND` writes of one short line are atomic, so concurrent children never interleave. */
export async function appendUsage(path: string, record: UsageRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`);
}

export async function loadUsage(path: string): Promise<UsageRecord[]> {
  try {
    return parseUsageJsonl(await readFile(path, "utf8")).records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Mission directory names `M-001`, `M-002`, ... in ascending order. */
export async function listMissionIds(stateDir: string): Promise<string[]> {
  try {
    return (await readdir(join(stateDir, "missions"))).filter(name => /^M-\d{3,}$/.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Claim the next mission id by creating its directory (`mkdir` is atomic, so concurrent creates never share an id). */
export async function allocateMission(stateDir: string): Promise<{ id: string; dir: string }> {
  await mkdir(join(stateDir, "missions"), { recursive: true });
  const ids = await listMissionIds(stateDir);
  let next = ids.length === 0 ? 1 : Number((ids[ids.length - 1] ?? "M-000").slice(2)) + 1;
  for (;;) {
    const id = `M-${String(next).padStart(3, "0")}`;
    const dir = missionDirOf(stateDir, id);
    try {
      await mkdir(dir);
      return { id, dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      next += 1;
    }
  }
}

/** The newest mission that is not complete or aborted, used to resume after a restart. */
export async function findActiveMission(stateDir: string): Promise<string | undefined> {
  const ids = await listMissionIds(stateDir);
  for (const id of ids.reverse()) {
    const mission = await loadMission(missionDirOf(stateDir, id));
    if (mission !== undefined && mission.status !== "complete" && mission.status !== "aborted") return id;
  }
  return undefined;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug === "" ? "mission" : slug;
}

/** Relative path inside `base` for an artifact name; throws on anything that could leave the directory. */
export function resolveInside(base: string, name: string): string {
  if (name.trim() === "" || name.includes("\0") || name.includes("\\") || isAbsolute(name)) {
    throw new Error(`Invalid artifact name "${name}": use a relative path without backslashes.`);
  }
  if (name.split("/").some(part => part === ".." || part === "")) {
    throw new Error(`Invalid artifact name "${name}": ".." and empty path segments are not allowed.`);
  }
  const root = resolve(base);
  const target = resolve(root, name);
  if (!target.startsWith(root + sep)) throw new Error(`Invalid artifact name "${name}": it resolves outside the mission directory.`);
  return target;
}

/** Where an artifact lands under the mission directory. `decisions`, `todo` and `spec` are single files. */
export function artifactPath(missionDir: string, kind: ArtifactKind, name: string): string {
  switch (kind) {
    case "decisions":
      return join(missionDir, "decisions.md");
    case "todo":
      return join(missionDir, "TODO.md");
    case "spec":
      return join(missionDir, "SPEC.md");
    case "evidence":
    case "research":
    case "specs":
      return resolveInside(join(missionDir, kind), name);
  }
}

/** Reject a target whose real path (symlinks resolved on the deepest existing ancestor) leaves the real mission directory. */
async function assertRealInside(missionDir: string, target: string): Promise<void> {
  const root = await realpath(missionDir);
  let ancestor = target;
  for (;;) {
    try {
      const real = await realpath(ancestor);
      if (real !== root && !real.startsWith(root + sep)) throw new Error(`Invalid artifact path: it resolves through a symlink outside the mission directory.`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // realpath fails on a dangling symlink too, and writing through it would create the target outside.
      if (await lstat(ancestor).then(() => true, () => false)) throw new Error("Invalid artifact path: it goes through a dangling symlink.");
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

export async function writeArtifact(missionDir: string, kind: ArtifactKind, name: string, content: string, append: boolean): Promise<string> {
  const path = artifactPath(missionDir, kind, name);
  await assertRealInside(missionDir, path);
  if (append || kind === "decisions") {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, content.endsWith("\n") ? content : `${content}\n`);
  } else {
    await writeFileAtomic(path, content);
  }
  return path;
}
