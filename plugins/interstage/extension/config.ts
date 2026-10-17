import type { Autonomy, InterstageConfig, Lane } from "./contracts";

export const DEFAULT_CONFIG: InterstageConfig = {
  autonomy: "checkpoints",
  ship: "deny",
  budgets: { pogoLoopTokens: 150000, missionTokens: 2000000 },
  breaker: { consecutiveFailures: 5 },
  parallel: { worktrees: 4 },
  lanes: { enabled: ["fast", "standard", "full"], default: "standard" },
  verify: { command: "" },
};

interface MergeResult {
  config: InterstageConfig;
  errors: string[];
  unknownKeys: string[];
}

const AUTONOMY: Record<Autonomy, true> = { supervised: true, checkpoints: true, autopilot: true };
const LANES: Record<Lane, true> = { fast: true, standard: true, full: true };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * Deep-merges `override` over `base`. Invalid values are reported in `errors` and the base value is kept;
 * keys the schema does not know are listed in `unknownKeys` as dotted paths and ignored.
 */
export function mergeConfig(base: InterstageConfig, override: unknown): MergeResult {
  const config: InterstageConfig = structuredClone(base);
  const errors: string[] = [];
  const unknownKeys: string[] = [];
  if (override === undefined || override === null) return { config, errors, unknownKeys };
  if (!isRecord(override)) return { config, errors: ["config must be a mapping"], unknownKeys };

  const section = (key: string, known: readonly string[]): Record<string, unknown> | undefined => {
    const value = override[key];
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
      errors.push(`${key}: must be a mapping`);
      return undefined;
    }
    for (const k of Object.keys(value)) if (!known.includes(k)) unknownKeys.push(`${key}.${k}`);
    return value;
  };
  const positive = (path: string, value: unknown, assign: (n: number) => void): void => {
    if (value === undefined) return;
    if (isPositiveInt(value)) assign(value);
    else errors.push(`${path}: must be a positive integer`);
  };

  for (const k of Object.keys(override)) {
    if (!Object.hasOwn(base, k)) unknownKeys.push(k);
  }

  const autonomy = override.autonomy;
  if (autonomy !== undefined) {
    if (typeof autonomy === "string" && Object.hasOwn(AUTONOMY, autonomy)) config.autonomy = autonomy as Autonomy;
    else errors.push("autonomy: must be one of supervised, checkpoints, autopilot");
  }
  const ship = override.ship;
  if (ship !== undefined) {
    if (ship === "allow" || ship === "deny") config.ship = ship;
    else errors.push("ship: must be allow or deny");
  }

  const budgets = section("budgets", ["pogoLoopTokens", "missionTokens"]);
  if (budgets) {
    positive("budgets.pogoLoopTokens", budgets.pogoLoopTokens, n => (config.budgets.pogoLoopTokens = n));
    positive("budgets.missionTokens", budgets.missionTokens, n => (config.budgets.missionTokens = n));
  }
  const breaker = section("breaker", ["consecutiveFailures"]);
  if (breaker) positive("breaker.consecutiveFailures", breaker.consecutiveFailures, n => (config.breaker.consecutiveFailures = n));
  const parallel = section("parallel", ["worktrees"]);
  if (parallel) positive("parallel.worktrees", parallel.worktrees, n => (config.parallel.worktrees = n));

  const lanes = section("lanes", ["enabled", "default"]);
  if (lanes) {
    let enabled = config.lanes.enabled;
    let def = config.lanes.default;
    if (lanes.enabled !== undefined) {
      const list = lanes.enabled;
      if (
        Array.isArray(list) &&
        list.length > 0 &&
        list.every(l => typeof l === "string" && Object.hasOwn(LANES, l)) &&
        new Set(list).size === list.length
      ) {
        enabled = list as Lane[];
      } else {
        errors.push("lanes.enabled: must be a non-empty list of distinct lanes from fast, standard, full");
      }
    }
    if (lanes.default !== undefined) {
      if (typeof lanes.default === "string" && Object.hasOwn(LANES, lanes.default)) def = lanes.default as Lane;
      else errors.push("lanes.default: must be one of fast, standard, full");
    }
    if (enabled.includes(def)) {
      config.lanes = { enabled: [...enabled], default: def };
    } else {
      errors.push(`lanes.default: "${def}" must be in lanes.enabled`);
    }
  }

  const verify = section("verify", ["command"]);
  if (verify && verify.command !== undefined) {
    if (typeof verify.command === "string") config.verify.command = verify.command;
    else errors.push("verify.command: must be a string");
  }

  return { config, errors, unknownKeys };
}

async function readYaml(path: string, errors: string[]): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return Bun.YAML.parse(await file.text());
  } catch (e) {
    errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** Precedence: defaults, then the user file, then the project file. Missing files are fine. */
export async function loadConfig(paths: { userPath: string; projectPath: string }): Promise<MergeResult> {
  const errors: string[] = [];
  const unknownKeys: string[] = [];
  let config = DEFAULT_CONFIG;
  for (const path of [paths.userPath, paths.projectPath]) {
    const parsed = await readYaml(path, errors);
    const merged = mergeConfig(config, parsed);
    config = merged.config;
    errors.push(...merged.errors.map(e => `${path}: ${e}`));
    unknownKeys.push(...merged.unknownKeys);
  }
  return { config, errors, unknownKeys };
}
