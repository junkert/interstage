# Changelog

All notable changes to Interstage are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The plugin manifests currently declare version 0.1.0; nothing has been released yet.

## [Unreleased]

### Changed

- Process evidence: `transition` now requires recorded spawns (executor for builder results, `go-no-go` and `inspector` for verification results) and, for `integrate_ok`, a recorded task-branch merge newer than `builder_done` and a commit whose subject starts with `<ID>: `. Flight and Houston bash is limited to git and read-only inspection.
- Token budgets count billable tokens (`input + output + cacheWrite`) and exclude cache reads, which made a budget grow with conversation length squared. Status and the budget view show cache reads separately; usage records missing the token fields are reported as malformed.

### Added

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
