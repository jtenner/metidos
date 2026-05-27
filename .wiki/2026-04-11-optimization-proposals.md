# 2026-04-11 Metidos Optimization Proposals (Broad Draft)

## Summary

This page preserves the broad, pre-prioritized optimization inventory that was captured as `docs/optimization-proposals.md` on **2026-04-11**. The source was an AI-generated deep pass over the Metidos backend, frontend, DB, Git, scheduling, and tooling surfaces.

Unlike the later [optimization execution proposal](./optimization-execution-proposal.md), this page represents raw planning breadth (not a narrow implementation-ready roadmap). It is useful to recover any previously reasoned-about candidate moves, validate that those ideas were not lost, and preserve why some areas were intentionally deferred.

Source-of-truth rule for this page: claims about what is still true in code are `observed` only when inherited from already-ingested wiki records; anything else is marked as `inferred` from the archived source.

Related links:

- [optimization-execution-proposal](./optimization-execution-proposal.md)
- [raw source capture](./raw/optimization-proposals.md)
- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md)
- [sqlite-query-plan-indexes](./sqlite-query-plan-indexes.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
- [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md)
- [rpc-payload-measurement](./rpc-payload-measurement.md)

## Problem

Observed concern from the source: the codebase had already accumulated several advanced optimizations (virtualization, workers, caching, retries, and WAL migration planning), yet maintainers still faced a large search-space question:

- which changes would provide meaningful end-to-end wins,
- which were already done,
- and which were too speculative or high-risk without stronger measurement.

The proposal function was to narrow future work into concrete, phaseable tracks.

## Source context (Observed)

- **Document:** `docs/optimization-proposals.md`
- **Version:** 1.0
- **Generated:** 2026-04-11
- **Status in source:** Proposed / Analysis Complete
- **Scope:** Frontend responsiveness, backend orchestration, DB/Git I/O, scheduler/runtime behavior, bundle and dev-experience, memory and observability.

## Snapshot of observed strengths (Observed)

The source explicitly listed several already-present strong practices before proposing new work:

- memoization (`React.memo`, `useMemo`, `useCallback`) and immutable store patterns in mainview
- virtualization usage in git history and list rendering paths
- background workers and cache layers for markdown preprocessing and diff parsing
- transaction handling with retry support for SQLite lock contention
- prioritized RPC/cancellation plumbing and websocket transport
- starvation harness and structured local benchmark workflow
- existing WAL-related runtime hardening work in flight

Durable implication: optimization work should not restart from zero; it should focus on measurable gaps.

## Proposal clusters captured in the source (Inferred summary)

### 1) Frontend and rendering performance

Source proposals grouped as 2.x included:

- split `use-mainview-derived-state` into smaller hooks/modules
- tighten message transcript and diff rendering cost
- better memo boundaries and `useDeferredValue` for expensive searches
- apply heavier profiling and profiling-based auditing of UI components
- optional virtualization expansion for message/diff surfaces

Execution narrowing currently reflected in this wiki:

- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
- [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md)

One non-executed but preserved inference from the source: broad frontend rewrites were rejected in favor of controller decomposition + evidence-first follow-up; this remains visible in the execution plan.

### 2) Backend orchestration and RPC pathing

Source proposals grouped as 3.x included:

- decompose `src/bun/index.ts` and `project-procedures.ts`
- improve websocket batching and payload efficiency
- add request coalescing/dedup and scheduler-side batching

Execution narrowing currently reflected:

- [rpc-payload-measurement](./rpc-payload-measurement.md)
- [thread-status-refresh-dedupe](./thread-status-refresh-dedupe.md)

Durable result: protocol-wide changes (e.g., binary websocket transport) were intentionally deferred until payload and saturation data existed.

### 3) Database/runtime contention and query shape

Source proposals grouped as 4.x included:

- targeted SQLite index additions and planner audits
- explicit read/write transaction shaping and retry behavior
- broader query-cache options and cache TTL strategies

Execution narrowing currently reflected:

- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md)
- [sqlite-query-plan-indexes](./sqlite-query-plan-indexes.md)
- [sqlite-retry-metrics](./sqlite-retry-metrics.md)

Durable implication: measured planner work stayed in `OPT02`, and speculative read-caching was not the default.

### 4) Git and filesystem throughput

Source proposals grouped as 5.x included:

- persistent git history cache and reduced CLI invocation strategy
- more aggressive worktree open/close and file-read optimization
- stronger FS watcher-driven refresh behavior

Execution status in wiki:

- [rpc-payload-measurement](./rpc-payload-measurement.md) and [track-telemetry-sidecar-db](./track-telemetry-sidecar-db.md) kept tooling evidence;
- broad persistent Git caching (beyond existing in-memory/browser cache boundaries) remains mostly deferred in favor of measurement and targeted follow-up.

### 5) Cron, sandbox, and scheduler behavior

Source proposals grouped as 3.3/6.x included:

- scheduler queue / worker cap refinement
- VM sandbox pre-warm/pool optimization
- request-level timeout and resilience work

Execution narrowing currently reflected:

- [cron-concurrency-cap](./cron-concurrency-cap.md)
- [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md)

Durable implication: concurrency caps and telemetry were landed before deeper scheduler redesign or reusable sandbox pools.

### 6) Observability, memory, and build/dev ergonomics

Source proposals grouped as 6.x and 7.x included:

- end-to-end timing and correlation across RPC → DB → Git → UI
- memory leak audit and cleanup pass
- memory/CPU/percentile harness expansion
- bundle splitting and startup-time tuning
- perf-test suite integration into validation

Execution narrowing currently reflected:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)

Durable implication: these were staged as validation and telemetry groundwork first, with heavy refactors deferred.

## Durable mapping from broad proposal to execution tracks (Observed)

The broad source was distilled into the tracks preserved by [optimization execution proposal](./optimization-execution-proposal.md):

- `OPT01` (telemetry + baseline)
- `OPT02` (SQLite tuning)
- `OPT03` (mainview controller and memo decomposition)
- `OPT04` (build mode and asset serving)
- `OPT05` (payload visibility and targeted dedupe)
- `OPT06` (cron guardrails)

Those tracks are what became durable slices in the current wiki.

## Non-goals and rejected items retained in source (Observed from downstream distilled notes)

The source record treated several items as deferred for now:

- no protocol rewrite to binary transport in first wave
- no broad backend or mainview monolith rewrite without measured evidence
- no blanket query-cache rollout across SQLite reads
- no full memory/telemetry platform rewrite
- no mandatory full rebuild around frontend splitting in phase one

## Source note

Ingested on 2026-04-19.

- Raw source captured at `./raw/optimization-proposals.md`.
- Original source removed from `docs/` after durable, deduplicated knowledge was preserved under `.wiki/`.
- This is a historical snapshot to preserve the broad proposal shape; ongoing decisions should prefer [optimization execution proposal](./optimization-execution-proposal.md).