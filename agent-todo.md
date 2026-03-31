- Add real cancellation, timeout handling, and request priority to the websocket RPC layer.
  Update `src/mainview/index.ts` so `sendRequest(...)` can accept an `AbortSignal`, a timeout budget, and a priority flag, then propagate that metadata over `/rpc`. Add server-side handling in `src/bun/index.ts` so superseded reads can be dropped instead of running to completion in the background.

- Replace logical stale-response guards with actual request cancellation in the frontend loaders.
  Update the request paths in `src/mainview/App.tsx` for project tasks, git history, and directory suggestions so a newer request aborts the older one instead of just ignoring its response. Keep the existing request ID guards as a last line of defense, but stop letting obsolete requests keep using socket/server/git capacity.

- Add an in-flight guard to thread status polling so `listThreads()` and follow-up `getThread()` reads cannot overlap.
  Change the interval-driven thread status refresh in `src/mainview/App.tsx` to skip starting a new poll while the prior one is still running. Keep the selected-thread detail refresh path, but ensure there is only one active status poll at a time.

- Collapse thread-opening into a single settled read path instead of chaining `getThread()` and `markThreadErrorSeen()` serially.
  Rework `openThread(...)` and the startup thread restore path in `src/mainview/App.tsx` so the first `getThread()` result can be rendered immediately, then clear unread-error state either optimistically in local state or through a server API that returns the final settled detail in one shot.

- Stop gating initial thread rendering on unrelated project/worktree restoration.
  Reorder `initialize()` in `src/mainview/App.tsx` so the selected thread detail is applied as soon as it is ready. Let project-tree restoration and background worktree reopening continue separately instead of blocking the first useful thread payload.

- Remove the full `listProjects()` reread after `openProject()` when opening a project from input.
  In `src/mainview/App.tsx`, use the `project` and `worktrees` returned by `openProject({ projectPath })` to update local state directly. Only schedule a background list refresh if there is a concrete consistency reason to do it later.

- Stop starting worktree background polling before the foreground read path finishes.
  In `src/bun/project-procedures.ts`, change `openWorktreeProcedure(...)`, `listWorktreeGitHistoryProcedure(...)`, and `listProjectTasksProcedure(...)` so they do not call `startWorktreePolling(...)` until after the requested foreground data has been gathered, or split polling startup into an explicit follow-up phase that cannot take the first git slot away from the foreground read.

- Make per-worktree git scheduling foreground-first even when background work is already running.
  Extend the git scheduler in `src/bun/project-procedures.ts` so a foreground request does not have to sit behind a long-running background git read. The safest version is to avoid launching background git reads when there is pending foreground demand; if that is not enough, redesign the queue so background work is chunked or resumable instead of monopolizing the worktree.

- Let foreground history requests take over or supersede background history warming.
  Update `fillGitHistoryCache(...)` and `warmGitHistoryCache(...)` in `src/bun/project-procedures.ts` so a user-triggered history read does not simply wait on an older background prefetch promise. Foreground requests should either reuse a foreground-grade in-flight read or replace the background warm entirely.

- Stop revalidating the worktree and rereading page 0 when the current history state is already known-good.
  Tighten `listWorktreeGitHistoryProcedure(...)` in `src/bun/project-procedures.ts` so it uses known tracked worktrees and current page-0 cache state when possible. Reserve `assertProjectWorktree(...)` and fresh `readGitHistoryFirstPage(...)` calls for actual invalidation cases instead of every top-of-list refresh.

- Make `openWorktree()` return a complete snapshot or narrow its contract.
  In `src/bun/project-procedures.ts`, either await the initial diff/file reads before returning `RpcOpenWorktreeResult`, or remove `diff` and `files` from the immediate contract and fetch them through a separate explicit path. The current shape claims to return a snapshot but often delivers empty placeholders first.

- Cache project task results and stop coupling task reads to generic worktree polling.
  Rework `listProjectTasksProcedure(...)` in `src/bun/project-procedures.ts` so it can serve cached task data keyed by worktree and invalidate it from the existing task-input poller. Keep worktree validation lightweight, but stop rescanning task files and `package.json` scripts on every request and stop starting unrelated diff/file/history polling from the task list endpoint.
