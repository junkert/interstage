# Completion Anti-Patterns

Ways work looks done while it is not. Each entry: what you see, what to check.

## Nearly-done trap
- Seen: "just needs wiring", "ready to integrate", "works in isolation", code written but tests not run.
- Check: every new function has a caller; the entry point (route, command, handler registration) exists; the tests were actually executed and you saw them run. The last connection is where unfinished work hides.

## Mock data mirage
- Seen: everything works on sample data; "real source coming"; in-memory stores standing in for the database.
- Check: the production code path reads from the real source or an explicitly named local equivalent; fixtures are only imported by tests; error handling has been exercised with a real failing dependency.

## Integration illusion
- Seen: "frontend done, backend done"; an API that nothing calls; a schema nothing uses.
- Check: find the caller for each interface and confirm that caller's request matches the callee's contract (names, types, status codes). Run one request across the boundary.

## Spec gap
- Seen: "I interpreted the requirement", extra features, a vague spec used as license.
- Check: compare each acceptance criterion to code and behavior. Extra unrequested behavior is a finding; unclear clauses go to open questions, not to your own interpretation. See `skill://is-spec-gap-analysis`.

## Test theater
- Seen: all green, high coverage, bugs still ship.
- Check: assertions can fail (they compare against an independent expected value); the unit under test is not mocked; negative and boundary cases exist; no skipped or focused tests; the test calls the new code. Coverage shows code ran, not that it was checked. See `skill://is-test-gap-analysis`.

## Documentation mirage
- Seen: a README exists but setup does not work; docs describe an old interface.
- Check: execute the documented steps verbatim from a clean state; compare documented flags, endpoints and examples with the code.

## Configuration gap
- Seen: works on the author's machine; needs an undocumented env var, local file or installed tool.
- Check: list every environment variable and file path the code reads; confirm each is documented or has a default; look for absolute local paths and secrets in the repository.

## Error-handling omission
- Seen: happy path only; "users won't do that".
- Check: for each fallible call (I/O, parse, network), what happens on failure? Trigger it. Look for empty catch blocks, ignored return values and errors logged but treated as success.

## Performance lie
- Seen: fast on a handful of rows.
- Check: the algorithmic shape (queries inside loops, unbounded reads, full scans) and a run with realistic data volume if the project has a way to produce it. Report measurements you took, never estimates.

## Dead feature flag
- Seen: the feature exists behind a flag that is off, or a branch never taken.
- Check: the default value of the flag and whether any path turns it on; run the flagged path once.

## Green by omission
- Seen: the test selection, path filter or glob matches nothing; the suite exits 0 after running zero tests.
- Check: the number of tests run is non-zero and includes the new ones.

## Self-reported progress
- Seen: a status file, memory note or commit message says "complete".
- Check: those are claims about the code. Verify the code, not the note.
