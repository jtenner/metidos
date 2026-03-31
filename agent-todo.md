- Address issue 1 in `docs/2026-03-31-correctness-issues.md`: make project deletion coordinate with active Codex runs and clear deleted-project thread state.
  Update `deleteProjectProcedure(...)` in `src/bun/project-procedures.ts` so project deletes either block on working threads or cancel them first, then remove affected entries from `codexThreadMap`, `threadRunStatusMap`, and `threadDetailCache`.

- Address issue 3 in `docs/2026-03-31-correctness-issues.md`: stop using stale cached worktree lists for correctness-critical operations.
  Tighten the worktree validation flow in `src/bun/project-procedures.ts` so `createThreadProcedure(...)`, `runProjectTaskProcedure(...)`, `setWorktreePinnedProcedure(...)`, and explicit worktree opens do a foreground refresh or direct git validation instead of trusting stale cached worktree state.

- Address issue 6 in `docs/2026-03-31-correctness-issues.md`: reduce the amount of always-on per-worktree background polling.
  Revisit the polling setup in `src/bun/project-procedures.ts` so diff, status, history, and task refresh work do not all run independently at fixed intervals for every opened worktree. Back off or suspend this work when the worktree is not actively in view.

- Address issue 7 in `docs/2026-03-31-correctness-issues.md`: replace recursive task polling with a narrower invalidation strategy.
  Rework task change detection in `src/bun/project-procedures.ts` so `.tasks` files and task-relevant `package.json` files are watched directly or scanned much more selectively. Avoid recursive repo walks every 1.5 seconds.

- Address issue 8 in `docs/2026-03-31-correctness-issues.md`: stop rereading the full thread list on a fixed 1.5-second loop.
  Update the thread-status refresh logic in `src/mainview/App.tsx` so thread polling is scoped to active work instead of continuously calling `listThreads()` and follow-up `getThread(...)` reads for the entire app session.
