import { describe, expect, test } from "bun:test";
import { checkBudgets, parseUsageJsonl, sumTokens } from "../../plugins/interstage/extension/budget";
import type { UsageRecord } from "../../plugins/interstage/extension/contracts";

const rec = (agent: string, totalTokens: number, pogoLoop?: number): UsageRecord => ({
  at: "t",
  agent,
  kind: "sub",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: 0,
  ...(pogoLoop === undefined ? {} : { pogoLoop }),
});

const records = [rec("flight", 100, 0), rec("pogo", 50, 0), rec("pogo", 70, 1), rec("pogo", 30, 1), rec("fido", 10, 1)];

describe("sumTokens", () => {
  test("sums all, by agent, by loop, and by both", () => {
    expect(sumTokens(records)).toBe(260);
    expect(sumTokens(records, { agent: "pogo" })).toBe(150);
    expect(sumTokens(records, { pogoLoop: 1 })).toBe(110);
    expect(sumTokens(records, { agent: "pogo", pogoLoop: 1 })).toBe(100);
  });
  test("empty is zero; records without a loop never match a loop filter", () => {
    expect(sumTokens([])).toBe(0);
    expect(sumTokens([rec("pogo", 5)], { pogoLoop: 0 })).toBe(0);
  });
});

describe("checkBudgets", () => {
  const limits = { pogoLoopTokens: 100, missionTokens: 300 };
  test("pogo usage counts only pogo records of the given loop", () => {
    const r = checkBudgets(records, limits, 1);
    expect(r).toEqual({
      missionUsed: 260,
      missionRemaining: 40,
      missionExceeded: false,
      pogoUsed: 100,
      pogoRemaining: 0,
      pogoExceeded: false,
    });
    expect(checkBudgets(records, limits, 0).pogoUsed).toBe(50);
    expect(checkBudgets(records, limits, 2).pogoUsed).toBe(0);
  });
  test("exceeded only when strictly over; remaining clamps at zero", () => {
    const over = checkBudgets(records, { pogoLoopTokens: 99, missionTokens: 259 }, 1);
    expect(over.pogoExceeded).toBe(true);
    expect(over.pogoRemaining).toBe(0);
    expect(over.missionExceeded).toBe(true);
    expect(over.missionRemaining).toBe(0);
  });
});

describe("parseUsageJsonl", () => {
  test("parses valid lines, skips blanks, reports malformed ones with line numbers", () => {
    const good = JSON.stringify(rec("pogo", 5, 2));
    const r = parseUsageJsonl(`${good}\n\nnot json\n{"agent":"x"}\n${good}\n`);
    expect(r.records).toHaveLength(2);
    expect(r.records[0]?.pogoLoop).toBe(2);
    expect(r.errors).toEqual(["line 3: invalid JSON", "line 4: not a usage record"]);
  });
  test("empty text yields nothing", () => expect(parseUsageJsonl("")).toEqual({ records: [], errors: [] }));
});
