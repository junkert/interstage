# OWASP static checklist (Top 10, 2021 edition)

Static inspection only. Every finding needs file:line evidence. "Reachable" means a route, job or entry point in the repository leads to the code. Unknown reachability downgrades one level and is marked `[INFERENCE]`.

| Category | Static check | Evidence required | Severity rule |
|---|---|---|---|
| A01 Broken Access Control: missing authorization (CWE-862) | Handlers for state-changing or data-returning routes: is there an authorization check before the action? | Handler file:line plus the absent or bypassed check, and the route registration | blocker if state-changing and reachable; major if read-only data; minor if the data is non-sensitive |
| A01: insecure direct object reference (CWE-639) | Handlers that load a record by a request-supplied id without comparing owner or tenant | Lookup file:line and the missing ownership comparison | blocker if reachable and tenant or user data; otherwise major |
| A02 Cryptographic Failures: weak algorithm (CWE-327) | Use of MD5, SHA-1, DES or ECB mode for security purposes; fast unsalted hashes for passwords; non-CSPRNG for tokens | Call site file:line and its purpose | major for passwords or tokens; minor for non-security checksums |
| A02: hard-coded credentials (CWE-798) | Keys, tokens or passwords in source, config, fixtures, history of committed `.env` | Value location file:line (redact the value) and what it appears to grant | blocker if live-looking; minor if clearly a placeholder or test fixture |
| A03 Injection: SQL (CWE-89) | Queries built by concatenation or interpolation with request data instead of parameters | Sink file:line and the data flow from input | blocker if reachable |
| A03: OS command (CWE-78) | Shell or process invocation with request data in the command string | Sink file:line and data flow | blocker if reachable |
| A03: cross-site scripting (CWE-79) | Unescaped output in templates; raw HTML insertion APIs fed by user data | Sink file:line and data flow | major; blocker if stored and rendered to other users with no encoding |
| A04 Insecure Design | Missing rate limits on authentication or expensive operations; trust placed in client-side checks; no abuse-case handling in specs | Spec clause or code file:line showing the missing control | major if a sensitive flow lacks the control; otherwise minor |
| A05 Security Misconfiguration | Debug mode on in shipped config; permissive CORS; missing security headers; default credentials; root container; wildcard IAM; unencrypted storage; verbose errors | Config file:line | major for shipped wildcard IAM or root container; minor for missing headers |
| A06 Vulnerable and Outdated Components | Manifests and lockfiles: dependency versions against advisories already present in provided audit output or lockfile metadata; unpinned or floating versions | Manifest or lockfile file:line and the cited advisory id from the provided source | major if the dependency is reachable and an advisory is cited; minor if unpinned only |
| A07 Identification and Authentication Failures: missing authentication (CWE-306) | Sensitive endpoints reachable without a login or token check; skipped signature or token verification | Route file:line and absent check | blocker if reachable and sensitive |
| A08 Software and Data Integrity Failures: unsafe deserialization (CWE-502) | Deserializing untrusted data with formats or loaders that construct arbitrary objects | Call site file:line and input source | blocker if reachable with untrusted input |
| A08: CI integrity | CI actions or images unpinned; workflows that run untrusted input with secrets | Workflow file:line | major if secrets are exposed; minor if only unpinned |
| A09 Security Logging and Monitoring Failures: sensitive data in logs (CWE-532) | Log statements that include credentials, tokens or PII; no logging of authentication failures or access denials | Log call file:line | major for credentials or tokens; minor for PII or missing audit logs |
| A10 Server-Side Request Forgery (CWE-918) | Outbound requests whose URL comes from request data with no allowlist | Request call file:line and data flow | blocker if reachable and internal network is addressable; otherwise major |
| Path traversal (CWE-22) | File reads, writes or extraction using request-supplied paths without normalization and a base-directory check | Sink file:line and data flow | blocker if reachable write; major if reachable read |
| Cross-site request forgery (CWE-352) | State-changing routes authenticated by cookie with no anti-CSRF token or same-site control | Route file:line and session config | major |

Compliance tags (SOC 2, ISO 27001, HIPAA, PCI) may be added to a finding but never change severity.
