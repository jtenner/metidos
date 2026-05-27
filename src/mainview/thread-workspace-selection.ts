/**
 * @file src/mainview/thread-workspace-selection.ts
 * @description Selection helpers for keeping thread-driven workspace context in sync.
 */

import type { RpcProject, RpcThread } from "../bun/rpc-schema";

export type MainviewPrimaryView = "chat" | "diff" | "cronjobs" | "calendar";

export type ContextFocusTarget =
  | {
      type: "project";
      projectId: number;
    }
  | {
      type: "worktree";
      projectId: number;
      worktreePath: string;
    }
  | {
      type: "thread";
      projectId: number;
      threadId: number;
      worktreePath: string;
    };

export type ThreadWorkspaceSelectionState = {
  contextFocus: ContextFocusTarget | null;
  optimisticThread: {
    projectId: number;
    worktreePath: string;
  } | null;
  primaryView: MainviewPrimaryView;
  projectId: number | null;
  threadId: number | null;
  worktreePath: string | null;
};

export type ThreadWorkspaceSelectionIntent =
  | {
      type: "select-project";
      projectId: number;
    }
  | {
      type: "open-worktree";
      projectId: number;
      worktreePath: string;
    }
  | {
      type: "open-thread";
      projectId: number;
      threadId: number;
      worktreePath: string;
    }
  | {
      type: "clear-thread";
    }
  | {
      type: "apply-context-focus";
      target: ContextFocusTarget;
    }
  | {
      type: "create-optimistic-thread";
      projectId: number;
      worktreePath: string;
    }
  | {
      type: "reconcile-selected-thread-workspace-target";
      target: SelectedThreadWorkspaceTarget | null;
    };

export type ThreadWorkspaceSelectionEffect =
  | "open-project"
  | "open-worktree"
  | "open-thread"
  | "create-thread";

export type ThreadWorkspaceSelectionOutcome = {
  state: ThreadWorkspaceSelectionState;
  effects: ThreadWorkspaceSelectionEffect[];
};

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

export function transitionThreadWorkspaceSelection(
  state: ThreadWorkspaceSelectionState,
  intent: ThreadWorkspaceSelectionIntent,
): ThreadWorkspaceSelectionOutcome {
  switch (intent.type) {
    case "select-project":
      return {
        effects: ["open-project"],
        state: {
          ...state,
          contextFocus: null,
          optimisticThread: null,
          projectId: intent.projectId,
          threadId: null,
          worktreePath: null,
        },
      };
    case "open-worktree":
      return {
        effects: ["open-worktree"],
        state: {
          ...state,
          contextFocus: null,
          optimisticThread: null,
          projectId: intent.projectId,
          threadId: null,
          worktreePath: intent.worktreePath,
        },
      };
    case "open-thread":
      return {
        effects: ["open-thread"],
        state: {
          ...state,
          contextFocus: null,
          optimisticThread: null,
          primaryView: "chat",
          projectId: intent.projectId,
          threadId: intent.threadId,
          worktreePath: intent.worktreePath,
        },
      };
    case "clear-thread":
      return {
        effects: [],
        state: {
          ...state,
          optimisticThread: null,
          threadId: null,
        },
      };
    case "apply-context-focus": {
      const targetState = stateForContextFocusTarget(state, intent.target);
      return {
        effects:
          intent.target.type === "project"
            ? ["open-project"]
            : intent.target.type === "worktree"
              ? ["open-project", "open-worktree"]
              : ["open-project", "open-worktree", "open-thread"],
        state: {
          ...targetState,
          contextFocus: intent.target,
        },
      };
    }
    case "create-optimistic-thread":
      return {
        effects: ["create-thread"],
        state: {
          ...state,
          optimisticThread: {
            projectId: intent.projectId,
            worktreePath: intent.worktreePath,
          },
          primaryView: "chat",
          projectId: intent.projectId,
          threadId: null,
          worktreePath: intent.worktreePath,
        },
      };
    case "reconcile-selected-thread-workspace-target":
      if (!intent.target) {
        return { effects: [], state };
      }

      return {
        effects: [],
        state: {
          ...state,
          optimisticThread: null,
          projectId: intent.target.projectId,
          threadId: intent.target.threadId,
          worktreePath: intent.target.worktreePath,
        },
      };
  }
}

function stateForContextFocusTarget(
  state: ThreadWorkspaceSelectionState,
  target: ContextFocusTarget,
): ThreadWorkspaceSelectionState {
  if (target.type === "project") {
    return {
      ...state,
      optimisticThread: null,
      projectId: target.projectId,
      threadId: null,
      worktreePath: null,
    };
  }

  if (target.type === "worktree") {
    return {
      ...state,
      optimisticThread: null,
      projectId: target.projectId,
      threadId: null,
      worktreePath: target.worktreePath,
    };
  }

  return {
    ...state,
    optimisticThread: null,
    primaryView: "chat",
    projectId: target.projectId,
    threadId: target.threadId,
    worktreePath: target.worktreePath,
  };
}

/**
 * Pinned-thread shortcuts always return the main workspace view to chat.
 */
export function derivePrimaryViewForPinnedThreadOpen(
  primaryView: "chat" | "diff" | "cronjobs" | "calendar",
): "chat" | "diff" | "cronjobs" | "calendar" {
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
      options.threadOpenInFlight ||
      (options.selectedThreadId !== null &&
        options.selectedProjectId === options.projectId &&
        options.selectedWorktreePath === options.worktreePath)
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
