# SQLite Retry Metrics

## Summary

This page captures the durable design and completion outcome for optimization slice `OPT02.3`, completed on 2026-04-11. The repository did not need a new SQLite retry-metrics subsystem in this slice because the essential counters had already landed during the earlier runtime-stats work.

Observed outcome as of 2026-04-11:

- `src/bun/project-procedures.ts` already counted SQLite retry loops and exhausted retry loops inside `withSqliteRetry()`
- `src/bun/runtime-stats.ts` already exposed shared SQLite retry counters through the runtime stats collector
- `src/bun/index.ts` already surfaced those counters through the runtime-stats health endpoints
- later SQLite planning and benchmark docs already used the recorded retry numbers to avoid speculative follow-on DB work
- `src/bun/runtime-stats.test.ts` was tightened so the SQLite retry counters are asserted in both the full snapshot and summarized runtime-stats views

Related pages:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)

## Problem

The optimization plan wanted explicit evidence about SQLite lock pressure before authorizing deeper database work. The required durable capabilities were:

- count SQLite lock retries
- count retry exhaustion
- surface those counters through the shared runtime-stats path
- use the observed numbers to decide whether more aggressive DB tuning was justified

The source document's main conclusion is unusual but important: by the time `OPT02.3` was closed, those capabilities already existed. The remaining work was to verify the implementation, document the evidence, and close the backlog slice honestly.

## Current state before the completion pass

Observed from the source completion record:

- retry accounting already lived in `withSqliteRetry()` in `src/bun/project-procedures.ts`
- the shared runtime stats collector already tracked SQLite retry totals in `src/bun/runtime-stats.ts`
- `src/bun/index.ts` already exposed runtime-stats diagnostics through `GET /health/runtime-stats` and `POST /health/runtime-stats/reset`
- the OPT01 baseline benchmark had already recorded zero SQLite retry pressure in the representative run
- `OPT02.1` had already used those zero-retry results to keep WAL-mode tuning narrow and avoid speculative extra database work

Durable implication: the repository already had the right measurement boundary. `OPT02.3` existed mainly as a bookkeeping and verification gap.

## Existing implementation that satisfies the slice

### Retry-loop accounting in `withSqliteRetry()`

Observed behavior preserved from the source:

- when an operation succeeds after one or more retries, the runtime records:
  - `retryCount`
  - `totalBackoffMs`
  - `exhausted: false`
- when the lock-retry loop exhausts, the runtime records:
  - `retryCount`
  - `totalBackoffMs`
  - `exhausted: true`

Durable rule: SQLite retry accounting should remain centralized at the retry helper that already owns retry counting, backoff timing, and exhaustion decisions.

### Shared runtime-stats counters

Observed counters named by the source:

- `loopsWithRetry`
- `totalRetries`
- `exhaustedLoops`
- `peakRetryCount`
- `totalBackoffMs`

These live under the shared runtime stats collector, so SQLite retry evidence stays aligned with the rest of the optimization telemetry instead of becoming a separate one-off diagnostics path.

### External diagnostics surface

Observed diagnostics path preserved from the source:

- `GET /health/runtime-stats`
- `POST /health/runtime-stats/reset`

Those responses already include both:

- full `runtimeStats`
- summarized `runtimeStatsSummary`

Durable rule: SQLite retry metrics should be available through the same resettable runtime-stats surface used by the benchmark and optimization workflow.

## How the metrics were used

The source explicitly treats this as part of the deliverable, not just an implementation detail.

Observed evidence:

- the baseline benchmark page recorded zero retry loops, zero total retries, and zero exhausted loops in the representative run
- the WAL-mode tuning page used those measurements to argue for a low-risk concurrency default rather than broader speculative database tuning

Durable takeaway: retry metrics are valuable only if they influence scope decisions. In this repository, they already did.

## Completion hardening

The completion pass added one small but durable verification improvement:

- `src/bun/runtime-stats.test.ts` now asserts that SQLite retry counters appear in both the full runtime-stats snapshot and the summarized runtime-stats view

This matters because the slice contract was about surfaced metrics, not just hidden internal counters.

## Why no new subsystem was added

The source makes a durable process point worth preserving:

- do not invent new architecture just to make a backlog item look active
- if the required behavior already exists, verify it, document it, add any missing regression coverage, and close the slice

Recommended interpretation: Metidos should keep the optimization backlog measurement-led and honest. A completion pass may legitimately be documentation and verification work when earlier slices already delivered the runtime behavior.

## Affected repository areas

The source named these surfaces as relevant to the slice outcome:

- `src/bun/project-procedures.ts`
- `src/bun/runtime-stats.ts`
- `src/bun/index.ts`
- `src/bun/runtime-stats.test.ts`
- `agents-todo.md`

## Validation

Observed validation recorded by the source:

- `bun run format`
- `bun run validate`

## Durable takeaway

The durable lesson from `OPT02.3` is that SQLite retry measurement should stay centralized in the retry helper and shared runtime-stats pipeline, and that those metrics should be used to constrain follow-on DB work rather than justify speculative tuning when observed retry pressure is absent.

## Source

Ingested from `docs/2026-04-11-opt02-3-sqlite-retry-metrics.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
