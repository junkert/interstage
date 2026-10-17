import type { InterstageConfig, UsageRecord } from "./contracts";

/**
 * Billable tokens: `input + output + cacheWrite` per record. `cacheRead` is excluded because every turn re-reads the
 * whole conversation from the cache, which would make a budget measure conversation length squared, not work done.
 */
export function sumTokens(records: UsageRecord[], filter?: { agent?: string; pogoLoop?: number }): number {
  let total = 0;
  for (const r of records) {
    if (filter?.agent !== undefined && r.agent !== filter.agent) continue;
    if (filter?.pogoLoop !== undefined && r.pogoLoop !== filter.pogoLoop) continue;
    total += r.input + r.output + r.cacheWrite;
  }
  return total;
}

/** Cache-read tokens across all records, reported next to the budget but never counted against it. */
export function sumCacheReads(records: UsageRecord[]): number {
  return records.reduce((total, r) => total + r.cacheRead, 0);
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
    [r.input, r.output, r.cacheRead, r.cacheWrite, r.totalTokens].every(n => typeof n === "number" && Number.isFinite(n)) &&
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
