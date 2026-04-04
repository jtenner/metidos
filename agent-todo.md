# Agent TODO

> Last reviewed: 2026-04-04

## Active Correctness Slices

### Slice 1

- Title: Revalidate restored project openness during startup
- Description: Change startup restore so projects are not treated as open until `openProjectsBatch(...)` confirms them. Clear optimistic open state when a restored project no longer exists or fails to reopen cleanly.
- Source: [Finding 1](docs/2026-04-04-correctness-audit.md#1-high-startup-restore-applies-stale-persisted-project-and-worktree-state)

### Slice 2

- Title: Roll back stale restored worktree selections
- Description: Prevent persisted `selectedWorktreePath` and persisted open-worktree entries from surviving failed `openWorktreesBatch(...)` results. Startup should prune missing worktrees and fall back to a valid selection before git history, task loading, or active-worktree sync runs.
- Source: [Finding 1](docs/2026-04-04-correctness-audit.md#1-high-startup-restore-applies-stale-persisted-project-and-worktree-state)

### Slice 4

- Title: Make project close/collapse rollback-safe
- Description: Rework the collapse flow so local close state is committed only after `closeProject(...)` succeeds, or is restored if the RPC fails. Do not silently ignore backend close failures once local state has already been mutated.
- Source: [Finding 3](docs/2026-04-04-correctness-audit.md#3-medium-project-collapseclose-can-leave-local-and-backend-lifecycle-state-out-of-sync)

## Recently Completed

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
