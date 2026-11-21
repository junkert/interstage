// A short, read-only summary of the mission state on disk, shown to CAPCOM at the start of every turn so it never has
// to remember (or guess) where Houston and the mission stand.

import { join } from "node:path";
import { checkBudgets } from "./budget";
import { ENV_MISSION_ID, ENV_STATE_DIR, type ItemRecord } from "./contracts";
import { listMissionIds, loadApprovals, loadEffectiveConfig, loadItems, loadMission, loadUsage, missionDirOf } from "./state";

const MAX_ITEM_LINES = 12;

/** Markdown block for CAPCOM's system prompt, or undefined when there is nothing to report. Never throws. */
export async function stateSnapshot(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const stateDir = env[ENV_STATE_DIR];
    if (stateDir === undefined || stateDir === "") return undefined;
    const activeId = env[ENV_MISSION_ID];
    const lines: string[] = [];

    const others: string[] = [];
    for (const id of await listMissionIds(stateDir)) {
      if (id === activeId) continue;
      const record = await loadMission(missionDirOf(stateDir, id)).catch(() => undefined);
      if (record !== undefined && record.status !== "complete" && record.status !== "aborted") others.push(`${id} (${record.status}) ${record.title}`);
    }

    if (activeId !== undefined && activeId !== "") {
      const dir = missionDirOf(stateDir, activeId);
      const mission = await loadMission(dir).catch(() => undefined);
      if (mission === undefined) {
        lines.push(`Active mission ${activeId}: mission.json is missing or unreadable under ${stateDir}.`);
      } else {
        const items = await loadItems(dir);
        const { config } = await loadEffectiveConfig(stateDir, env);
        const budget = checkBudgets(await loadUsage(join(dir, "usage.jsonl")), config.budgets, mission.pogoLoop);
        const approvals = (await loadApprovals(dir)).filter(a => a.status === "pending");
        const counts = new Map<ItemRecord["state"], number>();
        for (const item of items) counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
        lines.push(`Active mission ${mission.id}: ${mission.title}`);
        lines.push(`- Status: ${mission.status}${mission.statusReason === undefined ? "" : ` (${mission.statusReason})`}; lane ${mission.lane}; autonomy ${mission.autonomy}; branch ${mission.branch}`);
        lines.push(`- Items: ${items.length === 0 ? "none planned yet" : [...counts].map(([state, n]) => `${state} ${n}`).join(", ")}`);
        const open = items.filter(item => item.state !== "done");
        for (const item of open.slice(0, MAX_ITEM_LINES)) lines.push(`  - ${item.id} [${item.state}] ${item.title}`);
        if (open.length > MAX_ITEM_LINES) lines.push(`  - ... and ${open.length - MAX_ITEM_LINES} more`);
        if (approvals.length > 0) lines.push(`- Pending approvals (yours to resolve): ${approvals.map(a => `${a.gate} ${a.ref}`).join("; ")}`);
        lines.push(`- Budget: ${budget.missionUsed} of ${config.budgets.missionTokens} billable tokens; mission directory ${dir}`);
      }
    } else {
      lines.push("No active mission.");
    }
    if (others.length > 0) lines.push(`Other unfinished missions (parked, not running): ${others.join("; ")}`);
    if (lines.length === 1 && lines[0] === "No active mission.") return undefined;
    return ["## Interstage state (read from disk when this turn started)", ...lines, "Call `mission` action `get` for anything newer."].join("\n");
  } catch (error) {
    console.error("[interstage] state snapshot failed (continuing):", error);
    return undefined;
  }
}
