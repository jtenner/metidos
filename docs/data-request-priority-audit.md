# Data Request Priority Audit

## Summary

This audit covers every current mainview-originating data request path and the shared transport/backend machinery those requests depend on. The current codebase has a few read paths that are already close to the "deliver the result ASAP" standard, but it still has several locations where requests are delayed by background work, whole-list rereads, non-cancelled stale requests, or sequential follow-up fetches.

The most important remaining problems are:

- the transport layer does not support request cancellation, timeout, or explicit priority
- several frontend loaders ignore stale responses but still let superseded requests keep running
- thread status polling can overlap and continuously create background read traffic
- worktree opening and history-loading still start unrelated background polling before the requested data is fully returned
- some flows fetch a targeted object and then immediately reread a larger collection

## Scope

This document audits the current read-oriented request paths reachable from the browser mainview:

- `getHomeDirectory`
- `getCodexModelCatalog`
- `listProjects`
- `listThreads`
- `getThread`
- `listDirectorySuggestions`
- `listProjectWorktrees`
- `listProjectTasks`
- `openProject` when its response is used as a data load
- `openWorktree`
- `listWorktreeGitHistory`
- `getWorktreeGitCommitDiff`

It also audits the shared layers those requests depend on:

- browser RPC transport
- frontend polling and request orchestration
- Bun-side git scheduling and worktree polling

## Request Inventory

| Request path | Current status | Notes |
| --- | --- | --- |
| `getHomeDirectory` | Aligned | One-shot local value fetch. No obvious latency anti-pattern in the request-specific path. |
| `getCodexModelCatalog` | Aligned | Static in-process data. |
| `listProjects` | Partially aligned | Server path is cheap; some callers still reread the full project list after already receiving targeted project data. |
| `listThreads` | Not aligned | Used by an overlapping interval poll that can generate steady background traffic. |
| `getThread` | Partially aligned | Server path is cached, but callers still chain extra round-trips before rendering settled state. |
| `listDirectorySuggestions` | Partially aligned | Server path is local and cached; transport and caller-side cancellation are still weak. |
| `listProjectWorktrees` | Mostly aligned | Server path can return cached worktrees and refresh in the background. |
| `listProjectTasks` | Not aligned | No task-result cache, still validates the worktree first, and starts unrelated worktree polling. |
| `openProject` | Partially aligned | Returns targeted project/worktree data, but one caller immediately rereads the full project list. |
| `openWorktree` | Not aligned | Starts background work before the foreground read completes and returns an incomplete snapshot. |
| `listWorktreeGitHistory` | Not aligned | Still revalidates the worktree, rereads page 0, and can wait on background prefetch work. |
| `getWorktreeGitCommitDiff` | Partially aligned | The direct handler is improved, but it still inherits transport limitations and the non-preemptive git queue. |

## Findings

### 1. Transport requests still have no cancellation, timeout, or explicit priority

Location:

- `src/mainview/index.ts:214-236`

Why this is not "ASAP":

- `sendRequest(...)` waits on `connectionReady`, assigns an ID, and sends plain JSON over the socket.
- There is no `AbortSignal`, no timeout, and no request priority metadata.
- If the UI decides a request is obsolete, the transport still keeps it alive until the server answers or the socket closes.

Impact:

- Any superseded read can keep occupying the socket, server, or git queue even after the UI no longer wants the result.
- Every caller that currently uses request IDs or `cancelled` flags is only doing logical cancellation, not real cancellation.

### 2. Several frontend loaders suppress stale results without cancelling the underlying request

Locations:

- `src/mainview/App.tsx:3065-3094`
- `src/mainview/App.tsx:3116-3249`
- `src/mainview/App.tsx:4512-4560`

Why this is not "ASAP":

- `loadProjectTasks(...)` uses `projectTasksRequestIdRef` only to ignore stale responses.
- `loadGitHistory(...)` and `loadMoreGitHistory(...)` do the same with `gitHistoryRequestIdRef`.
- Directory suggestion loading uses a local `cancelled` flag, but the RPC still runs to completion.

Impact:

- Older requests keep consuming server work even after newer requests supersede them.
- On a busy socket or a busy git worktree, obsolete work can still get in the way of the latest request.

### 3. Thread status polling creates overlapping background read traffic

Locations:

- `src/mainview/App.tsx:3268-3308`
- `src/mainview/App.tsx:4458-4478`

Why this is not "ASAP":

- The UI polls `listThreads()` on a fixed interval whenever any thread exists.
- The interval has no in-flight guard, so a slow poll can overlap with the next one.
- When the selected thread might have changed state, the poll then does an additional `getThread(...)`, and sometimes `markThreadErrorSeen(...)`, in sequence.

Impact:

- This keeps steady background request pressure on the socket even when the user is waiting on some other data.
- Slow thread-detail polls can stack and compete with foreground reads.

### 4. Thread detail opening still uses sequential follow-up fetches

Locations:

- `src/mainview/App.tsx:3328-3349`
- `src/mainview/App.tsx:3680-3700`

Why this is not "ASAP":

- `openThread(...)` does `getThread(...)`, then conditionally does `markThreadErrorSeen(...)` as a second round-trip before it settles on the final thread detail.
- Startup does the same pattern for the initial thread.

Impact:

- A thread detail that is already available from the first request is still delayed by the second request before the UI reaches its settled state.

### 5. App initialization waits on non-critical project/worktree restoration before applying initial thread data

Location:

- `src/mainview/App.tsx:3555-3700`

Why this is not "ASAP":

- `initialize()` starts `initialThreadDetailPromise` early, which is good.
- It then waits for `restoredProjectWorktreesPromise` and `restoredOpenWorktreesPromise` before it applies the initial thread detail.
- The selected thread data is therefore gated behind unrelated project tree and worktree restoration work.

Impact:

- The first visible thread payload can arrive later than necessary on startup.

### 6. Opening a project from input still rereads the full project list after a targeted response

Location:

- `src/mainview/App.tsx:4702-4738`

Why this is not "ASAP":

- `openProjectFromInput(...)` first awaits `openProject({ projectPath })`.
- That response already returns `project` and `worktrees`.
- The code then immediately does `listProjects({ includeClosed: true })` before it updates the UI.

Impact:

- The UI pays for a second request even though the first response already contains the project that was just opened.

### 7. Worktree polling starts unrelated background git work before foreground worktree reads finish

Locations:

- `src/bun/project-procedures.ts:2449-2560`
- `src/bun/project-procedures.ts:2913-2952`
- `src/bun/project-procedures.ts:2955-3009`
- `src/bun/project-procedures.ts:2670-2680`

Why this is not "ASAP":

- `startWorktreePolling(...)` immediately kicks off `pollDiff()` and `pollFiles()` at `src/bun/project-procedures.ts:2557-2559`.
- `openWorktreeProcedure(...)` calls `startWorktreePolling(...)` before `readGitHistoryFirstPage(...)`.
- `listWorktreeGitHistoryProcedure(...)` also calls `startWorktreePolling(...)` before it reads page 0.
- `listProjectTasksProcedure(...)` starts worktree polling even though the request itself only needs task files and package scripts.

Impact:

- A foreground request can trigger unrelated background git reads before its own requested data is fully delivered.
- Because the git queue is non-preemptive, those background reads can still get the first slot.

Current flow:

```text
foreground request
  -> startWorktreePolling()
     -> pollDiff()      [background git]
     -> pollFiles()     [background git]
  -> readGitHistory...  [foreground git]

If pollDiff grabs the active worktree git slot first, the foreground read waits.
```

### 8. The git command queue is priority-aware but still non-preemptive

Location:

- `src/bun/project-procedures.ts:1492-1581`

Why this is not "ASAP":

- The queue prefers foreground work over queued background work.
- It does not interrupt an already-running background git command.
- Once a background command becomes active, a newly arrived foreground request still waits for it to finish.

Impact:

- The queue improves fairness, but it does not guarantee that a user-facing request takes over immediately.
- This still affects `openWorktree`, `listWorktreeGitHistory`, and `getWorktreeGitCommitDiff`.

### 9. Git history cache warming is not upgraded when a foreground request needs the result

Location:

- `src/bun/project-procedures.ts:2208-2277`

Why this is not "ASAP":

- `warmGitHistoryCache(...)` starts `fillGitHistoryCache(..., "background")`.
- Later, if a foreground history request enters `fillGitHistoryCache(...)` while `historyPrefetchPromise` is already set, it just waits for that background promise.
- The user-driven request does not take ownership of the read or upgrade it to foreground priority.

Impact:

- A background history warm can still dictate latency for a foreground "load more history" request.

### 10. The history read path still does avoidable validation and avoidable page-0 rereads

Location:

- `src/bun/project-procedures.ts:2955-3009`

Why this is not "ASAP":

- `listWorktreeGitHistoryProcedure(...)` always does `assertProjectWorktree(...)` before it serves the request.
- For `offset === 0`, it always rereads the first page from git instead of using already-loaded page-0 state when it is still current.

Impact:

- Frequent history refreshes still pay extra validation and git work even when the active worktree is already known and page 0 is already cached.

### 11. `openWorktree` returns a snapshot before the diff/file portions of that snapshot have actually loaded

Location:

- `src/bun/project-procedures.ts:2913-2952`

Why this is not "ASAP":

- The response includes `worktree.diff` and `worktree.files`.
- Those values come from `worktreeState.diff` and `worktreeState.files`.
- The initial `pollDiff()` and `pollFiles()` are started in the background and are not awaited before the response is returned.

Impact:

- The request returns quickly, but it does not deliver the full snapshot payload it advertises.
- The caller gets history immediately and diff/file state later or empty.

### 12. The task list path still does a full rescan on every request and adds validation work first

Location:

- `src/bun/project-procedures.ts:2670-2680`

Why this is not "ASAP":

- Every `listProjectTasks(...)` request validates the worktree first.
- It then rescans task files and `package.json` scripts on demand.
- The worktree task poller only emits change notifications; the request path itself does not use a cached task payload.

Impact:

- Repeated task list requests always rescan the filesystem.
- This is more "correct on demand" than "deliver the already-known answer ASAP."

## Audited Paths That Are Currently In Better Shape

These paths are not free of the shared transport limitations above, but their request-specific implementations are relatively well aligned with fast delivery:

- `getHomeDirectory`
  - `src/bun/index.ts`
  - `src/mainview/App.tsx:3519-3555`
- `getCodexModelCatalog`
  - `src/bun/project-procedures.ts:102-105`
- `listProjectsProcedure`
  - `src/bun/project-procedures.ts:61-65`
- `listProjectWorktreesProcedure`
  - `src/bun/project-procedures.ts:2657-2667`
  - `src/bun/project-procedures.ts:1411-1441`
- `getThreadProcedure`
  - `src/bun/project-procedures.ts:2743-2746`
  - `src/bun/project-procedures.ts:1224-1237`
- `getWorktreeGitCommitDiffProcedure`
  - `src/bun/project-procedures.ts:3012-3025`
  - This path now has direct diff-result caching and in-flight deduping. Its remaining issues are inherited from the shared transport and non-preemptive git queue, not from the handler itself.

## Bottom Line

The repo is no longer blocked by the specific git-commit-diff issue that motivated the last fix, but it is not yet consistently designed around "the newest foreground read wins immediately."

The remaining problem locations are concentrated in three layers:

1. Browser transport and request orchestration
2. Frontend polling/read-after-read flows
3. Bun worktree polling and git scheduling

If the repository wants to enforce the "deliver ASAP" rule globally, those three layers need explicit rules:

- real cancellation for superseded reads
- no overlapping polling without an in-flight guard
- no unrelated background work started from a foreground read path
- foreground promotion when a user is waiting on a previously backgrounded read
- no whole-list rereads when a targeted response already contains the needed object
