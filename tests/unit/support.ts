// Shared fixtures for the runtime tests: temp dirs, real git repositories, mission and item builders.

import { afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplyContext } from "../../plugins/interstage/extension/state";
import { DEFAULT_CONFIG } from "../../plugins/interstage/extension/config";
import type { GitExec } from "../../plugins/interstage/extension/tools";
import type { Approval, ItemRecord, MissionRecord, UsageRecord } from "../../plugins/interstage/extension/contracts";

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
});

export async function tempDir(prefix = "interstage-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Real process execution, shaped like `pi.exec`. */
export const realExec: GitExec = async (command, args, options) => {
  const proc = Bun.spawn([command, ...args], { cwd: options.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await realExec("git", args, { cwd });
  if (out.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr}`);
  return out.stdout.trim();
}

/** A repository on branch `main` with one commit. */
export async function tempRepo(): Promise<string> {
  const dir = await tempDir("interstage-repo-");
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.email", "test@example.com");
  await git(dir, "config", "user.name", "Test");
  await writeFile(join(dir, "README.md"), "hello\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export interface Sandbox {
  repo: string;
  stateDir: string;
  agentDir: string;
  env: NodeJS.ProcessEnv;
}

/** Repo + state dir + isolated agent dir (so the user's real interstage.yml is never read). */
export async function sandbox(projectConfig?: string): Promise<Sandbox> {
  const repo = await tempRepo();
  const stateDir = join(repo, ".interstage");
  const agentDir = await tempDir("interstage-agent-");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(repo, ".gitignore"), ".interstage/\n");
  await git(repo, "add", ".gitignore");
  await git(repo, "commit", "-q", "-m", "ignore");
  if (projectConfig !== undefined) await writeFile(join(stateDir, "config.yml"), projectConfig);
  return { repo, stateDir, agentDir, env: { INTERSTAGE_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir } };
}

export const CLOCK = "2030-01-01T00:00:00.000Z";
export const clock = () => CLOCK;

export function mission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "M-001",
    title: "Test mission",
    lane: "standard",
    status: "running",
    statusReason: undefined,
    brief: "brief",
    branch: "mission/M-001-test-mission",
    baseBranch: "main",
    baseSha: "abc123",
    autonomy: "autopilot",
    createdAt: CLOCK,
    breaker: { consecutiveFailures: 0 },
    pogoLoop: 0,
    nextSeq: 1,
    ...overrides,
  };
}

export function item(id: string, overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id,
    title: `Item ${id}`,
    state: "pending",
    depends: [],
    spec: "specs/a.md",
    doneWhen: ["it works"],
    failures: 0,
    plannerRounds: 0,
    conflicts: 0,
    commit: undefined,
    findings: [],
    history: [],
    ...overrides,
  };
}

export function applyCtx(items: ItemRecord[], overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    mission: mission(),
    items,
    config: { ship: DEFAULT_CONFIG.ship, parallel: DEFAULT_CONFIG.parallel, breaker: DEFAULT_CONFIG.breaker },
    approvals: [],
    budget: { missionExceeded: false },
    now: clock,
    ...overrides,
  };
}

export function granted(gate: Approval["gate"], ref: string): Approval {
  return { gate, ref, status: "granted", requestedBy: "flight", requestedAt: CLOCK, resolvedAt: CLOCK };
}

export const BLOCKER = { severity: "blocker" as const, title: "wrong result", evidence: "src/a.ts:10 returns null" };
export const MINOR = { severity: "minor" as const, title: "naming", evidence: "src/a.ts:3" };

/** Fake of the `ctx.ui` surface used by the runtime. */
export function fakeUi(answers: { confirm?: boolean | boolean[]; select?: (string | undefined)[] } = {}) {
  const notes: { message: string; type: string | undefined }[] = [];
  const confirms: { title: string; message: string }[] = [];
  const confirmAnswers = Array.isArray(answers.confirm) ? [...answers.confirm] : undefined;
  const selects = [...(answers.select ?? [])];
  return {
    notes,
    confirms,
    notify(message: string, type?: "info" | "warning" | "error") {
      notes.push({ message, type });
    },
    async confirm(title: string, message: string) {
      confirms.push({ title, message });
      return confirmAnswers !== undefined ? (confirmAnswers.shift() ?? false) : (answers.confirm ?? true) === true;
    },
    async select(_title: string, options: string[]) {
      return selects.length > 0 ? selects.shift() : options[0];
    },
  };
}

/** A usage record; `billable` is split across input/output so the budget unit (input + output + cacheWrite) equals it. */
export function usageRecord(agent: string, billable: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  const input = Math.floor(billable / 2);
  const output = billable - input;
  const cacheRead = extra.cacheRead ?? 0;
  return { at: CLOCK, agent, kind: "sub", input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: 0, ...extra };
}

export const usageLine = (agent: string, billable: number, extra: Partial<UsageRecord> = {}): string => `${JSON.stringify(usageRecord(agent, billable, extra))}\n`;
