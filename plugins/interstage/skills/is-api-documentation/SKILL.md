---
name: is-api-documentation
description: Use when writing or checking API documentation (REST, gRPC, GraphQL). Derives docs from existing specs and annotations, cites file:line for every behavior, and reports spec-versus-implementation drift as findings.
license: MIT
---

# API documentation

## Rules

- Derive docs from what exists: `openapi.yaml`, `.proto` files, `schema.graphql`, and code annotations. Do not describe behavior no source shows.
- Cite `file:line` for every documented behavior (route, field, status code, auth rule, limit).
- Mark unknowns as `Unknown: <what is missing>` instead of inventing them. Report open questions to the orchestrator.
- Take examples from the project's tests or fixtures when they exist and name the test; otherwise mark the example unverified. Never call a live service.
- Write only to paths a TODO item names. Otherwise put drafts in the report.

## Checklist

Per endpoint, RPC or operation, document:

- Purpose, method and path (or service and method, or query or mutation name).
- Request: parameters, body schema, required versus optional, types, constraints.
- Response: success shape and every error code or message the code can return.
- Authentication and authorization needed, rate limits and quotas where the code enforces them.
- Versioning and deprecation status, and what changed between versions.

Also cover for the whole API: auth setup, error format, pagination and idempotency conventions.

## Consistency check

Compare the spec with the implementation and report each mismatch as a finding:

- Title, severity, spec location (file:line), implementation location (file:line), and what differs.
- Severity: auth mismatches, removed or undocumented behavior, and type or required-flag mismatches are major; wording differences are minor; cosmetic issues are nits. Use blocker only when callers would break or be exposed.
- Typical drift: routes or fields in code but not the spec (or reverse), undocumented status codes, auth in code absent from the spec.
- No evidence, no finding. A clean result is valid.

## What readers need

- Every parameter and field explained once, with constraints.
- Error meanings with what the caller should do.
- Breaking changes called out with migration steps.
- A first call, only if a test or fixture cited in the repo shows one.

## Reference specs

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Protocol Buffers language guide](https://protobuf.dev/programming-guides/proto3/)
- [GraphQL Specification](https://spec.graphql.org)
- [gRPC documentation](https://grpc.io/docs/)
- [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines)
