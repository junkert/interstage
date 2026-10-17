---
name: is-spec-gap-analysis
description: Compare documented requirements, API contracts (OpenAPI, Protobuf, GraphQL) or architecture specs with the implementation and report every mismatch with evidence. Use when checking that code matches its spec, or that a contract change is backward compatible.
license: MIT
---

# Spec Gap Analysis

Find where documentation and code disagree. Every gap cites the documented clause and the code location. Report counts as plain numbers ("8 of 12 operations found"); never a compliance percentage or score.

## Method

1. **List documented items**: requirements, endpoints, operations, messages, types, fields, errors, constraints, component boundaries, each with a stable ID (the spec's own, or `path#anchor`).
2. **Locate the implementation** for each (below). Read the code; do not infer from names.
3. **Compare** behavior, not just presence: parameters, types, required or optional, status codes, error bodies, defaults, limits.
4. **Look the other way**: code behavior no document mentions (routes, flags, fields, env vars).
5. **Record** each gap with evidence; count matches only.

## Gap types

| Type | Meaning | Evidence needed |
|---|---|---|
| Missing implementation | Documented, not in code | Clause quoted, and the searches that found nothing |
| Missing documentation | In code, not documented | `file:line` |
| Behavioral mismatch | Both exist, behavior differs | Clause vs `file:line` (and observed behavior if run) |
| Outdated documentation | Doc describes a removed or renamed interface | Clause vs current `file:line` |
| Incomplete documentation | Doc omits errors, limits or defaults the code enforces | `file:line` |
| Over-specified documentation | Doc dictates detail the code need not follow | Clause vs `file:line`; usually minor |

Severity: `blocker` for a documented requirement absent or contradicted where callers will hit it; `major` for a contract mismatch likely to break clients; `minor`/`nit` for documentation-only drift.

## Locating the implementation

- Search for the literal route, operation, RPC, resolver or message name; follow the registration (router table, decorator, service or schema binding) to the handler. Ignore tests, mocks and generated stubs.
- For an unnamed requirement, find the symbol its nouns map to and read the code path. If still not found, report "missing implementation" with the searches listed, marked [INFERENCE] when absence is uncertain.
- Run the behavior when the project can start locally; an observed response beats a reading.

## Format notes

- **OpenAPI**: per path and method check parameters (name, location, type, required), request body, each response status and schema, security. Spec says 201, code returns 200: mismatch.
- **Protobuf**: each RPC exists with the same streaming mode; message field numbers, types and `repeated`/`optional` cardinality match (field numbers matter on the wire).
- **GraphQL**: type and field nullability, argument types, a resolver or default for every schema field, resolver return types match.

## Breaking-change checklist (contract evolution)

Compare the old and new spec, then the implementation to the new one. Each is breaking for existing clients unless proven otherwise:

- Removing a field, parameter, operation, RPC or enum value.
- Narrowing a type or constraint (string to enum, wider integer to smaller, lowering a maximum, adding a pattern).
- Adding a required field or parameter to a request.
- Changing an enum: removing or renaming a value is breaking; adding a value breaks clients that switch exhaustively on responses.
- Changing a status code or error shape for an existing case.
- Changing a field's meaning, units, default or nullability; reusing a Protobuf field number.

Additive optional fields and new operations are compatible.

## Architecture specs

Check only what the spec states: component boundaries, allowed dependency directions (who may import whom) and named interfaces. Read import and dependency declarations; flag each forbidden edge with `file:line`. Do not grade design quality.

## Output

Your report carries the gap table; you cannot write files. Start your section with `## spec-gap <TODO-ID or scope>`. The orchestrator appends it to `$INTERSTAGE_STATE_DIR/missions/<id>/evidence/gaps.md` via `write_artifact kind=evidence name=gaps.md append=true`.

```
## Result
<counts, e.g. "N of M documented operations found; K behavioral mismatches; J undocumented routes">

## Gaps
| # | Type | Severity | Documented (file:line, quote) | Implementation (file:line) | Note |

## Evidence
- searches run and commands executed with their real output

## Open questions
1. <ambiguous clause, to the orchestrator>
```

Related: `skill://is-exhaustive-specification`, `skill://is-test-gap-analysis`.
