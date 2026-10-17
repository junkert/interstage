import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "../../plugins/interstage/extension/config";

describe("mergeConfig", () => {
  test("undefined and null overrides return a copy of the base", () => {
    const r = mergeConfig(DEFAULT_CONFIG, undefined);
    expect(r).toEqual({ config: DEFAULT_CONFIG, errors: [], unknownKeys: [] });
    expect(r.config).not.toBe(DEFAULT_CONFIG);
    expect(mergeConfig(DEFAULT_CONFIG, null).config).toEqual(DEFAULT_CONFIG);
  });
  test("deep merge keeps sibling values", () => {
    const r = mergeConfig(DEFAULT_CONFIG, { autonomy: "autopilot", budgets: { missionTokens: 500 }, verify: { command: "make test" } });
    expect(r.errors).toEqual([]);
    expect(r.config.autonomy).toBe("autopilot");
    expect(r.config.budgets).toEqual({ pogoLoopTokens: 150000, missionTokens: 500 });
    expect(r.config.verify.command).toBe("make test");
  });
  test("never mutates the base", () => {
    mergeConfig(DEFAULT_CONFIG, { budgets: { missionTokens: 1 }, lanes: { enabled: ["fast"], default: "fast" } });
    expect(DEFAULT_CONFIG.budgets.missionTokens).toBe(2000000);
    expect(DEFAULT_CONFIG.lanes.enabled).toEqual(["fast", "standard", "full"]);
  });
  test("non-mapping config is an error", () => {
    expect(mergeConfig(DEFAULT_CONFIG, "x").errors).toEqual(["config must be a mapping"]);
    expect(mergeConfig(DEFAULT_CONFIG, [1]).errors).toHaveLength(1);
  });
  test("invalid enums keep the base value", () => {
    const r = mergeConfig(DEFAULT_CONFIG, { autonomy: "yolo", ship: "maybe" });
    expect(r.config.autonomy).toBe("checkpoints");
    expect(r.config.ship).toBe("deny");
    expect(r.errors.map(e => e.split(":")[0])).toEqual(["autonomy", "ship"]);
  });
  test("positive integer fields reject zero, negatives, fractions and strings", () => {
    for (const bad of [0, -1, 1.5, "5", null, Number.NaN]) {
      const r = mergeConfig(DEFAULT_CONFIG, {
        budgets: { pogoLoopTokens: bad, missionTokens: bad },
        breaker: { consecutiveFailures: bad },
        parallel: { worktrees: bad },
      });
      expect(r.config).toEqual(DEFAULT_CONFIG);
      expect(r.errors.map(e => e.split(":")[0])).toEqual([
        "budgets.pogoLoopTokens", "budgets.missionTokens", "breaker.consecutiveFailures", "parallel.worktrees",
      ]);
    }
    expect(mergeConfig(DEFAULT_CONFIG, { parallel: { worktrees: 1 } }).config.parallel.worktrees).toBe(1);
  });
  test("a section that is not a mapping is reported", () => {
    const r = mergeConfig(DEFAULT_CONFIG, { budgets: 5, lanes: [] });
    expect(r.errors).toEqual(["budgets: must be a mapping", "lanes: must be a mapping"]);
  });
  test("verify.command must be a string", () => {
    const r = mergeConfig(DEFAULT_CONFIG, { verify: { command: 3 } });
    expect(r.errors).toEqual(["verify.command: must be a string"]);
    expect(r.config.verify.command).toBe("");
  });
  test("lanes: valid change, default must be enabled, entries validated", () => {
    expect(mergeConfig(DEFAULT_CONFIG, { lanes: { enabled: ["fast", "full"], default: "full" } }).config.lanes).toEqual({
      enabled: ["fast", "full"],
      default: "full",
    });
    const missing = mergeConfig(DEFAULT_CONFIG, { lanes: { enabled: ["fast", "full"] } });
    expect(missing.config.lanes).toEqual(DEFAULT_CONFIG.lanes);
    expect(missing.errors[0]).toContain("lanes.default");
    expect(mergeConfig(DEFAULT_CONFIG, { lanes: { default: "turbo" } }).errors[0]).toContain("lanes.default");
    for (const bad of [[], ["fast", "fast"], ["turbo"], "fast"]) {
      const r = mergeConfig(DEFAULT_CONFIG, { lanes: { enabled: bad } });
      expect(r.config.lanes).toEqual(DEFAULT_CONFIG.lanes);
      expect(r.errors[0]).toContain("lanes.enabled");
    }
  });
  test("unknown keys are reported as dotted paths and ignored", () => {
    const r = mergeConfig(DEFAULT_CONFIG, { theme: "dark", budgets: { missionTokens: 9, extra: 1 }, parallel: { x: 1 } });
    expect(r.unknownKeys).toEqual(["theme", "budgets.extra", "parallel.x"]);
    expect(r.config.budgets.missionTokens).toBe(9);
    expect(r.errors).toEqual([]);
  });
});

describe("loadConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "interstage-config-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test("missing files give defaults", async () => {
    const r = await loadConfig({ userPath: join(dir, "u.yml"), projectPath: join(dir, "p.yml") });
    expect(r).toEqual({ config: DEFAULT_CONFIG, errors: [], unknownKeys: [] });
  });
  test("precedence is defaults < user < project", async () => {
    const userPath = join(dir, "u.yml");
    const projectPath = join(dir, "p.yml");
    await writeFile(userPath, "autonomy: supervised\nship: allow\nbudgets:\n  missionTokens: 1000\n");
    await writeFile(projectPath, "autonomy: autopilot\nbudgets:\n  pogoLoopTokens: 77\nlanes:\n  enabled: [fast, standard]\n  default: fast\n");
    const r = await loadConfig({ userPath, projectPath });
    expect(r.errors).toEqual([]);
    expect(r.config.autonomy).toBe("autopilot");
    expect(r.config.ship).toBe("allow");
    expect(r.config.budgets).toEqual({ pogoLoopTokens: 77, missionTokens: 1000 });
    expect(r.config.lanes).toEqual({ enabled: ["fast", "standard"], default: "fast" });
  });
  test("a YAML parse error is reported and the other file still applies", async () => {
    const userPath = join(dir, "u.yml");
    const projectPath = join(dir, "p.yml");
    await writeFile(userPath, "autonomy: [unclosed\n  : :\n");
    await writeFile(projectPath, "ship: allow\n");
    const r = await loadConfig({ userPath, projectPath });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain(userPath);
    expect(r.config.ship).toBe("allow");
  });
  test("validation errors and unknown keys name the file", async () => {
    const projectPath = join(dir, "p.yml");
    await writeFile(projectPath, "autonomy: yolo\nmystery: 1\n");
    const r = await loadConfig({ userPath: join(dir, "none.yml"), projectPath });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(projectPath);
    expect(r.unknownKeys).toEqual(["mystery"]);
    expect(r.config.autonomy).toBe("checkpoints");
  });
  test("an empty file is fine", async () => {
    const projectPath = join(dir, "p.yml");
    await writeFile(projectPath, "");
    expect((await loadConfig({ userPath: join(dir, "u"), projectPath })).errors).toEqual([]);
  });
});
