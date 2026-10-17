// Activation (CONTRACTS section 9): flag handling, env exports, runtime overrides and the CAPCOM persona.

import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { AGENT_NAMES, ENV_MISSION_ID, ENV_STATE_DIR, FLAG_NAME } from "./contracts";
import { findActiveMission } from "./state";
import type { GitExec } from "./tools";

/** Per-session flags shared by activation, hooks and commands. Children get a fresh instance. */
export interface Runtime {
  /** True once this main session runs as Interstage (flag at startup or `/interstage:launch`). */
  active: boolean;
  /** The persona problem was already shown to the user. */
  personaErrorShown: boolean;
}

export function createRuntime(): Runtime {
  return { active: false, personaErrorShown: false };
}

/** Runtime-only access to OMP settings by id. Writes never persist. */
export interface SettingsPort {
  get(id: string): unknown;
  override(id: string, value: unknown): void;
  clearOverride(id: string): void;
}

/** Settings port over the OMP registry, resolved per call (ids are registered by OMP before extensions run). */
export function createSettingsPort(pi: ExtensionAPI): SettingsPort {
  const handle = (id: string) => {
    const setting = lookup(id);
    if (setting === undefined) throw new Error(`OMP has no setting ${id}`);
    return setting;
  };
  return {
    get: id => handle(id).get(pi.pi.settings),
    override: (id, value) => handle(id).override(pi.pi.settings, value),
    clearOverride: id => handle(id).clearOverride(pi.pi.settings),
  };
}

function guarded(errors: string[], id: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Overrides for an Interstage session. Merge-safe: never lowers the user's own recursion depth. Returns errors. */
export function applyActiveOverrides(settings: SettingsPort): string[] {
  const errors: string[] = [];
  guarded(errors, "task.disabledAgents", () => settings.clearOverride("task.disabledAgents"));
  guarded(errors, "task.maxRecursionDepth", () => {
    const current = settings.get("task.maxRecursionDepth");
    // A negative depth means unlimited in OMP: raising it to 3 would lower it, so leave it alone.
    if (typeof current === "number" && current < 0) return;
    settings.override("task.maxRecursionDepth", Math.max(typeof current === "number" ? current : 0, 3));
  });
  for (const [id, value] of [
    ["task.isolation.enabled", true],
    ["task.isolation.merge", "branch"],
    ["task.isolation.apply", false],
    ["task.enableLsp", true],
    ["github.enabled", true],
  ] as const) {
    guarded(errors, id, () => settings.override(id, value));
  }
  return errors;
}

/** Without the flag the Interstage agents stay hidden: the user's disabled list plus every Interstage agent. */
export function applyInactiveOverrides(settings: SettingsPort): string[] {
  const errors: string[] = [];
  guarded(errors, "task.disabledAgents", () => {
    const current = settings.get("task.disabledAgents");
    const user = Array.isArray(current) ? current.filter((name): name is string => typeof name === "string") : [];
    settings.override("task.disabledAgents", [...new Set([...user, ...AGENT_NAMES])]);
  });
  return errors;
}

export function personaPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.INTERSTAGE_PERSONA_FILE;
  return override !== undefined && override !== "" ? override : resolve(import.meta.dirname, "..", "persona", "capcom.md");
}

export async function loadPersona(env: NodeJS.ProcessEnv = process.env): Promise<{ text: string } | { error: string }> {
  const path = personaPath(env);
  try {
    const text = await readFile(path, "utf8");
    if (text.trim() === "") return { error: `The CAPCOM persona file ${path} is empty.` };
    return { text };
  } catch {
    return { error: `The CAPCOM persona file ${path} cannot be read; CAPCOM will run without its persona.` };
  }
}

export interface ActivationDeps {
  exec: GitExec;
  notify: (message: string, type?: "info" | "warning" | "error") => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  settings: SettingsPort;
  runtime: Runtime;
}

/** Project root for the state directory: the git top level, otherwise the working directory. */
export async function projectRoot(exec: GitExec, cwd: string): Promise<string> {
  try {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    if (top.code === 0 && top.stdout.trim() !== "") return top.stdout.trim();
  } catch {
    // not a repository, or git is missing: fall through to the working directory
  }
  return cwd;
}

/** Export the environment, apply the overrides and mark the session active. Safe to call twice. */
export async function activate(deps: ActivationDeps): Promise<void> {
  const { env, notify, runtime } = deps;
  if (env[ENV_STATE_DIR] === undefined || env[ENV_STATE_DIR] === "") {
    env[ENV_STATE_DIR] = join(await projectRoot(deps.exec, deps.cwd), ".interstage");
  }
  const stateDir = env[ENV_STATE_DIR] ?? "";
  await mkdir(stateDir, { recursive: true });
  if (env[ENV_MISSION_ID] === undefined || env[ENV_MISSION_ID] === "") {
    const resumed = await findActiveMission(stateDir);
    if (resumed !== undefined) {
      env[ENV_MISSION_ID] = resumed;
      notify(`Resuming Interstage mission ${resumed}.`, "info");
    }
  }
  const errors = applyActiveOverrides(deps.settings);
  if (errors.length > 0) notify(`Interstage could not apply some OMP settings: ${errors.join("; ")}`, "warning");
  runtime.active = true;
  const persona = await loadPersona(env);
  if ("error" in persona && !runtime.personaErrorShown) {
    runtime.personaErrorShown = true;
    notify(persona.error, "error");
  }
}

export interface SessionStartDeps extends ActivationDeps {
  flag: boolean;
}

/**
 * Main-session start: the flag turns Interstage on, its absence hides the agents. A failure while activating is
 * shown to the user as an error (the session would otherwise silently be plain OMP) and the agents stay hidden.
 */
export async function onSessionStart(deps: SessionStartDeps): Promise<void> {
  try {
    if (deps.flag) {
      await activate(deps);
      return;
    }
    const errors = applyInactiveOverrides(deps.settings);
    if (errors.length > 0) deps.notify(`Interstage could not hide its agents: ${errors.join("; ")}`, "warning");
  } catch (error) {
    deps.runtime.active = false;
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[interstage] session_start failed:", error);
    deps.notify(`Interstage could not start: ${reason}. Interstage is not active in this session; this is plain OMP.`, "error");
    if (deps.flag) applyInactiveOverrides(deps.settings);
  }
}

export function registerActivation(pi: ExtensionAPI, runtime: Runtime): void {
  pi.registerFlag(FLAG_NAME, {
    description: "Run this session as Interstage: CAPCOM talks to you and delegates to the specialist agents",
    type: "boolean",
    default: false,
  });
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.agent.kind !== "main") return;
    await onSessionStart({
      flag: pi.getFlag(FLAG_NAME) === true,
      exec: (command, args, options) => pi.exec(command, args, { cwd: options.cwd }),
      notify: ctx.ui.notify.bind(ctx.ui),
      cwd: ctx.cwd,
      env: process.env,
      settings: createSettingsPort(pi),
      runtime,
    });
  });
}
