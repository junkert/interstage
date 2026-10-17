import { afterAll, describe, expect, test } from "bun:test";
import { validateSkill } from "../../../validate/src/skills";
import { makeTempRepo } from "../testing.ts";
import { findReplaceMarkers, formatReport } from "./files.ts";
import { renderSkill, scaffoldSkill, type SkillOptions } from "./skill.ts";

const repo = makeTempRepo();
afterAll(repo.cleanup);

const options: SkillOptions = { plugin: "interstage-web", name: "css-audit", description: "Use when auditing CSS for unused rules.", budgetBytes: 3000 };

describe("renderSkill", () => {
  const text = renderSkill(options);
  test("has the frontmatter and the method-skill sections", () => {
    expect(text.startsWith("---\nname: is-css-audit\ndescription: Use when auditing CSS for unused rules.\nlicense: MIT\n---\n")).toBe(true);
    for (const heading of ["# Css Audit", "## Method", "## Decision rules", "## Checklist", "## Output"]) expect(text).toContain(`\n${heading}\n`);
  });
  test("marks every placeholder with Replace:", () => {
    const markers = findReplaceMarkers(text);
    expect(markers.length).toBeGreaterThanOrEqual(5);
    expect(markers.every((marker) => marker.text.includes("Replace:"))).toBe(true);
    expect(text.split("\n")[markers[0]!.line - 1]).toContain("Replace:");
  });
  test("quotes a description that plain YAML cannot hold", () => {
    expect(renderSkill({ ...options, description: "Use when: a colon appears" })).toContain('description: "Use when: a colon appears"\n');
  });
});

describe("scaffoldSkill", () => {
  test("creates SKILL.md and the manifest entry, and the validator is clean", () => {
    const tree = repo.newTree();
    const result = scaffoldSkill(tree, options);
    repo.flush(tree);
    expect(result.files.map((file) => file.path)).toEqual(["plugins/interstage-web/skills/is-css-audit/SKILL.md"]);
    expect(repo.validate()).toEqual([]);
    const manifest = JSON.parse(tree.read("skills.manifest.json", "utf-8") ?? "") as { skills: Record<string, unknown>[] };
    expect(manifest.skills.find((skill) => skill.name === "is-css-audit")).toEqual({
      name: "is-css-audit",
      path: "plugins/interstage-web/skills/is-css-audit",
      origin: "authored",
      modified: false,
      budgetBytes: 3000,
    });
    expect(validateSkill(repo.root, "plugins/interstage-web/skills/is-css-audit", new Set(["is-css-audit"]), 3000).findings).toEqual([]);
  });

  test("refuses to overwrite and to duplicate a name", () => {
    const tree = repo.newTree();
    expect(() => scaffoldSkill(tree, options)).toThrow(/already exists/);
    expect(() => scaffoldSkill(tree, { ...options, plugin: "interstage-data" })).toThrow(/already exists in the repository/);
  });

  test("validates inputs before writing anything", () => {
    const tree = repo.newTree();
    const bad: [Partial<SkillOptions>, RegExp][] = [
      [{ name: "Bad_Name" }, /name must be lowercase kebab-case/],
      [{ name: "is-thing" }, /must not include the `is-` prefix/],
      [{ plugin: "../etc" }, /plugin must be lowercase kebab-case/],
      [{ plugin: "no-such-plugin" }, /does not exist/],
      [{ description: "" }, /description is required/],
      [{ description: "x".repeat(1025) }, /limit is 1024/],
      [{ budgetBytes: 0 }, /positive integer/],
      [{ budgetBytes: 1.5 }, /positive integer/],
      [{ budgetBytes: 100 }, /over budgetBytes 100/],
    ];
    for (const [override, message] of bad) expect(() => scaffoldSkill(tree, { ...options, name: "fresh", ...override })).toThrow(message);
    expect(tree.listChanges()).toEqual([]);
  });
});

test("formatReport lists created files and each marker with its line", () => {
  const report = formatReport([{ path: "a/SKILL.md", content: "x\nReplace: one\ny\n- Replace: two\n" }], ["next step"]);
  expect(report).toContain("  a/SKILL.md:2: Replace: one");
  expect(report).toContain("  a/SKILL.md:4: - Replace: two");
  expect(report.endsWith("next step")).toBe(true);
});
