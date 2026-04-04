# Agent TODO

> Last reviewed: 2026-04-04

## Active Correctness Slices

### Slice 2

- Title: Roll back stale restored worktree selections
- Description: Prevent persisted `selectedWorktreePath` and persisted open-worktree entries from surviving failed `openWorktreesBatch(...)` results. Startup should prune missing worktrees and fall back to a valid selection before git history, task loading, or active-worktree sync runs.
- Source: [Finding 1](docs/2026-04-04-correctness-audit.md#1-high-startup-restore-applies-stale-persisted-project-and-worktree-state)

## Recently Completed

### Slice 1

- Title: Revalidate restored project openness during startup
- Completed: 2026-04-04
- Outcome: Startup now initializes every project as closed, then reconciles `openProjectsBatch(...)` results back into the project list so only confirmed restores become open in the UI. Failed restore targets are collapsed out of persisted sidebar-open state, and project-only startup selection can fall back to a successfully reopened project instead of staying pinned to an unconfirmed restore target.
- Source: [Finding 1](docs/2026-04-04-correctness-audit.md#1-high-startup-restore-applies-stale-persisted-project-and-worktree-state)

### Slice 4

- Title: Make project close/collapse rollback-safe
- Completed: 2026-04-04
- Outcome: Project collapse now keeps the sidebar tree open and preserves local worktree/project state until `closeProject(...)` succeeds. Failed closes surface a project error instead of being swallowed, while successful closes invalidate in-flight worktree-open requests, clear local worktree snapshots, persist the collapsed tree state, and retarget the selected worktree path only after the backend transition is confirmed.
- Source: [Finding 3](docs/2026-04-04-correctness-audit.md#3-medium-project-collapseclose-can-leave-local-and-backend-lifecycle-state-out-of-sync)

### Slice 6

- Title: Add automatic recovery for initial authenticated RPC boot
- Completed: 2026-04-04
- Outcome: The authenticated startup path in `auth-shell.tsx` now uses a bounded RPC connect retry helper instead of failing immediately on the first transient transport error. Auth-required failures still fail fast, while transient initial ticket/socket failures get automatic retry attempts with visible loading-state updates, and the retry helper has focused regression tests.
- Source: [Finding 5](docs/2026-04-04-correctness-audit.md#5-low-initial-authenticated-rpc-boot-has-no-automatic-recovery-path-on-first-connect-failure)

### Slice 3

- Title: Validate active worktree sync requests on the backend
- Completed: 2026-04-04
- Outcome: `setActiveWorktree(...)` now refreshes the selected project's worktree list before accepting an active worktree path. Unknown or unrefreshable paths are cleared instead of becoming backend-active state, and regression coverage now exercises both the valid-path and stale-path cases.
- Source: [Finding 2](docs/2026-04-04-correctness-audit.md#2-high-setactiveworktree-accepts-stale-worktree-paths-for-open-projects)

### Slice 5

- Title: Reconcile the sidecar scope contract and restore a green test suite
- Completed: 2026-04-04
- Outcome: Removed the dead `allowCrossProject` affordance from the sidecar schema/helpers, aligned the scope tests with the now-strict bound-project and bound-worktree contract, and restored a clean `bun test` run.
- Source: [Finding 4](docs/2026-04-04-correctness-audit.md#4-medium-sidecar-scope-contract-is-internally-inconsistent-and-keeps-the-test-suite-red)
