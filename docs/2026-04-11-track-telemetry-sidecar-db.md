# 2026-04-11 Track Telemetry Sidecar Database

## Summary

This change adds an optional runtime flag:

- `--track-telemetry`

When enabled, Metidos now persists the existing process-local runtime diagnostics into a **separate SQLite sidecar database** instead of writing telemetry into the main application database.

The sidecar sink is intentionally designed around the existing in-memory `runtime-stats.ts` collector:

- request and websocket hot paths still update only cheap in-memory counters,
- the server periodically snapshots those counters,
- snapshots are buffered in memory,
- buffered snapshots are flushed to the sidecar SQLite database in **batched transactions**.

This keeps telemetry persistence available when operators want historical data, while avoiding the much riskier design of writing measurement events directly into the same SQLite database that the application is already using for core state.

## Why a separate sink was chosen

Before this change, Metidos already had useful runtime measurement, but it was:

- process-local,
- resettable,
- visible through `/health/runtime-stats`,
- usable by the starvation harness,
- **not persisted across restarts**.

Persisting those stats directly into the main app database would have been a bad default for a few reasons:

1. it would add more write traffic to the main DB,
2. it would risk contaminating the very SQLite contention measurements we care about,
3. it would couple operational telemetry retention with user data persistence,
4. it would make destructive reset flows and retention policy harder to reason about.

The new sidecar DB avoids those problems by isolating the telemetry sink behind:

- an explicit opt-in flag, and
- a physically separate SQLite file.

## Runtime behavior

## Enabling the sink

Start the Bun server with:

```bash
bun run src/bun/index.ts --track-telemetry
```

or with the usual wrapper scripts:

```bash
bun run start -- --track-telemetry
```

When enabled, startup logs now include a message showing that the runtime telemetry sidecar is active.

## Database location

The sidecar database is stored in the normal app-data directory next to the main app DB.

Current filename:

- `runtime-stats.db`

So if `METIDOS_APP_DATA_DIR` points at `/some/app-data`, the telemetry DB will be:

- `/some/app-data/runtime-stats.db`

This file gets the same owner-only permission treatment as the main SQLite database where the platform supports it.

## Sampling and batching policy

The sidecar does **not** write on every RPC or websocket event.

Instead it:

1. keeps using the existing in-memory `runtime-stats.ts` collector,
2. builds a runtime diagnostics snapshot periodically,
3. buffers those snapshots in memory,
4. writes the buffered snapshots in one SQLite transaction.

### Default cadence

- sample interval: `15s`
- flush interval: `60s`
- batch target: `4` snapshots

That means the common path is:

- collect four snapshots over one minute,
- flush them together in one transaction.

The sidecar also captures:

- an initial startup snapshot (buffered), and
- a final shutdown snapshot before close.

Any buffered snapshots are flushed during shutdown so normal exits do not lose the last batch.

## What gets stored

The sidecar stores both:

1. **coarse snapshot totals**, and
2. **per-key detail rows** for low-cardinality maps.

## Snapshot table

Table:

- `runtime_stats_snapshots`

Each row stores:

- collection timestamp,
- process start timestamp,
- runtime-stats collector start timestamp,
- memory usage snapshot,
- RPC totals,
- websocket push totals,
- SQLite retry totals,
- git-history and commit-diff cache totals.

Two timestamps are important:

- `process_started_at`: when this Metidos server process enabled the sink,
- `collector_started_at`: the `runtime-stats.ts` start/reset boundary.

That separation matters because `/health/runtime-stats/reset` can intentionally reset the in-memory collector without restarting the full process.

## Per-RPC-method table

Table:

- `runtime_stats_rpc_method_snapshots`

Each row stores one method’s counters for one snapshot:

- `calls`
- `succeeded`
- `failed`
- `timed_out`
- `canceled`
- `request_bytes`
- `response_bytes`
- `last_duration_ms`
- `peak_duration_ms`
- `total_duration_ms`

This preserves the same low-cardinality method breakdown already kept in memory.

## Per-websocket-push-type table

Table:

- `runtime_stats_websocket_push_snapshots`

Each row stores one websocket push type’s counters for one snapshot:

- `messages`
- `payload_bytes`
- `delivered_clients`
- `dropped_clients`

Again, this follows the same low-cardinality structure as the in-memory collector.

## Implementation notes

## Shared runtime snapshot builder

`src/bun/runtime-stats.ts` now exports the shared runtime diagnostics snapshot builder used by:

- `/health/runtime-stats`
- `/health/runtime-stats/reset`
- the starvation harness
- the new SQLite sidecar sink

That keeps the live diagnostics path and the persisted telemetry path aligned on one snapshot shape.

## New sidecar module

New file:

- `src/bun/runtime-stats-sidecar.ts`

Responsibilities:

- resolve the telemetry DB path,
- migrate/create sidecar tables,
- buffer snapshots,
- flush buffered snapshots in transactions,
- close cleanly on shutdown,
- expose sidecar DB deletion helpers for reset flows.

## Server integration

`src/bun/index.ts` now:

- recognizes `--track-telemetry`,
- starts the sidecar sink during bootstrap,
- flushes and closes the sink during coordinated shutdown,
- includes the sidecar DB in `--wipe-user-data` deletion.

## Local reset integration

`src/bun/dev-flows.ts` now removes the sidecar DB too when dev reset is requested.

That keeps:

- `METIDOS_DEV_RESET=1`, and
- `--wipe-user-data`

consistent with the new persisted telemetry file.

## Why batched snapshots instead of event inserts

This was an intentional design choice.

The app already records hot-path counters in memory. Persisting those counters by periodic snapshot has important advantages:

- no per-request telemetry DB writes,
- no extra contention added to the main app database,
- no need for high-cardinality event rows,
- lower write amplification,
- simpler retention strategy later if we want pruning.

It is also easier to reason about historically:

- every snapshot is a checkpoint of cumulative counters,
- rate/delta analysis can be derived later by comparing successive rows.

## Validation added

New tests in:

- `src/bun/runtime-stats-sidecar.test.ts`

These verify that the sidecar:

- buffers snapshots before writing,
- flushes a full batch together,
- writes snapshot rows plus RPC detail rows,
- flushes the final buffered batch during close,
- exposes deletion helpers that remove the sidecar DB.

Existing dev-reset coverage in:

- `src/bun/dev-flows.test.ts`

was also expanded so reset flows now verify that telemetry sidecar files are deleted together with the main DB and auth secret.

## Operational caveats

This is still an **opt-in** sink.

That is deliberate because persistence always adds some background cost even when batched.

The current implementation is appropriate for:

- local profiling,
- controlled benchmark runs,
- operator troubleshooting,
- temporary perf-regression investigations.

It is not intended to turn the main app database into a permanent high-volume observability store.

## Future extension ideas

If later needed, the sidecar could grow carefully in one of these directions:

- explicit retention pruning,
- a small read-only CLI for snapshot inspection,
- derived rollup tables for minute/hour windows,
- export of selected snapshot summaries to JSON.

But none of those were required for the initial feature.

## Files changed

- `src/bun/runtime-stats.ts`
- `src/bun/runtime-stats-sidecar.ts`
- `src/bun/runtime-stats-sidecar.test.ts`
- `src/bun/index.ts`
- `src/bun/dev-flows.ts`
- `src/bun/dev-flows.test.ts`
- `src/bun/README.md`
- `README.md`

## Validation

- `bun test src/bun/runtime-stats-sidecar.test.ts src/bun/dev-flows.test.ts`
- full repository validation should still run through `bun run validate`
