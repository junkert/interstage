---
name: is-migration
description: Use for framework, library, language or dependency migrations and version upgrades. Gives the step order, commit discipline, resumable ledger and escalation rules for a migration that must stay green at every commit.
license: MIT
---

# Migration

Scope: framework or language version upgrades, framework-to-framework moves, architectural moves and dependency upgrades. OS packages, infrastructure and PR bots are out of scope.

## Rules

1. Run the project's tests and build first and record the baseline (pass, fail, skipped) before any change.
2. Commit each verified step on the task branch. Checkpoint commits are allowed; the message is exactly `<TODO-ID>`. The orchestrator squashes at integration.
3. The build and tests are green at each commit. If a step breaks them and you cannot fix it within the step, revert inside your own isolated checkout.
4. Codemods first: use `ast_edit` and the framework's official migration tool, then hand-edit what remains.
5. Never mix a dependency upgrade and a code migration in one commit. Exception: if a breaking upgrade cannot compile without code changes, add a compatibility layer first, or let the bump commit carry the minimal required fixes and nothing else.
6. One dependency per commit with the lockfile updated in the same commit, except dependencies that require each other's version (for example a framework and its companion or `@types` packages).
7. Bump to the nearest safe version first, then step toward the target. Never skip majors without reading each changelog.
8. Security upgrades first. Security claims need the registry advisory id as evidence.
9. Package installs and downloads are gate D, and `outdated` queries are network calls: report them as open questions unless the assignment says approved.
10. Removing old code is the last step and its own commit.
11. After 3 failed attempts on one step, stop and report BLOCKED with the evidence.

## Migration ledger

The assignment passes the ledger path under a `Ledger` heading: `$INTERSTAGE_STATE_DIR/missions/<id>/evidence/<ID>/ledger.md`. Read it first if it exists. It lists the baseline result, done items (by `<TODO-ID>` and step title, not commit ids, since task-branch commits are squashed), remaining items in order, and open questions. A fresh agent must be able to resume from it after a context reset. Put every update in a `## Ledger update` section of your report; the orchestrator writes the file.

## Step order

1. Record the baseline (rule 1) and read the current ledger if one exists.
2. Inventory usage of the old API and dependency constraints (peer ranges, transitive pins).
3. Read changelogs and migration guides between current and target versions; list breaking changes.
4. Choose the strategy (table) and write the ordered step list into the ledger.
5. Prepare: compatibility layer or adapters if both versions must coexist.
6. Upgrade dependencies, one per commit, security first.
7. Run codemods, commit, verify.
8. Migrate remaining code in small slices, each with its tests updated.
9. Remove old code, adapters and flags in the final commit.
10. Re-run the full baseline suite and compare with step 1.

## Breaking change categories

API signature changes, removed or renamed APIs, behavior and default changes, configuration format changes, build and tooling changes, peer-dependency and runtime-version requirements.

## Strategy

| Situation | Strategy |
|---|---|
| Small codebase, few dependencies | Big bang in one branch, still stepwise commits |
| Large codebase, many dependencies | Incremental slices, each green |
| Both versions must run side by side | Parallel run behind an adapter or flag |
| Legacy system replaced gradually | Strangler: route one capability at a time |
| Data or schema change | Expand, migrate, contract in separate commits |

## Dependency checklist

- [ ] Current and target versions and the reason (security, feature, maintenance, compatibility, performance)
- [ ] Changelog and breaking changes read
- [ ] Peer and transitive constraints checked
- [ ] Lockfile diff reviewed
- [ ] Deprecation warnings recorded before and after
- [ ] Tests and build green, compared with baseline
- [ ] Type check and lint green
- [ ] No unrelated version bumps in the lockfile
- [ ] Licence change of the new version checked
- [ ] Advisory id recorded for security upgrades

## Ecosystems (examples)

| Ecosystem | Manifest and lock | Outdated check |
|---|---|---|
| JavaScript | package.json, lockfile of the project's manager | `npm outdated` |
| Python | pyproject.toml or requirements, lock file | `pip list --outdated` |
| Go | go.mod, go.sum | `go list -u -m all` |
| Rust | Cargo.toml, Cargo.lock | `cargo update --dry-run` (within ranges only) |
| Java | pom.xml or build.gradle | build tool's versions plugin |
| Ruby | Gemfile.lock | `bundle outdated` |
| .NET | csproj | `dotnet list package --outdated` |
| PHP | composer.json, composer.lock | `composer outdated` |

Use the project's own manager; these are examples only.

## Upgrade priority

| Type | Priority | Risk |
|---|---|---|
| Security | Highest | Low for patch-only, medium if mixed |
| Compatibility (blocking) | High | Medium to high |
| Maintenance (unsupported version) | High | Depends on gap |
| Feature | Medium | Medium to high |
| Performance | Medium | Low to medium |

## Practices

- Follow the project's pinning policy and read lockfile diffs.
- Test the upgraded dependency's actual usage paths, not only the suite.
- Record each decision and rationale in the ledger.
- Keep deprecation warnings at or below baseline.
- Revert a failed step instead of stacking fixes on it.
- Do not widen scope beyond the TODO items.
