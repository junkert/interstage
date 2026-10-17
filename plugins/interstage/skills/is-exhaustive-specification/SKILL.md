---
name: is-exhaustive-specification
description: Write specifications precise enough for autonomous builders, chosen by project type and tiered by need. Use when FIDO or a planner must produce a SPEC.md or a specs/ set that leaves nothing to guess.
license: MIT
---

# Exhaustive Specification

A spec is the contract a builder implements without asking questions. Choose the specs the project needs, write each one completely, and make acceptance testable.

## Where specs live

Under `$INTERSTAGE_STATE_DIR/missions/<id>/`. Standard lane: one `SPEC.md` with a section per chosen spec. Full lane: `specs/INDEX.md` plus `specs/<ID>-<slug>.md`, for example `specs/A02-auth.md`. TODO items cite them as `spec: specs/A02-auth.md#tokens`.

## Spec IDs

IDs are tier-prefixed: `S01`, `U01`, `A01`, `D01`, `B01`, `X01`, `O01`, `Q01`, `I01`, `M01`, `AI01`, `SRE01`, `L01`, `DE01`, `RT01`, `AN01`, `SEC01`. The one-line catalog of every tier except Foundation and Quality is in `references/catalog.md`. Read it when choosing the set.

## Always-on tiers

Small jobs may write a short section containing `N/A, <reason>`; never leave one out silently.

**Foundation**
- `S01` System Overview: purpose, scope and non-goals, architecture, success criteria.
- `S02` Domain Model: entities, value objects, relationships, invariants.
- `S03` Glossary: one term per concept, used identically in every spec.

**Quality**
- `Q01` Test Strategy: project stage (POC, MVP or production) and any threshold overrides, test types, tooling.
- `Q02` Test Cases: concrete scenarios with inputs and expected results.
- `Q03` Acceptance Criteria: becomes each TODO item's `done-when`; every criterion observable and pass/fail.
- `Q04` Quality Gates: the gate definitions a verifier applies.

## Selecting the set (FIDO)

The plan gate approves the set. List every excluded tier with a one-line reason; never drop one silently.

| Project signal | Add |
|---|---|
| User-facing UI | U01-U06 (U05 if a WCAG target is stated) |
| HTTP/RPC service or library API | A01, A02 (if auth), A03, A04; A05 if public or rate-limited; A06 if webhooks |
| Persistent data | D01, D03, D04; D02 if performance-sensitive; D05 if PII or retention rules |
| Rules, lifecycles, money, calculations | B01-B04 as applicable; B05 if it notifies users |
| Any service with users or secrets | X01, X04, X05 (X02, X03: observability pack) |
| Deploy in scope | O01; O02 if IaC; O03 if latency or throughput targets; O04, O05 only at production stage |
| External services or events | I01; I02 public API; I03 flags; I04 inbound webhooks; I05 event-driven |
| Mobile app | M01-M05 (M04 only if offline, M05 only if push) |
| Trains or serves models | AI01-AI05 (AI02, AI04 only if training is in scope) |
| Production, operated service | SRE01, SRE02; SRE04 only with the chaos opt-in |
| Multi-locale requirement | L01-L04 |
| ETL or pipeline | DE01-DE04; DE05 if there is a cache |
| Realtime or collaborative | RT01-RT04 |
| Product-analytics requirement | AN01 |
| Auth, PII, money or exposed attack surface | SEC01, SEC02; SEC03 only if a compliance regime is named; SEC04 if an audit requirement is stated |

## Writing standard by kind

Everywhere: complete and unambiguous, nothing left to guess. State every decision; never write "as discussed" or "standard practice". Define units for every number.

- **UI specs (the only place the blind-person standard applies):** describe every element so someone who cannot see it could picture it: layout, dimensions, colors, fonts, motion timing and easing, responsive breakpoints, and the empty, loading, error and success states.
- **API:** request and response schemas with an example each, every error code with cause and resolution, auth per endpoint, limits, timeouts, retry and idempotency rules.
- **Data:** full schema with constraints, index strategy and rationale, query patterns, migration path, retention.
- **Logic:** step-by-step algorithms, every branch of each decision, input validation at each step, state machines with all transitions and guards, error handling per step.
- **Operations and cross-cutting:** exact values, thresholds and procedures, with the failure behavior of each.
- **Mobile, AI, realtime, data pipelines:** the same rule: enumerate states, failure modes and limits explicitly.

## Structure template

Each spec, in order: Overview; Dependencies; Interface; Behavior (happy and error paths); Data; States; Errors; Testing (cases that validate it); Security; Performance. Write `N/A, <reason>` for a section that does not apply.

## Quality gates

A spec is complete when:
- [ ] Every assumption is stated; each testable assumption has a validation test in Q02.
- [ ] Every error path and edge case is enumerated.
- [ ] Every data structure has an example, and every number has a unit.
- [ ] Terms match the glossary; there are no contradictions across specs.
- [ ] Each requirement traces to a design element and to a test (requirement, design, test cross-references).
- [ ] No mocked or guessed behavior: describe what the real dependency returns.
- [ ] UI specs only: a person who cannot see the screen could picture it from the text.

Report items you could not decide as open questions to the orchestrator; do not invent answers.

## Common pitfalls

| Symptom | Remedy |
|---|---|
| Builders make inconsistent choices | Add detail on edge cases and error handling |
| Many unstated assumptions | List each one, then add a validation test for the testable ones |
| Different words for one concept | Fix the glossary and re-read every spec |
| Fails under unusual valid input | Attack the spec as a red team and add the cases found |
| Spec contradicts domain reality | Check against real references and the existing code |

## INDEX.md (full lane)

Columns: `ID`, `file`, `tier`, `status` (pending, writing, complete, N/A), `depends`, `N/A reason`. No dates or counts.

## Context recovery

1. Read `specs/INDEX.md` (or the headings of `SPEC.md`) to see what exists and what is pending.
2. Read the glossary and the in-progress spec.
3. Continue with the next pending item, keeping IDs and terms unchanged.
