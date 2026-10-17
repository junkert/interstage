# Interstage: Design Decisions

Status: planning. Nothing is built. This file records decisions from the Q/A rounds. Open items are at the end.

## Goal

A framework for building software projects agentically, with [OMP](https://github.com/can1357/oh-my-pi) as the base orchestrator. It must:

1. Build software projects agentically.
2. Use OMP as the base orchestration software.
3. Make agents and skills easy to add (drop a file in a git repo).
4. Install simply.
5. Extend agents with LSP and MCP where appropriate.

Interstage is named after the rocket section that hands off cleanly between stages. NASA vocabulary is used for agent names. Commands use plain verbs.

## Architecture

- **Host:** OMP only. The old README mentions OpenCode and is stale.
- **Distribution:** user-scope OMP plugins. Nothing is committed into target projects, except the `.gitignore` edit described below.
- **Packaging:** one core plugin plus optional packs, all listed in a single `.omp-plugin/marketplace.json`.
- **Manifest:** OMP-native `package.json#omp`. Claude-dialect manifests discard agent `model` selectors, which Interstage needs.
- **Code:** content (agents, skills, commands, rules, MCP and LSP configs) plus one small TypeScript extension.
- **Scope:** software first. Keep the agent and skill layout generic enough for hardware later.

### Topology

```
user <-> CAPCOM (main session) -> Houston (project) -> Flight (mission) -> specialists
```

- CAPCOM is the only agent that talks to the user. The extension strips `ask` from every subagent.
- OMP's default `task.maxRecursionDepth` is 2. Interstage needs at least 3. The extension raises it with a runtime override.

### Activation (opt-in per session)

- Primary entry is the extension: `omp --interstage` (verified) and `/interstage:launch`.
- The extension sets runtime overrides: depth of at least 3, `task.isolation.enabled`, and branch merge mode.
- The extension swaps in the CAPCOM persona for the main session only, via `before_agent_start`.
- A shell alias or function is documented as optional. There is no wrapper binary and no PATH install.
- Plain `omp` keeps its behavior apart from the core plugin's visible skills. Agents, commands and persona only appear with `--interstage`.

### Extension duties (assumed; the answer was left blank)

1. Inject the CAPCOM persona into the main session only.
2. Enforce autonomy-level gates (`before_subagent_spawn`, `tool_call` hooks).
3. Read and write mission state in `.interstage/`, and expose `/interstage:status`.
4. Route models through role aliases (`@capcom`, `@planner`, `@scout`, `@coder`, `@reviewer`) resolved from the user's `modelRoles`.
5. Provide `/interstage:init`, which creates `.interstage/` and adds it to `.gitignore`. It tells the user before editing and never commits.
6. Override `task.enableLsp` so subagents can use the `lsp` tool.

### Commands

Extension-registered: `/interstage:init`, `:launch`, `:status`, `:abort`, `:doctor`. Markdown commands in the plugin's `commands/` are namespaced automatically: `:plan` (with `--lane`), `:import`, `:promote`.

## Install

- The README documents 2-3 `omp plugin` commands: add the marketplace, install core, optionally install packs.
- `install.sh [--packs web,data]` is an optional thin wrapper. It checks the omp version, adds the marketplace, installs core and the chosen packs, and runs a doctor check.
- The default install is core only. Packs are opt-in.
- OMP has no plugin dependency mechanism, so packs detect a missing core and tell the user.

## Configuration

- User defaults: `~/.omp/agent/interstage.yml`.
- Project override: `.interstage/config.yml`.
- Settings include autonomy level, adversarial token-budget ceiling, circuit-breaker thresholds, parallelism cap and enabled lanes.
- `/interstage:init` runs a first-run wizard that writes `modelRoles` to the user's OMP config.

## Project state

- Everything lives under `.interstage/`, for example `.interstage/missions/<id>/{SPEC,TODO,decisions,evidence}.md`.
- `.interstage/` is added to the project `.gitignore`.
- Promoting `AGENTS.md` or the spec into the repo is opt-in via `/interstage:promote`.
- Memory is two parts: a plain-file decision log in `.interstage/`, and OMP `retain`/`recall` for heuristics.

## Roster (v1)

| Agent | Role | Primary skills |
|---|---|---|
| CAPCOM | User-facing project manager (main session) | |
| Houston | Project orchestrator | |
| Flight | Mission sub-orchestrator running the Ralph-style loop | Interstage-native loop prompt (derived from `ralph-wiggum-loop` and `ai-collab-dev`), `baby-steps` |
| FIDO | Planner and architect | `exhaustive-specification`, `data-flow-architect`, `best-practice-guide` |
| Sojourner, Ingenuity | Read-only scouts (cheap and broad) | `context-pack` |
| Hubble | Research: libraries, docs, prior art | |
| Perseverance | Long-running implementer (migrations, refactors) | `code-migration`, `dependency-upgrade`, `baby-steps` |
| Curiosity | General implementer | `baby-steps` |
| Go/No-Go | QA | `testing-*`, `test-*` |
| Orbiter | Integration, e2e and contract tests | `testing-integration`, `testing-e2e`, `testing-api` |
| Inspector | Independent verifier and gap analyst | `trust-but-verify`, `completeness-validator`, `reality-validation`, `testing-expected-results`, `gap-analysis`, `spec-gap-analysis`, `test-gap-analysis` |
| Kessler | Security review (static only: code, config, dependencies, threat models) | `redteam`, `white-hat`, `security-scan`, `testing-security`, without the upstream scripts |
| Pogo | Devil's advocate on plans, specs and assumptions | `devils-advocate`, `assumption-buster`, `assumption-testing`, `adversarial-thinking` |
| Tiger Team | Debugging and incident response | `sherlock-debugging`, `stepwise-testing`, `incident-response`, `log-analysis-parsing` |
| Booster | DevOps and CI | `git-release` |
| Golden Record | Documentation | `api-documentation`, `index` (writes `_index.md` files into the repo only on explicit request) |

Skill names in the table are upstream names. In the repo each carries an `is-` prefix. Agents autoload 1-3 core skills and read the rest on demand.

### Packs

| Pack | Skills |
|---|---|
| observability | `logging-fundamentals`, `logging-performance-optimization`, `log-management-system`, `log-analysis-parsing`, `distributed-tracing-logs`, `observability-logging` |
| web | `react-review`, `accessibility-audit`, `testing-accessibility`, `vercel-deploy`, `testing-usability` |
| data | `database-optimization`, `data-validation`, `data-flow-architect`, `testing-database` |
| ops | `cloud-cost-optimization`, `performance-profiling`, `dependency-upgrade`, `code-migration`, `incident-response` |
| forge | `skill-builder`, `hypercognitive-skill-compiler`, `dogfooding` |

Out of v1: `opencode-config`, `notebooklm-federated-specs`.

Some skills appear in both the core roster and a pack. The final placement is decided during skill adaptation.

## Mission lifecycle

CAPCOM sizes each request into a lane. The user can override the lane.

| Lane | Path |
|---|---|
| fast | CAPCOM -> coder -> Inspector |
| standard | FIDO plan + Pogo review -> Flight build loop |
| full | Discovery interview, spec and adversarial loops (ai-collab-dev steps 3-9), then the Flight build loop |

- **Intake:** CAPCOM runs a discovery interview. `/interstage:import` ingests an outside brainstorm conversation.
- **Adversarial loops:** Pogo reviews the spec, prompts and TODO. Each loop runs until no blocker-severity gaps remain, bounded by a token-budget ceiling.
- **Build loop:** Flight spawns a fresh subagent per TODO item: builder, then verifier, then planner when stuck.
  - Stuck rule: 3 failures on one item means revise the spec, not the code.
  - Items carry `depends:` fields. Flight schedules independent items in parallel, each in an isolated git worktree. There is no DAG engine.
- **Steering:** the user steers through CAPCOM, never by editing a build session. CAPCOM routes each change to the artifact that owns the problem. Steering packets are small JSON files that interrupt, redirect or reprioritize a running loop.
- **Safety:** circuit breaker (consecutive failures or cost cap), state snapshots with replay from a checkpoint, and human checkpoints that follow the autonomy level.
- **Git:** one mission branch, one commit per verified TODO item, no push. `/interstage:abort` resets the branch.
- **Autonomy:** configurable per project, `supervised`, `checkpoints` (default) or `autopilot`. Gate points:

  | Gate | supervised | checkpoints | autopilot |
  |---|---|---|---|
  | A. Accept plan / SPEC | yes | yes | no |
  | B. Accept each Pogo-revised TODO | yes | no | no |
  | C. Every commit onto the mission branch | yes | no | no |
  | D. Implementer dependency install or network call | yes | no | no |
  | E. Merge parallel worktrees | yes | no | no |
  | F. Ship (push, PR, deploy via Booster) | yes | yes | no |
  | G. Circuit-breaker trip | stops | stops | stops |

  Autopilot still halts on a circuit-breaker trip. It never pushes or deploys unless `ship: allow` is set explicitly.
- **Severity scale** (Pogo, Inspector, Kessler, Go/No-Go): `blocker`, `major`, `minor`, `nit`. A review is clean when it has zero blockers and zero majors.
  - Blocker: wrong behavior, data loss, a security hole, or an item that cannot be built without asking.
  - Major: likely rework.
  - Minor and nit are logged and never gate.
- **Default budgets** (all overridable in `interstage.yml`):

  | Budget | Default |
  |---|---|
  | Tokens per Pogo loop | 150k |
  | Tokens per mission | 2M |
  | Circuit breaker | 5 consecutive failures |
  | Parallel worktrees | 4 |

  When a Pogo loop hits its cap, it escalates to CAPCOM.

Dropped from Ralph: Python runner, plugin system, DAG and saga engine, OTel, dashboard, Slack.

## LSP and MCP

### LSP

OMP ships about 40 language servers in `defaults.json`, auto-detected per project by root markers and binary on PATH. Interstage ships no per-language LSP configs.

- Policy (assumed): implementers and verifiers run `lsp` diagnostics on changed files before reporting done. Inspector rejects "done" without clean diagnostics. This requires the extension to override `task.enableLsp` to true, and each such agent to declare `lsp` in `tools:`.
- `/interstage:doctor` (assumed): detects project languages and reports missing language servers, test runners and linters, with install commands. It never installs anything. Without a server the `lsp` tool answers `No language server found`.
- Overrides are shipped only where a default is wrong for agent work. None are planned.

### MCP

- OMP's built-in `lsp`, `browser`, `github`, `web_search` and AST tools are used first.
- Candidate servers: Context7, GitHub, Playwright (only if the built-in browser tool falls short), sequential-thinking and memory.
- MCP servers ship disabled. `/interstage:init` asks which to enable for the project and what auth each needs.
- Constraint: a task agent's `tools:` list does not remove MCP tools. Subagents inherit all session MCP tools. Per-agent MCP assignment is therefore guidance in agent prompts, not enforcement.

## Skills and licensing

- Skills are vendored from `https://github.com/wojons/skills`.
- All 72 `SKILL.md` files declare `license: MIT`. The upstream root LICENSE is MIT, "Copyright (c) 2025 lexykwaii".
- Upstream identities are inconsistent:
  - LICENSE and `package.json` say `lexykwaii` (repo `lexykwaii/skills`).
  - Commits are by `Alexis Okuwa <wojons@...>`.
  - Skill READMEs link `wojons/skills`.
  - The local checkout's git remote is `junkert/skills`.
- Plan: ship `THIRD_PARTY_NOTICES.md` citing `wojons/skills`, with the upstream LICENSE verbatim and the source commit. Keep each skill's `license: MIT` frontmatter.
- Interstage itself is MIT.
- To confirm: which GitHub account owns the canonical upstream repo. This is a practical check, not legal advice.
- Vendored skills need adaptation: replace `compatibility: opencode` frontmatter and OpenCode-specific scripts.

## Skill adaptation

Audit of `/Users/levi/projects/skills/skills` (72 skills). Every skill has `compatibility: opencode` in its frontmatter and a templated per-skill `README.md` with an `npx skills add wojons/skills` install line. `SKILL.md` files total about 680 KB. There are 82 non-stub scripts (81 bash, 1 python) and 28 byte-identical placeholder `example.sh` stubs. The scripts are mostly grep, jq and find analysis helpers. Some use `stat`, `bc` or `date`/`sed` options that differ between macOS and Linux.

### Decisions

| Topic | Decision |
|---|---|
| Visibility | Skills stay visible in the skill list. The `--interstage` flag only gates agents, commands and persona. Only core skills are visible by default. Packs are opt-in installs, so their skills appear only when installed. Consequence: the claim "plain `omp` stays stock" is weakened to "plain `omp` gains the core skills in its skill list". |
| Names | Every vendored skill gets an `is-` prefix (for example `is-baby-steps`). A mapping table from upstream name to Interstage name is kept for syncing. |
| Loading | Each agent autoloads 1-3 core skills. The agent prompt lists other skills to read on demand with `skill://<name>`. |
| Scripts | Drop the stubs. Keep only scripts that a skill workflow actually calls, after a shellcheck and macOS/Linux portability pass. Anything unreviewed is left out. |
| Per-skill READMEs | Dropped (templated, install line points at upstream). |
| Security scope | Kessler is static review only in v1: code, config, dependencies and threat models. The upstream recon and scan scripts are not vendored. OMP's built-in `security_scan` tool is available. Active testing is out of scope. |
| Adversary behavior | No findings quota. Every finding needs evidence (file:line, repro or a cited spec clause). A clean report is valid. Applies to Pogo, Inspector and Kessler. This overrides the upstream "find at least 3 issues" rule in `HIERARCHICAL_AGENTS.md`. |
| Commit format | `<TODO-ID>: <imperative title>`, for example `T-014: Add JWT token generation`. Flight names each isolated task this way, since the task name becomes the commit message. |
| Spec depth | FIDO picks the spec set from the project type and the plan gate approves it. Always-on: Foundation and Quality specs. The "blind-person" detail standard applies to UI specs only. Other specs use "complete and unambiguous, nothing left to guess". The standard lane uses a single `SPEC.md`. Specs live in `.interstage/missions/<id>/specs/`. |

### Lifecycle skill dispositions

| Upstream skill | Disposition |
|---|---|
| `ai-collab-dev` | Rewritten as Interstage-native mission lifecycle docs and `/interstage:plan`. Keep `chunk-conversation.sh` (for `/interstage:import`) and `validate-todo.sh` (TODO checks) after the portability pass. Drop `setup-ralph-project.sh` (replaced by `/interstage:init`). |
| `ralph-wiggum-loop` | Rewritten as the Flight loop prompt, the steering-packet schema and the stuck rule. The Python runner, plugin system and dashboard are not shipped. |
| `workflow-orchestrator` | Dropped. Its patterns map to the fast, standard and full lanes. Its SKILL.md documents `npm run workflow:*` commands that do not match its three bundled shell scripts. |
| `baby-steps` | Vendored and trimmed. Keep the six rules and the context modes. Drop human-time step durations, overhead percentages, team coordination and PR cadence. Commits follow the format above. |
| `exhaustive-specification` | Vendored and tiered as above. |

Content derived from rewritten skills is still credited in `THIRD_PARTY_NOTICES.md`.

### Vendoring bookkeeping

- `THIRD_PARTY_NOTICES.md` carries the upstream LICENSE verbatim and the source commit.
- A manifest maps each vendored skill to its upstream path, the upstream commit, the Interstage name and whether it was modified.
- Frontmatter: remove `compatibility: opencode`, keep `license: MIT`, add the `is-` name. Unknown keys are preserved by OMP as metadata, so `metadata:` can stay.

## Spike results

Run with `omp` 18.11.3, headless (`-p`), `claude-haiku-4-5`, a throwaway extension and a throwaway marketplace plugin in `/tmp`. All five original spikes pass. The spikes also changed the design in four places.

| # | Question | Result |
|---|---|---|
| 1 | Does an extension-registered flag work on the CLI? | Yes. `pi.registerFlag("interstage", ...)` makes `omp --interstage` work, both with `-e <file>` and from an installed marketplace plugin. Flags are re-parsed after extensions load (`cli/extension-flags.ts`). Without the flag, nothing changes (no persona, depth stays 2). |
| 2 | Do runtime overrides hold in subagents? | Yes. `lookup(id).override(pi.pi.settings, v)` in `session_start` (main session, flag set) propagates to every child. Children report `task.maxRecursionDepth` 4, isolation on, merge `branch`. Without the override, a depth-3 spawn fails with `Cannot spawn another agent at task depth 2; maximum depth is 2`. |
| 3 | Depth-3 chain with isolated worktrees in branch merge mode? | Yes. Main -> L1 -> L2 -> two parallel `isolated: true` items at depth 3. Both produced one commit each on the current branch (linear history, commit message = task name) and the files are present. A conflicting pair (both overwrite `shared.txt`) merged one and left the other as an unmerged branch `omp/task/<name>`. The model reported the conflict. |
| 4 | How are `ask` tools stripped from subagents? | They are not provided. Subagent sessions have no `ask` tool, and declaring `ask` in agent `tools:` does not add it (the tool requires an interactive session). No extension code is needed. |
| 5 | Is a `before_agent_start` persona swap limited to the main session? | Yes. Return `{ systemPrompt: [...] }` only when `ctx.agent.kind === "main"` and the flag is set. Control run without the flag has no persona. |

### Design changes from the spikes

1. **Drop "strip `ask` from subagents"** from the extension duties. OMP already guarantees it.
2. **Subagents have no `lsp` tool by default.** `task.enableLsp` defaults to false. A custom agent declaring `tools: lsp` still got only `read, grep`. With `task.enableLsp` overridden to true, the same agent received `lsp`. The extension must set that override, or the LSP policy cannot work. Subagents also lack `todo`.
3. **The flag does not propagate.** In child sessions `pi.getFlag("interstage")` is `false`. Child-side logic must use `ctx.agent.kind` and mission state in `.interstage/`, never the flag.
4. **Plugin markdown commands are namespaced** as `/<plugin>:<command>`. A plugin named `interstage` gets `/interstage:plan` from `commands/plan.md` with no extension code. Extension-registered command names containing a colon (`interstage:status`) also work.

### Other confirmed behavior

- A marketplace plugin with an OMP-native `package.json#omp.extensions` manifest installs without a flag-validation failure. Its `agents/`, `skills/`, extension and `commands/` all load.
- `model: "@smol"` in a plugin agent resolved through the role alias. With `--smol claude-sonnet-4-5` the child ran sonnet while the main session ran haiku. Role aliases therefore survive in an OMP-native plugin.
- `autoload-skills: spike-skill` in agent frontmatter injected the skill content. The child answered with the skill's secret word.
- `before_subagent_spawn` receives `agent`, `invocationKind`, `modelRole`, `patterns` and `spawnKey`. Returning `{ block: true, reason }` fails the spawn and the reason reaches the caller.
- Slash commands run under `-p`.
- Subagent depth numbering: main is 0. CAPCOM (0) -> Houston (1) -> Flight (2) -> specialist (3) needs `task.maxRecursionDepth` of at least 3.
- Skill visibility: `disable-model-invocation: true` (and `hide: true`) remove a skill from the model-visible listing in plain `omp`, while `autoload-skills` still injects it into an agent. Not adopted for Interstage (see "Skill adaptation").
- Agent visibility: overriding `task.disabledAgents` to `["spikeagent"]` in a main session started without `--interstage` hid the plugin agent (the model saw no agents). With `--interstage` the agent spawned and ran.
- Skill and agent discovery is global once a plugin is installed. Without the override, skills and agents of an installed plugin appear in every `omp` session.

### Not verified

- Interactive TUI behavior: `ask` in the main session, and `/interstage:launch` mid-session.
- Many-item parallel merges and larger conflict cases. Flight must read each task result and handle leftover `omp/task/*` branches.
- `tool_call` hooks for gates D and E (dependency installs, merges). Only `before_subagent_spawn` was exercised.
- LSP diagnostics against a real server. None was installed for the test language, so the tool answered `No language server found`, which also shows `/interstage:doctor` is needed.
- Behavior on other `omp` versions, and when the user already has `modelRoles` or `task.*` settings configured.

## Framework testing (assumed; the answer was left blank)

- Static validation (script and CI): every agent frontmatter parses under OMP's rules, names are unique, every `autoloadSkills` entry exists, and vendored skills carry the MIT license and appear in `THIRD_PARTY_NOTICES.md`.
- Unit tests (`bun test`) for extension logic that prompts cannot enforce: autonomy gate decisions, budget and circuit-breaker accounting, severity "clean" evaluation, lane routing, `init` idempotency.
- Headless smoke test: run `omp` with the plugin against a small fixture repo in the fast lane. Assert the artifacts, mission branch and commit.
- Manual dogfood checklist per release.

## Hardware seams (assumed; the answer was left blank)

No hardware-specific design in v1. Build, test and verify commands are configurable per project so firmware, PCB, CAD or HDL packs can be added later without changing the core.

## Repository

- Origin: `https://github.com/junkert/interstage`. The marketplace is served from this repo.
- Distribution is via git and the OMP marketplace. npm is not used: OMP rejects npm marketplace sources ("npm plugin sources are not yet supported").

## Open questions

1. Skill adaptation: execute the dispositions above, and read `data-flow-architect`, `best-practice-guide`, `context-pack`, `completeness-validator` and the 25 or so thin `testing-*` skills before trimming them. Verify script portability on macOS and Linux.
2. Agents are hidden outside Interstage sessions through a `task.disabledAgents` override (verified). Confirm this still applies now that skills stay visible.
3. Confirm the assumptions marked "assumed" (extension duties, LSP policy and doctor, framework tests, hardware seams).
4. MCP: which servers `/interstage:init` offers, and how it handles credentials (for example the GitHub token).
5. Interactive-mode behavior was not spiked (see "Not verified" above).
