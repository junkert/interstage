// The `mission` tool: one extension-registered tool whose actions are listed in CONTRACTS section 5.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  ACTION_CALLERS,
  ENV_MISSION_ID,
  type Approval,
  type ArtifactKind,
  type GateId,
  type ItemEvent,
  type ItemRecord,
  type Lane,
  type MissionRecord,
  type MissionToolInput,
  type MissionToolResult,
  type SteeringPacket,
  type SteeringSignal,
} from "./contracts";
import { checkBudgets, sumCacheReads } from "./budget";
import { decideGate, hasApproval } from "./gates";
import { validateFindings } from "./severity";
import { applyPending, writePacket } from "./steering";
import { validateTodo, parseTodo } from "./todo";
import {
  allocateMission,
  applyEvent,
  isoNow,
  loadApprovals,
  loadEffectiveConfig,
  loadItems,
  loadMission,
  loadUsage,
  missionDirOf,
  requireStateDir,
  resolveInside,
  saveApprovals,
  saveItem,
  saveMission,
  slugify,
  withMissionLock,
  writeArtifact,
} from "./state";

export interface ExecOutput {
  stdout: string;
  stderr: string;
  code: number;
}

export type GitExec = (command: string, args: string[], options: { cwd: string }) => Promise<ExecOutput>;

export interface MissionDeps {
  /** `main` for the CAPCOM session, otherwise the subagent definition name. */
  caller: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  exec: GitExec;
  now?: () => string;
}

const GATES: Record<GateId, true> = { A: true, B: true, C: true, D: true, E: true, F: true, G: true };
const LANES: Record<Lane, true> = { fast: true, standard: true, full: true };
const SIGNALS: Record<SteeringSignal, true> = { interrupt: true, redirect: true, pause: true, resume: true, reprioritize: true, decision: true, error: true, complete: true };
const EVENTS: Record<ItemEvent, true> = {
  start: true,
  builder_done: true,
  builder_failed: true,
  verify_clean: true,
  verify_failed: true,
  retry: true,
  planner_revised: true,
  planner_blocked: true,
  integrate_ok: true,
  integrate_conflict: true,
  unblock: true,
};
const KINDS: Record<ArtifactKind, true> = { evidence: true, research: true, specs: true, decisions: true, todo: true, spec: true };
const SCOPES: Record<string, true> = { mission: true, items: true, item: true, approvals: true, budget: true };
const STATUSES: Record<string, true> = { paused: true, running: true, complete: true, halted: true };
const ACTIONS = Object.keys(ACTION_CALLERS) as MissionToolInput["action"][];

const ok = (text: string, data?: unknown, next?: string): MissionToolResult => {
  const result: MissionToolResult = { ok: true, text };
  if (data !== undefined) result.data = data;
  if (next !== undefined) result.next = next;
  return result;
};
const err = (text: string, next?: string): MissionToolResult => (next === undefined ? { ok: false, text } : { ok: false, text, next });

function isMember<K extends string>(table: Record<K, true>, value: unknown): value is K {
  return typeof value === "string" && Object.hasOwn(table, value);
}

function str(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Turn the flat tool parameters into a `MissionToolInput`, or say what is missing. */
export function parseMissionInput(raw: Record<string, unknown>): { input: MissionToolInput } | { error: string } {
  const candidate = raw.action;
  if (typeof candidate !== "string" || !Object.hasOwn(ACTION_CALLERS, candidate)) return { error: `Unknown action "${String(candidate)}"; use one of ${ACTIONS.join(", ")}.` };
  // Checked against the ACTION_CALLERS keys on the previous line.
  const action = candidate as MissionToolInput["action"];
  const missing = (field: string) => ({ error: `${action} needs ${field}.` });
  switch (action) {
    case "create": {
      const title = str(raw, "title");
      const brief = str(raw, "brief");
      if (title === undefined) return missing("title");
      if (!isMember(LANES, raw.lane)) return missing("lane (fast, standard or full)");
      if (brief === undefined) return missing("brief");
      return { input: { action, title, lane: raw.lane, brief } };
    }
    case "plan_set":
      return { input: str(raw, "todoPath") === undefined ? { action } : { action, todoPath: str(raw, "todoPath") } };
    case "get": {
      if (typeof raw.scope !== "string" || !Object.hasOwn(SCOPES, raw.scope)) return missing("scope (mission, items, item, approvals or budget)");
      const scope = raw.scope as "mission" | "items" | "item" | "approvals" | "budget";
      const itemId = str(raw, "itemId");
      if (scope === "item" && itemId === undefined) return missing("itemId for scope item");
      return { input: itemId === undefined ? { action, scope } : { action, scope, itemId } };
    }
    case "transition": {
      const itemId = str(raw, "itemId");
      if (itemId === undefined) return missing("itemId");
      if (!isMember(EVENTS, raw.event)) return missing(`event (${Object.keys(EVENTS).join(", ")})`);
      const input: Extract<MissionToolInput, { action: "transition" }> = { action, itemId, event: raw.event };
      if (raw.findings !== undefined) {
        const checked = validateFindings(raw.findings);
        if (checked.errors.length > 0) return { error: `Invalid findings: ${checked.errors.join("; ")}` };
        input.findings = checked.findings;
      }
      if (str(raw, "commit") !== undefined) input.commit = str(raw, "commit");
      if (str(raw, "note") !== undefined) input.note = str(raw, "note");
      return { input };
    }
    case "approval": {
      if (raw.op !== "request" && raw.op !== "resolve") return missing("op (request or resolve)");
      if (!isMember(GATES, raw.gate)) return missing("gate (A to G)");
      const ref = str(raw, "ref");
      if (ref === undefined) return missing("ref");
      const input: Extract<MissionToolInput, { action: "approval" }> = { action, op: raw.op, gate: raw.gate, ref };
      if (raw.op === "resolve") {
        if (raw.status !== "granted" && raw.status !== "denied") return missing("status (granted or denied) for resolve");
        input.status = raw.status;
      }
      if (str(raw, "note") !== undefined) input.note = str(raw, "note");
      return { input };
    }
    case "steer": {
      if (!isMember(SIGNALS, raw.signal)) return missing(`signal (${Object.keys(SIGNALS).join(", ")})`);
      const payload = raw.payload ?? {};
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { error: "steer payload must be an object." };
      const input: Extract<MissionToolInput, { action: "steer" }> = { action, signal: raw.signal, payload: payload as Record<string, unknown> };
      if (raw.instructions !== undefined) {
        const i = raw.instructions as Partial<NonNullable<SteeringPacket["instructions"]>> | null;
        const list = (value: unknown) => Array.isArray(value) && value.every(entry => typeof entry === "string");
        if (i === null || typeof i !== "object" || typeof i.primary !== "string" || !list(i.constraints) || !list(i.success_criteria) || !list(i.next_steps)) {
          return { error: "steer instructions need primary (string) and constraints, success_criteria and next_steps (string arrays)." };
        }
        input.instructions = { primary: i.primary, constraints: i.constraints ?? [], success_criteria: i.success_criteria ?? [], next_steps: i.next_steps ?? [] };
      }
      return { input };
    }
    case "write_artifact": {
      if (!isMember(KINDS, raw.kind)) return missing(`kind (${Object.keys(KINDS).join(", ")})`);
      if (typeof raw.content !== "string") return missing("content");
      const name = typeof raw.name === "string" ? raw.name : "";
      if ((raw.kind === "evidence" || raw.kind === "research" || raw.kind === "specs") && name.trim() === "") return missing(`name for kind ${raw.kind}`);
      return { input: { action, kind: raw.kind, name, content: raw.content, append: raw.append === true } };
    }
    case "set_status": {
      if (typeof raw.status !== "string" || !Object.hasOwn(STATUSES, raw.status)) return missing("status (paused, running, complete or halted)");
      const reason = str(raw, "reason");
      if (reason === undefined) return missing("reason");
      return { input: { action, status: raw.status as "paused" | "running" | "complete" | "halted", reason } };
    }
    case "apply_steering":
    case "reset_pogo_loop":
      return { input: { action } };
  }
}

interface Active {
  stateDir: string;
  dir: string;
  mission: MissionRecord;
}

async function activeMission(deps: MissionDeps): Promise<Active | MissionToolResult> {
  const id = deps.env[ENV_MISSION_ID];
  if (id === undefined || id === "") return err("There is no active mission; houston must create one first.");
  const stateDir = requireStateDir(deps.env);
  const dir = missionDirOf(stateDir, id);
  const mission = await loadMission(dir);
  if (mission === undefined) return err(`Mission ${id} has no mission.json under ${stateDir}.`);
  return { stateDir, dir, mission };
}

const isResult = (value: Active | MissionToolResult): value is MissionToolResult => "ok" in value;

/** Run one mission action. Permission checks happen here so tests and the tool share them. */
export async function executeMission(deps: MissionDeps, input: MissionToolInput): Promise<MissionToolResult> {
  const allowed = ACTION_CALLERS[input.action];
  if (!allowed.includes(deps.caller)) {
    return err(`${deps.caller} cannot use mission action ${input.action}; only ${allowed.join(", ")} can.`);
  }
  if (input.action === "approval") {
    const callers = input.op === "resolve" ? ["main"] : ["houston", "flight"];
    if (!callers.includes(deps.caller)) return err(`${deps.caller} cannot ${input.op} approvals; only ${callers.join(" and ")} can.`);
  }
  try {
    return await dispatch(deps, input);
  } catch (error) {
    return err(`mission ${input.action} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function dispatch(deps: MissionDeps, input: MissionToolInput): Promise<MissionToolResult> {
  if (input.action === "create") return createMission(deps, input);
  const active = await activeMission(deps);
  if (isResult(active)) return active;
  const now = deps.now ?? isoNow;
  switch (input.action) {
    case "plan_set":
      return planSet(deps, active, input.todoPath, now);
    case "get":
      return getState(deps, active, input.scope, input.itemId);
    case "transition":
      return transition(deps, active, input, now);
    case "approval":
      return approval(deps, active, input, now);
    case "steer": {
      const draft = { signal: input.signal, from: deps.caller, payload: input.payload };
      const packet = await writePacket(active.dir, input.instructions === undefined ? draft : { ...draft, instructions: input.instructions }, now);
      return ok(`Steering packet ${packet.seq} (${packet.signal}) was written.`, packet);
    }
    case "apply_steering": {
      const packets = await applyPending(active.dir, now);
      return ok(packets.length === 0 ? "No pending steering packets." : `${packets.length} steering packet(s) applied, interrupt and pause first.`, packets);
    }
    case "write_artifact": {
      const path = await writeArtifact(active.dir, input.kind, input.name, input.content, input.append === true);
      return ok(`Wrote ${relative(active.dir, path)} in mission ${active.mission.id}.`);
    }
    case "set_status":
      return setStatus(deps, active, input.status, input.reason);
    case "reset_pogo_loop":
      return withMissionLock(active.dir, async () => {
        const mission = (await loadMission(active.dir)) ?? active.mission;
        await saveMission(active.dir, { ...mission, pogoLoop: mission.pogoLoop + 1 });
        return ok(`Pogo loop is now ${mission.pogoLoop + 1} with a fresh token budget.`);
      });
  }
}

// -- create -----------------------------------------------------------------------------------------------------

async function createMission(deps: MissionDeps, input: Extract<MissionToolInput, { action: "create" }>): Promise<MissionToolResult> {
  const stateDir = requireStateDir(deps.env);
  const current = deps.env[ENV_MISSION_ID];
  if (current !== undefined && current !== "") {
    const existing = await loadMission(missionDirOf(stateDir, current));
    if (existing !== undefined && existing.status !== "complete" && existing.status !== "aborted") {
      return err(`Mission ${current} is still ${existing.status}; finish or abort it before creating another.`);
    }
  }
  const { config } = await loadEffectiveConfig(stateDir, deps.env);
  if (!config.lanes.enabled.includes(input.lane)) return err(`Lane ${input.lane} is not enabled; enabled lanes: ${config.lanes.enabled.join(", ")}.`);

  const cwd = deps.cwd;
  const git = (...args: string[]) => deps.exec("git", args, { cwd });
  const inside = await git("rev-parse", "--is-inside-work-tree");
  if (inside.code !== 0) return err("The working directory is not a git repository; Interstage missions need one.");
  const head = await git("symbolic-ref", "--quiet", "--short", "HEAD");
  if (head.code !== 0 || head.stdout.trim() === "") return err("HEAD is detached; switch to a branch before creating a mission.");
  const dirty = await git("status", "--porcelain", "--untracked-files=no");
  if (dirty.stdout.trim() !== "") return err("The working tree has uncommitted changes; commit or stash them before creating a mission.");
  const sha = await git("rev-parse", "HEAD");
  if (sha.code !== 0) return err("The repository has no commits yet; make an initial commit before creating a mission.");

  const { id, dir } = await allocateMission(stateDir);
  const branch = `mission/${id}-${slugify(input.title)}`;
  const created = await git("switch", "-c", branch);
  if (created.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    return err(`git switch -c ${branch} failed: ${created.stderr.trim().split("\n")[0] ?? "unknown error"}.`);
  }
  const mission: MissionRecord = {
    id,
    title: input.title,
    lane: input.lane,
    status: "running",
    statusReason: undefined,
    brief: input.brief,
    branch,
    baseBranch: head.stdout.trim(),
    baseSha: sha.stdout.trim(),
    autonomy: config.autonomy,
    createdAt: (deps.now ?? isoNow)(),
    breaker: { consecutiveFailures: 0 },
    pogoLoop: 0,
    nextSeq: 1,
  };
  await saveMission(dir, mission);
  await mkdir(join(dir, "items"), { recursive: true });
  deps.env[ENV_MISSION_ID] = id;
  return ok(`Mission ${id} created on branch ${branch} (base ${mission.baseBranch}).`, mission, "write the SPEC and TODO with write_artifact, then plan_set");
}

// -- plan_set ---------------------------------------------------------------------------------------------------

/** Item states whose definition `plan_set` may rewrite; counters, state and history are kept. */
const REFRESHABLE: Record<ItemRecord["state"], boolean> = {
  pending: true,
  failed: true,
  planning: true,
  blocked: true,
  building: false,
  verifying: false,
  integrating: false,
  done: false,
};

function resolveTodoPath(dir: string, todoPath: string | undefined): string {
  if (todoPath === undefined) return join(dir, "TODO.md");
  if (!isAbsolute(todoPath)) return resolveInside(dir, todoPath);
  const root = resolve(dir);
  const target = resolve(todoPath);
  if (!target.startsWith(root + sep)) throw new Error(`todoPath ${todoPath} is outside the mission directory.`);
  return target;
}

async function planSet(deps: MissionDeps, active: Active, todoPath: string | undefined, now: () => string): Promise<MissionToolResult> {
  const { dir, mission, stateDir } = active;
  if (mission.status === "complete" || mission.status === "aborted") return err(`Mission ${mission.id} is ${mission.status}; its plan cannot change.`);
  const path = resolveTodoPath(dir, todoPath);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return err(`Cannot read the TODO at ${path}; write it with write_artifact kind todo first.`);
  }
  const findings = validateTodo(text, relative(dir, path));
  if (findings.length > 0) {
    const shown = findings.slice(0, 6).map(f => f.message).join("; ");
    return err(`The TODO has ${findings.length} problem(s): ${shown}${findings.length > 6 ? "; ..." : ""}`);
  }
  const { config } = await loadEffectiveConfig(stateDir, deps.env);
  const revision = createHash("sha256").update(text).digest("hex").slice(0, 8);
  const ref = `todo:${revision}`;

  return withMissionLock(dir, async () => {
    if (decideGate("B", { autonomy: mission.autonomy, ship: config.ship }) === "approve") {
      const approvals = await loadApprovals(dir);
      if (!hasApproval(approvals, "B", ref)) {
        const denied = approvals.some(a => a.gate === "B" && a.ref === ref && a.status === "denied");
        if (denied) return err(`Gate B denied ${ref}; revise the TODO.`);
        if (!approvals.some(a => a.gate === "B" && a.ref === ref && a.status === "pending")) {
          await saveApprovals(dir, [...approvals, { gate: "B", ref, status: "pending", requestedBy: deps.caller, requestedAt: now() }]);
        }
        return err(`Gate B approval ${ref} is pending, so the plan is not applied yet.`, `wait for CAPCOM to grant B ${ref}, then call plan_set again`);
      }
    }
    const existing = new Map((await loadItems(dir)).map(item => [item.id, item]));
    const planned = parseTodo(text).items;
    const plannedIds = new Set(planned.map(parsed => parsed.id));
    const removed = [...existing.values()].filter(old => !plannedIds.has(old.id) && REFRESHABLE[old.state]);
    const kept = [...existing.values()].filter(old => !plannedIds.has(old.id) && !REFRESHABLE[old.state]);
    // Items that stay as they are must not be left depending on an item this plan deletes. (Planned items are
    // already covered: validateTodo rejects a dependency that is not in the TODO.)
    const removedIds = new Set(removed.map(old => old.id));
    const orphaned = [...kept, ...planned.map(parsed => existing.get(parsed.id)).filter((old): old is ItemRecord => old !== undefined && !REFRESHABLE[old.state])].filter(old => old.depends.some(dep => removedIds.has(dep)));
    if (orphaned.length > 0) {
      return err(`The plan would remove ${[...removedIds].join(", ")}, but ${orphaned.map(old => old.id).join(", ")} (already started or done) still depends on it; keep the item in the TODO.`);
    }
    let created = 0;
    let refreshed = 0;
    const skipped: string[] = kept.map(old => `${old.id} (${old.state}, not in the TODO)`);
    for (const parsed of planned) {
      const old = existing.get(parsed.id);
      if (old !== undefined && !REFRESHABLE[old.state]) {
        skipped.push(`${old.id} (${old.state})`);
        continue;
      }
      const definition = { title: parsed.title, depends: parsed.depends, spec: parsed.spec, doneWhen: parsed.doneWhen };
      const record: ItemRecord =
        old !== undefined
          ? { ...old, ...definition }
          : { id: parsed.id, state: "pending", ...definition, failures: 0, plannerRounds: 0, conflicts: 0, commit: undefined, findings: [], history: [] };
      await saveItem(dir, record);
      if (old === undefined) created += 1;
      else refreshed += 1;
    }
    for (const old of removed) await rm(join(dir, "items", `${old.id}.json`));
    const skippedText = skipped.length === 0 ? "" : ` Skipped in-flight or done items: ${skipped.join(", ")}.`;
    const removedText = removed.length === 0 ? "" : ` Removed: ${removed.map(old => `${old.id} (${old.state})`).join(", ")}.`;
    return ok(`Plan ${ref} applied: ${created} created, ${refreshed} refreshed, ${removed.length} removed.${removedText}${skippedText}`, { revision: ref, created, refreshed, removed: removed.map(old => old.id), skipped }, "request approval A with ref plan if required, then start the first ready item");
  });
}

// -- get --------------------------------------------------------------------------------------------------------

async function getState(deps: MissionDeps, active: Active, scope: string, itemId: string | undefined): Promise<MissionToolResult> {
  const { dir, mission, stateDir } = active;
  switch (scope) {
    case "mission": {
      const items = await loadItems(dir);
      const counts: Record<string, number> = {};
      for (const item of items) counts[item.state] = (counts[item.state] ?? 0) + 1;
      return ok(`Mission ${mission.id} is ${mission.status}${mission.statusReason === undefined ? "" : ` (${mission.statusReason})`}.`, { mission, itemCounts: counts });
    }
    case "items": {
      const items = await loadItems(dir);
      const rows = items.map(i => ({ id: i.id, title: i.title, state: i.state, depends: i.depends, failures: i.failures, plannerRounds: i.plannerRounds, conflicts: i.conflicts, commit: i.commit }));
      return ok(`${items.length} item(s).`, rows);
    }
    case "item": {
      const item = (await loadItems(dir)).find(candidate => candidate.id === itemId);
      return item === undefined ? err(`Item ${itemId} does not exist.`) : ok(`${item.id} is ${item.state}.`, item);
    }
    case "approvals": {
      const approvals = await loadApprovals(dir);
      return ok(`${approvals.length} approval(s).`, approvals);
    }
    default: {
      const { config } = await loadEffectiveConfig(stateDir, deps.env);
      const usage = await loadUsage(join(dir, "usage.jsonl"));
      const budget = checkBudgets(usage, config.budgets, mission.pogoLoop);
      const exceeded = budget.missionExceeded ? "mission" : budget.pogoExceeded ? "pogo" : undefined;
      const data = {
        ...budget,
        cacheReads: sumCacheReads(usage),
        pogoLoop: mission.pogoLoop,
        breaker: { consecutiveFailures: mission.breaker.consecutiveFailures, limit: config.breaker.consecutiveFailures },
        status: mission.status,
        budget_exceeded: exceeded,
      };
      const text =
        exceeded === undefined
          ? `Mission used ${budget.missionUsed} billable tokens (cache reads excluded; ${budget.missionRemaining} left); Pogo loop ${mission.pogoLoop} used ${budget.pogoUsed} (${budget.pogoRemaining} left). Cache reads, reported separately: ${sumCacheReads(usage)}.`
          : `budget_exceeded: the ${exceeded} budget is exhausted (billable tokens, cache reads excluded: mission ${budget.missionUsed}, Pogo loop ${budget.pogoUsed}).`;
      return ok(text, data, exceeded === "pogo" ? "houston must reset_pogo_loop before spawning pogo again" : undefined);
    }
  }
}

// -- transition -------------------------------------------------------------------------------------------------

async function transition(deps: MissionDeps, active: Active, input: Extract<MissionToolInput, { action: "transition" }>, now: () => string): Promise<MissionToolResult> {
  const { dir, stateDir } = active;
  const { config } = await loadEffectiveConfig(stateDir, deps.env);
  return withMissionLock(dir, async () => {
    const mission = (await loadMission(dir)) ?? active.mission;
    if (deps.caller === "houston" && mission.lane !== "fast") {
      return err(`Mission ${mission.id} runs in the ${mission.lane} lane, where flight drives the items; hand the work off to flight instead of calling transition.`);
    }
    const items = await loadItems(dir);
    const approvals = await loadApprovals(dir);
    const budget = checkBudgets(await loadUsage(join(dir, "usage.jsonl")), config.budgets, mission.pogoLoop);
    const result = applyEvent({ mission, items, config, approvals, budget, now }, input);
    if (!result.ok) return err(result.text, result.next);
    const updated = result.items.find(item => item.id === input.itemId);
    if (updated !== undefined) await saveItem(dir, updated);
    if (result.mission !== mission) await saveMission(dir, result.mission);
    return ok(result.text, { item: updated, missionStatus: result.mission.status }, result.next);
  });
}

// -- approval ---------------------------------------------------------------------------------------------------

async function approval(deps: MissionDeps, active: Active, input: Extract<MissionToolInput, { action: "approval" }>, now: () => string): Promise<MissionToolResult> {
  const { dir, mission, stateDir } = active;
  const { config } = await loadEffectiveConfig(stateDir, deps.env);
  return withMissionLock(dir, async () => {
    const approvals = await loadApprovals(dir);
    const index = approvals.findIndex(a => a.gate === input.gate && a.ref === input.ref && (input.op === "resolve" ? a.status === "pending" : true));
    if (input.op === "request") {
      const existing = approvals[index];
      if (existing?.status === "denied") return err(`Approval ${input.gate} ${input.ref} was denied; do not proceed and do not re-request.`);
      if (existing !== undefined) return ok(`Approval ${input.gate} ${input.ref} already exists (${existing.status}).`, existing);
      const decision = decideGate(input.gate, { autonomy: mission.autonomy, ship: config.ship });
      if (decision === "stop") {
        return err(`Gate ${input.gate} is stopped under ${mission.autonomy} autonomy${input.gate === "F" ? " with ship: deny" : ""}; it cannot be approved, so report it to your orchestrator as an open question.`);
      }
      const record: Approval = { gate: input.gate, ref: input.ref, status: "pending", requestedBy: deps.caller, requestedAt: now() };
      if (input.note !== undefined) record.note = input.note;
      if (decision === "allow") {
        record.status = "granted";
        record.resolvedAt = record.requestedAt;
        record.note = "auto-granted: autonomy allows this gate";
        await saveApprovals(dir, [...approvals, record]);
        return ok(`Approval ${input.gate} ${input.ref} is granted (autonomy allows this gate); you may proceed.`, record);
      }
      await saveApprovals(dir, [...approvals, record]);
      return ok(`Approval ${input.gate} ${input.ref} requested; CAPCOM resolves it.`, record, "report the open request to your orchestrator and wait");
    }
    const target = approvals[index];
    if (target === undefined) return err(`No pending approval for gate ${input.gate} ref ${input.ref}.`);
    const resolved: Approval = { ...target, status: input.status ?? "denied", resolvedAt: now() };
    if (input.note !== undefined) resolved.note = input.note;
    await saveApprovals(dir, approvals.map((a, i) => (i === index ? resolved : a)));
    return ok(`Approval ${input.gate} ${input.ref} is ${resolved.status}.`, resolved);
  });
}

// -- set_status -------------------------------------------------------------------------------------------------

async function setStatus(deps: MissionDeps, active: Active, status: "paused" | "running" | "complete" | "halted", reason: string): Promise<MissionToolResult> {
  return withMissionLock(active.dir, async () => {
    const mission = (await loadMission(active.dir)) ?? active.mission;
    if (mission.status === "complete" || mission.status === "aborted") return err(`Mission ${mission.id} is ${mission.status} and cannot change.`);
    // Gate G: once halted, only CAPCOM may move the mission anywhere else (no halted -> paused -> running detour).
    if (mission.status === "halted" && status !== "halted" && deps.caller !== "main") {
      return err(`Mission ${mission.id} was halted (${mission.statusReason ?? "no reason recorded"}); only CAPCOM can change its status.`);
    }
    const resumed = mission.status === "halted" && status === "running";
    const next: MissionRecord = { ...mission, status, statusReason: reason, breaker: resumed ? { consecutiveFailures: 0 } : mission.breaker };
    await saveMission(active.dir, next);
    return ok(`Mission ${mission.id} is now ${status}${resumed ? "; the breaker count was reset" : ""}.`, { status, reason });
  });
}

// -- registration -----------------------------------------------------------------------------------------------

/** Parameter schema of the `mission` tool, built with OMP's zod (`pi.zod`). */
export function missionParameters(z: ExtensionAPI["zod"]) {
  const finding = z.object({
    severity: z.enum(["blocker", "major", "minor", "nit"]),
    title: z.string(),
    evidence: z.string().describe("file:line, a reproduction with its real output, or a quoted spec clause"),
    location: z.string().optional(),
  });
  const strings = z.array(z.string());
  return z.object({
    action: z.enum(ACTIONS as [MissionToolInput["action"], ...MissionToolInput["action"][]]),
    title: z.string().optional(),
    lane: z.enum(["fast", "standard", "full"]).optional(),
    brief: z.string().optional(),
    todoPath: z.string().optional(),
    scope: z.enum(["mission", "items", "item", "approvals", "budget"]).optional(),
    itemId: z.string().optional(),
    event: z.enum(Object.keys(EVENTS) as [ItemEvent, ...ItemEvent[]]).optional(),
    findings: z.array(finding).optional(),
    commit: z.string().optional(),
    note: z.string().optional(),
    op: z.enum(["request", "resolve"]).optional(),
    gate: z.enum(["A", "B", "C", "D", "E", "F", "G"]).optional(),
    ref: z.string().optional(),
    status: z.string().optional().describe("approval resolve: granted|denied; set_status: paused|running|complete|halted"),
    signal: z.enum(Object.keys(SIGNALS) as [SteeringSignal, ...SteeringSignal[]]).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    instructions: z.object({ primary: z.string(), constraints: strings, success_criteria: strings, next_steps: strings }).optional(),
    kind: z.enum(Object.keys(KINDS) as [ArtifactKind, ...ArtifactKind[]]).optional(),
    name: z.string().optional(),
    content: z.string().optional(),
    append: z.boolean().optional(),
    reason: z.string().optional(),
  });
}

export function registerMissionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "mission",
    label: "Mission",
    description:
      "Interstage mission state. Actions: create (title, lane, brief); plan_set (todoPath?); get (scope: mission|items|item|approvals|budget, itemId?); " +
      "transition (itemId, event, findings?, commit?, note?); approval (op: request|resolve, gate, ref, status?, note?); steer (signal, payload, instructions?); " +
      "apply_steering; write_artifact (kind, name, content, append?); set_status (status, reason); reset_pogo_loop. Which agent may call which action is enforced.",
    parameters: missionParameters(pi.zod),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const parsed = parseMissionInput(params as Record<string, unknown>);
      const result: MissionToolResult =
        "error" in parsed
          ? err(parsed.error)
          : await executeMission(
              {
                caller: ctx.agent.kind === "main" ? "main" : ctx.agent.name,
                cwd: ctx.cwd,
                env: process.env,
                exec: (command, args, options) => pi.exec(command, args, { cwd: options.cwd }),
              },
              parsed.input,
            );
      const body = [result.text, result.next === undefined ? "" : `Next: ${result.next}`, result.data === undefined ? "" : JSON.stringify(result.data, null, 2)].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: body }], details: result, isError: !result.ok };
    },
  });
}
