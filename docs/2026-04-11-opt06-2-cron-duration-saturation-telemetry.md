# 2026-04-11 OPT06.2 Cron Duration and Saturation Telemetry

**Status:** completed on 2026-04-11  
**Slice:** [OPT06.2](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt06-1-cron-concurrency-cap.md](./2026-04-11-opt06-1-cron-concurrency-cap.md)
- [docs/2026-04-11-track-telemetry-sidecar-db.md](./2026-04-11-track-telemetry-sidecar-db.md)

## Summary

`OPT06.2` adds explicit cron runtime telemetry to the existing diagnostics story.

After `OPT06.1`, Metidos already had a bounded scheduler-fired cron launch cap, but the runtime diagnostics still could not answer some basic operational questions:

- how many cron runs are active right now?
- how much scheduled cron work is waiting in the limiter queue?
- how often do jobs actually saturate that queue?
- how long are cron runs taking?
- how many errored runs were timeouts specifically?

This slice closes that gap by extending the process-local runtime stats collector, wiring the cron runner into those counters, surfacing the data through the existing diagnostics snapshot, and persisting the snapshot fields into the optional telemetry sidecar database.

## Scope

Per the execution plan, this slice needed to:

- record run duration and queue-pressure counters,
- expose them through diagnostics or run records,
- use the data to decide whether deeper scheduler work is warranted.

This slice intentionally does **not**:

- add a new persistent cron queue,
- redesign cron statuses in the UI,
- change cron DB run-history semantics,
- introduce a new metrics service.

The telemetry is deliberately added to the existing `runtime-stats.ts` path instead.

## What changed

## 1. Extended `runtime-stats.ts` with a cron telemetry bucket

Updated files:

- [src/bun/runtime-stats.ts](../src/bun/runtime-stats.ts)
- [src/bun/runtime-stats.test.ts](../src/bun/runtime-stats.test.ts)

New runtime-stats field:

- `cron`

It is now included in both:

- `RuntimeStatsSnapshot`
- `RuntimeStatsSummary`

### Recorded fields

The cron bucket now tracks:

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

That keeps the new telemetry low-cardinality and numeric, matching the original `OPT01.1` runtime-stats design constraints.

### New runtime-stats helpers

Added helpers include:

- `recordCronRunQueued(...)`
- `recordCronPendingRuns(...)`
- `recordCronRunStarted(...)`
- `recordCronRunFinished(...)`

These helpers keep the cron-specific bookkeeping out of the rest of the runtime and make the collector behavior directly testable.

## 2. Wired the cron runner into those counters

Updated file:

- [src/bun/sidecar-cron-runner.ts](../src/bun/sidecar-cron-runner.ts)

The cron runner now records telemetry at the actual execution boundary introduced in `OPT06.1`.

### Scheduled queue pressure

When a scheduler-fired cron launch has to wait behind the limiter:

- `pendingRuns` increases,
- `peakPendingRuns` can rise,
- `saturationEvents` increments.

When the queued launch actually begins:

- the pending count is decremented again.

### Active cron run tracking

When a cron run actually begins executing:

- `activeRuns` increases,
- `peakActiveRuns` can rise,
- `startedRuns` increments.

When the run reaches a terminal outcome:

- `activeRuns` decreases,
- one of `completedRuns`, `stoppedRuns`, or `erroredRuns` increments,
- duration totals are updated.

### Timeout tracking

The cron runner still preserves the existing persisted cron semantics:

- a timed-out run is still stored as `Errored` in the DB.

But now the runtime telemetry also marks that case explicitly by incrementing:

- `timedOutRuns`

That gives operators and future optimization work more precise diagnostics without changing the already-established DB status contract.

## 3. Kept diagnostics exposure on the existing path

No new endpoint was required.

Because `buildRuntimeDiagnosticsSnapshot(...)` already feeds:

- `/health/runtime-stats`
- `/health/runtime-stats/reset`
- overload diagnostics
- the starvation harness
- the optional sidecar telemetry sink

all of those now automatically include the new cron telemetry bucket.

That satisfies the execution plan’s requirement to feed the counters into the same diagnostics story as `OPT01`.

## 4. Extended the optional telemetry sidecar schema

Updated files:

- [src/bun/runtime-stats-sidecar.ts](../src/bun/runtime-stats-sidecar.ts)
- [src/bun/runtime-stats-sidecar.test.ts](../src/bun/runtime-stats-sidecar.test.ts)
- [docs/2026-04-11-track-telemetry-sidecar-db.md](./2026-04-11-track-telemetry-sidecar-db.md)

When `--track-telemetry` is enabled, the sidecar DB now persists the cron snapshot totals too.

Added snapshot columns include:

- `cron_active_runs`
- `cron_peak_active_runs`
- `cron_pending_runs`
- `cron_peak_pending_runs`
- `cron_saturation_events`
- `cron_started_runs`
- `cron_completed_runs`
- `cron_stopped_runs`
- `cron_errored_runs`
- `cron_timed_out_runs`
- `cron_last_duration_ms`
- `cron_peak_duration_ms`
- `cron_total_duration_ms`

The migration path is additive, so existing sidecar DBs can gain the new columns without needing a destructive reset.

## 5. Made the starvation harness print cron telemetry

Updated files:

- [src/bun/starvation-harness.ts](../src/bun/starvation-harness.ts)
- [src/bun/starvation-harness.test.ts](../src/bun/starvation-harness.test.ts)

The runtime summary output now prints a cron line showing:

- active/peak active runs,
- pending/peak pending runs,
- started/completed/stopped/errored/timedOut counts,
- saturation events,
- total and peak duration.

That makes cron-pressure diagnostics visible in the existing benchmark workflow instead of requiring manual JSON inspection.

## Test coverage added or expanded

## Runtime-stats unit coverage

`src/bun/runtime-stats.test.ts` now verifies that the collector correctly tracks:

- queue pressure,
- peak active and pending counts,
- duration totals,
- timeout counts.

## Cron-runner integration coverage

`src/bun/sidecar-cron-runner.test.ts` now verifies that the scheduler-burst scenario records telemetry as expected.

The focused queue-pressure test now checks both:

- limiter stats, and
- `getRuntimeStatsSummary().cron`

after a controlled `3`-job burst.

## Sidecar persistence coverage

`src/bun/runtime-stats-sidecar.test.ts` now verifies that snapshot rows persist the new cron columns too.

## Measured notes

## A. Scheduler burst telemetry

The focused scheduler-burst integration test uses:

- `3` due cron jobs
- scheduled-launch concurrency cap `= 2`

Observed cron summary after completion:

- `startedRuns: 3`
- `completedRuns: 3`
- `peakActiveRuns: 2`
- `peakPendingRuns: 1`
- `saturationEvents: 1`
- final `activeRuns: 0`
- final `pendingRuns: 0`

That confirms the telemetry now makes the limiter behavior measurable instead of implicit.

## B. Timeout accounting remains explicit without changing DB status semantics

The runtime-stats collector coverage now verifies that a timed-out cron run increments:

- `timedOutRuns`

while still counting as an errored terminal outcome.

That distinction is important because it preserves current cron DB semantics but still tells future optimization work whether errors are dominated by genuine failures versus timeout pressure.

## Why this slice matters

`OPT06.1` added the guardrail.

`OPT06.2` makes that guardrail observable.

With both slices complete, future scheduler work can now ask evidence-based questions such as:

- are cron bursts routinely saturating the queue?
- are cron runs timing out often enough to justify deeper scheduling work?
- are active-run peaks high enough to revisit the cap or launch model?

That is a much better position than guessing from occasional logs or isolated failures.

## What stayed intentionally unchanged

To keep this slice narrow, it does **not**:

- add new RPC methods,
- add a new cron status enum,
- persist per-run durations in the main app database,
- redesign the scheduler worker,
- add a separate telemetry service.

## Files changed by the slice

- [src/bun/runtime-stats.ts](../src/bun/runtime-stats.ts)
- [src/bun/runtime-stats.test.ts](../src/bun/runtime-stats.test.ts)
- [src/bun/sidecar-cron-runner.ts](../src/bun/sidecar-cron-runner.ts)
- [src/bun/sidecar-cron-runner.test.ts](../src/bun/sidecar-cron-runner.test.ts)
- [src/bun/runtime-stats-sidecar.ts](../src/bun/runtime-stats-sidecar.ts)
- [src/bun/runtime-stats-sidecar.test.ts](../src/bun/runtime-stats-sidecar.test.ts)
- [src/bun/starvation-harness.ts](../src/bun/starvation-harness.ts)
- [src/bun/starvation-harness.test.ts](../src/bun/starvation-harness.test.ts)
- [src/bun/README.md](../src/bun/README.md)
- [docs/2026-04-11-track-telemetry-sidecar-db.md](./2026-04-11-track-telemetry-sidecar-db.md)

## Validation performed

- `bun run format`
- `bun run validate`
- focused cron-runner saturation integration test
- runtime-stats collector unit coverage for timeout accounting

## Completion note

`OPT06.2` is complete.

Metidos now records cron duration, queue saturation, active/pending counts, and timeout totals through the shared runtime diagnostics path, and the optional telemetry sidecar persists those counters for later inspection when `--track-telemetry` is enabled.
