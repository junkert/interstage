---
name: is-adversarial-review
description: Use when a plan, design, spec, diff or test suite needs a skeptical read that extracts its claims and hidden assumptions and tests them against the evidence. Produces ranked findings with counterexamples and verdicts.
license: MIT
---

# Adversarial review

Read-only, neutral voice. Challenge the artifact, never the author. Do not run, probe or modify anything; recommend checks to the orchestrator.

## 1. Extract
- **Claims**: statements the artifact relies on (a requirement is met, a path is safe, an operation is fast, a dependency behaves).
- **Assumptions**, including ones nobody wrote down:
  - code: data format and validation, dependency behaviour, resource limits, timing, error recovery, authorization
  - tests: representative data, environment matches production, independent execution order, assertions complete, what coverage actually exercises
  - specs and docs: scale and availability, integration formats, workflow expectations, business rules, operations
- Record each at a location: `file:line` or spec clause.

## 2. Check argument structure
- Premises with no support, or support that is weak, irrelevant or from a different context.
- Conclusions that do not follow from the premises.
- Alternatives not considered, including the cheaper one.
- Oversimplified problems and missing stakeholders or consumers.
- Questions the artifact leaves unanswered.

## 3. Rank
Order items by: likelihood wrong, impact if wrong, cost to test (cheap first among equals), staleness, and strength of existing evidence (weak first). This is an ordering rule only; never invent numbers.

## 4. Record
Per item:
- `title`: short label for the item
- `location`
- `claim`: what is asserted or assumed
- `counterexample`: a concrete input, state or sequence that would falsify it
- `evidence`: what you read (file:line, spec clause, test name) that supports the counterexample or the claim
- `verdict`: `holds` (evidence supports it), `broken` (evidence contradicts it), `untested` (no evidence either way)
- `severity`: blocker, major, minor or nit, by consequence if the claim is false
- `check`: for `untested`, the cheapest check the orchestrator could run

## Which verdicts become findings
- `broken`: a finding, with severity and evidence.
- `untested`: a finding, with severity by impact; evidence is what you searched for and did not find.
- `holds`: listed for completeness, without severity.

Report as a specialist report with sections Result, Evidence, Open questions.

## Rules
- No quota. A clean review, with every item `holds`, is valid.
- Findings without evidence are dropped; `untested` is a legitimate verdict, not a failure to conclude.
- Do not claim `broken` from plausibility alone.
- No business, market or opinion lenses; stay with what the artifact says and what the code or tests show.
- No active testing. Report open questions to the orchestrator.
