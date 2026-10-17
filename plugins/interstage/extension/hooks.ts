// Event hooks. Infrastructure errors fail open (logged, never thrown); gate decisions fail closed.

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadPersona, type Runtime } from "./activation";
import { checkBudgets } from "./budget";
import { DEFAULT_CONFIG } from "./config";
import { ENV_MISSION_ID, ENV_STATE_DIR, MISSION_TOOL_AGENTS, type Approval, type InterstageConfig, type MissionRecord, type UsageRecord } from "./contracts";
import { blockReason, classifyCommand, decideGate, hasApproval, normalizeCommand } from "./gates";
import { appendUsage, isoNow, loadApprovals, loadEffectiveConfig, loadMission, loadUsage, missionDirOf, saveMission, withMissionLock } from "./state";
import { join } from "node:path";

export interface HookCtx {
  agent: { kind: "main" | "sub"; name: string };
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

export interface HookDeps {
  runtime: Runtime;
  env: NodeJS.ProcessEnv;
  getActiveTools(): string[];
  setActiveTools(names: string[]): Promise<void>;
  now?: () => string;
}

const TOOL = "mission";

function callerName(ctx: HookCtx): string {
  return ctx.agent.kind === "main" ? "main" : ctx.agent.name;
}

function logFailure(hook: string, error: unknown): void {
  console.error(`[interstage] ${hook} failed (continuing):`, error);
}

/** The mission the environment points at, with its directory; undefined outside a mission. */
async function currentMission(env: NodeJS.ProcessEnv): Promise<{ dir: string; mission: MissionRecord } | undefined> {
  const stateDir = env[ENV_STATE_DIR];
  const id = env[ENV_MISSION_ID];
  if (stateDir === undefined || stateDir === "" || id === undefined || id === "") return undefined;
  const dir = missionDirOf(stateDir, id);
  const mission = await loadMission(dir);
  return mission === undefined ? undefined : { dir, mission };
}

export function createHooks(deps: HookDeps) {
  const { runtime, env } = deps;
  const now = deps.now ?? isoNow;

  return {
    async beforeAgentStart(event: { systemPrompt: string[] }, ctx: HookCtx): Promise<{ systemPrompt: string[] } | undefined> {
      try {
        const tools = deps.getActiveTools();
        const isMain = ctx.agent.kind === "main";
        const holdsTool = isMain ? runtime.active : MISSION_TOOL_AGENTS.includes(callerName(ctx));
        if (!holdsTool && tools.includes(TOOL)) await deps.setActiveTools(tools.filter(name => name !== TOOL));
        if (holdsTool && isMain && !tools.includes(TOOL)) await deps.setActiveTools([...tools, TOOL]);
        if (!isMain || !runtime.active) return undefined;
        const persona = await loadPersona(env);
        if ("error" in persona) {
          if (!runtime.personaErrorShown) {
            runtime.personaErrorShown = true;
            ctx.ui.notify(persona.error, "error");
          }
          return undefined;
        }
        return { systemPrompt: [...event.systemPrompt, persona.text] };
      } catch (error) {
        logFailure("before_agent_start", error);
        return undefined;
      }
    },

    async beforeSubagentSpawn(event: { agent: string }): Promise<{ block: true; reason: string } | undefined> {
      try {
        const current = await currentMission(env);
        if (current === undefined) return undefined;
        const { mission } = current;
        const label = `Mission ${mission.id}`;
        const why = mission.statusReason === undefined ? "" : ` (${mission.statusReason})`;
        if (mission.status === "paused" || mission.status === "halted") {
          return { block: true, reason: `${label} is ${mission.status}${why}, so no new agents start until CAPCOM resumes it.` };
        }
        if ((mission.status === "complete" || mission.status === "aborted") && event.agent !== "houston") {
          return { block: true, reason: `${label} is ${mission.status}, so no new agents start; houston must create a new mission first.` };
        }
        if (event.agent === "pogo") {
          const stateDir = env[ENV_STATE_DIR] ?? "";
          const { config } = await loadEffectiveConfig(stateDir, env);
          const budget = checkBudgets(await loadUsage(join(current.dir, "usage.jsonl")), config.budgets, mission.pogoLoop);
          if (budget.pogoExceeded) {
            return { block: true, reason: `Pogo loop ${mission.pogoLoop} used ${budget.pogoUsed} of ${config.budgets.pogoLoopTokens} tokens, so houston must reset the Pogo loop before spawning pogo again.` };
          }
        }
        return undefined;
      } catch (error) {
        logFailure("before_subagent_spawn", error);
        return undefined;
      }
    },

    async toolCall(event: { toolName: string; input: object }, ctx: HookCtx): Promise<{ block: true; reason: string } | undefined> {
      if (ctx.agent.kind !== "sub" || event.toolName !== "bash") return undefined;
      const command = "command" in event.input ? event.input.command : undefined;
      if (typeof command !== "string") return undefined;
      const stateDir = env[ENV_STATE_DIR];
      if (stateDir === undefined || stateDir === "") return undefined;
      const classified = classifyCommand(command);
      if (classified.length === 0) return undefined;

      // From here on a failure to read state means "no approval", never "allowed".
      let config: InterstageConfig = DEFAULT_CONFIG;
      let autonomy = DEFAULT_CONFIG.autonomy;
      let approvals: Approval[] = [];
      let noMission = false;
      try {
        config = (await loadEffectiveConfig(stateDir, env)).config;
        autonomy = config.autonomy;
        const current = await currentMission(env);
        if (current !== undefined) {
          autonomy = current.mission.autonomy;
          approvals = await loadApprovals(current.dir);
        } else {
          noMission = true;
        }
      } catch (error) {
        logFailure("tool_call state read", error);
      }
      // Gates D, E and F are enforced only inside a mission: with no active mission (id unset or mission file
      // missing) there is no orchestrator to route an approval through, so blocking would be a dead end.
      // An unreadable mission file is an error, not "no mission", and stays fail-closed above.
      if (noMission) return undefined;
      const whole = normalizeCommand(command);
      for (const item of classified) {
        const decision = decideGate(item.gate, { autonomy, ship: config.ship });
        if (decision === "allow") continue;
        const task = item.gate === "E" ? /omp\/task\/(T-\d{3,})(?:-\d+)?(?![\w-])/.exec(item.ref)?.[1] : undefined;
        const ref = task === undefined ? item.ref : `merge:${task}`;
        if (decision === "approve" && [ref, item.ref, whole].some(candidate => hasApproval(approvals, item.gate, candidate))) continue;
        return { block: true, reason: blockReason(item.gate, item.kind, ref) };
      }
      return undefined;
    },

    async messageEnd(event: { message: { role?: string; usage?: unknown } }, ctx: HookCtx): Promise<void> {
      try {
        const stateDir = env[ENV_STATE_DIR];
        const usage = event.message.usage as
          | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } }
          | undefined;
        if (stateDir === undefined || stateDir === "" || event.message.role !== "assistant" || usage === undefined) return;
        const current = await currentMission(env);
        const record: UsageRecord = {
          at: now(),
          agent: callerName(ctx),
          kind: ctx.agent.kind,
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          totalTokens: usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0),
          cost: usage.cost?.total ?? 0,
        };
        if (current === undefined) {
          await appendUsage(join(stateDir, "usage.jsonl"), record);
          return;
        }
        record.mission = current.mission.id;
        record.pogoLoop = current.mission.pogoLoop;
        const file = join(current.dir, "usage.jsonl");
        await appendUsage(file, record);
        if (current.mission.status !== "running") return;
        const { config } = await loadEffectiveConfig(stateDir, env);
        const budget = checkBudgets(await loadUsage(file), config.budgets, current.mission.pogoLoop);
        const tripped = current.mission.breaker.consecutiveFailures >= config.breaker.consecutiveFailures;
        if (!budget.missionExceeded && !tripped) return;
        const reason = budget.missionExceeded
          ? `mission token budget exceeded (${budget.missionUsed} of ${config.budgets.missionTokens})`
          : `circuit breaker: ${current.mission.breaker.consecutiveFailures} consecutive failures`;
        const halted = await withMissionLock(current.dir, async () => {
          const fresh = await loadMission(current.dir);
          if (fresh === undefined || fresh.status !== "running") return false;
          await saveMission(current.dir, { ...fresh, status: "halted", statusReason: reason });
          return true;
        });
        if (halted) ctx.ui.notify(`Mission ${current.mission.id} halted: ${reason}.`, "warning");
      } catch (error) {
        logFailure("message_end", error);
      }
    },
  };
}

export function registerHooks(pi: ExtensionAPI, runtime: Runtime): void {
  const hooks = createHooks({
    runtime,
    env: process.env,
    getActiveTools: () => pi.getActiveTools(),
    setActiveTools: names => pi.setActiveTools(names),
  });
  pi.on("before_agent_start", (event, ctx) => hooks.beforeAgentStart(event, ctx));
  pi.on("before_subagent_spawn", event => hooks.beforeSubagentSpawn(event));
  pi.on("tool_call", (event, ctx) => hooks.toolCall(event, ctx));
  pi.on("message_end", (event, ctx) => hooks.messageEnd(event, ctx));
}
