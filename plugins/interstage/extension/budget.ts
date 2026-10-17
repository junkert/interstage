import type { InterstageConfig, UsageRecord } from "./contracts";

export function sumTokens(records: UsageRecord[], filter?: { agent?: string; pogoLoop?: number }): number {
  let total = 0;
  for (const r of records) {
    if (filter?.agent !== undefined && r.agent !== filter.agent) continue;
    if (filter?.pogoLoop !== undefined && r.pogoLoop !== filter.pogoLoop) continue;
    total += r.totalTokens;
  }
  return total;
}

/** Exceeded means used is strictly over the limit; exactly at the limit leaves zero remaining but is not exceeded. */
export function checkBudgets(
  records: UsageRecord[],
  limits: InterstageConfig["budgets"],
  pogoLoop: number,
): {
  missionUsed: number;
  missionRemaining: number;
  missionExceeded: boolean;
  pogoUsed: number;
  pogoRemaining: number;
  pogoExceeded: boolean;
} {
  const missionUsed = sumTokens(records);
  const pogoUsed = sumTokens(records, { agent: "pogo", pogoLoop });
  return {
    missionUsed,
    missionRemaining: Math.max(0, limits.missionTokens - missionUsed),
    missionExceeded: missionUsed > limits.missionTokens,
    pogoUsed,
    pogoRemaining: Math.max(0, limits.pogoLoopTokens - pogoUsed),
    pogoExceeded: pogoUsed > limits.pogoLoopTokens,
  };
}

function isUsageRecord(v: unknown): v is UsageRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.at === "string" &&
    typeof r.agent === "string" &&
    (r.kind === "main" || r.kind === "sub") &&
    typeof r.totalTokens === "number" &&
    Number.isFinite(r.totalTokens) &&
    (r.pogoLoop === undefined || typeof r.pogoLoop === "number")
  );
}

/** Parses usage.jsonl; blank lines are ignored, malformed lines are skipped and reported with their 1-based number. */
export function parseUsageJsonl(text: string): { records: UsageRecord[]; errors: string[] } {
  const records: UsageRecord[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`line ${i + 1}: invalid JSON`);
      return;
    }
    if (!isUsageRecord(parsed)) {
      errors.push(`line ${i + 1}: not a usage record`);
      return;
    }
    records.push(parsed);
  });
  return { records, errors };
}
