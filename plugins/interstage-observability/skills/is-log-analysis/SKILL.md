---
name: is-log-analysis
description: Use when investigating log files during debugging or a post-mortem - identifying the format, parsing it, handling multi-line events and time zones, and reporting findings with file:line evidence. Commands work on macOS and Linux.
license: MIT
---

# Log analysis

Identify the format first, parse it with a tool that matches, and report only what the lines show. Use ERE (`grep -E`); `grep -P` is not on macOS.

## Formats

| Format | Parse with |
|---|---|
| JSON lines | `jq` (`jq -R 'fromjson?'` skips non-JSON lines) |
| key=value | `grep -oE` with the pattern in Recipes |
| Apache/Nginx combined | regex below, or `awk` on fixed columns |
| Multi-line (stack traces) | group by event-start pattern |
| Plain text | `grep -E` and `awk` |

Apache combined (ERE):

```
^([^ ]+) [^ ]+ ([^ ]+) \[([^]]+)\] "([^ ]+) ([^ ]+) ([^"]+)" ([0-9]{3}) ([0-9]+|-) "([^"]*)" "([^"]*)"
```

Groups: client, user, time, method, path, protocol, status, bytes, referer, agent.

## Multi-line events

A line that does not start with the event-start pattern (usually the timestamp) belongs to the previous event. Join before counting, otherwise each stack frame counts as an event. Write digits out; `{n}` intervals are not portable in awk (BSD awk, mawk):

```
awk '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {if (e) print e; e=$0; next} {e=e " | " $0} END {if (e) print e}' app.log
```

## Time

- Confirm the zone of every source; a timestamp without an offset is local to the host that wrote it.
- Normalize to UTC before comparing across files or hosts.
- Clock skew between hosts reorders events; compare with trace or request ids, not time alone.

## Recipes

```
jq -r '.timestamp, .level, .message' app.log
jq -r 'select(.level == "ERROR") | .message' app.log
jq -s 'group_by(.service)[] | {service: .[0].service, count: length}' app.log
grep -E 'ERROR' app.log | sort | uniq -c | sort -rn | head -20
awk '{c[$9]++} END {for (s in c) print s, c[s]}' access.log
grep -oE '[A-Za-z_]+=("[^"]*"|[^ ]+)' app.log
grep -nE 'request_id=abc123' *.log
```

Strip volatile tokens (ids, numbers) with `sed -E 's/[0-9]+/N/g'` before `sort | uniq -c` so equal errors group together. Use `jq -s` only on files that fit in memory.

## Method

1. Fix the question and the time window.
2. Identify the format and time zone; parse a small sample first.
3. Find first occurrence, then frequency, then what changed just before it.
4. Follow one request through `request_id` or `trace_id` across files.
5. Prefer the earliest error in a chain; later ones are often consequences.

## Report

```
## Result
<one paragraph: what the logs show and what they do not>

## Evidence
- <file>:<line>  <quoted line or the command and its real output>

## Open questions
1. <what is missing: another log, a time window, a zone>
```

Each finding cites `file:line` and the command that produced it. Counts come from commands you ran, never targets. Mark inferences [INFERENCE]. Severity: `blocker` data loss or wrong behavior, `major` likely rework, `minor`, `nit`.
