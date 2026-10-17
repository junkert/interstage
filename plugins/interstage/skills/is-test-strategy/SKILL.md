---
name: is-test-strategy
description: Choose which test types a project needs for its stage (POC, MVP, production), map quality attributes to test types, set cadence and gates, and write a test plan. Use when planning tests for a SPEC, a mission or a new component.
license: MIT
---

# Test strategy

Decide how much testing a project needs, which kinds, and when they run. Output is a short plan, not a report of results.

## Inputs

1. The project stage. It is chosen in the discovery interview and recorded in the SPEC Quality spec (Q01). Read Q01 first; if the stage is missing, report it as an open question to the orchestrator and plan for MVP, labelled [INFERENCE].
2. The project's existing tests and tooling. Find the test command in `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI config, or `interstage.yml` `verify.command`. Never invent a command or a script name.
3. The risk areas: money, auth, personal data, data loss, public exposure.

Every number below is a default. A threshold written in Q01 overrides it.

## Stage by test type

| Test type | POC | MVP | Production |
|---|---|---|---|
| Unit | none | critical business logic, 60 to 70 percent coverage on critical paths | all business logic, 80 to 90 percent coverage |
| Integration | none | key integrations: database, auth, payment, critical endpoints | every external integration, data consistency, error recovery |
| End to end | manual check of the idea | manual happy path of core workflows; automate payment or auth if present | critical journeys automated, browser and device matrix |
| Security | none | dependency audit, auth and input validation on public endpoints | regular scanning, authorization tests, compliance checks that apply |
| Performance | none | only if load is a known risk | load test at 2 to 3 times expected traffic, regression detection |
| Accessibility | none | optional, public-facing only | WCAG AA for public sites |
| Smoke | none | after each deploy | after each deploy and in production |

POC: nothing automated is required and manual checks are enough. The only goal is to learn whether the approach works. Record that tests were deliberately skipped so nobody mistakes it for coverage.

Project size and risk adjust the table: a hobby MVP lowers unit depth, a paid or regulated product moves rows up one stage.

## Quality attribute to test type

| Attribute | Test type | Where to look |
|---|---|---|
| Correctness | unit, integration | `skill://is-testing-integration` |
| User workflows | end to end | `skill://is-testing-e2e` |
| Interface contracts | API and contract tests | `skill://is-testing-integration` |
| Regression safety | the full existing suite, selected by change impact | `skill://is-test-pipeline` |
| Performance, capacity | load and stress tests | `skill://is-performance-profiling` (pack skill, if installed) |
| Security | static review, dependency audit, authorization tests | `skill://is-security-review` |
| Accessibility, UI quality | static checklist plus the project's own tool if present | `skill://is-web-review` (pack skill, if installed) |
| Compatibility | browser and device matrix | `skill://is-testing-e2e` |
| Resilience | chaos tests, only when opted in and monitoring exists | `skill://is-test-pipeline` prerequisites |

Usability testing needs human participants; it is out of scope.

## Cadence

| Trigger | Runs |
|---|---|
| Every commit | unit tests |
| Every pull request | integration tests, plus the commit-level set |
| Every release | system tests: end to end, performance, security checks, compatibility |
| After every deploy | smoke against the deployed target (the release-level smoke in `skill://is-test-pipeline`) |

Run order inside a cadence step is in `skill://is-test-pipeline`.

## Plan skeleton

Write the plan with these headings and nothing else.

- **Objectives**: what quality claim the tests must support, traced to SPEC requirements.
- **Scope**: what is tested and what is deliberately not, with the reason.
- **Approach**: one row per test type from the stage table, the tool the project already uses, the command (from the project's config), and the threshold with its source (default or Q01).
- **Risks**: untested areas, environments that do not exist yet, flaky or slow suites, each with evidence.
- **Gates**: pass conditions per cadence step. Gates are pass or fail; counts and coverage figures are reported as measured, never as targets for findings.

## Rules

- Do not include schedules, headcounts, maturity scores or exported tickets.
- Do not report numbers you did not measure. Coverage comes from the project's coverage tool output.
- Findings about a missing or inadequate test layer use blocker, major, minor, nit, each with evidence (file:line, command output or a quoted spec clause). No quota.
- Return the plan in your report; the orchestrator records it under `$INTERSTAGE_STATE_DIR/missions/<id>/`, or the SPEC owner writes it into Q01. Write a file yourself only at a path a TODO item names.
