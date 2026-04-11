# 2026-04-11 OPT03.1 Thread-Status and Selected-Thread Controller Extraction

**Status:** completed on 2026-04-11  
**Slice:** [OPT03.1](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt01-3-baseline-benchmark.md](./2026-04-11-opt01-3-baseline-benchmark.md)

## Summary

This slice extracts the **thread-status polling and selected-thread refresh controller** out of `src/mainview/App.tsx` and into a dedicated memoized controller module:

- new controller module: `src/mainview/app/use-thread-status-controller.ts`
- supporting pure refresh helpers remain in `src/mainview/thread-status-refresh.ts`

The extraction keeps behavior the same, but narrows where this hot controller logic lives and what it depends on.

That matters because thread-status polling is one of the highest-churn controller paths in the mainview shell:

- it runs on an interval while threads are active,
- it reacts to document visibility changes,
- it may also escalate from summary polling into selected-thread detail refreshes.

Before this slice, that whole path lived inline inside `App.tsx`.

## What this slice was meant to do

Per the execution proposal, `OPT03.1` needed to:

- move thread-status polling out of `App.tsx`,
- move selected-thread refresh logic out of `App.tsx`,
- preserve current selected-thread correctness,
- reduce unrelated rerenders from this controller path.

It explicitly did **not** need to:

- change the websocket or polling protocol,
- dedupe refreshes more aggressively,
- redesign thread store state,
- introduce a global state library.

Those remain later-slice work if still justified.

## What changed

## 1. Added a dedicated thread-status controller module

New file:

- [src/mainview/app/use-thread-status-controller.ts](../src/mainview/app/use-thread-status-controller.ts)

This module now owns the hot controller path for:

- selecting which thread ids should be polled,
- running the periodic thread-status poll loop,
- refreshing once when the document becomes visible again,
- deciding when a selected-thread summary change requires a full detail refresh,
- committing refreshed summaries/detail back into the thread store,
- keeping selected-thread refs in sync and discarding previous empty threads when selection changes.

## 2. Wrapped the controller in a memoized null-render component

The new module exports `ThreadStatusController`, a memoized controller component that returns `null` and only receives the narrow prop set needed for thread-status work.

That is the main render-boundary improvement in this slice.

Instead of letting every `App.tsx` rerender also rerun the inline polling controller logic, the controller now sits behind a `memo(...)` boundary with only these relevant inputs:

- `threads`
- `selectedThreadId`
- `isDocumentVisible`
- the selected-thread refs
- the specific callbacks/procedures needed for refresh work

As a result, unrelated shell state such as:

- chat input edits,
- git-history modal state,
- settings-panel state,
- cron panel state,
- other top-level UI toggles

no longer need to rerender the controller path when that narrow prop set is unchanged.

## 3. Kept the pure refresh decisions in `thread-status-refresh.ts`

`src/mainview/thread-status-refresh.ts` now also exposes two small pure helpers that the controller uses:

- `listWorkingThreadIds(...)`
- `shouldRefreshSelectedThreadDetail(...)`

These keep the poll-selection and selected-detail escalation rules testable without reintroducing a large inline block into `App.tsx`.

## 4. Extended thread-status tests

`src/mainview/thread-status-refresh.test.ts` now covers:

- extracting only working thread ids for polling,
- the selected-thread detail-refresh decision rules for:
  - active working threads,
  - working → idle transitions,
  - first arrival of `failed`,
  - first arrival of `stopped`,
  - no-op terminal-state repeats.

The existing store-merge and selected-detail-commit tests remain in place.

## 5. Updated the mainview README

`src/mainview/app/README.md` now documents the new controller module and its responsibility boundary.

## Performance-focused validation

This slice is mostly about **controller isolation and render-boundary cleanup**, so the most meaningful validation is structural rather than a synthetic RPC benchmark.

## Static shell-complexity reduction

Comparing `App.tsx` before and after the slice:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| lines | `6850` | `6682` | `-168` |
| `useEffect(` count | `46` | `43` | `-3` |
| `useCallback(` count | `115` | `114` | `-1` |
| `useRef(` count | `26` | `24` | `-2` |
| `useMemo(` count | `12` | `11` | `-1` |

Those numbers are not a runtime benchmark by themselves, but they do show that one of the highest-churn controller paths is no longer inlined inside the already-large app shell.

## Why the memoized controller matters

A plain custom hook extraction would have improved organization but not the render boundary.

This slice goes one step further by mounting the controller as a memoized null-render component.

That means React can skip rerunning the controller on unrelated parent rerenders when its narrow prop set is unchanged.

That is the real performance-oriented part of the extraction.

## Behavior-preservation validation

The usual repository checks were run after the change:

- `bun run format`
- `bun run validate`

That includes the existing thread-status refresh tests plus the full repository validation suite.

## What this slice explicitly did not do

To stay disciplined, this slice did **not** add:

- thread-status request dedupe beyond the existing in-flight guard,
- new websocket batching,
- selected-thread detail caching changes,
- store-library migration,
- broad `App.tsx` decomposition outside the thread-status path.

Those remain later-slice work:

- `OPT03.2` for more controller extraction,
- `OPT05.2` if the refresh path still needs dedupe after payload measurement.

## Files changed by the slice

- [src/mainview/App.tsx](../src/mainview/App.tsx)
- [src/mainview/app/use-thread-status-controller.ts](../src/mainview/app/use-thread-status-controller.ts)
- [src/mainview/thread-status-refresh.ts](../src/mainview/thread-status-refresh.ts)
- [src/mainview/thread-status-refresh.test.ts](../src/mainview/thread-status-refresh.test.ts)
- [src/mainview/app/README.md](../src/mainview/app/README.md)

## Completion note

`OPT03.1` is complete.

It extracts the thread-status and selected-thread refresh controller into a dedicated memoized module, preserves the current polling/detail-refresh behavior, and gives the mainview shell a sharper boundary around one of its hottest controller paths without widening scope into protocol or state-management redesign.
