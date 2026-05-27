# Thread-Status Refresh Dedupe

## Summary

This page records the durable design and implementation outcome for optimization slice `OPT05.2`, completed on 2026-04-11. Metidos kept its existing polling and transport model, but reduced redundant frontend thread-status refresh work inside the extracted thread-status controller path.

Observed outcome as of 2026-04-11:

- overlapping `listThreadStatuses(...)` refreshes now reuse the in-flight request when the working-thread id set is unchanged
- one changed-id follow-up refresh may be queued when the working-thread set changes during an in-flight refresh
- selected-thread detail refreshes are skipped when the already-loaded detail matches the current selected summary snapshot
- the slice preserves existing polling, websocket, and selected-thread merge semantics

Related pages:

- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [rpc-payload-measurement](./rpc-payload-measurement.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)

## Problem

`OPT03.1` had already extracted thread-status polling and selected-thread refresh orchestration into `src/mainview/app/use-thread-status-controller.ts`. `OPT05.1` then ranked high-byte transport paths so later transport work could be prioritized with measurement instead of guesswork.

The remaining client-side problem was redundant refresh churn inside the existing controller path:

- overlapping polling and visibility-triggered refreshes could request the same thread-status work again while a prior request was still in flight
- selected-thread detail could be reloaded repeatedly even when the selected working-thread summary snapshot had not changed
- the repository needed to reduce that waste without changing RPC shapes, websocket behavior, or the polling model

Durable problem statement: Metidos should dedupe redundant frontend thread-status refresh work before considering protocol-level transport changes.

## Current state before the slice

Observed from the source document:

- `src/mainview/app/use-thread-status-controller.ts` already owned thread-status polling and selected-thread refresh orchestration
- the controller used a simple in-flight guard for status refreshes, but did not distinguish same-request duplicates from changed working-thread sets
- selected-thread detail refresh decisions depended on run-state transitions, but not on whether the UI already held detail for the same summary snapshot
- `src/mainview/thread-status-refresh.ts` already held pure refresh-decision helpers and tests

Observed consequence: correctness was preserved, but unchanged working summaries and overlapping triggers could still produce unnecessary `getThread(...)` and `listThreadStatuses(...)` churn.

## Chosen design

Recommended and implemented design from the source:

- keep the protocol and polling model unchanged
- add explicit pure helper functions in `src/mainview/thread-status-refresh.ts` for request-key and queue resolution logic
- let the controller track the active thread-status request key, its shared in-flight promise, and one optional queued follow-up request
- add a selected-thread detail refresh key so the controller can compare the latest selected summary snapshot with the detail already loaded into the UI
- refresh selected-thread detail only when the run-state transition or summary snapshot actually requires it

Durable design rule: dedupe request churn first inside the client controller boundary before escalating to transport redesign.

## Durable helper and controller rules

### Reuse in-flight thread-status refreshes for identical request sets

The source introduced pure helpers:

- `buildThreadStatusRequestKey(...)`
- `resolveQueuedThreadStatusRefreshRequest(...)`
- `buildSelectedThreadDetailRefreshKey(...)`

These helpers make the dedupe rules explicit and testable outside React.

Durable rule:

- if a new refresh request matches the currently in-flight working-thread id set, reuse the active request instead of starting another one
- if a new refresh request differs, keep at most one queued follow-up refresh
- if the queued follow-up matches the just-completed request, discard it as redundant

This preserves visibility and polling correctness while preventing immediate duplicate reruns.

### Treat selected-thread detail as keyed to the selected summary snapshot

Observed implementation boundary:

- `src/mainview/App.tsx` maintains `selectedThreadDetailRefreshKeyRef`
- that key is updated when selected-thread detail is actually committed through `replaceSelectedThreadMessageHistory(...)` or `mergeSelectedThreadMessageHistory(...)`
- the key is reset when the selected thread changes or is cleared

Durable rule: the controller should compare the currently selected summary snapshot against the last detail snapshot actually loaded into the UI, not just against the previous run state.

### Skip selected-detail reloads when nothing meaningful changed

The slice preserved selected-detail refreshes for genuine state changes such as:

- entering `working`
- leaving `working`
- first transition to `failed`
- first transition to `stopped`
- any selected-summary snapshot change

But it now skips redundant `getThread(...)` reloads when:

- the selected thread is still working
- the selected summary snapshot is unchanged
- and the UI already has detail for that exact snapshot

Durable takeaway: selected-thread correctness should be snapshot-aware, not just transition-aware.

## Measured rationale preserved from the source

### Unchanged selected working-summary sequence

The source preserved a focused helper-level simulation across `8` consecutive polling passes for the same selected working-thread summary snapshot:

| Behavior | Detail refreshes |
|---|---:|
| previous logic | `8` |
| new logic | `1` |

Observed interpretation: this unchanged-snapshot case reduced selected-detail refreshes by about `87.5%`.

### Queued follow-up request behavior

The source also preserved the queue-resolution examples:

- completed ids `[7, 9]` plus queued ids `[7, 9]` => no follow-up refresh
- completed ids `[7, 9]` plus queued ids `[7, 11]` => one follow-up refresh for `[7, 11]`

Durable interpretation: the controller should suppress same-request reruns but still honor one changed-id follow-up.

## Scope boundaries and non-goals

The source explicitly kept these out of `OPT05.2`:

- websocket push redesign
- RPC payload changes
- protocol batching
- selected-thread message-merge redesign
- polling-model removal
- polling-interval changes

This is a durable planning boundary: `OPT05.2` reduces avoidable refresh churn within the current controller design, but it does not redesign transport semantics.

## Key implementation areas

The source named these repository surfaces as the main implementation areas:

- `src/mainview/App.tsx`
- `src/mainview/app/use-thread-status-controller.ts`
- `src/mainview/thread-status-refresh.ts`
- `src/mainview/thread-status-refresh.test.ts`
- `src/mainview/app/README.md`

## Validation status

Observed in the source document:

- `bun run format`
- `bun run validate`
- targeted helper-level dedupe simulation for unchanged working selected-thread summaries

## Relationship to adjacent slices

The source positioned this slice as the disciplined follow-up to earlier measurement and controller extraction work:

- [mainview-thread-status-controller](./mainview-thread-status-controller.md) established the dedicated controller boundary for polling and selected-thread refresh orchestration
- [rpc-payload-measurement](./rpc-payload-measurement.md) ranked transport-heavy paths so follow-up work could be prioritized by evidence
- `OPT05.2` reduced avoidable refresh churn inside the existing controller before any protocol-level batching or transport redesign was considered

## Source

Ingested from `docs/2026-04-11-opt05-2-thread-status-refresh-dedupe.md` on 2026-04-19, then removed from `docs/` after the durable knowledge was preserved in the wiki.
