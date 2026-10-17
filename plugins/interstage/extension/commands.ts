// Slash commands: /interstage:init, launch, status, abort, doctor. The logic takes a plain environment object so
// it can be tested with fakes; `registerCommands` builds the real one from OMP's context.

import { mkdir, readFile, stat, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup, type Setting } from "@oh-my-pi/pi-coding-agent/config/registry";
import { activate, createSettingsPort, projectRoot, type Runtime } from "./activation";
import { checkBudgets, sumCacheReads } from "./budget";
import { DEFAULT_CONFIG } from "./config";
import { ENV_MISSION_ID, ENV_STATE_DIR, type ItemState } from "./contracts";
import { listMissionIds, loadApprovals, loadEffectiveConfig, loadItems, loadMission, loadUsage, missionDirOf, saveMission, userConfigPath, withMissionLock } from "./state";
import type { GitExec } from "./tools";

type Notify = (message: string, type?: "info" | "warning" | "error") => void;

export interface CommandEnv {
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    notify: Notify;
  };
  cwd: string;
  env: NodeJS.ProcessEnv;
  exec: GitExec;
  /** Authenticated models as `provider/id`. */
  listModels(): string[];
  getRoles(): Record<string, string>;
  /** Persisted write of one `modelRoles` entry; other entries are untouched. */
  setRole(role: string, model: string): void;
}

/** Tier of the three wizard answers that each Interstage role takes. */
export const ROLE_TIERS: Record<string, "strong" | "balanced" | "fast"> = {
  capcom: "strong",
  orchestrator: "strong",
  planner: "strong",
  reviewer: "strong",
  coder: "balanced",
  scout: "fast",
};

const GITIGNORE_ENTRY = ".interstage/";

function configTemplate(): string {
  const c = DEFAULT_CONFIG;
  return [
    "# Interstage configuration. Project overrides live in <project>/.interstage/config.yml.",
    `autonomy: ${c.autonomy}        # supervised | checkpoints | autopilot`,
    `ship: ${c.ship}                   # allow | deny (autopilot only ships when allow)`,
    "budgets:",
    `  pogoLoopTokens: ${c.budgets.pogoLoopTokens}`,
    `  missionTokens: ${c.budgets.missionTokens}`,
    "breaker:",
    `  consecutiveFailures: ${c.breaker.consecutiveFailures}`,
    "parallel:",
    `  worktrees: ${c.parallel.worktrees}`,
    "lanes:",
    `  enabled: [${c.lanes.enabled.join(", ")}]`,
    `  default: ${c.lanes.default}`,
    "verify:",
    '  command: ""                # optional project test command override',
    "",
  ].join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

const IGNORE_FORMS: Record<string, true> = { ".interstage": true, ".interstage/": true, "/.interstage": true, "/.interstage/": true };

export function gitignoreHasEntry(text: string | undefined): boolean {
  return (text ?? "").split(/\r?\n/).some(line => Object.hasOwn(IGNORE_FORMS, line.trim()));
}

// -- init -------------------------------------------------------------------------------------------------------

export async function runInit(c: CommandEnv): Promise<void> {
  const root = await projectRoot(c.exec, c.cwd);
  const summary: string[] = [];
  await mkdir(join(root, ".interstage"), { recursive: true });
  summary.push(`State directory ${join(root, ".interstage")} is ready.`);

  const ignorePath = join(root, ".gitignore");
  const ignore = await readIfExists(ignorePath);
  if (gitignoreHasEntry(ignore)) {
    summary.push(".gitignore already lists .interstage/.");
  } else if (await c.ui.confirm("Add .interstage/ to .gitignore?", `Interstage keeps mission state in ${join(root, ".interstage")}. I will append \`${GITIGNORE_ENTRY}\` to ${ignorePath} and will not commit it.`)) {
    const prefix = ignore === undefined || ignore === "" || ignore.endsWith("\n") ? "" : "\n";
    await appendFile(ignorePath, `${prefix}${GITIGNORE_ENTRY}\n`);
    summary.push(`Added ${GITIGNORE_ENTRY} to .gitignore (not committed).`);
  } else {
    summary.push(".gitignore left unchanged; .interstage/ will show up as untracked.");
  }

  const models = c.listModels();
  if (models.length === 0) {
    summary.push("No authenticated models are available, so the model roles were not set; log in to a provider and run /interstage:init again.");
  } else {
    const picks: Partial<Record<"strong" | "balanced" | "fast", string>> = {};
    const prompts: Record<"strong" | "balanced" | "fast", string> = {
      strong: "Strong model (capcom, orchestrator, planner, reviewer)",
      balanced: "Balanced model (coder)",
      fast: "Fast model (scout)",
    };
    for (const tier of ["strong", "balanced", "fast"] as const) {
      const choice = await c.ui.select(prompts[tier], models);
      if (choice === undefined) break;
      picks[tier] = choice;
    }
    if (picks.strong === undefined || picks.balanced === undefined || picks.fast === undefined) {
      summary.push("Model setup was cancelled; no roles were changed.");
    } else {
      for (const [role, tier] of Object.entries(ROLE_TIERS)) c.setRole(role, picks[tier] ?? "");
      summary.push(`Model roles set: strong=${picks.strong}, balanced=${picks.balanced}, fast=${picks.fast}.`);
    }
  }

  const configPath = userConfigPath(c.env);
  if (await exists(configPath)) {
    summary.push(`${configPath} already exists and was left alone.`);
  } else {
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(configPath, configTemplate());
    summary.push(`Wrote default settings to ${configPath}.`);
  }
  c.ui.notify(summary.join("\n"), "info");
}

// -- status -----------------------------------------------------------------------------------------------------

export async function runStatus(c: CommandEnv): Promise<void> {
  const stateDir = c.env[ENV_STATE_DIR];
  if (stateDir === undefined || stateDir === "") {
    c.ui.notify("Interstage is not active in this session; run /interstage:launch or start omp with --interstage.", "warning");
    return;
  }
  const id = c.env[ENV_MISSION_ID];
  if (id === undefined || id === "") {
    c.ui.notify("Interstage is active and no mission is running.", "info");
    return;
  }
  const dir = missionDirOf(stateDir, id);
  const mission = await loadMission(dir);
  if (mission === undefined) {
    c.ui.notify(`Mission ${id} has no mission.json under ${stateDir}.`, "error");
    return;
  }
  const items = await loadItems(dir);
  const { config } = await loadEffectiveConfig(stateDir, c.env);
  const usage = await loadUsage(join(dir, "usage.jsonl"));
  const budget = checkBudgets(usage, config.budgets, mission.pogoLoop);
  const approvals = await loadApprovals(dir);
  const counts: Partial<Record<ItemState, number>> = {};
  for (const item of items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  const states = Object.entries(counts).map(([state, n]) => `${state} ${n}`).join(", ");
  const lines = [
    `Mission ${mission.id}: ${mission.title}`,
    `Status: ${mission.status}${mission.statusReason === undefined ? "" : ` (${mission.statusReason})`}; lane ${mission.lane}; autonomy ${mission.autonomy}`,
    `Branch: ${mission.branch} (base ${mission.baseBranch} @ ${mission.baseSha.slice(0, 9)})`,
    `Items: ${items.length === 0 ? "none planned yet" : states}`,
    ...items.map(item => `  ${item.id} [${item.state}] ${item.title}${item.failures > 0 ? ` (failures ${item.failures})` : ""}`),
    `Budget (billable tokens, cache reads excluded): mission ${budget.missionUsed} of ${config.budgets.missionTokens}; Pogo loop ${mission.pogoLoop} ${budget.pogoUsed} of ${config.budgets.pogoLoopTokens}; cache reads (not counted) ${sumCacheReads(usage)}`,
    `Breaker: ${mission.breaker.consecutiveFailures} of ${config.breaker.consecutiveFailures} consecutive failures`,
  ];
  const pending = approvals.filter(a => a.status === "pending");
  if (pending.length > 0) lines.push(`Pending approvals: ${pending.map(a => `${a.gate} ${a.ref}`).join("; ")}`);
  c.ui.notify(lines.join("\n"), "info");
}

// -- abort ------------------------------------------------------------------------------------------------------

export async function runAbort(c: CommandEnv): Promise<void> {
  const stateDir = c.env[ENV_STATE_DIR];
  const id = c.env[ENV_MISSION_ID];
  if (stateDir === undefined || stateDir === "" || id === undefined || id === "") {
    c.ui.notify("There is no active mission to abort.", "warning");
    return;
  }
  const dir = missionDirOf(stateDir, id);
  const mission = await loadMission(dir);
  if (mission === undefined || mission.status === "aborted" || mission.status === "complete") {
    c.ui.notify(`Mission ${id} is ${mission?.status ?? "missing"}; nothing to abort.`, "warning");
    return;
  }
  const git = (...args: string[]) => c.exec("git", args, { cwd: c.cwd });
  const dirty = await git("status", "--porcelain", "--untracked-files=no");
  if (dirty.stdout.trim() !== "") {
    c.ui.notify("The working tree has uncommitted changes; commit or stash them before aborting the mission.", "error");
    return;
  }
  const items = await loadItems(dir);
  const listed = await git("branch", "--list", "--format=%(refname:short)", "omp/task/*");
  const existing = new Set(listed.stdout.split("\n").map(line => line.trim()).filter(Boolean));
  // OMP names retry branches omp/task/<ID>-2, -3: delete the base branch and every numbered retry of this mission's items.
  const taskBranches = [...existing].filter(branch => items.some(item => branch === `omp/task/${item.id}` || new RegExp(`^omp/task/${item.id}-\\d+$`).test(branch)));
  const confirmed = await c.ui.confirm(
    `Abort mission ${id}?`,
    `This checks out ${mission.baseBranch} and permanently deletes the branch ${mission.branch}${taskBranches.length > 0 ? ` and ${taskBranches.join(", ")}` : ""}, including any commits on them.`,
  );
  if (!confirmed) {
    c.ui.notify("Abort cancelled.", "info");
    return;
  }
  const checkout = await git("checkout", mission.baseBranch);
  if (checkout.code !== 0) {
    c.ui.notify(`git checkout ${mission.baseBranch} failed: ${checkout.stderr.trim().split("\n")[0] ?? "unknown error"}. Nothing was deleted.`, "error");
    return;
  }
  const problems: string[] = [];
  for (const branch of [mission.branch, ...taskBranches]) {
    const deleted = await git("branch", "-D", branch);
    if (deleted.code !== 0) problems.push(`${branch}: ${deleted.stderr.trim().split("\n")[0] ?? "delete failed"}`);
  }
  await withMissionLock(dir, async () => {
    const fresh = (await loadMission(dir)) ?? mission;
    await saveMission(dir, { ...fresh, status: "aborted", statusReason: "aborted by the user" });
  });
  c.ui.notify(
    `Mission ${id} aborted; ${mission.baseBranch} is checked out.${problems.length > 0 ? ` Some branches were not deleted: ${problems.join("; ")}` : ""}`,
    problems.length > 0 ? "warning" : "info",
  );
}

// -- doctor -----------------------------------------------------------------------------------------------------

interface ToolCheck {
  bin: string;
  purpose: string;
  hint: string;
}

const LANGUAGES: { name: string; markers: string[]; tools: ToolCheck[] }[] = [
  {
    name: "TypeScript/JavaScript",
    markers: ["package.json", "tsconfig.json"],
    tools: [
      { bin: "node", purpose: "runtime", hint: "install Node.js from https://nodejs.org" },
      { bin: "typescript-language-server", purpose: "language server", hint: "npm install -g typescript-language-server typescript" },
      { bin: "eslint", purpose: "linter (optional)", hint: "npm install -D eslint" },
      { bin: "biome", purpose: "linter and formatter (optional)", hint: "npm install -D @biomejs/biome" },
    ],
  },
  {
    name: "Python",
    markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"],
    tools: [
      { bin: "python3", purpose: "runtime", hint: "install Python from https://www.python.org/downloads/" },
      { bin: "pyright", purpose: "language server", hint: "npm install -g pyright" },
      { bin: "ruff", purpose: "linter", hint: "pip install ruff" },
      { bin: "pytest", purpose: "test runner", hint: "pip install pytest" },
    ],
  },
  {
    name: "Go",
    markers: ["go.mod"],
    tools: [
      { bin: "go", purpose: "toolchain and test runner (go test)", hint: "install Go from https://go.dev/dl/" },
      { bin: "gopls", purpose: "language server", hint: "go install golang.org/x/tools/gopls@latest" },
      { bin: "golangci-lint", purpose: "linter (optional)", hint: "see https://golangci-lint.run/welcome/install/" },
    ],
  },
  {
    name: "Rust",
    markers: ["Cargo.toml"],
    tools: [
      { bin: "cargo", purpose: "toolchain and test runner (cargo test)", hint: "install Rust from https://rustup.rs" },
      { bin: "rust-analyzer", purpose: "language server", hint: "rustup component add rust-analyzer" },
      { bin: "cargo-clippy", purpose: "linter", hint: "rustup component add clippy" },
    ],
  },
  {
    name: "Ruby",
    markers: ["Gemfile"],
    tools: [
      { bin: "ruby", purpose: "runtime", hint: "install Ruby from https://www.ruby-lang.org/en/downloads/" },
      { bin: "solargraph", purpose: "language server", hint: "gem install solargraph" },
      { bin: "rubocop", purpose: "linter", hint: "gem install rubocop" },
      { bin: "rspec", purpose: "test runner", hint: "gem install rspec" },
    ],
  },
  {
    name: "Java",
    markers: ["pom.xml", "build.gradle", "build.gradle.kts"],
    tools: [
      { bin: "java", purpose: "runtime", hint: "install a JDK, for example from https://adoptium.net" },
      { bin: "jdtls", purpose: "language server", hint: "see https://github.com/eclipse-jdtls/eclipse.jdt.ls" },
    ],
  },
];

export interface DoctorEnv extends Pick<CommandEnv, "cwd" | "env" | "exec" | "getRoles"> {
  /** Absolute path of an executable on PATH, or null. */
  which(bin: string): string | null;
  ompVersion: string;
  bunVersion: string;
}

async function versionLine(c: DoctorEnv, bin: string, args: string[]): Promise<string | undefined> {
  if (c.which(bin) === null) return undefined;
  try {
    const out = await c.exec(bin, args, { cwd: c.cwd });
    return out.code === 0 ? (out.stdout.trim().split("\n")[0] ?? "") : undefined;
  } catch {
    return undefined;
  }
}

/** Read-only environment report. Never installs anything; missing tools get an install hint. */
export async function doctorReport(c: DoctorEnv): Promise<string> {
  const root = await projectRoot(c.exec, c.cwd);
  const lines: string[] = ["Interstage doctor (read-only)", ""];
  lines.push(`omp: ${c.ompVersion}`);
  lines.push(`bun: ${c.bunVersion}`);
  const git = await versionLine(c, "git", ["--version"]);
  lines.push(git === undefined ? "git: MISSING (install from https://git-scm.com)" : `git: ${git}`);
  const gh = await versionLine(c, "gh", ["--version"]);
  if (gh === undefined) {
    lines.push("gh: missing (optional; needed for pull requests; see https://cli.github.com)");
  } else {
    let authed = false;
    try {
      authed = (await c.exec("gh", ["auth", "status"], { cwd: c.cwd })).code === 0;
    } catch {
      authed = false;
    }
    lines.push(`gh: ${gh}; ${authed ? "authenticated" : "NOT authenticated (run gh auth login)"}`);
  }

  lines.push("", "Languages detected by marker files:");
  let any = false;
  for (const language of LANGUAGES) {
    const found: string[] = [];
    for (const marker of language.markers) if (await exists(join(root, marker))) found.push(marker);
    if (found.length === 0) continue;
    any = true;
    lines.push(`- ${language.name} (${found.join(", ")})`);
    for (const tool of language.tools) {
      const where = c.which(tool.bin);
      lines.push(where === null ? `    ${tool.bin} (${tool.purpose}): missing; install: ${tool.hint}` : `    ${tool.bin} (${tool.purpose}): ${where}`);
    }
  }
  if (!any) lines.push("- none of the known markers were found");

  const roles = c.getRoles();
  const missing = Object.keys(ROLE_TIERS).filter(role => !roles[role]);
  lines.push("", "Model roles:");
  for (const role of Object.keys(ROLE_TIERS)) lines.push(`- ${role}: ${roles[role] ?? "NOT SET"}`);
  if (missing.length > 0) lines.push(`Missing roles: ${missing.join(", ")}; run /interstage:init.`);

  const ignore = await readIfExists(join(root, ".gitignore"));
  lines.push("", gitignoreHasEntry(ignore) ? ".gitignore: lists .interstage/" : ".gitignore: does NOT list .interstage/; run /interstage:init");

  const { errors, unknownKeys } = await loadEffectiveConfig(join(root, ".interstage"), c.env);
  lines.push(errors.length === 0 ? "Config: no errors" : `Config errors:\n${errors.map(e => `- ${e}`).join("\n")}`);
  if (unknownKeys.length > 0) lines.push(`Unknown config keys (ignored): ${unknownKeys.join(", ")}`);

  const stateDir = c.env[ENV_STATE_DIR] ?? join(root, ".interstage");
  const activeId = c.env[ENV_MISSION_ID];
  if (activeId === undefined || activeId === "") {
    lines.push("Active mission: none (INTERSTAGE_MISSION_ID is not set)");
  } else {
    const found = await loadMission(missionDirOf(stateDir, activeId)).catch(() => undefined);
    lines.push(found === undefined ? `Active mission: ${activeId} does NOT resolve to a readable mission under ${stateDir}` : `Active mission: ${activeId} (${found.status}, branch ${found.branch})`);
  }
  const unfinished: string[] = [];
  for (const id of await listMissionIds(stateDir)) {
    const record = await loadMission(missionDirOf(stateDir, id)).catch(() => undefined);
    if (record === undefined) unfinished.push(`${id} (unreadable mission.json)`);
    else if (record.status !== "complete" && record.status !== "aborted") unfinished.push(`${id} (${record.status}): ${record.title}`);
  }
  lines.push(unfinished.length === 0 ? "Unfinished missions: none" : `Unfinished missions:\n${unfinished.map(entry => `- ${entry}`).join("\n")}`);
  return lines.join("\n");
}

// -- registration -----------------------------------------------------------------------------------------------

export function registerCommands(pi: ExtensionAPI, runtime: Runtime): void {
  const exec: GitExec = (command, args, options) => pi.exec(command, args, { cwd: options.cwd });
  const rolesSetting = () => {
    // `modelRoles` is a record setting of role -> model string; the registry types it as unknown.
    const setting = lookup("modelRoles") as Setting<Record<string, string>> | undefined;
    if (setting === undefined) throw new Error("OMP has no modelRoles setting");
    return setting;
  };
  const commandEnv = (ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1]): CommandEnv => ({
    ui: ctx.ui,
    cwd: ctx.cwd,
    env: process.env,
    exec,
    listModels: () => ctx.models.list().map(model => `${model.provider}/${model.id}`),
    getRoles: () => (rolesSetting().get(pi.pi.settings) ?? {}) as Record<string, string>,
    setRole: (role, model) => rolesSetting().setEntry(pi.pi.settings, role, model),
  });
  const register = (name: string, description: string, run: (c: CommandEnv, ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1]) => Promise<void>) => {
    pi.registerCommand(`interstage:${name}`, {
      description,
      handler: async (_args, ctx) => {
        try {
          await run(commandEnv(ctx), ctx);
        } catch (error) {
          ctx.ui.notify(`/interstage:${name} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    });
  };

  register("init", "Set up Interstage: state directory, .gitignore entry, model roles and default settings", runInit);
  register("launch", "Turn this session into an Interstage session (CAPCOM persona, specialist agents, runtime settings)", async (c, ctx) => {
    await activate({ exec, notify: c.ui.notify.bind(c.ui), cwd: ctx.cwd, env: process.env, settings: createSettingsPort(pi), runtime });
    c.ui.notify("Interstage is active: the CAPCOM persona applies from your next prompt.", "info");
  });
  register("status", "Show the active mission: state, items, budget and circuit breaker", runStatus);
  register("abort", "Abort the active mission and delete its branches (asks first)", runAbort);
  register("doctor", "Check the environment for Interstage (read-only; installs nothing)", async (c, ctx) => {
    const report = await doctorReport({
      cwd: c.cwd,
      env: c.env,
      exec: c.exec,
      getRoles: c.getRoles,
      which: bin => Bun.which(bin),
      ompVersion: (await c.exec("omp", ["--version"], { cwd: c.cwd }).catch(() => undefined))?.stdout.trim() || "unknown",
      bunVersion: Bun.version,
    });
    ctx.ui.notify(report, "info");
  });
}
