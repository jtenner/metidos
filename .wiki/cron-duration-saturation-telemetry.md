# Cron Duration and Saturation Telemetry

## Summary

Observed in `OPT06.2` on 2026-04-11: Metidos extends the shared process-local runtime diagnostics pipeline with a low-cardinality `cron` telemetry bucket that records active and pending scheduled runs, queue saturation, terminal outcomes, and aggregate duration data. The telemetry is emitted through the existing runtime-stats surfaces, printed by the starvation harness, and persisted into the optional telemetry sidecar database when `--track-telemetry` is enabled.

## Problem

Before this slice, `OPT06.1` had already introduced a scheduler-fired cron concurrency cap in `src/bun/sidecar-cron-runner.ts`, but operators still could not directly answer basic runtime questions:

- how many cron runs are active now,
- how much work is waiting behind the scheduler limiter,
- whether the limiter is saturating in practice,
- how long cron runs are taking,
- whether errored runs are specifically timing out.

That made future scheduler tuning speculative instead of evidence-based.

## Current state

Observed after `OPT06.2`:

- `src/bun/runtime-stats.ts` includes a `cron` bucket in both `RuntimeStatsSnapshot` and `RuntimeStatsSummary`.
- The cron bucket records only numeric low-cardinality counters and aggregates, matching the original runtime-stats design constraints.
- `src/bun/sidecar-cron-runner.ts` records queue pressure and terminal outcomes at the actual execution boundary introduced by `OPT06.1`.
- The existing diagnostics path now automatically carries cron telemetry through `buildRuntimeDiagnosticsSnapshot(...)`, including `/health/runtime-stats`, `/health/runtime-stats/reset`, overload diagnostics, and starvation-harness snapshots.
- `src/bun/runtime-stats-sidecar.ts` persists the cron snapshot fields into the optional telemetry sidecar database when telemetry tracking is enabled.
- `src/bun/starvation-harness.ts` prints cron telemetry in the runtime summary so scheduler pressure is visible in normal benchmark output.

Related pages:

- [cron-concurrency-cap](./cron-concurrency-cap.md)
- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)

## Design and analysis

### Cron telemetry model

Observed cron fields recorded in runtime stats:

- `activeRuns`
- `peakActiveRuns`
- `pendingRuns`
- `peakPendingRuns`
- `saturationEvents`
- `startedRuns`
- `completedRuns`
- `stoppedRuns`
- `erroredRuns`
- `timedOutRuns`
- `lastDurationMs`
- `peakDurationMs`
- `totalDurationMs`

Recommended durable interpretation: cron observability should stay inside the shared runtime-stats collector unless the repository later adopts a broader metrics architecture. The important design constraint is not the exact field set but the boundary: keep the collector low-cardinality, process-local, and easy to reset during focused measurement windows.

### Collector helpers and ownership

Observed helper additions in `src/bun/runtime-stats.ts`:

- `recordCronRunQueued(...)`
- `recordCronPendingRuns(...)`
- `recordCronRunStarted(...)`
- `recordCronRunFinished(...)`

Observed rationale: the cron runner should report telemetry through narrow helpers rather than owning counter arithmetic inline. That keeps the execution path simpler and makes the collector directly unit-testable.

### Queue-pressure visibility

Observed behavior at the scheduler limiter boundary:

- when a scheduler-fired run must wait, `pendingRuns` increases,
- `peakPendingRuns` can rise,
- `saturationEvents` increments,
- when queued work begins, pending counts drop,
- when execution begins, active counts rise,
- when execution ends, active counts drop and the terminal-outcome counters update.

Recommended durable interpretation: the scheduler limiter is not just a guardrail; it is also the canonical place to measure burst pressure. Future scheduler decisions should prefer these counters over ad hoc log inspection.

### Timeout semantics

Observed durable rule: a timed-out cron run still preserves the existing main database status contract by being stored as `Errored`, but runtime telemetry also increments `timedOutRuns`.

This separates two concerns cleanly:

- persistent cron run history keeps its existing app-facing status model,
- runtime diagnostics distinguish timeout pressure from other execution failures.

### Sidecar telemetry persistence

Observed in `src/bun/runtime-stats-sidecar.ts`: when `--track-telemetry` is enabled, snapshot rows now include additive cron columns for active, pending, saturation, outcome, and duration totals.

Recommended durable interpretation: the sidecar database is a historical sink for snapshot totals, not a replacement for the main cron run-history schema.

## Measured notes

Observed from the source document's focused scheduler-burst scenario:

- `3` due cron jobs
- scheduled-launch concurrency cap `= 2`
- resulting summary after completion:
  - `startedRuns: 3`
  - `completedRuns: 3`
  - `peakActiveRuns: 2`
  - `peakPendingRuns: 1`
  - `saturationEvents: 1`
  - final `activeRuns: 0`
  - final `pendingRuns: 0`

Observed implication: the limiter behavior is now measurable directly in runtime diagnostics instead of being inferred from test structure.

## Validation

Observed validation named by the source document:

- `bun run format`
- `bun run validate`
- focused cron-runner saturation integration coverage
- runtime-stats unit coverage for timeout accounting

Observed expanded test surfaces:

- `src/bun/runtime-stats.test.ts`
- `src/bun/sidecar-cron-runner.test.ts`
- `src/bun/runtime-stats-sidecar.test.ts`
- `src/bun/starvation-harness.test.ts`

## Non-goals and boundaries

Observed scope limits for `OPT06.2`:

- no persistent cron queue,
- no UI cron-status redesign,
- no change to main cron DB run-history semantics,
- no new metrics service,
- no new RPC surface dedicated only to cron telemetry.

Recommended durable interpretation: deeper scheduling or persistence work should be justified by telemetry collected through this slice rather than bundled into the observability change itself.

## Source

Primary ingested source:

- `docs/2026-04-11-opt06-2-cron-duration-saturation-telemetry.md`

Planning references named by the source:

- `./raw/optimization-proposals.md`
- `./optimization-execution-proposal.md`
- `./cron-concurrency-cap.md`
- `./track-telemetry-sidecar-db.md`
