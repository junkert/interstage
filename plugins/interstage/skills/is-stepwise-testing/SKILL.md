---
name: is-stepwise-testing
description: Verify a multi-step flow one step at a time, with evidence of each intermediate state, layered diagnosis and isolation before integration. Use when a flow fails somewhere in the middle, when building a multi-step feature, or when an outcome check hides which step broke.
license: MIT
---

# Stepwise testing

Checking only the final result tells you that something broke, not where. Verify every step and the state between steps.

## Method

1. **List the steps.** Write the flow as numbered steps with the input and expected output of each. Include side effects: files, network calls, stored rows, emitted events.
2. **Capture evidence before.** Record the starting state: input, relevant stored data, configuration, the exact command.
3. **Check each step.** After each step, observe its real output and the state it left. Compare with the expectation from step 1. Stop at the first mismatch; that step is the suspect.
4. **Isolate, then integrate.** Run the failing step alone with fixed inputs and its dependencies replaced by known values. When it passes alone, reconnect one dependency at a time until it fails again.
5. **Verify assumptions** about third-party libraries and services. Read what the call actually returns instead of assuming its documented behavior, including error shapes, empty results and defaults.
6. **Capture evidence after.** Record the end state and the output that proves the fix or the finding.
7. **Add a permanent test** for the step that failed, using the project's own test command.

## Layered diagnosis

When a call across a network fails, test from the bottom layer up and stop at the first failing layer.

| Layer | Question | Examples |
|---|---|---|
| Name resolution | does the host resolve? | `dig`, `nslookup`, a resolver call in the language |
| Transport | can a connection open? | `nc -z host port`, a socket connect |
| Protocol | does a request get a response? | `curl -v` and its status and headers |
| Application | is the body correct? | parse and assert on the response |

The same shape applies elsewhere: file exists, readable, parses, has the expected content.

## Instrumentation

Use the lightest observation that answers the question: a debugger, a test assertion, a temporary print or log at each step boundary showing inputs, outputs and key state.

| Ecosystem | Temporary observation |
|---|---|
| Python | `print`, `breakpoint()`, `pytest -s` |
| JavaScript or TypeScript | `console.error`, debugger, the runner's verbose mode |
| Go | `t.Logf`, `go test -v`, `dlv` |
| Rust | `dbg!`, `cargo test -- --nocapture` |

Rules:

- Temporary instrumentation is not part of the change. Remove it before the commit, so each verified item stays one clean commit. Check the diff for leftover prints, debug flags and commented-out probes.
- Never log secrets or personal data in probes.
- Keep probes proportional: boundaries and decision points, not every line.

## Evidence

Report, per step, the command or action, the observed output (real, excerpted) and the verdict: holds, broken or untested. Mark inferences as [INFERENCE]. If a step cannot be observed, say so; do not guess its output.

## Related

Use `skill://is-sherlock-debugging` for a full defect investigation, `skill://is-testing-integration` for boundary tests and `skill://is-test-pipeline` for the order of full runs.
