import { afterAll, describe, expect, test } from "bun:test";
import { makeTempRepo } from "../testing.ts";
import { renderPackPackage, scaffoldPack, type PackOptions } from "./pack.ts";

const repo = makeTempRepo();
afterAll(repo.cleanup);

const options: PackOptions = { name: "mobile", description: "Interstage mobile pack: mobile review skills.", skillDescription: "Use when reviewing a mobile app.", budgetBytes: 3000 };

test("renderPackPackage has no omp key and a scoped validate script", () => {
  const pkg = JSON.parse(renderPackPackage("interstage-mobile", "d")) as Record<string, unknown>;
  expect(pkg).toEqual({
    name: "interstage-mobile",
    version: "0.1.0",
    description: "d",
    license: "MIT",
    scripts: { validate: "bun run ../../tools/validate/src/cli.ts ../.. --plugin plugins/interstage-mobile" },
  });
  expect("omp" in pkg).toBe(false);
});

describe("scaffoldPack", () => {
  test("creates the pack, its first skill and the catalog entry, and the validator is clean", () => {
    const tree = repo.newTree();
    const { files, notes } = scaffoldPack(tree, options);
    repo.flush(tree);
    expect(files.map((file) => file.path)).toEqual(["plugins/interstage-mobile/package.json", "plugins/interstage-mobile/skills/is-mobile/SKILL.md"]);
    expect(notes.join("\n")).toContain("bun install");
    expect(repo.validate()).toEqual([]);
    const catalog = JSON.parse(tree.read(".omp-plugin/marketplace.json", "utf-8") ?? "") as { plugins: { name: string; source: string; keywords: string[] }[] };
    const names = catalog.plugins.map((plugin) => plugin.name);
    expect(names).toEqual([...names].sort());
    expect(catalog.plugins.find((plugin) => plugin.name === "interstage-mobile")).toMatchObject({ source: "./plugins/interstage-mobile", keywords: ["agents", "skills", "mobile"] });
  });

  test("uses an explicit first skill name", () => {
    const tree = repo.newTree();
    const { files } = scaffoldPack(tree, { ...options, name: "games", skill: "playtest" });
    repo.flush(tree);
    expect(files[1]?.path).toBe("plugins/interstage-games/skills/is-playtest/SKILL.md");
    expect(repo.validate()).toEqual([]);
  });

  test("refuses to overwrite an existing pack", () => {
    expect(() => scaffoldPack(repo.newTree(), { ...options, name: "web" })).toThrow(/already exists/);
  });

  test("validates inputs and writes nothing on failure", () => {
    const bad: [Partial<PackOptions>, RegExp][] = [
      [{ name: "Bad" }, /name must be lowercase kebab-case/],
      [{ name: "interstage-x" }, /must not include the `interstage` prefix/],
      [{ name: "interstage" }, /must not include the `interstage` prefix/],
      [{ description: "" }, /description is required/],
      [{ description: "a\nb" }, /single line/],
      [{ skill: "is-x" }, /must not include the `is-` prefix/],
      [{ skillDescription: "" }, /description is required/],
      [{ skill: "web-review" }, /already exists in the repository/],
    ];
    // A failed attempt may leave partial writes in its tree; Nx discards the tree on a throw, so each attempt gets a new one.
    for (const [override, message] of bad) expect(() => scaffoldPack(repo.newTree(), { ...options, name: "fresh", ...override })).toThrow(message);
    expect(repo.validate()).toEqual([]);
  });
});
