# Changelog

All notable changes to Interstage are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The plugin manifests currently declare version 0.1.0; nothing has been released yet.

## [Unreleased]

### Changed

- Flight and Houston `task` calls that spawn an executor must set `isolated: true` and name the task exactly its TODO id (flat and `tasks` batch forms), and `set_status complete` requires at least one item with every item `done`.
- Process evidence: `transition` now requires recorded spawns (executor for builder results, `go-no-go` and `inspector` for verification results) and, for `integrate_ok`, a recorded task-branch merge newer than `builder_done` and a commit whose subject starts with `<ID>: `.
- Fewer lockouts, after a run where CAPCOM could not read mission state, answer Houston, honor a direct user instruction or clear a stale mission, and Houston could not run `ssh`:
  - CAPCOM has no tool or bash block and no spawn restriction; its persona delegates by default and says how to reach `mission` (it is only a bash command in current OMP, which the old block made unreachable).
  - Houston may start while a mission is paused or halted; a budget halt lifts itself when the budget is raised; `create` parks a still-running mission as `paused` instead of refusing; budget and breaker halts record `haltCause`.
  - Flight and Houston bash may run any program; only file writes by redirect, here-document or `tee` are refused.
- Token budgets count billable tokens (`input + output + cacheWrite`) and exclude cache reads, which made a budget grow with conversation length squared. Status and the budget view show cache reads separately; usage records missing the token fields are reported as malformed.

### Added

- `/interstage:resume`: moves a paused or halted mission back to running and asks CAPCOM to hand it to Houston.
- CAPCOM is shown a snapshot of the mission state read from disk (active mission, items, pending approvals, parked missions) at the start of every turn, and the active mission is remembered in `<state dir>/active-mission` so a restart resumes the right one.
- `set_status` accepts `aborted`; CAPCOM may close any mission as `complete` or `aborted` for the user.
- Marketplace catalog `.omp-plugin/marketplace.json` with six plugins: the core plugin `interstage` and the packs `interstage-observability`, `interstage-web`, `interstage-data`, `interstage-ops` and `interstage-forge`.
- Core plugin extension: the `--interstage` flag and `/interstage:launch`, the CAPCOM persona, runtime-only OMP overrides, the `mission` tool and mission state under `.interstage/`, steering packets, token budgets, the circuit breaker, autonomy gates A to G enforced by tool and spawn hooks, and the layered config (`interstage.yml` for the user, `.interstage/config.yml` per project).
- Commands: `/interstage:init`, `launch`, `status`, `abort`, `doctor` (extension) and `plan`, `import`, `promote` (markdown prompts), plus the `chunk-conversation.sh` import script.
- Agents: houston, flight, fido, pogo, hubble, sojourner, ingenuity, curiosity, perseverance, orbiter, go-no-go, inspector, kessler, tiger-team, booster and golden-record.
- Core skills (prefixed `is-`) for specification, review, verification, testing, debugging, migration, security, documentation and release, plus pack skills for observability, web, data, ops and authoring (`is-forge`), recorded in `skills.manifest.json` with upstream credit in `THIRD_PARTY_NOTICES.md`.
- `tools/validate`: validator for the marketplace catalog, plugin manifests, MCP config, commands, skills, agents, the skills manifest, third-party notices, TODO files and content lints.
- `tools/generators`: Nx generators `skill`, `agent` and `pack`.
- `install.sh`: installer wrapper around `omp plugin` with `--packs`, `--all-packs`, `--dry-run`, `--uninstall` and `--help`.
- Documentation: `README.md`, `docs/USAGE.md`, `docs/AUTHORING.md`, `docs/DESIGN.md`, `docs/PLAN.md`, `docs/CONTRACTS.md` and `CONTRIBUTING.md`.
- CI that runs validation, typechecking, tests and shellcheck on Linux and macOS.
