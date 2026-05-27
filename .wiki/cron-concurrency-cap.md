# Cron Concurrency Cap

## Summary

Observed in `OPT06.1` on 2026-04-11: Metidos now applies a shared concurrency cap of `2` to **scheduler-fired** cron launches in `src/bun/sidecar-cron-runner.ts`. This is a guardrail against bursty schedule fires creating too many simultaneous child-thread launches. Manual `runCronJobById()` remains a direct path and does not go through the scheduler limiter.

## Problem

Before this slice, `runDueCronJobs(...)` claimed every due job for a given scheduler fire and launched them from that invocation, but overlapping scheduler fires could still collectively create more concurrent launches than intended.

Observed risk areas from the source document:

- bursty cron schedules could amplify CPU and memory pressure,
- multiple child-thread launches could increase model-runtime contention,
- overlapping work could add SQLite pressure,
- there was no explicit shared scheduler-level cap to make saturation behavior measurable.

## Current state

Observed after `OPT06.1`:

- `src/bun/sidecar-cron-runner.ts` owns a module-level shared limiter for scheduler-fired launches.
- The limiter reuses `createAsyncConcurrencyLimit(...)` from `src/bun/project-procedures/shared.ts`.
- The fixed `maxConcurrent` value is `2`.
- `runDueCronJobs(...)` claims due cron rows, closes the claim-time DB handle, then queues each claimed job through the shared limiter.
- Each queued `executeCronJob(...)` launch opens and closes its own SQLite handle for the actual launch work.
- `runCronJobById()` uses the refactored per-job execution helper but intentionally bypasses the shared scheduled-launch limiter.
- `getScheduledCronExecutionLimitStats()` exposes limiter state as `activeCount`, `pendingCount`, and `maxConcurrent`.

Related pages:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md)

## Design and analysis

### Limiter boundary

Observed design choice: the concurrency boundary applies only to **scheduler-fired** cron execution. That keeps the slice small and prevents a scheduler burst from turning into unbounded parallel child-thread creation.

Recommended durable interpretation: treat the limiter as the canonical scheduler guardrail unless a later queueing architecture replaces it with a more explicit persistent scheduling system.

### DB-handle ownership

Observed design choice: per-job execution now opens its own SQLite handle rather than holding the claim-time handle open while waiting in the limiter queue.

This preserves a clean boundary:

1. claim due work,
2. release the claim-time DB connection,
3. queue launch work,
4. open a fresh handle only when launch execution begins.

Recommended durable interpretation: queued cron launch work should avoid holding long-lived claim-time database resources across wait time.

### Manual run behavior

Observed design choice: manual run-now remains direct and predictable rather than being absorbed into the scheduler queue.

This preserves the operator-facing contract that a direct `runCronJobById()` call returns the created thread id without scheduler-queue semantics.

### Saturation visibility

Observed design choice: the limiter exports explicit stats for tests and later telemetry work.

Inferred rationale: later telemetry slices can report real queue saturation from the limiter itself rather than approximating scheduler pressure indirectly.

## Validation

Observed validation from the source document:

- `bun test src/bun/sidecar-cron-runner.test.ts`
- `bun run format`
- `bun run validate`

Observed test coverage added in `src/bun/sidecar-cron-runner.test.ts`:

- manual `runCronJobById()` integration still works,
- scheduled `runDueCronJobs()` integration still works,
- queue-pressure behavior is explicit and testable.

Observed queue-pressure scenario:

- `3` due cron jobs,
- scheduled-launch cap = `2`,
- saturation state reached `activeCount = 2`, `pendingCount = 1`,
- releasing one launch allowed the queued third launch to begin,
- limiter state eventually drained back to zero,
- each cron row still received a run-history row.

## Non-goals and follow-up boundaries

Observed non-goals for `OPT06.1`:

- no persistent DB-backed cron queue,
- no cron status UX redesign,
- no full duration/saturation telemetry yet,
- no redesign of manual `runCronJobById()` into a queued abstraction.

Related follow-up source noted by the document:

- `OPT06.2` should attach duration and saturation telemetry to the limiter boundary.

That follow-up has since been ingested as [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md).

## Source

Primary ingested source:

- `./cron-concurrency-cap.md`

Planning references named by the source:

- `./raw/optimization-proposals.md`
- `./optimization-execution-proposal.md`
- `./track-telemetry-sidecar-db.md`
