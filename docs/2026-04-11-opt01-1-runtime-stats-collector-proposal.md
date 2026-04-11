# 2026-04-11 OPT01.1 Runtime Stats Collector Proposal

**Status:** completed on 2026-04-11  
**Slice:** [OPT01.1](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)

## Purpose

This document turns **OPT01.1 — Runtime stats collector** into an implementation-ready proposal.

This slice is now implemented in the current tree. The design notes below remain the implementation record for what was chosen, what was explicitly excluded, and what later slices should build on.

The earlier optimization documents established that Metidos needs better runtime measurement before broader optimization work is pulled forward. This document narrows that down to the first concrete slice:

> add a cheap, resettable, process-local runtime stats collector for RPC timings, coarse payload sizes, SQLite retry behavior, and selected cache counters.

This is intentionally **not** the whole telemetry track. It is only the first slice.

## Scope decision

This slice should **implement the collector and wire the highest-value instrumentation points**, but it should **not** yet implement the full benchmark-reporting story.

### In scope for OPT01.1

- process-local runtime stats collector module in `src/bun`
- per-RPC method counters and timing aggregates
- coarse request/response byte counters for RPC traffic
- websocket push counters by message type
- SQLite retry counters from `withSqliteRetry()`
- selected git-history / commit-diff cache counters
- resettable snapshot API for future harness and diagnostics work
- compact integration into existing server-overload health snapshots where useful

### Explicitly out of scope for OPT01.1

- percentile reporting (`p50`/`p95`/`p99`)
- memory snapshots
- JSON report generation in the starvation harness
- full OpenTelemetry integration
- persisted telemetry in SQLite
- browser-visible diagnostics UI
- transport redesign
- build or bundle work
- any new user-facing setting or performance flag

Those belong to later slices, especially `OPT01.2`, `OPT01.3`, `OPT05.*`, and `OPT06.2`.

---

## Current state audit

The repository already has several pieces of performance-related state, but they are fragmented and too narrow to support the planned optimization backlog.

### What already exists

#### 1. `src/bun/index.ts` already tracks overload-adjacent server health

The server currently tracks:
- current and peak pending RPC request counts
- current and peak event-loop lag
- websocket client count
- git scheduler queue stats via `getGitSchedulerStats()`
- procedure-level runtime stats via `getProcedureRuntimeStats()`

This is surfaced indirectly through the overload-monitor path (`buildServerHealthSnapshot()` and `startOverloadMonitoring()`).

That means Metidos already has a place to **summarize** backend runtime health.

#### 2. `src/bun/project-procedures.ts` already exposes partial runtime stats

`getProcedureRuntimeStats()` currently reports:
- foreground read count
- concurrency limiter stats for worktree open, git history reads, and diff loads
- project poller/open-worktree counts
- last/peak thread-activity persistence duration

This is useful, but it does **not** yet answer the first-wave optimization questions:
- which RPC methods are actually slow?
- which responses are large?
- how often are SQLite retries happening?
- how often do git caches hit versus miss?

#### 3. `src/bun/project-procedures.ts` already has a SQLite retry loop

`withSqliteRetry()` and the helpers around it already implement retry logic for lock/busy cases.

That is a strong instrumentation point because later slices (`OPT02.*`) need real contention numbers, not guesses.

#### 4. `src/bun/project-procedures/git-history.ts` already has meaningful caches

The git-history subsystem already includes:
- paged worktree-history cache state
- background prefetch
- commit-diff LRU cache
- in-flight commit-diff request sharing

That means the collector does **not** need to invent caches. It only needs to measure them.

#### 5. `src/bun/index.ts` already has centralized RPC and websocket push hook points

The server’s websocket request lifecycle is centralized enough that one collector can observe:
- RPC request registration
- request completion/failure/cancelation
- JSON response sending
- websocket push fan-out from broadcast helpers

This is the highest-leverage place to add per-method timing and payload accounting.

### What is missing

The current tree still lacks:
- per-method RPC timing aggregates
- a shared collector for response/request byte counts
- websocket push accounting by type
- retry counts for SQLite lock contention
- hit/miss/reuse counters for selected caches
- a resettable runtime snapshot that later slices can consume

That is the gap OPT01.1 should close.

---

## Recommended implementation shape

## 1. Add a dedicated `src/bun/runtime-stats.ts` module

This slice should introduce a new backend-only module whose only job is to store and report cheap process-local counters.

### Why a dedicated module is the right shape

Putting the logic directly into `index.ts` or `project-procedures.ts` would work, but it would create the same fragmentation problem this slice is trying to solve.

A dedicated collector module gives us:
- one place to define the stats model
- one place to reset counters in tests and later harness runs
- one place to evolve summary vs detailed snapshots
- small call sites in the instrumented modules

### Recommended module responsibilities

The new module should provide:

- `recordRpcStarted(...)` or an equivalent start token helper
- `recordRpcCompleted(...)`
- `recordRpcFailed(...)`
- `recordRpcCanceled(...)`
- `recordWebSocketPush(...)`
- `recordSqliteRetryLoop(...)`
- `recordGitHistoryCacheEvent(...)`
- `recordGitCommitDiffCacheEvent(...)`
- `getRuntimeStatsSnapshot()`
- `resetRuntimeStats()`

### Recommended snapshot shape

The snapshot should stay intentionally small and numeric. It should avoid per-project, per-worktree, or per-thread labels.

A reasonable shape would be:

```ts
export type RuntimeStatsSnapshot = {
  startedAt: string;
  rpc: {
    byMethod: Record<string, RpcMethodRuntimeStats>;
    totals: {
      calls: number;
      canceled: number;
      failed: number;
      requestBytes: number;
      responseBytes: number;
      succeeded: number;
      timedOut: number;
      totalDurationMs: number;
    };
  };
  sqliteRetry: {
    exhaustedLoops: number;
    loopsWithRetry: number;
    peakRetryCount: number;
    totalBackoffMs: number;
    totalRetries: number;
  };
  websocketPush: {
    byType: Record<string, WebSocketPushRuntimeStats>;
    totals: {
      deliveredClients: number;
      droppedClients: number;
      messages: number;
      payloadBytes: number;
    };
  };
  gitCache: {
    commitDiff: {
      hits: number;
      misses: number;
      pendingReuse: number;
      stores: number;
    };
    historyPage: {
      cacheRangeHit: number;
      fetches: number;
      prefetchWaits: number;
      preemptions: number;
    };
  };
};
```

This shape is detailed enough to guide follow-on work but still cheap enough to keep always-on.

### Important implementation rule

The collector should store:
- **counters**
- **totals**
- **peak values**

It should **not** store per-call arrays, histograms, or unbounded traces in this slice.

That is how we keep it cheap and resettable.

---

## 2. Instrument RPC lifecycle in `src/bun/index.ts`

This is the most important part of the slice.

### Recommended hook points

The websocket RPC lifecycle in `src/bun/index.ts` already provides clean instrumentation points:

1. **request accepted / registered**
2. **handler resolved successfully**
3. **handler failed**
4. **client canceled or timeout-aborted request**
5. **response serialized and sent**

### What should be recorded per RPC method

For each method, record:
- total call count
- success count
- failure count
- timeout count
- canceled count
- total duration
- peak duration
- total request bytes
- total response bytes
- last duration (optional but useful)

### Duration source

Use `performance.now()` for durations, not `Date.now()`.

Rationale:
- higher precision
- already used elsewhere in the repo
- consistent with later benchmark work

### Payload size source

For request and response byte counts, use the already-available serialized strings where possible.

Recommended approach:
- incoming request bytes: compute from the raw websocket `payload` string
- outgoing response bytes: compute from the already-built JSON response string before sending
- websocket push bytes: compute from the already-built broadcast string

Do **not** re-stringify objects just for stats if the string already exists.

### Error classification recommendation

For this slice, keep RPC result classification simple:
- `succeeded`
- `failed`
- `timedOut`
- `canceled`

No more granularity is required yet.

### Important edge cases to handle

#### Auth failures after method parse
These should still count against the requested RPC method as failures.

#### Duplicate request id failures
These should count as failures for the requested method if the method was parsed successfully.

#### Payload parse failures with no method
Do **not** force these into the per-method map. If desired, they can be tracked later as transport/protocol errors, but that is not required for OPT01.1.

#### Client-canceled requests
If the server exits early because `pending.canceledByClient` or `signal.aborted`, that should still increment the method’s canceled count.

---

## 3. Instrument websocket push fan-out in `src/bun/index.ts`

The existing broadcast helpers are a second high-value source of runtime data.

### Broadcast functions worth instrumenting

At minimum:
- `broadcastReload`
- `broadcastGitHistoryChanged`
- `broadcastContextFocusChanged`
- `broadcastThreadStartRequestCreated`
- `broadcastThreadExtensionUiRequest`

### What to record

Per push type, record:
- number of messages emitted
- total payload bytes
- total delivered-client count
- total dropped-client count from failed sends

This will later help decide whether `OPT05.3` is worth doing.

### Important logging decision

Do **not** dump the full per-type stats map into every overload warning log.

Instead:
- keep the detailed map in the runtime stats collector,
- add at most a compact total summary to `buildServerHealthSnapshot()` if needed.

That avoids turning overload logs into telemetry blobs.

---

## 4. Instrument SQLite retry behavior in `src/bun/project-procedures.ts`

### Where to instrument

The correct hook point is `withSqliteRetry()`.

That function already owns:
- retry attempt counting
- backoff delay calculation
- retry exhaustion decision

It is the natural place to collect lock-contention metrics.

### What to record

For the slice, record:
- loops that required at least one retry
- total retry attempts across all loops
- exhausted retry loops
- total backoff delay applied
- peak retry count seen in one loop

### What not to record

Do not record:
- SQL text
- table names
- project/thread identifiers
- stack traces

That would add noise and potentially create high-cardinality telemetry.

### Recommended behavior

- only count retries for real `SQLITE_BUSY` / `SQLITE_LOCKED` paths
- do not record non-lock exceptions as retry events
- do record exhaustion when the final retryable failure escapes

This data is directly useful for `OPT02.3`.

---

## 5. Instrument selected git cache behavior in `src/bun/project-procedures/git-history.ts`

The collector should cover only the caches that are already important to the optimization backlog.

### History page cache metrics

Recommended counters:
- `cacheRangeHit`
  - requested offset/limit already satisfied from cached entries
- `fetches`
  - cache did not satisfy the range and a new fetch was started
- `prefetchWaits`
  - caller reused an in-flight prefetch instead of starting another one
- `preemptions`
  - foreground request replaced background warming

These are enough to answer whether the current history cache is already effective.

### Commit-diff cache metrics

Recommended counters:
- `hits`
  - diff came from LRU cache
- `misses`
  - new diff read had to start
- `pendingReuse`
  - another caller reused an in-flight diff request
- `stores`
  - fresh diff result inserted into cache

These are enough to answer whether additional git caching work is justified later.

### Why keep this narrow

The goal of OPT01.1 is to measure the current caching shape, not to create a generalized cache telemetry framework.

---

## 6. Keep reset and snapshot behavior explicit

One of the stated goals of OPT01.1 is to keep stats **resettable**.

That should be an explicit API, not an accident of process restart.

### Recommended API behavior

- `resetRuntimeStats()` clears all counters and sets a fresh `startedAt`
- `getRuntimeStatsSnapshot()` returns a clone/plain object safe for logs, tests, and future diagnostics access

### Recommended scope decision

For this slice, implement the reset and snapshot functions **internally**, but do **not** yet expose a public RPC or HTTP route.

That keeps OPT01.1 small and avoids prematurely expanding the diagnostics surface.

The future exposure path can be chosen in `OPT01.2`, when the starvation harness needs to consume the snapshot directly.

This is the cleanest slice boundary.

---

## Suggested file-level changes

## New file

### `src/bun/runtime-stats.ts`
Add the shared collector, snapshot types, reset logic, and small helper functions.

Suggested contents:
- snapshot/result types
- finite maps for RPC methods and websocket push types
- counter update helpers
- duration helper using `performance.now()`
- reset logic
- snapshot clone logic

## Existing files to edit

### `src/bun/index.ts`
Add instrumentation for:
- per-RPC request timing and bytes
- response timing classification
- websocket push fan-out counts
- compact integration into overload health snapshot if helpful

### `src/bun/project-procedures.ts`
Add instrumentation for:
- SQLite retry loops
- optional inclusion of selected runtime collector summary in `getProcedureRuntimeStats()` only if that improves internal visibility without bloating the payload

### `src/bun/project-procedures/git-history.ts`
Add instrumentation for:
- history cache range hits, fetches, prefetch waits, preemptions
- commit-diff cache hits, misses, pending reuse, stores

### Optional follow-on file changes in this slice

Only if the implementation needs them:
- `src/bun/README.md`
- `README.md`

My recommendation is to **defer README changes** until `OPT01.2` or `OPT01.3`, when there is an actual diagnostics workflow to document.

---

## Test plan

This slice should come with new unit tests. The easiest way to keep them stable is to test the collector module directly.

## Recommended new test file

### `src/bun/runtime-stats.test.ts`

Test cases should cover:
- RPC success aggregation
- RPC failure aggregation
- RPC timeout/cancel classification
- byte counters accumulate correctly
- websocket push aggregation by type
- SQLite retry counters
- git cache hit/miss/reuse counters
- reset behavior clears counters and refreshes `startedAt`

## Recommended secondary tests

If the wiring needs extra confidence, add narrow tests for helper-level behavior rather than spinning up the full server:
- classification helper for RPC completion status
- retry-accounting helper behavior

## Validation

Because this is a code slice, the usual repo process applies:
- `bun run format`
- `bun run validate`

---

## Definition of done for OPT01.1

This slice should be considered complete when all of the following are true:

1. A dedicated runtime stats collector exists in `src/bun`.
2. RPC requests are counted per method with success/failure/cancel/timeout totals.
3. Coarse request/response byte totals are collected per method.
4. Websocket pushes are counted by type with payload and fan-out totals.
5. SQLite retry loops are counted and summarized.
6. Selected git cache hit/miss/reuse counters are collected.
7. The collector can be reset programmatically.
8. The collector can return a stable plain-object snapshot.
9. Unit tests cover the collector behavior.
10. The slice does **not** yet add harness percentile reporting, memory reporting, or a user-facing diagnostics surface.

---

## Non-goals and guardrails

This slice should stay disciplined.

### Do not do these in OPT01.1

- no histogram library
- no flamegraph integration
- no percentiles
- no UI surface
- no database persistence for metrics
- no environment-variable tuning flags
- no worktree/project/thread labels in the stats payload
- no “top N slow RPCs” computation in the hot path
- no benchmark-format changes in `starvation-harness.ts`

### Why this matters

If OPT01.1 tries to become a full observability project, it will stop being a useful first slice.

The job here is to lay down **cheap measurement primitives** that later slices can consume.

---

## Recommended implementation order

1. Add `src/bun/runtime-stats.ts` and direct unit tests.
2. Instrument RPC lifecycle in `src/bun/index.ts`.
3. Instrument websocket push helpers in `src/bun/index.ts`.
4. Instrument SQLite retry accounting in `src/bun/project-procedures.ts`.
5. Instrument git cache counters in `src/bun/project-procedures/git-history.ts`.
6. Optionally add a compact summary hook into the existing overload health snapshot.
7. Run `bun run format` and `bun run validate`.
8. Leave harness/reporting/export changes for `OPT01.2`.

---

## Proposal summary

The work that needs to be done for OPT01.1 is:

- create a small dedicated runtime stats collector module,
- wire it into the backend’s existing centralized RPC, retry, and cache paths,
- keep the data model numeric, low-cardinality, resettable, and process-local,
- avoid percentiles, harness output changes, or UI/reporting scope in this slice.

If implemented this way, OPT01.1 will give the later optimization slices something they currently lack:

**actual runtime evidence about which parts of Metidos are hot, noisy, retrying, or missing cache.**

That is the right foundation for the rest of the optimization backlog.
