---
name: is-threat-modeling
description: Use to build a STRIDE threat model of a component or feature from its code and design, listing existing controls with file:line, gaps and recommendations, ordered by impact and likelihood.
license: MIT
---

# Threat modeling (static)

Works from code, configuration and design documents in the repository only. No probing of running systems; no exploit steps.

## 1. Scope
- **Entry points**: routes, message consumers, CLI args, file and webhook inputs, scheduled jobs.
- **Trust boundaries**: where data or privilege crosses (client to server, service to service, tenant to tenant, CI to production, application to datastore).
- **Assets**: data and capabilities worth protecting.

## 2. Actors
Condense to what changes the controls needed:
- unauthenticated external party, low effort and automated
- financially motivated external party
- authenticated user acting outside their rights
- insider with legitimate access
- well-resourced adversary (only where assets justify it)

## 3. STRIDE per component
For each component crossing a boundary, check Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege. Record only rows with a control or gap you can cite:

| Component | STRIDE | Existing control (file:line) | Gap | Recommendation |
|---|---|---|---|---|

- A gap needs evidence: the absent control or the code path lacking it. Without it, mark the row `untested` and name the cheapest static check.
- Apply secure-design principles as the standard: least privilege, defense in depth, fail safe, secure defaults.

## 4. Order
Order rows by impact first, then likelihood, using the repository's evidence; do not compute scores or invent numbers. Map to severity per `skill://is-security-review`; unknown reachability downgrades one level and is marked `[INFERENCE]`.

## Rules
- No quota; a model with no cited gaps is valid.
- Code-level issues found along the way become findings for `skill://is-security-review`.
- Report open questions to the orchestrator.
