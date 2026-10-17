import { describe, expect, test } from "bun:test";
import { type LaneSignals, resolveLane, suggestLane } from "../../plugins/interstage/extension/lanes";

const base: LaneSignals = {
  filesLikelyTouched: 1,
  hasSpecAlready: false,
  newProject: false,
  touchesSecurityOrData: false,
  ambiguity: "low",
  estimatedItems: 1,
};
const s = (o: Partial<LaneSignals>): LaneSignals => ({ ...base, ...o });

describe("suggestLane", () => {
  test("fast at the boundary of 2 files and one item", () => {
    const r = suggestLane(s({ filesLikelyTouched: 2 }));
    expect(r.lane).toBe("fast");
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  test("3 files leaves fast", () => {
    const r = suggestLane(s({ filesLikelyTouched: 3 }));
    expect(r.lane).toBe("standard");
    expect(r.reasons.join(" ")).toContain("3 files");
  });
  test("medium ambiguity, two items or security each leave fast", () => {
    expect(suggestLane(s({ ambiguity: "medium" })).lane).toBe("standard");
    expect(suggestLane(s({ estimatedItems: 2 })).lane).toBe("standard");
    expect(suggestLane(s({ touchesSecurityOrData: true })).lane).toBe("standard");
  });
  test("full for a new project, even when otherwise tiny", () => {
    const r = suggestLane(s({ newProject: true }));
    expect(r.lane).toBe("full");
    expect(r.reasons).toEqual(["new project"]);
  });
  test("full for high ambiguity", () => expect(suggestLane(s({ ambiguity: "high" })).lane).toBe("full"));
  test("items: 8 is standard, 9 is full", () => {
    expect(suggestLane(s({ filesLikelyTouched: 5, estimatedItems: 8 })).lane).toBe("standard");
    expect(suggestLane(s({ filesLikelyTouched: 5, estimatedItems: 9 })).lane).toBe("full");
  });
  test("security or data: 3 items is standard, 4 is full", () => {
    expect(suggestLane(s({ touchesSecurityOrData: true, estimatedItems: 3 })).lane).toBe("standard");
    const r = suggestLane(s({ touchesSecurityOrData: true, estimatedItems: 4 }));
    expect(r.lane).toBe("full");
    expect(r.reasons.join(" ")).toContain("security or data");
  });
  test("reports every full reason that applied", () => {
    expect(suggestLane(s({ newProject: true, ambiguity: "high", estimatedItems: 10 })).reasons).toHaveLength(3);
  });
});

describe("resolveLane", () => {
  const all = ["fast", "standard", "full"] as const;
  test("enabled suggestion passes through", () => expect(resolveLane("standard", undefined, [...all])).toEqual({ lane: "standard" }));
  test("enabled override wins", () => expect(resolveLane("fast", "full", [...all])).toEqual({ lane: "full" }));
  test("disabled override is an error and falls back from the suggestion", () => {
    const r = resolveLane("standard", "full", ["fast", "standard"]);
    expect(r.lane).toBe("standard");
    expect(r.error).toContain("full");
  });
  test("disabled suggestion falls to the nearest enabled lane with a note", () => {
    const r = resolveLane("standard", undefined, ["fast", "full"]);
    expect(r.lane).toBe("fast");
    expect(r.error).toContain("standard");
    expect(resolveLane("fast", undefined, ["full"]).lane).toBe("full");
    expect(resolveLane("full", undefined, ["fast", "standard"]).lane).toBe("standard");
  });
});
