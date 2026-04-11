# 2026-04-11 OPT03.3 Targeted Derived-State and Memo Cleanup

**Status:** completed on 2026-04-11  
**Slice:** [OPT03.3](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt03-1-thread-status-controller.md](./2026-04-11-opt03-1-thread-status-controller.md)
- [docs/2026-04-11-opt03-2-project-worktree-git-history-controllers.md](./2026-04-11-opt03-2-project-worktree-git-history-controllers.md)

## Summary

`OPT03.3` finishes the initial `OPT03` track by tightening the remaining hot derived-state path instead of rewriting mainview state management.

This slice does three targeted things:

1. extracts the hottest pure sidebar/worktree selectors out of `use-mainview-derived-state.ts`,
2. defers sidebar search filtering with `useDeferredValue(...)`,
3. removes one redundant thread-list re-sort from the derived-state hook.

The result keeps the existing UI contracts intact while making the hot memo boundaries explicit and cheaper.

## Scope of the slice

Per the execution plan, this slice needed to:

- extract selected pure helper computations from `use-mainview-derived-state.ts`,
- add `useDeferredValue` only where it was justified,
- document the chosen hot-path memo boundaries.

This slice intentionally did **not**:

- introduce a new store library,
- rewrite `state.ts` or `use-mainview-derived-state.ts` wholesale,
- add deferred search behavior to unrelated inputs,
- change project/worktree selection semantics,
- change panel props or RPC payloads.

## What changed

## 1. Extracted pure derived selectors into a dedicated module

New file:

- [src/mainview/app/mainview-derived-selectors.ts](../src/mainview/app/mainview-derived-selectors.ts)

This module now owns the pure selectors that were most useful to separate from the React hook:

- `deriveProjectWorktreesById(...)`
- `buildProjectWorktreeDerivedMaps(...)`
- `buildSidebarProjectSearchIndexes(...)`
- `filterProjectsBySidebarSearch(...)`
- existing pure helpers such as:
  - `deriveWorktreeDisplayPathByKey(...)`
  - `deriveActiveContextUsage(...)`
  - `deriveReasoningEffortSelectorDisabled(...)`
  - `dismissibleThreadStatusKey(...)`

That means the hook now orchestrates memo boundaries while the heavier project/worktree search computations are testable outside React.

## 2. Materialized project worktrees once and reused that snapshot

Before this slice, `use-mainview-derived-state.ts` repeatedly called `projectStateWorktrees(getProjectState(project.id))` across multiple separate memos for:

- worktree lookup creation,
- display-path lookup creation,
- worktree search text creation,
- project filtering.

Now the hook first builds one memoized `projectWorktreesById` snapshot via `deriveProjectWorktreesById(...)`, and later selectors reuse that shared materialized view.

That narrows repeated project/worktree traversal and makes the dependency chain easier to reason about.

## 3. Split always-needed worktree maps from search-only indexes

The slice now distinguishes between:

### Always-needed derived maps

Built on normal project/worktree updates:

- `worktreeByProjectAndPath`
- `worktreeDisplayPathByKey`

### Search-only derived indexes

Built only while a deferred sidebar search query is non-empty:

- `projectSearchTextById`
- `worktreeSearchTextByKey`

That matters because formatted display paths are reused all over the sidebar and workspace UI, but normalized search-text blobs are only useful while the user is actively filtering.

## 4. Deferred only the sidebar search path

`use-mainview-derived-state.ts` now uses:

- `useDeferredValue(sidebarSearchQuery)`

and normalizes the deferred value instead of the raw keystroke value.

This was the narrowest place where deferred work was justified:

- sidebar search fans out into project and worktree filtering,
- it is user-typed input,
- the heavy work is pure and already memoized,
- the search result list can safely lag slightly behind the text field while typing.

This slice does **not** add `useDeferredValue` elsewhere because the current evidence did not justify widening that behavior.

## 5. Removed a redundant thread-list re-sort

`threads` passed into `useMainviewDerivedState(...)` already come from `threadStoreItems(threadStore)`, which preserves the recency ordering maintained by the indexed thread store.

Before this slice, the hook still did:

- `sortThreads(threads)`
- then a pinned/unpinned partition

on every relevant derived-state recompute.

Now `state.ts` exports:

- `partitionOrderedThreadsByPinnedState(...)`

and the hook directly partitions the already-ordered thread rows without re-sorting them.

## Test coverage added or expanded

### New selector coverage

Added:

- [src/mainview/app/mainview-derived-selectors.test.ts](../src/mainview/app/mainview-derived-selectors.test.ts)

This covers:

- project worktree materialization from indexed project state,
- shared worktree lookup and display-path map creation,
- project filtering by either project metadata or worktree search text,
- deterministic filtering on a larger synthetic dataset.

### Thread partition coverage

Expanded:

- [src/mainview/app/state.test.ts](../src/mainview/app/state.test.ts)

to verify that `partitionOrderedThreadsByPinnedState(...)` preserves the thread-store ordering instead of re-sorting.

### Existing pure helper coverage retained

- [src/mainview/app/use-mainview-derived-state.test.ts](../src/mainview/app/use-mainview-derived-state.test.ts)

still covers the pure helper exports that remain part of the hook module surface via re-export.

## Measured rationale for the chosen memo boundaries

A synthetic selector benchmark was run locally against:

- `3000` projects
- `12000` worktrees
- `10000` threads
- `50` averaged iterations per selector path

### Mean time per run

| Selector path | Mean ms/run |
|---|---:|
| `buildProjectWorktreeDerivedMaps(...)` | `30.63` |
| `buildSidebarProjectSearchIndexes(...)` | `27.54` |
| `filterProjectsBySidebarSearch(...)` | `5.10` |
| legacy `sortThreads(...)` + pinned partition on already ordered rows | `0.38` |
| `partitionOrderedThreadsByPinnedState(...)` | `0.09` |

### Key takeaways

1. **Search-text indexing is materially non-trivial.**  
   On large project/worktree snapshots, building the normalized sidebar search indexes costs about `27.54 ms/run` in this synthetic scenario. That is enough to justify not paying for it at all when the sidebar search box is empty.

2. **Deferring only sidebar search is justified.**  
   The search path is the one place where input-driven derived-state work is heavy enough to benefit from React’s deferred rendering behavior while remaining behaviorally safe.

3. **The redundant thread re-sort was real overhead.**  
   Replacing “sort then partition” with “partition the already ordered rows” reduced that micro-path from `0.38 ms` to `0.09 ms` per run in the synthetic thread benchmark, a roughly `76.3%` improvement for that step.

## Structural validation

Comparing `src/mainview/app/use-mainview-derived-state.ts` before and after this slice:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| lines | `778` | `660` | `-118` |
| `useMemo(` count | `33` | `31` | `-2` |
| `useCallback(` count | `3` | `3` | `0` |
| `useEffect(` count | `1` | `1` | `0` |
| `useDeferredValue(` count | `0` | `1` | `+1` |

The hook is smaller, but more importantly its expensive pure work has been split into explicit selectors with narrower memo boundaries.

## Hot-path memo boundaries after this slice

The main derived-state path now follows this sequence:

1. **materialize project worktrees once**  
   `deriveProjectWorktreesById(...)`
2. **build always-needed worktree lookup and display maps once**  
   `buildProjectWorktreeDerivedMaps(...)`
3. **defer sidebar search input**  
   `useDeferredValue(sidebarSearchQuery)`
4. **only when the deferred query is non-empty, build search indexes**  
   `buildSidebarProjectSearchIndexes(...)`
5. **filter projects against those indexes**  
   `filterProjectsBySidebarSearch(...)`
6. **partition already ordered thread rows without re-sorting**  
   `partitionOrderedThreadsByPinnedState(...)`

That is the exact hot-path boundary choice this slice aimed to make explicit.

## Files changed by the slice

- [src/mainview/app/mainview-derived-selectors.ts](../src/mainview/app/mainview-derived-selectors.ts)
- [src/mainview/app/mainview-derived-selectors.test.ts](../src/mainview/app/mainview-derived-selectors.test.ts)
- [src/mainview/app/use-mainview-derived-state.ts](../src/mainview/app/use-mainview-derived-state.ts)
- [src/mainview/app/state.ts](../src/mainview/app/state.ts)
- [src/mainview/app/state.test.ts](../src/mainview/app/state.test.ts)
- [src/mainview/app/README.md](../src/mainview/app/README.md)

## Validation performed

- `bun run format`
- `bun run validate`

## Completion note

`OPT03.3` is complete.

The mainview derived-state path now keeps always-needed worktree maps separate from search-only indexes, defers only the sidebar search path that justified it, and avoids re-sorting thread rows that the indexed store already keeps ordered.
