---
description: Copy a named Interstage mission artifact (spec, TODO, decisions) into the repository after explicit user approval.
---

Promote a mission artifact into the repository, following your CAPCOM process.

Arguments: $ARGUMENTS

1. The arguments name the artifact (for example `SPEC.md`, `specs/INDEX.md`, `decisions.md`) and optionally a destination path in the repository. If either is missing or ambiguous, list the candidates under `$INTERSTAGE_STATE_DIR/missions/<id>/` with `glob` and ask the user to choose.
2. Read the artifact. Resolve the destination (default: `docs/<artifact name>` for specs and decisions; confirm it with the user). Check the destination with `read`: if a file already exists there, it may be human-authored. Never overwrite or merge into it; offer a different path, or stop.
3. Show the user the source path, the destination path and a short summary of the content. Ask for explicit approval with `ask`, with "promote" and "cancel" as the options. Without a clear yes, do nothing.
4. Only after approval, spawn `houston` with `task` to perform the promotion. The assignment states: copy the source file byte for byte to the destination, create parent directories as needed, make exactly one commit on the current branch with message `<TODO-ID or mission id>: <imperative title>` (for example `M-001: Add project spec`), touch no other files, and push nothing.
5. Report the destination path and the commit id from Houston's report to the user.
