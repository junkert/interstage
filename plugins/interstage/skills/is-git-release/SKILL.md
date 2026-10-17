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
3. Read commits (`git log --format='%h %s' <range>`). Subjects follow `<TODO-ID>: <imperative title>`. Find each id in the mission `TODO.md` (mission id: `INTERSTAGE_MISSION_ID`) and group by the SPEC section its `spec:` field points to. Items without `spec:`, and subjects without a TODO id (flag these), go under "Other changes". Do not infer groups from `feat:`-style prefixes.
4. Version bump: major if the SPEC or diff evidence shows a breaking change (removed or changed public API, migration needed), minor for new capability, patch for fixes only. Cite the commit or file:line behind the choice. If the versioning scheme is unclear, report an open question to the orchestrator.
5. Return the notes in the specialist report; the orchestrator records them with `write_artifact kind=evidence name=release-notes-<version>.md`. Never overwrite `CHANGELOG.md`; propose its entry in the report.
6. Print the commands (see gate F). Never push.

## Notes format

```
## Release Notes <version>

### <SPEC section from spec:>
- <TODO-ID>: <title>

### Other changes
- <hash> <subject>
```

## Gate F

Print, do not run (`<sha>` is the commit being released, from `git rev-parse HEAD`):

```bash
gh release create <version> --target <sha> --title "<version>" --notes-file <notes file>
```

Without `--target`, a tag created remotely points at the default branch head. The extension blocks `gh release create` and `git push` for subagents without a granted gate F approval; run them only if the assignment states approval. Credentials come only from the user's environment (`GH_TOKEN`, `VERCEL_TOKEN`); never write them to files or notes.

## Deploy readiness (read-only)

Before a Vercel deploy, check and report pass/fail with file:line evidence:

- The build command (`package.json` scripts or `vercel.json`) exists and its output directory exists after the project's own build.
- Environment variables referenced in code (`process.env.X`, `import.meta.env.X`) all appear in `.env.example`; list the missing ones.
- No secrets committed: `.env` and `.env.*.local` are untracked (`git ls-files`; `.env.example` may be tracked) and no key-shaped literals in tracked files.
- `engines` is set in `package.json`.

Print `vercel` (preview) and `vercel --prod` for the orchestrator; do not run them without gate F approval.
