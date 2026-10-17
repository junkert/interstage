---
name: is-git-release
description: Use when preparing a tagged release. Computes the release range, proposes a semver bump, drafts release notes from TODO-ID commits, and prints (never runs) the release and deploy commands unless gate F is approved.
license: MIT
---

# Git release

Draft a release from commits. Shipping is gate F: print commands, do not run them.

## Steps

1. Preflight: `git status --porcelain` must be empty and the branch must be the one the assignment names. Otherwise report it and stop.
2. Range: `git describe --tags --abbrev=0` gives the last tag; the range is `<tag>..HEAD`. If it fails there is no prior tag: use the full history (`git log HEAD`) and say so.
3. Read commits (`git log --format='%h %s' <range>`). Subjects follow `<TODO-ID>: <imperative title>`. Resolve each id in the mission `TODO.md` and group by the category named in the TODO item or SPEC section. Do not infer categories from `feat:`-style prefixes. A subject without a TODO id goes under "Other changes" and is flagged.
4. Version bump: major if the SPEC or diff evidence shows a breaking change (removed or changed public API, migration needed), minor for new capability, patch for fixes only. Cite the commit or file:line behind the choice. If the versioning scheme is unclear, report an open question to the orchestrator.
5. Write the notes to `$INTERSTAGE_STATE_DIR/missions/<id>/artifacts/release-notes-<version>.md`. Never overwrite `CHANGELOG.md`; propose its entry in the report.
6. Print the commands (see gate F). Never push.

## Notes format

```
## Release Notes <version>

### <Category from TODO/SPEC>
- <TODO-ID>: <title>

### Other changes
- <hash> <subject> (no TODO id)
```

## Gate F

Print, do not run:

```bash
git tag -a <version> -m "<version>"
gh release create <version> --title "<version>" --notes-file <path to release notes>
```

Run them only if the assignment states gate F is approved (the extension also blocks them). Credentials come only from the user's environment (`GH_TOKEN`, `VERCEL_TOKEN`); never write them to files or notes.

## Deploy readiness (read-only)

Before a Vercel deploy, check and report pass/fail with file:line evidence:

- The build command (`package.json` scripts or `vercel.json`) exists and its output directory exists after the project's own build.
- Environment variables referenced in code (`process.env.X`, `import.meta.env.X`) all appear in `.env.example`; list the missing ones.
- No secrets committed: `.env*` files are untracked (`git ls-files`) and no key-shaped literals in tracked files.
- `engines` is set in `package.json`.

Print `vercel` (preview) and `vercel --prod` for the orchestrator; do not execute them without gate F approval.
