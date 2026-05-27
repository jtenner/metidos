# Mainview transcript pipeline seam

## Status

Updated 2026-05-11 while completing `tg-01kr9hdhd3000008tjpc7wqr14`.

## Durable boundary

The Mainview transcript path is split into two focused seams:

- `src/mainview/app/transcript-pipeline.ts` owns renderer-facing decisions: item classification, expansion metadata and resolution, media descriptors, grouped virtual-row identity, transcript view-model item projection, markdown routing, tool-call presentation, and diff/file-change summaries.
- `src/mainview/app/transcript-state.ts` owns selected-Thread visible state: history merging, compact signatures, stable visible-row cache reuse/pruning, media payload extraction, synthetic loading/empty/error/notice/working rows, and transcript busy state.

`use-visible-messages.ts` is now a React adapter around `transcript-state.ts`. It still applies `useDeferredValue` for hot Thread message updates and clears the visible-row cache when the selected Thread changes, but it no longer owns row construction or media payload projection.

## Invariants

- History backfill must preserve stable row object identity when message signatures do not change, so transcript row-height caches can be reused.
- Media descriptors and actual payload data stay separate. The visible row exposes payload keys/byte metadata, while `VisibleMediaPayloads` maps loaded payload keys to base64 data.
- Deferred command/tool/diff content requests flow through transcript expansion metadata on prepared transcript view-model items instead of per-renderer ad hoc checks.
- Synthetic rows for loading, empty Thread guidance, active working status, chat errors, and notices are transcript state decisions, not chat surface decisions.
- Desktop and Mobile chat rows consume the same transcript view-model item array; layout code owns grouping/spacing while `message-ui.tsx` owns visual component composition for each prepared item.
- Regression tests should exercise the pipeline/state seams before renderer internals for large assistant messages, markdown/code routing, large diffs, tool-call summaries, media descriptors, and history backfill row stability.

## Validation surfaces

Focused regression coverage currently lives in:

- `src/mainview/app/transcript-state.test.ts`
- `src/mainview/app/transcript-pipeline.test.ts`
- `src/mainview/app/message-ui.test.tsx`

Current guardrails include pipeline-level coverage for large assistant text routing and non-copying view models, markdown/code routing, worker-threshold large diffs with summaries, tool-call summary labels, media row descriptors, and transcript-state history backfill preserving cached visible rows. Full validation should still include `bun validate` because the transcript row contract is consumed by `chat-workspace.tsx`, `message-ui.tsx`, `App.tsx`, and `thread-send.ts`.
