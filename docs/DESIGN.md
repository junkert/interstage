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

- CAPCOM is the only agent that talks to the user. OMP already withholds `ask` from subagent sessions, so specialists cannot ask the user.
- OMP's default `task.maxRecursionDepth` is 2. Interstage needs at least 3. The extension raises it with a runtime override.

### Activation (opt-in per session)

- Primary entry is the extension: `omp --interstage` (verified) and `/interstage:launch`.
- The extension sets runtime overrides: depth of at least 3, `task.isolation.enabled`, and branch merge mode.
- The extension swaps in the CAPCOM persona for the main session only, via `before_agent_start`.
- A shell alias or function is documented as optional. There is no wrapper binary and no PATH install.
- Plain `omp` keeps its behavior apart from what the core plugin adds globally: its skills in the skill list and the Context7 MCP server. Agents, commands and persona only appear with `--interstage`.

### Extension duties (confirmed)

1. Inject the CAPCOM persona into the main session only.
2. Enforce autonomy-level gates (`before_subagent_spawn`, `tool_call` hooks).
3. Read and write mission state in `.interstage/`, and expose `/interstage:status`.
4. Route models through role aliases (`@capcom`, `@planner`, `@scout`, `@coder`, `@reviewer`) resolved from the user's `modelRoles`.
5. Provide `/interstage:init`, which creates `.interstage/` and adds it to `.gitignore`. It tells the user before editing and never commits.
6. Override `task.enableLsp` so subagents can use the `lsp` tool.
7. When `--interstage` is absent, override `task.disabledAgents` so Interstage agents are hidden (verified).
8. Override `github.enabled` under `--interstage` so Booster's built-in `github` tool is available.
9. Block new spawns while a mission is paused, interrupted or halted (`before_subagent_spawn`, verified).
10. Track token budgets and circuit-breaker counters. The data source for per-session token usage is unverified.

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
| Flight | Mission sub-orchestrator running the loop in "Flight loop specification" | Interstage-native loop prompt (derived from `ralph-wiggum-loop` and `ai-collab-dev`); autoload `baby-steps` |
| FIDO | Planner and architect; also the loop's planner | autoload `exhaustive-specification`; on demand `data-flow-architect` (data pack) |
| Sojourner, Ingenuity | Read-only scouts (cheap and broad) | none; a scout handoff report format is part of the prompt |
| Hubble | Research: libraries, docs, prior art (Context7) | `best-practice-guide` (trimmed, on demand) |
| Perseverance | Long-running implementer (migrations, refactors) | autoload `migration`, `baby-steps` |
| Curiosity | General implementer | autoload `baby-steps` |
| Go/No-Go | QA runner and gate; verifier layers 1 and 5 (functional, integration) | autoload `test-pipeline`, `testing-expected-results`; on demand `test-strategy`, `testing-integration`, `testing-e2e`, pack testing skills |
| Orbiter | Integration, e2e and contract tests | autoload `testing-integration`, `testing-e2e`; on demand `testing-expected-results`, `test-pipeline` |
| Inspector | Independent verifier (layers 2-4: quality, spec compliance, edge cases) and gap analyst | autoload `verify-claims`, `test-gap-analysis`, `testing-expected-results`; on demand `spec-gap-analysis` |
| Kessler | Security review (static only: code, config, dependencies, CI, Dockerfiles, IaC) | autoload `security-review`; on demand `threat-modeling` |
| Pogo | Devil's advocate on plans, specs and assumptions | autoload `adversarial-review` |
| Tiger Team | Debugging and post-mortems | autoload `sherlock-debugging`, `stepwise-testing`; on demand `log-analysis` (observability pack) |
| Booster | DevOps, CI and release | autoload `git-release` |
| Golden Record | Documentation | autoload `api-documentation`; on demand `index` (propose-only) |

Skill names in the table are the Interstage names without the `is-` prefix; in the repo each directory and `name:` carries the prefix. Agents autoload 1-3 core skills and read the rest on demand. See "Remaining skill decisions" for what each absorbs.

### Packs

| Pack | Skills |
|---|---|
| observability | `structured-logging`, `tracing-correlation`, `log-analysis` |
| web | `web-review` |
| data | `database-optimization`, `data-validation`, `testing-database`, `data-flow-architect` |
| ops | `performance-profiling` (with `testing-performance`; chaos is opt-in) |
| forge | `forge` (Interstage-authored) plus a validator script |

Out of v1: `opencode-config`, `notebooklm-federated-specs`, and the skills listed under "Remaining skill decisions" as dropped.

Agent prompts that point at a pack skill (for example FIDO and `data-flow-architect`, Tiger Team and `log-analysis`, Go/No-Go and the pack testing skills) read it only if it is installed. A missing pack skill is never an error.

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

### Flight loop specification

Derived from the Ralph docs (`STEERING_PACKETS.md`, `PROMPT_ARCHITECTURE.md`, the three role prompts) and reconciled with the decisions above. Flight's agent prompt carries the loop. Specialists get their role from their own agent files, never from skills or root-level prompt files.

**Prompt layering.** Identity and standing rules are static (the agent file). Per-iteration steering goes into the task assignment that Flight passes in each `task` spawn: active task (TODO-ID, iteration, number of previous attempts), context (spec reference, files changed, tests passing or failing), previous-attempt analysis (error, root cause, file:line), instructions (primary goal, specific requirements, success criteria), evidence (failing output), next steps. Never put the current task in a role prompt, and never put role identity in an assignment. Mission state lives in `.interstage/missions/<id>/`.

**Roles in the loop.**

| Role | Played by | Inputs | Output |
|---|---|---|---|
| Builder | Curiosity or Perseverance | One TODO item with success conditions, its SPEC section, project conventions, similar code | Files changed, tests added and results, notes. Stops after one item. Reports blockers and open questions to Flight; never edits the TODO or user docs |
| Verifier, layers 1 and 5 | Go/No-Go | The item, its diff, the project's test command | Functional (tests pass, existing tests still pass, tests assert the right thing) and integration (build works, existing features, schema and API compatibility). Pass/fail only |
| Verifier, layers 2-4 | Inspector | Same | Code quality, spec compliance, edge cases (empty and invalid inputs, boundaries, resource limits, concurrency, meaningful errors). Findings with evidence and severity |
| Planner | FIDO | TODO, failure history, evidence, SPEC | Planning report: status, root cause, evidence, changes made, next steps, success criteria. Does not write code or verify |

An item passes only when both verifiers report clean (zero blockers, zero majors). "Cannot verify" is reported as unverified with evidence and never counts as a pass. Only Flight updates the TODO and commits (`<TODO-ID>: <imperative title>`).

**Failure and escalation policy.**

- One failure = the builder fails or reports BLOCKED, or a verifier returns at least one blocker or major.
- A failed item goes back to a fresh builder with the prior findings. After 3 failures on one item the planner revises the SPEC or TODO and that item's counter resets.
- At most 2 planner rounds per item. After that the item is `blocked` and Flight tells CAPCOM.
- The planner is also invoked on BLOCKED, on a strategic decision, on a redirect or reprioritize packet that changes the plan, and when an iteration produces no TODO state change and no commit. It is not invoked on every verifier rejection.
- Planner solutions by root cause: ambiguous task (clarify), missing context (add context), technical blocker (split), wrong approach (alternative), missing dependency (reorder), spec gap (extend spec), environment issue (document the workaround in the mission decisions file), finding without evidence (dismiss with a stated reason). Split when a task has more than one behavior or more than one verification command.
- Circuit breaker (gate G): 5 consecutive failures across the whole mission, counted in completion order. Any verified item resets it.

**Item states:** `pending`, `building`, `verifying`, `failed`, `planning`, `done`, `blocked`. **Mission states:** `running`, `paused`, `halted`, `complete`, `aborted`.

| # | Transition | Guard |
|---|---|---|
| 1 | pending -> building | All `depends:` done, a parallel slot is free (default 4), mission running, budget left |
| 2 | building -> verifying | Builder reports done and its own tests pass |
| 3 | building -> failed | Builder fails or reports BLOCKED |
| 4 | verifying -> done | Both verifiers clean. Flight commits and ticks the item |
| 5 | verifying -> failed | At least one blocker or major. Findings recorded |
| 6 | failed -> building | Failure counter below 3 |
| 7 | failed -> planning | Failure counter reached 3 |
| 8 | planning -> pending | Planner revised SPEC or TODO. Counter resets |
| 9 | planning -> blocked | Planner needs user input, or 2 planner rounds are used up. Flight reports to CAPCOM |
| 10 | any -> halted | Circuit breaker |
| 11 | running <-> paused | `pause` or `resume` packet, or a gate is waiting |
| 12 | any -> aborted | `/interstage:abort` |

**Steering packets.** CAPCOM or Flight writes small JSON files named `<seq>-<signal>.json` under `.interstage/missions/<id>/steering/`. Flight reads pending packets between items and applies them in `seq` order, interrupt and pause first, then moves each to `applied/` with a result. The extension blocks new spawns while the mission is paused or interrupted (`before_subagent_spawn`, verified). Running items finish. Killing a running subagent is out of scope for v1.

| Field | Meaning |
|---|---|
| `version` | Packet schema version |
| `seq` | Monotonic integer. Timestamps are stamped by the extension, never written by a model |
| `signal` | `interrupt`, `redirect`, `pause`, `resume`, `reprioritize` (orchestrator to Flight); `decision` (an open question returned by a specialist); `error`; `complete` |
| `context.current_task` | `id` (TODO-ID) and `spec_ref` |
| `context.failure_history` | Entries with attempt number, error and a file:line or finding reference |
| `evidence` | Files changed, test results, token use (feeds the budget) |
| `instructions` | `primary`, `constraints[]`, `success_criteria[]`, `next_steps[]` (the payload of redirect and reprioritize) |

Signal payloads: `interrupt` (`reason`, `preserve_context`), `redirect` (`new_phase`, `reason`, `keep_evidence`, and the artifact that owns the problem: spec, TODO or assignment), `pause` (`wait_for`), `resume` (`from_checkpoint`, a verified commit or state snapshot), `reprioritize` (`order: [TODO-IDs]`, optional `defer: [...]`; not an upstream signal, defined here), `decision` (`options`, `recommendation`), `error` (`error_type`, `recoverable`), `complete` (`success`, `artifacts`). Heartbeat, progress and checkpoint signals are dropped; they assume a runner.

Dropped from the upstream loop: root-level `PROMPT.md`, `AGENTS.md`, `ralph.yaml` and `.ralph/` files; the HumanReview state and any auto-approve on timeout (humans enter only through CAPCOM at autonomy gates); metrics and tracing; the `Critical/Major/Minor` scale (replaced by blocker, major, minor, nit); "APPROVED for merge" verdicts; "adjust standards" as a planner solution; the human-time "takes more than 1 hour" split criterion.

## LSP and MCP

### LSP

OMP ships about 40 language servers in `defaults.json`, auto-detected per project by root markers and binary on PATH. Interstage ships no per-language LSP configs.

- Policy: implementers and verifiers run `lsp` diagnostics on changed files before reporting done. Inspector rejects "done" without clean diagnostics. This requires the extension to override `task.enableLsp` to true, and each such agent to declare `lsp` in `tools:`.
- `/interstage:doctor`: detects project languages and reports missing language servers, test runners, linters, `gh` and its auth, with install commands. It never installs anything. Without a server the `lsp` tool answers `No language server found`.
- Overrides are shipped only where a default is wrong for agent work. None are planned.

### MCP

- OMP's built-in `lsp`, `browser`, `github`, `web_search`, `think`, memory (`retain`/`recall`) and AST tools are used first.
- v1 ships one MCP server: **Context7** (hosted at `https://mcp.context7.com/mcp`, no API key needed at lower rate limits). It is shipped enabled as `.mcp.json` at the root of the core plugin (verified). Consequence: Context7 is available in every omp session once the plugin is installed, like the core skills.
- Dropped, because OMP already provides them: GitHub MCP (the built-in `github` tool covers repo reads, search, PR create/checkout/push and Actions watching; it needs `gh` on PATH, `gh auth login` and `github.enabled`, which the extension turns on under `--interstage` and `/interstage:doctor` checks), memory MCP (OMP `retain`/`recall`), sequential-thinking MCP (built-in `think` and model thinking), and Playwright MCP (OMP silently drops standalone browser MCP servers while the built-in browser tool is on, so the built-in browser is used for e2e).
- Deferred: Docker MCP Gateway. Booster uses `bash docker ...`.
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

### Core skill decisions

Findings from reading `data-flow-architect`, `best-practice-guide`, `context-pack`, `completeness-validator` and the whole testing family. About 150 `npm run test:*` commands, plus an `npm run best-practice:*` block, refer to scripts that do not exist. Every adapted skill gets a pass that removes fictional commands, fabricated timestamps and sample scores, and human schedules.

| Skill | Decision |
|---|---|
| `context-pack` | Dropped. OMP's `read` (directories), `glob` and `grep` cover it, and subagents cannot use its TUI. A short "scout handoff report" format goes into the Sojourner and Ingenuity prompts. |
| `best-practice-guide` | Vendored and trimmed to about 2-3 KB. Gap detection and research-with-sources only. Hubble owns it, read on demand. Output goes to `.interstage/missions/<id>/research/`. Promotion into `AGENTS.md` or `docs/` only through `/interstage:promote`. The "create new skills" and fictional npm parts are removed. |
| `completeness-validator` | Folded into `verify-claims` (Tiers 1-2 only; Tier 3 production readiness, the multilingual-prompting trick and the `@completeness-validator` command are dropped). Fabricated timestamps and score examples are reworded as evidence-based findings. `anti-patterns.md` and `detection-guide.md` become on-demand references, trimmed. |
| `data-flow-architect` | Vendored and trimmed to about 6-7 KB (generic pattern catalogs and duplicated sections removed). Output goes to `.interstage/missions/<id>/specs/`. Human interview steps become "report open questions to Flight". FIDO reads it on demand. |
| `references/README.md` files | Dropped everywhere (placeholders or duplicates of SKILL.md), except `test-gap-analysis`'s real reference, which is folded into the consolidated skill. |

### Testing family

The 27 upstream testing skills (143 KB) consolidate into 8 dedicated testing skills (about 30 KB), and three more are absorbed elsewhere. Names carry the `is-` prefix.

| Interstage skill | Absorbs |
|---|---|
| `testing-expected-results` | `testing-expected-results` (verify.sh kept only if it passes the portability pass, otherwise methodology only) |
| `test-strategy` | `testing-level-selector`, `testing-level-poc`, `testing-level-mvp`, `testing-level-production`, `testing-ecosystem`, `test-planning`, `testing-functional-suite`, `testing-nonfunctional-suite` |
| `test-pipeline` | `test-orchestrator`, `test-dependency-mapper`, `testing-smoke`, `testing-regression` |
| `testing-integration` | `testing-integration`, `testing-api` |
| `testing-e2e` | `testing-e2e`, `testing-compatibility` |
| `test-gap-analysis` | `test-gap-analysis` (with its reference), `test-coverage` |
| `stepwise-testing` | `stepwise-testing` |
| `testing-database` (data pack) | `testing-database` |

`testing-accessibility`, `testing-performance` and `testing-security` are absorbed by `web-review`, `performance-profiling` (chaos stays opt-in) and `security-review` (static items only; DAST and pentest dropped). See "Remaining skill decisions".

Dropped outright: `testing-unit` (no unique content), `testing-usability` (needs human participants), `testing-functional-suite` and `testing-nonfunctional-suite` (pure aggregators).

Policy defaults for the family:

- Go/No-Go reports pass/fail only. It never says "safe to deploy"; shipping is gate F.
- Flaky tests are recorded as findings. They are never auto-retried or quarantined to get green.
- Commands come from the project's own test command (`package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI config or `interstage.yml`). Numeric thresholds are defaults the SPEC Quality spec can override.
- The project stage (POC, MVP, production) is chosen in the discovery interview and stored in the SPEC Quality spec.
- Gap reports go to one file, `.interstage/missions/<id>/evidence/gaps.md`.
- `stepwise-testing` instrumentation is removed before the commit, to keep one clean commit per verified item.
- Severity uses the blocker, major, minor, nit scale, with no maturity scores or findings counts as targets.

### Remaining skill decisions

Every skill in this group has a fictional `npm run <skill>:*` block, a fabricated sample report (scores, dates, dollars, week schedules), human-process padding and `compatibility: opencode`. Each `references/README.md` was a longer restatement of its SKILL.md and is dropped. The final set below supersedes the earlier per-skill names where they differ.

| Final skill (`is-` prefixed in the repo) | Absorbs | Target size | Notes |
|---|---|---|---|
| `adversarial-review` | `devils-advocate`, `assumption-buster`, `assumption-testing`; `adversarial-thinking` dropped | ~4 KB, Pogo autoload | Neutral reviewer voice. Claim and assumption extraction, ranking by likelihood wrong x impact x cost to test, per-item record (location, claim, counterexample, evidence, verdict holds/broken/untested, severity). No quota, clean is valid, no business or market lenses, no active testing. |
| `verify-claims` | `trust-but-verify`, `completeness-validator` (Tiers 1-2), a short domain-sanity section from `reality-validation` | ~6 KB, Inspector autoload | Per-claim-type re-verification, "tests pass for the wrong reason", stale evidence, five-level completion hierarchy, "completion is binary". Open questions go to the orchestrator. `anti-patterns.md` and `detection-guide.md` are on-demand references, trimmed. |
| `spec-gap-analysis` | `gap-analysis`, `spec-gap-analysis` | ~4 KB, Inspector on demand | Six-type gap table, handler location, breaking-change checklist, architecture check reduced to boundaries and dependency directions. Counts like "8 of 12 operations found", no compliance score. Writes `evidence/gaps.md`. |
| `security-review` | `redteam`, `white-hat`, `security-scan`, static items of `testing-security` | ~4 KB, Kessler autoload | Static only: code, config, dependency manifests and lockfiles, CI workflows, Dockerfiles, IaC. Finding record: title, CWE, severity, evidence (file:line), impact, recommendation. |
| `threat-modeling` | STRIDE shape and actor profiles from `white-hat` and `redteam` | ~2 KB, Kessler on demand | Component, STRIDE category, existing control (file:line), gap, recommendation. |
| `sherlock-debugging` | `sherlock-debugging`, a post-mortem section replacing `incident-response` | ~5.5 KB, Tiger Team autoload | 7-step evidence-first loop without asking the user; reproduce first with a failing test, `git bisect`, regression test before the fix, remove diagnostics before the commit; stuck rule aligned to 3 failures; case file in `evidence/`. |
| `migration` | `code-migration`, `dependency-upgrade` | ~5-6 KB, Perseverance autoload, **core** | Baseline tests first, one verified step per commit, lockfile discipline, codemods first, migration ledger in `evidence/`, old-code removal as the last commit, escalate to Flight after 3 failures. OS-package and infrastructure upgrades dropped. Package installs are gate D. |
| `git-release` | `git-release`, a Vercel readiness appendix from `vercel-deploy` | ~2.2 KB, Booster autoload | Uses the `<TODO-ID>:` commit convention, computes the range, handles no prior tag, prints `gh release create` and deploy commands only (gate F), notes in a separate file under `.interstage/`, credentials only from the user's environment. |
| `api-documentation` | `api-documentation` | ~2.5 KB, Golden Record | Derives docs from existing specs and annotations, cites file:line, marks unknowns, reports spec-vs-implementation drift. |
| `index` | `index` | ~2 KB, Golden Record on demand | Propose-only under `evidence/index-proposals/`. No `_prompt.md`. Never overwrites a human-authored file. Writes into the repo only at paths a TODO item names, as one commit. |
| `structured-logging` (observability) | `logging-fundamentals`, `logging-performance-optimization`, a stdout/rotation note from `log-management-system` | ~3.5-4 KB | Level table, field schema and redaction rule, hot-path and sampling rules, language decision table. |
| `tracing-correlation` (observability) | `distributed-tracing-logs`, log-to-trace parts of `observability-logging` | ~2.5-3 KB | W3C `traceparent`, propagation table, OTel manual and auto instrumentation by language, `trace_id`/`span_id` injection. SLO and burn-rate thresholds are verified against a primary source before they ship, or dropped. |
| `log-analysis` (observability) | `log-analysis-parsing` | ~3 KB | Format table, multiline and timezone rules, jq/awk/grep recipes, evidence-based report. Tiger Team and Hubble read it on demand. |
| `web-review` (web) | `react-review`, `accessibility-audit`, `testing-accessibility` | ~3-4 KB | Static a11y checklist (alt, labels, headings, ARIA, keyboard, focus, token contrast, `lang`), runs axe or pa11y only if the project already has them, cites the WCAG SC number, no memoization advice without a measured reason, no VPAT, legal or user-testing material. |
| `database-optimization`, `data-validation` (data) | the same names | ~2 KB each | Static review of SQL, ORM and migrations. `EXPLAIN` only against a project-provided local or test database. Migration index creation uses `CONCURRENTLY` where applicable. Reuse the project's own validator. No PII in reports. |
| `performance-profiling` (ops) | `performance-profiling`, `testing-performance`; chaos stays opt-in | ~3-4 KB | Local method: benchmark baseline with N runs, language-native sampler, hypothesis, one change, re-measure, report the delta as evidence. A table maps Linux-only tools (`perf`, eBPF, ftrace, SystemTap) to macOS equivalents; Linux-only tools run only when `uname` is Linux, the tool is on PATH and root is available. |
| `forge` (forge) | Interstage-authored; nothing vendored except the name regex and length limits | ~6 KB + validator script | Skill and agent authoring: OMP frontmatter reference for skills and agents, rules (never invent tools, `autoload-skills` 1-3, subagents never `ask`, `lsp` needs `tools: lsp` plus the `task.enableLsp` override), BUILD, BREAK, REPAIR with BREAK done by Pogo. A validator script checks frontmatter, names, `skill://` links, named scripts exist, and no schedules, scores, timestamps, `compatibility:` or `.opencode`. The same script runs in CI. No roster agent. |

Dropped from v1: `adversarial-thinking`, `incident-response` (folded into `sherlock-debugging`), `reality-validation` and `completeness-validator` (folded into `verify-claims`), `log-management-system`, `observability-logging` (mostly), `cloud-cost-optimization`, `vercel-deploy` (folded into `git-release`), `skill-builder`, `hypercognitive-skill-compiler` and `dogfooding` (replaced by `forge`), `context-pack`, `workflow-orchestrator`, `redteam`, `white-hat`, `security-scan` (replaced by `security-review`), `testing-security` (absorbed into `security-review`).

Core ships about 20 skills: `baby-steps`, `exhaustive-specification`, `best-practice-guide`, `migration`, `verify-claims`, `spec-gap-analysis`, `adversarial-review`, `security-review`, `threat-modeling`, `sherlock-debugging`, `stepwise-testing`, `git-release`, `api-documentation`, `index`, `testing-expected-results`, `test-strategy`, `test-pipeline`, `testing-integration`, `testing-e2e`, `test-gap-analysis`.

Per-skill trimming notes for the two methodology skills:

- `baby-steps` (18 KB to about 5-6 KB, autoloaded by Flight, Perseverance and Curiosity): keep the "when NOT to use" list, the context modes (Legacy: characterization tests first), the six rules condensed, the recovery protocol with the stuck rule added, step-size examples, anti-patterns, a one-block step report (TODO-ID, goal, files, validation, next, blockers). Drop human-time durations, the time table, team coordination, PR cadence, `Step N:` and `WIP:` commits, `feature/...` branches, the four worked examples, cost-benefit. Reverts happen inside the isolated worktree and never reset the mission branch. Crisis mode points at Tiger Team and the fast lane.
- `exhaustive-specification` (20 KB to about 5.5-6 KB, plus `references/catalog.md` of about 3 KB): keep writing standards per spec kind, the structure template and the quality gates, with the blind-person gate for UI specs only. Always-on tiers: Tier 1 Foundation (S01 System Overview, S02 Domain Model, S03 Glossary) and Tier 8 Quality (Q01 Test Strategy, Q02 Test Cases, Q03 Acceptance Criteria, Q04 Quality Gates), where Q01 holds the project stage and threshold overrides, Q03 becomes each TODO item's "done when" and Q04 holds the gate definitions. Small jobs may use a short section with "N/A, reason". The other 15 tiers move to the catalog. The upstream ID collision (sequential S01-S12 index vs tier-prefixed IDs) is resolved in favor of tier-prefixed IDs. The index file is `INDEX.md` (columns: ID, file, tier, status, depends, N/A reason), no dates or counts. `references/README.md` is deleted, with about 1.2 KB folded in (pitfall remedies, no mocks, requirement-to-test cross-references).

FIDO selection rule (the plan gate approves the set; excluded tiers are listed with a one-line reason, never dropped silently):

| Project signal | Add |
|---|---|
| User-facing UI | Tier 2 U01-U06 (U05 accessibility if a WCAG target is stated) |
| HTTP/RPC service or library API | A01, A02 (if auth), A03, A04; A05 if public or rate-limited; A06 if webhooks |
| Persistent data | D01, D03, D04; D02 if performance-sensitive; D05 if PII or retention rules |
| Rules, lifecycles, money, calculations | B01-B04 as applicable; B05 if it notifies users |
| Any service with users or secrets | X01, X04, X05 (X02, X03 point at the observability pack) |
| Deploy in scope | O01; O02 if IaC; O03 if latency or throughput targets; O04, O05 only at production stage |
| External services or events | I01; I02 public API; I03 flags; I04 inbound webhooks; I05 event-driven |
| Mobile app | Tier 10 M01-M05 (M04 only if offline, M05 only if push) |
| Trains or serves models | Tier 11 AI01-AI05 (AI02, AI04 only if training is in scope) |
| Production, operated service | SRE01, SRE02; SRE04 only with the chaos opt-in. SRE03 and SRE05 are dropped (human process) |
| Multi-locale requirement | Tier 13 L01-L04 |
| ETL or pipeline | Tier 14 DE01-DE04; DE05 if there is a cache |
| Realtime or collaborative | Tier 15 RT01-RT04 |
| Product-analytics requirement | AN01 only (AN02, AN03 dropped) |
| Auth, PII, money or exposed attack surface | SEC01, SEC02; SEC03 only if a compliance regime is named; SEC04 if an audit requirement is stated |

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
- Interactive TUI (real pty session): `/interstage:launch` typed mid-session applied the overrides and the persona (`[CAPCOM]` on the next prompt). The main session had the `ask` tool and rendered its dialog. A subagent spawned afterwards inherited depth 4, had no `ask`, and had `lsp` (because of the `task.enableLsp` override). Module state set in the main session is not visible in subagent extension instances (`launched` was false in the child).
- Plugin-shipped MCP: a marketplace plugin with `.mcp.json` at the plugin root loaded Context7 (`{"mcpServers":{"context7":{"type":"http","url":"https://mcp.context7.com/mcp"}}}`). The model resolved `react` to `/reactjs/react.dev`. A root `mcp.json` was ignored; the file must be named `.mcp.json`. The server loaded without `--interstage`, so it is global once the plugin is installed.

### Phase 1 spike results

Run against `omp` 18.11.3, `claude-haiku-4-5`, with an isolated agent directory (`PI_CODING_AGENT_DIR`) and a throwaway extension. The user's real config was not touched.

| # | Result |
|---|---|
| S1 custom roles | A role alias that is not defined (`model: "@capcom"`) makes the spawn fail with `No model selected` (the text suggests `/login`, which is misleading). A comma list falls back: `model: "@capcom, @default"` ran on `modelRoles.default`. A role defined in a `--config` overlay resolves. `await lookup("modelRoles").setEntry(pi.pi.settings, role, model)` writes only that entry to `config.yml` and keeps every other key; without `await` nothing was persisted under `-p`. |
| S2 token usage | Each session's extension instance receives `message_end` with `message.usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost`). Children are in the same process (same pid) and see `process.env` set by the main session. An isolated child's `ctx.cwd` is a separate worktree (`~/.omp/wt/<id>/m`), so shared state needs an absolute path. |
| S3 gate hooks | A `tool_call` handler (`{ toolName, input }`, returns `{ block, reason }`) blocked `npm install` in a subagent; the reason reached the agent verbatim and nothing was installed. |
| S4 parallel merges | Six isolated tasks with `task.isolation.apply=false` and `merge=branch` produced six `omp/task/<name>` branches with one commit each (commit message = task name) and left the mission branch untouched. Merging them with `git merge --no-ff`: three merged clean, three conflicted on the same appended file; `git merge --abort` left a clean tree; worktrees were cleaned up. Gate E is therefore enforceable: Flight does the merge through `bash`, which the `tool_call` hook can gate. |
| S5 user settings | Merging with the user's value before overriding (`union(current, ours)`) kept the user's disabled agent and hid the Interstage one. `config.yml` was byte-identical afterwards (runtime layer only). Rejected spawns report the agent as disabled and list what is available. |
| S6 extension tools | An extension-registered tool is added to every subagent even when the agent declares `tools: read`. Calling `setActiveTools` without it in `before_agent_start` removes it per child, and the tool's `execute` context carries `agent` (name, kind), so it can also check the caller. A Flight-like agent kept the tool and executed it. |
| S7 marketplace | A local marketplace with two plugins: add, discover, install both, upgrade (0.1.0 to 0.1.1) and uninstall all worked. A skills-only pack whose `package.json` has no `omp` key is discovered. `.mcp.json` in the core plugin loaded Context7. Only the plugin directory is copied into the cache. |
| S8 types | Passed (see PLAN). |
| S9 scripts | See open question 4. |
| S10 Nx | Works with narrowed `validate` inputs (a touched plugin affects only itself; touched validator source affects all). Local generators must be ESM because Nx uses Node's native TypeScript stripping; the generators package must be linked with `workspace:*`. A generator scaffolded a skill and its output passed the validator. Root files do not reach installed plugins. |

Design consequences:

1. Agent frontmatter uses role fallbacks: `model: "@<role>, @default"`. `/interstage:init` writes the six roles with an awaited `setEntry`; `/interstage:doctor` reports any role that is missing.
2. Mission and usage state lives in an absolute directory the main session exports as `INTERSTAGE_STATE_DIR` in `process.env`. Children never use cwd-relative state, because isolated builders run in a different checkout. Builders return evidence in their task output, and Flight (not isolated) writes it to `.interstage/`.
3. The extension sets `task.isolation.apply=false`. Flight integrates retained branches itself, in dependency order, one `git merge --no-ff` per verified item. That makes gate E a `tool_call` gate on `git merge`.
4. Gate D (installs and network calls) is a `tool_call` gate on `bash` for subagents.
5. The `mission` tool is removed from every child except Flight and Houston in `before_agent_start`, and its `execute` also checks `ctx.agent.name`.
6. Token budgets are feasible: every session appends its `message_end` usage to the mission's usage file.
7. Hiding Interstage agents merges with the user's `task.disabledAgents` instead of replacing it.

### Not verified

- A GitHub-hosted marketplace source. The marketplace flow was tested with a local directory only.
- LSP diagnostics against a real server. None was installed for the test language, so the tool answered `No language server found`, which also shows `/interstage:doctor` is needed.
- Behavior on other `omp` versions.

## Framework testing (confirmed)

- Static validation (script and CI): every agent frontmatter parses under OMP's rules, names are unique, every `autoloadSkills` entry exists, and vendored skills carry the MIT license and appear in `THIRD_PARTY_NOTICES.md`.
- Unit tests (`bun test`) for extension logic that prompts cannot enforce: autonomy gate decisions, budget and circuit-breaker accounting, severity "clean" evaluation, lane routing, `init` idempotency.
- Headless smoke test: run `omp` with the plugin against a small fixture repo in the fast lane. Assert the artifacts, mission branch and commit.
- Manual dogfood checklist per release.

## Hardware seams (confirmed)

No hardware-specific design in v1. Build, test and verify commands are configurable per project so firmware, PCB, CAD or HDL packs can be added later without changing the core.

## Repository

- Origin: `https://github.com/junkert/interstage`. The marketplace is served from this repo.
- Distribution is via git and the OMP marketplace. npm is not used: OMP rejects npm marketplace sources ("npm plugin sources are not yet supported").

## Open questions

1. Docker MCP (the Docker MCP Gateway) is deferred. Booster uses `bash docker ...`. Revisit if a container-management tool is wanted. Docker Desktop was not running on the dev machine when checked.
2. Killing a running subagent through its job (`write proc://<id>/kill`) is unverified. v1 applies steering at item boundaries only.
3. Skills are reviewed at SKILL.md level in full except `redteam`, `white-hat` and `security-scan`, which were reviewed for structure and guardrails only, and `notebooklm-federated-specs` and `opencode-config`, which are out of v1. The OWASP/CWE static checklist for Kessler has no upstream source and is authored fresh (pin the OWASP year).
4. Scripts: keep `chunk-conversation.sh` (lightly fixed); drop `validate-todo.sh` (it validates `- [ ]` checklists, not our `## T-ID` items; TODO validation moves into the TypeScript validator) and `verify.sh` (documented flags do nothing).
5. Fast lane verification. The fast lane is `CAPCOM -> coder -> Inspector`, but the loop says an item passes only when Go/No-Go and Inspector are both clean. PLAN D5 recommends both, in parallel; this is approved with the plan.
6. Houston's concrete responsibilities (mission queue, hand-off to Flight, budget across missions, owner of `.interstage/` state). PLAN D6 proposes: Houston owns planning and project state, Flight owns the build loop. Approved with the plan.
7. Integration conflicts: when a retained task branch conflicts at merge, Flight's policy is not yet specified (proposal in PLAN, Phase 4).
