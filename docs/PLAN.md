# Interstage: Build Plan

Status: proposed, for review. Nothing is built. This plan turns [DESIGN.md](DESIGN.md) into ordered work. Items marked **Proposed** are not yet decided; the checklist in section 2 lists them with a recommendation each.

## 1. What v1 delivers

v1 is done when all of these hold:

1. `omp plugin marketplace add junkert/interstage` followed by `omp plugin install interstage@interstage` installs core. Optional packs install the same way.
2. `omp --interstage` (or `/interstage:launch` mid-session) turns the session into CAPCOM, with the 16 specialist agents available. Plain `omp` only gains the core skills and Context7.
3. A fast-lane request and a standard-lane request each run end to end on a fixture repo: mission branch, one `<TODO-ID>: <title>` commit per verified item, evidence under `.interstage/missions/<id>/`, no push.
4. Autonomy levels, budgets, the circuit breaker, pause and abort behave as specified, enforced by the extension where prompts cannot enforce them.
5. About 20 core skills and five packs (observability, web, data, ops, forge) pass the validator and carry no fictional commands, fabricated samples or human schedules.
6. `THIRD_PARTY_NOTICES.md` credits the vendored skills; CI is green on macOS and Linux.

## 2. Decisions needed from you

Review these first. Each has a recommendation; if you agree with all, say so and the plan stands.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Repo layout and tooling | Monorepo: `plugins/<name>/` per plugin under one `.omp-plugin/marketplace.json`, managed with **Nx on top of Bun workspaces** (light use: inferred `package.json` scripts, caching, `nx affected`, local generators; no Nx Cloud, no Nx language plugins at first) | One clone serves the marketplace; packs stay independent installs. Nx adds `affected` runs, cached validation and, most usefully, generators that scaffold a skill, agent or pack so adding one stays a one-command job. Validator and extension logic stay plain Bun/TypeScript so the repo also works without Nx. Needs spike S10 |
| D2 | Dev toolchain | TypeScript, `bun test`, `tsc --noEmit`, `shellcheck`; types from `@oh-my-pi/pi-coding-agent@18.11.3` (the installed omp version) | omp embeds Bun, so plugin TypeScript runs under Bun. Installed on the dev machine: bun 1.4.3 (`~/.bun/bin/bun`, add `~/.bun/bin` to PATH) and shellcheck 0.11.0. CI installs both |
| D3 | Mission state | The extension registers a `mission` tool (get, transition, steer) that Flight calls; item states live in `mission.json`/`items/*.json` and transitions are validated | An LLM hand-editing state files will drift from the 12-transition machine; a tool enforces it. Needs spike S6 |
| D4 | Model roles | Six roles: `@capcom`, `@orchestrator`, `@planner`, `@coder`, `@reviewer`, `@scout`. `/interstage:init` asks for three models (strong, balanced, fast) and writes all six | Three questions at first run instead of six. Needs spike S1 |
| D5 | Fast-lane verification | Go/No-Go and Inspector run in parallel on the single diff, same pass rule as every other lane | One pass rule everywhere. Alternative: Go/No-Go only (cheaper, weaker) |
| D6 | Houston's job | Houston owns the planning phase and project state: lane confirmation, mission creation, FIDO and Pogo spec loops, Hubble research, handing a TODO to Flight. Flight owns the build loop. | Splits planning from execution; matches depth CAPCOM 0, Houston 1, Flight 2, specialists 3 |
| D7 | CI | GitHub Actions on ubuntu and macos: `nx affected -t validate typecheck test shellcheck` (full git history for the base SHA). No LLM calls in CI. End-to-end runs are local, gated by `INTERSTAGE_E2E=1` | CI stays free and deterministic and only re-checks plugins a change touches |
| D8 | Versioning | Semver tags. Marketplace entries use relative `./plugins/<name>` sources and a `version` per plugin | Matches OMP's catalog format; `omp plugin upgrade` compares versions |
| D9 | Skill source | Copy a snapshot from `/Users/levi/projects/skills` at a recorded upstream SHA into `vendor/`-free plugin dirs, with `skills.manifest.json` for provenance. No sync tooling in v1 | Interstage owns the adapted skills after vendoring |
| D10 | `.gitignore` | Replace the Go template with a TypeScript/Bun/macOS one (see Phase 0) | The current file is the stock GitHub Go template |

## 3. Repository layout (proposed)

```
.omp-plugin/marketplace.json        catalog: core + packs
plugins/
  interstage/                        core plugin
    package.json                     omp manifest (omp.extensions)
    .mcp.json                        Context7 (must be this exact name)
    extension/                       TypeScript (see 4.2)
    agents/                          16 agent files
    commands/                        plan.md, import.md, promote.md
    skills/is-*/SKILL.md             about 20 core skills (+ references/)
  interstage-observability/          skills only
  interstage-web/
  interstage-data/
  interstage-ops/
  interstage-forge/                  forge skill + validator wrapper
tools/
  validate/                          validator (frontmatter, links, lint rules)
  vendor/                            one-off vendoring helper + manifest check
  generators/                        local Nx generators: skill, agent, pack (scaffold + manifest entry)
tests/
  unit/                              bun tests for pure extension modules
  fixtures/                          tiny repos for smoke runs
  smoke/                             headless omp scripts (gated)
.github/workflows/ci.yml
install.sh                           optional thin wrapper
nx.json                              task defaults, caching (no Nx Cloud)
package.json                         private root, Bun workspaces
skills.manifest.json                 upstream path, SHA, Interstage name, modified?
THIRD_PARTY_NOTICES.md
docs/  DESIGN.md  PLAN.md  USAGE.md  AUTHORING.md
README.md  LICENSE  CHANGELOG.md  CONTRIBUTING.md
```

Constraints from the spikes that shape this layout: plugin MCP config must be `.mcp.json` at the plugin root; extension entries go in `package.json#omp.extensions`; markdown commands are namespaced by plugin name, so the core plugin must be named `interstage`.

## 4. Components

### 4.1 Plugins and marketplace

- `marketplace.json`: name `interstage`, one entry per plugin, each with `source: ./plugins/<name>`, `version`, `category`, `description`.
- Core manifest: `package.json` with `name: interstage`, `version`, `omp.extensions: ["./extension/index.ts"]`. OMP-native manifest only (no `.claude-plugin/`), so agent `model` role aliases are kept.
- Packs contain skills only. They have no extension, so they cannot detect a missing core; agent prompts handle a missing pack skill gracefully (design rule).
- Install validation: OMP imports the extension at install time and rolls back on failure, so extension load errors surface at `omp plugin install`.

### 4.2 Extension (TypeScript)

Pure modules (unit-tested) with thin hook adapters.

| Module | Responsibility |
|---|---|
| `config.ts` | Load and merge `~/.omp/agent/interstage.yml` and `.interstage/config.yml`; validate; defaults |
| `severity.ts` | Evaluate a review: clean = zero blockers and zero majors |
| `gates.ts` | Given autonomy level and gate (A-G), decide: allow, require approval, stop |
| `budget.ts`, `breaker.ts` | Token budgets (Pogo loop, mission) and the 5-consecutive-failure breaker |
| `lanes.ts` | Lane routing rules and override handling |
| `state.ts` | Mission and item state machine (12 transitions), file I/O under `.interstage/missions/<id>/` |
| `steering.ts` | Write, order and apply packets (`<seq>-<signal>.json`, `applied/`) |
| `activation.ts` | `registerFlag("interstage")`, `/interstage:launch`, runtime overrides, persona, `task.disabledAgents` when inactive |
| `hooks.ts` | `session_start`, `before_agent_start` (main only), `before_subagent_spawn` (gates, pause), `tool_call` (gates D, E) |
| `tools.ts` | **Proposed** `mission` tool: `get`, `transition`, `steer` with schema validation (D3) |
| `commands.ts` | `/interstage:init`, `:launch`, `:status`, `:abort`, `:doctor` |

Runtime overrides applied on activation (all verified): `task.maxRecursionDepth` 3 or more, `task.isolation.enabled`, `task.isolation.merge: branch`, `task.enableLsp`, `github.enabled`. When the flag is absent: `task.disabledAgents` lists every Interstage agent.

Config keys: `autonomy` (supervised, checkpoints, autopilot), `ship` (allow or deny), `budgets.pogoLoopTokens` 150000, `budgets.missionTokens` 2000000, `breaker.consecutiveFailures` 5, `parallel.worktrees` 4, `lanes`, `verify.command` override.

`.interstage/` layout:

```
.interstage/
  config.yml
  missions/<id>/
    mission.json            id, lane, state, branch, base SHA, autonomy snapshot, budget used
    SPEC.md | specs/INDEX.md + specs/<ID>-*.md
    TODO.md                 items: id, title, depends, spec ref, done-when
    items/<TODO-ID>.json    state, failures, plannerRounds, commit, findings refs
    decisions.md
    research/  evidence/    gaps.md, index-proposals/, case files, migration ledger
    steering/  applied/
```

TODO item format (validated by `validate-todo`): `## T-014: <title>`, then `depends:`, `spec:`, `done-when:` bullets.

### 4.3 Agents (16 files plus the CAPCOM persona)

CAPCOM is the main-session persona injected by the extension, not a spawnable agent file. Depth: CAPCOM 0, Houston 1, Flight 2, specialists 3. Specialists cannot spawn. **Proposed** tool sets and roles; adjust in review.

| Agent | Role alias | Tools | Spawns | Autoload skills |
|---|---|---|---|---|
| houston | `@orchestrator` | read, grep, glob, write, task, wait | flight and all specialists | none |
| flight | `@orchestrator` | read, grep, glob, write, bash, task, wait, `mission` | all specialists | `baby-steps` |
| fido | `@planner` | read, grep, glob, write | none | `exhaustive-specification` |
| pogo | `@reviewer` | read, grep, glob, write | none | `adversarial-review` |
| sojourner, ingenuity | `@scout` | read, grep, glob | none | none |
| hubble | `@scout` | read, grep, glob, web_search, write | none | none (reads `best-practice-guide` on demand) |
| curiosity | `@coder` | read, edit, write, bash, grep, glob, lsp, ast_edit | none | `baby-steps` |
| perseverance | `@coder` | same as curiosity | none | `migration`, `baby-steps` |
| go-no-go | `@reviewer` | read, bash, grep, glob, lsp, write | none | `test-pipeline`, `testing-expected-results` |
| orbiter | `@coder` | read, edit, write, bash, grep, glob | none | `testing-integration`, `testing-e2e` |
| inspector | `@reviewer` | read, grep, glob, lsp, bash, write | none | `verify-claims`, `test-gap-analysis`, `testing-expected-results` |
| kessler | `@reviewer` | read, grep, glob, bash, write | none | `security-review` |
| tiger-team | `@coder` | read, edit, write, bash, grep, glob, lsp | none | `sherlock-debugging`, `stepwise-testing` |
| booster | `@coder` | read, edit, write, bash, grep, glob | none | `git-release` |
| golden-record | `@coder` | read, edit, write, grep, glob | none | `api-documentation` |

Every agent file states: its role, inputs, required outputs, definition of done, "report open questions to Flight/Houston, never ask the user", the evidence rule (file:line, no quota, clean is valid) and the severity scale. Skills carry method; agents carry role.

### 4.4 Commands

- Extension: `/interstage:init` (create `.interstage/`, edit `.gitignore` with notice, run the model-role wizard, create `~/.omp/agent/interstage.yml` if absent), `:launch`, `:status`, `:abort` (reset the mission branch, mark aborted), `:doctor` (languages, language servers, test runners, linters, `gh` and auth, shellcheck-free; never installs).
- Markdown (namespaced automatically): `:plan` (with `--lane`), `:import` (ingest an external conversation using the chunker), `:promote` (copy a named artifact into the repo after user approval via CAPCOM).

### 4.5 Skills

Adaptation pipeline per skill:

1. Copy the upstream `SKILL.md` (and only the kept `references/` files) from the pinned upstream SHA.
2. Rewrite to the target in DESIGN "Remaining skill decisions": remove `compatibility`, add `is-` name, drop fictional commands, samples, schedules, human-process steps and `@skill` links; use `skill://is-...` links; output paths under `.interstage/missions/<id>/`.
3. Run the validator (below).
4. Independent review by a subagent that did not write it (checks evidence rule, no quota, no invented facts).
5. Add the `skills.manifest.json` entry.

Authored fresh (no upstream source): the OWASP/CWE static checklist (pin the OWASP year), the scout handoff format, `forge`, and the Flight loop prompt and steering reference.

### 4.6 Validator (`tools/validate`)

Runs in CI and as the forge pack's check. Rules:

- Frontmatter parses; `name` matches directory and `^[a-z0-9]+(-[a-z0-9]+)*$`; required fields present; no `compatibility:`.
- Agent frontmatter keys are valid OMP fields; every `autoload-skills` entry exists; at most 3 autoloaded skills; tool names are real; no `ask`, `todo`.
- Every `skill://` link and every named script exists.
- Size budget per skill and per autoload set (target plus 20 percent).
- Lint patterns: `npm run`, `npx skills`, `.opencode`, `searxng`, dates (`20\d\d-\d\d-\d\d`), `\d+/100`, "Week \d", dollar amounts, "maturity", `@<skill-name>` commands, "find at least".
- Vendored skills have `license: MIT` and a manifest entry; `THIRD_PARTY_NOTICES.md` exists.

## 5. Phases

Order matters only where a phase lists a dependency.

| Phase | Deliverables | Acceptance | Depends on |
|---|---|---|---|
| **0 Foundation** | New `.gitignore` (node_modules, dist, `*.log`, `.DS_Store`, `.env*`, coverage output, `.interstage/`), root `package.json` (Bun workspaces: `plugins/*`, `tools/*`), `nx.json` (pinned Nx, caching for `validate`, `typecheck`, `test`, `shellcheck`, no Nx Cloud), `tsconfig.json`, CI workflow using `nx affected`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md` scaffold, `skills.manifest.json` with the upstream SHA recorded | CI green on an empty skeleton on macOS and Linux; `nx run-many -t validate` works | none |
| **1 Spikes** | S1 to S10 (below), results added to DESIGN | Each spike has a recorded pass or fail; failures change the plan before Phase 3 | 0 |
| **2 Skeleton** | `marketplace.json` listing core only; core plugin manifest, `.mcp.json` and an extension that registers the flag; validator v1 (frontmatter, agent, skill, MCP, lint and TODO rules, per-plugin mode); a `tests` workspace that typechecks the extension. Pack plugins are created in Phase 6 with a pack generator so no empty plugin is ever listed | Local `omp plugin marketplace add` and `install --dry-run` succeed; a real install is accepted and `omp --interstage` runs; validator passes | 0, 1 (S7) |
| **3 Extension** | Pure modules with unit tests, then adapters, then commands | Unit tests cover gates, budget, breaker, severity, lanes, state transitions, config merge, `init` idempotency; headless run shows persona, overrides, hidden agents without the flag | 1, 2 |
| **4 Agents** | Persona, Houston, Flight (with loop spec, steering reference), then the 13 specialist files | Validator passes; headless fast-lane smoke on a fixture produces a commit `T-001: ...` on a mission branch | 2, 3 |
| **5 Core skills** | Batches B1 to B5 (below) | Validator passes; each skill reviewed independently; manifest complete | 2 (validator) |
| **6 Packs** | observability (3), web (1), data (4), ops (1), forge (1 + validator wrapper) | Same as core skills; packs install independently | 5 |
| **7 Install and docs** | `install.sh` (real, written here rather than stubbed earlier), README (install, quickstart), `USAGE.md`, `AUTHORING.md`, CHANGELOG | A clean-machine install follows the README verbatim; `install.sh --packs web,data` works | 3, 6 |
| **8 Hardening and release** | End-to-end runs (fast lane; standard lane with a 3-item parallel TODO; pause and resume; circuit breaker; abort; conflict handling), dogfood on a small real project, fix list, tag `v0.1.0` | All acceptance criteria in section 1 | all |

Skill batches (Phase 5):

| Batch | Skills | Notes |
|---|---|---|
| B1 Method | `baby-steps`, `exhaustive-specification` (+ `references/catalog.md`) | Trimming rules are in DESIGN |
| B2 Verification | `verify-claims`, `test-gap-analysis`, `testing-expected-results`, `spec-gap-analysis` | `verify.sh` kept only if portable |
| B3 Testing | `test-strategy`, `test-pipeline`, `testing-integration`, `testing-e2e`, `stepwise-testing` | Language-neutral; project test command |
| B4 Adversarial and security | `adversarial-review`, `security-review`, `threat-modeling` | OWASP checklist authored fresh |
| B5 Delivery | `migration`, `git-release`, `api-documentation`, `index`, `sherlock-debugging`, `best-practice-guide` | |

## 6. Spikes (Phase 1, complete)

Details are in DESIGN "Phase 1 spike results". Summary:

| # | Question | Outcome |
|---|---|---|
| S1 | Undefined custom role alias; writing roles to `config.yml` | Undefined role fails the spawn. Use `model: "@<role>, @default"`. `await lookup("modelRoles").setEntry(...)` persists one key and keeps the rest |
| S2 | Per-session token usage for budgets | Yes: `message_end` usage per session; same process, shared `process.env`; isolated children run in another checkout, so state paths must be absolute |
| S3 | `tool_call` gates | Works: a subagent's `npm install` was blocked with a reason |
| S4 | Many-item parallel isolated merges | Works with `task.isolation.apply=false`: Flight integrates retained branches; conflicts are detected by `git merge` exit code and aborted cleanly |
| S5 | User settings preserved | Works: merge with the user's `task.disabledAgents`; config file unchanged |
| S6 | Extension tool visibility | Tools reach every child; remove per child in `before_agent_start`; `execute` can check `ctx.agent` |
| S7 | Marketplace with several plugins and a skills-only pack | Works (local source). A skills-only pack needs no `omp` key. GitHub-hosted source untested |
| S8 | Types under `tsc` | Passed |
| S9 | Candidate scripts | Keep `chunk-conversation.sh` (light fixes); drop `validate-todo.sh` (wrong TODO format) and `verify.sh` (inert flags) |
| S10 | Nx on Bun workspace | Works with narrowed validate inputs; generators are ESM; link with `workspace:*` |

### Plan changes from Phase 1

1. Agent files use role fallbacks (`@role, @default`). Validator rule: every agent `model` ends with `@default`.
2. The extension exports `INTERSTAGE_STATE_DIR` (absolute) from the main session; all mission and usage writes use it. Builders return evidence in task output; Flight writes it.
3. The extension sets `task.isolation.apply=false`. Flight integrates retained branches in dependency order, one `git merge --no-ff` per verified item. Gate E is a `tool_call` gate on `git merge`; gate D a `tool_call` gate on installs and network calls.
4. **Integration-conflict policy (approved):** a conflicting item is rebuilt on the updated mission branch by a fresh builder. That attempt counts against the item's 3-failure counter only if it fails verification; a conflict alone is not a failure. After 2 conflict rebuilds the item is `blocked` and CAPCOM is told.
5. `mission` tool access is restricted to Houston and Flight (removal in `before_agent_start` plus a check in `execute`).
6. The TypeScript validator owns TODO validation (`## T-ID` items with `depends`, `spec`, `done-when`). `validate-todo.sh` is not shipped.
7. `/interstage:init` must `await` its config writes.
8. Nx: the `validate` target inputs are narrowed (already applied); generators are ESM; the generators package is linked with `workspace:*`.

## 7. Parallelization

Shared contracts come first and are fixed by Phases 0 to 2: frontmatter schema, validator rules, state schema, config schema, tool names. After that:

- Phase 3 pure modules are independent of each other.
- Phase 4 specialist agent files are independent once Flight's loop and the persona are fixed.
- Phase 5 batches B1 to B5 and Phase 6 packs are independent; each skill is reviewed by a different subagent than the one that wrote it.
- Subagents get one batch each with the validator as their acceptance check.

## 8. Verification

| Layer | What | Where |
|---|---|---|
| Static | Validator rules, `tsc`, shellcheck | CI |
| Unit | Gates, budget, breaker, severity, lanes, state machine, steering order, config merge, init idempotency | CI (`bun test`) |
| Install | Marketplace add, plugin install `--dry-run`, discovery of agents/skills/commands/MCP | CI, with a temporary `HOME` |
| End to end | Fast lane, standard lane, pause, abort, breaker | Local, `INTERSTAGE_E2E=1`, real model |
| Manual | Dogfood checklist per release | Release process |

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OMP extension API changes between versions | Pin a minimum omp version; `doctor` checks it; dev dependency pinned to the tested version |
| Custom role aliases undefined on a user's machine | Spike S1; `init` writes them; `doctor` verifies |
| Token usage not visible to the extension | Spike S2; fall back to item-count and wall-time budgets |
| LLM drifts from the state machine | `mission` tool enforces transitions (D3) |
| Persona override replaces the system prompt | Always append to the existing array; covered by a unit test |
| Global skills and Context7 appear in every omp session | Documented; core stays about 20 skills; Context7 only sends queries when invoked |
| `.gitignore` edit dirties a tracked file | `init` tells the user first and never commits |
| Fabricated content creeping back into skills | Validator lint rules plus independent review per skill |
| License or attribution error | `THIRD_PARTY_NOTICES.md`, manifest, and the canonical-upstream check you still owe (which GitHub account owns `skills`) |
| Cost of depth 3 with parallel worktrees | Budgets and breaker defaults; parallelism cap 4 |

## 10. Out of scope for v1

Docker MCP, killing running subagents, active security testing, hardware packs, sync tooling for upstream skills, npm publishing, a wrapper binary.
