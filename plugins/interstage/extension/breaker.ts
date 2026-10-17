/** Gate G. A failure increments the consecutive count, a verified item resets it; trips when the count reaches `limit`. */
export function recordOutcome(
  state: { consecutiveFailures: number },
  outcome: "failure" | "verified",
  limit: number,
): { state: { consecutiveFailures: number }; tripped: boolean } {
  const consecutiveFailures = outcome === "failure" ? state.consecutiveFailures + 1 : 0;
  return { state: { consecutiveFailures }, tripped: consecutiveFailures >= limit };
}
