- Address issue 6 in `docs/2026-03-31-correctness-issues.md`: reduce the amount of always-on per-worktree background polling.
  Revisit the polling setup in `src/bun/project-procedures.ts` so diff, status, history, and task refresh work do not all run independently at fixed intervals for every opened worktree. Back off or suspend this work when the worktree is not actively in view.
