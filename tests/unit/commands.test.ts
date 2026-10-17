import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROLE_TIERS, doctorReport, gitignoreHasEntry, runAbort, runInit, runStatus, type CommandEnv } from "../../plugins/interstage/extension/commands";
import { saveItem, saveMission } from "../../plugins/interstage/extension/state";
import { clock, fakeUi, git, item, mission, realExec, sandbox, tempDir, tempRepo, type Sandbox } from "./support";

type Ui = ReturnType<typeof fakeUi>;

function envFor(sb: Sandbox, ui: Ui, overrides: Partial<CommandEnv> = {}): CommandEnv & { roles: Record<string, string> } {
  const roles: Record<string, string> = {};
  return {
    ui,
    cwd: sb.repo,
    env: { ...sb.env },
    exec: realExec,
    listModels: () => ["anthropic/strong-1", "anthropic/mid-1", "anthropic/fast-1"],
    getRoles: () => roles,
    setRole: (role, model) => {
      roles[role] = model;
    },
    roles,
    ...overrides,
  };
}

describe("/interstage:init", () => {
  test("creates .interstage/, adds the ignore entry after confirmation, writes roles and the default config", async () => {
    const sb = await sandbox();
    await writeFile(join(sb.repo, ".gitignore"), "node_modules");
    const ui = fakeUi({ confirm: true, select: ["anthropic/strong-1", "anthropic/mid-1", "anthropic/fast-1"] });
    const c = envFor(sb, ui);
    await runInit(c);
    expect(ui.confirms).toHaveLength(1);
    expect(ui.confirms[0]?.message).toContain("will not commit");
    expect(await readFile(join(sb.repo, ".gitignore"), "utf8")).toBe("node_modules\n.interstage/\n");
    expect(c.roles).toEqual({
      capcom: "anthropic/strong-1",
      orchestrator: "anthropic/strong-1",
      planner: "anthropic/strong-1",
      reviewer: "anthropic/strong-1",
      coder: "anthropic/mid-1",
      scout: "anthropic/fast-1",
    });
    const config = await readFile(join(sb.agentDir, "interstage.yml"), "utf8");
    expect(config).toContain("autonomy: checkpoints");
    expect(await git(sb.repo, "log", "--oneline")).not.toContain("gitignore");
  });

  test("running twice leaves one ignore line, keeps an existing config and does not ask again", async () => {
    const sb = await sandbox();
    await writeFile(join(sb.repo, ".gitignore"), "dist\n");
    const first = fakeUi({ confirm: true });
    await runInit(envFor(sb, first));
    await writeFile(join(sb.agentDir, "interstage.yml"), "autonomy: supervised\n");
    const second = fakeUi({ confirm: true });
    const c = envFor(sb, second);
    await runInit(c);
    expect(await readFile(join(sb.repo, ".gitignore"), "utf8")).toBe("dist\n.interstage/\n");
    expect(second.confirms).toEqual([]);
    expect(await readFile(join(sb.agentDir, "interstage.yml"), "utf8")).toBe("autonomy: supervised\n");
    expect(second.notes[0]?.message).toContain("already lists");
  });

  test("declining the confirmation leaves .gitignore alone", async () => {
    const sb = await sandbox();
    await writeFile(join(sb.repo, ".gitignore"), "dist\n");
    await runInit(envFor(sb, fakeUi({ confirm: false })));
    expect(await readFile(join(sb.repo, ".gitignore"), "utf8")).toBe("dist\n");
  });

  test("creates a .gitignore when there is none", async () => {
    const repo = await tempRepo();
    const agentDir = await tempDir();
    const sb: Sandbox = { repo, stateDir: join(repo, ".interstage"), agentDir, env: { PI_CODING_AGENT_DIR: agentDir } };
    await runInit(envFor(sb, fakeUi({ confirm: true })));
    expect(await readFile(join(repo, ".gitignore"), "utf8")).toBe(".interstage/\n");
  });

  test("cancelling the model wizard changes no role; no models skips it with an explanation", async () => {
    const sb = await sandbox();
    const cancelUi = fakeUi({ select: ["anthropic/strong-1", undefined] });
    const cancelled = envFor(sb, cancelUi);
    await runInit(cancelled);
    expect(cancelled.roles).toEqual({});
    expect(cancelUi.notes[0]?.message).toContain("cancelled");
    const noneUi = fakeUi();
    const none = envFor(sb, noneUi, { listModels: () => [] });
    await runInit(none);
    expect(none.roles).toEqual({});
    expect(noneUi.notes[0]?.message).toContain("No authenticated models");
  });

  test("role tiers are the contract: four strong, coder balanced, scout fast", () => {
    expect(Object.entries(ROLE_TIERS).filter(([, tier]) => tier === "strong").map(([role]) => role)).toEqual(["capcom", "orchestrator", "planner", "reviewer"]);
    expect([ROLE_TIERS.coder, ROLE_TIERS.scout]).toEqual(["balanced", "fast"]);
  });

  test("gitignoreHasEntry accepts the usual spellings only", () => {
    for (const line of [".interstage", ".interstage/", "/.interstage/", "  .interstage/  "]) expect(gitignoreHasEntry(`a\n${line}\n`)).toBe(true);
    for (const text of ["", "foo.interstage/", "# .interstage/", ".interstage-old/"]) expect(gitignoreHasEntry(text)).toBe(false);
  });
});

describe("/interstage:status", () => {
  test("reports mission, items by state, budget and breaker", async () => {
    const sb = await sandbox();
    const dir = join(sb.stateDir, "missions", "M-001");
    await mkdir(dir, { recursive: true });
    await saveMission(dir, mission({ breaker: { consecutiveFailures: 2 } }));
    await saveItem(dir, item("T-001", { state: "done" }));
    await saveItem(dir, item("T-002", { state: "building", failures: 1 }));
    await writeFile(join(dir, "usage.jsonl"), `${JSON.stringify({ at: clock(), agent: "main", kind: "main", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1234, cost: 0 })}\n`);
    const ui = fakeUi();
    const c = envFor(sb, ui);
    c.env.INTERSTAGE_MISSION_ID = "M-001";
    await runStatus(c);
    const text = ui.notes[0]?.message ?? "";
    expect(text).toContain("Mission M-001: Test mission");
    expect(text).toContain("done 1, building 1");
    expect(text).toContain("T-002 [building]");
    expect(text).toContain("mission 1234 of 2000000 tokens");
    expect(text).toContain("2 of 5 consecutive failures");
  });

  test("says so when Interstage is inactive or no mission exists", async () => {
    const sb = await sandbox();
    const inactive = fakeUi();
    await runStatus({ ...envFor(sb, inactive), env: {} });
    expect(inactive.notes[0]?.message).toContain("not active");
    const none = fakeUi();
    await runStatus(envFor(sb, none));
    expect(none.notes[0]?.message).toContain("no mission");
  });
});

describe("/interstage:abort", () => {
  async function started(sb: Sandbox) {
    const dir = join(sb.stateDir, "missions", "M-001");
    await mkdir(dir, { recursive: true });
    const base = await git(sb.repo, "rev-parse", "HEAD");
    await saveMission(dir, mission({ baseSha: base, branch: "mission/M-001-x" }));
    await saveItem(dir, item("T-001", { state: "building" }));
    await saveItem(dir, item("T-002"));
    await git(sb.repo, "branch", "omp/task/T-001");
    await git(sb.repo, "branch", "omp/task/T-999");
    await git(sb.repo, "switch", "-q", "-c", "mission/M-001-x");
    await writeFile(join(sb.repo, "a.txt"), "x");
    await git(sb.repo, "add", "a.txt");
    await git(sb.repo, "commit", "-q", "-m", "T-000: work");
    return dir;
  }

  test("after confirmation: checks out the base, deletes the mission and recorded task branches, marks aborted", async () => {
    const sb = await sandbox();
    const dir = await started(sb);
    const ui = fakeUi({ confirm: true });
    const c = envFor(sb, ui);
    c.env.INTERSTAGE_MISSION_ID = "M-001";
    await runAbort(c);
    expect(ui.confirms[0]?.message).toContain("omp/task/T-001");
    expect(await git(sb.repo, "branch", "--show-current")).toBe("main");
    const branches = await git(sb.repo, "branch", "--format=%(refname:short)");
    expect(branches.split("\n").sort()).toEqual(["main", "omp/task/T-999"]);
    expect(JSON.parse(await readFile(join(dir, "mission.json"), "utf8"))).toMatchObject({ status: "aborted" });
  });

  test("also deletes numbered retry branches of the mission's items, and lists them in the confirmation", async () => {
    const sb = await sandbox();
    await started(sb);
    for (const name of ["omp/task/T-001-2", "omp/task/T-001-3", "omp/task/T-002-2", "omp/task/T-0011", "omp/task/T-001-x", "omp/task/T-999-2"]) await git(sb.repo, "branch", name);
    const ui = fakeUi({ confirm: true });
    const c = envFor(sb, ui);
    c.env.INTERSTAGE_MISSION_ID = "M-001";
    await runAbort(c);
    for (const name of ["omp/task/T-001", "omp/task/T-001-2", "omp/task/T-001-3", "omp/task/T-002-2"]) expect(ui.confirms[0]?.message).toContain(name);
    const left = (await git(sb.repo, "branch", "--format=%(refname:short)")).split("\n").sort();
    expect(left).toEqual(["main", "omp/task/T-0011", "omp/task/T-001-x", "omp/task/T-999", "omp/task/T-999-2"].sort());
  });

  test("declining changes nothing", async () => {
    const sb = await sandbox();
    const dir = await started(sb);
    const c = envFor(sb, fakeUi({ confirm: false }));
    c.env.INTERSTAGE_MISSION_ID = "M-001";
    await runAbort(c);
    expect(await git(sb.repo, "branch", "--show-current")).toBe("mission/M-001-x");
    expect(JSON.parse(await readFile(join(dir, "mission.json"), "utf8")).status).toBe("running");
  });

  test("refuses on a dirty tree without asking", async () => {
    const sb = await sandbox();
    await started(sb);
    await writeFile(join(sb.repo, "a.txt"), "dirty");
    const ui = fakeUi({ confirm: true });
    const c = envFor(sb, ui);
    c.env.INTERSTAGE_MISSION_ID = "M-001";
    await runAbort(c);
    expect(ui.confirms).toEqual([]);
    expect(ui.notes[0]).toMatchObject({ type: "error", message: expect.stringContaining("uncommitted") });
    expect(await git(sb.repo, "branch", "--show-current")).toBe("mission/M-001-x");
  });

  test("refuses when there is no active mission or it is already aborted", async () => {
    const sb = await sandbox();
    const none = fakeUi();
    await runAbort(envFor(sb, none));
    expect(none.notes[0]?.message).toContain("no active mission");
    const dir = await started(sb);
    await saveMission(dir, mission({ status: "aborted" }));
    const again = fakeUi({ confirm: true });
    const c = envFor(sb, again);
    c.env.INTERSTAGE_MISSION_ID = "M-001";
    await runAbort(c);
    expect(again.confirms).toEqual([]);
  });
});

describe("/interstage:doctor", () => {
  function doctorEnv(sb: Sandbox, present: string[], roles: Record<string, string>) {
    return {
      cwd: sb.repo,
      env: { ...sb.env },
      exec: realExec,
      getRoles: () => roles,
      which: (bin: string) => (present.includes(bin) ? `/usr/bin/${bin}` : null),
      ompVersion: "x.y.z",
      bunVersion: "1.2.3",
    };
  }

  test("detects languages by marker files and gives an install hint for each missing tool", async () => {
    const sb = await sandbox();
    await writeFile(join(sb.repo, "package.json"), "{}");
    await writeFile(join(sb.repo, "go.mod"), "module x");
    const report = await doctorReport(doctorEnv(sb, ["git", "node", "gopls"], {}));
    expect(report).toContain("TypeScript/JavaScript (package.json)");
    expect(report).toContain("Go (go.mod)");
    expect(report).not.toContain("Python (");
    expect(report).toContain("typescript-language-server (language server): missing; install: npm install -g typescript-language-server typescript");
    expect(report).toContain("gopls (language server): /usr/bin/gopls");
    expect(report).toContain("go (toolchain and test runner (go test)): missing; install: install Go from https://go.dev/dl/");
  });

  test("lists every Interstage role, marks the unset ones and reports the .gitignore state", async () => {
    const sb = await sandbox();
    const report = await doctorReport(doctorEnv(sb, ["git"], { capcom: "a/b", coder: "a/c" }));
    for (const role of Object.keys(ROLE_TIERS)) expect(report).toContain(`- ${role}:`);
    expect(report).toContain("- capcom: a/b");
    expect(report).toContain("- scout: NOT SET");
    expect(report).toContain("Missing roles: orchestrator, planner, reviewer, scout");
    expect(report).toContain(".gitignore: lists .interstage/");
    await writeFile(join(sb.repo, ".gitignore"), "dist\n");
    expect(await doctorReport(doctorEnv(sb, [], {}))).toContain("does NOT list .interstage/");
  });

  test("reports config errors and unknown keys, and the absence of gh and git", async () => {
    const sb = await sandbox("autonomy: reckless\nsurprise: 1\n");
    const report = await doctorReport(doctorEnv(sb, [], {}));
    expect(report).toContain("Config errors:");
    expect(report).toContain("autonomy");
    expect(report).toContain("surprise");
    expect(report).toContain("git: MISSING");
    expect(report).toContain("gh: missing");
    expect(report).toContain("none of the known markers");
  });

  test("reports whether the active mission id resolves and lists unfinished missions", async () => {
    const sb = await sandbox();
    for (const [id, status] of [["M-001", "paused"], ["M-002", "complete"], ["M-003", "running"]] as const) {
      const dir = join(sb.stateDir, "missions", id);
      await mkdir(dir, { recursive: true });
      await saveMission(dir, mission({ id, status, title: `title ${id}` }));
    }
    const none = await doctorReport(doctorEnv(sb, [], {}));
    expect(none).toContain("Active mission: none");
    expect(none).toContain("- M-001 (paused): title M-001");
    expect(none).toContain("- M-003 (running)");
    expect(none).not.toContain("- M-002");
    const good = doctorEnv(sb, [], {});
    good.env.INTERSTAGE_MISSION_ID = "M-003";
    expect(await doctorReport(good)).toContain("Active mission: M-003 (running");
    const bad = doctorEnv(sb, [], {});
    bad.env.INTERSTAGE_MISSION_ID = "M-009";
    expect(await doctorReport(bad)).toContain("M-009 does NOT resolve");
  });

  test("never writes anything", async () => {
    const sb = await sandbox();
    const before = await git(sb.repo, "status", "--porcelain", "--ignored");
    await doctorReport(doctorEnv(sb, ["git"], {}));
    expect(await git(sb.repo, "status", "--porcelain", "--ignored")).toBe(before);
  });
});
