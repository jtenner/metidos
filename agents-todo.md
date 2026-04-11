# Agents Todo

This file is the active execution backlog for Pi-backed follow-up work in `metidos`, including Codex usage through Pi's built-in `openai-codex` provider, plus approved optimization follow-up work accepted from the optimization proposal documents.

## Rules

- Remove completed todo items from this document altogether. Do not leave completed items in place as checked, archived, or struck through entries.
- Keep the `Risks` and `Blockers` sections current before adding, reordering, or splitting slices.
- Add new slices only when they clearly map back to one of the approved planning documents:
  - [the Pi migration research document](./docs/2026-04-09-pi-coding-agent-migration-research.md)
  - [the Codex-via-Pi wiring document](./docs/2026-04-09-codex-via-pi-wiring.md)
  - [the optimization proposal document](./docs/optimization-proposals.md)
  - [the optimization execution proposal document](./docs/2026-04-11-optimization-execution-proposal.md)
- Keep conditional optimization slices explicitly labeled as conditional until earlier measurement slices show they still pay off.

## Risks

- Optimization slices must stay measurement-led. Refresh or compare against the recorded OPT01 baseline before pulling speculative follow-on slices forward.
- `OPT04.3` and `OPT05.3` are intentionally conditional; they should not be started unless earlier slices show continuing payoff.
- Expanding this backlog beyond the original Pi/Codex-only scope means each optimization slice must keep explicit document references so its justification stays auditable.

## Blockers

- None for the currently accepted optimization backlog.

## Todo Items

- [OPT02.1] Enable conservative WAL-mode tuning - Turn on safe SQLite runtime pragmas and validate normal app, cron, and cleanup behavior under WAL mode.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT02` / `OPT02.1`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§4.1, 4.2.

- [OPT02.2] Query-plan audit and missing composite indexes - Measure hot read plans and add only the indexes that materially improve `projects`, `threads`, and selected message reads.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT02` / `OPT02.2`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§4.1, 4.2.

- [OPT02.3] SQLite retry metrics - Count lock retries and retry exhaustion, then surface those numbers through the runtime stats path.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT02` / `OPT02.3`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§4.1, 4.2.

- [OPT03.1] Extract thread-status and selected-thread controller - Move polling and selected-thread refresh logic out of `App.tsx` to reduce state fan-out and sharpen hot render boundaries.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT03` / `OPT03.1`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§2.1, 2.3.

- [OPT03.2] Extract project/worktree and git-history controllers - Pull worktree-open, refresh, and history orchestration out of `App.tsx` and narrow the prop surfaces passed into panels.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT03` / `OPT03.2`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§2.1, 2.3.

- [OPT03.3] Targeted derived-state and memo cleanup - Split only the hottest derived-state helpers and add memo or `useDeferredValue` changes where profiling shows benefit.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT03` / `OPT03.3`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§2.1, 2.3.

- [OPT04.1] Production minify and sourcemap gating - Add explicit dev/prod bundle behavior so production stops always emitting unminified JS with sourcemaps.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT04` / `OPT04.1`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§2.5, 7.1.

- [OPT04.2] Cacheable asset-serving path - Serve built frontend assets from a small explicit asset path with better cache semantics while preserving bootstrap correctness.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT04` / `OPT04.2`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§2.5, 7.1.

- [OPT04.3] Optional build splitting - Enable chunk-capable frontend output only if post-`OPT04.1` and `OPT04.2` measurements still justify the added build complexity.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT04` / `OPT04.3`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§2.5, 7.1.

- [OPT05.1] RPC payload measurement - Add coarse response and websocket-push payload accounting so the noisiest transport paths can be ranked before changing protocol behavior.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT05` / `OPT05.1`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§3.2, 2.6, 6.2.

- [OPT05.2] Thread-status refresh dedupe - Reduce redundant `listThreadStatuses` and selected-detail refresh work while preserving visibility and selected-thread correctness.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT05` / `OPT05.2`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§3.2, 2.6.

- [OPT05.3] Targeted status and invalidation batching - Batch only the event streams proven noisy by `OPT05.1` instead of redesigning the full websocket protocol.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT05` / `OPT05.3`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§3.2, 2.6.

- [OPT06.1] Cron concurrency cap - Add bounded concurrency for cron-spawned thread execution using the existing limiter primitives rather than a full scheduler rewrite.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT06` / `OPT06.1`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§3.3, 6.2.

- [OPT06.2] Cron duration and saturation telemetry - Record cron run duration, active or pending counts, and saturation events to decide whether deeper scheduler changes are warranted.
  Reference: [docs/2026-04-11-optimization-execution-proposal.md](./docs/2026-04-11-optimization-execution-proposal.md), `OPT06` / `OPT06.2`; [docs/optimization-proposals.md](./docs/optimization-proposals.md) §§3.3, 6.2.
