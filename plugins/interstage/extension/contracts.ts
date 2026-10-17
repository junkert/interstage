// Shared types and constants for the Interstage extension. Authoritative description: docs/CONTRACTS.md.
// Types only plus a few constants; no behavior lives here.

export const FLAG_NAME = "interstage";
export const ENV_STATE_DIR = "INTERSTAGE_STATE_DIR";
export const ENV_MISSION_ID = "INTERSTAGE_MISSION_ID";

export type Autonomy = "supervised" | "checkpoints" | "autopilot";
export type Lane = "fast" | "standard" | "full";
export type Severity = "blocker" | "major" | "minor" | "nit";
export type GateId = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type GateDecision = "allow" | "approve" | "stop";

export interface ReviewFinding {
  severity: Severity;
  title: string;
  /** file:line, a reproduction with its real output, or a quoted spec clause. Never empty. */
  evidence: string;
  location?: string;
}

export interface InterstageConfig {
  autonomy: Autonomy;
  ship: "allow" | "deny";
  budgets: { pogoLoopTokens: number; missionTokens: number };
  breaker: { consecutiveFailures: number };
  parallel: { worktrees: number };
  lanes: { enabled: Lane[]; default: Lane };
  verify: { command: string };
}

export type ItemState = "pending" | "building" | "verifying" | "integrating" | "failed" | "planning" | "done" | "blocked";
export type MissionStatus = "running" | "paused" | "halted" | "complete" | "aborted";

export type ItemEvent =
  | "start"
  | "builder_done"
  | "builder_failed"
  | "verify_clean"
  | "verify_failed"
  | "retry"
  | "planner_revised"
  | "planner_blocked"
  | "integrate_ok"
  | "integrate_conflict";

export interface ItemHistoryEntry {
  /** Stamped by the extension, never by a model. */
  at: string;
  event: ItemEvent | "auto_escalate" | "auto_block";
  from: ItemState;
  to: ItemState;
  note?: string;
}

export interface ItemRecord {
  id: string;
  title: string;
  state: ItemState;
  depends: string[];
  spec: string | undefined;
  doneWhen: string[];
  failures: number;
  plannerRounds: number;
  conflicts: number;
  commit: string | undefined;
  /** Findings from the most recent failed verification. */
  findings: ReviewFinding[];
  history: ItemHistoryEntry[];
}

export interface MissionRecord {
  id: string;
  title: string;
  lane: Lane;
  status: MissionStatus;
  /** Reason for the last status change (breaker trip, pause, abort). */
  statusReason: string | undefined;
  brief: string;
  branch: string;
  /** Branch that was current when the mission was created. */
  baseBranch: string;
  baseSha: string;
  autonomy: Autonomy;
  createdAt: string;
  breaker: { consecutiveFailures: number };
  /** Increments each time Houston resets the Pogo loop budget. */
  pogoLoop: number;
  /** Next steering sequence number. */
  nextSeq: number;
}

export interface Approval {
  gate: GateId;
  ref: string;
  status: "pending" | "granted" | "denied";
  requestedBy: string;
  requestedAt: string;
  resolvedAt?: string;
  note?: string;
}

export interface UsageRecord {
  at: string;
  mission?: string;
  agent: string;
  kind: "main" | "sub";
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

export type SteeringSignal = "interrupt" | "redirect" | "pause" | "resume" | "reprioritize" | "decision" | "error" | "complete";

export interface SteeringPacket {
  version: 1;
  seq: number;
  at: string;
  signal: SteeringSignal;
  from: string;
  context?: {
    current_task?: { id: string; spec_ref?: string };
    failure_history?: { attempt: number; error: string; ref: string }[];
  };
  evidence?: { files_changed?: string[]; test_results?: { passed: number; failed: number }; tokens_used?: number };
  instructions?: { primary: string; constraints: string[]; success_criteria: string[]; next_steps: string[] };
  /** Signal-specific payload; see DESIGN "Steering packets". */
  payload: Record<string, unknown>;
}

export type ArtifactKind = "evidence" | "research" | "specs" | "decisions" | "todo" | "spec";

export type MissionToolInput =
  | { action: "create"; title: string; lane: Lane; brief: string }
  | { action: "plan_set"; todoPath?: string }
  | { action: "get"; scope: "mission" | "items" | "item" | "approvals" | "budget"; itemId?: string }
  | { action: "transition"; itemId: string; event: ItemEvent; findings?: ReviewFinding[]; commit?: string; note?: string }
  | { action: "approval"; op: "request" | "resolve"; gate: GateId; ref: string; status?: "granted" | "denied"; note?: string }
  | { action: "steer"; signal: SteeringSignal; payload: Record<string, unknown>; instructions?: SteeringPacket["instructions"] }
  | { action: "apply_steering" }
  | { action: "write_artifact"; kind: ArtifactKind; name: string; content: string; append?: boolean }
  | { action: "set_status"; status: "paused" | "running" | "complete" | "halted"; reason: string };

export interface MissionToolResult {
  ok: boolean;
  /** One or two sentences for the model. */
  text: string;
  data?: unknown;
  /** Recommended next action, for example "retry T-003" or "request approval A". */
  next?: string;
}

/** Callers allowed per action (agent names; "main" is the CAPCOM session). */
export const ACTION_CALLERS: Record<MissionToolInput["action"], readonly string[]> = {
  create: ["houston"],
  plan_set: ["houston", "flight"],
  get: ["main", "houston", "flight"],
  transition: ["flight"],
  approval: ["main", "houston", "flight"],
  steer: ["main", "houston", "flight"],
  apply_steering: ["flight"],
  write_artifact: ["houston", "flight"],
  set_status: ["main", "houston", "flight"],
};

/** Agents that may hold the `mission` tool at all. */
export const MISSION_TOOL_AGENTS: readonly string[] = ["main", "houston", "flight"];

/** Every Interstage agent name, used to hide agents when the flag is absent. */
export const AGENT_NAMES: readonly string[] = [
  "houston",
  "flight",
  "fido",
  "pogo",
  "sojourner",
  "ingenuity",
  "hubble",
  "curiosity",
  "perseverance",
  "go-no-go",
  "orbiter",
  "inspector",
  "kessler",
  "tiger-team",
  "booster",
  "golden-record",
];
