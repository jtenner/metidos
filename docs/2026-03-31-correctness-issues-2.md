# Correctness And Performance Audit, Round 2

## Summary

This audit reviewed the current `src/bun` and `src/mainview` code with focus on async state coordination, cancellation semantics, recursive filesystem traversal, and background refresh behavior. The repository currently passes `bun run typecheck` and `bun run build:dev`, so the main risks are runtime behavior problems rather than compile-time breakage.

The highest-signal issues in the current code are:

- worktree open/close flows still apply async results against stale UI state, which can lose `openWorktrees` entries and reopen the wrong worktree
- stopping a Codex turn records the run as a clean completion, which hides that the answer was interrupted
- task discovery and task watch target collection follow symlinked directories and can recurse indefinitely
- closing a project in the UI does not keep it closed if it remains selected, because active-worktree sync recreates the backend poller
- cached git history can remain indefinitely stale for selected worktrees that are not currently opened
- commit diff preloads and modal loads are not abortable end to end, so abandoned `git show` work keeps running

## Methodology

- Reviewed `src/mainview/App.tsx`, `src/mainview/index.ts`, `src/bun/project-procedures.ts`, `src/bun/project-procedures/project-tasks.ts`, `src/bun/project-procedures/git-history.ts`, `src/bun/git.ts`, and `src/bun/index.ts`
- Cross-checked async request flows, cache usage, watcher lifecycles, and background polling behavior
- Ran `bun run typecheck`
- Ran `bun run build:dev`

## Findings At A Glance

| Severity | Area | Finding |
| --- | --- | --- |
| High | Mainview worktree state | `openOrCloseWorktree(...)` applies async results against stale captured state |
| Medium | Thread lifecycle | Stopped turns are persisted as successful completions |
| Medium | Task discovery | Recursive task scans follow symlinked directories and can recurse forever |
| Medium | Project lifecycle | Closing a selected project can immediately recreate its backend poller |
| Medium | Git history correctness | Cached history for unopened worktrees can stay stale indefinitely |
| Medium | Git diff loading | Commit diff requests ignore cancellation and can keep large git work running |
| Low | Dev workflow | The dev mainview watcher ignores nested `src/mainview/**` files |

## Detailed Findings

### 1. `openOrCloseWorktree(...)` applies async results against stale captured state

Relevant code:

- `src/mainview/App.tsx:3501`

What is happening:

- `openOrCloseWorktree(...)` captures `target` and `projectState` before awaiting `procedures.openWorktree(...)` or `procedures.closeWorktree(...)`.
- After the await resolves, it writes `openWorktrees` using the old `projectState.openWorktrees` snapshot.
- It also unconditionally sets `selectedProjectId`, `selectedWorktreePath`, and `gitHistory` from the completed request, with no request ordering or "latest click wins" guard.

Why this is a correctness problem:

- If two worktree opens start from the same initial state, the later completion can overwrite `openWorktrees` with a stale set and silently drop the other opened worktree.
- If the user clicks worktree A and then worktree B quickly, the slower response can still reselect A and replace the visible git history after B was already chosen.

Failure shape:

```text
open A starts with openWorktrees = {}
open B starts with openWorktrees = {}
open A resolves -> set openWorktrees = {A}
open B resolves -> set openWorktrees = {B}
result: A is lost even though both opens succeeded
```

Recommendation:

- Use functional state updates when mutating `openWorktrees` and related worktree state.
- Add per-project or per-worktree request IDs, or abort superseded requests before applying results.
- Only apply selection changes if the completing request is still the latest user intent.

### 2. Stopped turns are persisted as successful completions

Relevant code:

- `src/bun/project-procedures.ts:412`
- `src/bun/project-procedures.ts:592`

What is happening:

- When a turn is aborted, `settleCanceledThreadTurn(...)` writes the last assistant text with state `"completed"`.
- It then calls `markThreadRan(...)` and sets thread run status back to `"idle"` with no error.
- The stopped run therefore becomes indistinguishable from a clean completion in persisted thread state.

Why this is a correctness problem:

- A user-stopped answer can look like a finished answer rather than a partial answer.
- Follow-up behavior now has no durable way to tell whether the last assistant text was intentionally interrupted.
- The stop action clears failure state instead of recording interruption semantics.

Recommendation:

- Record cancellation explicitly, either with a distinct run status or an explicit "stopped" thread activity.
- Do not mark interrupted assistant output as `"completed"`.
- Preserve an indication that the last run ended by user interruption, even if partial output is kept.

### 3. Task discovery follows symlinked directories and can recurse indefinitely

Relevant code:

- `src/bun/project-procedures/shared.ts:137`
- `src/bun/project-procedures/project-tasks.ts:69`
- `src/bun/project-procedures/project-tasks.ts:103`
- `src/bun/project-procedures/project-tasks.ts:177`

What is happening:

- `safeIsDirectory(...)` uses `statSync(...)`, which follows symlinks.
- `listProjectTaskFiles(...)`, `listPackageJsonTasks(...)`, and `collectTaskWatchTargets(...)` recurse whenever `safeIsDirectory(...)` returns true.
- There is no visited-set or realpath guard, so directory symlink cycles are treated as ordinary directories.

Why this is a correctness and performance problem:

- A symlink like `.tasks/loop -> ..` or a workspace/package symlink back into an ancestor can trigger unbounded recursion.
- That can lead to stack overflows, runaway CPU, excessive watcher creation, or a hung task list request.

Recommendation:

- Do not recurse into symlinked directories by default.
- If symlink traversal is required, resolve real paths and maintain a visited set before descending.
- Apply the same guard to both task listing and task watch target collection.

### 4. Closing a selected project can immediately recreate its backend poller

Relevant code:

- `src/mainview/App.tsx:2672`
- `src/mainview/App.tsx:3400`
- `src/bun/project-procedures.ts:1785`

What is happening:

- Collapsing a project calls `closeProject(...)`, but if that project stays selected the UI keeps sending `setActiveWorktree(...)`.
- The server-side `setActiveWorktreeProcedure(...)` calls `ensureProjectPoller(...)` whenever `projectId !== null`.
- That recreates backend poll state even though the project was just closed.

Why this is a correctness and performance problem:

- "Closed" becomes mostly a UI label, not a stable backend lifecycle state.
- The project can resume 4-second worktree polling immediately after close if it remains selected.
- This weakens the intended contract of `closeProject(...)` and keeps background work alive unexpectedly.

Recommendation:

- Clear active project/worktree selection when a selected project is closed, or exclude closed projects from active-worktree sync.
- On the server, avoid recreating a project poller from `setActiveWorktree(...)` for closed projects.

### 5. Cached git history for unopened worktrees can stay stale indefinitely

Relevant code:

- `src/mainview/App.tsx:1344`
- `src/mainview/App.tsx:2780`
- `src/bun/project-procedures.ts:1113`

What is happening:

- `loadGitHistory(...)` returns cached history immediately when `preferCached` is true.
- The selection effect always calls it with `preferCached: true`.
- Server-side history change polling only runs for worktrees that exist in `state.openWorktrees`.

Why this is a correctness problem:

- If a worktree is selected but not currently opened, cached history can be shown with no foreground or background refresh.
- Returning to a previously viewed primary worktree can therefore display old branch/head information until some unrelated action forces a reload.

Recommendation:

- When serving cached git history, also kick off a silent refresh in the background.
- Alternatively, only trust the cache for worktrees that are currently opened and receiving server-side history invalidation.

### 6. Commit diff requests ignore cancellation and can keep large git work running

Relevant code:

- `src/mainview/App.tsx:666`
- `src/mainview/App.tsx:717`
- `src/bun/project-procedures.ts:1761`
- `src/bun/project-procedures/git-history.ts:220`

What is happening:

- The mainview diff loader caches plain promises and never associates them with an `AbortSignal`.
- Hover preloads fire and forget.
- Server-side `getCachedGitCommitDiffResult(...)` accepts a request signal for waiting, but the underlying `readGitCommitDiffResult(...)` is launched without that signal and therefore cannot be canceled once started.

Why this is a performance problem:

- Rapid hover or modal churn across large commits can queue expensive `git show` work that keeps running even after the UI no longer needs the result.
- The shared request cache deduplicates identical diff reads, but it does not stop abandoned reads.

Recommendation:

- Make commit diff requests fully abortable end to end.
- Track active waiters for shared diff reads, and cancel the underlying git command when the last waiter goes away.
- Avoid hover-triggered preloads for large diffs unless the underlying request can be canceled.

### 7. The dev mainview watcher ignores nested `src/mainview/**` files

Relevant code:

- `src/bun/index.ts:642`

What is happening:

- `readMainviewFileStamps()` only scans the top-level entries directly under `src/mainview`.
- The current UI code lives in nested directories such as `src/mainview/app` and `src/mainview/controls`.

Why this is a correctness problem in dev mode:

- Editing nested UI files does not update the stamp map, so the dev server can miss rebuild/reload triggers for most UI changes.
- That produces stale browser output and false confidence during local iteration.

Recommendation:

- Replace the top-level scan with a recursive walk, or a real recursive filesystem watcher.
- At minimum, include nested `.ts`, `.tsx`, `.css`, and `.html` files under `src/mainview`.

## Recommended Fix Order

1. Fix `openOrCloseWorktree(...)` first.
   This is the most user-visible correctness bug because it can reopen the wrong worktree and lose `openWorktrees` state under normal fast interaction.

2. Preserve cancellation semantics for stopped turns.
   The current behavior rewrites interrupted work as a clean completion, which is hard to reason about once it is persisted.

3. Harden task traversal against symlink cycles.
   This is the sharpest filesystem correctness risk and can also produce severe performance failure.

4. Stop closed projects from reactivating pollers.
   That will make project lifecycle behavior consistent and reduce background work.

5. Add refresh/cancellation to git history and commit diff cache paths.
   These are the remaining high-value cache and performance fixes.
