import { describe, expect, test } from "bun:test";
import { assertInsideRepo, assertKebab, assertLine, titleCase, yamlScalar } from "./names.ts";

describe("assertKebab", () => {
  test("accepts kebab-case", () => {
    for (const value of ["a", "web", "log-analysis", "v2-api"]) expect(() => assertKebab("name", value)).not.toThrow();
  });
  test("rejects everything else", () => {
    for (const value of ["", "Web", "two--hyphens", "-lead", "trail-", "under_score", "has space", "../escape", "a/b", undefined, 3]) {
      expect(() => assertKebab("name", value)).toThrow(/name must be lowercase kebab-case/);
    }
  });
});

describe("assertLine", () => {
  test("requires one non-empty line within the limit", () => {
    expect(() => assertLine("description", "Use when x.", 20)).not.toThrow();
    expect(() => assertLine("description", "  ", 20)).toThrow(/required/);
    expect(() => assertLine("description", "a\nb", 20)).toThrow(/single line/);
    expect(() => assertLine("description", "x".repeat(21), 20)).toThrow(/limit is 20/);
  });
});

test("titleCase", () => {
  expect(titleCase("go-no-go")).toBe("Go No Go");
  expect(titleCase("web")).toBe("Web");
});

describe("assertInsideRepo", () => {
  test("accepts normalized relative paths", () => {
    expect(() => assertInsideRepo("plugins/interstage/agents/x.md")).not.toThrow();
  });
  test("rejects absolute, parent and unnormalized paths", () => {
    for (const path of ["/etc/passwd", "../x", "plugins/../../x", "plugins//x", "./x"]) expect(() => assertInsideRepo(path)).toThrow(/outside the repository/);
  });
});

describe("yamlScalar", () => {
  const roundTrip = (value: string) => Bun.YAML.parse(`key: ${yamlScalar(value)}`) as { key: unknown };
  test("round-trips awkward strings through YAML", () => {
    for (const value of [
      "Use when reviewing HTML, JSX or templates.",
      "Use when: a colon appears",
      "Use when # not a comment",
      "true",
      "123",
      "- leading dash",
      'He said "hi"',
      "Use when it's 'quoted'",
      "ends with colon:",
      "[bracketed] value",
      "Use when the agent's task is X (Y).",
    ]) {
      expect(roundTrip(value).key).toBe(value);
    }
  });
  test("keeps ordinary sentences plain", () => {
    expect(yamlScalar("Use when reviewing code.")).toBe("Use when reviewing code.");
  });
});
