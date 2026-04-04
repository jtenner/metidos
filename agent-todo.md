# Agent TODO

> Last refreshed: 2026-04-04

## Active Correctness Slices

No active correctness slices at the moment.

## Recently Completed

### Slice 5

- Title: Make sidecar thread metadata updates authoritative
- Completed: 2026-04-04
- Outcome: The sidecar no longer writes thread title, summary, or pin state directly into SQLite and then hopes a short background RPC refresh succeeds later. `modify_thread` now routes through a shared `updateThreadMetadata(...)` RPC mutation, which preserves unspecified fields, invalidates backend caches through the normal procedure path, and only reports success when the live app mutation succeeds. A dedicated sidecar helper now surfaces timeout and connection failures instead of silently drifting the app, and focused regression coverage exercises both those failure cases and the backend procedure behavior for combined metadata updates.
- Source: [Finding 5](docs/2026-04-04-correctness-audit-2.md#5-medium-sidecar-thread-metadata-writes-can-diverge-from-the-live-app)

### Slice 2

- Title: Validate task targets before creating new task threads
- Completed: 2026-04-04
- Outcome: `runProjectTaskProcedure(...)` now resolves and validates the selected task payload before creating a thread, so stale `.tasks` files and removed `package.json` scripts fail without leaving behind orphan empty threads. `project-tasks.ts` now exposes a validated runnable-task resolver for both file and script tasks, and `runProjectTaskProcedure(...)` also performs a best-effort empty-thread rollback if any later queueing step fails after creating a new thread. Procedure-level regression tests now cover stale package-script and stale task-file selections loaded from the real task list before the repo changes underneath them.
- Source: [Finding 2](docs/2026-04-04-correctness-audit-2.md#2-high-runprojecttask-leaks-empty-threads-on-stale-task-definitions)

### Slice 1

- Title: Serialize project lifecycle request application
- Completed: 2026-04-04
- Outcome: Project expand/collapse now runs through a per-project lifecycle request tracker that invalidates older transition and worktree-list responses as soon as a newer request starts. `App.tsx` now suppresses stale `openProject(...)`, `closeProject(...)`, and `listProjectWorktrees(...)` completions after a later close or reopen wins, and the worktree-request cache no longer reuses requests from an older lifecycle generation. Focused regression tests cover expand-then-close invalidation, close-then-reopen invalidation, and per-project request isolation.
- Source: [Finding 1](docs/2026-04-04-correctness-audit-2.md#1-high-project-lifecycle-transitions-are-not-serialized)

### Slice 4

- Title: Reuse RPC bootstrap retry logic after successful auth
- Completed: 2026-04-04
- Outcome: Successful login, recovery-code login, and post-setup recovery continuation now all re-enter the shared auth gate loader instead of calling `connectRpcTransport()` directly. The shared bootstrap resolves auth status, reuses the bounded retrying RPC connect path for any authenticated session, and leaves failures on the loading shell instead of bouncing an already-authenticated user back to login. Regression coverage now exercises authenticated gate resolution for fresh-login and recovery-login retry paths plus the setup/login branch behavior.
- Source: [Finding 4](docs/2026-04-04-correctness-audit-2.md#4-medium-fresh-login-and-recovery-flows-still-fail-on-the-first-transient-rpc-connect-error)

### Slice 3

- Title: Make security audit refreshes supersedable
- Completed: 2026-04-04
- Outcome: Security-audit refreshes now run through a superseding queue that preserves only the newest requested scope while a prior fetch is in flight, and stale intermediate responses are ignored once a newer scope is requested. The panel’s manual refresh action now respects the active `All`/`Project`/`Thread` scope, and focused regression tests cover queued scope replacement, stale-request invalidation, and duplicate-scope no-op behavior.
- Source: [Finding 3](docs/2026-04-04-correctness-audit-2.md#3-medium-security-audit-scope-changes-can-leave-the-panel-on-stale-results)
