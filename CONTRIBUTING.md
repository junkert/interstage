# Contributing

Interstage is a framework of OMP plugins (agents, skills, commands and one small TypeScript extension). The design lives in [docs/DESIGN.md](docs/DESIGN.md); the build order in [docs/PLAN.md](docs/PLAN.md).

## Setup

You need [Bun](https://bun.sh) 1.3.14 or newer, [shellcheck](https://www.shellcheck.net), `git`, and [OMP](https://github.com/can1357/oh-my-pi) for anything that runs the framework. Make sure `~/.bun/bin` is on your `PATH`.

```bash
bun install
```

## Checks

```bash
bun run check         # validate + typecheck + test, then shellcheck
bunx nx run-many -t validate typecheck test
bunx nx affected -t validate typecheck test   # only projects your changes touch
bun run shellcheck
```

CI runs the same checks on Linux and macOS. It never calls a model.

## Adding a skill, agent or pack

Local Nx generators (`tools/generators`) scaffold new content and register it. Each refuses to overwrite existing files, requires kebab-case names, and accepts `--dry-run` to preview.

```bash
bunx nx g @interstage/generators:skill --plugin=interstage-web --name=<name> --description="<trigger statement>" [--budgetBytes=3000]
bunx nx g @interstage/generators:agent --name=<name> --description="<when to delegate>" --role=<orchestrator|planner|coder|reviewer|scout> --tools="read, grep, glob" [--skills="is-<name>"]
bunx nx g @interstage/generators:pack --name=<name> --description="<pack description>" --skillDescription="<trigger statement>" [--skill=<name>]
```

- `skill` writes `plugins/<plugin>/skills/is-<name>/SKILL.md` (give `--name` without the `is-` prefix) and an `authored` entry in `skills.manifest.json`.
- `agent` writes `plugins/interstage/agents/<name>.md`; the Operating rules block is copied from the existing agent files. Add the agent to the `spawns` list of the orchestrators that delegate to it.
- `pack` writes `plugins/interstage-<name>/package.json` (give `--name` without the `interstage-` prefix), a first skill, and the marketplace catalog entry. Run `bun install` afterwards to link the new workspace and update `bun.lock`.
- Generated files pass the validator but contain `Replace:` markers; the generator lists them. Rewrite every marker, then run `bun run check`.

## Rules for content

- Agents and skills state facts and procedures. They contain no fabricated sample reports, scores, dates, dollar figures or human schedules, and no commands that do not exist.
- Findings need evidence (`file:line`, a reproduction, or a cited spec clause). There is no findings quota, and a clean report is valid.
- Severity is `blocker`, `major`, `minor` or `nit`. A review is clean at zero blockers and zero majors.
- Shell scripts pass `shellcheck -S warning` and work on both macOS and Linux.
- Adapted upstream skills are recorded in `skills.manifest.json` and credited in `THIRD_PARTY_NOTICES.md`.

## Commits

One logical change per commit, with an imperative subject. Do not push without review.
