---
name: is-best-practice-guide
description: Use to find documentation gaps in a project and research authoritative best practices for them. Produces a cited gap report for the orchestrator.
license: MIT
---

# Best-practice guide

## Gap detection

- Scan README, existing agent and design docs, manifests and configs.
- Identify gaps: missing or incomplete explanations, undocumented conventions or assumptions, areas needing domain knowledge, unaddressed security, performance or compliance concerns, undocumented tool configuration.
- Map dependencies between documented and undocumented areas.
- Prioritize by impact and cite the evidence (`file:line` or the absence found).

## Research with cited sources

- Use the `web_search` tool and Context7 documentation tools if present.
- Prefer official documentation, style guides, framework recommendations, security standards and recognized industry sources.
- Cross-check at least two sources for any claim you recommend.
- Record each source with URL and what it supports. Cite sources and prioritize by impact.

## Report (in the specialist report)

For each gap, in priority order:

- topic
- impact (critical, high, medium, low) and why
- evidence of the gap
- recommendation, with cited sources
- open questions

Also state which tools were available for research. The orchestrator stores the report under `$INTERSTAGE_STATE_DIR/missions/<id>/research/`. Do not write `AGENTS.md`, `CLAUDE.md` or docs files; promotion into the repo happens only through `/interstage:promote`.
