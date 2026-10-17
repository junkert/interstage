---
name: is-testing-e2e
description: Write and run end-to-end tests for critical user journeys and check browser and device compatibility. Use when verifying a user-facing flow through the real UI.
license: MIT
---

# End-to-end and compatibility testing

End-to-end tests are the slowest and most realistic layer. Keep them few and valuable.

## Scope

- Critical paths only: sign-up or login, the core feature, anything involving money or data loss. Everything else belongs in unit or integration tests (`skill://is-testing-integration`).
- Assert on what a user sees or can do, not on implementation details.
- Run headless in CI.
- Each test creates its data and removes it, and does not rely on another test's state. Use test accounts, never real user data.

## Tooling

Use the project's configured e2e runner and its command (`package.json` scripts, `Makefile`, CI config, `interstage.yml` `verify.command`). Do not install a runner without approval.

For exploratory checks, reproducing a UI failure or collecting a screenshot where the project has no e2e setup, use OMP's built-in browser tool. It is the default for browser work in this framework.

## Compatibility

- Define the matrix from the project's stated support (SPEC, `browserslist`, docs), not a generic list.
- Run the matrix through the runner's own projects or configuration feature, so the same tests run for each browser, viewport or device profile.
- Check at least: smallest and largest supported viewport, touch versus pointer input, and the supported browser engines.
- Use feature detection, not browser detection. A browser-name check in code is a finding when it gates behavior a feature check could decide.
- Emulated devices and throttled networks are approximations; say so in the report.

## Failures

Reproduce a failure once and capture the evidence: the failing step, screenshot or trace, and console or network output. A test that fails and then passes with no change is flaky; record it as a finding and never mask it with automatic retries (`skill://is-test-pipeline`). Ordering and prerequisites are in that skill; end to end runs after smoke, unit and integration pass.

## Findings

Blocker: a critical path that fails. Major: a supported browser or viewport where a critical path fails, or a critical path with no test. Minor and nit for the rest. Every finding carries evidence; a clean result is valid.
