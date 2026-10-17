---
name: is-verify-claims
description: Independently re-verify claims that work is done, tests pass, a feature is wired up, or a system is operational. Use when reviewing a builder's report, a CI summary or a progress record, and before accepting any item as complete.
license: MIT
---

# Verify Claims

Trust nothing you did not observe yourself. A claim is a hypothesis until you have re-run the check in this session and seen the output. Your verdict is `clean` or `not clean`; there is no "mostly clean".

## Method

1. **Extract claims** from the report, commit message, TODO `done-when` list, test summary and docs. Write each as one checkable sentence ("`T-014` rejects an expired token with 401").
2. **Rank** by impact if false, then by how cheaply it can be checked. Check the expensive, high-impact ones first, the cheap ones always.
3. **Re-run, do not read.** Run the project's own test, build and lint commands yourself and read the real output. A pasted log from the claimant is not evidence. Exit code 0 alone is not evidence either: read what ran, how many tests, and what was skipped.
4. **Probe past the claim.** Vary the input, the data, the environment and the failure path, not only the case the claimant tried.
5. **Record** per claim: verified, refuted, or could not verify, with the evidence.

## Rules

- **Stale evidence is no evidence.** Any result older than the latest change to the code it covers must be re-run. This includes your own earlier runs.
- **Absence of evidence is not evidence of absence.** "No errors found" by a check that could not have found them (wrong path, filtered test selection, zero tests collected) proves nothing. Confirm the check can fail before trusting that it passed.
- **Tests pass for the wrong reason.** Look for: assertions that are always true, mocks of the unit under test, the expected value copied from the implementation, tests skipped or focused (`only`, `skip`, `xfail`), a failure swallowed by a catch, a fixture that already contains the answer, a test that never calls the new code. Check by breaking the code on purpose in a temporary copy or git worktree outside the mission branch (never the mission checkout or the verification worktree you were given), or by reading the assertion against the spec, and confirm the test would fail.
- **Completion is binary.** Done means every acceptance criterion is observably met. "99 percent" and "just needs wiring" mean not done.
- Do not fix what you find; report it.
- Work inside the absolute worktree path the orchestrator gives you. Run its `Setup` line (dependency install) only if approved; if dependencies cannot be installed, report the affected `done-when` conditions as unverified.
- **Verification policy.** `lsp` diagnostics count only when the tool and a server for the changed files exist; otherwise record a `minor` finding `lsp unverified` and continue, unless Q01 or the assignment requires diagnostics (then `major`). A `done-when` condition you cannot verify is `major`. Flaky tests are findings, never retried to green.

## Checks by claim type

| Claim | Verify by |
|---|---|
| Tests pass | Run the full relevant suite; confirm the count of tests run, that new tests exist and exercise the new code, and that they fail when the behavior is removed |
| Feature built | Execute the user-visible path end to end; confirm the entry point is reachable (route registered, command exported, flag read) and every new function has a caller |
| Matches spec | Compare each spec clause to code with `file:line`; see `skill://is-spec-gap-analysis` |
| Bug fixed | Reproduce the original failure on the old code, then show it gone on the new code, plus a regression test |
| System operational | Start it, hit a real endpoint or command, and read the response; a process existing is not health. If the bash hook blocks `curl` or `wget`, use the language's HTTP client or the project's own CLI, or report the need as an open question |
| Docs accurate | Follow the documented steps literally in a clean state |
| Progress record says done | Treat as a claim about the code, not about the record; check the code |

## Completion hierarchy

1. **Present**: code exists and compiles.
2. **Functional**: runs in isolation; unit tests pass, possibly on mocks.
3. **Integrated**: connected to the real dependencies and callers; real data paths exercised.
4. **Verified**: error paths, edge cases and negative cases tested; the acceptance criteria are shown by running them.
5. **Complete**: all specified behavior implemented, no stubs or placeholders left, docs and tests match the code.

An item is complete only at level 5. Report the highest level you can evidence and what is missing for the next.

## Tier 1: static checks (read the code)

- No empty bodies, stubs, `NotImplemented`/`unimplemented` throws, or `TODO` markers in delivered paths (use the language's AST or lint rules where they exist; text search misses `() => {}`).
- Every import and symbol resolves; type check and build succeed.
- New code is reachable: find callers, registrations, exports and config entries.
- Hardcoded sample data, fixtures or in-memory stand-ins are not wired into production paths.
- Async and fallible calls handle errors; no swallowed exceptions.

## Tier 2: runtime checks (execute)

- The program starts and the new path runs against real collaborators the item names (database, queue, API), not mocks, when the project provides them locally.
- Configuration and environment values the code needs are present and work.
- A health, status or smoke command succeeds and returns the expected content.
- Network, disk and database effects are observed, not assumed; see `skill://is-testing-expected-results`.

Production readiness (monitoring, on-call, compliance) is outside this skill.

## Domain sanity

Behavior can be technically correct and still wrong for the domain. Check units and conversions, value ranges, time zones and DST, rounding and currency, data volumes, realistic constants (a timeout, rate, limit or tax figure copied from nowhere), and domain invariants (balances never negative, totals equal the sum of parts, legal state transitions). Look up domain facts in the project's docs first and cite the source; you have no web search, so list outside sources you would need under Open questions. An assumption you cannot confirm is not a finding: report it as an open question to the orchestrator.

## Output

```
## Verdict
clean | not clean   (clean = zero blockers, zero majors)

## Findings
1. [blocker|major|minor|nit] <title>
   Claim: <what was claimed and where>
   Evidence: <file:line, or the command you ran with its real output>

## Claims that could not be verified
- <claim>: <why not, and what would be needed>

## Open questions
1. ...
```

Severity: `blocker` is wrong behavior or a claim shown false; `major` is likely rework (missing wiring, tests that cannot fail); `minor` and `nit` never gate. No quotas: no findings is a valid result.

## References

- `references/anti-patterns.md`: the common ways work looks complete but is not.
- `references/detection-guide.md`: how to detect each one by static and runtime inspection.
