/**
 * @file src/bun/project-procedures/project-worktrees.ts
 * @description Project/Worktree read option types retained for procedure callers.
 */

import type { GitCommandOptions } from "../git";

export type ProjectWorktreeReadOptions = GitCommandOptions & {
  forceRefresh?: boolean;
  includeHidden?: boolean;
};
