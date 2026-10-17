---
name: is-baby-steps
description: Incremental implementation method for builders - the smallest meaningful change, validated and committed one step at a time. Use when implementing a TODO item, a refactor or a migration step; skip it for hotfixes, trivial edits and spikes.
license: MIT
---

# Baby Steps

Take the smallest meaningful step, validate it, then take the next. A broken step is cheap to revert; a broken large change is not.

## When NOT to use

- Emergency hotfixes and incidents: use the fast lane, or report to the orchestrator so it can spawn Tiger Team.
- Trivial edits: typos, comments, one-line config changes.
- Exploratory spikes where the output is knowledge, not code.
- Atomic changes that cannot be split (a contract change with all its callers).

## Context modes

- **Production (default):** all six rules, full validation after each step.
- **Prototype:** explore freely and discard or re-do the result with baby steps. Report findings, do not merge the prototype.
- **Legacy (untested code):** step 0 is characterization tests that pin current behavior (snapshot or approval tests). Then each step is valid when those tests still pass.
- **Crisis:** not this skill. Point the orchestrator at the fast lane and Tiger Team.

## The six rules

1. **Smallest meaningful change.** Split the work until each step does one thing and can be validated on its own.
2. **Explain the process.** Each step states what it does and why, so a reviewer can follow the path, not just the result.
3. **One accomplishment at a time.** Do not start the next step, model or component until the current one is done.
4. **Complete each step.** A step is finished only when it meets the definition of done below. Never leave a step half working.
5. **Validate after every step.** Run the check, do not assume.
6. **Report every step** in the block below.

## Definition of done (per step)

- Code follows project conventions and does only what the step says.
- Tests for the new behavior exist and pass; the existing tests still pass.
- Lint, type check or compile is clean (use the project's own commands).
- The changed behavior was observed, not inferred.
- The step can be explained and verified independently of later steps.

## Validation checklist

1. Run the tests relevant to the change, then the wider suite when the step touches shared code.
2. Run the compiler, type checker or linter.
3. Exercise the specific behavior that changed and compare with `done-when`.
4. Check for side effects in neighboring code and files.
5. Record exactly which commands you ran and their result.

## Step size

| Too big | Right size |
|---|---|
| "Add authentication" | Add a password-hash field to the user model; add the hashing helper with tests; add a login endpoint that returns 501; implement verification; add the middleware |
| "Refactor the order module" | Extract one function with its test; switch one caller; delete the old path once no caller remains |
| "Add models and endpoints for users and posts" | User model with its test; then post model with its test; endpoints in later steps |

Split again when a step touches unrelated files, needs more than one reason to change, or you cannot say how to validate it in one sentence. Merge steps that cannot be validated alone.

## Step report

Write one block per step in your report:

```markdown
TODO-ID: <id>
Goal: <one sentence>
Files: <paths changed>
Validation: <commands run and what they showed>
Next: <the next step>
Blockers: <none, or what is blocking>
```

## Commits and worktrees

- Work on the task branch in your isolated worktree. Make one commit when the item meets its `done-when`, with the message exactly `<TODO-ID>` (for example `T-014`). The orchestrator squashes it as `<TODO-ID>: <title>`.
- Revert inside your worktree (`git restore`, `git checkout -- <path>`, or `git stash`). Never reset the mission branch or touch other branches.
- Parallel items must touch disjoint files. If your step needs a file another item owns, stop and report it so the orchestrator can add `depends`.
- Do not install dependencies or call the network unless the assignment says it is approved.

## Recovery protocol

When a step fails validation:

1. Stop. Do not start the next step.
2. Revert the step in the worktree.
3. Diagnose the cause. Use `skill://is-sherlock-debugging` when it is not obvious.
4. Choose: re-decompose (step was too big), fix forward (targeted fix, then re-validate), or pivot (approach was wrong).
5. Restart the revised step from the beginning and note what failed in the report.

**Stuck rule:** after 3 failed attempts at the same step, stop and report BLOCKED to the orchestrator with the evidence of each attempt. The builder never changes the spec or the `done-when` to make a step pass; the orchestrator or planner decides.

An external blocker (missing access, an unmerged dependency, an ambiguity in the spec) is reported the same way as an open question; do not guess and do not leave the step in progress.

## Anti-patterns

- Batching several steps into one validation.
- Skipping validation because the change looks safe.
- "Fixing" a failing test by weakening it.
- Mixing refactoring with behavior changes in one step.
- Leaving the tree in a partly working state between steps.
- Claiming a step passed without having run its checks; see `skill://is-verify-claims`.

## Related

- `skill://is-stepwise-testing` for the test-first rhythm inside each step.
- `skill://is-sherlock-debugging` when a failure has an unknown cause.
- `skill://is-verify-claims` before reporting done.

## Remember

- The process is part of the deliverable: a reviewer must be able to follow it.
- Small steps make failures cheap and causes obvious.
- Validate every step; report blockers early.
