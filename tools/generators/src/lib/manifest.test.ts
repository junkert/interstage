import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../testing.ts";
import { addMarketplacePlugin, addSkillEntry, type MarketplaceEntry, type SkillEntry } from "./manifest.ts";

const entry = (name: string): SkillEntry => ({ name, path: `plugins/p/skills/${name}`, origin: "authored", modified: false, budgetBytes: 3000 });
const plugin = (name: string): MarketplaceEntry => ({ name, description: "d", source: `./plugins/${name}`, version: "0.1.0", category: "development", keywords: ["agents", "skills"], license: "MIT" });

describe("addSkillEntry", () => {
  const text = `${JSON.stringify({ upstream: { repo: "r" }, skills: [entry("is-b"), entry("is-d")] }, null, 2)}\n`;
  const names = (result: string) => (JSON.parse(result) as { skills: { name: string }[] }).skills.map((skill) => skill.name);

  test("inserts in name order and keeps other keys", () => {
    expect(names(addSkillEntry(text, entry("is-a")))).toEqual(["is-a", "is-b", "is-d"]);
    expect(names(addSkillEntry(text, entry("is-c")))).toEqual(["is-b", "is-c", "is-d"]);
    expect(names(addSkillEntry(text, entry("is-e")))).toEqual(["is-b", "is-d", "is-e"]);
    expect(JSON.parse(addSkillEntry(text, entry("is-c"))).upstream).toEqual({ repo: "r" });
  });
  test("keeps the relative order of an unsorted list", () => {
    const unsorted = `${JSON.stringify({ skills: [entry("is-z"), entry("is-b")] })}\n`;
    expect(names(addSkillEntry(unsorted, entry("is-c")))).toEqual(["is-c", "is-z", "is-b"]);
  });
  test("refuses duplicates by name and by path", () => {
    expect(() => addSkillEntry(text, entry("is-b"))).toThrow(/already lists is-b/);
    expect(() => addSkillEntry(text, { ...entry("is-x"), path: entry("is-b").path })).toThrow(/already lists the path/);
  });
  test("rejects malformed manifests", () => {
    expect(() => addSkillEntry("{", entry("is-a"))).toThrow(/not valid JSON/);
    expect(() => addSkillEntry("[]", entry("is-a"))).toThrow(/must be a JSON object/);
    expect(() => addSkillEntry("{}", entry("is-a"))).toThrow(/needs a `skills` array/);
  });
  test("round-trips the repository manifest byte for byte", () => {
    const real = readFileSync(join(REPO_ROOT, "skills.manifest.json"), "utf8");
    expect(`${JSON.stringify(JSON.parse(real), null, 2)}\n`).toBe(real);
  });
});

describe("addMarketplacePlugin", () => {
  const text = `${JSON.stringify({ name: "m", plugins: [plugin("interstage"), plugin("interstage-web")] }, null, 2)}\n`;
  const names = (result: string) => (JSON.parse(result) as { plugins: { name: string }[] }).plugins.map((item) => item.name);

  test("inserts in name order", () => {
    expect(names(addMarketplacePlugin(text, plugin("interstage-data")))).toEqual(["interstage", "interstage-data", "interstage-web"]);
    expect(names(addMarketplacePlugin(text, plugin("interstage-zed")))).toEqual(["interstage", "interstage-web", "interstage-zed"]);
  });
  test("refuses a duplicate regardless of case", () => {
    expect(() => addMarketplacePlugin(text, plugin("Interstage-Web"))).toThrow(/already lists/);
  });
  test("rejects a catalog without a plugins array", () => {
    expect(() => addMarketplacePlugin("{}", plugin("x"))).toThrow(/needs a `plugins` array/);
  });
  test("round-trips the repository catalog byte for byte", () => {
    const real = readFileSync(join(REPO_ROOT, ".omp-plugin/marketplace.json"), "utf8");
    expect(`${JSON.stringify(JSON.parse(real), null, 2)}\n`).toBe(real);
  });
});
