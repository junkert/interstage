---
name: is-test-pipeline
description: Order and run the project's test types (smoke, unit, integration, end to end, performance, security) with prerequisites, fail-fast, change-impact selection and a flaky-test policy. Use when running verification for an item or release, or designing a CI test sequence.
license: MIT
---

# Test pipeline

One order for running tests, the rules that gate each step, and how to select tests for a change. Commands come from the project: `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI config, or `interstage.yml` `verify.command`. Never invent one; if a layer has no command, report "not configured".

## Order

1. **Smoke**, first and short.
2. **Unit and integration**, in parallel when they use different resources, otherwise unit first.
3. **End to end**, on the build that passed step 2.
4. **Performance, security-type and chaos checks** that need a deployed or stable environment.

Reasons, in the places where the sources disagreed:

- Smoke runs first because it is the cheapest check that the build and environment are usable. Unit tests are not its prerequisite: smoke checks the running system, unit tests check code in isolation.
- Security checks that need a deployed application run after end to end, in the performance stage, since both need the same stable target and concurrent scanning perturbs end to end results. Static security review needs no deployment (`skill://is-security-review`).

## Prerequisites

| Check | Needs |
|---|---|
| Security checks against a running app | a deployed app that passed smoke |
| Performance and load | a stable, production-like environment; end to end green |
| Chaos | monitoring in place and a performance baseline; opt-in only |
| End to end | smoke, unit and integration green |
| Integration | smoke green; its services and data available |

## Fail fast

When a prerequisite fails, stop the stages that depend on it and report which step failed and which did not run. Independent stages may finish, so one run reports everything knowable.

## Smoke

- 5 to 10 scenarios, about 2 minutes or less.
- Cover: the application starts and responds, the database connects, authentication works, one core operation works.
- Idempotent, no side effects, no leftover data.
- Clear pass or fail. A flaky smoke test is a suite defect; fix it.

Two scopes, one suite:

- **Item smoke**: during verification of one item, start the application or the smallest runnable slice locally in the verification worktree and run the smoke scenarios against it.
- **Release smoke**: run against the deployed target; this is the "after every deploy" cadence row in `skill://is-test-strategy`.

Item smoke is the "smoke first" step for an item; release smoke, for a release.

## Verification policy

- `lsp` diagnostics count toward a clean verdict only when the tool and a language server for the changed files are available. Otherwise record a `minor` finding `lsp unverified` and continue, unless Q01 or the assignment requires diagnostics (then `major`).
- A `done-when` condition that cannot be verified is `major`.
- Flaky tests (fail then pass on rerun with no code change) are findings, never retried to green, quarantined, skipped or deleted to pass. Major if they can mask a real failure, else minor. Evidence: test name and both outputs.

## Change-impact selection

Run the full suite when a change touches shared infrastructure, configuration, dependencies or build tooling. Otherwise select by what changed, then run the whole suite before release.

| Changed | Select |
|---|---|
| A module's implementation | its unit tests, tests of direct callers |
| A public API or schema | contract and integration tests, every consumer |
| Database migration | integration tests that touch the tables, then full integration |
| UI component | its tests plus end to end paths that render it |
| Lockfile or dependency version | full suite |

Use the project's own mechanism if it has one (path filters, test-affected tooling, build graph); otherwise use `git diff --name-only` and the import graph.

## Dependency types

Record which constrain a test before ordering it: **execution** (B needs A to pass), **environment** (local, CI, staging, production-like), **data** (fixtures, seeds, accounts), **resource** (CPU, memory, ports, shared service), **temporal** (rate limits, windows).

Tests that share mutable state or a resource run sequentially. A dependency cycle is a defect to report.

## Report

Pass or fail per stage, with the command run and a real output excerpt; say which stages did not run and why. Never state a build is safe to deploy; shipping is a gate decision. Related: `skill://is-test-strategy`, `skill://is-testing-integration`, `skill://is-testing-e2e`.
