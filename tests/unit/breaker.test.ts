import { expect, test } from "bun:test";
import { recordOutcome } from "../../plugins/interstage/extension/breaker";

test("trips exactly when the count reaches the limit", () => {
  let state = { consecutiveFailures: 0 };
  const tripped: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const r = recordOutcome(state, "failure", 3);
    state = r.state;
    tripped.push(r.tripped);
  }
  expect(tripped).toEqual([false, false, true]);
  expect(state.consecutiveFailures).toBe(3);
});

test("a verified item resets the count and never trips", () => {
  const r = recordOutcome({ consecutiveFailures: 4 }, "verified", 5);
  expect(r).toEqual({ state: { consecutiveFailures: 0 }, tripped: false });
  expect(recordOutcome(r.state, "failure", 5).tripped).toBe(false);
});

test("does not mutate the input state", () => {
  const state = { consecutiveFailures: 1 };
  recordOutcome(state, "failure", 5);
  expect(state.consecutiveFailures).toBe(1);
});

test("a limit of 1 trips on the first failure", () => {
  expect(recordOutcome({ consecutiveFailures: 0 }, "failure", 1).tripped).toBe(true);
});
