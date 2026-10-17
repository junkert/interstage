import type { Finding } from "./checks";

interface LintRule {
  rule: string;
  pattern: RegExp;
  message: string;
  /** Skip lines inside fenced code blocks (shell snippets legitimately contain `$1`, flags and so on). */
  skipFences: boolean;
}

// Patterns that mark content copied from upstream skills that invents facts
// (sample reports, scores, schedules, nonexistent commands) or is host-specific.
const RULES: LintRule[] = [
  { rule: "lint-fictional-command", pattern: /\bnpm run [a-z0-9-]+:[a-z0-9:*-]+/, message: "fictional `npm run <skill>:<task>` command", skipFences: false },
  { rule: "lint-npx-skills", pattern: /\bnpx skills\b/, message: "`npx skills` is not an OMP install path", skipFences: false },
  { rule: "lint-opencode", pattern: /\.opencode\b|compatibility:\s*opencode|\bOpenCode\b/i, message: "OpenCode-specific reference", skipFences: false },
  { rule: "lint-searxng", pattern: /searxng/i, message: "`searxng_*` tools do not exist in OMP", skipFences: false },
  { rule: "lint-date", pattern: /\b(?:19|20)\d\d-\d\d-\d\d\b/, message: "fabricated or hard-coded date", skipFences: false },
  { rule: "lint-score", pattern: /\b\d{1,3}\/100\b/, message: "sample score (`N/100`)", skipFences: false },
  { rule: "lint-week-schedule", pattern: /\bWeek \d/, message: "human schedule (`Week N`)", skipFences: false },
  { rule: "lint-maturity", pattern: /\bmaturity (?:score|level|assessment|model)\b/i, message: "maturity score or model", skipFences: false },
  { rule: "lint-quota", pattern: /\bfind at least \d+/i, message: "findings quota (a clean report must be valid)", skipFences: false },
  { rule: "lint-skill-command", pattern: /(?:^|\s)@[a-z][a-z0-9-]*\s+(?:check|validate|report|confirm)\b/, message: "`@skill` slash-style command does not exist", skipFences: false },
  { rule: "lint-dollars", pattern: /\$\d[\d,]*(?:\.\d+)?\s?[KkMm]?(?![\w$])/, message: "dollar amount", skipFences: true },
];

/** Lint a markdown file for invented or host-specific content. */
export function lintMarkdown(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    for (const rule of RULES) {
      if (rule.skipFences && inFence) continue;
      if (rule.pattern.test(line)) findings.push({ rule: rule.rule, path, message: `line ${index + 1}: ${rule.message}` });
    }
  });
  return findings;
}
