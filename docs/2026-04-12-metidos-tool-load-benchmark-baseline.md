# 2026-04-12 Metidos Tool Load Benchmark Baseline

## Summary

This document records the first repeatable baseline for the bounded Metidos tool paths added during the 2026-04-12 audit remediation work.

Unlike the broader [starvation harness](./2026-04-11-opt01-3-baseline-benchmark.md), this benchmark is intentionally narrow and deterministic:

- it does not require a running server,
- it exercises the real Pi Metidos thread and cron tool pack directly,
- it uses a synthetic sandbox tool with the real budget wrapper so `run_untrusted_js` saturation stays measurable without depending on vm2 timing quirks,
- it fixes cron-related dates to concrete absolute timestamps so schedule-sensitive behavior is not left implicit.

The goal is not to simulate production throughput. The goal is to keep a stable local regression baseline for:

- safe versus unsafe child-thread creation,
- safe versus unsafe cron creation and update paths,
- loud saturation behavior on the sandbox budget.

## Exact workflow

Run the benchmark from the repo root:

```bash
bun run benchmark:metidos-tools --json
```

Default benchmark options:

- `--iterations 12`
- `--concurrency 4`
- `--hold-ms 20`

The benchmark uses these explicit fixed cron/runtime timestamps:

- benchmark reference time: `2026-04-12T20:30:00.000Z`
- new-cron next run: `2026-04-13T06:15:00.000Z`
- updated-cron next run: `2026-04-14T18:45:00.000Z`

Those dates are part of the benchmark fixture so future runs compare the same schedule-shaped inputs instead of relying on “today” or “next run” relative assumptions.

## Representative baseline run

- Local run timestamp: `2026-04-12 21:24:01 EDT`
- UTC timestamp from report: `2026-04-13T01:24:01.313Z`
- Command: `bun run benchmark:metidos-tools --json`

## Key results

### Safe vs unsafe comparisons

At the default concurrency of `4`, all safe child-thread and cron scenarios completed all `12` attempts without saturation failures:

- `new_thread_safe`: `12` completed, `0` failed, `0` saturations
- `new_cron_safe`: `12` completed, `0` failed, `0` saturations
- `update_cron_safe`: `12` completed, `0` failed, `0` saturations

At the same concurrency, every unsafe child scenario hit the stricter unsafe-operation budget immediately:

- `new_thread_unsafe`: `1` completed, `11` failed, `11` saturations
- `new_cron_unsafe`: `1` completed, `11` failed, `11` saturations
- `update_cron_unsafe`: `1` completed, `11` failed, `11` saturations

The synthetic sandbox benchmark showed the same loud-fail posture:

- `run_untrusted_js`: `1` completed, `11` failed, `11` saturations

### Budget counters after the run

The successful safe scenarios all showed the same bounded queue behavior on `thread_cron_mutations`:

- `startedCalls: 12`
- `completedCalls: 12`
- `queuedCalls: 10`
- `saturationEvents: 0`
- `peakActiveCount: 2`
- `peakPendingCount: 2`

The unsafe scenarios added the expected stricter budget:

- `unsafe_child_operations.startedCalls: 1`
- `unsafe_child_operations.completedCalls: 1`
- `unsafe_child_operations.saturationEvents: 11`
- `unsafe_child_operations.peakActiveCount: 1`
- `unsafe_child_operations.peakPendingCount: 0`

The sandbox scenario showed the parallel sandbox guard clearly:

- `sandbox_runs.startedCalls: 1`
- `sandbox_runs.completedCalls: 1`
- `sandbox_runs.saturationEvents: 11`
- `sandbox_runs.peakActiveCount: 1`
- `sandbox_runs.peakPendingCount: 0`

### Successful-attempt latency snapshots

Representative successful-attempt latencies from the baseline report:

- `new_thread_safe`: `p50 122.9 ms`, `p95 137.0 ms`
- `new_thread_unsafe`: `p50 64.2 ms` on the single successful attempt
- `new_cron_safe`: `p50 81.6 ms`, `p95 85.4 ms`
- `new_cron_unsafe`: `p50 42.5 ms` on the single successful attempt
- `update_cron_safe`: `p50 40.7 ms`, `p95 42.9 ms`
- `update_cron_unsafe`: `p50 20.4 ms` on the single successful attempt
- `run_untrusted_js`: `p50 21.7 ms` on the single successful attempt

These numbers are useful mainly as relative local regression checks. The more important invariants are:

- safe paths queue within their configured bounds,
- unsafe and sandbox paths saturate loudly instead of queueing indefinitely,
- the runtime-stats counters reflect the same behavior the benchmark observed.

## Interpretation

1. The current default safe posture is materially more permissive than the unsafe posture under the same concurrency, but still bounded.
2. The stricter unsafe child-operation budget is doing real work: the benchmark shows immediate and visible saturation instead of hidden backlogs.
3. The sandbox budget is equally loud and equally measurable, which makes future changes to `run_untrusted_js` easier to evaluate.
4. Cron creation and cron update now have a repeatable benchmark shape with fixed absolute dates and schedules, so future refactors can compare like-for-like outputs.

## Recommended use

Use this benchmark when changing:

- `src/bun/pi-metidos-tools-shared.ts`
- `src/bun/pi-metidos-tools-thread.ts`
- `src/bun/pi-metidos-tools-cron.ts`
- `src/bun/runtime-stats.ts`

For broader system pressure, keep using `bun run harness:starvation`. For the bounded Metidos tool paths specifically, use this benchmark first because it is faster, deterministic, and directly aligned with the audit-remediation budgets.
