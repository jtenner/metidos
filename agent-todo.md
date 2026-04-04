# Agent TODO

> Last refreshed: 2026-04-04

## Active Correctness Slices

### Slice 2

- Title: Validate task targets before creating new task threads
- Description: Reorder `runProjectTask(...)` so script/file task validation happens before `createThreadRecord(...)`, or roll back the created thread on every pre-run failure path.
- Source: [Finding 2](docs/2026-04-04-correctness-audit-2.md#2-high-runprojecttask-leaks-empty-threads-on-stale-task-definitions)
- Scope: `src/bun/project-procedures.ts`, `src/bun/project-procedures/project-tasks.ts`, targeted UI coverage in `src/mainview/App.tsx` if needed
- Verify: Add coverage for stale `.tasks` files and stale `package.json` scripts after the task list was already loaded.

### Slice 5

- Title: Make sidecar thread metadata updates authoritative
- Description: Stop treating direct SQLite writes plus silent best-effort RPC refresh as success. The sidecar should either mutate through RPC first or reliably invalidate backend/UI state when the local-first path is used.
- Source: [Finding 5](docs/2026-04-04-correctness-audit-2.md#5-medium-sidecar-thread-metadata-writes-can-diverge-from-the-live-app)
- Scope: `src/bun/codex-sidecar-mcp.ts`, `src/bun/project-procedures.ts`, any related sidecar tests
- Verify: Add coverage for metadata updates while the RPC transport is temporarily unavailable or timing out.

## Recently Completed

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
