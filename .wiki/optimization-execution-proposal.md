# Optimization Execution Proposal

## Summary

This page preserves the durable planning guidance from the 2026-04-11 optimization execution proposal. The source narrowed the earlier broad optimization-ideas document into a measured execution plan for Metidos.

Durable conclusion: optimization work should not reopen areas already implemented, should prefer evidence-led slices over speculative rewrites, and should be organized into a small number of explicit tracks with clear non-goals and validation.

Related pages:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md)
- [sqlite-query-plan-indexes](./sqlite-query-plan-indexes.md)
- [sqlite-retry-metrics](./sqlite-retry-metrics.md)
- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
- [production-mainview-build-modes](./production-mainview-build-modes.md)
- [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md)
- [rpc-payload-measurement](./rpc-payload-measurement.md)
- [thread-status-refresh-dedupe](./thread-status-refresh-dedupe.md)
- [cron-concurrency-cap](./cron-concurrency-cap.md)
- [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md)

- [2026-04-11-optimization-proposals](./2026-04-11-optimization-proposals.md) — Archived broad optimization idea inventory that was distilled into this execution proposal.

## Problem

The earlier optimization note under `./raw/optimization-proposals.md` (originally `docs/optimization-proposals.md`) was intentionally broad and exploratory. By 2026-04-11, Metidos had already landed a meaningful amount of optimization-related work in the tree, so blindly copying every suggestion into backlog slices would have created duplicate or low-value work.

The planning problem was therefore narrower:

- identify which optimization ideas were still not done
- reject or defer the ones that were already implemented or poorly justified
- translate the believable remainder into slice-ready tracks
- define an execution order that starts with measurement instead of speculation

## Current-state correction from the source

The source explicitly recorded that several optimization themes from the earlier broad document were already substantially present in the repository and therefore should not become first-wave backlog slices.

Observed examples named in the source:

- transcript virtualization and row measurement reuse in `src/mainview/app/chat-workspace.tsx`
- lazy markdown loading in `src/mainview/app/message-markdown-loader.ts` and `src/mainview/app/message-ui.tsx`
- worker-backed markdown preprocessing with caching and request dedupe in `src/mainview/app/message-preprocessing-client.ts` and `src/mainview/app/message-preprocessing-worker.ts`
- worker-backed diff parsing with caching and request dedupe in `src/mainview/app/diff-parsing-client.ts` and `src/mainview/app/diff-parsing-worker.ts`
- git-history caching, commit-diff coalescing, and invalidation batching in `src/bun/project-procedures/git-history.ts` and `src/mainview/app/invalidation-events.ts`
- a meaningful SQLite index baseline in `src/bun/db.ts`
- partial backend decomposition already present under `src/bun/project-procedures/`

Durable takeaway: Metidos should treat optimization planning as a gap analysis against the current tree, not as a restatement of every idea from an older research note.

## Recommended optimization tracks

The source collapsed the broad suggestion set into six durable execution tracks.

### OPT01 — Performance telemetry and benchmark baseline

Durable goal: establish shared evidence before prioritizing deeper optimization work.

Planned sub-slices from the source:

- `OPT01.1` runtime stats collector
- `OPT01.2` harness percentile and memory reporting
- `OPT01.3` first baseline write-up

Durable rationale:

- several later decisions depend on trustworthy timing, payload, retry, and memory evidence
- cheap and directionally reliable telemetry is more valuable than a premature observability platform

Observed follow-through in the wiki:

- [runtime-stats-collector](./runtime-stats-collector.md)
- [starvation-harness-reporting](./starvation-harness-reporting.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)

### OPT02 — SQLite runtime tuning and query-plan alignment

Durable goal: start with conservative SQLite runtime defaults and query-plan-backed index work instead of broad database caching or concurrency redesign.

Planned sub-slices from the source:

- `OPT02.1` conservative WAL-mode tuning
- `OPT02.2` query-plan audit and missing composite indexes
- `OPT02.3` SQLite retry metrics

Durable rationale:

- Metidos already had a nontrivial index baseline
- WAL plus `synchronous = NORMAL` looked like a justified low-risk runtime improvement
- index additions should follow measured planner evidence instead of speculation

Observed follow-through in the wiki:

- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md)
- [sqlite-query-plan-indexes](./sqlite-query-plan-indexes.md)
- [sqlite-retry-metrics](./sqlite-retry-metrics.md)

### OPT03 — Mainview controller decomposition and targeted memo audit

Durable goal: reduce hot-path coupling in `src/mainview/App.tsx` through selective controller extraction and focused memo-boundary cleanup rather than a store rewrite.

Planned sub-slices from the source:

- `OPT03.1` extract thread-status and selected-thread controller
- `OPT03.2` extract project/worktree and git-history controllers
- `OPT03.3` targeted derived-state and memo cleanup

Durable rationale:

- the main optimization smell was controller size and state fan-out in `App.tsx`, not a lack of transcript virtualization
- extracted hot controllers and narrower prop boundaries were expected to be more valuable than framework churn

Observed follow-through in the wiki:

- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)

### OPT04 — Production mainview asset pipeline

Durable goal: fix build-mode and asset-serving fundamentals before considering optional chunk splitting.

Planned sub-slices from the source:

- `OPT04.1` production minify and sourcemap gating
- `OPT04.2` cacheable asset-serving path
- `OPT04.3` optional build splitting

Durable rationale:

- the repository still shipped an avoidably debug-like frontend build shape
- explicit dev/prod build behavior and a versioned static-asset contract were clear wins
- optional chunk splitting should stay contingent on later measurements

Observed follow-through in the wiki:

- [production-mainview-build-modes](./production-mainview-build-modes.md)
- [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md)

Open planning note preserved from the source: optional build splitting remained intentionally deferred until after the first two sub-slices and fresh measurements.

### OPT05 — RPC payload accounting and targeted refresh/broadcast coalescing

Durable goal: measure and reduce noisy transport paths without redesigning the protocol.

Planned sub-slices from the source:

- `OPT05.1` RPC payload measurement
- `OPT05.2` thread-status refresh dedupe
- `OPT05.3` targeted status or invalidation batching

Durable rationale:

- Metidos already had typed RPC envelopes, cancellation, reconnect logic, and some invalidation coalescing
- the next step should be coarse payload measurement and tactical dedupe of known hot paths such as thread-status refresh
- binary websocket transport and broad protocol churn were explicitly rejected for the first wave

Observed follow-through in the wiki:

- [rpc-payload-measurement](./rpc-payload-measurement.md)
- [thread-status-refresh-dedupe](./thread-status-refresh-dedupe.md)

Open planning note preserved from the source: targeted status or invalidation batching was intentionally left contingent on what the payload data showed.

### OPT06 — Cron execution guardrails and telemetry

Durable goal: add bounded concurrency and runtime evidence around scheduler-fired cron launches before considering deeper scheduler redesign.

Planned sub-slices from the source:

- `OPT06.1` cron concurrency cap
- `OPT06.2` cron duration and saturation telemetry

Durable rationale:

- scheduler fires could overlap globally even though each fire processed its due rows in a disciplined way
- a shared concurrency cap and telemetry were lower-risk, more justifiable first steps than a persistent cron queue or sandbox pooling

Observed follow-through in the wiki:

- [cron-concurrency-cap](./cron-concurrency-cap.md)
- [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md)

## Execution order

The source recommended a phased order rather than parallelizing every optimization effort at once.

### Phase A

1. `OPT01` telemetry and baseline
2. `OPT02` SQLite tuning and targeted query-plan fixes
3. `OPT04.1` production minify and sourcemap gating

### Phase B

4. `OPT03` mainview controller decomposition and memo audit
5. `OPT05` RPC payload accounting and targeted coalescing

### Phase C

6. `OPT06` cron guardrails and telemetry
7. `OPT04.2` and `OPT04.3` cacheable asset serving and optional chunk splitting if later metrics still justified them

Durable rule: establish measurement and obvious infrastructure wins first, then use that evidence to narrow the UI and transport hot paths, then add operational guardrails and optional deeper build work.

## Intentionally deferred or rejected ideas

The source also preserved an important negative decision set.

### Do not backlog as first-wave work

These were explicitly treated as already implemented enough or otherwise not justified as first-wave slices:

- reopening transcript virtualization or lazy rendering work
- reopening markdown or diff workerization/caching work
- adding a persistent on-disk git cache
- VM pooling or sandbox reuse
- a full persistent-queue cron scheduler rewrite

### Defer until telemetry exists

The source recommended deferring these until earlier measurement work produced better evidence:

- broader event-system abstraction
- backend monolith refactors justified only by file size
- Pi/model-catalog tuning
- filesystem or worktree-path tuning
- broad memory or leak-prevention sweeps
- user-facing runtime performance flags

### Explicit protocol and architecture restraint

The source explicitly rejected or narrowed several tempting but high-cost changes:

- no binary websocket protocol in the first wave
- no blanket read-query cache for SQLite
- no optimistic locking or version-column work in the first SQLite pass
- no bundler migration just to get code splitting
- no new frontend store dependency such as Zustand, Jotai, or Recoil in the first controller cleanup pass

Durable takeaway: the planning value of the proposal was as much about what not to do as what to do.

## Backlog translation rules

The source included durable rules for how a future backlog should be generated from the plan.

### Rule 1 — one slice, one optimization move

A slice should target one optimization move with clear scope, not bundle unrelated subsystems together.

### Rule 2 — preserve source traceability

Each backlog item should point back to both:

- this execution proposal
- the originating broad optimization note under `./raw/optimization-proposals.md`

### Rule 3 — state non-goals explicitly

Optimization work should name what it will not do so the slices do not expand into general cleanup or speculative redesign.

### Rule 4 — require explicit verification

Examples preserved in the source:

- run the starvation harness before and after and record latency changes
- inspect `EXPLAIN QUERY PLAN` for hot SQLite reads
- confirm selected-thread polling and refresh behavior remains correct

### Rule 5 — respect backlog-source policy

The source noted that `agents-todo.md` at the time allowed new slices only when they mapped back to the Pi migration or Codex-via-Pi documents. That meant optimization planning needed either:

- a broadened `agents-todo.md` rule
- a separate optimization backlog file
- or an explicit policy change stating that the optimization proposal had become an approved backlog source

This is a durable workflow lesson: research can be ready for slicing before backlog policy is ready to accept it.

## Durable takeaway

The durable planning lesson from the source is that Metidos should pursue optimization through measured, gap-aware execution tracks rather than through broad speculative cleanup. Start with shared telemetry and a repeatable benchmark story, convert only the believable gaps into narrow slices, preserve non-goals, and let later work be justified by evidence instead of optimization theater.

## Source note

Ingested from `docs/2026-04-11-optimization-execution-proposal.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
