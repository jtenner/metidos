/**
 * @file src/mainview/thread-workspace-selection.ts
 * @description Selection helpers for keeping thread-driven workspace context in sync.
 */

import type { RpcProject, RpcThread } from "../bun/rpc-schema";

export type SelectedThreadWorkspaceTarget = {
  projectId: number;
  projectName: string;
  projectPath: string;
  projectOpen: boolean;
  threadId: number;
  worktreePath: string;
};

/**
 * Resolve the workspace target implied by the selected thread when it matches the active worktree selection.
 */
export function deriveSelectedThreadWorkspaceTarget(options: {
  activeSelectedWorktreePath: string | null;
  selectedProject: RpcProject | null;
  selectedThread: RpcThread | null;
  sessionStateReady: boolean;
}): SelectedThreadWorkspaceTarget | null {
  const {
    activeSelectedWorktreePath,
    selectedProject,
    selectedThread,
    sessionStateReady,
  } = options;

  if (
    !sessionStateReady ||
    !selectedThread ||
    !selectedProject ||
    selectedProject.id !== selectedThread.projectId ||
    !activeSelectedWorktreePath ||
    activeSelectedWorktreePath !== selectedThread.worktreePath
  ) {
    return null;
  }

  return {
    projectId: selectedThread.projectId,
    projectName: selectedProject.name,
    projectOpen: selectedProject.isOpen === 1,
    projectPath: selectedProject.path,
    threadId: selectedThread.id,
    worktreePath: selectedThread.worktreePath,
  };
}
