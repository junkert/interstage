---
name: is-index
description: Use when a directory needs an `_index.md` orientation file. Proposes drafts in the report; writes into the repository only at paths a TODO item names, and never overwrites a human-authored `_index.md`.
license: MIT
---

# Directory index

Propose-only. Put each draft in the specialist report; the orchestrator stores it at `$INTERSTAGE_STATE_DIR/missions/<id>/evidence/index-proposals/<mirrored path>/_index.md`.

Write into the repository only at paths a TODO item names, as one commit (`<TODO-ID>: <imperative title>`). Never overwrite an existing `_index.md` that a human wrote; propose a diff instead.

## Template

```markdown
# Directory: <path>/

## Purpose
<one or two sentences from what the code does>

## Contents
- **<name>/** - <one-line role>

## Conventions
- <convention observed in the code, with a file:line example>

## Related Directories
- `<path>/` - <relationship>
```

## Rules

- Describe only what the files show; mark unknowns as `Unknown`.
- List names and roles only, not the contents of subdirectories.
- Keep it short; no dates, counts, or coverage figures.
- Do not assume team structure or process.
- Skip generated, vendored and build-output directories.

## Monorepo

Index the repo root and each package or app root; link packages from the root index.
Shared code gets its own index naming which packages consume it.
