# 2026-04-11 OPT03.2 Project/Worktree and Git-History Controller Extraction

**Status:** completed on 2026-04-11  
**Slice:** [OPT03.2](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt03-1-thread-status-controller.md](./2026-04-11-opt03-1-thread-status-controller.md)

## Summary

This slice extracts the next major block of mainview orchestration out of `src/mainview/App.tsx`:

- project/worktree loading and open-state orchestration
- git-history refresh, pagination, invalidation, and diff-modal orchestration

The extraction adds two dedicated hooks:

- `src/mainview/app/use-project-worktree-controller.ts`
- `src/mainview/app/use-git-history-controller.ts`

and leaves `App.tsx` responsible for composition rather than owning all of the async coordination inline.

## Scope of the slice

Per the planning document, `OPT03.2` needed to:

- move worktree-open and worktree-refresh orchestration out of `App.tsx`,
- move git-history refresh/load-more orchestration out of `App.tsx`,
- keep the current invalidation and pagination behavior,
- narrow the controller surface that the main shell has to own.

This slice deliberately did **not**:

- redesign the websocket invalidation model,
- change git-history RPC payloads,
- change thread/worktree selection rules,
- introduce a new state library,
- batch more transport work.

Those remain later-slice concerns if measurement still justifies them.

## What changed

## 1. Added a dedicated project/worktree controller hook

New file:

- [src/mainview/app/use-project-worktree-controller.ts](../src/mainview/app/use-project-worktree-controller.ts)

This hook now owns:

- cached project-worktree list reuse versus refresh decisions,
- in-flight project-worktree request sharing,
- rollback-safe project close/open transitions,
- worktree-open orchestration,
- selected-thread workspace hydration when the selected thread points at a project/worktree that is not yet opened.

That logic no longer lives inline inside `App.tsx`.

## 2. Added a dedicated git-history controller hook

New file:

- [src/mainview/app/use-git-history-controller.ts](../src/mainview/app/use-git-history-controller.ts)

This hook now owns:

- cached first-page git-history reuse,
- git-history refresh behavior,
- load-more pagination,
- worktree-history invalidation subscription handling,
- commit-diff modal loading,
- commit-diff request sharing and cancellation.

That removes a large block of async git-history orchestration from `App.tsx`.

## 3. Expanded the existing pure helper coverage

### Project/worktree helper coverage

`src/mainview/project-worktree-refresh.ts` now also exports:

- `buildLoadedProjectWorktreesState(...)`
- `shouldUseCachedProjectWorktrees(...)`

and `src/mainview/project-worktree-refresh.test.ts` now verifies those helpers.

### Git-history helper coverage

`src/mainview/app/use-git-history-controller.ts` now exports small pure helpers for the controller decisions:

- `resolveGitHistoryLoadBehavior(...)`
- `canLoadMoreGitHistory(...)`

and `src/mainview/app/use-git-history-controller.test.ts` now covers them.

## 4. Updated the mainview README

`src/mainview/app/README.md` now documents both new controller hooks and their ownership boundaries.

## Why this was a performance slice rather than a cleanup-only refactor

The point of `OPT03.2` was not just file organization.

These controller paths are high-churn and cross-cutting:

- project/worktree loading feeds sidebar and workspace state,
- git-history refresh reacts to selection changes, invalidations, and pagination,
- commit-diff modal loads can race with selection changes,
- worktree open/refresh logic was previously interleaved with many unrelated shell concerns.

Moving those paths into dedicated hooks makes the hot controller boundaries clearer and shrinks the amount of unrelated state that `App.tsx` has to coordinate directly.

## Structural validation

Comparing `src/mainview/App.tsx` before and after this slice:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| lines | `6684` | `5669` | `-1015` |
| `useEffect(` count | `43` | `36` | `-7` |
| `useCallback(` count | `114` | `94` | `-20` |
| `useRef(` count | `24` | `15` | `-9` |
| `useMemo(` count | `11` | `10` | `-1` |

Those numbers matter because they show the main shell no longer owns more than a thousand lines of project/worktree/git-history orchestration directly.

## Behavior-preservation validation

The following checks were run after the extraction:

- `bun run format`
- `bun run validate`

Additional focused coverage now exists for:

- project-worktree cached-load decisions,
- loaded-worktree-state shaping,
- git-history cached-load behavior,
- git-history load-more guard conditions.

## What stayed intentionally unchanged

To keep this slice narrow and evidence-led, it does **not** change:

- the `ProjectsPanel` UI contract,
- the `GitHistoryPanel` UI contract,
- websocket invalidation payloads,
- git-history request batching,
- worktree-open RPC behavior,
- selected-thread/open-thread semantics.

The slice is about moving controller ownership and reducing shell coupling, not changing transport or data semantics.

## Files changed by the slice

- [src/mainview/App.tsx](../src/mainview/App.tsx)
- [src/mainview/app/use-project-worktree-controller.ts](../src/mainview/app/use-project-worktree-controller.ts)
- [src/mainview/app/use-git-history-controller.ts](../src/mainview/app/use-git-history-controller.ts)
- [src/mainview/project-worktree-refresh.ts](../src/mainview/project-worktree-refresh.ts)
- [src/mainview/project-worktree-refresh.test.ts](../src/mainview/project-worktree-refresh.test.ts)
- [src/mainview/app/use-git-history-controller.test.ts](../src/mainview/app/use-git-history-controller.test.ts)
- [src/mainview/app/README.md](../src/mainview/app/README.md)

## Completion note

`OPT03.2` is complete.

The mainview shell now delegates project/worktree and git-history orchestration to dedicated hooks, substantially reducing `App.tsx` size and controller density while preserving current behavior and adding focused coverage for the extracted decision logic.
