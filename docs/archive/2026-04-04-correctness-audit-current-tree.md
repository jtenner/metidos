# Correctness audit - 2026-04-04

Scope: static review of the current tree only. This audit did not rely on the older correctness documents, and it did not run tests.

## Findings

### 1. High: active-worktree synchronization can apply out of order and retarget backend polling to the wrong worktree

Code references:
- `src/mainview/App.tsx:3173`
- `src/mainview/App.tsx:3183`
- `src/bun/project-procedures.ts:3618`
- `src/bun/project-procedures.ts:3645`
- `src/bun/project-procedures.ts:3668`

Why this is a bug:
- The UI starts `setActiveWorktree` requests with an `AbortController` and aborts the previous request when the user changes selection.
- The backend `setActiveWorktreeProcedure` does not accept `context?: RpcRequestContext`, so it never sees the caller's abort signal.
- That procedure performs a fresh `readProjectWorktrees(..., { forceRefresh: true })` before it commits `state.activeWorktreePath`.
- If the user switches from worktree `A` to worktree `B` quickly, the `B` request can finish first and set the correct active worktree, then the older uncancelled `A` request can finish later and overwrite the backend back to `A`.

Impact:
- Background polling can follow the wrong worktree after quick UI selection changes.
- Task-change and git-history-change notifications can be emitted for the stale worktree instead of the visible one.
- The UI has no subsequent correction unless another active-worktree sync happens later.

### 2. High: cold worktree opens can cache an empty task list as if it were fresh, leaving the tasks pane empty indefinitely

Code references:
- `src/bun/project-procedures.ts:3295`
- `src/bun/project-procedures.ts:3296`
- `src/bun/project-procedures.ts:3339`
- `src/bun/project-procedures.ts:1982`
- `src/bun/project-procedures.ts:2017`
- `src/mainview/App.tsx:1804`
- `src/mainview/App.tsx:1813`
- `src/mainview/App.tsx:3293`
- `src/mainview/App.tsx:3296`

Why this is a bug:
- `openWorktreeWithGitOptions` returns `worktreeState.tasks ?? []` before any cold task refresh completes.
- On a cold open, that means the RPC returns `[]` even though the real task scan has not happened yet.
- The frontend treats that result as authoritative by calling `primeProjectTasks(...)`, which seeds the cache and marks the cache key as fresh enough to skip the immediate follow-up fetch.
- The background warm in `openWorktreeWithGitOptions` uses `startWatching: false`, so a cold open also does not start task watchers after that refresh finishes.

Impact:
- A first-time worktree open, or startup restoration of an open worktree, can show an empty tasks pane even when tasks exist on disk.
- Because the frontend skips the immediate refresh and the backend has not started watchers for that cold-open path, the empty result can persist until the user reselects the worktree or otherwise forces another task load.

### 3. High: sending a message can overwrite the currently visible thread after the user switches threads

Code references:
- `src/mainview/App.tsx:4192`
- `src/mainview/App.tsx:4208`
- `src/mainview/App.tsx:4213`
- `src/mainview/App.tsx:4214`

Why this is a bug:
- `postMessage` captures `selectedThreadId` when the send starts.
- When the RPC resolves, it always writes `selectedThreadRunStateRef.current = detail.thread.runStatus.state` and `setThreadMessages(detail.messages)` without checking whether that thread is still selected.
- The stop flow already protects against this class of race by checking `selectedThreadIdRef.current` before replacing visible messages, but the send flow does not.

Impact:
- If the user sends a message in thread `A` and switches to thread `B` before the response arrives, the UI can replace thread `B`'s visible messages with thread `A`'s messages.
- The selected-thread run-state ref can also be updated from the wrong thread, which can distort follow-up polling and button state.

### 4. Medium: thread-status polling drops a successful summary refresh if the selected-thread detail fetch fails

Code references:
- `src/mainview/App.tsx:2142`
- `src/mainview/App.tsx:2174`
- `src/mainview/App.tsx:2184`
- `src/mainview/App.tsx:3672`

Why this is a bug:
- `refreshThreadStatuses` first loads the summary thread list with `procedures.listThreads()`.
- If it decides the selected thread needs a detail refresh, it then awaits `procedures.getThread(...)`.
- If that second call fails, the whole function rejects.
- The polling effect catches that rejection and only logs it, so the already-fetched `loadedThreads` summary never gets committed.

Impact:
- A transient failure on the selected-thread detail request can leave the thread list, run-status badges, and completion indicators stale even though the summary refresh already succeeded.
- The UI recovers only after a later successful poll.
