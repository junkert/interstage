# Detection Guide

Language-neutral steps for finding incomplete work. Use the project's own tooling; the table gives examples only.

| Ecosystem | Static checks | Type or build check |
|---|---|---|
| TypeScript | ESLint (`no-empty-function`, `no-empty`) | `tsc --noEmit` |
| Python | pylint or ruff, the `ast` module | mypy or pyright if configured |
| Go | `go vet`, staticcheck if configured | `go build ./...` |
| Rust | `cargo clippy` | `cargo check` |

## Tier 1: static

**Empty and stub bodies.** Text search misses arrow functions, `pass`, `...`, and a lone `/* TODO */`. Prefer a lint rule or a syntax-tree walk that reports functions whose body is empty, only `pass`/`...`, only a throw of a not-implemented error, or only a hardcoded literal return. Then search text for `TODO`, `FIXME`, `unimplemented`, `NotImplemented` as a second pass over the files the change touched.

**Reachability.** For each new exported symbol, find its callers with the language server's references or a symbol search. A symbol with no caller outside its tests is not wired. For routes, commands and handlers, confirm the registration line.

**Imports and types.** Run the type checker and build; read the full output, not the last line.

**Mock and fixture leakage.** Search production directories (not test directories) for imports of fixtures, mock libraries, `sample`, `dummy` and in-memory database URLs.

**Mock ratio in tests.** Count tests that replace the unit under test or the boundary the claim is about. Many mocks is not itself a defect; a mocked boundary that the claim says is integrated is.

## Tier 2: runtime

**Start it.** Launch the application or CLI with the project's start command and read the log. A crash, a missing-variable error or a silent exit is a finding. Stop what you started.

**Database and external services.** Do not trust that a connection variable is set. Run one real query or call through the project's own client against a local or test instance the project provides. If none exists, record the claim as unverified rather than mocking it.

**Health endpoint.** Request it and read the body; a 200 from a static handler proves little. Then request a real feature path and compare the response with the spec. If the bash hook blocks `curl` or `wget` (network gate), use the language's HTTP client or the project's own CLI, or report the need as an open question.

**Network reality.** To see whether a test touches the network or a real service, check the test's configuration (fixtures, recorded responses, container setup) and the dependency's logs. If you cannot tell, say so.

**Smoke run.** After the above, run the smallest end-to-end scenario the acceptance criteria describe, from a clean state, and record the observed output.

## Confidence by check type

| Confidence | Checks |
|---|---|
| High | Empty or stub bodies, unresolved imports, type or build errors, missing files, a failing test run |
| Medium | Environment value present (may not work), health endpoint responds (may be static) |
| Low | A report saying "passing", a dependency listed in a manifest (may be unused), a test name |

Raise a low-confidence signal to high by executing the real thing.

## Reporting discipline

Every finding cites `file:line` or the command and its real output. If a check could not run (no database, no credentials, no network), list it under "Claims that could not be verified" with what is missing. Do not substitute a guess.
