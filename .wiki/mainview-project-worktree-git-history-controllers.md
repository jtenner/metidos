# Mainview Project/Worktree and Git-History Controllers

## Summary

This page records the durable design and implementation shape for optimization slice `OPT03.2`, completed on 2026-04-11, which extracted Metidos's project/worktree loading orchestration and git-history refresh/pagination/diff orchestration out of `src/mainview/App.tsx` into dedicated controller hooks.

Observed outcome: the repository now contains `src/mainview/app/use-project-worktree-controller.ts` and `src/mainview/app/use-git-history-controller.ts`, and `src/mainview/app/README.md` documents those hooks as the owners of the corresponding mainview controller boundaries.

Durable design conclusion: Metidos should keep project/worktree loading and git-history orchestration behind narrow dedicated controller hooks instead of leaving those async coordination paths inline in `App.tsx`, while keeping pure decision helpers separately testable and deferring transport, websocket, and state-model redesign to later measured slices.

Related areas:
- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md)
- optimization planning under `./optimization-execution-proposal.md` and `./raw/optimization-proposals.md`
- later follow-up work including [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md) and `./thread-status-refresh-dedupe.md`

## Problem

Before `OPT03.2`, two more high-churn mainview orchestration blocks still lived inline inside `src/mainview/App.tsx`:

Observed behavior from the source design record:
- project/worktree loading controlled sidebar and workspace open-state behavior
- selected-thread hydration could require opening the corresponding project/worktree before the workspace was available
- git-history refresh reacted to selection changes, invalidations, and pagination
- commit-diff modal loading could race with selection changes and other concurrent work

Durable problem statement: these paths are correctness-sensitive and frequently exercised, so keeping them inline in the top-level shell increases controller density and makes `App.tsx` harder to reason about, test, and evolve.

## Current state before the slice

Observed prior state from the source document:
- `src/mainview/App.tsx` directly owned project/worktree refresh decisions, worktree-open orchestration, selected-thread workspace hydration, git-history refresh/load-more behavior, and commit-diff modal loading.
- Project/worktree helper logic already existed in `src/mainview/project-worktree-refresh.ts`, but the main ownership boundary still sat in `App.tsx`.
- Git-history behavior depended on invalidation, pagination, request sharing, and modal lifecycle concerns that were interleaved with unrelated shell state.

Observed consequence: the main shell was still coordinating a large amount of async state that was logically separable from the rest of the UI.

## Chosen design

Recommended and implemented design from the source:
- add `src/mainview/app/use-project-worktree-controller.ts`
- add `src/mainview/app/use-git-history-controller.ts`
- move project/worktree cached-load reuse, refresh decisions, request sharing, worktree-open transitions, and selected-thread hydration into the first hook
- move git-history first-page reuse, refresh behavior, load-more pagination, invalidation handling, and commit-diff modal orchestration into the second hook
- keep pure decision helpers exported and covered by focused tests
- update `src/mainview/app/README.md` to document the controller ownership boundaries

Durable architectural rule: when `App.tsx` accumulates broad async coordination for a distinct domain such as workspace loading or git history, extract that orchestration into a dedicated controller hook with a clear ownership boundary rather than preserving it as inline shell logic.

## Project/worktree controller responsibilities

Observed implemented responsibility boundary for `use-project-worktree-controller.ts`:
- reuse cached loaded project/worktree state when it is still valid
- decide when a refresh is required instead of cached reuse
- share in-flight project/worktree requests
- manage rollback-safe project close/open transitions
- open worktrees on demand
- hydrate the selected thread's workspace when the thread points at a project/worktree that is not yet opened

The source frames this as ownership extraction, not a change to thread-selection or worktree-open semantics.

## Git-history controller responsibilities

Observed implemented responsibility boundary for `use-git-history-controller.ts`:
- reuse cached first-page git history when appropriate
- refresh git history when selection or invalidation requires it
- load additional history pages while preserving current pagination behavior
- subscribe to worktree-history invalidation events
- load commit diffs for the modal view
- share and cancel commit-diff requests safely

Durable rule: keep git-history invalidation, pagination, and diff-modal coordination together behind a dedicated controller boundary so they do not sprawl back into the main shell.

## Pure helper boundary

Observed helper coverage retained or expanded by the slice:
- `src/mainview/project-worktree-refresh.ts` exports `buildLoadedProjectWorktreesState(...)` and `shouldUseCachedProjectWorktrees(...)`
- `src/mainview/project-worktree-refresh.test.ts` verifies those project/worktree helper decisions
- `src/mainview/app/use-git-history-controller.ts` exports `resolveGitHistoryLoadBehavior(...)` and `canLoadMoreGitHistory(...)`
- `src/mainview/app/use-git-history-controller.test.ts` covers the git-history controller decisions

Durable rule: keep reusable state-shaping and refresh-decision logic available as pure helpers when possible so controller extractions improve testability rather than hiding logic inside effect-heavy modules.

## Structural validation and outcomes

Observed structural outcomes recorded in the source document:

| Metric in `src/mainview/App.tsx` | Before | After | Change |
| --- | ---: | ---: | ---: |
| lines | `6684` | `5669` | `-1015` |
| `useEffect(` count | `43` | `36` | `-7` |
| `useCallback(` count | `114` | `94` | `-20` |
| `useRef(` count | `24` | `15` | `-9` |
| `useMemo(` count | `11` | `10` | `-1` |

Observed validation recorded by the source:
- `bun run format`
- `bun run validate`
- focused coverage for project/worktree cached-load decisions and loaded-state shaping
- focused coverage for git-history cached-load and load-more guard conditions

Interpretation: these numbers are structural evidence that the main shell now owns substantially less controller logic directly; they are not a standalone latency benchmark.

## Explicit non-goals

The source document explicitly excluded these changes from `OPT03.2`:
- websocket invalidation redesign
- git-history RPC payload changes
- request batching changes
- thread/worktree selection rule changes
- new state-library adoption
- transport-layer redesign

Durable scope rule: treat this slice as a controller-boundary extraction that preserves existing behavior, not as the point where protocol or data semantics changed.

## Affected files

Observed file set from the completed slice:
- `src/mainview/App.tsx`
- `src/mainview/app/use-project-worktree-controller.ts`
- `src/mainview/app/use-git-history-controller.ts`
- `src/mainview/project-worktree-refresh.ts`
- `src/mainview/project-worktree-refresh.test.ts`
- `src/mainview/app/use-git-history-controller.test.ts`
- `src/mainview/app/README.md`

## Durable takeaway

The enduring lesson from `OPT03.2` is that Metidos's mainview shell should continue shrinking by moving distinct async orchestration domains into dedicated controller hooks with clear ownership boundaries and separately testable pure helpers. For project/worktree loading and git-history behavior specifically, the repository should preserve `use-project-worktree-controller.ts` and `use-git-history-controller.ts` as the owners of those hot controller paths rather than drifting that logic back into `App.tsx`.
