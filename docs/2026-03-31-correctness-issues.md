# Correctness And Performance Audit

## Summary

This audit reviewed the current runtime behavior in `src/bun` and `src/mainview`, with emphasis on project/worktree lifecycle, thread execution, git history loading, RPC transport, and polling. The repository currently passes `bun run typecheck` and `bun run build:dev`, so the main risks are not compile-time failures. They are semantic runtime issues and background load patterns that can still produce wrong behavior, stale UI, hidden failures, or unnecessary CPU / filesystem / git pressure.

The highest-signal problems are:

- deleting a project does not coordinate with active Codex runs and does not clean related in-memory thread state
- thread opening in the browser is vulnerable to stale-response races
- worktree validation reuses stale cached worktree lists in paths that need fresh answers
- git history helpers collapse any non-zero git exit into "empty history"
- the browser RPC client does not recover from socket loss outside dev mode
- the current polling strategy creates persistent background git, filesystem, and database load

## Methodology

- Reviewed the server/runtime paths in `src/bun/index.ts`, `src/bun/project-procedures.ts`, and `src/bun/db.ts`
- Reviewed the browser transport and orchestration paths in `src/mainview/index.ts` and `src/mainview/App.tsx`
- Traced cache invalidation, pollers, and mutation flows end to end
- Ran `bun run typecheck`
- Ran `bun run build:dev`

## Findings At A Glance

| Severity | Area | Finding |
| --- | --- | --- |
| High | Project/thread lifecycle | Deleting a project can race with active thread execution and leaves thread process state behind |
| High | Mainview thread UX | `openThread(...)` has no stale-response guard, so slower requests can overwrite newer thread selections |
| High | Worktree validation | Stale cached worktree lists are reused for correctness-critical operations |
| Medium | Git history correctness | Non-zero git exits are treated as "no history", which hides real repository errors |
| Medium | RPC transport resilience | The browser socket does not reconnect outside dev mode, so one close can permanently break the session |
| Medium | Worktree polling | Each opened worktree starts multiple independent background polls, creating steady git and filesystem load |
| Medium | Task scanning | Task change detection recursively scans the worktree every 1.5s |
| Medium | Thread polling | Thread status refresh rereads the entire thread list every 1.5s and sometimes the selected thread detail too |

## Detailed Findings

### 1. Project deletion can race with active Codex runs and leaks thread state

Relevant code:

- `src/bun/project-procedures.ts:1388-1539`
- `src/bun/project-procedures.ts:187-197`
- `src/bun/project-procedures.ts:3406-3423`
- `src/bun/project-procedures.ts:3615-3625`

What is happening:

- `deleteThreadProcedure(...)` explicitly refuses to delete a working thread.
- `deleteProjectProcedure(...)` does not do the same check for threads that belong to the project.
- `runThreadMessageInBackground(...)` continues streaming events and writing activity rows after the project delete has already cascaded through `threads` and `thread_messages`.
- The in-memory maps that hold thread state (`codexThreadMap`, `threadRunStatusMap`, `threadDetailCache`) are not cleaned when an entire project is deleted.

Why this is a correctness problem:

- A project delete can remove the database rows that the active background turn still expects to update.
- That creates a path where the Codex turn is still running, but persistence has already been torn down underneath it.
- The delete path is therefore weaker than the single-thread delete path, even though the project delete is more destructive.

Failure shape:

```text
deleteProject()
  -> DB rows cascade away
  -> active runThreadMessageInBackground() keeps processing events
  -> background writes now target deleted thread/project state
  -> in-memory thread maps also remain allocated
```

Recommendation:

- Refuse project deletion while any thread in that project is `working`, or add explicit cancellation / shutdown for those runs before deleting.
- When a project is deleted, remove every affected entry from `codexThreadMap`, `threadRunStatusMap`, and `threadDetailCache`.

### 2. `openThread(...)` is vulnerable to stale-response races

Relevant code:

- `src/mainview/App.tsx:3649-3667`
- `src/mainview/App.tsx:3216-3259`
- `src/mainview/App.tsx:3282-3359`

What is happening:

- `openThread(...)` awaits `procedures.getThread(...)` and then immediately applies the result.
- There is no request ID, no abort controller, and no "latest request wins" check.
- Other loaders in the same file already use request IDs and abort logic (`loadProjectTasks(...)`, `loadGitHistory(...)`), which highlights the gap.

Why this is a correctness problem:

- If the user clicks thread A and then thread B quickly, the slower response can still arrive last and reopen the wrong thread.
- Startup restoration can hit the same issue because initialization and effect-driven auto-selection can both call thread-open logic.

Recommendation:

- Give thread opening the same stale-response handling used elsewhere in the app: request ID tracking, cancellation, or both.

### 3. Worktree validation reuses stale cached worktree lists in paths that need fresh answers

Relevant code:

- `src/bun/project-procedures.ts:1557-1581`
- `src/bun/project-procedures.ts:3040-3051`
- `src/bun/project-procedures.ts:3225-3236`
- `src/bun/project-procedures.ts:3245-3251`
- `src/bun/project-procedures.ts:3316-3365`
- `src/bun/project-procedures.ts:3425-3441`

What is happening:

- `readProjectWorktrees(...)` returns cached worktrees immediately even after the cache is stale.
- Once stale, it only kicks off a background refresh and still serves the old list to the current caller.
- Several correctness-sensitive paths depend on that helper for validation: `setWorktreePinnedProcedure(...)`, `createThreadProcedure(...)`, `runProjectTaskProcedure(...)`, and parts of `openWorktreeProcedure(...)`.

Why this is a correctness problem:

- A worktree removed outside the app can remain "valid" long enough for the server to create a thread or run a task against a dead path.
- A newly added worktree can be rejected as missing until background refresh finishes.
- This is fine for cheap read-mostly UI rendering, but not for mutating or path-validating operations.

Recommendation:

- For mutating flows and explicit worktree opens, do a foreground refresh or direct git validation instead of serving stale cache entries.

### 4. Git history helpers hide real git failures by turning them into "empty history"

Relevant code:

- `src/bun/project-procedures.ts:1861-1870`
- `src/bun/project-procedures.ts:2300-2356`
- `src/bun/project-procedures.ts:2358-2387`

What is happening:

- `tryRunGitCommand(...)` returns `null` for any non-zero git exit code.
- `readGitHistorySummary(...)` and `readGitHistoryPageEntries(...)` then treat that `null` as an empty response.
- That behavior does not distinguish "repo has no commits yet" from "git failed for a real reason".

Why this is a correctness problem:

- Permission issues, corrupt repos, unexpected HEAD states, or other git failures can be shown as a clean empty history view instead of an actionable error.
- The UI then silently misrepresents the repository state.

Recommendation:

- Only treat the specific "no HEAD yet" cases as empty history.
- Propagate other git failures so the UI can surface a real error.

### 5. The browser RPC client does not recover from socket loss outside dev mode

Relevant code:

- `src/mainview/index.ts:92-105`
- `src/mainview/index.ts:147-157`
- `src/mainview/index.ts:216-226`

What is happening:

- The browser creates one `WebSocket` and one `connectionReady` promise at module load.
- When the socket closes, all pending work is rejected and `connectionReady` is rejected too.
- There is only a dev-only recovery path that waits for the dev server and reloads the page.

Why this is a correctness problem:

- In non-dev mode, a single server restart or connection drop permanently breaks future RPC calls until the user manually reloads.
- The app is effectively in a dead session after one transport failure.

Recommendation:

- Recreate the socket and connection promise after close, or trigger a full reload on close in all modes if a real reconnect flow is not ready yet.

### 6. Opened worktrees create constant background git and filesystem traffic

Relevant code:

- `src/bun/project-procedures.ts:110-117`
- `src/bun/project-procedures.ts:2775-2804`
- `src/bun/project-procedures.ts:2875-3004`

Current poll cadence:

| Poller | Interval | Approx. rate |
| --- | --- | --- |
| project worktree refresh | 4.0s | 0.25/sec per project |
| diff poll | 2.0s | 0.50/sec per open worktree |
| file/status poll | 4.0s | 0.25/sec per open worktree |
| git history summary poll | 2.0s | 0.50/sec per open worktree |
| task input scan | 1.5s | 0.67/sec per open worktree |

Why this is a performance problem:

- A single opened worktree already creates multiple background loops.
- Multiple open worktrees multiply that cost linearly.
- The server keeps spending work even when the user is not actively looking at those panes.

Recommendation:

- Collapse related work into fewer pollers, or switch to event-driven invalidation where possible.
- At minimum, back off polling when the worktree is not selected or the app window is hidden.

### 7. Task change detection rescans too much of the repo too often

Relevant code:

- `src/bun/project-procedures.ts:730-739`
- `src/bun/project-procedures.ts:838-899`
- `src/bun/project-procedures.ts:2875-2906`

What is happening:

- `readTaskInputStamps(...)` recursively traverses the worktree to look for `.tasks` files and `package.json` files.
- That scan runs every 1.5 seconds for each opened worktree.
- The ignore list is narrow, so hidden directories and many custom cache/build folders can still be traversed.

Why this is a performance problem:

- Large repos and monorepos will pay repeated directory walks just to detect task-related changes.
- This is especially wasteful because task inputs usually change far less frequently than source files or git state.

Recommendation:

- Narrow the scan scope to known task roots, or use filesystem watch primitives for `.tasks` and `package.json` targets instead of recursive polling.

### 8. Thread status refresh rereads the whole thread list every 1.5 seconds

Relevant code:

- `src/mainview/App.tsx:3585-3627`
- `src/mainview/App.tsx:4846-4878`

What is happening:

- As long as at least one thread exists, the browser polls every 1.5 seconds.
- Each poll rereads the full thread list with `procedures.listThreads()`.
- If the selected thread is working, or just transitioned into failure, the poll also does `procedures.getThread(...)`.

Why this is a performance problem:

- The cost scales with total thread count, not with the number of actively changing threads.
- The UI then sorts and re-applies that full list repeatedly, even when the repo is otherwise idle.

Recommendation:

- Poll only while a thread is actively running, or move thread status updates onto a push/event path similar to the worktree change events.

## Recommended Fix Order

1. Fix project deletion semantics first.
   This is the highest-risk correctness issue because it combines destructive deletes, background execution, and unbounded in-memory leftovers.

2. Make thread opening request-ordered.
   This is a user-visible correctness bug that can surface immediately in the UI.

3. Stop using stale worktree cache for mutation/validation paths.
   This reduces both wrong-path actions and spurious "worktree not found" failures.

4. Preserve real git errors in history loaders.
   Empty-state fallbacks should only represent genuine empty repositories.

5. Replace the most expensive polling loops with narrower or evented invalidation.
   The task scan and thread poll are the best first targets because they create constant background load.

## Bottom Line

The codebase is in decent compile-time shape, but it still has a few runtime correctness gaps and several always-on polling patterns that will get more expensive as project count, worktree count, and thread count grow. The project/thread deletion path and the thread-open race are the two issues I would fix before making broader UX or architectural changes, because they are the most likely to produce directly wrong behavior for users.
