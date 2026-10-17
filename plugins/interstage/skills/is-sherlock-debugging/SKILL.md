---
name: is-sherlock-debugging
description: Use to find the root cause of a bug, failing test, regression or incident by deduction from evidence, then fix it with a regression test. Also covers blameless post-incident analysis from supplied artifacts.
license: MIT
---

# Sherlock debugging

Deduce from evidence; never guess. Prefer the simplest explanation that fits all facts, state confidence honestly, and test hypotheses that contradict your favourite theory. Change one variable at a time; compare working and failing states.

## Loop

1. **Reproduce first.** Write a failing test (or the smallest script) that shows the symptom. Collect the exact error text, stack trace, logs, recent changes and environment from the repo and tools. Form no theory yet. If you cannot reproduce, report an open question to the orchestrator.
2. **Hypotheses.** List plausible causes (logic error, off-by-one, race, resource limit, dependency mismatch, config). For each, note supporting and contradicting evidence; rank.
3. **Eliminate.** Run diagnostics that separate the hypotheses: binary search over the code path, assumption checks, timeline reconstruction. For a regression, use `git bisect` with the failing test as the oracle. Discard contradicted hypotheses and record why.
4. **Confirm.** The cause must explain every symptom. Predict an observable result and check it.
5. **Regression test, then fix.** Keep the failing test from step 1 (or sharpen it), see it fail for the right reason, then make the minimal fix and see it pass with the rest of the suite.
6. **Clean up.** Remove all diagnostics (prints, debug flags, temp files) before committing. Commit `<TODO-ID>: <imperative title>`.
7. **Report** the case file below.

## Stuck rule

After 3 failed hypotheses on one item, stop and report BLOCKED to the orchestrator with evidence gathered and hypotheses ruled out. Contradictory evidence: re-verify the evidence before continuing. Missing data: report an open question to the orchestrator.

## Techniques

- Binary search: frontend or backend, this function or that.
- Assumption challenge: list assumptions ("the config is loaded", "the function returns X") and verify each.
- Timeline: order events by timestamp; the anomaly in the sequence often names the cause.
- Elimination checklist with a status per cause: ruled out, testing, possible.

## Anti-patterns

- Theorizing before data; confirmation bias; random changes under pressure; overlooking simple config errors; ignoring when the issue started and what changed then.

## Case file (report; orchestrator stores it in `evidence/`)

- Case, status (SOLVED, IN PROGRESS, BLOCKED), confidence (high, medium, low)
- Evidence gathered, each with `file:line`, command output or log line
- Hypotheses tested: ruled out or confirmed, with the evidence
- Root cause with `file:line`
- Fix: commit id, regression test name
- Verification: commands run and results
- Open questions and prevention suggestions

Findings use the severity scale and need evidence; a clean result is valid.

## Post-mortem (from supplied artifacts only)

Use when asked to analyze an incident from logs, commits and notes you were given. Do not invent missing facts; list them as open questions.

1. Timeline: events in order, each citing the log line or commit (`file:line`, id).
2. 5 Whys from the observed failure down to a systemic cause, each answer backed by evidence.
3. Contributing factors: detection, process, tests, design.
4. Blameless wording: describe systems and decisions, never individuals.
5. Proposed TODO items: title and acceptance only, no owners or dates.
6. Rollback or mitigation advice is a recommendation to the orchestrator only; do not perform it.
