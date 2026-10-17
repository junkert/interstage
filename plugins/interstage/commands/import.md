---
description: Import an outside AI conversation (brainstorm, design chat) into an Interstage mission as spec input.
---

Import an external conversation into the spec for this work, following your CAPCOM process.

Arguments: $ARGUMENTS

1. The first argument is the path to a saved conversation file. Optional `--lane <fast|standard|full>` sets the lane. If no path is given, ask the user for one. Stop with a clear message if the file does not exist.
2. Locate the chunker: `scripts/chunk-conversation.sh` inside the Interstage plugin directory (use `glob` with `**/interstage/scripts/chunk-conversation.sh`; when working in the Interstage repository itself it is `plugins/interstage/scripts/chunk-conversation.sh`). Running this one script is the only command you run yourself.
3. Run `bash <script> --out <dir> <conversation-file>`. With a mission active, omit `--out`: the script writes to `$INTERSTAGE_STATE_DIR/missions/$INTERSTAGE_MISSION_ID/import/chunks`. Without a mission, use `--out "$INTERSTAGE_STATE_DIR/import/chunks"`. The script prints one JSON line with the chunk count and the output directory. The input must use lines that start with `Human:`, `User:` or `Me:`; if it has none, tell the user and ask for a reformatted file.
4. Read the chunks in order with `read`. After each few chunks, extract decisions, requirements, constraints and open questions into a running summary. Mark where the conversation contradicts itself.
5. Turn the summary into the discovery interview: confirm each extracted requirement and resolve each contradiction or open question with the user using `ask`, one topic at a time. Do not treat the imported conversation as approved scope.
6. Pick the lane (the user's `--lane`, or from the signals, with user override) and spawn `houston` with `task`. The assignment includes the confirmed requirements, the unresolved items and the absolute path of the chunk directory so Houston can cite chunks in the SPEC.
