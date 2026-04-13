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

export type SelectedWorktreeThreadSyncPlan =
  | {
      action: "noop";
    }
  | {
      action: "open-thread";
      threadId: number;
    }
  | {
      action: "create-thread";
    };

/**
 * Pinned-thread shortcuts always return the main workspace view to chat.
 */
export function derivePrimaryViewForPinnedThreadOpen(
  primaryView: "chat" | "diff" | "cronjobs",
): "chat" | "diff" | "cronjobs" {
  return primaryView === "chat" ? primaryView : "chat";
}

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

/**
 * Plans whether the shell should open an existing thread, create a new one, or
 * do nothing when the selected worktree changes.
 */
export function planSelectedWorktreeThreadSync(options: {
  preferredThreadId: number | null;
  projectId: number;
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  threadOpenInFlight: boolean;
  worktreeAutoCreationInFlight: boolean;
  worktreePath: string;
}): SelectedWorktreeThreadSyncPlan {
  if (options.preferredThreadId !== null) {
    if (
      options.selectedThreadId === options.preferredThreadId ||
      options.threadOpenInFlight
    ) {
      return {
        action: "noop",
      };
    }

    return {
      action: "open-thread",
      threadId: options.preferredThreadId,
    };
  }

  if (
    options.selectedProjectId !== options.projectId ||
    options.selectedWorktreePath !== options.worktreePath ||
    options.selectedThreadId !== null ||
    options.threadOpenInFlight ||
    options.worktreeAutoCreationInFlight
  ) {
    return {
      action: "noop",
    };
  }

  return {
    action: "create-thread",
  };
}
