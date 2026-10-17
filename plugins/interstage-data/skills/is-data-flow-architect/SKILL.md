---
name: is-data-flow-architect
description: Use when you must document how data moves through a system (sources, transport, processing, storage, destinations) as specs with Mermaid diagrams. Read on demand by FIDO and other agents that map flows.
license: MIT
---

# Data flow architect

Document data flows from the code and config you can read. Write output to `$INTERSTAGE_STATE_DIR/missions/<id>/specs/` (for example `specs/<ID>-data-flow.md`), never the project root. Diagrams are Mermaid, so they are versioned and diffable. Report open questions to the orchestrator; never ask the user.

## Views

- Conceptual (business, PM): what data enters and leaves, why, key entities, user-visible outcome.
- Logical (developers, architects): services and responsibilities, transformations, API contracts, protocols, schemas.
- Physical (operations): infrastructure components, network zones, deployment, scaling and performance characteristics.

## Levels

- Level 0, context: external entities, trust boundaries, inputs and outputs.
- Level 1, containers: services, databases, caches, queues; interactions and technology per container.
- Level 2, components: components inside a container, transformations, internal queues and buffers.
- Level 3, sequences: critical paths with order, timing, error handling and recovery.

Draw the level the reader needs; do not draw all four by default.

## Per-flow components

- Source: origin (user, system, external API), format and schema, frequency and volume, authentication.
- Transport: protocol (HTTP, gRPC, WebSocket, AMQP, Kafka), security zones crossed, middleware, serialization.
- Processing: transformations, validation, enrichment, business logic, state changes.
- Storage: where persisted, schema and indexing, retention.
- Destinations: where it flows next, consumer type, delivery expectations.

## Discovery protocol

Discover before documenting. Everything below is read-only.

1. Static analysis: list API endpoints and their callers; map tables and collections to the services that read or write them (ORM models, migrations, SQL); find queue topics, producers and subscribers; read dependency manifests and deployment files.
2. Shadow flows: look for backups, ETL or batch jobs, analytics exports, webhooks, cron jobs and logging pipelines.
3. Compare what you found with existing documentation; list differences.

Observed facts need `file:line`. Do not invent what you cannot see. Any step that would need running services, tracing in a live environment or interviewing people becomes an open question for the orchestrator, listed with what would answer it.

### Handling unknown flows

1. Mark the gap in the document as `[TBD - investigation required]` and keep the flow in the diagram with an "unknown source" or "unknown destination" node.
2. Add it to the report's Open questions with the files or systems that were checked.
3. Undocumented flows are security and compliance risks; list them first.

## Document template

```markdown
# Data Flow: <system or feature>

## Summary
<what data moves, and why it matters>

## System context
<external entities, trust boundaries; Mermaid diagram>

## Sources
| Source | Type | Format | Frequency | Volume |

## Destinations
| Destination | Type | Format | Consumer |

## Flows
### <Flow name>
**Purpose**: ...
**Source** -> **Destination**: ...

#### Path
1. <step: component, protocol, file:line>

#### Transformation
| Stage | Input | Transformation | Output |

#### Error handling
| Condition | Handling | Retry |

#### Security
- Authentication / Authorization / Encryption (in transit, at rest)

## Storage
| Store | Type | Purpose | Schema location |

## Network zones
| Zone | Components | Controls |

## Open questions
1. ...
```

Fill "Volume", "Frequency" and "Retry" only from code, config or measured sources; otherwise write `unknown`.

## What not to document

- API keys, tokens, credentials, secrets, passwords or keys.
- Internal IP addresses or network details; use labels such as `[Internal Zone]`.
- Specific software versions (they enable vulnerability fingerprinting).
- Detailed error messages that expose internals.

Use placeholders: `Authorization: [JWT]`, `Service: [Auth Service]`.

## Common mistakes

- Jargon without context: also give a plain sentence ("the password is checked against the user database, then a token is issued").
- Inconsistent component names across diagrams: pick one name and use it everywhere.
- Happy path only: document failures, retries and edge cases.
- Static images: use Mermaid so diagrams update with the code.
- Missing rationale: record why a key choice was made when the code or a decision log states it; otherwise list it as an open question.
