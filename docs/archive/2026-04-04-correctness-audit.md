# Correctness Audit, 2026-04-04

## Summary

This audit rechecked the current repository state instead of assuming the March 2026 correctness notes were still current.

- `bun run typecheck` passed.
- `bun run build:dev` passed.
- `bun test` failed with 3 failures in `src/bun/codex-sidecar-scope.test.ts`.

The highest-signal current correctness gaps are:

1. startup restore applies persisted project/worktree state before that state is revalidated
2. `setActiveWorktree(...)` accepts stale worktree paths for open projects
3. project collapse/close updates local UI state before backend close succeeds and then ignores failures
4. the sidecar scope contract is internally inconsistent across implementation, tests, and MCP schema
5. initial authenticated RPC boot has no automatic recovery path when the first websocket connect fails

The earlier March correctness docs are still useful historical context, but several of their highest-severity findings are already fixed in the current tree. This document is intended to be the current snapshot.

## Verification

Commands run during this audit:

- `bun run typecheck`
- `bun run build:dev`
- `bun test`

## Findings At A Glance

| Severity | Area | Finding |
| --- | --- | --- |
| High | Startup restore | Persisted project/worktree state is applied optimistically before restore validity is known |
| High | Active worktree sync | `setActiveWorktree(...)` stores stale paths for open projects without validating them |
| Medium | Project lifecycle | Project collapse/close can leave local and backend lifecycle state out of sync |
| Medium | Sidecar scope | Scope enforcement, tests, and MCP schema disagree about `allowCrossProject` behavior |
| Low | Transport bootstrap | Initial authenticated RPC connect has no automatic retry/recovery path |

## Detailed Findings

### 1. High: Startup restore applies stale persisted project and worktree state

Relevant code:

- `src/mainview/App.tsx:2416-2562`

What is happening:

- Startup marks projects as open based on persisted sidebar state and persisted open-worktree state before `openProjectsBatch(...)` and `openWorktreesBatch(...)` confirm that those resources still exist.
- The initial selected worktree path is also restored from persisted state before restore failures are processed.
- When a project restore or worktree restore fails, the current code records an error string but does not fully clear the stale optimistic selection/open state that was already applied.

Why this is a correctness problem:

- A project removed from disk, renamed, or no longer usable can still look open in the client after boot.
- A worktree that no longer exists can remain selected long enough to break dependent reads such as git history, tasks, and active-worktree synchronization.
- The app starts from a state that looks valid in memory even though the restore RPCs already proved it is not.

Recommended fix:

- Delay "open" and "selected worktree" state application until restore RPCs succeed, or explicitly roll back optimistic state when batch restore fails.
- Prune failed restored worktrees from persisted-open state before the rest of the UI depends on them.
- Add a startup regression test for missing projects and missing worktrees in persisted state.

### 2. High: `setActiveWorktree(...)` accepts stale worktree paths for open projects

Relevant code:

- `src/mainview/App.tsx:3044-3070`
- `src/bun/project-procedures.ts:3591-3635`

What is happening:

- The browser synchronizes its current active worktree selection to the backend through `setActiveWorktree(...)`.
- The backend only checks whether the project is open.
- If the project is open, it stores the requested worktree path as active without checking that the path belongs to the project's current worktree set.

Why this is a correctness problem:

- A stale selected worktree path from startup restore or local UI drift can become the server's active worktree even when the worktree is gone.
- Backend project polling then treats that stale path as the active view.
- Because no real open worktree matches the stale path, background polling for the real open worktrees can be suppressed.

Recommended fix:

- Validate the requested active worktree path against the current known/tracked worktrees before accepting it.
- If the path is unknown, reject the request or clear the active worktree instead of storing bad state.
- Add coverage for stale-path sync after failed restore and after external worktree removal.

### 3. Medium: Project collapse/close can leave local and backend lifecycle state out of sync

Relevant code:

- `src/mainview/App.tsx:3815-3853`

What is happening:

- When collapsing a project, the UI first closes each open worktree locally, deletes local worktree state, clears `openWorktrees`, and only then calls `closeProject(...)`.
- If `closeProject(...)` fails, the error is intentionally ignored because the local UI state was already updated.

Why this is a correctness problem:

- The frontend can believe a project is closed while the backend still considers it open.
- Follow-up polling and restore behavior now depend on whichever side "wins" later instead of a single confirmed lifecycle transition.
- Silent failure hides a real state mismatch from the user and from later debugging.

Recommended fix:

- Treat project close as a confirmed state transition rather than a fire-and-forget cleanup.
- Either wait for backend success before committing local close state, or roll back local state if the RPC fails.
- Surface close failures instead of swallowing them.

### 4. Medium: Sidecar scope contract is internally inconsistent and keeps the test suite red

Relevant code:

- `src/bun/codex-sidecar-scope.ts:56-88`
- `src/bun/codex-sidecar-scope.test.ts:46-77`
- `src/bun/codex-sidecar-mcp.ts:799-826`

What is happening:

- `enforceTargetScope(...)` now rejects cross-project and cross-worktree access unconditionally.
- The MCP schema for `new_thread` says `allowCrossProject` is deprecated and ignored.
- The current tests still expect `allowCrossProject=true` to permit cross-scope access and still assert the older error messages.

Why this is a correctness problem:

- The test suite is currently red even though the implementation and schema appear to have moved to a stricter contract.
- Readers of the codebase get conflicting answers about what the sidecar is allowed to do.
- This is not just a documentation issue; it blocks a clean test run and obscures whether the stricter behavior is intentional and complete.

Recommended fix:

- Pick one contract and make code, tests, and schema agree.
- If the stricter contract is intentional, update tests and remove dead `allowCrossProject` affordance language where possible.
- If override behavior is still required, reintroduce it intentionally and document the security tradeoff clearly.

### 5. Low: Initial authenticated RPC boot has no automatic recovery path on first-connect failure

Relevant code:

- `src/mainview/auth-shell.tsx:267-295`
- `src/mainview/index.ts:350-418`

What is happening:

- On authenticated boot, `AuthShell` immediately calls `connectRpcTransport()` and waits for it before entering the app view.
- The RPC transport has reconnect behavior after an established socket later closes, but initial connect failures still bubble back to the auth shell as an error.
- Recovery is effectively manual via a retry action or another auth-state refresh.

Why this is a correctness problem:

- A brief backend startup race or transient ticket/websocket failure can leave the app stuck in loading/error instead of recovering automatically.
- The first authenticated experience is more fragile than later in-session reconnect behavior.

Recommended fix:

- Add a bounded automatic retry path for initial authenticated connect.
- Reuse the reconnect backoff strategy already present for post-connect socket loss, or explicitly re-run auth-state loading after transient failures.

## Recommended Fix Order

1. Fix startup restore validation and stale selection rollback.
2. Harden `setActiveWorktree(...)` so stale paths cannot become backend-active state.
3. Make project close/collapse rollback-safe.
4. Reconcile the sidecar scope contract and get `bun test` back to green.
5. Add automatic recovery for initial authenticated RPC boot.

## Notes

- This audit focused on the current tree as of 2026-04-04.
- It is intentionally narrower than the March 2026 audits: it documents what still appears broken now, not every historical issue that existed earlier.
