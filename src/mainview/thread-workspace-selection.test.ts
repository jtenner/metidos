/**
 * @file src/mainview/thread-workspace-selection.test.ts
 * @description Test file for thread-driven workspace selection helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcThread } from "../bun/rpc-schema";
import {
  derivePrimaryViewForPinnedThreadOpen,
  deriveSelectedThreadWorkspaceTarget,
  planSelectedWorktreeThreadSync,
  type ThreadWorkspaceSelectionState,
  transitionThreadWorkspaceSelection,
} from "./thread-workspace-selection";
import { deriveSelectedWorktreeThreadSyncPlan } from "./thread-workspace-selection-controller";

function project(overrides?: Partial<RpcProject>): RpcProject {
  return {
    createdAt: "2026-04-08T00:00:00.000Z",
    id: 1,
    isOpen: 0,
    lastOpenedAt: "2026-04-08T00:00:00.000Z",
    name: "starshine-mb",
    path: "/repo",
    updatedAt: "2026-04-08T00:00:00.000Z",
    ...overrides,
  };
}

const baseSelectionState: ThreadWorkspaceSelectionState = {
  contextFocus: null,
  optimisticThread: null,
  primaryView: "diff",
  projectId: null,
  threadId: null,
  worktreePath: null,
};

function thread(overrides?: Partial<RpcThread>): RpcThread {
  return {
    agentsAccess: false,
    piSessionId: null,
    piSessionFile: null,
    piLeafEntryId: null,
    compaction: {
      estimatedTriggerSource: "heuristic",
      estimatedTriggerTokens: 120_000,
      inferredCount: 0,
      lastInferredAfterInputTokens: null,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      maxObservedInputTokens: null,
    },
    createdAt: "2026-04-08T00:00:00.000Z",
    githubAccess: false,
    id: 7,
    metidosAccess: true,
    lastRunAt: null,
    model: "gpt-5.4",
    pinnedAt: null,
    projectId: 1,
    reasoningEffort: "medium",
    webSearchAccess: true,
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    summary: "summary",
    title: "Pinned thread",
    unsafeMode: false,
    updatedAt: "2026-04-08T00:00:00.000Z",
    usage: null,
    worktreePath: "/repo/feature",
    ...overrides,
  };
}

describe("transitionThreadWorkspaceSelection", () => {
  it("selects a Project without carrying Worktree or Thread selection", () => {
    expect(
      transitionThreadWorkspaceSelection(
        {
          ...baseSelectionState,
          threadId: 7,
          worktreePath: "/repo/feature",
        },
        { type: "select-project", projectId: 2 },
      ),
    ).toEqual({
      effects: ["open-project"],
      state: {
        ...baseSelectionState,
        primaryView: "diff",
        projectId: 2,
      },
    });
  });

  it("opens a Worktree and clears selected Thread state", () => {
    expect(
      transitionThreadWorkspaceSelection(
        { ...baseSelectionState, projectId: 1, threadId: 7 },
        { type: "open-worktree", projectId: 1, worktreePath: "/repo/feature" },
      ).state,
    ).toMatchObject({
      projectId: 1,
      threadId: null,
      worktreePath: "/repo/feature",
    });
  });

  it("opens a Thread in chat for its Project and Worktree", () => {
    expect(
      transitionThreadWorkspaceSelection(baseSelectionState, {
        type: "open-thread",
        projectId: 1,
        threadId: 7,
        worktreePath: "/repo/feature",
      }).state,
    ).toMatchObject({
      primaryView: "chat",
      projectId: 1,
      threadId: 7,
      worktreePath: "/repo/feature",
    });
  });

  it("applies Context Focus to a Project navigation target", () => {
    expect(
      transitionThreadWorkspaceSelection(
        {
          ...baseSelectionState,
          primaryView: "calendar",
          projectId: 2,
          threadId: 11,
          worktreePath: "/other",
        },
        {
          type: "apply-context-focus",
          target: {
            type: "project",
            projectId: 1,
          },
        },
      ),
    ).toEqual({
      effects: ["open-project"],
      state: {
        ...baseSelectionState,
        contextFocus: {
          type: "project",
          projectId: 1,
        },
        primaryView: "calendar",
        projectId: 1,
      },
    });
  });

  it("applies Context Focus to a Worktree navigation target", () => {
    expect(
      transitionThreadWorkspaceSelection(baseSelectionState, {
        type: "apply-context-focus",
        target: {
          type: "worktree",
          projectId: 1,
          worktreePath: "/repo/feature",
        },
      }),
    ).toEqual({
      effects: ["open-project", "open-worktree"],
      state: {
        ...baseSelectionState,
        contextFocus: {
          type: "worktree",
          projectId: 1,
          worktreePath: "/repo/feature",
        },
        projectId: 1,
        worktreePath: "/repo/feature",
      },
    });
  });

  it("applies Context Focus to a Thread navigation target", () => {
    expect(
      transitionThreadWorkspaceSelection(baseSelectionState, {
        type: "apply-context-focus",
        target: {
          type: "thread",
          projectId: 1,
          threadId: 7,
          worktreePath: "/repo/feature",
        },
      }),
    ).toEqual({
      effects: ["open-project", "open-worktree", "open-thread"],
      state: {
        ...baseSelectionState,
        contextFocus: {
          type: "thread",
          projectId: 1,
          threadId: 7,
          worktreePath: "/repo/feature",
        },
        primaryView: "chat",
        projectId: 1,
        threadId: 7,
        worktreePath: "/repo/feature",
      },
    });
  });

  it("clears Thread selection while preserving Project and Worktree", () => {
    expect(
      transitionThreadWorkspaceSelection(
        {
          ...baseSelectionState,
          projectId: 1,
          threadId: 7,
          worktreePath: "/repo/feature",
        },
        { type: "clear-thread" },
      ).state,
    ).toMatchObject({
      projectId: 1,
      threadId: null,
      worktreePath: "/repo/feature",
    });
  });

  it("creates an optimistic Thread for the active Worktree", () => {
    expect(
      transitionThreadWorkspaceSelection(baseSelectionState, {
        type: "create-optimistic-thread",
        projectId: 1,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      effects: ["create-thread"],
      state: {
        ...baseSelectionState,
        optimisticThread: {
          projectId: 1,
          worktreePath: "/repo/feature",
        },
        primaryView: "chat",
        projectId: 1,
        worktreePath: "/repo/feature",
      },
    });
  });

  it("reconciles the selected Thread workspace target after persistence catches up", () => {
    expect(
      transitionThreadWorkspaceSelection(
        {
          ...baseSelectionState,
          optimisticThread: {
            projectId: 1,
            worktreePath: "/repo/feature",
          },
        },
        {
          type: "reconcile-selected-thread-workspace-target",
          target: {
            projectId: 1,
            projectName: "starshine-mb",
            projectOpen: true,
            projectPath: "/repo",
            threadId: 7,
            worktreePath: "/repo/feature",
          },
        },
      ).state,
    ).toMatchObject({
      optimisticThread: null,
      projectId: 1,
      threadId: 7,
      worktreePath: "/repo/feature",
    });
  });
});

describe("deriveSelectedWorktreeThreadSyncPlan", () => {
  it("plans to open the preferred Thread for a selected Worktree", () => {
    const selectedProjectIdRef = { current: 1 };
    const selectedThreadIdRef = { current: null };
    const selectedWorktreePathRef = { current: "/repo/feature" };

    expect(
      deriveSelectedWorktreeThreadSyncPlan({
        projectId: 1,
        selectedProjectIdRef,
        selectedThreadIdRef,
        selectedWorktreePathRef,
        threadOpenInFlight: false,
        threads: [thread({ id: 9, worktreePath: "/repo/feature" })],
        worktreeAutoCreationInFlight: false,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      action: "open-thread",
      threadId: 9,
    });
  });
});

describe("deriveSelectedThreadWorkspaceTarget", () => {
  it("returns the thread workspace target even when the project is still closed", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project({ isOpen: 0 }),
        selectedThread: thread(),
        sessionStateReady: true,
      }),
    ).toEqual({
      projectId: 1,
      projectName: "starshine-mb",
      projectOpen: false,
      projectPath: "/repo",
      threadId: 7,
      worktreePath: "/repo/feature",
    });
  });

  it("returns null when the active worktree does not match the selected thread", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/main",
        selectedProject: project({ isOpen: 1 }),
        selectedThread: thread(),
        sessionStateReady: true,
      }),
    ).toBeNull();
  });

  it("returns null when the selected project does not own the selected thread", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project({ id: 2, isOpen: 1 }),
        selectedThread: thread(),
        sessionStateReady: true,
      }),
    ).toBeNull();
  });

  it("returns null until session state is ready", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project({ isOpen: 1 }),
        selectedThread: thread(),
        sessionStateReady: false,
      }),
    ).toBeNull();
  });
});

describe("derivePrimaryViewForPinnedThreadOpen", () => {
  it("returns chat when the current workspace view is diff", () => {
    expect(derivePrimaryViewForPinnedThreadOpen("diff")).toBe("chat");
  });

  it("returns chat when the current workspace view is cronjobs", () => {
    expect(derivePrimaryViewForPinnedThreadOpen("cronjobs")).toBe("chat");
  });

  it("keeps chat selected when the workspace is already on chat", () => {
    expect(derivePrimaryViewForPinnedThreadOpen("chat")).toBe("chat");
  });
});

describe("planSelectedWorktreeThreadSync", () => {
  it("opens the preferred thread when the selected worktree already has one", () => {
    expect(
      planSelectedWorktreeThreadSync({
        preferredThreadId: 7,
        projectId: 1,
        selectedProjectId: 1,
        selectedThreadId: null,
        selectedWorktreePath: "/repo/feature",
        threadOpenInFlight: false,
        worktreeAutoCreationInFlight: false,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      action: "open-thread",
      threadId: 7,
    });
  });

  it("creates a new thread only when the selected worktree is active and idle", () => {
    expect(
      planSelectedWorktreeThreadSync({
        preferredThreadId: null,
        projectId: 1,
        selectedProjectId: 1,
        selectedThreadId: null,
        selectedWorktreePath: "/repo/feature",
        threadOpenInFlight: false,
        worktreeAutoCreationInFlight: false,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      action: "create-thread",
    });
  });

  it("does nothing when the preferred thread is already selected", () => {
    expect(
      planSelectedWorktreeThreadSync({
        preferredThreadId: 7,
        projectId: 1,
        selectedProjectId: 1,
        selectedThreadId: 7,
        selectedWorktreePath: "/repo/feature",
        threadOpenInFlight: false,
        worktreeAutoCreationInFlight: false,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      action: "noop",
    });
  });

  it("does not replace a selected worktree thread with a different preferred thread", () => {
    expect(
      planSelectedWorktreeThreadSync({
        preferredThreadId: 7,
        projectId: 1,
        selectedProjectId: 1,
        selectedThreadId: -1,
        selectedWorktreePath: "/repo/feature",
        threadOpenInFlight: false,
        worktreeAutoCreationInFlight: false,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      action: "noop",
    });
  });

  it("does nothing while an auto-created worktree thread is already in flight", () => {
    expect(
      planSelectedWorktreeThreadSync({
        preferredThreadId: null,
        projectId: 1,
        selectedProjectId: 1,
        selectedThreadId: null,
        selectedWorktreePath: "/repo/feature",
        threadOpenInFlight: false,
        worktreeAutoCreationInFlight: true,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      action: "noop",
    });
  });
});
