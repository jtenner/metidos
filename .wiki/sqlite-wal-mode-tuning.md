# SQLite WAL-Mode Tuning

## Summary

This page captures the durable design and implementation outcome for optimization slice `OPT02.1`, completed on 2026-04-11. Metidos now uses a shared SQLite runtime pragma helper that enables `journal_mode = WAL` and `synchronous = NORMAL` for the main app database and the cron-sidecar database handles.

Observed outcome as of 2026-04-11:

- `src/bun/db.ts` exports shared app-database pragma settings and a helper to apply them
- `initAppDatabase()` uses the shared helper instead of hand-applying only `foreign_keys` and `busy_timeout`
- cron database opens in `src/bun/sidecar-cron-runner.ts` and `src/bun/sidecar-cron-thread.ts` use the same runtime expectations
- `src/bun/db.test.ts` covers the pragma helper and validates real WAL behavior in a focused child-process test
- `src/bun/README.md` documents the shared WAL-mode runtime expectation

Related pages:

- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- [runtime-stats-collector](./runtime-stats-collector.md)
- [sqlite-retry-metrics](./sqlite-retry-metrics.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)

## Problem

The OPT01 measurement work did not show active SQLite retry pressure in the baseline benchmark, but Metidos still used a multi-connection SQLite architecture:

- the main app process opens the app database through `initAppDatabase()`
- cron execution opens separate handles in `src/bun/sidecar-cron-runner.ts`
- the cron scheduler worker opens its own handle in `src/bun/sidecar-cron-thread.ts`

That architecture creates a durable concurrency requirement even when retries are not yet visible in coarse benchmark output: independent reader and writer connections should interfere as little as possible.

## Current state before the slice

Observed from the source design record:

- the baseline benchmark recorded zero SQLite retry loops, zero total retries, and zero exhausted retry loops
- the repository had not yet demonstrated a broad database-contention bottleneck
- the runtime still used multiple SQLite connections across app and cron paths
- the repo already handled `-wal` and `-shm` cleanup during resets, so WAL did not require a schema redesign or a new operational model

Durable planning implication: the next SQLite slice should favor a low-risk concurrency improvement over speculative tuning.

## Chosen design

Recommended and implemented outcome from the source:

- add shared database runtime constants in `src/bun/db.ts`
  - `APP_DATABASE_JOURNAL_MODE = "wal"`
  - `APP_DATABASE_SYNCHRONOUS = "NORMAL"`
  - `SQL_BUSY_TIMEOUT_MS`
- add `applyAppDatabasePragmas(database, options?)` to centralize app-database runtime settings
- have the helper apply:
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA busy_timeout = ...` when requested
  - `PRAGMA journal_mode = WAL`
  - `PRAGMA synchronous = NORMAL`
- reuse the same helper for the main app DB open and the cron-sidecar DB opens

This preserves one durable rule: app and cron SQLite handles should share the same core runtime pragma expectations instead of drifting by call site.

## Why the change stayed narrow

The source document explicitly rejected more aggressive database tuning for this slice.

Not adopted in `OPT02.1`:

- `PRAGMA cache_size`
- `PRAGMA mmap_size`
- read-query caches
- index changes
- transaction-structure rewrites
- optimistic locking or version columns
- new runtime configuration flags

Durable rationale:

- the OPT01 baseline did not show a measured broad SQLite bottleneck
- WAL is a standard low-risk concurrency default for multi-connection SQLite usage
- speculative tuning should wait for measured evidence, such as query-plan problems or sustained retry pressure

## Validation and benchmark evidence

Observed validation recorded by the source:

- `bun run format`
- `bun run validate`

The source also preserved a focused correctness and benchmark strategy:

### Test coverage

- in-process DB tests verify continued use of the shared busy-timeout and pragma helper without forcing the whole `bun:test` process into WAL mode
- a focused child-process test confirms the real runtime helper produces WAL mode and allows a writer to commit while another connection holds a read transaction

Durable note: this split exists because Bun 1.3.12 was observed to crash at `bun:test` process teardown after large suites opened many WAL-mode handles, so WAL validation moved into a child process without changing production runtime behavior.

### Focused concurrency benchmark

The benchmark shape was intentionally narrow:

- one reader connection holds a read transaction open
- one writer connection attempts repeated `BEGIN IMMEDIATE` / `UPDATE` / `COMMIT` cycles
- both modes use the same busy timeout
- elapsed time is measured while the reader transaction remains open

Representative result recorded in the source:

| Mode | Committed writes | Failed writes | Elapsed while reader held open |
|---|---:|---:|---:|
| `DELETE` + `FULL` | `0` | `50` | `125,139 ms` |
| `WAL` + `NORMAL` | `50` | `0` | `0.46 ms` |

Durable interpretation: rollback-journal mode behaves badly under the long-reader-plus-writer pattern that Metidos's multi-connection architecture can produce, while WAL mode preserves the expected concurrency boundary.

## Affected repository areas

The source named these implementation surfaces:

- `src/bun/db.ts`
- `src/bun/sidecar-cron-runner.ts`
- `src/bun/sidecar-cron-thread.ts`
- `src/bun/db.test.ts`
- `src/bun/README.md`

## Durable takeaway

The durable lesson from `OPT02.1` is architectural restraint with a justified runtime default: Metidos should use WAL plus `synchronous = NORMAL` across its shared app and cron SQLite opens because the repository already has a multi-connection design, but broader SQLite tuning should wait for measured evidence instead of being bundled into the same slice.

## Source

Ingested from `docs/2026-04-11-opt02-1-wal-mode-tuning.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
