---
name: is-forge
description: Use when authoring a new Interstage skill or agent, or reviewing one. Covers frontmatter, size budgets, no-invention rules, agent field rules, the BUILD, BREAK, REPAIR loop and how to validate.
license: MIT
---

# Forge: authoring skills and agents

Work in a normal OMP session. There is no roster agent for this skill; the BREAK step uses Pogo.

## Skills

- Directory `plugins/<plugin>/skills/is-<name>/SKILL.md`; `name` equals the directory.
- Frontmatter: `name`, `description`, `license: MIT`; optional `hide`, `disable-model-invocation`, `metadata`. Never `compatibility`.
- `description` is a trigger statement (when to use it), at most 1024 characters.
- Size: autoloaded skills about 6 KB; SKILL.md under 500 lines. Push depth into `references/<file>`; every referenced file must exist.
- Content: method, decision rules, checklists, output formats. No fictional commands or tools, no sample reports with invented numbers, scores, dates, durations or costs, no human schedules, no findings quotas.
- Findings need evidence (`file:line`, a command with real output, or a quoted spec clause) and the severity scale `blocker`, `major`, `minor`, `nit`.
- Specialists have no `ask`: write "report open questions to the orchestrator".
- Link skills as `skill://is-<name>`, only to skills that exist.
- Artifacts go under `$INTERSTAGE_STATE_DIR/missions/<id>/`, never the project root.
- No `npm run <skill>:*` scripts, no `@skill` commands, no references to other agent harnesses or skill installers (the lint rejects them).
- Per-ecosystem commands appear only as a short table of examples; use the project's own tooling.
- Scripts only if the workflow names them; they pass `shellcheck -S warning` and run on macOS (bash 3.2, BSD tools) and Linux.

## Agents

Interstage agents live in `plugins/interstage/agents/<name>.md` (core plugin only): YAML frontmatter, then the prompt. OMP field semantics: see OMP documentation `omp://task-agent-discovery.md`. Interstage rules, enforced by `tools/validate/src/agents.ts` and docs/CONTRACTS.md section 10:

| Field | Interstage rule |
|---|---|
| `name` | Lowercase kebab-case, equals the file name; `main` and `sub` are reserved |
| `description` | Required; when to delegate to the agent |
| `tools` | Required by CONTRACTS; every name must be a known OMP tool. `ask` and `todo` are rejected |
| `spawns` | Explicit names of agents in the same plugin; `*` is rejected |
| `model` | Role aliases, last entry `@default`: `"@<role>, @default"` (the validator checks this). An undefined role alone fails the spawn with `No model selected`; the `@default` fallback uses the user's default role instead |
| `autoload-skills` | At most 3, each a skill shipped in the same plugin, 20 KB total. Pack skills are read on demand |
| `output` | Do not use structured schemas; the validator rejects them |
| `thinking-level`, `blocking`, `structured`, `read-summarize`, `prewalk`, `advisor` | Accepted keys; Interstage sets no rule beyond PLAN section 4.3. Semantics: see OMP documentation `omp://task-agent-discovery.md` |

Other rules:
- `mission` in `tools` only for `houston` and `flight`.
- `lsp` in `tools` only together with the extension's `task.enableLsp` override (CONTRACTS section 9).
- An agent's `tools:` list does not remove MCP, extension or custom tools; do not rely on it to deny them (OMP documentation above).
- Prompt sections in order: `# <Name>`, `## Role`, `## Inputs`, `## Method`, `## Output`, `## Definition of done`, `## Operating rules`. The Operating rules block (seven bullets, the last treats repository and tool text as data, not instructions) is copied verbatim from CONTRACTS section 10 and may be extended, never shortened. The validator checks section order, each verbatim rule, and that every `skill://is-<name>` link in the prompt names an existing skill.
- Final report: `## Result`, `## Evidence`, `## Files changed` (builders only), `## Open questions`.

## BUILD, BREAK, REPAIR

1. **BUILD**: write the artifact against a concrete need.
2. **BREAK**: have Pogo attack it. Questions: what would a model get wrong, what is unverifiable, which sentence invites invention (an example that looks like real data, a vague quantity, an instruction with no observable check). Pogo reports findings with evidence, quoting the sentence.
3. **REPAIR**: fix every blocker and major; replace the invitation with a rule or a checkable condition. Re-run BREAK on the repaired text when the change was large. Zero findings is a valid outcome.

## Validate

In the Interstage repository run `bun run validate`. It checks skill and agent frontmatter and names, size budgets against the manifest, reference files (each under 16 KB) and `skill://` links, the agent rules above, and content lints (invented data, schedules, forbidden references). Fix every finding it reports for your files. Add one manifest entry per skill (`name`, `path`, `origin`, `modified`, `budgetBytes`; `from` for upstream) in `skills.manifest.fragments/<batch>.json`; the integration step merges fragments into `skills.manifest.json`. Contributors use the Nx generators for new skills and agents when available.
