---
name: is-tracing-correlation
description: Use when connecting logs to distributed traces - W3C trace context propagation across HTTP, queues and async boundaries, OpenTelemetry instrumentation by language, and injecting trace_id and span_id into logs.
license: MIT
---

# Tracing and log correlation

Correlate through the standard: OpenTelemetry creates spans and a logging bridge copies the active trace and span ids into every log line. Field names differ by library (table below); map them to `trace_id` and `span_id` in the output. Do not hand-roll spans as log records or build your own id scheme.

## W3C `traceparent`

```
traceparent: 00-<trace-id>-<parent-span-id>-<trace-flags>
```

Four dash-separated lowercase hex fields: version `00`, trace id (32 hex), parent span id (16 hex), flags (2 hex; bit `01` = sampled). All-zero trace or span ids are invalid. `tracestate` carries optional vendor data; forward it unchanged.

## Propagation

| Boundary | Carrier | Rule |
|---|---|---|
| HTTP call | `traceparent` (and `tracestate`) request headers | client injects, server extracts and starts a child span |
| Queue message | message headers or attributes with the same names | producer injects at publish, consumer extracts before processing |
| Async boundary (thread, task, callback) | in-process context object | capture the context where work is scheduled and restore it where it runs |
| Batch or fan-in | span links | link to each source context instead of choosing one parent |

Check each boundary: the trace breaks where nothing injects or extracts.

## Instrumentation by language

| Language | Auto-instrumentation entry point | Log correlation |
|---|---|---|
| Python | `opentelemetry-instrument python app.py` (package `opentelemetry-distro`) | `opentelemetry-instrumentation-logging` sets `otelTraceID`, `otelSpanID` on records, not `trace_id`; use them in the format (`set_logging_format=True`) or copy them in the JSON formatter |
| Java | `-javaagent:opentelemetry-javaagent.jar` | agent places `trace_id`, `span_id` in MDC; reference them in the layout |
| Node.js | `node --require @opentelemetry/auto-instrumentations-node/register app.js` | pino and winston instrumentations add `trace_id`, `span_id` |
| Go | no agent; wrap handlers and clients with `otelhttp` and similar libraries | read `trace.SpanContextFromContext(ctx)` and add its ids to log attributes |

## Manual span (Python)

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

def process_payment(order_id, amount):
    with tracer.start_as_current_span("process_payment") as span:
        span.set_attribute("order_id", order_id)
        return charge(order_id, amount)
```

`start_as_current_span` already records an escaping exception and sets ERROR status, so no try/except. Logs inside the `with` block carry this span's ids.

## Sampling

Use a parent-based sampler so every service honors the upstream decision: `OTEL_TRACES_SAMPLER=parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=<ratio 0 to 1>`. The ratio is a project decision; never sample ERROR logs (see `skill://is-structured-logging`).

## Log field names

Treat `trace_id`, `trace.id`, `traceId`, `X-Trace-Id`, `otelTraceID` as one field when reading mixed logs; output `trace_id` and `span_id`.

## Checklist

- Every outbound call and consumer injects or extracts context.
- Logs carry trace and span ids while a span is active; check one line.
- Context survives thread pools and async tasks.
- Report breaks with `file:line` of the boundary that does not propagate.
