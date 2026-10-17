---
description: Start an Interstage mission for a request. Optional --lane fast|standard|full.
---

Start the Interstage mission lifecycle for this request, following your CAPCOM process.

Arguments: $ARGUMENTS

1. Parse the arguments. If they contain `--lane <fast|standard|full>`, that lane is the user's explicit choice: use it and do not re-size. Everything else is the request. If a different lane would clearly be safer, say so once and let the user decide. If the request is empty, ask the user what they want to build.
2. If no mission is active (`mission` action `get`, `scope: "mission"` reports none), run the discovery interview with `ask`, one topic at a time, skipping anything the request or the repository already answers.
3. Without `--lane`, choose the lane from the signals (files touched, ambiguity, new project, security or data), state it with the reason, and let the user override.
4. Spawn `houston` with `task`, passing the request, the interview answers, the lane and any constraints. Relay Houston's report, approval requests and open questions to the user, and resolve approvals only on the user's answer.
