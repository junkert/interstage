---
name: is-migration
description: Use for framework, library, language or dependency migrations and version upgrades. Gives the step order, commit discipline, resumable ledger and escalation rules for a migration that must stay green at every commit.
license: MIT
---

# Migration

Scope: framework or language version upgrades, framework-to-framework moves, architectural moves and dependency upgrades. OS packages, infrastructure and PR bots are out of scope.

## Rules

1. Run the project's tests and build first and record the baseline (pass, fail, skipped) before any change.
2. One verified step per commit on the task branch. Message `<TODO-ID>: <imperative title>`; the orchestrator squashes.
3. The build and tests are green at each commit. If a step breaks them and you cannot fix it in the step, revert inside the worktree.
4. Codemods first: use `ast_edit` and the official migration tool of the framework, then hand-edit what remains.
5. Never mix a dependency upgrade and a code migration in one commit.
6. One dependency per commit, lockfile updated in the same commit.
7. Bump to the nearest safe version first, then step toward the target. Never skip majors without reading each changelog.
8. Security upgrades first. Security claims need the registry advisory id as evidence.
9. Package installs and downloads are gate D: report them as open questions unless the assignment says approved.
10. Removing old code is the last step and its own commit.
11. After 3 failed attempts on one step, stop and report BLOCKED with the evidence.

## Migration ledger

Keep `$INTERSTAGE_STATE_DIR/missions/<id>/evidence/migration-ledger.md` (the orchestrator writes it from your report). It lists done items with commit ids, remaining items in order, the baseline result, and open questions. A fresh agent must be able to resume from it after a context reset. Report each ledger update in the specialist report.

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
| Rust | Cargo.toml, Cargo.lock | `cargo update --dry-run` |
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

- Pin exact versions for the migration and read lockfile diffs.
- Test the upgraded dependency's actual usage paths, not only the suite.
- Record each decision and rationale in the ledger.
- Keep deprecation warnings at or below baseline.
- Revert a failed step instead of stacking fixes on it.
- Do not widen scope beyond the TODO items.
