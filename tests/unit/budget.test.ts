import { describe, expect, test } from "bun:test";
import { checkBudgets, parseUsageJsonl, sumCacheReads, sumTokens } from "../../plugins/interstage/extension/budget";
import type { UsageRecord } from "../../plugins/interstage/extension/contracts";

const rec = (agent: string, totalTokens: number, pogoLoop?: number): UsageRecord => ({
  at: "t",
  agent,
  kind: "sub",
  input: totalTokens,
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

describe("billable tokens", () => {
  const full = (over: Partial<UsageRecord>): UsageRecord => ({ ...rec("flight", 0), ...over });

  test("count input + output + cacheWrite and ignore cacheRead and totalTokens", () => {
    const r = full({ input: 10, output: 20, cacheWrite: 5, cacheRead: 1_000_000, totalTokens: 1_000_035 });
    expect(sumTokens([r])).toBe(35);
    expect(sumCacheReads([r, r])).toBe(2_000_000);
  });

  test("a huge cacheRead does not exceed the budget; output pushes it over", () => {
    const limits = { pogoLoopTokens: 100, missionTokens: 1000 };
    const reread = full({ input: 100, output: 50, cacheRead: 5_000_000, totalTokens: 5_000_150 });
    expect(checkBudgets([reread, reread, reread], limits, 0)).toMatchObject({ missionUsed: 450, missionExceeded: false });
    const over = checkBudgets([reread, reread, reread, full({ output: 551 })], limits, 0);
    expect(over).toMatchObject({ missionUsed: 1001, missionExceeded: true, missionRemaining: 0 });
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
  test("records missing the token fields are malformed, even with totalTokens", () => {
    const { input: _input, ...noInput } = rec("pogo", 5);
    const r = parseUsageJsonl(`${JSON.stringify(noInput)}\n${JSON.stringify({ ...rec("pogo", 5), cacheWrite: "x" })}\n`);
    expect(r.records).toEqual([]);
    expect(r.errors).toEqual(["line 1: not a usage record", "line 2: not a usage record"]);
  });
  test("empty text yields nothing", () => expect(parseUsageJsonl("")).toEqual({ records: [], errors: [] }));
});
