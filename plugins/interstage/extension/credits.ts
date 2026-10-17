// Process evidence (CONTRACTS section 3): the extension records every allowed subagent spawn and every task-branch
// merge, and `transition` spends those records as credits. A small model that skips the verifiers or re-creates the
// builders' files by hand cannot produce them.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ItemEvent, ItemRecord } from "./contracts";
import type { GitExec } from "./tools";

/** Agents whose spawn is the credit for `builder_done` and `builder_failed`. */
export const EXECUTORS: Record<string, true> = { curiosity: true, perseverance: true, orbiter: true, "tiger-team": true, "golden-record": true, booster: true };

export interface SpawnRecord {
  at: string;
  agent: string;
}

export interface MergeRecord {
  at: string;
  item: string;
}

/** `O_APPEND` writes of one short line are atomic, so concurrent sessions never interleave (same as usage.jsonl). */
async function appendLine(path: string, record: SpawnRecord | MergeRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`);
}

export function recordSpawn(missionDir: string, agent: string, at: string): Promise<void> {
  return appendLine(join(missionDir, "spawns.jsonl"), { at, agent: agent.toLowerCase() });
}

export function recordMerge(missionDir: string, item: string, at: string): Promise<void> {
  return appendLine(join(missionDir, "merges.jsonl"), { at, item });
}

async function readLines(path: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn or foreign line is not a credit
    }
  }
  return out;
}

export async function loadSpawns(missionDir: string): Promise<SpawnRecord[]> {
  const rows = await readLines(join(missionDir, "spawns.jsonl"));
  return rows.filter((row): row is SpawnRecord => typeof row === "object" && row !== null && "at" in row && "agent" in row && typeof row.at === "string" && typeof row.agent === "string");
}

export async function loadMerges(missionDir: string): Promise<MergeRecord[]> {
  const rows = await readLines(join(missionDir, "merges.jsonl"));
  return rows.filter((row): row is MergeRecord => typeof row === "object" && row !== null && "at" in row && "item" in row && typeof row.at === "string" && typeof row.item === "string");
}

/** Transitions already recorded in item history, across the whole mission: what has consumed credits so far. */
function consumed(items: ItemRecord[], events: ItemEvent[]): number {
  return items.reduce((total, item) => total + item.history.filter(entry => (events as string[]).includes(entry.event)).length, 0);
}

export interface CreditInput {
  event: ItemEvent;
  item: ItemRecord;
  items: ItemRecord[];
  spawns: SpawnRecord[];
  merges: MergeRecord[];
}

/**
 * The reason a transition lacks its process evidence, or undefined when it is covered. Credits are spawns minus the
 * transitions already in item history, so there is no counter to drift. Events other than the five below need none.
 */
export function creditShortfall({ event, item, items, spawns, merges }: CreditInput): string | undefined {
  const count = (agents: (agent: string) => boolean) => spawns.filter(spawn => agents(spawn.agent)).length;
  switch (event) {
    case "builder_done":
    case "builder_failed": {
      const available = count(agent => Object.hasOwn(EXECUTORS, agent)) - consumed(items, ["builder_done", "builder_failed"]);
      if (available > 0) return undefined;
      return `${event} for ${item.id} needs an executor spawn (${Object.keys(EXECUTORS).join(", ")}) that no earlier result used, and none is recorded: spawn the executor for ${item.id}, wait for its report, then call transition again.`;
    }
    case "verify_clean":
    case "verify_failed": {
      const used = consumed(items, ["verify_clean", "verify_failed"]);
      const missing = ["go-no-go", "inspector"].filter(name => count(agent => agent === name) - used <= 0);
      if (missing.length === 0) return undefined;
      return `${event} for ${item.id} needs one unused ${missing.join(" and one unused ")} spawn and none is recorded: spawn ${missing.join(" and ")} on the verification worktree, wait for their reports, then call transition again. Verification reports written by the orchestrator do not count.`;
    }
    case "integrate_ok": {
      const built = [...item.history].reverse().find(entry => entry.event === "builder_done")?.at;
      const merged = merges.some(merge => merge.item === item.id && (built === undefined || merge.at > built));
      if (merged) return undefined;
      return `integrate_ok for ${item.id} needs a recorded git merge of omp/task/${item.id} (or its -2, -3 retry branch) newer than the latest builder_done${built === undefined ? "" : ` (${built})`}, and none is: run git merge --squash on the task branch, commit it, then call transition again. Re-creating the builder's files by hand does not count.`;
    }
    default:
      return undefined;
  }
}

/** Whether `commit` names an existing commit whose subject starts with `<ID>: `. Returns the problem, if any. */
export async function commitProblem(exec: GitExec, cwd: string, itemId: string, commit: string): Promise<string | undefined> {
  const hint = `run git commit -m "${itemId}: <imperative title>" after the squash merge and pass the id from git rev-parse HEAD`;
  if (!/^[0-9a-fA-F]{7,64}$/.test(commit)) return `commit "${commit}" is not a commit id (hexadecimal); ${hint}.`;
  const found = await exec("git", ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], { cwd });
  if (found.code !== 0) return `commit ${commit} does not exist in this repository; ${hint}.`;
  const subject = await exec("git", ["log", "-1", "--format=%s", found.stdout.trim()], { cwd });
  if (subject.code !== 0 || !subject.stdout.trim().startsWith(`${itemId}: `)) {
    return `commit ${commit} has the subject "${subject.stdout.trim()}", which does not start with "${itemId}: "; ${hint}.`;
  }
  return undefined;
}
