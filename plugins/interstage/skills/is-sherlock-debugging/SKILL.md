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
3. **Eliminate.** Run diagnostics that separate the hypotheses: binary search over the code path, check each assumption, reconstruct the timeline. For a regression, use `git bisect` with the failing test as the oracle: start from a clean tree, in your own isolated checkout, and always finish with `git bisect reset`. Discard contradicted hypotheses and record why.
4. **Confirm.** The cause must explain every symptom. Predict an observable result and check it.
5. **Regression test, then fix.** Keep the failing test from step 1 (or sharpen it), see it fail for the right reason, then make the minimal fix and see it pass with the rest of the suite.
6. **Clean up.** Remove all diagnostics (prints, debug flags, temp files) before committing. A builder-style item may use checkpoint commits on the task branch with the message exactly `<TODO-ID>`; the orchestrator squashes at integration. Revert only inside your own isolated checkout.
7. **Report** the case file below.

## Stuck rule

After 3 failed hypotheses on one item, stop and report BLOCKED to the orchestrator with the evidence gathered and the hypotheses ruled out. If evidence contradicts itself, re-verify it first. If data is missing, report an open question to the orchestrator.

Avoid theorizing before data, confirmation bias, and random changes; always check when the issue started and what changed then.

## Case file

Return it in the specialist report (Result, Evidence, Open questions); the orchestrator stores it in `evidence/`.

- Case, status (SOLVED, IN PROGRESS, BLOCKED), confidence (high, medium, low)
- Evidence gathered, each with `file:line`, command output or log line
- Hypotheses tested: ruled out or confirmed, with the evidence
- Root cause with `file:line`
- Fix: the TODO id, and the regression test name
- Verification: commands run and results
- Open questions and prevention suggestions

Findings use the severity scale and need evidence; a clean result is valid.

## Post-mortem (from supplied artifacts only)

Use when asked to analyze an incident from logs, commits and notes you were given. Do not invent missing facts; list them as open questions. Return the analysis in the specialist report (Result, Evidence, Open questions).

1. Impact: what failed, for whom and for how long, only if the artifacts show it.
2. Timeline: events in order, each citing the log line or commit (`file:line`, id).
3. Detection and recovery: how it was noticed and how it was resolved, from the artifacts.
4. 5 Whys: one evidenced linear chain from the observed failure down to a systemic cause. If you follow a branch, give explicit evidence for that branch.
5. Contributing factors: detection, process, tests, design.
6. What worked well.
7. Blameless wording: describe systems and decisions, never individuals.
8. Proposed TODO items: title and `done-when` only, no owners or dates.
9. Rollback or mitigation advice is a recommendation to the orchestrator only; do not perform it.
