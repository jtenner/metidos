# Runtime Stats Collector

## Summary

This page records the durable design and implementation shape for Metidos's process-local runtime stats collector introduced for optimization slice `OPT01.1` on 2026-04-11.

Observed outcome: the slice was completed in the repository tree as of 2026-04-11.

Durable design conclusion: Metidos should keep a cheap, resettable, backend-only runtime stats collector in `src/bun/` that aggregates RPC timings, coarse request/response sizes, websocket push fan-out, SQLite retry behavior, and selected git-history cache counters without adding high-cardinality labels, persistence, or user-facing diagnostics in this first slice.

Related areas:
- [sqlite-retry-metrics](./sqlite-retry-metrics.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [rpc-payload-measurement](./rpc-payload-measurement.md)
- [track-telemetry-sidecar-db](./track-telemetry-sidecar-db.md)
- optimization planning under `./optimization-execution-proposal.md` and `./raw/optimization-proposals.md`
- later follow-up slices for percentile reporting, harness output, payload work, cron telemetry, and optional low-cardinality sidecar persistence

## Problem

The optimization backlog needed shared runtime evidence before broader tuning work could be prioritized safely. Before `OPT01.1`, Metidos already had several narrow health signals, but they were fragmented and did not answer the core questions:

- which RPC methods are slow
- which RPC methods send large payloads
- how often SQLite retry loops happen
- whether git-history caches are actually effective
- what websocket push traffic looks like in aggregate

## Current state before the slice

Observed prior state from the source design record:

- `src/bun/index.ts` already tracked overload-adjacent health such as pending RPC counts, event-loop lag, websocket client count, git scheduler stats, and procedure runtime stats.
- `src/bun/project-procedures.ts` already exposed partial runtime information through `getProcedureRuntimeStats()`, including concurrency-limiter and persistence timing data.
- `withSqliteRetry()` already existed as a natural low-cardinality retry instrumentation point.
- `src/bun/project-procedures/git-history.ts` already had meaningful caches for history pages and commit diffs.
- centralized websocket request and broadcast paths already existed in `src/bun/index.ts`, making always-on measurement practical.

Observed gap: the tree still lacked one shared, resettable collector for per-method RPC timing and bytes, websocket push totals, SQLite retry summaries, and selected git cache hit/miss behavior.

## Chosen design

Recommended and implemented design from the source:

- add a dedicated backend-only module at `src/bun/runtime-stats.ts`
- keep the model process-local, numeric, and resettable
- instrument the existing centralized RPC lifecycle in `src/bun/index.ts`
- instrument websocket push fan-out in the same backend entry layer
- instrument SQLite lock/busy retry behavior in `withSqliteRetry()`
- instrument selected git-history and commit-diff cache events in `src/bun/project-procedures/git-history.ts`
- expose explicit snapshot and reset functions for future harness/diagnostics work
- avoid percentile, memory, persistence, UI, and transport-scope expansion in this slice

## Invariants and guardrails

The source proposal treats these as durable constraints for this collector shape:

- store counters, totals, and peak values only
- do not keep per-call arrays, histograms, or unbounded traces in this slice
- do not add project, worktree, thread, SQL-text, or other high-cardinality labels
- do not re-stringify payloads when a serialized string already exists
- use `performance.now()` for duration measurement
- keep reset behavior explicit through an API, not implicit through process restart
- keep public diagnostics exposure out of `OPT01.1`; later slices can decide how snapshots are surfaced

## Runtime stats model

The design record proposed a compact snapshot with these durable sections:

- `rpc`
  - per-method totals
  - success/failure/timeout/cancel classification
  - request/response byte totals
  - total and peak duration information
- `sqliteRetry`
  - loops with retry
  - total retries
  - exhausted loops
  - total backoff milliseconds
  - peak retry count
- `websocketPush`
  - per-push-type message counts
  - payload bytes
  - delivered and dropped client totals
- `gitCache`
  - commit-diff cache hits, misses, pending reuse, and stores
  - history-page cache range hits, fetches, prefetch waits, and preemptions

This is a design summary, not a claim that the exact type definition must remain frozen forever. The durable rule is the shape class: small numeric summaries suitable for logs, tests, and future tooling.

## Instrumentation boundaries

### RPC lifecycle in `src/bun/index.ts`

Recommended instrumentation points:

1. request accepted/registered
2. handler success
3. handler failure
4. timeout or client cancellation
5. serialized response send

Durable classification model:

- `succeeded`
- `failed`
- `timedOut`
- `canceled`

Notable edge-case guidance preserved from the source:

- auth failures after method parse should count as failures for that parsed method
- duplicate request-id failures should count against the parsed requested method
- payload parse failures without a method do not need forced per-method accounting in this slice
- client-canceled or signal-aborted work should still increment canceled counts

### Websocket push fan-out in `src/bun/index.ts`

The source explicitly called out these broadcast helpers as high-value instrumentation sites:

- `broadcastReload`
- `broadcastGitHistoryChanged`
- `broadcastContextFocusChanged`
- `broadcastThreadStartRequestCreated`
- `broadcastThreadExtensionUiRequest`

Durable measurement goal: count messages, bytes, delivered clients, and dropped clients by push type without dumping the full detailed map into routine overload logs.

### SQLite retry accounting in `src/bun/project-procedures.ts`

Durable rule: instrument retry loops at `withSqliteRetry()` because it already owns retry counting, backoff calculation, and exhaustion decisions.

The source explicitly excluded recording:

- SQL text
- table names
- project or thread identifiers
- stack traces

### Git cache accounting in `src/bun/project-procedures/git-history.ts`

Durable narrow scope:

- history-page cache: `cacheRangeHit`, `fetches`, `prefetchWaits`, `preemptions`
- commit-diff cache: `hits`, `misses`, `pendingReuse`, `stores`

Reasoning preserved from the source: this slice measures the existing cache shapes; it does not attempt to define a generalized cache telemetry framework.

## API surface

The source design called for an internal collector module with helpers equivalent to:

- RPC start/completion/failure/cancel recording
- websocket push recording
- SQLite retry recording
- git history cache event recording
- git commit-diff cache event recording
- `getRuntimeStatsSnapshot()`
- `resetRuntimeStats()`

Durable boundary: snapshot and reset are explicit internal APIs. `OPT01.1` should not itself add a public RPC or HTTP diagnostics route.

## Testing and validation

The source recommended direct unit coverage for the collector module, especially for:

- RPC success/failure/timeout/cancel aggregation
- byte counters
- websocket push aggregation by type
- SQLite retry summaries
- git cache counters
- reset behavior

Repo validation guidance from the source:

- `bun run format`
- `bun run validate`

## Relationship to later slices

The source explicitly deferred these concerns to later optimization work:

- percentile reporting such as `p50`/`p95`/`p99`
- memory reporting
- starvation-harness JSON output changes
- persisted telemetry in SQLite (implemented as optional low-cardinality `runtime-stats-sidecar` persistence in `track-telemetry-sidecar-db`)
- user-visible diagnostics UI
- transport redesign
- build or bundle work
- performance flags or user-facing settings

This separation is a durable planning rule: the first slice should provide cheap measurement primitives, not a full observability system.

## Durable takeaway

The key durable lesson from `OPT01.1` is architectural rather than temporary: Metidos should gather backend runtime evidence through a single cheap collector wired into existing centralized hot paths, and it should keep that collector low-cardinality, resettable, and internal until a later slice proves out how external reporting should work.
