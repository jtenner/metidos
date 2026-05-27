# Track Telemetry Sidecar Database

## Summary

This page records the durable design for `OPT06.3`-style telemetry persistence work introduced on 2026-04-11: Metidos keeps the always-on runtime telemetry in process-local memory, but adds an **optional sidecar sink** (`--track-telemetry`) that periodically persists snapshot checkpoints into a separate SQLite database.

Observed outcome: the design intentionally avoids writing per-event telemetry into the main application database; instead it writes compact batched checkpoints for later historical analysis and operational troubleshooting.

Related pages:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)

## Problem

After early optimization slices, runtime diagnostics were resettable, low-cardinality, and process-local, but operators still lacked any persisted operational history across restarts.

Persisting raw telemetry events into the main app database was too risky:

- it increases write pressure in the core user-data store,
- it complicates SQLite contention measurement by co-locating observability writes with app writes,
- it conflates telemetry retention policy with user-data retention, and
- it makes reset behavior and retention boundaries harder to reason about.

## Design outcome

Observed in this source doc and downstream slices:

- Runtime collectors remain in-memory and cheap (`src/bun/runtime-stats.ts`).
- `--track-telemetry` is an explicit operator opt-in.
- `src/bun/runtime-stats-sidecar.ts` owns a dedicated sidecar path and DB lifecycle.
- The hot request/websocket/cron/SQLite/cache paths remain unchanged; they only update counters in memory.
- A periodic sampler converts the in-memory snapshot into durable checkpoint rows.

## Runtime behavior

### Opt-in activation and startup integration

When enabled, startup messages indicate telemetry sidecar activation. `src/bun/index.ts`:

- parses `--track-telemetry` from CLI args,
- starts the sidecar sink during bootstrap,
- flushes buffered snapshots and closes the sidecar gracefully during coordinated shutdown,
- includes sidecar DB cleanup in `--wipe-user-data` and developer reset flows.

### File location and ownership

The sidecar file is stored under app-data next to the main DB under the fixed name:

- `runtime-stats.db` (e.g., `/some/app-data/runtime-stats.db` when `METIDOS_APP_DATA_DIR=/some/app-data`).

The sidecar follows the same owner-only permission expectations used by core DB files.

### Sampling and batching model

Observed durable cadence:

- sample interval: `15s`
- flush interval: `60s`
- batch target: `4` snapshots

Inferred behavior from implementation notes:

- snapshots are buffered in memory,
- flushed in batches inside a single transaction,
- first startup snapshot is buffered,
- final shutdown snapshot is included,
- any buffered snapshots are flushed before close.

This keeps runtime hot-path measurement cheap while preserving short-horizon historical checkpoints.

### Stored telemetry shape

The sidecar captures both coarse totals and low-cardinality per-key detail, aligning with the process-local collector:

- `runtime_stats_snapshots`
  - collection timestamp and collector boundaries,
  - memory snapshot,
  - RPC totals,
  - websocket totals,
  - cron active/pending/run-duration/saturation totals,
  - SQLite retry totals,
  - git-history and commit-diff cache totals.
- `runtime_stats_rpc_method_snapshots`
  - per-method counters: calls, succeeded, failed, timed_out, canceled,
  - byte totals: request/response,
  - duration stats: last/peak/total.
- `runtime_stats_websocket_push_snapshots`
  - per-push-type counters: messages, payload bytes,
  - delivered and dropped client counts.

### Why batch snapshots instead of per-event insertions?

Observed rationale:

- no per-request telemetry write amplification,
- no added contention on the application DB,
- low-cardinality aggregate storage,
- easier retention and rollback semantics (future pruning/rollup can run over checkpoints),
- history derivable by diffing consecutive checkpoint totals.

## Validation and implementation coverage

Observed coverage additions:

- `src/bun/runtime-stats-sidecar.test.ts`
- existing `src/bun/dev-flows.test.ts` assertions for sidecar deletion on reset,
- integration surfaces already exercised by `runtime-stats.ts`, `index.ts`, and cron telemetry pages.

Validation command from the source remained: `bun test src/bun/runtime-stats-sidecar.test.ts src/bun/dev-flows.test.ts`.

## Operational caveats

Observed classification: the sink is opt-in and suitable for controlled benchmarking/troubleshooting, not as a universal permanent metrics backend.

Recommended durable interpretation: the sidecar DB is a **historical checkpoint sink**, while the runtime collector remains the runtime-owned source of truth during operation.

## Files changed

Observed changed files:

- `src/bun/runtime-stats.ts`
- `src/bun/runtime-stats-sidecar.ts`
- `src/bun/runtime-stats-sidecar.test.ts`
- `src/bun/index.ts`
- `src/bun/dev-flows.ts`
- `src/bun/dev-flows.test.ts`
- `src/bun/README.md`
- `README.md`

## Source

Ingested from `docs/2026-04-11-track-telemetry-sidecar-db.md` on 2026-04-19, then removed from `docs/` after durable knowledge moved into the wiki.