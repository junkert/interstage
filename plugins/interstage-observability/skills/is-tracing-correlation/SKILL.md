---
name: is-tracing-correlation
description: Use when connecting logs to distributed traces - W3C trace context propagation across HTTP, queues and async boundaries, OpenTelemetry instrumentation by language, and injecting trace_id and span_id into logs.
license: MIT
---

# Tracing and log correlation

Correlate through the standard: OpenTelemetry creates spans and a logging bridge copies the active `trace_id` and `span_id` into every log line. Do not hand-roll spans as log records or build your own id scheme.

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
| Python | `opentelemetry-instrument python app.py` (package `opentelemetry-distro`) | `opentelemetry-instrumentation-logging` adds trace and span ids to log records |
| Java | `-javaagent:opentelemetry-javaagent.jar` | agent places `trace_id`, `span_id` in MDC; reference them in the layout |
| Node.js | `node --require @opentelemetry/auto-instrumentations-node/register app.js` | pino and winston instrumentations add `trace_id`, `span_id` |
| Go | no agent; wrap handlers and clients with `otelhttp` and similar libraries | read `trace.SpanContextFromContext(ctx)` and add its ids to log attributes |

## Manual span (Python)

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer(__name__)

def process_payment(order_id, amount):
    with tracer.start_as_current_span("process_payment") as span:
        span.set_attribute("order_id", order_id)
        try:
            return charge(order_id, amount)
        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            raise
```

Logs written inside the `with` block carry this span's ids through the bridge.

## Sampling

Use a parent-based sampler so every service honors the upstream decision: `OTEL_TRACES_SAMPLER=parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=<ratio between 0 and 1>`. The ratio is a project decision; do not sample ERROR logs themselves (see `skill://is-structured-logging`).

## Log field names

When reading logs from mixed sources, treat these as aliases of one field: `trace_id`, `trace.id`, `traceId`, `X-Trace-Id`. Normalize to `trace_id` and `span_id` in your own output.

## Checklist

- Every outbound call and consumer injects or extracts context.
- Logs contain `trace_id` and `span_id` while a span is active; check one real line.
- Context survives thread pools and async tasks.
- Report breaks with `file:line` of the boundary that does not propagate.
