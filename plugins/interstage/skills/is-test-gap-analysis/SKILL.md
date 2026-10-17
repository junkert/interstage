---
name: is-test-gap-analysis
description: Find where requirements, behaviors and risks are not protected by effective tests, and rank the gaps. Use when judging test adequacy for a change or mission, or when planning which tests to add.
license: MIT
---

# Test Gap Analysis

Compare what must be tested with what the tests actually check. Coverage numbers inform this analysis; they never drive it. A line that ran is not a requirement that was verified.

## Method

1. **List testable items**: requirements (by ID), acceptance criteria and `done-when` conditions, public interfaces, error paths, and implied behavior the spec does not state (flag these separately).
2. **Inventory tests** with the project's own test command and layout: unit, integration, end-to-end, manual checklists.
3. **Map items to tests** by, in order: explicit requirement ID in the test name, description or tag; the symbol or endpoint the test exercises; a name or text search for the requirement's nouns. Read each candidate test and decide whether it asserts the behavior. A match by name alone is only a candidate.
4. **Judge effectiveness** of each mapped test (assertions can fail, real boundary exercised, negative cases, not flaky; see `skill://is-verify-claims` for "passes for the wrong reason").
5. **Classify** each gap, rank, and report.

## Gap taxonomy

| Gap | Meaning |
|---|---|
| Missing | Item has no test |
| Partial | Tested for success only, or one input class, or without error and boundary cases |
| Type | Wrong or absent level: needs integration or end-to-end, has only unit tests with mocks (levels: `skill://is-test-strategy`) |
| Effectiveness | Test exists but cannot fail, asserts trivia, or is flaky. Record flaky tests as findings; never retry or quarantine them to look green |
| Maintenance | Test is stale against current behavior, disabled, skipped, or chronically failing |
| Risk | High-risk area (money, auth, data loss, concurrency, external boundaries) with thin tests while low-risk code is heavily tested |

## Coverage dimensions

Use all six; one dimension alone misleads.

1. **Code**: statements, branches executed (use the project's coverage tool if configured; report its raw output).
2. **Requirement**: items with at least one effective test.
3. **Risk**: identified risks that have a test that would catch them.
4. **Scenario**: user journeys and workflows exercised.
5. **Data**: boundary, empty, invalid, large and unusual inputs.
6. **Configuration**: supported environments, flags and options exercised.

Report requirement coverage as counts ("11 of 14 requirements have an effective test"), not a percentage target. High code coverage with uncovered requirements is a gap; low code coverage on code no requirement needs is not one.

## Prioritizing

Order gaps by, most important first: (1) business or user impact if the behavior breaks, (2) technical risk (complexity, change frequency, concurrency, external systems), (3) how many users or callers are exposed, (4) a named regulatory or contractual requirement, which raises the gap's rank. Then cheaper before costlier within the same rank. This ordering is qualitative; do not invent numeric scores.

| Condition | Severity |
|---|---|
| Acceptance criterion or high-risk behavior has no effective test | blocker |
| Critical path covered only partially, wrong test level, or an ineffective test on it | major |
| Secondary behavior untested; stale or flaky test off the critical path | minor |
| Naming, duplication, tidiness | nit |

A review is clean at zero blockers and zero majors. No quotas.

## Recommending tests

For each blocker or major gap, state the test to add: behavior under test, level, key inputs including the negative case, and the expected result. Do not write the tests unless assigned. Where an exact output must be asserted, see `skill://is-testing-expected-results`.

## Output

Gaps go in `$INTERSTAGE_STATE_DIR/missions/<id>/evidence/gaps.md`. You cannot write it yourself: include the complete content in your report and the orchestrator records it.

```
## Result
<counts of items, mapped, gaps by type>

## Gaps
| # | Severity | Type | Item (ID, spec file:line) | Existing tests (file:line) | Why it is a gap | Test to add |

## Evidence
- commands run with real output (test list, coverage tool output); test file:line read

## Open questions
1. <ambiguous requirement, implicit behavior needing a decision>
```
