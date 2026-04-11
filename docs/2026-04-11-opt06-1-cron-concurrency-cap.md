# 2026-04-11 OPT06.1 Cron Concurrency Cap

**Status:** completed on 2026-04-11  
**Slice:** [OPT06.1](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-track-telemetry-sidecar-db.md](./2026-04-11-track-telemetry-sidecar-db.md)

## Summary

`OPT06.1` adds a bounded launch cap for **scheduler-fired** cron executions.

Before this slice, `runDueCronJobs(...)` claimed every due job for a schedule fire and launched them one by one inside that invocation, but there was no shared scheduler-level cap across overlapping fires. If many enabled jobs became due close together, multiple `runDueCronJobs(...)` calls could still overlap and collectively create more child-thread launches than intended.

This slice introduces a shared concurrency limiter for scheduled cron launches using the existing `createAsyncConcurrencyLimit(...)` primitive that already exists in `src/bun/project-procedures/shared.ts`.

## Scope

Per the execution plan, this slice needed to:

- add a bounded concurrency limit for cron-executed thread launches,
- preserve current success/failure semantics,
- make saturation behavior explicit and testable.

This slice intentionally does **not**:

- build a persistent DB-backed cron queue,
- redesign cron status UX,
- add full cron duration/saturation telemetry yet,
- change the manual `runCronJobById()` path into a queued scheduler abstraction.

Those are later concerns.

## What changed

## 1. Added a shared scheduled-cron launch limiter

Updated file:

- [src/bun/sidecar-cron-runner.ts](../src/bun/sidecar-cron-runner.ts)

A module-level limiter now caps scheduler-fired launches at a conservative fixed concurrency of `2`.

That means:

- due cron jobs can still make forward progress in parallel,
- but scheduler bursts no longer fan out into an unbounded number of simultaneous child-thread launches.

The implementation reuses:

- `createAsyncConcurrencyLimit(...)`

from:

- [src/bun/project-procedures/shared.ts](../src/bun/project-procedures/shared.ts)

which keeps the slice aligned with the execution plan’s instruction to reuse existing limiter primitives instead of inventing a new scheduler abstraction.

## 2. Moved per-job execution onto dedicated DB handles

`executeCronJob(...)` now opens and closes its own SQLite handle for the actual launch work.

This keeps the launch callback self-contained when it is run under the limiter and avoids holding the claim-time DB handle open across queued wait time.

The flow is now:

1. `runDueCronJobs(...)` claims due rows,
2. closes the claim handle,
3. queues each claimed job through the shared limiter,
4. each queued launch opens its own DB handle,
5. launch completes and the async monitor continues as before.

## 3. Kept manual run-now behavior direct

`runCronJobById(...)` still behaves as a direct path.

It now uses the same refactored per-job execution helper, but it does **not** go through the new scheduled-launch limiter.

That was intentional because this slice is about scheduler burst guardrails, while the execution plan specifically warned to keep manual run behavior predictable.

## 4. Exposed limiter stats for tests and later telemetry

New helper exported from `src/bun/sidecar-cron-runner.ts`:

- `getScheduledCronExecutionLimitStats()`

This returns:

- `activeCount`
- `pendingCount`
- `maxConcurrent`

That makes the queue state explicit and testable now, and gives `OPT06.2` a clean starting point for future diagnostics work.

## Validation behavior preserved

This slice keeps the previous cron semantics intact where it matters:

- claimed cron rows are still marked `InProgress` immediately,
- cron run rows are still created when launch begins,
- completion/stop/error state still flows through the same monitor path,
- real Pi-backed cron execution still uses the same thread runtime path,
- manual `runCronJobById()` still returns the created thread id directly.

## Test coverage added

Updated file:

- [src/bun/sidecar-cron-runner.test.ts](../src/bun/sidecar-cron-runner.test.ts)

The tests now cover three things:

1. existing manual `runCronJobById()` integration still works,
2. existing scheduled `runDueCronJobs()` integration still works,
3. new scheduled concurrency-cap behavior is explicit and testable.

### New queue-pressure test

A focused scheduler test now:

- creates `3` cron rows with the same schedule,
- runs them through `runDueCronJobs(...)` using a controlled fake host,
- holds the first two launches open,
- verifies the limiter reports:
  - `activeCount = 2`
  - `pendingCount = 1`
- releases one launch,
- verifies the queued third launch begins,
- confirms the limiter drains back to zero afterward.

It also verifies that each cron row still gets a run-history row.

## Measured result

The focused queue-pressure test provides a concrete slice-level measurement:

### Scheduler burst scenario

Input:

- `3` due cron jobs in one fire
- scheduled-launch concurrency cap = `2`

Observed limiter state at saturation:

- active launches: `2`
- pending launches: `1`
- peak concurrent launches: `2`

That confirms the intended behavior:

- the scheduler can still launch more than one cron run at a time,
- but the third job waits instead of starting a third child-thread launch immediately.

## Why this slice matters

This is a guardrail slice.

The main goal is not to maximize raw cron throughput yet. It is to stop bursty schedule fires from scaling linearly into simultaneous child-thread launches that can amplify CPU, memory, model-runtime, and SQLite pressure.

By keeping the implementation small and explicit, this slice also sets up the next one:

- `OPT06.2` can now attach duration and saturation telemetry to a concrete limiter boundary instead of guessing about cron pressure abstractly.

## Files changed by the slice

- [src/bun/sidecar-cron-runner.ts](../src/bun/sidecar-cron-runner.ts)
- [src/bun/sidecar-cron-runner.test.ts](../src/bun/sidecar-cron-runner.test.ts)
- [src/bun/README.md](../src/bun/README.md)

## Validation performed

- `bun test src/bun/sidecar-cron-runner.test.ts`
- `bun run format`
- `bun run validate`

## Completion note

`OPT06.1` is complete.

Metidos now applies a bounded scheduler-fired cron launch cap using the shared async limiter primitive, leaves manual run-now behavior direct, and exposes queue-pressure stats so the next cron telemetry slice can build on a stable concurrency boundary.
