import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { activate, onSessionStart, applyActiveOverrides, applyInactiveOverrides, createRuntime, loadPersona, personaPath, type SettingsPort } from "../../plugins/interstage/extension/activation";
import { AGENT_NAMES } from "../../plugins/interstage/extension/contracts";
import { realExec, fakeUi, mission, sandbox, tempDir } from "./support";
import { saveMission } from "../../plugins/interstage/extension/state";

/** In-memory settings: `user` is the persisted value, `overrides` the runtime layer. */
function fakeSettings(user: Record<string, unknown> = {}, failOn: string[] = []) {
  const overrides: Record<string, unknown> = {};
  const port: SettingsPort = {
    get: id => (id in overrides ? overrides[id] : user[id]),
    override(id, value) {
      if (failOn.includes(id)) throw new Error(`rejected ${id}`);
      overrides[id] = value;
    },
    clearOverride(id) {
      delete overrides[id];
    },
  };
  return { port, overrides };
}

describe("runtime overrides when active", () => {
  test("sets isolation, LSP and GitHub settings, runtime only", () => {
    const { port, overrides } = fakeSettings();
    expect(applyActiveOverrides(port)).toEqual([]);
    expect(overrides).toMatchObject({
      "task.isolation.enabled": true,
      "task.isolation.merge": "branch",
      "task.isolation.apply": false,
      "task.enableLsp": true,
      "github.enabled": true,
    });
  });

  test("recursion depth is the larger of the user's value and 3", () => {
    for (const [current, expected] of [[1, 3], [3, 3], [5, 5], [undefined, 3]] as const) {
      const { port, overrides } = fakeSettings({ "task.maxRecursionDepth": current });
      applyActiveOverrides(port);
      expect(overrides["task.maxRecursionDepth"]).toBe(expected);
    }
  });

  test("a negative (unlimited) recursion depth is left unchanged", () => {
    const { port, overrides } = fakeSettings({ "task.maxRecursionDepth": -1 });
    applyActiveOverrides(port);
    expect("task.maxRecursionDepth" in overrides).toBe(false);
    expect(port.get("task.maxRecursionDepth")).toBe(-1);
  });

  test("a previous hide-the-agents override is cleared", () => {
    const { port, overrides } = fakeSettings({ "task.disabledAgents": ["mine"] });
    applyInactiveOverrides(port);
    expect(overrides["task.disabledAgents"]).toBeDefined();
    applyActiveOverrides(port);
    expect(overrides["task.disabledAgents"]).toBeUndefined();
  });

  test("a rejected setting is reported and the others still apply", () => {
    const { port, overrides } = fakeSettings({}, ["task.enableLsp"]);
    const errors = applyActiveOverrides(port);
    expect(errors).toEqual([expect.stringContaining("task.enableLsp: rejected")]);
    expect(overrides["github.enabled"]).toBe(true);
  });
});

describe("runtime overrides without the flag", () => {
  test("disabledAgents is the union of the user's list and every Interstage agent, without duplicates", () => {
    const { port, overrides } = fakeSettings({ "task.disabledAgents": ["reviewer-x", "houston"] });
    expect(applyInactiveOverrides(port)).toEqual([]);
    const result = overrides["task.disabledAgents"] as string[];
    expect(result).toContain("reviewer-x");
    for (const name of AGENT_NAMES) expect(result).toContain(name);
    expect(new Set(result).size).toBe(result.length);
  });

  test("applying twice is stable, and a missing user value is treated as empty", () => {
    const { port, overrides } = fakeSettings();
    applyInactiveOverrides(port);
    const first = overrides["task.disabledAgents"];
    applyInactiveOverrides(port);
    expect(overrides["task.disabledAgents"]).toEqual(first);
    expect(first).toEqual([...AGENT_NAMES]);
  });

  test("does not touch isolation or recursion settings", () => {
    const { port, overrides } = fakeSettings();
    applyInactiveOverrides(port);
    expect(Object.keys(overrides)).toEqual(["task.disabledAgents"]);
  });
});

describe("persona", () => {
  test("INTERSTAGE_PERSONA_FILE wins; the default is plugin persona/capcom.md", () => {
    expect(personaPath({ INTERSTAGE_PERSONA_FILE: "/x/p.md" })).toBe("/x/p.md");
    expect(personaPath({})).toEndWith(join("plugins", "interstage", "persona", "capcom.md"));
  });

  test("reads the file, and reports missing or empty files", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "p.md"), "You are CAPCOM.\n");
    expect(await loadPersona({ INTERSTAGE_PERSONA_FILE: join(dir, "p.md") })).toEqual({ text: "You are CAPCOM.\n" });
    expect(await loadPersona({ INTERSTAGE_PERSONA_FILE: join(dir, "missing.md") })).toEqual({ error: expect.stringContaining("missing.md") });
    await writeFile(join(dir, "empty.md"), "  \n");
    expect(await loadPersona({ INTERSTAGE_PERSONA_FILE: join(dir, "empty.md") })).toEqual({ error: expect.stringContaining("empty") });
  });
});

describe("activate", () => {
  test("exports the state dir under the git root, applies overrides and marks the session active", async () => {
    const sb = await sandbox();
    await mkdir(join(sb.repo, "sub"));
    const ui = fakeUi();
    const { port, overrides } = fakeSettings();
    const env: NodeJS.ProcessEnv = { INTERSTAGE_PERSONA_FILE: join(sb.agentDir, "persona.md") };
    await writeFile(join(sb.agentDir, "persona.md"), "persona");
    const runtime = createRuntime();
    await activate({ exec: realExec, notify: ui.notify, cwd: join(sb.repo, "sub"), env, settings: port, runtime });
    expect(env.INTERSTAGE_STATE_DIR).toBe(join(await Bun.$`cd ${sb.repo} && git rev-parse --show-toplevel`.text().then(t => t.trim()), ".interstage"));
    expect(runtime.active).toBe(true);
    expect(overrides["task.isolation.enabled"]).toBe(true);
    expect(ui.notes).toEqual([]);
  });

  test("keeps a state dir that is already exported", async () => {
    const sb = await sandbox();
    const env: NodeJS.ProcessEnv = { INTERSTAGE_STATE_DIR: sb.stateDir, INTERSTAGE_PERSONA_FILE: join(sb.repo, "README.md") };
    await activate({ exec: realExec, notify: fakeUi().notify, cwd: sb.repo, env, settings: fakeSettings().port, runtime: createRuntime() });
    expect(env.INTERSTAGE_STATE_DIR).toBe(sb.stateDir);
  });

  test("resumes the newest unfinished mission", async () => {
    const sb = await sandbox();
    const dir = join(sb.stateDir, "missions", "M-004");
    await mkdir(dir, { recursive: true });
    await saveMission(dir, mission({ id: "M-004", status: "paused" }));
    const ui = fakeUi();
    const env: NodeJS.ProcessEnv = { ...sb.env, INTERSTAGE_PERSONA_FILE: join(sb.repo, "README.md") };
    await activate({ exec: realExec, notify: ui.notify, cwd: sb.repo, env, settings: fakeSettings().port, runtime: createRuntime() });
    expect(env.INTERSTAGE_MISSION_ID).toBe("M-004");
    expect(ui.notes[0]?.message).toContain("M-004");
  });

  test("a missing persona file is surfaced once as an error and activation still completes", async () => {
    const sb = await sandbox();
    const ui = fakeUi();
    const runtime = createRuntime();
    const env: NodeJS.ProcessEnv = { ...sb.env, INTERSTAGE_PERSONA_FILE: join(sb.repo, "nope.md") };
    const deps = { exec: realExec, notify: ui.notify, cwd: sb.repo, env, settings: fakeSettings().port, runtime };
    await activate(deps);
    await activate(deps);
    expect(runtime.active).toBe(true);
    expect(ui.notes.filter(n => n.type === "error")).toHaveLength(1);
    expect(ui.notes[0]?.message).toContain("nope.md");
  });
});

describe("activation failures and corrupt missions", () => {
  test("a corrupt mission.json is skipped and the older unfinished mission is resumed", async () => {
    const sb = await sandbox();
    const good = join(sb.stateDir, "missions", "M-001");
    await mkdir(good, { recursive: true });
    await saveMission(good, mission({ id: "M-001", status: "paused" }));
    const bad = join(sb.stateDir, "missions", "M-002");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "mission.json"), "{not json");
    const env: NodeJS.ProcessEnv = { ...sb.env, INTERSTAGE_PERSONA_FILE: join(sb.repo, "README.md") };
    const runtime = createRuntime();
    await activate({ exec: realExec, notify: fakeUi().notify, cwd: sb.repo, env, settings: fakeSettings().port, runtime });
    expect(runtime.active).toBe(true);
    expect(env.INTERSTAGE_MISSION_ID).toBe("M-001");
  });

  test("a corrupt mission.json alone does not stop activation", async () => {
    const sb = await sandbox();
    const bad = join(sb.stateDir, "missions", "M-001");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "mission.json"), "garbage");
    const ui = fakeUi();
    const env: NodeJS.ProcessEnv = { ...sb.env, INTERSTAGE_PERSONA_FILE: join(sb.repo, "README.md") };
    const runtime = createRuntime();
    await onSessionStart({ flag: true, exec: realExec, notify: ui.notify, cwd: sb.repo, env, settings: fakeSettings().port, runtime });
    expect(runtime.active).toBe(true);
    expect(env.INTERSTAGE_MISSION_ID).toBeUndefined();
    expect(ui.notes.filter(n => n.type === "error")).toEqual([]);
  });

  test("when activation throws, the user gets an error saying Interstage is not active and the agents stay hidden", async () => {
    const sb = await sandbox();
    const blocker = join(sb.agentDir, "a-file");
    await writeFile(blocker, "x");
    const ui = fakeUi();
    const { port, overrides } = fakeSettings();
    const runtime = createRuntime();
    const spy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const env: NodeJS.ProcessEnv = { INTERSTAGE_STATE_DIR: join(blocker, "state") };
      await onSessionStart({ flag: true, exec: realExec, notify: ui.notify, cwd: sb.repo, env, settings: port, runtime });
    } finally {
      spy.mockRestore();
    }
    expect(runtime.active).toBe(false);
    expect(ui.notes).toHaveLength(1);
    expect(ui.notes[0]).toMatchObject({ type: "error", message: expect.stringContaining("not active") });
    expect(overrides["task.disabledAgents"]).toEqual([...AGENT_NAMES]);
  });

  test("without the flag the agents are hidden and nothing is announced", async () => {
    const sb = await sandbox();
    const ui = fakeUi();
    const { port, overrides } = fakeSettings();
    await onSessionStart({ flag: false, exec: realExec, notify: ui.notify, cwd: sb.repo, env: {}, settings: port, runtime: createRuntime() });
    expect(overrides["task.disabledAgents"]).toEqual([...AGENT_NAMES]);
    expect(ui.notes).toEqual([]);
  });
});
