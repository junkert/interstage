---
name: is-testing-expected-results
description: Verify that a command or operation produced the outputs and side effects it should, not just exit code 0. Use when checking scripts, migrations, builds, exports, deploy-like steps or any command whose success is more than "did not fail".
license: MIT
---

# Testing Expected Results

Exit code 0 does not mean success. Success does not mean correctness. Define what must be true afterward, run the command, and check each thing yourself.

## Procedure

1. **Write expectations first**, before running. For each: what is checked, how, and why it matters. Include what must not happen.
2. **Capture pre-state** of everything the command could touch: file listing with sizes or hashes, database rows or schema, running processes and listening ports, relevant environment variables, `git status`. Use the project's own tools.
3. **Run the real command** with a timeout, capturing stdout, stderr and exit code separately. Run it in the isolated worktree or a scratch copy when it writes.
4. **Capture post-state** the same way.
5. **Compare** with the matching mode below; report observed values.
6. **Clean up** only what you created.

## Comparison modes

| Mode | Use for |
|---|---|
| Exact | Deterministic output; compare bytes or hash |
| Pattern | Variable parts (timestamps, UUIDs, ids): match the shape, and assert the fixed parts exactly |
| Range | Numbers such as size, count, duration: state the bound and its reason |
| Structure | JSON, YAML, XML: compare parsed values, ignore key order and whitespace, check required paths and types |
| Semantic | Meaning over bytes: same rows in a different order, equivalent formatting, a file that parses and validates |
| Existence | A thing must exist, or must not exist |
| Delta | Change between pre-state and post-state: "three rows added", "file grew", "one process started" |

Prefer structure, pattern or semantic comparison over exact strings when output is not deterministic. Assert exhaustively: a partial list of expectations gives false confidence.

## Side-effect checklist

- **Files**: created, modified, deleted, moved; sizes, permissions, contents parse; no stray temp files.
- **Database**: rows inserted, updated or removed; schema, indexes and constraints; counts before and after.
- **Processes and network**: service started, stopped or restarted; port bound; a real request returns the expected body, not just a 200.
- **Git and repo**: only the intended files changed; nothing committed or pushed unless the task says so.
- **External**: messages queued, cloud resources, calls made. Check only what the environment lets you observe; list the rest as unverified.
- **Output streams**: stderr empty or explained; no `ERROR`, `warning` or stack trace in stdout that the exit code hid.

## Negative assertions

For every positive expectation, ask what the command must not do, and check it: files outside the target are unchanged (compare the pre-state hash), no records deleted beyond the stated scope, no secrets in output, no extra processes left running, the data being operated on is not modified when the command is a read-only export.

## Async and delayed effects

For eventual effects (queues, deploy rollouts, background jobs, caches): poll the condition at a fixed interval until it holds or a timeout expires. Choose the timeout from the operation's documented behavior, not from impatience, and report it. A timeout is a failed expectation, not a reason to retry silently. Do not use a bare sleep as the check.

## Limitations

- In-memory state, client-side state and anything in systems you cannot reach are unobservable; say so.
- Time-of-check versus time-of-use: state can change between capture and comparison. Capture close to the run and compare promptly; re-capture if anything else is running.
- Changes after your timeout are missed.
- Non-deterministic commands may differ between runs; run twice before calling a difference a defect.
- The check is only as good as the expectation list. Missing expectations are the verifier's gap.

## Output

```
## Result
<met | not met>, one paragraph

## Expectations
| # | Expectation | Mode | Observed | Met |

## Evidence
- the command, its exit code, and the relevant real output
- pre-state and post-state values compared

## Not verified
- <effect> : <why it was out of reach>
```

Severity: an unmet expectation about required behavior or unintended damage is a `blocker`; a missed secondary effect is `major`; cosmetic output differences are `minor` or `nit`. See `skill://is-verify-claims` for re-verifying reported results, and `skill://is-testing-integration` for tests that assert these effects permanently.
