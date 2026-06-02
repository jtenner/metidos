/**
 * @file src/mainview/app/mainview-shell-state.test.ts
 * @description Test file for Mainview shell-state helpers.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcProject,
  RpcThread,
  RpcThreadStartRequest,
  RpcWorktree,
} from "../../bun/rpc-schema";
import {
  applyMainviewShellThreadStartRequestCreated,
  applyMainviewShellThreadStartRequestResolved,
  applyMainviewShellThreadStatusEvent,
  buildMainviewShellHiddenWorktreeHydration,
  buildMainviewShellOpenedWorktreeHydration,
  buildMainviewShellProjectWorktreeHydration,
  buildMainviewShellSelectedThreadDetailRefreshState,
  buildMainviewShellWorktreePinRollback,
  buildPersistedMainviewShellState,
  clearMainviewShellCompletedThreadIndicator,
  commitMainviewShellNavigationUpdate,
  createMainviewShellState,
  createPersistedMainviewShellStateWriter,
  haveSameMainviewShellCompletedThreadIndicatorIds,
  planMainviewShellHiddenWorktreeOpen,
  planMainviewShellWorktreePin,
  readMainviewShellThreadActivityIndicator,
  resolveMainviewShellActiveWorktreeHydrationTarget,
  resolveMainviewShellCompletedThreadIndicators,
  selectMainviewShellProject,
  shouldMainviewShellEnsureActiveWorktree,
  shouldRefreshMainviewShellSelectedThreadDetail,
  transitionMainviewShellState,
  type MainviewShellState,
} from "./mainview-shell-state";
import { MAINVIEW_STATE_STORAGE_VERSION } from "./persisted-mainview-state";
import { createProjectStore } from "./project-store";
import {
  buildProjectWorktreeIndex,
  defaultProjectState,
  type ProjectStateMap,
} from "./project-worktree-state";
import { createThreadStore, emptyThreadStore } from "./thread-store";

function project(overrides?: Partial<RpcProject>): RpcProject {
  return {
    createdAt: "2026-05-10T00:00:00.000Z",
    id: 1,
    isOpen: 1,
    lastOpenedAt: "2026-05-10T00:00:00.000Z",
    name: "Project 1",
    path: "/repo",
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

function worktree(path: string, branch = "main"): RpcWorktree {
  return {
    bare: false,
    branch,
    head: "abc123",
    path,
    pinnedAt: null,
  };
}

function thread(overrides?: Partial<RpcThread>): RpcThread {
  return {
    id: 7,
    projectId: 1,
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    worktreePath: "/repo/feature",
    ...overrides,
  } as RpcThread;
}

function projectStates(): ProjectStateMap {
  return {
    1: {
      ...defaultProjectState(),
      ...buildProjectWorktreeIndex([
        worktree("/repo"),
        worktree("/repo/feature", "feature"),
      ]),
      openWorktrees: new Set(["/repo/feature"]),
    },
  };
}

const baseShellState: MainviewShellState = createMainviewShellState({
  primaryView: "diff",
  projectStates: {},
  selectedProjectId: null,
  selectedThreadId: null,
  selectedWorktreePath: null,
  sessionStateReady: true,
});

function persistedBaseShellState() {
  const persistedState = buildPersistedMainviewShellState(baseShellState, {
    chatInput: "",
    pendingThreadModel: "gpt-5.4",
    pendingThreadPermissions: [],
    pendingThreadReasoningEffort: "medium",
    sidebarCollapsed: false,
    sidebarSearchQuery: "",
  });
  if (persistedState === null) {
    throw new Error("Expected base shell state to be persistence-ready.");
  }
  return persistedState;
}

describe("mainview shell state", () => {
  it("commits navigation selections through a single shell boundary", () => {
    const refs = {
      selectedProjectIdRef: { current: 1 as number | null },
      selectedThreadIdRef: { current: 7 as number | null },
      selectedWorktreePathRef: { current: "/repo" as string | null },
    };
    let currentPrimaryView: MainviewShellState["primaryView"] = "diff";
    const committed: string[] = [];

    const commitNavigationUpdate = (
      update: Parameters<typeof commitMainviewShellNavigationUpdate>[0],
    ): void => {
      commitMainviewShellNavigationUpdate(update, {
        refs,
        setters: {
          setPrimaryView: (value) => {
            currentPrimaryView = value;
            committed.push(`view:${String(value)}`);
          },
          setSelectedProjectId: (value) => {
            committed.push(`project:${String(value)}`);
          },
          setSelectedThreadId: (value) => {
            committed.push(`thread:${String(value)}`);
          },
          setSelectedWorktreePath: (value) => {
            committed.push(`worktree:${String(value)}`);
          },
        },
      });
    };

    commitNavigationUpdate({
      primaryView: "chat",
      selectedProjectId: (current) => (current ?? 0) + 1,
      selectedThreadId: null,
      selectedWorktreePath: "/repo/feature",
    });

    expect(refs.selectedProjectIdRef.current).toBe(2);
    expect(refs.selectedThreadIdRef.current).toBeNull();
    expect(refs.selectedWorktreePathRef.current).toBe("/repo/feature");
    expect(committed).toEqual([
      "project:2",
      "worktree:/repo/feature",
      "thread:null",
      "view:chat",
    ]);

    committed.length = 0;

    for (const primaryView of [
      "diff",
      "cronjobs",
      "calendar",
      "chat",
    ] satisfies MainviewShellState["primaryView"][]) {
      commitNavigationUpdate({ primaryView });
      expect(currentPrimaryView).toBe(primaryView);
      expect(refs.selectedProjectIdRef.current).toBe(2);
      expect(refs.selectedThreadIdRef.current).toBeNull();
      expect(refs.selectedWorktreePathRef.current).toBe("/repo/feature");
    }

    expect(committed).toEqual([
      "view:diff",
      "view:cronjobs",
      "view:calendar",
      "view:chat",
    ]);
  });

  it("debounces persisted shell state writes and flushes the latest state", () => {
    const timeoutCallbacks: Array<() => void> = [];
    const clearedTimeouts: number[] = [];
    const writes: number[] = [];
    const writer = createPersistedMainviewShellStateWriter({
      debounceMs: 5,
      windowRef: {
        clearTimeout: (handle) => {
          clearedTimeouts.push(handle);
        },
        setTimeout: (callback) => {
          timeoutCallbacks.push(callback);
          return clearedTimeouts.length + 1;
        },
      },
      writeState: (state) => {
        writes.push(state.selectedProjectId ?? -1);
      },
    });

    writer.schedule({
      ...persistedBaseShellState(),
      selectedProjectId: 1,
    });
    writer.schedule({
      ...persistedBaseShellState(),
      selectedProjectId: 2,
    });

    expect(clearedTimeouts).toEqual([1]);
    const scheduledWrite = timeoutCallbacks.at(-1);
    if (!scheduledWrite) {
      throw new Error("Expected persisted-state write to be scheduled.");
    }
    scheduledWrite();
    expect(writes).toEqual([2]);
    writer.flush();
    expect(writes).toEqual([2]);
  });

  it("applies selection transitions while preserving shell readiness and open worktrees", () => {
    const shellState = createMainviewShellState({
      primaryView: "calendar",
      projectStates: projectStates(),
      selectedProjectId: 2,
      selectedThreadId: 11,
      selectedWorktreePath: "/other",
      sessionStateReady: true,
    });

    expect(
      transitionMainviewShellState(shellState, {
        type: "open-thread",
        projectId: 1,
        threadId: 7,
        worktreePath: "/repo/feature",
      }),
    ).toEqual({
      effects: ["open-thread"],
      state: {
        ...shellState,
        primaryView: "chat",
        selectedProjectId: 1,
        selectedThreadId: 7,
        selectedWorktreePath: "/repo/feature",
      },
    });
  });

  it("falls back to a Project primary worktree when no explicit worktree path is supplied", () => {
    expect(
      selectMainviewShellProject({
        project: project(),
        worktreePath: undefined,
        worktrees: [worktree("/repo/feature", "feature"), worktree("/repo")],
      }),
    ).toEqual({
      selectedProjectId: 1,
      selectedWorktreePath: "/repo",
    });
  });

  it("keeps an explicit worktree selection over the primary fallback", () => {
    expect(
      selectMainviewShellProject({
        project: project(),
        worktreePath: "/repo/feature",
        worktrees: [worktree("/repo")],
      }),
    ).toEqual({
      selectedProjectId: 1,
      selectedWorktreePath: "/repo/feature",
    });
  });

  it("builds Project Worktree hydration updates behind the shell seam", () => {
    const update = buildMainviewShellProjectWorktreeHydration([
      worktree("/repo"),
      worktree("/repo/feature", "feature"),
    ]);

    expect(update).toMatchObject({
      error: "",
      loadingWorktrees: false,
      worktreeByPath: {
        "/repo": worktree("/repo"),
        "/repo/feature": worktree("/repo/feature", "feature"),
      },
      worktreePaths: ["/repo", "/repo/feature"],
    });
    expect(update.worktreesLoadedAt).toBeNumber();
  });

  it("preserves open Worktree state when the shell hydrates an opened Worktree", () => {
    const update = buildMainviewShellOpenedWorktreeHydration({
      currentProjectState: {
        ...defaultProjectState(),
        openWorktrees: new Set(["/repo"]),
      },
      worktreePath: "/repo/feature",
      worktrees: [worktree("/repo"), worktree("/repo/feature", "feature")],
    });

    expect([...update.openWorktrees].sort()).toEqual([
      "/repo",
      "/repo/feature",
    ]);
    expect(update.worktreePaths).toEqual(["/repo", "/repo/feature"]);
  });

  it("hydrates hidden Worktree menu data with the initial hidden selection", () => {
    const hiddenWorktrees = [worktree("/repo/hidden", "hidden")];

    expect(
      buildMainviewShellHiddenWorktreeHydration({
        hiddenWorktrees,
        worktrees: [worktree("/repo")],
      }),
    ).toMatchObject({
      hiddenWorktreePath: "/repo/hidden",
      hiddenWorktrees,
      projectUpdate: {
        error: "",
        loadingWorktrees: false,
        worktreePaths: ["/repo"],
      },
    });
  });

  it("plans hidden Worktree opening through the shell seam", () => {
    expect(
      planMainviewShellHiddenWorktreeOpen({
        hiddenWorktreePath: "/repo/hidden",
        isCreatingWorkspace: false,
        isOpeningHiddenWorktree: false,
        project: project(),
        worktreePinBusyPath: null,
      }),
    ).toEqual({
      ok: true,
      project: project(),
      worktreePath: "/repo/hidden",
    });
    expect(
      planMainviewShellHiddenWorktreeOpen({
        hiddenWorktreePath: "/repo/hidden",
        isCreatingWorkspace: false,
        isOpeningHiddenWorktree: false,
        project: null,
        worktreePinBusyPath: null,
      }),
    ).toEqual({
      ok: false,
      error: "Project no longer exists.",
    });
    expect(
      planMainviewShellHiddenWorktreeOpen({
        hiddenWorktreePath: "/repo/hidden",
        isCreatingWorkspace: true,
        isOpeningHiddenWorktree: false,
        project: project(),
        worktreePinBusyPath: null,
      }),
    ).toEqual({ ok: false });
  });

  it("plans optimistic Worktree pin updates and rollback state", () => {
    const projectState = {
      ...defaultProjectState(),
      ...buildProjectWorktreeIndex([worktree("/repo")]),
    };
    const plan = planMainviewShellWorktreePin({
      currentlyPinned: false,
      nowIso: "2026-05-10T19:00:00.000Z",
      projectId: 1,
      projectState,
      worktreePath: "/repo",
    });

    expect(plan).toEqual({
      ok: true,
      busyKey: "1::/repo",
      nextPinned: true,
      projectUpdate: {
        error: "",
        worktreeByPath: {
          "/repo": {
            ...worktree("/repo"),
            pinnedAt: "2026-05-10T19:00:00.000Z",
          },
        },
      },
    });
    expect(
      buildMainviewShellWorktreePinRollback({
        error: "Pin failed.",
        projectState,
      }),
    ).toEqual({
      error: "Pin failed.",
      worktreeByPath: projectState.worktreeByPath,
      worktreePaths: projectState.worktreePaths,
    });
  });

  it("returns a metadata loading error when pinning an unknown Worktree", () => {
    expect(
      planMainviewShellWorktreePin({
        currentlyPinned: false,
        nowIso: "2026-05-10T19:00:00.000Z",
        projectId: 1,
        projectState: defaultProjectState(),
        worktreePath: "/repo/missing",
      }),
    ).toEqual({
      ok: false,
      projectUpdate: {
        error: "Folder metadata is still loading.",
      },
    });
  });

  it("resolves active Worktree hydration only for a selected Thread missing an opened Worktree", () => {
    const target = resolveMainviewShellActiveWorktreeHydrationTarget({
      activeSelectedWorktreePath: "/repo/feature",
      selectedProject: project(),
      selectedThread: thread(),
      sessionStateReady: true,
      worktreeState: {
        error: "",
        loading: false,
        opened: false,
      },
    });

    expect(target).toEqual({
      projectId: 1,
      projectName: "Project 1",
      projectOpen: true,
      projectPath: "/repo",
      threadId: 7,
      worktreePath: "/repo/feature",
    });
    expect(
      resolveMainviewShellActiveWorktreeHydrationTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project(),
        selectedThread: thread(),
        sessionStateReady: true,
        worktreeState: {
          error: "",
          loading: false,
          opened: true,
        },
      }),
    ).toBeNull();
    expect(shouldMainviewShellEnsureActiveWorktree(defaultProjectState())).toBe(
      false,
    );
    expect(
      shouldMainviewShellEnsureActiveWorktree({
        ...defaultProjectState(),
        ...buildProjectWorktreeIndex([worktree("/repo")]),
      }),
    ).toBe(true);
  });

  it("reconciles Thread start request runtime events without duplicates", () => {
    const request = {
      projectId: 1,
      requestId: "request-1",
      threadId: 7,
      worktreePath: "/repo",
    } as RpcThreadStartRequest;
    const created = applyMainviewShellThreadStartRequestCreated(
      {
        pendingThreadStartRequests: [],
        threadStartRequestError: "Needs approval.",
      },
      request,
    );
    const duplicated = applyMainviewShellThreadStartRequestCreated(
      created,
      request,
    );

    expect(created).toEqual({
      pendingThreadStartRequests: [request],
      threadStartRequestError: "",
    });
    expect(duplicated.pendingThreadStartRequests).toBe(
      created.pendingThreadStartRequests,
    );
    expect(
      applyMainviewShellThreadStartRequestResolved(duplicated, "request-1"),
    ).toEqual({
      pendingThreadStartRequests: [],
      threadStartRequestError: "",
    });
  });

  it("applies Thread status runtime events only for known Projects or Threads", () => {
    const knownProjectStore = createProjectStore([project()]);
    const unknownProjectThread = thread({ id: 8, projectId: 2 });
    const knownProjectThread = thread({ id: 7, projectId: 1 });
    const acceptedByProject = applyMainviewShellThreadStatusEvent({
      projectStore: knownProjectStore,
      thread: knownProjectThread,
      threadStore: emptyThreadStore(),
    });

    expect(acceptedByProject.byId[7]).toBe(knownProjectThread);
    expect(
      applyMainviewShellThreadStatusEvent({
        projectStore: createProjectStore([]),
        thread: unknownProjectThread,
        threadStore: emptyThreadStore(),
      }),
    ).toEqual(emptyThreadStore());
    expect(
      applyMainviewShellThreadStatusEvent({
        projectStore: createProjectStore([]),
        thread: { ...knownProjectThread, title: "Fresh update" } as RpcThread,
        threadStore: createThreadStore([knownProjectThread]),
      }).byId[7]?.title,
    ).toBe("Fresh update");
  });

  it("plans selected Thread detail refresh triggers for working, stopped, and errored summaries", () => {
    const idleDetail = {
      thread: thread({
        runStatus: {
          error: null,
          hasUnreadError: false,
          startedAt: null,
          state: "idle",
          updatedAt: "2026-05-10T19:10:00.000Z",
        },
        updatedAt: "2026-05-10T19:10:00.000Z",
      }),
    };
    const refreshState =
      buildMainviewShellSelectedThreadDetailRefreshState(idleDetail);

    expect(refreshState).toEqual({
      detailRefreshKey:
        "7:2026-05-10T19:10:00.000Z:idle:2026-05-10T19:10:00.000Z",
      runState: "idle",
    });
    expect(
      shouldRefreshMainviewShellSelectedThreadDetail({
        previousSelectedRunState: "idle",
        selectedSummaryRunState: "working",
      }),
    ).toBe(true);
    expect(
      shouldRefreshMainviewShellSelectedThreadDetail({
        lastLoadedSelectedDetailRefreshKey: "old",
        previousSelectedRunState: "working",
        selectedSummaryDetailRefreshKey: refreshState.detailRefreshKey,
        selectedSummaryRunState: "stopped",
      }),
    ).toBe(true);
    expect(
      shouldRefreshMainviewShellSelectedThreadDetail({
        lastLoadedSelectedDetailRefreshKey: "old",
        previousSelectedRunState: "idle",
        selectedSummaryDetailRefreshKey: refreshState.detailRefreshKey,
        selectedSummaryRunState: "failed",
      }),
    ).toBe(true);
    expect(
      shouldRefreshMainviewShellSelectedThreadDetail({
        previousSelectedRunState: "idle",
        selectedSummaryDetailRefreshKey: refreshState.detailRefreshKey,
        selectedSummaryRunState: "idle",
      }),
    ).toBe(false);
  });

  it("resolves completed Thread indicators and mobile runtime status", () => {
    const working = thread({
      id: 7,
      runStatus: {
        error: null,
        hasUnreadError: false,
        startedAt: "2026-05-10T19:00:00.000Z",
        state: "working",
        updatedAt: "2026-05-10T19:00:00.000Z",
      },
    });
    const completed = thread({
      id: 7,
      runStatus: {
        error: null,
        hasUnreadError: false,
        startedAt: "2026-05-10T19:00:00.000Z",
        state: "idle",
        updatedAt: "2026-05-10T19:05:00.000Z",
      },
    });

    expect(
      resolveMainviewShellCompletedThreadIndicators({
        completedThreadIndicatorIds: new Set(),
        hasWorkingThreads: true,
        previousThreadRunStates: new Map(),
        selectedThreadId: null,
        threads: [working],
      }).nextMobileNavigationIndicator,
    ).toBe("working");

    const completedIndicators = resolveMainviewShellCompletedThreadIndicators({
      completedThreadIndicatorIds: new Set(),
      hasWorkingThreads: false,
      previousThreadRunStates: new Map([[7, "working"]]),
      selectedThreadId: null,
      threads: [completed],
    });
    expect(completedIndicators.nextMobileNavigationIndicator).toBe("completed");
    expect([...completedIndicators.nextCompletedThreadIndicatorIds]).toEqual([
      7,
    ]);
    expect(
      readMainviewShellThreadActivityIndicator({
        completedThreadIndicatorIds:
          completedIndicators.nextCompletedThreadIndicatorIds,
        selectedThreadId: null,
        thread: completed,
      }),
    ).toBe("completed");
    expect(
      readMainviewShellThreadActivityIndicator({
        completedThreadIndicatorIds:
          completedIndicators.nextCompletedThreadIndicatorIds,
        selectedThreadId: 7,
        thread: completed,
      }),
    ).toBe("none");
    expect(
      clearMainviewShellCompletedThreadIndicator(
        completedIndicators.nextCompletedThreadIndicatorIds,
        7,
      ),
    ).toEqual(new Set());
    expect(
      haveSameMainviewShellCompletedThreadIndicatorIds(
        new Set([7]),
        new Set([7]),
      ),
    ).toBe(true);
  });

  it("serializes durable shell state only after startup state is ready", () => {
    const shellState = createMainviewShellState({
      primaryView: "diff",
      projectStates: projectStates(),
      selectedProjectId: 1,
      selectedThreadId: 7,
      selectedWorktreePath: "/repo/feature",
      sessionStateReady: true,
    });

    expect(
      buildPersistedMainviewShellState(shellState, {
        chatInput: "",
        pendingThreadModel: "gpt-5.4",
        pendingThreadPermissions: ["metidos:threads"],
        pendingThreadReasoningEffort: "medium",
        sidebarCollapsed: true,
        sidebarSearchQuery: "feature",
      }),
    ).toEqual({
      version: MAINVIEW_STATE_STORAGE_VERSION,
      selectedProjectId: 1,
      selectedWorktreePath: "/repo/feature",
      selectedThreadId: 7,
      pendingThreadModel: "gpt-5.4",
      pendingThreadReasoningEffort: "medium",
      pendingThreadPermissions: ["metidos:threads"],
      chatInput: "",
      sidebarCollapsed: true,
      sidebarSearchQuery: "feature",
      openWorktrees: [{ projectId: 1, worktreePath: "/repo/feature" }],
    });
  });

  it("does not persist shell state before session startup hydration completes", () => {
    expect(
      buildPersistedMainviewShellState(
        {
          ...baseShellState,
          sessionStateReady: false,
        },
        {
          chatInput: "",
          pendingThreadModel: "gpt-5.4",
          pendingThreadPermissions: [],
          pendingThreadReasoningEffort: "medium",
          sidebarCollapsed: false,
          sidebarSearchQuery: "",
        },
      ),
    ).toBeNull();
  });
});
