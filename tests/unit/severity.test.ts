import { describe, expect, test } from "bun:test";
import type { ReviewFinding } from "../../plugins/interstage/extension/contracts";
import { countBySeverity, isClean, validateFindings } from "../../plugins/interstage/extension/severity";

const f = (severity: ReviewFinding["severity"]): ReviewFinding => ({ severity, title: "t", evidence: "a.ts:1" });

describe("isClean", () => {
  test("empty list is clean", () => expect(isClean([])).toBe(true));
  test("minor and nit never gate", () => expect(isClean([f("minor"), f("nit"), f("minor")])).toBe(true));
  test("one major fails", () => expect(isClean([f("nit"), f("major")])).toBe(false));
  test("one blocker fails", () => expect(isClean([f("blocker")])).toBe(false));
});

describe("countBySeverity", () => {
  test("counts every severity and zero-fills the rest", () => {
    expect(countBySeverity([f("major"), f("nit"), f("major")])).toEqual({ blocker: 0, major: 2, minor: 0, nit: 1 });
    expect(countBySeverity([])).toEqual({ blocker: 0, major: 0, minor: 0, nit: 0 });
  });
});

describe("validateFindings", () => {
  test("accepts valid entries and trims evidence", () => {
    const r = validateFindings([{ severity: "major", title: "Bug", evidence: "  a.ts:3  ", location: "a.ts" }]);
    expect(r.errors).toEqual([]);
    expect(r.findings).toEqual([{ severity: "major", title: "Bug", evidence: "a.ts:3", location: "a.ts" }]);
  });
  test("drops and reports invalid entries while keeping valid ones", () => {
    const r = validateFindings([
      { severity: "major", title: "ok", evidence: "x" },
      { severity: "critical", title: "ok", evidence: "x" },
      { severity: "minor", title: "  ", evidence: "x" },
      { severity: "minor", title: "ok", evidence: "   " },
      { severity: "minor", title: "ok" },
      "nope",
      null,
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.errors).toHaveLength(6);
    expect(r.errors[0]).toContain("findings[1]");
    expect(r.errors[0]).toContain("severity");
    expect(r.errors[1]).toContain("title");
    expect(r.errors[2]).toContain("evidence");
  });
  test("non-array input is an error", () => {
    expect(validateFindings({ severity: "major" })).toEqual({ findings: [], errors: ["findings must be an array"] });
  });
  test("prototype property names are not severities", () => {
    expect(validateFindings([{ severity: "toString", title: "t", evidence: "e" }]).findings).toEqual([]);
  });
});
