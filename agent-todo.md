# Agent TODO

Source audit: [docs/2026-04-04-correctness-audit-current-tree.md](docs/2026-04-04-correctness-audit-current-tree.md)

## Slice 1: Fix active-worktree sync ordering and cancellation

Status: completed on 2026-04-04

Audit reference: [Correctness audit - 2026-04-04](docs/2026-04-04-correctness-audit-current-tree.md)
Finding: `1. High: active-worktree synchronization can apply out of order and retarget backend polling to the wrong worktree`

Scope:
- Make `setActiveWorktree` abort-aware end to end.
- Prevent stale active-worktree requests from mutating backend polling state after a newer selection wins.
- Preserve the existing validation that rejects stale UI worktree selections against a fresh worktree listing.

Primary files:
- `src/bun/project-procedures.ts`
- `src/mainview/App.tsx`
- `src/bun/rpc-schema.ts` if request context wiring needs schema support

Implementation notes:
- Thread the RPC request signal into `setActiveWorktreeProcedure`.
- Abort or ignore stale completions before writing `state.activeWorktreePath`.
- If full backend cancellation is awkward, add a backend-side request generation guard so only the latest request can commit.

Done when:
- Quick selection changes cannot leave backend polling pointed at a previously selected worktree.
- Background git-history/task notifications continue to follow the currently selected worktree.

## Slice 2: Fix cold-open task cache priming so tasks do not appear permanently empty

Status: completed on 2026-04-04

Audit reference: [Correctness audit - 2026-04-04](docs/2026-04-04-correctness-audit-current-tree.md)
Finding: `2. High: cold worktree opens can cache an empty task list as if it were fresh`

Scope:
- Ensure a cold worktree open does not return placeholder empty tasks as if they were authoritative.
- Ensure the first real task refresh is either awaited for the open response or clearly treated as provisional by the UI.
- Ensure task watchers start after the initial cold refresh path.

Primary files:
- `src/bun/project-procedures.ts`
- `src/mainview/App.tsx`

Implementation notes:
- Rework `openWorktreeWithGitOptions` so cold opens do one of:
- Await `refreshWorktreeTaskCache(...)` before returning tasks.
- Return an explicit non-authoritative state that the frontend does not prime into the cache.
- Keep startup restore aligned with the same behavior so restored worktrees do not inherit stale empty task caches.

Done when:
- Opening a worktree with tasks shows the real tasks on first load.
- Startup-restored open worktrees do not require reselection to populate the tasks pane.

## Slice 3: Guard message-send completions against thread switches

Status: completed on 2026-04-04

Audit reference: [Correctness audit - 2026-04-04](docs/2026-04-04-correctness-audit-current-tree.md)
Finding: `3. High: sending a message can overwrite the currently visible thread after the user switches threads`

Scope:
- Prevent `sendThreadMessage` completions from replacing visible messages if the user has switched threads.
- Keep thread-list updates for the original thread, but gate message-pane updates and selected-thread runtime refs to the still-selected thread only.

Primary files:
- `src/mainview/App.tsx`

Implementation notes:
- Match the safety pattern already used by `stopSelectedThreadTurn`.
- Capture the target thread id for the send operation and conditionally apply:
- `setThreadMessages(...)`
- `selectedThreadRunStateRef.current = ...`
- Leave `setThreads(upsertThreadList(...))` in place so non-selected thread summaries still refresh.

Done when:
- Sending in thread `A`, switching to thread `B`, and then receiving the response does not replace thread `B`'s visible messages.

## Slice 4: Make thread-status polling resilient to selected-thread detail fetch failures

Audit reference: [Correctness audit - 2026-04-04](docs/2026-04-04-correctness-audit-current-tree.md)
Finding: `4. Medium: thread-status polling drops a successful summary refresh if selected-thread detail fetch fails`

Scope:
- Preserve successful `listThreads()` refreshes even when the follow-up selected-thread detail fetch fails.
- Avoid regressing the current behavior that refreshes the selected thread detail when run-state transitions need full detail.

Primary files:
- `src/mainview/App.tsx`

Implementation notes:
- Split the summary refresh from the selected-detail refresh.
- Commit `loadedThreads` even if `getThread(...)` fails.
- On detail failure, keep the previous message pane and surface only the failure that matters, if any.

Done when:
- A transient selected-thread detail error does not freeze thread badges, status chips, or thread ordering based on stale summary data.

## Suggested execution order

1. Slice 3
2. Slice 2
3. Slice 1
4. Slice 4

Reasoning:
- Slice 3 is the most direct user-visible UI corruption.
- Slice 2 is a correctness bug that makes a core panel silently wrong.
- Slice 1 affects backend/UI coordination and needs more care.
- Slice 4 is real, but lower severity and easier to land after the higher-risk fixes.
