import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApplyInput,
  type ApplyResult,
  allocateMission,
  appendUsage,
  applyEvent,
  artifactPath,
  findActiveMission,
  loadItems,
  loadMission,
  loadUsage,
  readJson,
  resolveInside,
  saveItem,
  saveMission,
  slugify,
  withMissionLock,
  writeArtifact,
  writeFileAtomic,
  writeJson,
} from "../../plugins/interstage/extension/state";
import type { Approval, ItemEvent, ItemRecord } from "../../plugins/interstage/extension/contracts";
import { BLOCKER, CLOCK, MINOR, applyCtx, granted, item, mission, tempDir } from "./support";

function apply(items: ItemRecord[], itemId: string, event: ItemEvent, extra: Partial<ApplyInput> = {}, ctx = applyCtx(items)) {
  return applyEvent(ctx, { itemId, event, ...extra });
}

const stateOf = (result: ApplyResult, id: string) => result.items.find(i => i.id === id)?.state;

describe("start", () => {
  test("moves pending to building and stamps the history from the clock", () => {
    const result = apply([item("T-001")], "T-001", "start", { note: "go" });
    expect(result.ok).toBe(true);
    expect(stateOf(result, "T-001")).toBe("building");
    expect(result.items[0]?.history).toEqual([{ at: CLOCK, event: "start", from: "pending", to: "building", note: "go" }]);
    expect(result.next).toContain("T-001");
  });

  test("does not mutate its input", () => {
    const items = [item("T-001")];
    const before = structuredClone(items);
    apply(items, "T-001", "start");
    expect(items).toEqual(before);
  });

  test("waits for every dependency to be done", () => {
    const items = [item("T-001", { state: "verifying" }), item("T-002", { depends: ["T-001"] })];
    const result = apply(items, "T-002", "start");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("T-001");
    expect(stateOf(apply([item("T-001", { state: "done" }), item("T-002", { depends: ["T-001"] })], "T-002", "start"), "T-002")).toBe("building");
  });

  test("is refused unless the mission is running", () => {
    for (const status of ["paused", "halted", "complete", "aborted"] as const) {
      const result = apply([item("T-001")], "T-001", "start", {}, applyCtx([item("T-001")], { mission: mission({ status }) }));
      expect(result.ok).toBe(false);
      expect(result.text).toContain(status);
    }
  });

  test("respects the parallel slots (building + verifying + integrating)", () => {
    const items = [item("T-001", { state: "building" }), item("T-002", { state: "verifying" }), item("T-003", { state: "integrating" }), item("T-004")];
    const ctx = applyCtx(items);
    ctx.config = { ...ctx.config, parallel: { worktrees: 3 } };
    expect(apply(items, "T-004", "start", {}, ctx).ok).toBe(false);
    ctx.config = { ...ctx.config, parallel: { worktrees: 4 } };
    expect(apply(items, "T-004", "start", {}, ctx).ok).toBe(true);
  });

  test("failed, planning, done and blocked items do not hold a slot", () => {
    const items = [item("T-001", { state: "failed" }), item("T-002", { state: "planning" }), item("T-003", { state: "done" }), item("T-004", { state: "blocked" }), item("T-005")];
    const ctx = applyCtx(items);
    ctx.config = { ...ctx.config, parallel: { worktrees: 1 } };
    expect(apply(items, "T-005", "start", {}, ctx).ok).toBe(true);
  });

  test("is refused when the mission token budget is exceeded", () => {
    const items = [item("T-001")];
    const result = apply(items, "T-001", "start", {}, applyCtx(items, { budget: { missionExceeded: true } }));
    expect(result.ok).toBe(false);
    expect(result.text).toContain("budget");
  });

  test("gate A: supervised and checkpoints need the plan approval, autopilot does not", () => {
    const items = [item("T-001")];
    for (const autonomy of ["supervised", "checkpoints"] as const) {
      const denied = apply(items, "T-001", "start", {}, applyCtx(items, { mission: mission({ autonomy }) }));
      expect(denied.ok).toBe(false);
      expect(denied.next).toContain("approval A");
      const allowed = apply(items, "T-001", "start", {}, applyCtx(items, { mission: mission({ autonomy }), approvals: [granted("A", "plan")] }));
      expect(allowed.ok).toBe(true);
    }
    expect(apply(items, "T-001", "start").ok).toBe(true);
  });

  test("a pending or denied approval does not satisfy gate A", () => {
    const items = [item("T-001")];
    const approvals = [{ ...granted("A", "plan"), status: "pending" as const }, { ...granted("A", "plan"), status: "denied" as const }];
    expect(apply(items, "T-001", "start", {}, applyCtx(items, { mission: mission({ autonomy: "supervised" }), approvals })).ok).toBe(false);
  });
});

describe("building, verifying", () => {
  test("builder_done moves building to verifying", () => {
    expect(stateOf(apply([item("T-001", { state: "building" })], "T-001", "builder_done"), "T-001")).toBe("verifying");
  });

  test("an event from the wrong state is refused and changes nothing", () => {
    const result = apply([item("T-001")], "T-001", "builder_done");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("pending");
    expect(apply([item("T-001")], "T-404", "start").ok).toBe(false);
  });

  test("verify_clean accepts minor and nit findings but not blockers or majors", () => {
    const items = [item("T-001", { state: "verifying" })];
    const clean = apply(items, "T-001", "verify_clean", { findings: [MINOR] });
    expect(stateOf(clean, "T-001")).toBe("integrating");
    expect(apply(items, "T-001", "verify_clean", { findings: [BLOCKER] }).ok).toBe(false);
    expect(apply(items, "T-001", "verify_clean", { findings: [{ ...BLOCKER, severity: "major" }] }).ok).toBe(false);
  });

  test("verify_failed needs a blocker or major, stores findings, counts a failure and a breaker step", () => {
    const items = [item("T-001", { state: "verifying" })];
    expect(apply(items, "T-001", "verify_failed", { findings: [MINOR] }).ok).toBe(false);
    const result = apply(items, "T-001", "verify_failed", { findings: [BLOCKER, MINOR] });
    expect(stateOf(result, "T-001")).toBe("failed");
    expect(result.items[0]?.failures).toBe(1);
    expect(result.items[0]?.findings).toEqual([BLOCKER, MINOR]);
    expect(result.mission.breaker.consecutiveFailures).toBe(1);
    expect(result.next).toBe("retry T-001");
  });

  test("builder_failed counts a failure and a breaker step", () => {
    const result = apply([item("T-001", { state: "building" })], "T-001", "builder_failed");
    expect(result.items[0]).toMatchObject({ state: "failed", failures: 1 });
    expect(result.mission.breaker.consecutiveFailures).toBe(1);
  });
});

describe("failure escalation", () => {
  const failing = (failures: number, plannerRounds: number) => [item("T-001", { state: "building", failures, plannerRounds })];

  test("retry returns failed to building while failures are below three", () => {
    const result = apply([item("T-001", { state: "failed", failures: 2 })], "T-001", "retry");
    expect(stateOf(result, "T-001")).toBe("building");
    expect(apply([item("T-001", { state: "failed", failures: 3 })], "T-001", "retry").ok).toBe(false);
  });

  test("retry honors the slot and mission guards", () => {
    const items = [item("T-001", { state: "failed", failures: 1 })];
    expect(apply(items, "T-001", "retry", {}, applyCtx(items, { mission: mission({ status: "paused" }) })).ok).toBe(false);
  });

  test("the third failure escalates to planning in the same call when no planner round was used", () => {
    const result = apply(failing(2, 0), "T-001", "builder_failed");
    expect(result.items[0]).toMatchObject({ state: "planning", failures: 3 });
    expect(result.items[0]?.history.map(h => h.event)).toEqual(["builder_failed", "auto_escalate"]);
    expect(result.next).toContain("fido as the planner");
  });

  test("the third failure still escalates after one planner round", () => {
    expect(stateOf(apply(failing(2, 1), "T-001", "builder_failed"), "T-001")).toBe("planning");
  });

  test("after two planner rounds the third failure blocks the item", () => {
    const result = apply(failing(2, 2), "T-001", "builder_failed");
    expect(result.items[0]).toMatchObject({ state: "blocked", failures: 3 });
    expect(result.items[0]?.history.at(-1)?.event).toBe("auto_block");
  });

  test("a verification failure escalates the same way", () => {
    const items = [item("T-001", { state: "verifying", failures: 2, plannerRounds: 2 })];
    expect(stateOf(apply(items, "T-001", "verify_failed", { findings: [BLOCKER] }), "T-001")).toBe("blocked");
  });

  test("planner_revised resets failures and counts the round; planner_blocked blocks", () => {
    const revised = apply([item("T-001", { state: "planning", failures: 3, plannerRounds: 1 })], "T-001", "planner_revised");
    expect(revised.items[0]).toMatchObject({ state: "pending", failures: 0, plannerRounds: 2 });
    expect(stateOf(apply([item("T-001", { state: "planning" })], "T-001", "planner_blocked"), "T-001")).toBe("blocked");
  });

  test("two planner rounds then a third failure block: the full path", () => {
    let items = [item("T-001", { state: "building" })];
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 3; i++) {
        if (i > 0) items = apply(items, "T-001", "retry", {}, applyCtx(items, { mission: mission({ breaker: { consecutiveFailures: 0 } }) })).items;
        items = apply(items, "T-001", "builder_failed", {}, applyCtx(items, { mission: mission({ breaker: { consecutiveFailures: 0 } }) })).items;
      }
      expect(items[0]?.state).toBe("planning");
      items = apply(items, "T-001", "planner_revised").items;
      items = apply(items, "T-001", "start").items;
    }
    for (let i = 0; i < 3; i++) {
      if (i > 0) items = apply(items, "T-001", "retry").items;
      items = apply(items, "T-001", "builder_failed", {}, applyCtx(items, { mission: mission({ breaker: { consecutiveFailures: 0 } }) })).items;
    }
    expect(items[0]).toMatchObject({ state: "blocked", plannerRounds: 2 });
  });
});

describe("circuit breaker", () => {
  test("trips at the configured count: the mission is halted and the text says so", () => {
    const items = [item("T-001", { state: "building" })];
    const ctx = applyCtx(items, { mission: mission({ breaker: { consecutiveFailures: 4 } }) });
    const result = apply(items, "T-001", "builder_failed", {}, ctx);
    expect(result.mission).toMatchObject({ status: "halted", breaker: { consecutiveFailures: 5 } });
    expect(result.mission.statusReason).toContain("circuit breaker");
    expect(result.next).toContain("resume");
  });

  test("does not trip below the count, and a verified item resets it", () => {
    const below = apply([item("T-001", { state: "building" })], "T-001", "builder_failed", {}, applyCtx([item("T-001", { state: "building" })], { mission: mission({ breaker: { consecutiveFailures: 3 } }) }));
    expect(below.mission.status).toBe("running");
    const integrating = [item("T-002", { state: "integrating" })];
    const done = apply(integrating, "T-002", "integrate_ok", { commit: "abc" }, applyCtx(integrating, { mission: mission({ breaker: { consecutiveFailures: 4 } }) }));
    expect(done.mission.breaker.consecutiveFailures).toBe(0);
  });
});

describe("integration", () => {
  const integrating = () => [item("T-001", { state: "integrating" })];

  test("integrate_ok records the commit and finishes the item; next points at completion when all are done", () => {
    const result = apply(integrating(), "T-001", "integrate_ok", { commit: " abc123 " });
    expect(result.items[0]).toMatchObject({ state: "done", commit: "abc123" });
    expect(result.next).toContain("set_status complete");
  });

  test("integrate_ok needs a commit", () => {
    expect(apply(integrating(), "T-001", "integrate_ok").ok).toBe(false);
    expect(apply(integrating(), "T-001", "integrate_ok", { commit: "  " }).ok).toBe(false);
  });

  test("gate C and gate E approvals are required when the autonomy asks for them", () => {
    const base = (approvals: Approval[]) =>
      applyCtx(integrating(), { mission: mission({ autonomy: "supervised" }), approvals });
    const noApproval = apply(integrating(), "T-001", "integrate_ok", { commit: "c" }, base([]));
    expect(noApproval.ok).toBe(false);
    expect(noApproval.next).toContain("commit:T-001");
    const onlyC = apply(integrating(), "T-001", "integrate_ok", { commit: "c" }, base([granted("C", "commit:T-001")]));
    expect(onlyC.ok).toBe(false);
    expect(onlyC.next).toContain("merge:T-001");
    const both = apply(integrating(), "T-001", "integrate_ok", { commit: "c" }, base([granted("C", "commit:T-001"), granted("E", "merge:T-001")]));
    expect(both.ok).toBe(true);
  });

  test("checkpoints need no C or E approval", () => {
    const result = apply(integrating(), "T-001", "integrate_ok", { commit: "c" }, applyCtx(integrating(), { mission: mission({ autonomy: "checkpoints" }) }));
    expect(result.ok).toBe(true);
  });

  test("an approval for another item does not satisfy the gate", () => {
    const ctx = applyCtx(integrating(), { mission: mission({ autonomy: "supervised" }), approvals: [granted("C", "commit:T-002"), granted("E", "merge:T-002")] });
    expect(apply(integrating(), "T-001", "integrate_ok", { commit: "c" }, ctx).ok).toBe(false);
  });

  test("a conflict rebuilds twice without counting failures, the third conflict blocks", () => {
    let items = integrating();
    let result = apply(items, "T-001", "integrate_conflict");
    expect(result.items[0]).toMatchObject({ state: "building", conflicts: 1, failures: 0 });
    expect(result.mission.breaker.consecutiveFailures).toBe(0);
    items = apply(result.items, "T-001", "builder_done").items;
    items = apply(items, "T-001", "verify_clean").items;
    result = apply(items, "T-001", "integrate_conflict");
    expect(result.items[0]).toMatchObject({ state: "building", conflicts: 2 });
    items = apply(apply(result.items, "T-001", "builder_done").items, "T-001", "verify_clean").items;
    result = apply(items, "T-001", "integrate_conflict");
    expect(result.items[0]).toMatchObject({ state: "blocked", conflicts: 3, failures: 0 });
    expect(result.items[0]?.history.at(-1)?.event).toBe("auto_block");
  });
});

describe("unblock", () => {
  const blocked = () => [item("T-001", { state: "blocked", failures: 3, conflicts: 2, plannerRounds: 2 })];

  test("needs the user decision as a note, then resets the counters and returns to pending", () => {
    expect(apply(blocked(), "T-001", "unblock").ok).toBe(false);
    expect(apply(blocked(), "T-001", "unblock", { note: "  " }).ok).toBe(false);
    const result = apply(blocked(), "T-001", "unblock", { note: "user chose option B" });
    expect(result.items[0]).toMatchObject({ state: "pending", failures: 0, conflicts: 0, plannerRounds: 0 });
    expect(result.items[0]?.history).toEqual([{ at: CLOCK, event: "unblock", from: "blocked", to: "pending", note: "user chose option B" }]);
  });

  test("only blocked items can be unblocked, and a blocked mission can then complete", () => {
    expect(apply([item("T-001", { state: "failed" })], "T-001", "unblock", { note: "x" }).ok).toBe(false);
    const started = apply(apply(blocked(), "T-001", "unblock", { note: "go" }).items, "T-001", "start");
    expect(started.items[0]?.state).toBe("building");
  });
});

describe("next hints", () => {
  test("a conflict says to rebuild with the same task name and read the retry branch from the result", () => {
    const result = apply([item("T-001", { state: "integrating" })], "T-001", "integrate_conflict");
    expect(result.next).toContain("same task name T-001");
    expect(result.next).toContain("omp/task/T-001-2");
  });
});

describe("file helpers", () => {
  test("allocateMission hands out M-001, M-002 and never reuses an id under concurrency", async () => {
    const stateDir = await tempDir();
    expect((await allocateMission(stateDir)).id).toBe("M-001");
    const ids = (await Promise.all(Array.from({ length: 12 }, () => allocateMission(stateDir)))).map(m => m.id);
    expect(new Set(ids).size).toBe(12);
    expect(ids.sort()[0]).toBe("M-002");
  });

  test("writeFileAtomic leaves no temp files and replaces content", async () => {
    const dir = await tempDir();
    const path = join(dir, "a", "b.json");
    await writeFileAtomic(path, "one");
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(path, `v${i}`)));
    expect(await readFile(path, "utf8")).toMatch(/^v\d+$/);
    expect(await readdir(join(dir, "a"))).toEqual(["b.json"]);
  });

  test("a failed atomic write leaves the old file and removes its temp file", async () => {
    const dir = await tempDir();
    const path = join(dir, "x.json");
    await writeFileAtomic(path, "old");
    await mkdir(join(dir, "blocked"));
    await expect(writeFileAtomic(join(dir, "blocked"), "new")).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("old");
    expect((await readdir(dir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  test("concurrent usage appends all survive as whole lines", async () => {
    const dir = await tempDir();
    const file = join(dir, "usage.jsonl");
    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        appendUsage(file, { at: CLOCK, agent: `a${i}`, kind: "sub", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 }),
      ),
    );
    const records = await loadUsage(file);
    expect(records).toHaveLength(60);
    expect(new Set(records.map(r => r.agent)).size).toBe(60);
    expect(await loadUsage(join(dir, "missing.jsonl"))).toEqual([]);
  });

  test("withMissionLock serializes read-modify-write cycles", async () => {
    const dir = await tempDir();
    await saveMission(dir, mission({ nextSeq: 1 }));
    await Promise.all(
      Array.from({ length: 25 }, () =>
        withMissionLock(dir, async () => {
          const current = await loadMission(dir);
          await saveMission(dir, { ...(current ?? mission()), nextSeq: (current?.nextSeq ?? 0) + 1 });
        }),
      ),
    );
    expect((await loadMission(dir))?.nextSeq).toBe(26);
    expect(await readdir(dir)).not.toContain(".lock");
  });

  test("a stale lock (judged by its mtime) is taken over by exactly one waiter at a time", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".lock"), "dead-process");
    const old = new Date(Date.now() - 3_600_000);
    await utimes(join(dir, ".lock"), old, old);
    let inside = 0;
    let overlap = 0;
    let entered = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withMissionLock(dir, async () => {
          inside += 1;
          overlap = Math.max(overlap, inside);
          entered += 1;
          await writeFile(join(dir, "probe"), String(entered));
          await readFile(join(dir, "probe"), "utf8");
          inside -= 1;
        }),
      ),
    );
    expect(entered).toBe(12);
    expect(overlap).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(["probe"]);
  });

  test("a slow holder whose lock was taken over leaves its successor's lock in place", async () => {
    const dir = await tempDir();
    let finishSuccessor!: () => void;
    const successorGate = new Promise<void>(resolve => (finishSuccessor = resolve));
    let successorIn!: () => void;
    const successorEntered = new Promise<void>(resolve => (successorIn = resolve));
    let successor: Promise<void> = Promise.resolve();
    await withMissionLock(dir, async () => {
      const old = new Date(Date.now() - 3_600_000);
      await utimes(join(dir, ".lock"), old, old);
      successor = withMissionLock(dir, async () => {
        successorIn();
        await successorGate;
      });
      await successorEntered;
    });
    expect(await readFile(join(dir, ".lock"), "utf8")).not.toBe("");
    finishSuccessor();
    await successor;
    expect(await readdir(dir)).toEqual([]);
  });

  test("items round trip and are listed in id order; missing files read as empty", async () => {
    const dir = await tempDir();
    expect(await loadItems(dir)).toEqual([]);
    await saveItem(dir, item("T-002"));
    await saveItem(dir, item("T-001", { depends: [] }));
    expect((await loadItems(dir)).map(i => i.id)).toEqual(["T-001", "T-002"]);
    expect(await readJson(join(dir, "nope.json"))).toBeUndefined();
  });

  test("findActiveMission skips complete and aborted missions", async () => {
    const stateDir = await tempDir();
    for (const [id, status] of [["M-001", "paused"], ["M-002", "complete"], ["M-003", "aborted"]] as const) {
      await mkdir(join(stateDir, "missions", id), { recursive: true });
      await writeJson(join(stateDir, "missions", id, "mission.json"), mission({ id, status }));
    }
    expect(await findActiveMission(stateDir)).toBe("M-001");
  });

  test("slugify makes safe branch names", () => {
    expect(slugify("Add OAuth: login & logout!")).toBe("add-oauth-login-logout");
    expect(slugify("!!!")).toBe("mission");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe("artifact paths", () => {
  test("rejects traversal, absolute paths, backslashes, empty segments and NUL", () => {
    const base = "/tmp/m";
    for (const bad of ["../x.md", "a/../../x.md", "/etc/passwd", "a\\b", "a//b", "", "  ", "a\0b", ".."]) {
      expect(() => resolveInside(base, bad)).toThrow();
    }
    expect(resolveInside(base, "nested/ok.md")).toBe("/tmp/m/nested/ok.md");
  });

  test("single-file kinds ignore the name; directory kinds are confined", async () => {
    const dir = await tempDir();
    expect(artifactPath(dir, "todo", "../../x")).toBe(join(dir, "TODO.md"));
    expect(artifactPath(dir, "decisions", "")).toBe(join(dir, "decisions.md"));
    expect(artifactPath(dir, "specs", "INDEX.md")).toBe(join(dir, "specs", "INDEX.md"));
    expect(() => artifactPath(dir, "evidence", "../escape.md")).toThrow();
    await expect(writeArtifact(dir, "research", "../../escape.md", "x", false)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  test("decisions always append; other kinds replace unless append is set", async () => {
    const dir = await tempDir();
    await writeArtifact(dir, "decisions", "", "first", false);
    await writeArtifact(dir, "decisions", "", "second", false);
    expect(await readFile(join(dir, "decisions.md"), "utf8")).toBe("first\nsecond\n");
    await writeArtifact(dir, "evidence", "run/log.md", "one", false);
    await writeArtifact(dir, "evidence", "run/log.md", "two", false);
    expect(await readFile(join(dir, "evidence", "run", "log.md"), "utf8")).toBe("two");
    await writeArtifact(dir, "evidence", "run/log.md", "three", true);
    expect(await readFile(join(dir, "evidence", "run", "log.md"), "utf8")).toBe("twothree\n");
  });
});
