# interstage

Interstage is a framework of agents and skills for [OMP](https://github.com/can1357/oh-my-pi) (oh-my-pi) that builds and maintains software projects. You talk to one agent, CAPCOM. It hands a request to Houston (the project orchestrator), who plans the work with a planner and a devil's advocate and passes the build to Flight, who runs a loop over a TODO list: one isolated builder per item, independent verifiers, one commit per verified item on a mission branch. Gates, an autonomy level, token budgets and a circuit breaker keep the loop under your control. It ships as user-scope OMP plugins, so nothing is checked into the projects you work on. Hardware projects are planned for a later release.

Design and contracts: [docs/DESIGN.md](docs/DESIGN.md), [docs/PLAN.md](docs/PLAN.md), [docs/CONTRACTS.md](docs/CONTRACTS.md). Day-to-day use: [docs/USAGE.md](docs/USAGE.md). Writing skills, agents and packs: [docs/AUTHORING.md](docs/AUTHORING.md).

## Install

Interstage is one marketplace (`.omp-plugin/marketplace.json`) with a core plugin, `interstage`, and optional skill packs: `interstage-observability`, `interstage-web`, `interstage-data`, `interstage-ops` and `interstage-forge`. Core alone is the default install.

### With the installer

From a clone of this repository (the script lives at the repository root and is a thin wrapper around `omp plugin`; it needs `omp` on your `PATH`):

```bash
./install.sh                       # core plugin only, marketplace source junkert/interstage
./install.sh .                     # same, but use this clone as the marketplace source
./install.sh --packs web,data .    # core plus the chosen packs
./install.sh --all-packs .         # core plus every pack
./install.sh --dry-run --all-packs .
./install.sh --uninstall           # remove core, installed packs and the marketplace
./install.sh --help
```

Options: `--packs a,b` (any of `observability`, `web`, `data`, `ops`, `forge`), `--all-packs`, `--dry-run` (prints what would happen and changes nothing), `--uninstall`, `--help`. An optional positional `SOURCE` is an `owner/repo` or a local path; the default is `junkert/interstage`. Re-running is safe: an existing marketplace is refreshed and installed plugins are upgraded. The script only warns when your `omp` is older than 18.11.3.

### With raw omp commands

```bash
omp plugin marketplace add junkert/interstage
omp plugin install interstage@interstage
omp plugin install interstage-web@interstage
```

The last line is an example of installing a pack; use the pack names listed above. `omp plugin --help` lists the other actions (`list`, `uninstall`, `upgrade`, `doctor`, ...) and the `--scope user|project` flag; user scope is the default.

Verified so far: adding a marketplace from a local directory, then discovering, installing, upgrading and uninstalling its plugins (see the spike results in DESIGN). A GitHub-hosted marketplace source was not exercised; if `junkert/interstage` does not resolve for you, clone the repository and pass its path to `omp plugin marketplace add`.

## Quickstart

1. Start a session with Interstage on: `omp --interstage`. (Inside a plain `omp` session, `/interstage:launch` does the same.)
2. Run `/interstage:init` once. It creates the project's `.interstage/` directory, offers to add `.interstage/` to `.gitignore`, asks you for a strong, a balanced and a fast model, and writes the model roles and a default settings file.
3. Give CAPCOM a request in plain language. It interviews you, picks a lane (`fast`, `standard` or `full`) and hands off to Houston. Approvals reach you as questions from CAPCOM.

`/interstage:doctor` checks your environment at any point and installs nothing. See [docs/USAGE.md](docs/USAGE.md) for everything else.

## The cast

CAPCOM is not an agent file: it is a persona (`plugins/interstage/persona/capcom.md`) appended to the main session's system prompt when Interstage is active. The agents below live in `plugins/interstage/agents/`.

| Agent | Role |
|---|---|
| houston | Project orchestrator. Creates the mission, runs the spec phase, registers the TODO, requests gates A and B, then hands the build to Flight. Runs fast-lane items itself. |
| flight | Mission sub-orchestrator. Runs the build loop over the TODO: builders in isolated worktrees, verifiers, the planner; integrates verified items one commit each, applies steering, enforces gates and the circuit breaker. |
| fido | Planner and architect. Writes the SPEC and the TODO, and acts as the build loop's planner when an item is stuck. |
| pogo | Devil's advocate. Reviews specs, TODOs and assumptions for gaps and wrong claims, with evidence. |
| hubble | Research specialist. Finds libraries, documentation and prior art, with cited sources. |
| sojourner | Read-only scout for narrow, cheap reconnaissance of a named area. |
| ingenuity | Read-only scout for a broad survey of a repository or subsystem. |
| curiosity | General builder. Implements one TODO item in an isolated checkout. |
| perseverance | Long-running builder for migrations and refactors. |
| orbiter | Author and runner of integration, end-to-end and contract tests. |
| go-no-go | QA runner and gate (functional and integration layers). |
| inspector | Independent verifier (quality, spec compliance, edge cases) and gap analyst. |
| kessler | Static security review of code, configuration, dependencies, CI, Dockerfiles and IaC. Never contacts running targets. |
| tiger-team | Evidence-first debugging and post-mortems. |
| booster | DevOps, CI and release preparation; never ships without approval. |
| golden-record | Documentation writer; marks unknowns and reports spec drift. |

## What lives where

- **User scope.** The plugins are installed by OMP into your user configuration. Your own settings live under `~/.omp/agent/` (or `$PI_CODING_AGENT_DIR` when set): `modelRoles` written by `/interstage:init` and the optional `interstage.yml`.
- **Per project.** Mission state lives in `<project>/.interstage/`, which is meant to be gitignored. Nothing else is written into the project by the framework.
- **Into the repository only on request.** The one exception to "nothing committed" is `/interstage:promote`, which copies a named mission artifact (for example the spec) into the repository after you approve it, as a single commit. Builders commit only on isolated task branches and Flight squash-merges them onto the mission branch (`mission/<id>-<slug>`). Nothing is pushed.
- **Without the flag.** Plain `omp` keeps its normal behavior, apart from what the core plugin adds globally: its skills appear in the skill list and its Context7 MCP server loads. The Interstage agents are hidden, and the persona and commands apply only with `--interstage` or `/interstage:launch`.

## Requirements

- [OMP](https://github.com/can1357/oh-my-pi) (developed and tested against 18.11.3) with at least one authenticated model provider.
- `git`. The GitHub CLI `gh` is optional and only needed for pull requests.
- To work on this repository: [Bun](https://bun.sh) and [shellcheck](https://www.shellcheck.net); see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE). Several skills are adapted from [wojons/skills](https://github.com/wojons/skills), also MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [skills.manifest.json](skills.manifest.json) for what was adapted and from where.
