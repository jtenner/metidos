/**
 * @file src/mainview/startup-worktree-restore.ts
 * @description Module for startup worktree restore.
 */

import type {
  RpcOpenWorktreeRequest,
  RpcOpenWorktreesBatchResultItem,
  RpcProject,
  RpcWorktree,
} from "../bun/rpc-schema";
import { primaryWorktreePath, worktreeKey } from "./app/state";

/**
 * Only restore worktrees for projects that actually reopened during startup.
 */
export function filterStartupWorktreeRestoreRequests(
  requests: RpcOpenWorktreeRequest[],
  openProjectIds: ReadonlySet<number>,
): RpcOpenWorktreeRequest[] {
  return requests.filter((request) => openProjectIds.has(request.projectId));
}

/**
 * Ensure startup never keeps a stale selected worktree path once restore
 * results prove that path is invalid or failed to reopen.
 */
export function reconcileStartupSelectedWorktreePath(options: {
  allowFallback: boolean;
  project: RpcProject | null;
  restoredOpenWorktrees: RpcOpenWorktreesBatchResultItem[];
  selectedWorktreePath: string | null;
  worktrees: RpcWorktree[];
}): string | null {
  const { project, selectedWorktreePath, worktrees } = options;
  if (!project || project.isOpen !== 1) {
    return selectedWorktreePath;
  }

  const fallbackPath = primaryWorktreePath(project, worktrees);
  if (!options.allowFallback) {
    return selectedWorktreePath ?? fallbackPath;
  }
  if (!selectedWorktreePath) {
    return fallbackPath;
  }

  const selectedKey = worktreeKey(project.id, selectedWorktreePath);
  if (
    options.restoredOpenWorktrees.some(
      (result) =>
        !result.ok &&
        worktreeKey(result.projectId, result.worktreePath) === selectedKey,
    )
  ) {
    return fallbackPath;
  }

  if (
    selectedWorktreePath === fallbackPath ||
    worktrees.some((worktree) => worktree.path === selectedWorktreePath)
  ) {
    return selectedWorktreePath;
  }

  return fallbackPath;
}
