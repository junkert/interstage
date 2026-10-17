---
name: is-structured-logging
description: Use when adding or reviewing application logging - field schema, levels, redaction, hot-path cost, sampling and per-language library choice. Applies to new log statements and to logging changes in a diff.
license: MIT
---

# Structured logging

Emit one JSON object per line to stdout. Context matters more than message content: a short constant message plus fields beats a long sentence with values interpolated into it.

## Field schema

| Field | Rule |
|---|---|
| `timestamp` | RFC 3339 / ISO 8601 in UTC with `Z` |
| `level` | one of the levels below |
| `service`, `environment`, `version` | set once at logger construction |
| `message` | constant text; variable data goes in fields |
| `trace_id`, `span_id` | injected by the tracing bridge, never hand-built (see `skill://is-tracing-correlation`) |
| `request_id` | from the inbound request or generated at the edge |
| `error_code`, `error_details`, `stack_trace` | on ERROR only; stack trace as one string field |
| `duration_ms` | for timed operations |
| `context` | object of domain identifiers (for example order id), not whole payloads |

## Levels

| Level | Use |
|---|---|
| DEBUG | diagnostic detail, off in production by default |
| INFO | normal operation, one line per significant event |
| WARN | unexpected but handled, may need attention |
| ERROR | a specific operation failed |
| FATAL | the process is terminating |

## Redaction rule

Never log secrets (passwords, tokens, API keys, authorization headers, card numbers) or raw request or response bodies. Log stable opaque identifiers (a user id, not an email, name or phone number). Redact in the logger configuration by key name (for example `password`, `token`, `authorization`, `secret`) so a new call site cannot bypass it. In review, flag any log call that serializes a whole object or header map.

## Hot path and volume

| Technique | When to use | Risk |
|---|---|---|
| Lazy arguments and level guard (pass format args, not pre-built strings; guard expensive DEBUG computation with a level check) | any call whose arguments cost something to build | none beyond readability |
| Bounded async buffer with a drop counter, drained on shutdown | high-throughput services where log writes block requests | drops under overload (expose the counter); lost lines if shutdown skips the drain |
| Sample DEBUG by trace-id hash | verbose DEBUG in production | none if the same trace is kept or dropped whole; random per-line sampling breaks traces |
| Never sample ERROR or FATAL | always | missing the evidence you need |

Do not add locks or per-call random seeding in a sampler; hash the trace id.

## Output and rotation

Write to stdout and let the platform rotate. Where the process must write files, ship a logrotate config; in containers use the runtime's log driver.

## Libraries by language

| Language | Library | Config | Correlation hook |
|---|---|---|---|
| Python | stdlib `logging` with a JSON formatter, or `structlog` | level, handlers, formatter | `opentelemetry-instrumentation-logging` adds trace and span ids to records |
| Java | Logback or Log4j2 with a JSON encoder | root level, appender, MDC keys | OpenTelemetry Java agent puts `trace_id`, `span_id` in MDC |
| Node.js | `pino` | `level`, `redact` paths | OpenTelemetry pino instrumentation adds `trace_id`, `span_id` |
| Go | stdlib `log/slog` with `NewJSONHandler` | `HandlerOptions.Level`, `ReplaceAttr` for redaction | read the span context from `ctx` and add attributes; use `InfoContext` |

Use the project's existing logger; do not introduce a second one.

## Review checklist

- Fields are keys, not interpolated text; message is constant.
- Level fits the table; failures are ERROR with `error_code` and cause.
- No secrets or raw bodies; redaction is configured centrally.
- No expensive argument built on a disabled level.
- Severity of findings: leaked secret is `blocker`; ERROR without context `major`; style `minor`.
