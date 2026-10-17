---
name: is-testing-integration
description: Write and review integration and API tests, find the project's test runner, and check contracts between consumers and providers. Use when testing component boundaries, databases, external services or HTTP endpoints.
license: MIT
---

# Integration and API testing

Integration tests prove that components work together across a real boundary. They are slower than unit tests, so each one earns its place by crossing a boundary a unit test cannot.

## Find the test runner

Never assume a command. Look, in order, at: `interstage.yml` `verify.command`, `package.json` scripts and its test dependency, `Makefile` targets, `pyproject.toml` or `pytest.ini`, `Cargo.toml`, `go.mod`, CI config. Read how the project separates integration tests from unit tests (directory, build tag, marker, file suffix, separate script) and reuse it. Run the narrowest selection first, then the whole suite. If no runner exists, report it as a finding with evidence of what you searched.

| Ecosystem | Typical indicator |
|---|---|
| Node | a test script and runner dependency in `package.json` |
| Python | `pytest` config in `pyproject.toml`, `tests/` layout |
| Go | `*_test.go` files, build tags |
| Rust | `tests/` directory under `Cargo.toml` |

## Boundary rules

- Use a real database or a container of the real engine. Do not substitute a different engine unless the project already does.
- Mock only third-party services you do not control, and only at the network edge. Keep their recorded responses honest to the provider's documented behavior.
- Each test creates its own data and removes it, or runs in a transaction that rolls back. No test depends on another's leftovers or on order.
- Assert on observable results across the boundary: stored rows, responses, emitted messages. Do not assert on internal calls.
- Test the error path at each boundary: timeout, refused connection, malformed response, constraint violation.
- Environment services (database, queue) are started by the project's own compose file or fixtures. Starting one may need approval for network or installs; report the need to the orchestrator.

## API checklist

- Each endpoint and method: success status and body.
- 401 for missing or invalid credentials, 403 for valid credentials without permission. They must not be confused.
- Response body validated against the OpenAPI or schema file, if the project has one.
- Input: null, empty string, empty array, missing required fields, wrong types, oversized payloads, special characters.
- Error responses: consistent shape, correct status code, no stack traces or internals.
- Versioning: old versions still behave as documented after a change.
- Rate limits and quotas: the limit response and its headers, if the API has them.
- Pagination, filtering and ordering at the edges.
- CORS headers, if browsers call the API.

## Contract checks

For services with a consumer and a provider:

1. List what each consumer actually uses: fields, status codes, headers.
2. Verify the provider still satisfies each of those, using the project's contract tool or the OpenAPI spec as the source of truth.
3. A removed or retyped field, or a tightened validation, is a breaking change. Report it with the consumer location as evidence (file:line).
4. Additive changes are not breaking unless a consumer rejects unknown fields.

## Findings

Severity: blocker for a contract break or data-loss path with no test, major for an untested boundary on a critical path, minor for gaps in edge cases. Each needs evidence. A clean result is valid. See `skill://is-test-pipeline` for ordering and the flaky-test policy, and `skill://is-test-strategy` for how much to invest.
