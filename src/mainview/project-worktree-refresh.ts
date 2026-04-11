/**
 * @file src/mainview/project-worktree-refresh.ts
 * @description Module for project worktree refresh.
 */

import type { RpcWorktree } from "../bun/rpc-schema";
import {
  buildProjectWorktreeIndex,
  type ProjectNodeState,
  projectStateWorktreeCount,
  projectStateWorktrees,
} from "./app/state";

export const PROJECT_ACTION_MENU_WORKTREE_REFRESH_STALE_MS = 12_000;

export function buildLoadedProjectWorktreesState(
  worktrees: RpcWorktree[],
  loadedAtMs: number = Date.now(),
): Pick<
  ProjectNodeState,
  | "error"
  | "loadingWorktrees"
  | "worktreeByPath"
  | "worktreePaths"
  | "worktreesLoadedAt"
> {
  return {
    ...buildProjectWorktreeIndex(worktrees),
    worktreesLoadedAt: loadedAtMs,
    loadingWorktrees: false,
    error: "",
  };
}

export function shouldUseCachedProjectWorktrees(
  projectState: ProjectNodeState,
  options?: {
    preferCached?: boolean;
  },
): boolean {
  return (
    (options?.preferCached ?? true) &&
    projectStateWorktrees(projectState).length > 0
  );
}

/**
 * Skip project-action-menu background refreshes when cached worktrees are still
 * recent enough to be useful and no fetch is already active.
 */
export function shouldRefreshProjectActionMenuWorktrees(
  projectState: ProjectNodeState,
  nowMs: number = Date.now(),
): boolean {
  if (projectState.loadingWorktrees) {
    return false;
  }

  if (projectStateWorktreeCount(projectState) === 0) {
    return true;
  }

  if (projectState.error) {
    return true;
  }

  if (projectState.worktreesLoadedAt === null) {
    return true;
  }

  return (
    nowMs - projectState.worktreesLoadedAt >=
    PROJECT_ACTION_MENU_WORKTREE_REFRESH_STALE_MS
  );
}
