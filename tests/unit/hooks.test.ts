import { describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, type Runtime } from "../../plugins/interstage/extension/activation";
import { createHooks, type HookCtx } from "../../plugins/interstage/extension/hooks";
import { saveApprovals, saveMission, loadMission, loadUsage } from "../../plugins/interstage/extension/state";
import type { Approval, MissionRecord } from "../../plugins/interstage/extension/contracts";
import { CLOCK, clock, fakeUi, granted, mission, sandbox, type Sandbox } from "./support";

const ctxOf = (kind: "main" | "sub", name = kind === "main" ? "main" : "task") => {
  const ui = fakeUi();
  const ctx: HookCtx = { agent: { kind, name }, ui };
  return { ctx, ui };
};

async function withMission(sb: Sandbox, overrides: Partial<MissionRecord> = {}, approvals: Approval[] = []) {
  const dir = join(sb.stateDir, "missions", "M-001");
  await mkdir(dir, { recursive: true });
  await saveMission(dir, mission(overrides));
  await saveApprovals(dir, approvals);
  sb.env.INTERSTAGE_MISSION_ID = "M-001";
  return dir;
}

function hooksFor(env: NodeJS.ProcessEnv, runtime: Runtime = createRuntime(), tools: string[] = ["read", "bash", "mission"]) {
  const active = { tools };
  const hooks = createHooks({
    runtime,
    env,
    getActiveTools: () => [...active.tools],
    setActiveTools: async names => {
      active.tools = names;
    },
    now: clock,
  });
  return { hooks, active, runtime };
}

describe("before_agent_start", () => {
  async function persona(sb: Sandbox, text = "You are CAPCOM.") {
    const path = join(sb.agentDir, "persona.md");
    await writeFile(path, text);
    sb.env.INTERSTAGE_PERSONA_FILE = path;
  }

  test("appends the persona to the existing system prompt on the active main session only", async () => {
    const sb = await sandbox();
    await persona(sb);
    const { hooks, runtime } = hooksFor(sb.env);
    const main = ctxOf("main");
    expect(await hooks.beforeAgentStart({ systemPrompt: ["base"] }, main.ctx)).toBeUndefined();
    runtime.active = true;
    expect(await hooks.beforeAgentStart({ systemPrompt: ["base", "more"] }, main.ctx)).toEqual({ systemPrompt: ["base", "more", "You are CAPCOM."] });
    expect(await hooks.beforeAgentStart({ systemPrompt: ["base"] }, ctxOf("sub", "fido").ctx)).toBeUndefined();
  });

  test("re-running on the same base does not duplicate the persona", async () => {
    const sb = await sandbox();
    await persona(sb);
    const { hooks, runtime } = hooksFor(sb.env);
    runtime.active = true;
    const base = ["base"];
    await hooks.beforeAgentStart({ systemPrompt: base }, ctxOf("main").ctx);
    const again = await hooks.beforeAgentStart({ systemPrompt: base }, ctxOf("main").ctx);
    expect(again?.systemPrompt).toEqual(["base", "You are CAPCOM."]);
  });

  test("a missing persona file injects nothing and notifies the error once", async () => {
    const sb = await sandbox();
    sb.env.INTERSTAGE_PERSONA_FILE = join(sb.agentDir, "gone.md");
    const { hooks, runtime } = hooksFor(sb.env);
    runtime.active = true;
    const main = ctxOf("main");
    expect(await hooks.beforeAgentStart({ systemPrompt: ["base"] }, main.ctx)).toBeUndefined();
    await hooks.beforeAgentStart({ systemPrompt: ["base"] }, main.ctx);
    expect(main.ui.notes).toEqual([{ message: expect.stringContaining("gone.md"), type: "error" }]);
  });

  test("the mission tool is removed from every child outside houston and flight, and kept for them and for CAPCOM", async () => {
    const sb = await sandbox();
    for (const [kind, name, keeps] of [["sub", "fido", false], ["sub", "pogo", false], ["sub", "task", false], ["sub", "houston", true], ["sub", "flight", true]] as const) {
      const { hooks, active } = hooksFor(sb.env);
      await hooks.beforeAgentStart({ systemPrompt: [] }, ctxOf(kind, name).ctx);
      expect([name, active.tools.includes("mission")]).toEqual([name, keeps]);
      expect(active.tools).toContain("bash");
    }
    const main = hooksFor(sb.env);
    main.runtime.active = true;
    sb.env.INTERSTAGE_PERSONA_FILE = join(sb.agentDir, "none.md");
    await main.hooks.beforeAgentStart({ systemPrompt: [] }, ctxOf("main").ctx);
    expect(main.active.tools).toContain("mission");
  });

  test("an inactive main session loses the tool; launching restores it", async () => {
    const sb = await sandbox();
    sb.env.INTERSTAGE_PERSONA_FILE = join(sb.agentDir, "none.md");
    const { hooks, active, runtime } = hooksFor(sb.env);
    await hooks.beforeAgentStart({ systemPrompt: [] }, ctxOf("main").ctx);
    expect(active.tools).not.toContain("mission");
    runtime.active = true;
    await hooks.beforeAgentStart({ systemPrompt: [] }, ctxOf("main").ctx);
    expect(active.tools).toContain("mission");
  });

  test("a failing tool registry is logged and does not throw", async () => {
    const sb = await sandbox();
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const hooks = createHooks({ runtime: createRuntime(), env: sb.env, getActiveTools: () => ["mission"], setActiveTools: async () => Promise.reject(new Error("boom")) });
      expect(await hooks.beforeAgentStart({ systemPrompt: [] }, ctxOf("sub", "fido").ctx)).toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("before_subagent_spawn", () => {
  test("allows spawns outside Interstage and while the mission runs", async () => {
    const sb = await sandbox();
    expect(await hooksFor({}).hooks.beforeSubagentSpawn({ agent: "fido" })).toBeUndefined();
    await withMission(sb);
    expect(await hooksFor(sb.env).hooks.beforeSubagentSpawn({ agent: "fido" })).toBeUndefined();
  });

  test("blocks every spawn while paused or halted, with the reason in one sentence", async () => {
    for (const status of ["paused", "halted"] as const) {
      const sb = await sandbox();
      await withMission(sb, { status, statusReason: "breaker tripped" });
      const result = await hooksFor(sb.env).hooks.beforeSubagentSpawn({ agent: "builder" });
      const reason = result?.reason ?? "";
      expect(result?.block).toBe(true);
      expect(reason).toContain(status);
      expect(reason).toContain("breaker tripped");
      expect(reason.match(/\./g)).toHaveLength(1);
    }
  });

  test("blocks after complete or abort, except houston who starts the next mission", async () => {
    for (const status of ["complete", "aborted"] as const) {
      const sb = await sandbox();
      await withMission(sb, { status });
      const { hooks } = hooksFor(sb.env);
      expect(await hooks.beforeSubagentSpawn({ agent: "flight" })).toMatchObject({ block: true });
      expect(await hooks.beforeSubagentSpawn({ agent: "houston" })).toBeUndefined();
    }
  });

  test("blocks pogo once the Pogo loop budget is exceeded and unblocks after a reset", async () => {
    const sb = await sandbox("budgets:\n  pogoLoopTokens: 100\n");
    const dir = await withMission(sb);
    const record = (agent: string, pogoLoop: number, totalTokens: number) => JSON.stringify({ at: CLOCK, agent, pogoLoop, kind: "sub", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens, cost: 0 });
    await writeFile(join(dir, "usage.jsonl"), [record("pogo", 0, 101), record("fido", 0, 5000)].join("\n") + "\n");
    const { hooks } = hooksFor(sb.env);
    expect(await hooks.beforeSubagentSpawn({ agent: "pogo" })).toMatchObject({ block: true, reason: expect.stringContaining("reset the Pogo loop") });
    expect(await hooks.beforeSubagentSpawn({ agent: "fido" })).toBeUndefined();
    await saveMission(dir, mission({ pogoLoop: 1 }));
    expect(await hooks.beforeSubagentSpawn({ agent: "pogo" })).toBeUndefined();
  });

  test("an unreadable mission file fails open", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb);
    await writeFile(join(dir, "mission.json"), "{not json");
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await hooksFor(sb.env).hooks.beforeSubagentSpawn({ agent: "fido" })).toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tool_call gates", () => {
  const bash = (command: string) => ({ toolName: "bash", input: { command } });

  test("the main session is never blocked, and non-bash tools and plain commands pass", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    await withMission(sb, { autonomy: "supervised" });
    const { hooks } = hooksFor(sb.env);
    expect(await hooks.toolCall(bash("npm install left-pad"), ctxOf("main").ctx)).toBeUndefined();
    expect(await hooks.toolCall(bash("git push origin main"), ctxOf("main").ctx)).toBeUndefined();
    expect(await hooks.toolCall({ toolName: "read", input: { path: "npm install" } }, ctxOf("sub").ctx)).toBeUndefined();
    expect(await hooks.toolCall(bash("ls -la && git status"), ctxOf("sub").ctx)).toBeUndefined();
  });

  test("gate D: supervised subagents are blocked on install and network commands until the command is approved", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb, { autonomy: "supervised" });
    const { hooks } = hooksFor(sb.env);
    const sub = ctxOf("sub", "fido").ctx;
    for (const command of ["npm install", "pip install requests", "curl https://example.com", "git clone x", "cd app && bun add zod"]) {
      const result = await hooks.toolCall(bash(command), sub);
      expect([command, result?.block]).toEqual([command, true]);
      expect(result?.reason).toContain("Gate D");
      expect(result?.reason).toContain("open question");
    }
    await saveApprovals(dir, [granted("D", "npm install")]);
    expect(await hooks.toolCall(bash("npm   install"), sub)).toBeUndefined();
    expect(await hooks.toolCall(bash("npm install lodash"), sub)).toMatchObject({ block: true });
  });

  test("an approval for the whole compound command also satisfies gate D", async () => {
    const sb = await sandbox();
    await withMission(sb, { autonomy: "supervised" }, [granted("D", "cd app && npm install")]);
    expect(await hooksFor(sb.env).hooks.toolCall(bash("cd app && npm install"), ctxOf("sub", "fido").ctx)).toBeUndefined();
  });

  test("pending and denied approvals and approvals for a different gate do not unblock", async () => {
    const sb = await sandbox();
    await withMission(sb, { autonomy: "supervised" }, [
      { ...granted("D", "npm install"), status: "pending" },
      { ...granted("D", "npm install"), status: "denied" },
      granted("F", "npm install"),
    ]);
    expect(await hooksFor(sb.env).hooks.toolCall(bash("npm install"), ctxOf("sub", "fido").ctx)).toMatchObject({ block: true });
  });

  test("checkpoints and autopilot allow installs without approval", async () => {
    for (const autonomy of ["checkpoints", "autopilot"] as const) {
      const sb = await sandbox();
      await withMission(sb, { autonomy });
      expect(await hooksFor(sb.env).hooks.toolCall(bash("npm install"), ctxOf("sub", "fido").ctx)).toBeUndefined();
    }
  });

  test("gate E: merging an omp/task branch needs approval for merge:<TODO-ID> under supervised autonomy only", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb, { autonomy: "supervised" });
    const { hooks } = hooksFor(sb.env);
    const sub = ctxOf("sub", "flight").ctx;
    const blocked = await hooks.toolCall(bash("git merge --squash omp/task/T-014"), sub);
    expect(blocked).toMatchObject({ block: true });
    expect(blocked?.reason).toContain("merge:T-014");
    await saveApprovals(dir, [granted("E", "merge:T-014")]);
    expect(await hooks.toolCall(bash("git merge --squash omp/task/T-014"), sub)).toBeUndefined();
    expect(await hooks.toolCall(bash("git merge --squash omp/task/T-015"), sub)).toMatchObject({ block: true });
    const open = await sandbox();
    await withMission(open, { autonomy: "checkpoints" });
    expect(await hooksFor(open.env).hooks.toolCall(bash("git merge --squash omp/task/T-014"), sub)).toBeUndefined();
  });

  test("gate F: ship commands need approval in supervised and checkpoints; autopilot stops unless ship is allowed", async () => {
    for (const autonomy of ["supervised", "checkpoints"] as const) {
      const sb = await sandbox();
      const dir = await withMission(sb, { autonomy });
      const { hooks } = hooksFor(sb.env);
      const sub = ctxOf("sub", "go-no-go").ctx;
      expect(await hooks.toolCall(bash("git push origin HEAD"), sub)).toMatchObject({ block: true, reason: expect.stringContaining("Gate F") });
      await saveApprovals(dir, [granted("F", "git push origin HEAD")]);
      expect(await hooks.toolCall(bash("git push origin HEAD"), sub)).toBeUndefined();
    }
    const denyShip = await sandbox();
    await withMission(denyShip, { autonomy: "autopilot" }, [granted("F", "git push origin HEAD")]);
    expect(await hooksFor(denyShip.env).hooks.toolCall(bash("git push origin HEAD"), ctxOf("sub", "x").ctx)).toMatchObject({ block: true });
    const allowShip = await sandbox("ship: allow\n");
    await withMission(allowShip, { autonomy: "autopilot" });
    expect(await hooksFor(allowShip.env).hooks.toolCall(bash("git push origin HEAD"), ctxOf("sub", "x").ctx)).toBeUndefined();
  });

  test("approvals that cannot be read fail closed", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb, { autonomy: "supervised" });
    await writeFile(join(dir, "approvals.json"), "{broken");
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await hooksFor(sb.env).hooks.toolCall(bash("npm install"), ctxOf("sub", "fido").ctx)).toMatchObject({ block: true });
    } finally {
      spy.mockRestore();
    }
  });

  test("with no active mission gates D, E and F do not block, even under supervised autonomy and ship deny", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    const sub = ctxOf("sub", "fido").ctx;
    const { hooks } = hooksFor(sb.env);
    for (const command of ["npm install", "git merge --squash omp/task/T-001", "git push origin HEAD"]) {
      expect([command, await hooks.toolCall(bash(command), sub)]).toEqual([command, undefined]);
    }
    sb.env.INTERSTAGE_MISSION_ID = "M-009";
    expect(await hooks.toolCall(bash("npm install"), sub)).toBeUndefined();
  });

  test("spawn blocking still applies and a corrupt mission file still fails closed", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    const dir = await withMission(sb, { status: "paused", autonomy: "supervised" });
    expect(await hooksFor(sb.env).hooks.beforeSubagentSpawn({ agent: "fido" })).toMatchObject({ block: true });
    await writeFile(join(dir, "mission.json"), "{broken");
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await hooksFor(sb.env).hooks.toolCall(bash("npm install"), ctxOf("sub", "fido").ctx)).toMatchObject({ block: true });
    } finally {
      spy.mockRestore();
    }
  });

  test("outside Interstage (no state dir) nothing is blocked", async () => {
    expect(await hooksFor({}).hooks.toolCall(bash("npm install"), ctxOf("sub", "fido").ctx)).toBeUndefined();
  });
});

describe("message_end", () => {
  const message = (totalTokens: number) => ({ role: "assistant", usage: { input: 3, output: 4, cacheRead: 1, cacheWrite: 2, totalTokens, cost: { total: 0.5 } } });

  test("appends a UsageRecord with the mission's pogoLoop, the agent name and kind", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb, { pogoLoop: 2 });
    const { hooks } = hooksFor(sb.env);
    await hooks.messageEnd({ message: message(10) }, ctxOf("sub", "pogo").ctx);
    await hooks.messageEnd({ message: message(7) }, ctxOf("main").ctx);
    expect(await loadUsage(join(dir, "usage.jsonl"))).toEqual([
      { at: CLOCK, mission: "M-001", pogoLoop: 2, agent: "pogo", kind: "sub", input: 3, output: 4, cacheRead: 1, cacheWrite: 2, totalTokens: 10, cost: 0.5 },
      { at: CLOCK, mission: "M-001", pogoLoop: 2, agent: "main", kind: "main", input: 3, output: 4, cacheRead: 1, cacheWrite: 2, totalTokens: 7, cost: 0.5 },
    ]);
  });

  test("with no mission the record goes to the state dir's usage.jsonl without mission fields", async () => {
    const sb = await sandbox();
    await hooksFor(sb.env).hooks.messageEnd({ message: message(5) }, ctxOf("main").ctx);
    const [record] = await loadUsage(join(sb.stateDir, "usage.jsonl"));
    expect(record).toMatchObject({ agent: "main", totalTokens: 5 });
    expect(record?.mission).toBeUndefined();
    expect(record?.pogoLoop).toBeUndefined();
  });

  test("ignores non-assistant messages and sessions outside Interstage", async () => {
    const sb = await sandbox();
    const { hooks } = hooksFor(sb.env);
    await hooks.messageEnd({ message: { role: "user" } }, ctxOf("main").ctx);
    await hooksFor({}).hooks.messageEnd({ message: message(5) }, ctxOf("main").ctx);
    expect(await loadUsage(join(sb.stateDir, "usage.jsonl"))).toEqual([]);
  });

  test("concurrent children appending usage lose nothing", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb);
    const { hooks } = hooksFor(sb.env);
    await Promise.all(Array.from({ length: 30 }, (_, i) => hooks.messageEnd({ message: message(1) }, ctxOf("sub", `a${i}`).ctx)));
    expect(await loadUsage(join(dir, "usage.jsonl"))).toHaveLength(30);
  });

  test("crossing the mission token budget halts a running mission once and tells the user", async () => {
    const sb = await sandbox("budgets:\n  missionTokens: 100\n");
    const dir = await withMission(sb);
    const { hooks } = hooksFor(sb.env);
    const main = ctxOf("main");
    await hooks.messageEnd({ message: message(100) }, main.ctx);
    expect((await loadMission(dir))?.status).toBe("running");
    await hooks.messageEnd({ message: message(1) }, main.ctx);
    expect(await loadMission(dir)).toMatchObject({ status: "halted", statusReason: expect.stringContaining("token budget") });
    await hooks.messageEnd({ message: message(1) }, main.ctx);
    expect(main.ui.notes.filter(n => n.message.includes("halted"))).toHaveLength(1);
  });

  test("a breaker count at the limit halts the mission", async () => {
    const sb = await sandbox("breaker:\n  consecutiveFailures: 2\n");
    const dir = await withMission(sb, { breaker: { consecutiveFailures: 2 } });
    await hooksFor(sb.env).hooks.messageEnd({ message: message(1) }, ctxOf("main").ctx);
    expect(await loadMission(dir)).toMatchObject({ status: "halted", statusReason: expect.stringContaining("circuit breaker") });
  });

  test("a paused mission is not changed by usage", async () => {
    const sb = await sandbox("budgets:\n  missionTokens: 1\n");
    const dir = await withMission(sb, { status: "paused" });
    await hooksFor(sb.env).hooks.messageEnd({ message: message(50) }, ctxOf("main").ctx);
    expect((await loadMission(dir))?.status).toBe("paused");
  });

  test("an unwritable usage file is logged, never thrown", async () => {
    const sb = await sandbox();
    const dir = await withMission(sb);
    await mkdir(join(dir, "usage.jsonl"));
    await chmod(join(dir, "usage.jsonl"), 0o000);
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(hooksFor(sb.env).hooks.messageEnd({ message: message(1) }, ctxOf("main").ctx)).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      await chmod(join(dir, "usage.jsonl"), 0o755);
    }
  });
});
