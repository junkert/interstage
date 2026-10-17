---
name: is-test-pipeline
description: Order and run the project's test types (smoke, unit, integration, end to end, performance, security) with prerequisites, fail-fast, change-impact selection and a flaky-test policy. Use when running verification for an item or release, or designing a CI test sequence.
license: MIT
---

# Test pipeline

One order for running tests, the rules that gate each step, and how to select tests for a change. Commands always come from the project: `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI config, or `interstage.yml` `verify.command`. Never invent a command. If a layer has no command, report "not configured" instead of skipping silently.

## Order

1. **Smoke**, first and short.
2. **Unit and integration**, in parallel when they use different resources, otherwise unit first.
3. **End to end**, on the build that passed step 2.
4. **Performance, security-type and chaos checks** that need a deployed or stable environment.

Reasons, in the places where the sources disagreed:

- Smoke runs before everything because it is the cheapest check that the build and environment are usable. Unit tests are not a prerequisite for smoke: smoke checks the running system, unit tests check code in isolation.
- Security checks that need a deployed application run after end to end, in the same stage as performance, because they need the same stable deployed target. Static security review needs no deployment and can run any time (`skill://is-security-review`).
- Security does not run in parallel with end to end on one environment: concurrent scanning perturbs both results.

## Prerequisites

| Check | Needs |
|---|---|
| Security checks against a running app | a deployed app that passed smoke |
| Performance and load | a stable, production-like environment; end to end green |
| Chaos | monitoring in place and a performance baseline; opt-in only |
| End to end | smoke, unit and integration green |
| Integration | smoke green; its services and data available |

## Fail fast

When a prerequisite fails, stop the stages that depend on it and report which step failed and which were not run. Do not run expensive stages on a broken base. Independent stages that do not depend on the failure may finish, so one run reports everything that can be known.

## Smoke

- 5 to 10 scenarios, about 2 minutes or less.
- Cover: the application starts and responds, the database connects, authentication works, one core operation works.
- Idempotent, no side effects, no leftover data.
- Clear pass or fail. A flaky smoke test is a defect in the smoke suite; fix it.

## Change-impact selection

Run the full suite when a change touches shared infrastructure, configuration, dependencies or build tooling. Otherwise select by what changed, then run the whole suite before release.

| Changed | Select |
|---|---|
| A module's implementation | its unit tests, tests of direct callers |
| A public API or schema | contract and integration tests, every consumer |
| Database migration | integration tests that touch the tables, then full integration |
| UI component | its tests plus end to end paths that render it |
| Lockfile or dependency version | full suite |

Use the project's own mechanism if it has one (path filters, test-affected tooling, a build graph). Otherwise derive the list from `git diff --name-only` and the import graph.

## Dependency types

Record which of these constrain a test before ordering it:

1. **Execution**: test B needs test A to pass first.
2. **Environment**: needs a specific environment (local, CI, staging, production-like).
3. **Data**: needs fixtures, seeds or accounts.
4. **Resource**: competes for CPU, memory, ports or a shared service, so it cannot run in parallel with others.
5. **Temporal**: has timing constraints such as a rate limit or a window.

Two tests that share mutable state or a resource run sequentially. A cycle in the dependencies is a defect to report.

## Flaky tests

A test that fails then passes on rerun with no code change is flaky. Record it as a finding (severity major if it can mask a real failure, otherwise minor) with evidence: the test name and the failing and passing outputs. Never auto-retry to reach green, never quarantine, skip or delete it to pass the gate. A retry done once to establish flakiness is evidence, not a fix.

## Report

Reports are pass or fail per stage with the command run and its real output excerpt. State which stages did not run and why. Do not state that a build is safe to deploy; shipping is a gate decision outside this skill. Related: `skill://is-test-strategy`, `skill://is-testing-integration`, `skill://is-testing-e2e`.
