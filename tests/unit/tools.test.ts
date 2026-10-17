import { describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ACTION_CALLERS, type MissionToolInput } from "../../plugins/interstage/extension/contracts";
import { executeMission, missionParameters, parseMissionInput, registerMissionTool, type MissionDeps } from "../../plugins/interstage/extension/tools";
import { loadApprovals, loadItems, loadMission, saveItem } from "../../plugins/interstage/extension/state";
import { CLOCK, BLOCKER, BUILD, VERIFY, commitWithSubject, merged, spawned, usageLine, clock, git, realExec, sandbox, tempDir, type Sandbox } from "./support";

const TODO = `# Plan

## T-001: First thing
depends: none
spec: specs/a.md#one
done-when:
- one works

## T-002: Second thing
depends: T-001
spec: specs/a.md#two
done-when:
- two works
`;

function depsFor(sb: Sandbox, caller: string): MissionDeps {
  return { caller, cwd: sb.repo, env: sb.env, exec: realExec, now: clock };
}

async function call(sb: Sandbox, caller: string, input: MissionToolInput) {
  return executeMission(depsFor(sb, caller), input);
}

async function newMission(sb: Sandbox, lane: "fast" | "standard" | "full" = "standard") {
  const result = await call(sb, "houston", { action: "create", title: "Add login", lane, brief: "Add a login page" });
  expect(result.ok).toBe(true);
  return join(sb.stateDir, "missions", sb.env.INTERSTAGE_MISSION_ID ?? "");
}

async function plan(sb: Sandbox, caller = "flight") {
  await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO });
  return call(sb, caller, { action: "plan_set" });
}

describe("parseMissionInput", () => {
  test("rejects unknown actions and missing fields with a one-sentence reason", () => {
    expect(parseMissionInput({ action: "explode" })).toEqual({ error: expect.stringContaining("Unknown action") });
    expect(parseMissionInput({ action: "create", title: "t", lane: "huge", brief: "b" })).toEqual({ error: expect.stringContaining("lane") });
    expect(parseMissionInput({ action: "get", scope: "item" })).toEqual({ error: expect.stringContaining("itemId") });
    expect(parseMissionInput({ action: "approval", op: "resolve", gate: "A", ref: "plan" })).toEqual({ error: expect.stringContaining("status") });
    expect(parseMissionInput({ action: "write_artifact", kind: "evidence", content: "x" })).toEqual({ error: expect.stringContaining("name") });
  });

  test("findings are validated: evidence is required", () => {
    const bad = parseMissionInput({ action: "transition", itemId: "T-001", event: "verify_failed", findings: [{ severity: "blocker", title: "x", evidence: "" }] });
    expect(bad).toEqual({ error: expect.stringContaining("evidence") });
    const good = parseMissionInput({ action: "transition", itemId: "T-001", event: "verify_failed", findings: [BLOCKER] });
    expect("input" in good).toBe(true);
  });

  test("accepts well-formed input for actions without parameters", () => {
    expect(parseMissionInput({ action: "apply_steering" })).toEqual({ input: { action: "apply_steering" } });
    expect(parseMissionInput({ action: "steer", signal: "pause" })).toEqual({ input: { action: "steer", signal: "pause", payload: {} } });
  });
});

describe("caller permissions", () => {
  const CALLERS = ["main", "houston", "flight", "fido", "pogo"];
  const SAMPLES: Record<MissionToolInput["action"], MissionToolInput> = {
    create: { action: "create", title: "t", lane: "fast", brief: "b" },
    plan_set: { action: "plan_set" },
    get: { action: "get", scope: "mission" },
    transition: { action: "transition", itemId: "T-001", event: "start" },
    approval: { action: "approval", op: "request", gate: "A", ref: "plan" },
    steer: { action: "steer", signal: "pause", payload: {} },
    apply_steering: { action: "apply_steering" },
    write_artifact: { action: "write_artifact", kind: "decisions", name: "", content: "x" },
    set_status: { action: "set_status", status: "paused", reason: "r" },
    reset_pogo_loop: { action: "reset_pogo_loop" },
  };

  test("every action is refused for exactly the callers outside ACTION_CALLERS", async () => {
    const sb = await sandbox();
    await newMission(sb);
    // `approval` has per-operation rules and is covered by the next test.
    for (const action of (Object.keys(ACTION_CALLERS) as MissionToolInput["action"][]).filter(name => name !== "approval")) {
      for (const caller of CALLERS) {
        const result = await call(sb, caller, SAMPLES[action]);
        const refused = !result.ok && /cannot (use mission action|request approvals|resolve approvals)/.test(result.text);
        expect([action, caller, refused]).toEqual([action, caller, !ACTION_CALLERS[action].includes(caller)]);
      }
    }
  });

  test("unblock is a transition event for flight and houston, and needs a note", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    await saveItem(dir, { ...(await loadItems(dir))[0]!, state: "blocked", failures: 3 });
    expect("input" in parseMissionInput({ action: "transition", itemId: "T-001", event: "unblock", note: "n" })).toBe(true);
    expect((await call(sb, "flight", { action: "transition", itemId: "T-001", event: "unblock" })).ok).toBe(false);
    expect((await call(sb, "flight", { action: "transition", itemId: "T-001", event: "unblock", note: "user decided" })).ok).toBe(true);
    expect((await loadItems(dir))[0]).toMatchObject({ state: "pending", failures: 0 });
  });

  test("houston may transition only in the fast lane; fido never", async () => {
    const fast = await sandbox();
    await newMission(fast, "fast");
    expect((await call(fast, "houston", { action: "transition", itemId: "T-404", event: "start" })).text).toContain("does not exist");
    expect((await call(fast, "fido", { action: "transition", itemId: "T-404", event: "start" })).text).toContain("only flight, houston can");
    for (const lane of ["standard", "full"] as const) {
      const sb = await sandbox();
      await newMission(sb, lane);
      const refused = await call(sb, "houston", { action: "transition", itemId: "T-404", event: "start" });
      expect(refused).toMatchObject({ ok: false, text: expect.stringContaining("hand the work off to flight") });
      expect((await call(sb, "flight", { action: "transition", itemId: "T-404", event: "start" })).text).toContain("does not exist");
    }
  });

  test("approval requests are houston and flight; resolution is main only", async () => {
    const sb = await sandbox();
    await newMission(sb);
    const request = (caller: string) => call(sb, caller, { action: "approval", op: "request", gate: "A", ref: "plan" });
    const resolve = (caller: string) => call(sb, caller, { action: "approval", op: "resolve", gate: "A", ref: "plan", status: "granted" });
    expect((await request("main")).text).toContain("cannot request");
    expect((await request("houston")).ok).toBe(true);
    expect((await resolve("flight")).text).toContain("cannot resolve");
    expect((await resolve("houston")).text).toContain("cannot resolve");
    expect((await resolve("main")).ok).toBe(true);
  });
});

describe("approval request and autonomy", () => {
  test("allow: the request is persisted as granted with no wait instruction", async () => {
    const sb = await sandbox("autonomy: autopilot\n");
    const dir = await newMission(sb);
    const result = await call(sb, "flight", { action: "approval", op: "request", gate: "D", ref: "npm install" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("granted");
    expect(result.text).toContain("proceed");
    expect(result.next).toBeUndefined();
    expect((await loadApprovals(dir))[0]).toEqual({ gate: "D", ref: "npm install", status: "granted", requestedBy: "flight", requestedAt: CLOCK, resolvedAt: CLOCK, note: "auto-granted: autonomy allows this gate" });
  });

  test("a denied request is an error: do not proceed and do not re-request", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    const dir = await newMission(sb);
    await call(sb, "flight", { action: "approval", op: "request", gate: "D", ref: "npm install" });
    await call(sb, "main", { action: "approval", op: "resolve", gate: "D", ref: "npm install", status: "denied" });
    const again = await call(sb, "flight", { action: "approval", op: "request", gate: "D", ref: "npm install" });
    expect(again).toMatchObject({ ok: false, text: expect.stringContaining("was denied; do not proceed and do not re-request") });
    expect(await loadApprovals(dir)).toHaveLength(1);
  });

  test("approve: stays pending and tells the caller to wait", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    const dir = await newMission(sb);
    const result = await call(sb, "flight", { action: "approval", op: "request", gate: "D", ref: "npm install" });
    expect(result.ok).toBe(true);
    expect(result.next).toContain("wait");
    expect((await loadApprovals(dir))[0]?.status).toBe("pending");
  });

  test("stop: gate G always, and gate F under autopilot with ship deny; nothing is persisted", async () => {
    const sb = await sandbox("autonomy: autopilot\n");
    const dir = await newMission(sb);
    const g = await call(sb, "houston", { action: "approval", op: "request", gate: "G", ref: "breaker" });
    expect(g).toMatchObject({ ok: false, text: expect.stringContaining("stopped") });
    const f = await call(sb, "houston", { action: "approval", op: "request", gate: "F", ref: "git push" });
    expect(f).toMatchObject({ ok: false, text: expect.stringContaining("ship: deny") });
    expect(await loadApprovals(dir)).toEqual([]);
    const ship = await sandbox("autonomy: autopilot\nship: allow\n");
    await newMission(ship);
    expect((await call(ship, "houston", { action: "approval", op: "request", gate: "F", ref: "git push" })).ok).toBe(true);
  });
});

describe("create", () => {
  test("records base branch and sha, creates and switches to mission/<id>-<slug>, exports the id", async () => {
    const sb = await sandbox();
    const baseSha = await git(sb.repo, "rev-parse", "HEAD");
    const result = await call(sb, "houston", { action: "create", title: "Add Login Page!", lane: "standard", brief: "b" });
    expect(result.ok).toBe(true);
    expect(sb.env.INTERSTAGE_MISSION_ID).toBe("M-001");
    expect(await git(sb.repo, "branch", "--show-current")).toBe("mission/M-001-add-login-page");
    const record = await loadMission(join(sb.stateDir, "missions", "M-001"));
    expect(record).toMatchObject({ id: "M-001", branch: "mission/M-001-add-login-page", baseBranch: "main", baseSha, status: "running", autonomy: "checkpoints", pogoLoop: 0, nextSeq: 1, createdAt: CLOCK });
  });

  test("takes the autonomy from the project config", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    await newMission(sb);
    expect((await loadMission(join(sb.stateDir, "missions", "M-001")))?.autonomy).toBe("supervised");
  });

  test("refuses a dirty tree and leaves no mission directory behind", async () => {
    const sb = await sandbox();
    await writeFile(join(sb.repo, "README.md"), "changed\n");
    const result = await call(sb, "houston", { action: "create", title: "t", lane: "fast", brief: "b" });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining("uncommitted changes") });
    expect(await git(sb.repo, "branch", "--show-current")).toBe("main");
    expect(sb.env.INTERSTAGE_MISSION_ID).toBeUndefined();
  });

  test("refuses a detached HEAD", async () => {
    const sb = await sandbox();
    await git(sb.repo, "checkout", "-q", "--detach");
    const result = await call(sb, "houston", { action: "create", title: "t", lane: "fast", brief: "b" });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining("detached") });
  });

  test("refuses outside a git repository", async () => {
    const sb = await sandbox();
    const result = await executeMission({ ...depsFor(sb, "houston"), cwd: await tempDir() }, { action: "create", title: "t", lane: "fast", brief: "b" });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining("not a git repository") });
  });

  test("refuses while another mission is active, but allows a new one after it completes", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    const second = await call(sb, "houston", { action: "create", title: "again", lane: "fast", brief: "b" });
    expect(second).toMatchObject({ ok: false, text: expect.stringContaining("still running") });
    await plan(sb);
    for (const item of await loadItems(dir)) await saveItem(dir, { ...item, state: "done" });
    expect((await call(sb, "main", { action: "set_status", status: "complete", reason: "done" })).ok).toBe(true);
    await git(sb.repo, "switch", "-q", "main");
    expect((await call(sb, "houston", { action: "create", title: "again", lane: "fast", brief: "b" })).ok).toBe(true);
    expect(sb.env.INTERSTAGE_MISSION_ID).toBe("M-002");
  });

  test("a lane disabled in config is refused", async () => {
    const sb = await sandbox("lanes:\n  enabled: [fast, standard]\n  default: standard\n");
    const result = await call(sb, "houston", { action: "create", title: "t", lane: "full", brief: "b" });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining("not enabled") });
  });

  test("a failing git switch removes the claimed mission directory", async () => {
    const sb = await sandbox();
    await git(sb.repo, "branch", "mission/M-001-t");
    const result = await call(sb, "houston", { action: "create", title: "t", lane: "fast", brief: "b" });
    expect(result.ok).toBe(false);
    expect(await Bun.file(join(sb.stateDir, "missions", "M-001", "mission.json")).exists()).toBe(false);
  });
});

describe("plan_set", () => {
  test("creates pending items from a valid TODO", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    const result = await plan(sb);
    expect(result.ok).toBe(true);
    const items = await loadItems(dir);
    expect(items.map(i => [i.id, i.state, i.depends])).toEqual([["T-001", "pending", []], ["T-002", "pending", ["T-001"]]]);
    expect(items[0]).toMatchObject({ spec: "specs/a.md#one", doneWhen: ["one works"] });
  });

  test("an invalid TODO is rejected with the validator's message and applies nothing", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: "## T-001: x\ndepends: T-404\n" });
    const result = await call(sb, "flight", { action: "plan_set" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("T-404");
    expect(await loadItems(dir)).toEqual([]);
  });

  test("replaces pending items but keeps started ones and the planner round count", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    await saveItem(dir, { ...(await loadItems(dir))[0]!, state: "building", title: "started" });
    await saveItem(dir, { ...(await loadItems(dir))[1]!, plannerRounds: 1 });
    await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO.replace("Second thing", "Second thing, revised").replace("First thing", "First, revised") });
    const result = await call(sb, "flight", { action: "plan_set" });
    expect(result.ok).toBe(true);
    const items = await loadItems(dir);
    expect(items[0]).toMatchObject({ state: "building", title: "started" });
    expect(items[1]).toMatchObject({ state: "pending", title: "Second thing, revised", plannerRounds: 1 });
  });

  test("refreshes definitions of pending, failed, planning and blocked items, keeping state and counters", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    const base = (await loadItems(dir))[0]!;
    for (const state of ["pending", "failed", "planning", "blocked"] as const) {
      await saveItem(dir, { ...base, state, failures: 2, plannerRounds: 1, conflicts: 1, commit: "c0", findings: [BLOCKER], history: [{ at: CLOCK, event: "start", from: "pending", to: "building" }] });
      await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO.replace("First thing", `First ${state}`).replace("one works", `one works ${state}`) });
      const result = await call(sb, "flight", { action: "plan_set" });
      expect(result.ok).toBe(true);
      expect((await loadItems(dir))[0]).toMatchObject({ state, title: `First ${state}`, doneWhen: [`one works ${state}`], failures: 2, plannerRounds: 1, conflicts: 1, commit: "c0", findings: [BLOCKER] });
      expect((await loadItems(dir))[0]?.history).toHaveLength(1);
    }
  });

  test("never touches building, verifying, integrating or done items, and reports them as skipped", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    const base = (await loadItems(dir))[0]!;
    for (const state of ["building", "verifying", "integrating", "done"] as const) {
      await saveItem(dir, { ...base, state, title: "original" });
      await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO.replace("First thing", "Changed") });
      const result = await call(sb, "flight", { action: "plan_set" });
      expect(result.text).toContain(`T-001 (${state})`);
      expect((await loadItems(dir))[0]).toMatchObject({ state, title: "original" });
    }
  });

  test("removes pending, failed, planning and blocked items that left the TODO, keeps the others and reports them", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    const extra = (id: string) => `\n## ${id}: Extra ${id}\ndepends: none\nspec: specs/a.md\ndone-when:\n- ok\n`;
    const states = { "T-003": "pending", "T-004": "failed", "T-005": "planning", "T-006": "blocked", "T-007": "building", "T-008": "verifying", "T-009": "integrating", "T-010": "done" } as const;
    await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO + Object.keys(states).map(extra).join("") });
    expect((await call(sb, "flight", { action: "plan_set" })).ok).toBe(true);
    for (const [id, state] of Object.entries(states)) await saveItem(dir, { ...(await loadItems(dir)).find(i => i.id === id)!, state });
    await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO });
    const result = await call(sb, "flight", { action: "plan_set" });
    expect(result.ok).toBe(true);
    expect((await loadItems(dir)).map(i => i.id)).toEqual(["T-001", "T-002", "T-007", "T-008", "T-009", "T-010"]);
    expect(result.text).toContain("4 removed");
    for (const id of ["T-007", "T-008", "T-009", "T-010"]) expect(result.text).toContain(`${id} (`);
  });

  test("refuses a plan that deletes an item an already started item depends on", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    await saveItem(dir, { ...(await loadItems(dir)).find(i => i.id === "T-002")!, state: "building" });
    const replacement = "## T-003: Replacement\ndepends: none\nspec: specs/a.md\ndone-when:\n- ok\n";
    await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: replacement });
    const result = await call(sb, "flight", { action: "plan_set" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("T-002");
    expect(result.text).toContain("still depends");
    expect((await loadItems(dir)).map(i => i.id)).toEqual(["T-001", "T-002"]);
  });

  test("a planned item that depends on an id missing from the TODO is already rejected by validation", async () => {
    const sb = await sandbox();
    await newMission(sb);
    await call(sb, "houston", { action: "write_artifact", kind: "todo", name: "", content: TODO.slice(TODO.indexOf("## T-002")) });
    expect((await call(sb, "flight", { action: "plan_set" })).text).toContain("depends on unknown T-001");
  });

  test("a todoPath outside the mission directory is rejected", async () => {
    const sb = await sandbox();
    await newMission(sb);
    await writeFile(join(sb.repo, "TODO.md"), TODO);
    expect((await call(sb, "flight", { action: "plan_set", todoPath: join(sb.repo, "TODO.md") })).ok).toBe(false);
    expect((await call(sb, "flight", { action: "plan_set", todoPath: "../../../TODO.md" })).ok).toBe(false);
  });

  test("gate B: supervised plans wait for a granted approval and are then applied", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    const dir = await newMission(sb);
    const first = await plan(sb);
    expect(first).toMatchObject({ ok: false, text: expect.stringContaining("not applied") });
    expect(await loadItems(dir)).toEqual([]);
    const [pending] = await loadApprovals(dir);
    expect(pending).toMatchObject({ gate: "B", status: "pending", requestedBy: "flight" });
    expect(pending?.ref).toMatch(/^todo:[0-9a-f]{8}$/);
    await call(sb, "flight", { action: "plan_set" });
    expect(await loadApprovals(dir)).toHaveLength(1);
    await call(sb, "main", { action: "approval", op: "resolve", gate: "B", ref: pending?.ref ?? "", status: "granted" });
    expect((await call(sb, "flight", { action: "plan_set" })).ok).toBe(true);
    expect(await loadItems(dir)).toHaveLength(2);
  });

  test("gate B: a denied revision is reported, and checkpoints apply without approval", async () => {
    const sb = await sandbox("autonomy: supervised\n");
    const dir = await newMission(sb);
    await plan(sb);
    const [pending] = await loadApprovals(dir);
    await call(sb, "main", { action: "approval", op: "resolve", gate: "B", ref: pending?.ref ?? "", status: "denied" });
    expect((await call(sb, "flight", { action: "plan_set" })).text).toContain("denied");

    const open = await sandbox();
    await newMission(open);
    expect((await plan(open)).ok).toBe(true);
  });
});

describe("transition through the tool", () => {
  test("walks an item from start to done with gate A granted under checkpoints", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    const t = (itemId: string, event: Extract<MissionToolInput, { action: "transition" }>["event"], extra = {}) =>
      call(sb, "flight", { action: "transition", itemId, event, ...extra });
    const refused = await t("T-001", "start");
    expect(refused).toMatchObject({ ok: false, next: expect.stringContaining("approval A") });
    await call(sb, "flight", { action: "approval", op: "request", gate: "A", ref: "plan" });
    await call(sb, "main", { action: "approval", op: "resolve", gate: "A", ref: "plan", status: "granted" });
    expect((await t("T-001", "start")).ok).toBe(true);
    expect((await t("T-002", "start")).text).toContain("T-001");
    await spawned(dir, ...BUILD, ...VERIFY);
    expect((await t("T-001", "builder_done")).ok).toBe(true);
    expect((await t("T-001", "verify_clean", { findings: [] })).ok).toBe(true);
    await merged(dir, "T-001");
    const sha = await commitWithSubject(sb.repo, "T-001: First thing");
    const done = await t("T-001", "integrate_ok", { commit: sha });
    expect(done.ok).toBe(true);
    expect((await loadItems(dir))[0]).toMatchObject({ state: "done", commit: sha });
    expect((await loadItems(dir))[0]?.history.every(h => h.at === CLOCK)).toBe(true);
  });

  test("a breaker trip persists a halted mission that only main can resume, and resuming resets the count", async () => {
    const sb = await sandbox("autonomy: autopilot\nbreaker:\n  consecutiveFailures: 1\n");
    const dir = await newMission(sb);
    await plan(sb);
    await call(sb, "flight", { action: "transition", itemId: "T-001", event: "start" });
    await spawned(dir, ...BUILD);
    const failed = await call(sb, "flight", { action: "transition", itemId: "T-001", event: "builder_failed" });
    expect(failed.text).toContain("circuit breaker");
    expect((await loadMission(dir))?.status).toBe("halted");
    const byFlight = await call(sb, "flight", { action: "set_status", status: "running", reason: "try again" });
    expect(byFlight).toMatchObject({ ok: false, text: expect.stringContaining("only CAPCOM") });
    expect((await call(sb, "main", { action: "set_status", status: "running", reason: "human approved" })).ok).toBe(true);
    expect(await loadMission(dir)).toMatchObject({ status: "running", breaker: { consecutiveFailures: 0 } });
  });

  test("a halted mission cannot be moved by flight or houston through paused, running, complete or aborted", async () => {
    const sb = await sandbox("autonomy: autopilot\nbreaker:\n  consecutiveFailures: 1\n");
    const dir = await newMission(sb);
    await plan(sb);
    await call(sb, "flight", { action: "transition", itemId: "T-001", event: "start" });
    await spawned(dir, ...BUILD);
    await call(sb, "flight", { action: "transition", itemId: "T-001", event: "builder_failed" });
    for (const caller of ["flight", "houston"]) {
      for (const status of ["paused", "running", "complete"] as const) {
        const result = await call(sb, caller, { action: "set_status", status, reason: "detour" });
        expect([caller, status, result.ok]).toEqual([caller, status, false]);
      }
    }
    expect((await loadMission(dir))?.status).toBe("halted");
    expect((await call(sb, "flight", { action: "set_status", status: "halted", reason: "still halted" })).ok).toBe(true);
    expect((await call(sb, "main", { action: "set_status", status: "paused", reason: "human" })).ok).toBe(true);
    expect((await call(sb, "flight", { action: "set_status", status: "running", reason: "paused missions can be resumed" })).ok).toBe(true);
  });

  test("a mission over its token budget refuses start", async () => {
    const sb = await sandbox("autonomy: autopilot\nbudgets:\n  missionTokens: 10\n");
    const dir = await newMission(sb);
    await plan(sb);
    await writeFile(join(dir, "usage.jsonl"), usageLine("main", 50, { kind: "main" }));
    const result = await call(sb, "flight", { action: "transition", itemId: "T-001", event: "start" });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining("budget") });
  });
});

describe("process evidence (credits)", () => {
  async function building(sb: Sandbox, lane: "fast" | "standard" = "standard") {
    const dir = await newMission(sb, lane);
    await plan(sb);
    const t = (itemId: string, event: Extract<MissionToolInput, { action: "transition" }>["event"], extra = {}, caller = "flight") =>
      call(sb, caller, { action: "transition", itemId, event, ...extra });
    await call(sb, "flight", { action: "approval", op: "request", gate: "A", ref: "plan" });
    await call(sb, "main", { action: "approval", op: "resolve", gate: "A", ref: "plan", status: "granted" });
    expect((await t("T-001", "start")).ok).toBe(true);
    return { dir, t };
  }

  test("builder_done and builder_failed are refused with no executor spawn, and name what to spawn", async () => {
    const sb = await sandbox();
    const { dir, t } = await building(sb);
    for (const event of ["builder_done", "builder_failed"] as const) {
      const refused = await t("T-001", event);
      expect(refused.ok).toBe(false);
      expect(refused.text).toContain("curiosity");
      expect(refused.text).toContain("spawn the executor");
    }
    expect((await loadItems(dir))[0]?.state).toBe("building");
    await spawned(dir, "go-no-go", "inspector", "kessler");
    expect((await t("T-001", "builder_done")).ok).toBe(false);
  });

  test("each executor type earns a builder result, once", async () => {
    for (const agent of ["curiosity", "perseverance", "orbiter", "tiger-team", "golden-record", "booster"]) {
      const sb = await sandbox();
      const { dir, t } = await building(sb);
      await spawned(dir, agent);
      expect([agent, (await t("T-001", "builder_done")).ok]).toEqual([agent, true]);
    }
  });

  test("verify_clean needs both go-no-go and inspector; a single one is refused naming the missing one", async () => {
    const sb = await sandbox();
    const { dir, t } = await building(sb);
    await spawned(dir, ...BUILD);
    await t("T-001", "builder_done");
    await spawned(dir, "go-no-go");
    const refused = await t("T-001", "verify_clean", { findings: [] });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain("inspector");
    expect(refused.text).not.toContain("go-no-go spawn and");
    await spawned(dir, "inspector");
    expect((await t("T-001", "verify_clean", { findings: [] })).ok).toBe(true);
  });

  test("credits are consumed: one verification pair covers one verify result, a second needs a new pair", async () => {
    const sb = await sandbox();
    const { dir, t } = await building(sb);
    await spawned(dir, ...BUILD, ...VERIFY);
    await t("T-001", "builder_done");
    expect((await t("T-001", "verify_failed", { findings: [BLOCKER] })).ok).toBe(true);
    expect((await t("T-001", "retry")).ok).toBe(true);
    await spawned(dir, ...BUILD);
    await t("T-001", "builder_done");
    const second = await t("T-001", "verify_clean", { findings: [] });
    expect(second).toMatchObject({ ok: false, text: expect.stringContaining("go-no-go and one unused inspector") });
    await spawned(dir, ...VERIFY);
    expect((await t("T-001", "verify_clean", { findings: [] })).ok).toBe(true);
  });

  test("credits are counted over the whole mission, not per item", async () => {
    const sb = await sandbox("autonomy: autopilot\n");
    const { dir, t } = await building(sb);
    await spawned(dir, ...BUILD);
    await t("T-001", "builder_done");
    await t("T-001", "verify_clean", { findings: [] }).then(r => expect(r.ok).toBe(false));
    await spawned(dir, ...VERIFY);
    await t("T-001", "verify_clean", { findings: [] });
    await t("T-002", "start").then(r => expect(r.ok).toBe(false));
    await spawned(dir, ...BUILD);
    await merged(dir, "T-001");
    await t("T-001", "integrate_ok", { commit: await commitWithSubject(sb.repo, "T-001: First thing") });
    expect((await t("T-002", "start")).ok).toBe(true);
    expect((await t("T-002", "builder_done")).ok).toBe(true);
    expect((await t("T-002", "verify_clean", { findings: [] })).ok).toBe(false);
  });

  describe("integrate_ok", () => {
    async function integrating(sb: Sandbox, lane: "fast" | "standard" = "standard") {
      const { dir, t } = await building(sb, lane);
      await spawned(dir, ...BUILD, ...VERIFY);
      await t("T-001", "builder_done");
      await t("T-001", "verify_clean", { findings: [] });
      return { dir, t };
    }

    test("is refused without a recorded merge, naming the merge to run", async () => {
      const sb = await sandbox();
      const { t } = await integrating(sb);
      const sha = await commitWithSubject(sb.repo, "T-001: First thing");
      const refused = await t("T-001", "integrate_ok", { commit: sha });
      expect(refused.ok).toBe(false);
      expect(refused.text).toContain("git merge");
      expect(refused.text).toContain("omp/task/T-001");
    });

    test("is refused when the merge was for another item or predates builder_done", async () => {
      const sb = await sandbox();
      const { dir, t } = await integrating(sb);
      const sha = await commitWithSubject(sb.repo, "T-001: First thing");
      await merged(dir, "T-002");
      await merged(dir, "T-001", "2029-12-31T23:59:59.000Z");
      expect((await t("T-001", "integrate_ok", { commit: sha })).ok).toBe(false);
      await merged(dir, "T-001");
      expect((await t("T-001", "integrate_ok", { commit: sha })).ok).toBe(true);
    });

    test("is refused for a commit that does not exist, is not an id, or has the wrong subject", async () => {
      const sb = await sandbox();
      const { dir, t } = await integrating(sb);
      await merged(dir, "T-001");
      const wrong = await commitWithSubject(sb.repo, "T-002: other work");
      const noPrefix = await commitWithSubject(sb.repo, "T-001 First thing");
      for (const [commit, expected] of [["deadbeefdeadbeef", "does not exist"], ["HEAD", "not a commit id"], ["--all", "not a commit id"], [wrong, "does not start with"], [noPrefix, "does not start with"]] as const) {
        const refused = await t("T-001", "integrate_ok", { commit });
        expect([commit, refused.ok, refused.text.includes(expected)]).toEqual([commit, false, true]);
      }
      expect((await loadItems(dir))[0]?.state).toBe("integrating");
      expect((await t("T-001", "integrate_ok", { commit: await commitWithSubject(sb.repo, "T-001: First thing") })).ok).toBe(true);
    });

    test("fast-lane houston is held to the same rules", async () => {
      const sb = await sandbox();
      const { dir, t } = await integrating(sb, "fast");
      const sha = await commitWithSubject(sb.repo, "T-001: First thing");
      expect((await t("T-001", "integrate_ok", { commit: sha }, "houston")).ok).toBe(false);
      await merged(dir, "T-001");
      expect((await t("T-001", "integrate_ok", { commit: sha }, "houston")).ok).toBe(true);
    });
  });

  test("start, retry, unblock, planner_* and integrate_conflict need no credits", async () => {
    const sb = await sandbox();
    const { dir, t } = await building(sb);
    await spawned(dir, ...BUILD, ...VERIFY);
    await t("T-001", "builder_done");
    await t("T-001", "verify_clean", { findings: [] });
    expect((await t("T-001", "integrate_conflict")).ok).toBe(true);
    await saveItem(dir, { ...(await loadItems(dir))[0]!, state: "planning" });
    expect((await t("T-001", "planner_revised")).ok).toBe(true);
    await saveItem(dir, { ...(await loadItems(dir))[0]!, state: "planning" });
    expect((await t("T-001", "planner_blocked")).ok).toBe(true);
    expect((await t("T-001", "unblock", { note: "user decided" })).ok).toBe(true);
    await saveItem(dir, { ...(await loadItems(dir))[0]!, state: "failed", failures: 1 });
    expect((await t("T-001", "start")).ok).toBe(false);
    expect((await t("T-001", "retry")).ok).toBe(true);
  });
});

describe("set_status complete", () => {
  const complete = (sb: Sandbox, caller = "main") => call(sb, caller, { action: "set_status", status: "complete", reason: "all done" });

  test("is refused for a mission with no items", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    const refused = await complete(sb);
    expect(refused).toMatchObject({ ok: false, text: expect.stringContaining("no items") });
    expect((await loadMission(dir))?.status).toBe("running");
  });

  test("is refused while any item is open, listing each with its state", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    const [first] = await loadItems(dir);
    await saveItem(dir, { ...first!, state: "done" });
    const refused = await complete(sb, "flight");
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain("T-002 (pending)");
    expect(refused.text).not.toContain("T-001");
    expect(refused.text).toContain("plan_set");
    expect(refused.text).toContain("pause");
    expect((await loadMission(dir))?.status).toBe("running");
  });

  test("is allowed when every item is done, and the mission is then complete", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    for (const item of await loadItems(dir)) await saveItem(dir, { ...item, state: "done" });
    expect((await complete(sb, "houston")).ok).toBe(true);
    expect((await loadMission(dir))?.status).toBe("complete");
  });

  test("a blocked item still keeps the mission from completing; pausing is unaffected", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    await plan(sb);
    for (const item of await loadItems(dir)) await saveItem(dir, { ...item, state: item.id === "T-001" ? "done" : "blocked" });
    expect((await complete(sb)).text).toContain("T-002 (blocked)");
    expect((await call(sb, "flight", { action: "set_status", status: "paused", reason: "report" })).ok).toBe(true);
  });
});

describe("get, steering, artifacts, pogo", () => {
  test("get covers every scope and the budget view reports budget_exceeded for Pogo", async () => {
    const sb = await sandbox("budgets:\n  pogoLoopTokens: 5\n");
    const dir = await newMission(sb);
    await plan(sb);
    const scopes = await Promise.all((["mission", "items", "approvals", "budget"] as const).map(scope => call(sb, "main", { action: "get", scope })));
    expect(scopes.every(r => r.ok)).toBe(true);
    expect((await call(sb, "main", { action: "get", scope: "item", itemId: "T-001" })).data).toMatchObject({ id: "T-001" });
    expect((await call(sb, "main", { action: "get", scope: "item", itemId: "T-404" })).ok).toBe(false);
    await writeFile(join(dir, "usage.jsonl"), usageLine("pogo", 9, { mission: "M-001", pogoLoop: 0, cacheRead: 4_000_000 }));
    const budget = await call(sb, "flight", { action: "get", scope: "budget" });
    expect(budget.text).toContain("budget_exceeded");
    expect(budget.text).toContain("cache reads excluded");
    expect(budget.data).toMatchObject({ budget_exceeded: "pogo", pogoUsed: 9 });
    await call(sb, "houston", { action: "reset_pogo_loop" });
    expect((await call(sb, "flight", { action: "get", scope: "budget" })).data).toMatchObject({ pogoLoop: 1, pogoUsed: 0, budget_exceeded: undefined });
  });

  test("the budget view reports cache reads separately and never counts them", async () => {
    const sb = await sandbox("budgets:\n  missionTokens: 100\n  pogoLoopTokens: 100\n");
    const dir = await newMission(sb);
    await writeFile(join(dir, "usage.jsonl"), usageLine("main", 40, { kind: "main", cacheRead: 7_000_000 }));
    const view = await call(sb, "main", { action: "get", scope: "budget" });
    expect(view.text).toContain("40 billable tokens (cache reads excluded");
    expect(view.text).toContain("7000000");
    expect(view.data).toMatchObject({ missionUsed: 40, missionExceeded: false, cacheReads: 7_000_000 });
  });

  test("steer then apply_steering delivers interrupt first and empties the queue", async () => {
    const sb = await sandbox();
    await newMission(sb);
    await call(sb, "main", { action: "steer", signal: "redirect", payload: { to: "x" } });
    await call(sb, "houston", { action: "steer", signal: "interrupt", payload: {} });
    const applied = await call(sb, "flight", { action: "apply_steering" });
    expect((applied.data as { signal: string; from: string }[]).map(p => `${p.signal}:${p.from}`)).toEqual(["interrupt:houston", "redirect:main"]);
    expect((await call(sb, "flight", { action: "apply_steering" })).data).toEqual([]);
  });

  test("write_artifact stays inside the mission directory", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    const bad = await call(sb, "flight", { action: "write_artifact", kind: "evidence", name: "../../outside.md", content: "x" });
    expect(bad.ok).toBe(false);
    expect(await Bun.file(join(sb.stateDir, "outside.md")).exists()).toBe(false);
    expect((await call(sb, "flight", { action: "write_artifact", kind: "evidence", name: "T-001/run.md", content: "ok" })).ok).toBe(true);
    expect(await readFile(join(dir, "evidence", "T-001", "run.md"), "utf8")).toBe("ok");
    await call(sb, "flight", { action: "write_artifact", kind: "decisions", name: "", content: "chose A" });
    await call(sb, "flight", { action: "write_artifact", kind: "decisions", name: "", content: "chose B" });
    expect(await readFile(join(dir, "decisions.md"), "utf8")).toBe("chose A\nchose B\n");
  });

  test("write_artifact rejects a symlink inside the mission directory that points outside it", async () => {
    const sb = await sandbox();
    const dir = await newMission(sb);
    const outside = await tempDir();
    await mkdir(join(dir, "evidence"), { recursive: true });
    await symlink(outside, join(dir, "evidence", "link"));
    await symlink(join(outside, "not-yet.md"), join(dir, "evidence", "dangling.md"));
    for (const name of ["link/x.md", "link/new/deep.md", "dangling.md"]) {
      const result = await call(sb, "flight", { action: "write_artifact", kind: "evidence", name, content: "x" });
      expect([name, result.ok]).toEqual([name, false]);
    }
    expect(await Bun.file(join(outside, "x.md")).exists()).toBe(false);
    expect(await Bun.file(join(outside, "not-yet.md")).exists()).toBe(false);
    await mkdir(join(dir, "evidence", "real"));
    await symlink(join(dir, "evidence", "real"), join(dir, "evidence", "inside"));
    expect((await call(sb, "flight", { action: "write_artifact", kind: "evidence", name: "inside/ok.md", content: "x" })).ok).toBe(true);
  });

  test("without an active mission everything but create explains what to do", async () => {
    const sb = await sandbox();
    const result = await call(sb, "flight", { action: "get", scope: "mission" });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining("no active mission") });
  });
});

describe("tool parameter schema with OMP's real zod", () => {
  async function schema() {
    const registry = Bun.fileURLToPath(import.meta.resolve("@oh-my-pi/pi-coding-agent/config/registry"));
    const zod = await import(Bun.resolveSync("@oh-my-pi/omptype/zod", registry));
    return missionParameters(zod as never) as unknown as { safeParse(input: unknown): { success: boolean } };
  }

  test("accepts every action and event (including unblock) and rejects unknown values", async () => {
    const parameters = await schema();
    for (const action of Object.keys(ACTION_CALLERS)) expect([action, parameters.safeParse({ action }).success]).toEqual([action, true]);
    expect(parameters.safeParse({ action: "transition", itemId: "T-001", event: "unblock", note: "n" }).success).toBe(true);
    expect(parameters.safeParse({ action: "explode" }).success).toBe(false);
    expect(parameters.safeParse({ action: "transition", itemId: "T-001", event: "teleport" }).success).toBe(false);
    expect(parameters.safeParse({ action: "get", scope: "everything" }).success).toBe(false);
    expect(parameters.safeParse({ action: "steer", signal: "pause", payload: { a: 1 } }).success).toBe(true);
    expect(parameters.safeParse({}).success).toBe(false);
  });
});

describe("registration", () => {
  function fakePi() {
    const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
    const tools: { name: string; execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; isError?: boolean }> }[] = [];
    const pi = { zod: chain, exec: realExec, registerTool: (tool: (typeof tools)[number]) => tools.push(tool) };
    return { pi, tools };
  }

  test("registers one `mission` tool; the main session is caller `main`, subagents use their name, errors are results", async () => {
    const { pi, tools } = fakePi();
    registerMissionTool(pi as never);
    expect(tools.map(t => t.name)).toEqual(["mission"]);
    const sb = await sandbox();
    Object.assign(process.env, sb.env);
    try {
      const run = (agent: { kind: string; name: string }, params: Record<string, unknown>) =>
        tools[0]!.execute("id", params, undefined, undefined, { agent, cwd: sb.repo });
      const refused = await run({ kind: "sub", name: "fido" }, { action: "get", scope: "mission" });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toContain("fido cannot use mission action get");
      const invalid = await run({ kind: "main", name: "main" }, { action: "get" });
      expect(invalid.isError).toBe(true);
      const created = await run({ kind: "sub", name: "houston" }, { action: "create", title: "x", lane: "fast", brief: "b" });
      expect(created.isError).toBeFalsy();
      const read = await run({ kind: "main", name: "main" }, { action: "get", scope: "mission" });
      expect(read.content[0]?.text).toContain("Mission M-001 is running");
    } finally {
      delete process.env.INTERSTAGE_STATE_DIR;
      delete process.env.INTERSTAGE_MISSION_ID;
      delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});
