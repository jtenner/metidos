# Mainview Derived-State Memo Cleanup

## Summary

This page records the durable design and implementation shape for optimization slice `OPT03.3`, completed on 2026-04-11, which finished the first mainview cleanup track by tightening the remaining hot derived-state path instead of rewriting mainview state management.

Observed outcome: the repository now contains `src/mainview/app/mainview-derived-selectors.ts`, `src/mainview/app/mainview-derived-selectors.test.ts`, and an updated `src/mainview/app/use-mainview-derived-state.ts` that materializes project worktrees once, defers only sidebar search work, and partitions already ordered thread rows without re-sorting them.

Durable design conclusion: Metidos should keep expensive pure sidebar and worktree selectors outside React hooks, build search-only indexes only when a deferred sidebar query is non-empty, and avoid re-sorting thread rows that are already kept in recency order by the thread store.

Related areas:
- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- optimization planning under `./optimization-execution-proposal.md` and `./raw/optimization-proposals.md`

## Problem

Before `OPT03.3`, the initial controller extractions for `OPT03.1` and `OPT03.2` had landed, but `src/mainview/app/use-mainview-derived-state.ts` still owned several hot pure computations directly.

Observed behavior from the source design record:
- the hook repeatedly traversed project/worktree state for several separate memo paths
- sidebar search filtering required normalized project and worktree search-text blobs
- the thread list was re-sorted even though `threadStoreItems(threadStore)` already preserved recency order
- the remaining work was pure and memoizable, but its boundaries were not explicit enough

Durable problem statement: the mainview derived-state path should separate always-needed lookups from search-only indexes, keep expensive pure work testable outside React, and avoid paying for redundant ordering work.

## Current state before the slice

Observed prior state from the source document:
- `use-mainview-derived-state.ts` repeatedly called `projectStateWorktrees(getProjectState(project.id))` across multiple memo paths.
- Worktree lookup creation, display-path lookup creation, worktree search text creation, and project filtering each traversed project/worktree state separately.
- Sidebar search used the raw query path rather than a deferred input boundary.
- Thread partitioning still did `sortThreads(threads)` before splitting pinned and unpinned rows, even though the indexed thread store had already preserved ordering.

Observed consequence: the hook mixed orchestration with heavier pure selector work, and some of that work ran more often than necessary.

## Chosen design

Recommended and implemented design from the source:
- add `src/mainview/app/mainview-derived-selectors.ts` for the hottest pure selector logic
- materialize `projectWorktreesById` once through `deriveProjectWorktreesById(...)`
- split always-needed worktree lookup/display maps from search-only indexing work
- use `useDeferredValue(sidebarSearchQuery)` only for sidebar search
- export `partitionOrderedThreadsByPinnedState(...)` from `src/mainview/app/state.ts` and stop re-sorting already ordered thread rows
- document the mainview ownership boundary in `src/mainview/app/README.md`

Durable design rule: keep the React hook focused on memo orchestration and state wiring, while moving the heavier pure project/worktree and search selectors into dedicated testable helpers.

## Derived selector responsibilities

Observed implemented selector boundary in `src/mainview/app/mainview-derived-selectors.ts`:
- `deriveProjectWorktreesById(...)`
- `buildProjectWorktreeDerivedMaps(...)`
- `buildSidebarProjectSearchIndexes(...)`
- `filterProjectsBySidebarSearch(...)`
- pure helper exports such as `deriveWorktreeDisplayPathByKey(...)`, `deriveActiveContextUsage(...)`, `deriveReasoningEffortSelectorDisabled(...)`, and `dismissibleThreadStatusKey(...)`

Durable rule: when a mainview path is hot but pure, prefer extracting it into explicit selector helpers so the cost, tests, and memo boundaries stay legible.

## Hot-path memo boundaries

The durable derived-state sequence after this slice is:

1. materialize project worktrees once via `deriveProjectWorktreesById(...)`
2. build always-needed worktree lookup and display maps via `buildProjectWorktreeDerivedMaps(...)`
3. defer sidebar search input with `useDeferredValue(sidebarSearchQuery)`
4. build normalized search indexes only when the deferred query is non-empty via `buildSidebarProjectSearchIndexes(...)`
5. filter projects through `filterProjectsBySidebarSearch(...)`
6. partition already ordered thread rows through `partitionOrderedThreadsByPinnedState(...)`

This is the core durable outcome of `OPT03.3`: the repository now distinguishes between always-needed derived state and search-only work, and it treats deferred search as the only justified lagging path in this hook.

## Deferred-search rationale

Observed reasoning from the source design record:
- sidebar search fans out into project and worktree filtering
- it is user-typed input
- the expensive work is pure and memoized
- a small lag between the text field and the filtered list is acceptable while typing

Durable rule: `useDeferredValue(...)` should be used narrowly where pure fan-out work is measurably expensive and behaviorally safe to lag, not spread indiscriminately across unrelated mainview inputs.

## Thread ordering rule

Observed implementation change from the source:
- `threads` already arrive from `threadStoreItems(threadStore)` in the store's maintained recency order
- `state.ts` now exports `partitionOrderedThreadsByPinnedState(...)`
- the derived-state hook partitions pinned versus unpinned rows directly instead of sorting first

Durable rule: mainview should preserve store-maintained ordering instead of re-sorting derived thread lists unless a later slice changes the ordering contract itself.

## Validation and measured outcomes

Observed synthetic selector benchmark recorded in the source document, using `3000` projects, `12000` worktrees, `10000` threads, and `50` averaged iterations:

| Selector path | Mean ms/run |
| --- | ---: |
| `buildProjectWorktreeDerivedMaps(...)` | `30.63` |
| `buildSidebarProjectSearchIndexes(...)` | `27.54` |
| `filterProjectsBySidebarSearch(...)` | `5.10` |
| legacy `sortThreads(...)` plus pinned partition on already ordered rows | `0.38` |
| `partitionOrderedThreadsByPinnedState(...)` | `0.09` |

Observed interpretation from the source:
- search-text indexing is expensive enough to skip when sidebar search is empty
- deferring only sidebar search is justified
- replacing “sort then partition” with “partition already ordered rows” materially reduces that micro-path

Observed structural outcomes recorded in the source document:

| Metric in `src/mainview/app/use-mainview-derived-state.ts` | Before | After | Change |
| --- | ---: | ---: | ---: |
| lines | `778` | `660` | `-118` |
| `useMemo(` count | `33` | `31` | `-2` |
| `useCallback(` count | `3` | `3` | `0` |
| `useEffect(` count | `1` | `1` | `0` |
| `useDeferredValue(` count | `0` | `1` | `+1` |

Interpretation: these numbers are structural and local benchmark evidence that the derived-state path became smaller and more explicit; they are not a claim of end-to-end latency in isolation.

## Explicit non-goals

The source document explicitly excluded these changes from `OPT03.3`:
- introducing a new store library
- rewriting `state.ts` or `use-mainview-derived-state.ts` wholesale
- adding deferred behavior to unrelated inputs
- changing project/worktree selection semantics
- changing panel props or RPC payloads

Durable scope rule: treat this slice as targeted hot-path cleanup, not a state-management redesign.

## Affected files

Observed file set from the completed slice:
- `src/mainview/app/mainview-derived-selectors.ts`
- `src/mainview/app/mainview-derived-selectors.test.ts`
- `src/mainview/app/use-mainview-derived-state.ts`
- `src/mainview/app/state.ts`
- `src/mainview/app/state.test.ts`
- `src/mainview/app/README.md`

## Validation

Observed validation recorded by the source:
- `bun run format`
- `bun run validate`
- selector coverage in `src/mainview/app/mainview-derived-selectors.test.ts`
- ordering coverage for `partitionOrderedThreadsByPinnedState(...)` in `src/mainview/app/state.test.ts`
- retained pure-helper coverage in `src/mainview/app/use-mainview-derived-state.test.ts`

## Durable takeaway

The enduring lesson from `OPT03.3` is that Metidos should tighten hot derived-state paths by extracting pure selectors, separating always-needed maps from search-only indexes, deferring only the search work that measured evidence justifies, and preserving store-maintained ordering instead of re-sorting derived rows.