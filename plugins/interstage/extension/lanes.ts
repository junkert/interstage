import type { Lane } from "./contracts";

export interface LaneSignals {
  filesLikelyTouched: number;
  hasSpecAlready: boolean;
  newProject: boolean;
  touchesSecurityOrData: boolean;
  ambiguity: "low" | "medium" | "high";
  estimatedItems: number;
}

const LANE_ORDER: readonly Lane[] = ["fast", "standard", "full"];

export function suggestLane(signals: LaneSignals): { lane: Lane; reasons: string[] } {
  const full: string[] = [];
  if (signals.newProject) full.push("new project");
  if (signals.ambiguity === "high") full.push("high ambiguity");
  if (signals.estimatedItems > 8) full.push(`${signals.estimatedItems} estimated items (more than 8)`);
  if (signals.touchesSecurityOrData && signals.estimatedItems > 3) {
    full.push(`touches security or data with ${signals.estimatedItems} estimated items (more than 3)`);
  }
  if (full.length > 0) return { lane: "full", reasons: full };

  const fast =
    signals.filesLikelyTouched <= 2 &&
    signals.ambiguity === "low" &&
    signals.estimatedItems <= 1 &&
    !signals.touchesSecurityOrData;
  if (fast) {
    return {
      lane: "fast",
      reasons: [`${signals.filesLikelyTouched} files at most 2`, "no new project", "low ambiguity", "single item", "no security or data"],
    };
  }

  const reasons: string[] = [];
  if (signals.filesLikelyTouched > 2) reasons.push(`${signals.filesLikelyTouched} files likely touched (more than 2)`);
  if (signals.ambiguity === "medium") reasons.push("medium ambiguity");
  if (signals.estimatedItems > 1) reasons.push(`${signals.estimatedItems} estimated items`);
  if (signals.touchesSecurityOrData) reasons.push("touches security or data");
  return { lane: "standard", reasons };
}

/** An override must be enabled. A disabled suggestion falls to the nearest enabled lane (ties go to the lighter lane); the note is returned in `error`. */
export function resolveLane(
  suggested: Lane,
  override: Lane | undefined,
  enabled: Lane[],
): { lane: Lane; error?: string } {
  if (override !== undefined && !enabled.includes(override)) {
    return { lane: nearestEnabled(suggested, enabled), error: `lane override "${override}" is not enabled (enabled: ${enabled.join(", ")})` };
  }
  if (override !== undefined) return { lane: override };
  if (enabled.includes(suggested)) return { lane: suggested };
  const lane = nearestEnabled(suggested, enabled);
  return { lane, error: `suggested lane "${suggested}" is disabled; using "${lane}"` };
}

function nearestEnabled(from: Lane, enabled: Lane[]): Lane {
  const origin = LANE_ORDER.indexOf(from);
  let best: Lane = from;
  let bestDistance = Infinity;
  LANE_ORDER.forEach((lane, i) => {
    if (!enabled.includes(lane)) return;
    const d = Math.abs(i - origin);
    if (d < bestDistance) {
      best = lane;
      bestDistance = d;
    }
  });
  return best;
}
