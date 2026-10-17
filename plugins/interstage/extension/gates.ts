import type { Approval, GateDecision, GateId, InterstageConfig } from "./contracts";

const TABLE: Record<GateId, [supervised: GateDecision, checkpoints: GateDecision, autopilot: GateDecision]> = {
  A: ["approve", "approve", "allow"],
  B: ["approve", "allow", "allow"],
  C: ["approve", "allow", "allow"],
  D: ["approve", "allow", "allow"],
  E: ["approve", "allow", "allow"],
  F: ["approve", "approve", "allow"],
  G: ["stop", "stop", "stop"],
};

export function decideGate(gate: GateId, cfg: Pick<InterstageConfig, "autonomy" | "ship">): GateDecision {
  if (gate === "F" && cfg.autonomy === "autopilot") return cfg.ship === "allow" ? "allow" : "stop";
  const row = TABLE[gate];
  return cfg.autonomy === "supervised" ? row[0] : cfg.autonomy === "checkpoints" ? row[1] : row[2];
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

const INSTALL: RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b/,
  /\bpip3?\s+install\b/,
  /\bgo\s+(get|install)\b/,
  /\bcargo\s+(install|add)\b/,
  /\bgem\s+install\b/,
  /\bbrew\s+install\b/,
  /\bapt(-get)?\s+install\b/,
];
/**
 * `git` as the start of a command: optionally quoted, followed by any global options (`-C <dir>`, `-c k=v`,
 * `--no-pager`, `--git-dir=...`, `--work-tree <dir>`, ...), so `git -C w push` classifies like `git push`.
 */
const ARG = String.raw`(?:"[^"]*"|'[^']*'|\S+)`;
const GIT = String.raw`\bgit["']?(?:\s+(?:-[Cc]\s+${ARG}|--(?:git-dir|work-tree|namespace|exec-path)\s+${ARG}|--[\w-]+(?:=${ARG})?|-[pP]))*`;
const git = (rest: string): RegExp => new RegExp(GIT + String.raw`\s+` + rest);

const NETWORK: RegExp[] = [
  /\b(curl|wget)\b/,
  git(String.raw`(?:clone|fetch|pull)\b`),
  /\bgh\s+api\b/,
  /\b(npm|yarn|pnpm|bun|cargo)\s+audit\b/,
  /\bpip-audit\b/,
  /\bdocker\s+(pull|build)\b/,
];
const MERGE: RegExp[] = [git(String.raw`merge\b.*\bomp\/task\/`)];
const SHIP: RegExp[] = [
  git(String.raw`push\b`),
  /\bgh\s+(pr\s+create|release\s+create)\b/,
  /\bvercel\b/,
  /\bnpm\s+publish\b/,
  git(String.raw`tag\b.*\s-?-?(push)\b`),
];

const KINDS: { gate: "D" | "E" | "F"; kind: "install" | "network" | "merge" | "ship"; patterns: RegExp[] }[] = [
  { gate: "D", kind: "install", patterns: INSTALL },
  { gate: "D", kind: "network", patterns: NETWORK },
  { gate: "E", kind: "merge", patterns: MERGE },
  { gate: "F", kind: "ship", patterns: SHIP },
];

/**
 * Splits on `&&`, `||`, `;`, `|` and newlines, then classifies each raw segment.
 * Limitation: quoting is not interpreted. Separators inside quotes also split, and text inside quoted
 * strings (`echo "npm install"`, `bash -c "curl x"`) is classified like any other text. That errs on the
 * side of blocking, and it keeps wrapped commands such as `bash -c "..."` from slipping through.
 */
export function classifyCommand(
  command: string,
): { gate: "D" | "E" | "F"; kind: "install" | "network" | "merge" | "ship"; ref: string }[] {
  const out: { gate: "D" | "E" | "F"; kind: "install" | "network" | "merge" | "ship"; ref: string }[] = [];
  // A backslash-newline continuation is removed by the shell, so `git \\<newline> push` is `git  push`.
  for (const segment of command.replace(/\\\r?\n/g, "").split(/&&|\|\||;|\||\n/)) {
    const ref = normalizeCommand(segment);
    if (ref === "") continue;
    for (const { gate, kind, patterns } of KINDS) {
      if (patterns.some(p => p.test(ref))) out.push({ gate, kind, ref });
    }
  }
  return out;
}

export function hasApproval(approvals: Approval[], gate: GateId, ref: string): boolean {
  const wanted = normalizeCommand(ref);
  return approvals.some(a => a.status === "granted" && a.gate === gate && normalizeCommand(a.ref) === wanted);
}

export function blockReason(gate: GateId, kind: string, ref: string): string {
  return `Gate ${gate} blocks this ${kind} command (${ref}): do not retry it, and report the need to your orchestrator as an open question.`;
}
