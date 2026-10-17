---
name: is-performance-profiling
description: Use when a change must be faster, a regression is suspected, or a load or resilience claim needs evidence. Local profiling method (baseline, profile, one change, re-measure) with load-test definitions and opt-in chaos testing.
license: MIT
---

# Performance profiling

Report measured deltas, never estimates. Every number in a report comes from a command you ran; show the command and its real output.

## Method

1. **Benchmark.** Pick a reproducible benchmark (an existing bench target, a test, or a command with fixed input). Record a baseline from N runs (N is your choice; more when noisy). Keep the harness, input and machine state identical for every later run.
2. **Profile** with the language-native sampler (table below). Profile the same workload the benchmark runs.
3. **Hypothesis.** Read the profile or flame graph and name one suspected cause with the evidence (function, share of samples).
4. **Change one thing.** One change per measurement, so the delta has one cause.
5. **Re-measure** with the same harness and the same N.
6. **Report the delta**: baseline and after distributions, the command, its output, and whether the difference exceeds the noise. If it does not, say the change is not shown to help.

## Reading results

- Report median and percentiles (p90, p95, p99) over the runs, not just the mean. State the run count.
- Noise: flag outliers outside Q1 - 1.5 x IQR and Q3 + 1.5 x IQR. Re-run or lengthen sampling when the spread of baseline runs is as large as the delta.
- Differential profiling: profile before and after and compare the two, rather than interpreting one profile alone.
- Flame graphs: width is share of samples, depth is call stack. Look for wide frames at the top of stacks (self time) before tall stacks. Idle or wait frames mean the problem is not CPU.
- Profile production-like inputs; a toy input moves the hotspot.

## Tools

| Need | Linux-only | macOS | Language-native |
|---|---|---|---|
| CPU sampling | `perf` | `sample <pid>`, `xctrace` (Instruments) | Node `--cpu-prof`; Python `cProfile`, `py-spy`; Go `pprof`; Rust `cargo flamegraph`; JVM JFR |
| Kernel tracing | eBPF/BCC, ftrace, SystemTap | dtrace-based tools | n/a |
| Syscalls | `strace` | `dtruss` (dtrace) | n/a |
| Wall time and memory of a command | GNU `/usr/bin/time -v` (may be absent on minimal images) | `/usr/bin/time -l` (the shell builtin `time` has no `-l`) | n/a |
| Microbenchmarks | n/a | n/a | Rust `criterion` |

Neutral: `hyperfine` benchmarks a command before and after a change on either OS. It is third-party; if absent, report "not run" with the reason.

Linux-only tools run only when `uname` reports Linux, the tool is on PATH and the needed privileges exist. Otherwise record "not run" with the reason. Tracing tools may need root; never escalate privileges on your own, report it as an open question.

## Load testing vocabulary

Baseline first, then: **load** (expected traffic), **stress** (increase until it breaks, to find the limit), **spike** (sudden surge, then recovery), **endurance** (long steady load, to expose leaks). Use the project's own load tool. Run against local or test environments, never a system the user does not own.

## Chaos testing (opt-in)

Chaos is active testing: it injects faults. Run it only when the project SPEC and your assignment both explicitly enable it, and only against environments the user owns. Otherwise stop and report that it is not enabled.

- State a hypothesis ("when X fails, Y stays within Z") before injecting.
- Define the blast radius (which environment, which component) and a stop condition.
- Have an abort and rollback path ready and tested before the first injection; abort at the stop condition.
- Increase fault intensity step by step; record the baseline first.
- Report what you observed against the hypothesis, with command output.

## Output

`## Result` (hypothesis, change, verdict), `## Evidence` (commands and real output for baseline, profile, after), `## Open questions`. Severity follows the standard scale; a regression beyond noise against a stated target is `major`. A result of "no measurable change" is valid.
