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
- Per-ecosystem commands appear only as a short table of examples; use the project's own tooling.
- Scripts only if the workflow names them; they pass `shellcheck -S warning` and run on macOS (bash 3.2, BSD tools) and Linux.

## Agents

File `plugins/interstage/agents/<name>.md`: YAML frontmatter, then the prompt.

| Field | Rule |
|---|---|
| `name` | Equals the file name. Required |
| `description` | When to delegate to it. Required |
| `tools` | Explicit list. Required. Never `ask` or `todo` |
| `spawns` | Explicit agent names, never `*` |
| `model` | Required, as `"@<role>, @default"`; an undefined role without the fallback fails the spawn |
| `thinking-level` | Optional reasoning level |
| `output`, `structured` | Optional output schema controls |
| `blocking` | Optional; whether the parent waits |
| `autoload-skills` | At most 3 core skills, within 20 KB total |
| `read-summarize`, `prewalk`, `advisor` | Optional OMP behaviors; set only when the agent needs them |

Check optional field semantics against the OMP docs before using them.

Interstage rules:
- `lsp` in `tools` only together with the extension's `task.enableLsp` override.
- The `mission` tool only for `houston` and `flight`.
- MCP tools cannot be restricted by `tools:`; do not rely on that to deny them.
- Prompt sections in order: `# <Name>`, `## Role`, `## Inputs`, `## Method`, `## Output`, `## Definition of done`, `## Operating rules`. The Operating rules block from docs/CONTRACTS.md section 10 is copied verbatim and may be extended, never shortened.
- Final report: `## Result`, `## Evidence`, `## Files changed` (builders only), `## Open questions`.

## BUILD, BREAK, REPAIR

1. **BUILD**: write the artifact against a concrete need.
2. **BREAK**: have Pogo attack it. Questions: what would a model get wrong, what is unverifiable, which sentence invites invention (an example that looks like real data, a vague quantity, an instruction with no observable check). Pogo reports findings with evidence, quoting the sentence.
3. **REPAIR**: fix every blocker and major; replace the invitation with a rule or a checkable condition. Re-run BREAK on the repaired text when the change was large. Zero findings is a valid outcome.

## Validate

In the Interstage repository run `bun run validate`. It checks skill and agent frontmatter, names and size budgets, `skill://` links and referenced files, agent rules (tools, spawns, model alias, autoload limits, required sections), and the content lints (invented data, schedules, forbidden references). Fix every finding it reports for your files.

Then add a manifest entry (`name`, `path`, `origin`, `modified`, `budgetBytes`; `from` for upstream). Use the Nx generators for new skills and agents when available.
