# 2026-04-11 OPT02.1 Conservative WAL-Mode Tuning

**Status:** completed on 2026-04-11  
**Slice:** [OPT02.1](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt01-3-baseline-benchmark.md](./2026-04-11-opt01-3-baseline-benchmark.md)

## Summary

This slice implements the **narrow** SQLite runtime tuning that still looked justified after the OPT01 measurement work:

- enable **WAL** journal mode for the main app database,
- pair it with **`synchronous = NORMAL`**,
- apply the same runtime expectations to the cron sidecar database opens,
- validate the change with both correctness tests and a focused concurrency benchmark.

Just as importantly, this slice intentionally does **not** do more than that.

## Why the change was limited to WAL + NORMAL

The earlier planning documents proposed several possible database optimizations. The OPT01 baseline changed how aggressive this slice should be.

### What the baseline said

From [docs/2026-04-11-opt01-3-baseline-benchmark.md](./2026-04-11-opt01-3-baseline-benchmark.md):

- SQLite retry totals were:
  - **loops with retry:** `0`
  - **total retries:** `0`
  - **exhausted retry loops:** `0`
- No broad DB contention problem was visible in the baseline harness run.

That meant this slice should **not** immediately jump to:
- speculative cache-size tuning,
- read-query caches,
- index additions,
- transaction rewrites.

### Why WAL still made sense

Even though the baseline did not show active SQLite retries, Metidos still has a **multi-connection SQLite architecture**:

- the main app process opens the app database via `initAppDatabase()`
- cron execution opens separate handles in `sidecar-cron-runner.ts`
- the cron scheduler worker opens its own handle in `sidecar-cron-thread.ts`

That is exactly the shape where WAL is a good low-risk runtime default:
- it improves reader/writer concurrency,
- it is a standard SQLite runtime mode,
- the repo already deletes `-wal` and `-shm` files during resets,
- it can be rolled out without changing the logical schema.

So this slice implements only the **low-risk concurrency improvement** and leaves the more speculative DB work for later slices that can point to actual bottlenecks.

## What changed

### 1. Added shared database pragma configuration

`src/bun/db.ts` now exports:

- `APP_DATABASE_JOURNAL_MODE = "wal"`
- `APP_DATABASE_SYNCHRONOUS = "NORMAL"`
- `SQL_BUSY_TIMEOUT_MS`
- `applyAppDatabasePragmas(database, options?)`

That helper applies:
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = ...` when requested
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`

### 2. Main app database now uses the shared helper

`initAppDatabase()` now uses `applyAppDatabasePragmas(...)` instead of manually setting only:
- `foreign_keys`
- `busy_timeout`

### 3. Cron runner database opens now use the same runtime settings

`src/bun/sidecar-cron-runner.ts` now applies the shared app-database pragmas when it opens a handle.

### 4. Cron scheduler worker database opens now use the same runtime settings

`src/bun/sidecar-cron-thread.ts` now applies the same shared pragmas when the scheduler thread opens the DB.

### 5. Added DB correctness coverage for the new runtime mode

`src/bun/db.test.ts` now verifies two things:

- the main `bun:test` process keeps using the shared busy-timeout and pragma helper without switching the entire test suite onto WAL mode,
- a focused child-process validation still confirms that the real runtime helper produces WAL mode and allows a writer to commit while another connection holds a read transaction.

This split exists because Bun 1.3.12 currently crashes at `bun:test` process teardown after large suites open many WAL-mode handles. The production runtime still uses WAL; the in-process test harness does not.

### 6. Documented the runtime expectation

`src/bun/README.md` now mentions that:
- `db.ts` applies shared WAL-mode runtime pragmas,
- cron-sidecar DB opens participate in the same concurrency expectations.

## Focused performance validation

This slice includes both **in-repo validation** and a **targeted concurrency benchmark**.

## In-repo validation

### Correctness tests

The following repo validations were run after the change:

- `bun run format`
- `bun run validate`

That includes:
- typecheck
- unit/integration tests
- DB tests
- cron runner tests

### New DB concurrency test

A focused DB test now validates the WAL behavior in a dedicated child process:
- one connection keeps a read transaction open,
- another connection still commits a write,
- the child process confirms the WAL journal mode and `synchronous = NORMAL` runtime settings.

This avoids the current Bun test-runner teardown crash while still validating the actual runtime configuration.

## Targeted concurrency benchmark

Because the instruction for this work was to include **some level of performance testing and validation** for each proposed change, this slice also used an explicit local benchmark to compare:

- rollback-journal mode (`DELETE` + `FULL`)
- Metidos’s chosen runtime configuration (`WAL` + `NORMAL`)

### Benchmark shape

This was a deliberately narrow two-connection benchmark:

- one reader connection opens a read transaction and keeps it open,
- one writer connection attempts 50 `BEGIN IMMEDIATE` / `UPDATE` / `COMMIT` cycles,
- both modes use the same busy-timeout,
- the benchmark measures elapsed time while the read transaction is held open.

### Why this benchmark shape matters

It is **not** meant to mimic all app traffic.

It is meant to validate the specific architectural reason for enabling WAL in Metidos:

> separate app and cron-sidecar connections should not interfere unnecessarily when one side is reading and the other side is writing.

### Benchmark result

Representative local result:

| Mode | Committed writes | Failed writes | Elapsed while reader held open |
|---|---:|---:|---:|
| `DELETE` + `FULL` | `0` | `50` | `125,139 ms` |
| `WAL` + `NORMAL` | `50` | `0` | `0.46 ms` |

### Interpretation

This result is intentionally stress-oriented, but it validates the core point:

- rollback-journal mode collapses badly under the long-reader + writer pattern,
- WAL mode behaves the way Metidos’s architecture wants separate connections to behave.

That is enough evidence to justify the change **without** also justifying unrelated DB tuning work.

## What this slice explicitly did not change

To stay aligned with the “do not optimize non-bottlenecks” instruction, this slice did **not** add:

- `PRAGMA cache_size`
- `PRAGMA mmap_size`
- read-query caches
- index changes
- transaction-structure rewrites
- optimistic locking or version columns
- any new runtime config flags

Those would have been premature here.

## Files changed by the slice

- [src/bun/db.ts](../src/bun/db.ts)
- [src/bun/sidecar-cron-runner.ts](../src/bun/sidecar-cron-runner.ts)
- [src/bun/sidecar-cron-thread.ts](../src/bun/sidecar-cron-thread.ts)
- [src/bun/db.test.ts](../src/bun/db.test.ts)
- [src/bun/README.md](../src/bun/README.md)

## Completion note

This slice is now done.

It establishes the low-risk SQLite runtime tuning that was still justified after the OPT01 measurement work, and it does so with:

- correctness validation,
- sidecar consistency,
- a focused concurrency benchmark,
- and explicit restraint against speculative DB optimization.

That means the next database slice can move on to **measured query-plan work** rather than piling more runtime tweaks onto SQLite without evidence.
