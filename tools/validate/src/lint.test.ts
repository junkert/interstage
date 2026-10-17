import { describe, expect, test } from "bun:test";
import { lintMarkdown } from "./lint";

function rules(text: string): string[] {
  return lintMarkdown("x.md", text).map((finding) => finding.rule);
}

describe("lintMarkdown", () => {
  test("accepts plain procedural content", () => {
    expect(rules("# Method\n\nRun the project's own test command and record the output.\n\n```bash\nnpm test\n```\n")).toEqual([]);
  });

  test("flags the upstream patterns that invent facts", () => {
    const text = [
      "Run `npm run test:ecosystem:report` first.",
      "Install with npx skills add wojons/skills.",
      "Scan Date: 2026-02-26",
      "Overall Score: 72/100",
      "Phase 1: Week 1-2 setup",
      "Current Level: Maturity assessment pending",
      "Find at least 3 issues.",
      "Use @completeness-validator check to finish.",
      "Saves $45,000 per year.",
    ].join("\n");
    expect(rules(text).sort()).toEqual(
      [
        "lint-fictional-command",
        "lint-npx-skills",
        "lint-date",
        "lint-score",
        "lint-week-schedule",
        "lint-maturity",
        "lint-quota",
        "lint-skill-command",
        "lint-dollars",
      ].sort(),
    );
  });

  test("allows dollar signs inside fenced code but not the other rules", () => {
    const text = "```bash\necho $5 and $1,000\nnpm run a:b\n```\n";
    expect(rules(text)).toEqual(["lint-fictional-command"]);
  });

  test("reports the line number", () => {
    const [finding] = lintMarkdown("x.md", "fine\nalso fine\nScore: 88/100\n");
    expect(finding?.message).toContain("line 3");
  });
});
