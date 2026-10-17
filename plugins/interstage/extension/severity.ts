import type { ReviewFinding, Severity } from "./contracts";

const SEVERITIES: Record<Severity, true> = { blocker: true, major: true, minor: true, nit: true };

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && Object.hasOwn(SEVERITIES, value);
}

/** A review is clean at zero blockers and zero majors; minor and nit never gate. */
export function isClean(findings: ReviewFinding[]): boolean {
  return !findings.some(f => f.severity === "blocker" || f.severity === "major");
}

export function countBySeverity(findings: ReviewFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** Validates untrusted findings; invalid entries are reported and dropped. */
export function validateFindings(input: unknown): { findings: ReviewFinding[]; errors: string[] } {
  const findings: ReviewFinding[] = [];
  const errors: string[] = [];
  if (!Array.isArray(input)) {
    return { findings, errors: ["findings must be an array"] };
  }
  input.forEach((entry: unknown, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`findings[${i}]: must be an object`);
      return;
    }
    const e = entry as Record<string, unknown>;
    if (!isSeverity(e.severity)) {
      errors.push(`findings[${i}]: severity must be one of blocker, major, minor, nit`);
      return;
    }
    if (typeof e.title !== "string" || e.title.trim() === "") {
      errors.push(`findings[${i}]: title must be a non-empty string`);
      return;
    }
    if (typeof e.evidence !== "string" || e.evidence.trim() === "") {
      errors.push(`findings[${i}]: evidence must be a non-empty string`);
      return;
    }
    const finding: ReviewFinding = { severity: e.severity, title: e.title, evidence: e.evidence.trim() };
    if (typeof e.location === "string" && e.location.trim() !== "") finding.location = e.location;
    findings.push(finding);
  });
  return { findings, errors };
}
