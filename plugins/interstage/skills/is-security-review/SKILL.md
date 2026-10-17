---
name: is-security-review
description: Use for a static security review of repository contents (code, configuration, dependency manifests and lockfiles, CI workflows, Dockerfiles and IaC). Produces evidence-backed findings with CWE ids and reachability-based severity.
license: MIT
---

# Static security review

## Guardrails
- Static only: read files in the repository. No requests to running targets, no exploitation, no proof-of-concept payloads.
- Run analyzers (SAST, secret scanners, image or config scanners) only if already installed; never install them.
- Dependency audits that contact the network are gate D: ask the orchestrator first.
- Report open questions to the orchestrator.

## Review areas
1. Secrets in the repository (keys, tokens, passwords, committed `.env` files).
2. Authentication and authorization checks on every handler, especially state-changing ones.
3. Input validation and output encoding at sinks (queries, shell commands, HTML, file paths, outbound URLs, deserialization).
4. Cryptography and key handling (algorithms, password hashing parameters, randomness, key storage).
5. Error handling that leaks internals; PII and secrets in logs.
6. Dependencies and lockfiles: cite an advisory id only if it appears in a provided manifest, lockfile or audit output; never from memory.
7. Containers, IaC, CI and config: root user, wildcard IAM, unencrypted storage, missing security headers, unpinned base images or actions, secrets exposed to CI steps.

Use `references/owasp-static-checklist.md` for per-category checks and evidence requirements.

## Finding record
`title`, `cwe` (only if certain), `severity`, `evidence` (file:line), `impact`, `recommendation`. Optional `compliance` tag (SOC 2, ISO 27001, HIPAA, PCI); it never affects severity. Never invent CVSS values.

## Severity by reachability
- **blocker**: reachable in the repository and a control is clearly absent. Examples: committed live-looking credential; user input concatenated into a query or command on a reachable route; authentication or signature checks skipped; missing authorization on a state-changing endpoint.
- **major**: real but partly mitigated or needs a precondition. Examples: weak password hashing parameters; reachable dependency with a cited advisory; wildcard IAM or root container in shipped config; missing CSRF protection on cookie-authenticated routes.
- **minor**: hardening gap with no demonstrated path.
- **nit**: security intent that is undocumented.
- Unknown reachability or mitigation downgrades one level and is marked `[INFERENCE]`.

## Verdict
Clean means zero blockers and zero majors. A clean report is valid. No quota; findings without file:line evidence are dropped. Validate analyzer output by reading the code before reporting it.

For structured design-level analysis see `skill://is-threat-modeling`.
