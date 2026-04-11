# 2026-04-11 OPT05.2 Thread-Status Refresh Dedupe

**Status:** completed on 2026-04-11  
**Slice:** [OPT05.2](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt03-1-thread-status-controller.md](./2026-04-11-opt03-1-thread-status-controller.md)
- [docs/2026-04-11-opt05-1-rpc-payload-measurement.md](./2026-04-11-opt05-1-rpc-payload-measurement.md)

## Summary

`OPT05.2` reduces redundant frontend thread-status refresh work without changing the transport protocol.

This slice focuses on the controller path extracted in `OPT03.1` and makes two targeted changes:

1. reuse an in-flight `listThreadStatuses(...)` refresh instead of letting overlapping triggers start a second controller path, and
2. stop reloading selected-thread detail when the latest loaded detail already matches the current selected summary snapshot.

The result stays behavior-preserving for visibility-triggered refreshes and selected-thread correctness while reducing needless selected-detail `getThread(...)` churn.

## Scope of the slice

Per the execution plan, this slice needed to:

- reduce redundant `listThreadStatuses` work on the client,
- preserve selected-thread detail correctness,
- keep visibility-triggered refresh behavior correct.

This slice intentionally did **not**:

- redesign websocket pushes,
- change RPC payload shapes,
- add protocol batching,
- change the selected-thread message merge semantics,
- remove the existing polling model.

Those remain later-slice concerns.

## What changed

## 1. Added explicit thread-status request dedupe helpers

Updated file:

- [src/mainview/thread-status-refresh.ts](../src/mainview/thread-status-refresh.ts)

New pure helpers now define the refresh-dedupe rules:

- `buildThreadStatusRequestKey(...)`
- `resolveQueuedThreadStatusRefreshRequest(...)`
- `buildSelectedThreadDetailRefreshKey(...)`

These keep the controller’s dedupe decisions testable outside React.

## 2. Reused in-flight status refreshes in the controller

Updated file:

- [src/mainview/app/use-thread-status-controller.ts](../src/mainview/app/use-thread-status-controller.ts)

Before this slice, overlapping triggers were guarded by a simple in-flight boolean. That prevented overlap, but it also meant the controller did not explicitly distinguish between:

- a duplicate refresh request for the same working-thread set,
- a newer refresh request for a different working-thread set.

Now the controller tracks:

- the active request key,
- a shared in-flight refresh promise,
- an optional queued follow-up thread-id set.

### New behavior

- if another refresh arrives for the **same** working-thread id set while one is already in flight, it reuses the active request;
- if another refresh arrives for a **different** working-thread id set while one is in flight, it queues one follow-up refresh after the current one finishes;
- if the queued refresh matches the just-completed id set, the follow-up is discarded as redundant.

That keeps visibility-triggered and polling-triggered refreshes from racing each other while still allowing one changed-id follow-up when the working-thread set actually changed.

## 3. Added selected-detail refresh-key tracking

Updated files:

- [src/mainview/App.tsx](../src/mainview/App.tsx)
- [src/mainview/app/use-thread-status-controller.ts](../src/mainview/app/use-thread-status-controller.ts)

`App.tsx` now maintains:

- `selectedThreadDetailRefreshKeyRef`

and updates it whenever selected-thread detail is actually applied to the UI through:

- `replaceSelectedThreadMessageHistory(...)`
- `mergeSelectedThreadMessageHistory(...)`

It resets the key when thread selection changes or is cleared.

That gives the thread-status controller one stable source of truth for:

- “what selected-thread detail snapshot has already been loaded into the UI?”

## 4. Stopped re-fetching selected detail when the summary snapshot is unchanged

`shouldRefreshSelectedThreadDetail(...)` now considers both:

- the previous selected run state, and
- the last loaded selected-detail refresh key.

That means the controller still refreshes selected detail when it should:

- entering `working`,
- leaving `working`,
- first transition to `failed`,
- first transition to `stopped`,
- or any time the selected summary snapshot changed.

But it now skips redundant `getThread(...)` reloads when:

- the selected thread is still working,
- the selected summary snapshot is unchanged,
- and the UI already has detail loaded for that exact snapshot.

This is the main selected-detail dedupe win in the slice.

## Test coverage added or expanded

Updated file:

- [src/mainview/thread-status-refresh.test.ts](../src/mainview/thread-status-refresh.test.ts)

The tests now verify:

- unchanged selected working summaries no longer force another detail refresh once the same snapshot is already loaded,
- thread-status request keys are stable,
- queued follow-up refreshes are dropped when the completed and queued thread-id sets are identical,
- queued follow-up refreshes are preserved when the working-thread id set actually changed.

## Measured rationale

A focused helper-level simulation was run locally against the selected-detail decision rule.

### Unchanged working-summary sequence

Simulated `8` consecutive polling passes for the same selected working-thread summary snapshot.

| Behavior | Detail refreshes |
|---|---:|
| previous logic | `8` |
| new logic | `1` |

That is a reduction of about `87.5%` for this unchanged-snapshot case.

### Queued status refresh follow-up behavior

For the new queue helper:

- completed ids `[7, 9]` + queued ids `[7, 9]` => no follow-up refresh
- completed ids `[7, 9]` + queued ids `[7, 11]` => one follow-up refresh for `[7, 11]`

That is exactly the intended dedupe rule: do not immediately rerun the same status request, but do honor one changed-id follow-up.

## Why this slice matters after OPT05.1

`OPT05.1` identified the high-byte transport paths and made the ranking visible.

`OPT05.2` stays disciplined by not changing protocol behavior yet. Instead, it reduces client-side refresh churn in the existing controller path so later work can ask a cleaner question:

- after the frontend stops doing avoidable duplicate status/detail work, is there still enough remaining transport noise to justify batching in conditional `OPT05.3`?

That is a better sequence than jumping straight from measurement to protocol changes.

## What stayed intentionally unchanged

To keep this slice narrow and behavior-safe, it does **not**:

- change the polling interval,
- remove selected-thread detail refreshes during genuine working-state changes,
- introduce new RPC methods,
- batch websocket messages,
- change thread-selection semantics.

## Files changed by the slice

- [src/mainview/App.tsx](../src/mainview/App.tsx)
- [src/mainview/app/use-thread-status-controller.ts](../src/mainview/app/use-thread-status-controller.ts)
- [src/mainview/thread-status-refresh.ts](../src/mainview/thread-status-refresh.ts)
- [src/mainview/thread-status-refresh.test.ts](../src/mainview/thread-status-refresh.test.ts)
- [src/mainview/app/README.md](../src/mainview/app/README.md)

## Validation performed

- `bun run format`
- `bun run validate`
- targeted helper-level dedupe simulation for unchanged working selected-thread summaries

## Completion note

`OPT05.2` is complete.

Metidos now reuses in-flight thread-status refreshes more deliberately and avoids re-fetching selected-thread detail when the selected summary snapshot is unchanged, reducing client-side refresh churn while preserving the existing polling and selection model.
