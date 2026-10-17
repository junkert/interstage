# Interstage: Usage

This page describes what exists in the repository today. Where behavior was not observed, it says so. Interfaces are defined in [CONTRACTS.md](CONTRACTS.md); intent in [DESIGN.md](DESIGN.md). Install and quickstart are in the [README](../README.md).

## The chain

```
you <-> CAPCOM (main session) -> Houston (project) -> Flight (mission) -> specialists
```

CAPCOM is the only agent that talks to you. While Interstage is active it cannot edit or write files or run `eval`, `debug` or `ast_edit`, and its `bash` is limited to the import chunker script. It can spawn only `houston`. Specialists have no `ask` tool; their open questions travel up through Flight and Houston to CAPCOM, who asks you.

## Starting a session

- `omp --interstage` starts a session with Interstage on.
- `/interstage:launch` turns the current session into an Interstage session; the persona applies from your next prompt.
- Without either, Interstage agents are hidden (`task.disabledAgents` is extended at runtime) and plain `omp` behaves as before. The core plugin's skills and its Context7 MCP server are still visible, because they load globally once the plugin is installed.

On activation the extension exports `INTERSTAGE_STATE_DIR` (`<git top level or cwd>/.interstage`), resumes an unfinished mission if it finds one (`INTERSTAGE_MISSION_ID`), and applies runtime-only OMP overrides: `task.maxRecursionDepth` (at least 3), `task.isolation.enabled=true`, `task.isolation.merge="branch"`, `task.isolation.apply=false`, `task.enableLsp=true` and `github.enabled=true`. Your OMP settings files are not edited by activation.

## Lanes

CAPCOM sizes each request into a lane from these signals: files touched, ambiguity, new project, security or data. You can override the lane, and `--lane` on `/interstage:plan` or `/interstage:import` is an explicit choice that is not re-sized.

| Lane | Use when | Path (DESIGN) |
|---|---|---|
| `fast` | one or two files, unambiguous, no new dependency, no security or data impact | a builder, then Inspector; Houston plays Flight |
| `standard` | several files or modules, some design choice, existing project | FIDO plans, Pogo reviews, then the Flight build loop |
| `full` | new project, high ambiguity, many modules, or security, authentication, money, personal data, schema migrations | discovery interview, spec and adversarial loops, then the Flight build loop |

The lane enabled list and the default come from the config (`lanes.enabled`, `lanes.default`). Requesting a lane that is not enabled is an error from the `mission` tool.

## Autonomy and gates

Autonomy is `supervised`, `checkpoints` (the default) or `autopilot`, set by the `autonomy` config key and recorded on each mission. Gates are decision points; the autonomy level decides which of them need your approval.

| Gate | Meaning | Where enforced |
|---|---|---|
| A | Accept the plan and SPEC (ref `plan`) | `transition start` on the first item |
| B | Accept each Pogo-revised TODO (ref `todo:<revision>`) | `plan_set` |
| C | Every commit onto the mission branch (ref `commit:<TODO-ID>`) | `transition integrate_ok` |
| D | Dependency install or network call by a subagent (ref: the command) | `tool_call` hook on `bash` |
| E | Merge parallel task branches (ref `merge:<TODO-ID>`) | `tool_call` hook on `bash` |
| F | Ship: push, PR, deploy, release (ref: the command) | `tool_call` hook on `bash` |
| G | Circuit breaker | breaker state; always stops |

| Gate | supervised | checkpoints | autopilot |
|---|---|---|---|
| A | approve | approve | allow |
| B | approve | allow | allow |
| C | approve | allow | allow |
| D | approve | allow | allow |
| E | approve | allow | allow |
| F | approve | approve | allow if `ship: allow`, otherwise stop |
| G | stop | stop | stop |

`approve` means a granted approval with a matching ref must exist; `stop` means the action is refused. Autopilot never pushes or deploys unless `ship: allow` is set explicitly, and it still halts on a breaker trip. Gates D, E and F are checked only for subagents and only while a mission is active; CAPCOM itself is not blocked by them.

## Commands

Commands registered by the extension:

| Command | What it does |
|---|---|
| `/interstage:init` | Creates `<project>/.interstage/`. Offers to append `.interstage/` to the project `.gitignore` (asks first, never commits). Lists your authenticated models and asks for a strong, a balanced and a fast model, then writes these `modelRoles`: `capcom`, `orchestrator`, `planner`, `reviewer` = strong; `coder` = balanced; `scout` = fast. Writes the user config file with the defaults unless one already exists. Cancelling the model questions changes no roles. Safe to run again. |
| `/interstage:launch` | Turns the current session into an Interstage session. |
| `/interstage:status` | Shows the active mission: status and reason, lane, autonomy, branch, item states, token use against both budgets, breaker count and pending approvals. |
| `/interstage:abort` | Aborts the active mission. Refuses if the working tree has uncommitted tracked changes. Asks for confirmation, then checks out the mission's base branch and deletes the mission branch and any `omp/task/<TODO-ID>` branches of its items, and marks the mission `aborted`. |
| `/interstage:doctor` | Read-only environment report; see [Troubleshooting](#troubleshooting). |

Commands implemented as markdown prompts in `plugins/interstage/commands/`, which CAPCOM follows:

| Command | What it does |
|---|---|
| `/interstage:plan <request> [--lane fast\|standard\|full]` | Starts a mission for the request. Runs the discovery interview unless a mission is already active, picks a lane unless you gave one, then spawns Houston. Relays Houston's reports, approval requests and open questions. |
| `/interstage:import <file> [--lane ...]` | Imports a saved outside conversation as spec input. Splits it with `plugins/interstage/scripts/chunk-conversation.sh`, reads the chunks, extracts requirements and contradictions, confirms them with you, then spawns Houston with the chunk directory. The file needs lines starting with `Human:`, `User:` or `Me:`. The script refuses a non-empty output directory unless `--force` is used, which CAPCOM only does after telling you. |
| `/interstage:promote <artifact> [destination]` | Copies a mission artifact (for example `SPEC.md`, `specs/INDEX.md`, `decisions.md`) into the repository. Default destination is `docs/<artifact name>`. It never overwrites an existing file, asks for explicit approval first, and then Houston makes exactly one commit on the current branch with the message `promote <artifact>: <imperative title>`. Nothing is pushed. Prefer promoting from a non-mission branch; on a mission branch the commit needs gate C, and your approval covers it. |

## Configuration

Three layers, deep-merged in this order: built-in defaults, the user file, the project file. Missing files are fine.

- User file: `~/.omp/agent/interstage.yml` (`$PI_CODING_AGENT_DIR/interstage.yml` when that variable is set). `/interstage:init` writes it with the defaults.
- Project file: `<project>/.interstage/config.yml`.

Defaults and valid values:

```yaml
autonomy: checkpoints        # supervised | checkpoints | autopilot
ship: deny                   # allow | deny
budgets:
  pogoLoopTokens: 150000     # positive integer
  missionTokens: 2000000     # positive integer
breaker:
  consecutiveFailures: 5     # positive integer
parallel:
  worktrees: 4               # positive integer
lanes:
  enabled: [fast, standard, full]   # non-empty list of distinct lanes
  default: standard                 # must be in lanes.enabled
verify:
  command: ""                # optional project test command override
```

An invalid value is reported by `/interstage:doctor` and the layer below it keeps applying. Unknown keys are listed by `doctor` and ignored. `verify.command` is read by the builder and verifier agents as one of the places to find the project's own test command; the extension does not run it.

## Mission state

Everything is under `$INTERSTAGE_STATE_DIR` (`<project>/.interstage/`):

```
config.yml                          project config
usage.jsonl                         token usage outside any mission
missions/<id>/                      id = M-001, M-002, ... (per project)
  mission.json
  TODO.md
  SPEC.md   or   specs/INDEX.md + specs/<ID>-<slug>.md
  decisions.md                      append-only decision log
  usage.jsonl                       one usage record per message
  items/<TODO-ID>.json              state, failures, history, findings per item
  evidence/  research/              markdown written through the mission tool
  steering/<seq>-<signal>.json      pending packets; steering/applied/ after Flight applies them
  approvals.json
worktrees/<TODO-ID>/                temporary verification worktrees
```

Git layout: the mission branch is `mission/<id>-<slug>`, created from the branch that was current when the mission was created. Builders commit on `omp/task/<TODO-ID>` (retries get a numeric suffix). Flight squash-merges each verified item onto the mission branch, one commit per item with the message `<TODO-ID>: <imperative title>`, and deletes the task branch. Nothing is pushed.

Each TODO item has one of the states `pending`, `building`, `verifying`, `integrating`, `failed`, `planning`, `done`, `blocked`. After three failures on one item it goes to the planner to revise the plan (at most two planner rounds), then to `blocked`, which waits for your decision. A merge conflict triggers a rebuild on the updated mission branch, which is not counted as a failure; a third conflict blocks the item. The full transition table is in [CONTRACTS.md](CONTRACTS.md) section 3. Mission status is `running`, `paused`, `halted`, `complete` or `aborted`.

## Pause, resume and steering

You steer through CAPCOM, never by editing a build session. CAPCOM decides which artifact owns the problem (the spec, the TODO, or one assignment) and writes a steering packet with the `mission` tool. Signals: `interrupt`, `redirect`, `pause`, `resume`, `reprioritize`, `decision` (plus `error` and `complete` in the type). Flight applies pending packets between items, interrupt and pause first, then in sequence order; the running item finishes first. Packets move to `steering/applied/` when applied.

While a mission is `paused` or `halted`, the extension blocks every new subagent spawn with a message saying so; items already running finish. To pause or interrupt, CAPCOM sets the status to `paused` with a reason. To continue it sets the status back to `running`, sends a `resume` packet and resumes Houston. A `halted` mission can only be resumed by CAPCOM, after you choose how to proceed.

## Budgets and the circuit breaker

- Every assistant message in every session (CAPCOM and subagents) appends a usage record to the mission's `usage.jsonl`, or to `usage.jsonl` in the state directory outside a mission.
- Budgets count billable tokens: `input + output + cacheWrite` per record. Cache reads are excluded, because every turn re-reads the whole conversation from the cache and counting them would measure conversation length rather than work done. `totalTokens` and `cacheRead` stay in each record, and `/interstage:status` and `mission get budget` show cache reads as a separate figure.
- `budgets.missionTokens` caps the mission total. When the total goes over it the mission is set to `halted` and you are notified.
- `budgets.pogoLoopTokens` caps Pogo's tokens within the current Pogo loop. Over the cap, new `pogo` spawns are blocked until Houston resets the loop; the escalation reaches you through CAPCOM.
- Gate G, `breaker.consecutiveFailures`: each failed build or failed verification adds one to a consecutive count, and a verified, integrated item resets it. When the count reaches the limit the mission is `halted`, even in autopilot. CAPCOM explains from the failure history and offers options: revise the plan, change scope, raise a budget in config, or abort.

## Approvals

When a gate needs your approval, Houston or Flight stops with a report beginning `WAITING_FOR_APPROVAL gate <id> ref <ref>`. CAPCOM shows you what is being approved, the evidence and a recommendation, asks, and records your answer as granted or denied. Only CAPCOM resolves approvals. A denied ref cannot be requested again. Pending approvals appear in `/interstage:status`, and approvals are stored in `missions/<id>/approvals.json`.

## Troubleshooting

### `/interstage:doctor`

A read-only report; it installs nothing. It prints:

- the `omp` and `bun` versions, `git` (marked MISSING if absent) and `gh` (optional, with whether it is authenticated);
- languages detected from marker files in the project root, each with the tools it looked for and an install hint for the missing ones;
- the six model roles (`capcom`, `orchestrator`, `planner`, `reviewer`, `coder`, `scout`) and `NOT SET` for any that are unset;
- whether `.gitignore` lists `.interstage/`;
- config errors and unknown config keys;
- the active mission, and every mission that is not `complete` or `aborted`.

### A role alias is not defined

Agents select models as `"@<role>, @default"`. If a role is not set, the spawn falls back to your default model role. The forge skill documents that a role alone with no fallback fails the spawn with `No model selected`, which is why the validator requires the `@default` fallback. Run `/interstage:doctor` to see which roles are `NOT SET` and `/interstage:init` to set them. Without it you get your default model in every role, which works but ignores the strong, balanced and fast split.

### A command was blocked by a hook

Block reasons come from the extension. The reason text is returned to the agent that was blocked:

| Reason | Cause |
|---|---|
| `Gate <D\|E\|F> blocks this <install\|network\|merge\|ship> command (<command>): do not retry it, and report the need to your orchestrator as an open question.` | A subagent ran a bash command in a gated class while the autonomy level required approval and no matching granted approval exists. Grant it through CAPCOM, or change autonomy or `ship` in config. |
| `<tool> is blocked for CAPCOM. ...` or `bash is blocked for CAPCOM except the import chunker script. ...` | CAPCOM tried to change the project. It hands the work to Houston instead; for work you want to do yourself, use plain `omp` without `--interstage`. |
| `CAPCOM spawns only houston, and you asked for "<agent>". ...` | CAPCOM tried to spawn another agent. |
| `Mission <id> is paused\|halted (...), so no new agents start until CAPCOM resumes it.` | See Pause and Budgets above. |
| `Mission <id> is complete\|aborted, so no new agents start; houston must create a new mission first.` | The mission is finished. |
| `Pogo loop <n> used <x> of <y> tokens, so houston must reset the Pogo loop before spawning pogo again.` | The Pogo loop budget is spent. |

Command classes, matched on each segment of a bash command split at `&&`, `||`, `;`, `|` and newlines (quoted text is matched too, so the check errs toward blocking):

- Gate D, install: `npm`, `pnpm`, `yarn` or `bun` with `install`, `add` or `i`; `pip install`; `go get` or `go install`; `cargo install` or `cargo add`; `gem install`; `brew install`; `apt install` or `apt-get install`.
- Gate D, network: `curl`, `wget`, `git clone`, `git fetch`, `git pull`, `gh api`, `npm`, `yarn`, `pnpm`, `bun` or `cargo` with `audit`, `pip-audit`, `docker pull`, `docker build`.
- Gate E: `git merge` of an `omp/task/` branch.
- Gate F: `git push`, `gh pr create`, `gh release create`, `vercel`, `npm publish`, `git tag` with a push flag.

Gates D, E and F are enforced only for subagents and only inside an active mission. Hook failures while reading state are logged and, for the command gate, treated as "no approval" rather than "allowed". The CAPCOM persona file can be replaced for testing with the `INTERSTAGE_PERSONA_FILE` environment variable; if the persona file is missing or empty, `omp` shows an error and CAPCOM runs without its persona.

## Packs and skills

Packs are separate plugins that contain only skills: `interstage-observability` (structured logging, trace correlation, log analysis), `interstage-web` (web review), `interstage-data` (database optimization, data validation, data flow architecture, database testing), `interstage-ops` (performance profiling) and `interstage-forge` (authoring guide). Install them as described in the README. OMP has no plugin dependency mechanism, so install the core plugin as well; the packs' skills are meant to be read by the Interstage agents.

Agents autoload at most three core skills and read the rest on demand. Agent prompts that point at a pack skill read it only if it is installed; a missing pack skill is not an error. To add your own skills or a new pack, see [AUTHORING.md](AUTHORING.md).
