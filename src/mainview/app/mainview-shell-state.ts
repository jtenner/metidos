/**
 * @file src/mainview/app/mainview-shell-state.ts
 * @description Pure Mainview shell-state helpers for selection and persistence decisions.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  RpcProject,
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcWorktree,
} from "../../bun/rpc-schema";
import { buildLoadedProjectWorktreesState } from "../project-worktree-refresh";
import type {
  ContextFocusTarget,
  MainviewPrimaryView,
  SelectedThreadWorkspaceTarget,
  ThreadWorkspaceSelectionEffect,
  ThreadWorkspaceSelectionIntent,
} from "../thread-workspace-selection";
import {
  deriveSelectedThreadWorkspaceTarget,
  transitionThreadWorkspaceSelection,
} from "../thread-workspace-selection";
import {
  buildSelectedThreadDetailRefreshKey,
  buildThreadRunStateSnapshot,
  haveSameCompletedThreadIndicatorIds,
  mergeThreadStatusSummaries,
  readThreadActivityIndicator,
  resolveCompletedThreadIndicatorState,
  resolveThreadStatusRefreshOutcome,
  shouldRefreshSelectedThreadDetail,
  type ThreadActivityIndicator,
  type ThreadStatusRefreshOutcome,
} from "../thread-status-refresh";
import {
  MAINVIEW_STATE_STORAGE_VERSION,
  MAINVIEW_STATE_WRITE_DEBOUNCE_MS,
  type PersistedMainviewState,
  type PersistedOpenWorktree,
  writePersistedMainviewState,
} from "./persisted-mainview-state";
import { serializeOpenWorktrees } from "./persisted-thread-state";
import type { ProjectStore } from "./project-store";
import {
  primaryWorktreePath,
  projectStateWorktrees,
  type ProjectNodeState,
  type ProjectStateMap,
  type WorktreeNodeState,
  worktreeKey,
} from "./project-worktree-state";
import {
  shouldAcceptThreadStoreUpdate,
  type ThreadStore,
  upsertThreadStore,
} from "./thread-store";

export type { MainviewPrimaryView } from "../thread-workspace-selection";

export type MainviewShellState = {
  contextFocus: ContextFocusTarget | null;
  openWorktrees: PersistedOpenWorktree[];
  optimisticThread: {
    projectId: number;
    worktreePath: string;
  } | null;
  primaryView: MainviewPrimaryView;
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  sessionStateReady: boolean;
};

export type MainviewShellTransitionOutcome = {
  effects: ThreadWorkspaceSelectionEffect[];
  state: MainviewShellState;
};

export type MainviewShellSelection = Pick<
  MainviewShellState,
  "selectedProjectId" | "selectedWorktreePath"
>;

export type MainviewShellPersistenceFields = Pick<
  PersistedMainviewState,
  | "chatInput"
  | "pendingThreadModel"
  | "pendingThreadPermissions"
  | "pendingThreadReasoningEffort"
  | "sidebarCollapsed"
  | "sidebarSearchQuery"
>;

export type MainviewShellNavigationUpdate = {
  primaryView?: SetStateAction<MainviewPrimaryView>;
  selectedProjectId?: SetStateAction<number | null>;
  selectedThreadId?: SetStateAction<number | null>;
  selectedWorktreePath?: SetStateAction<string | null>;
};

export type MainviewShellNavigationCommitTarget = {
  refs: {
    selectedProjectIdRef: MutableRefObject<number | null>;
    selectedThreadIdRef: MutableRefObject<number | null>;
    selectedWorktreePathRef: MutableRefObject<string | null>;
  };
  setters: {
    setPrimaryView: Dispatch<SetStateAction<MainviewPrimaryView>>;
    setSelectedProjectId: Dispatch<SetStateAction<number | null>>;
    setSelectedThreadId: Dispatch<SetStateAction<number | null>>;
    setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
  };
};

export type PersistedMainviewShellStateWriter = {
  dispose: () => void;
  flush: () => void;
  schedule: (nextState: PersistedMainviewState) => void;
};

export type MainviewShellThreadStartRequestState = {
  pendingThreadStartRequests: RpcThreadStartRequest[];
  threadStartRequestError: string;
};

export type MainviewShellSelectedThreadDetailRefreshState = {
  detailRefreshKey: string | null;
  runState: RpcThreadRunStatus["state"];
};

export type MainviewShellMobileNavigationIndicatorState =
  | "none"
  | "working"
  | "completed";

export type MainviewShellCompletedThreadIndicatorUpdate = {
  nextCompletedThreadIndicatorIds: Set<number>;
  nextMobileNavigationIndicator: MainviewShellMobileNavigationIndicatorState;
  nextThreadRunStates: Map<number, RpcThreadRunStatus["state"]>;
};

type PersistedMainviewShellStateWriteWindow = {
  cancelIdleCallback?: (handle: number) => void;
  clearTimeout: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  setTimeout: (callback: () => void, timeout: number) => number;
};

type PersistedMainviewShellStateWriterOptions = {
  debounceMs?: number;
  writeState?: (state: PersistedMainviewState) => void;
  windowRef?: PersistedMainviewShellStateWriteWindow;
};

function hasShellUpdateField<T extends object>(
  value: T,
  property: PropertyKey,
): boolean {
  return Object.hasOwn(value, property);
}

function resolveSetStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (current: T) => T)(current)
    : action;
}

export function applyMainviewShellThreadStartRequestCreated(
  state: MainviewShellThreadStartRequestState,
  request: RpcThreadStartRequest,
): MainviewShellThreadStartRequestState {
  if (
    state.pendingThreadStartRequests.some(
      (candidate) => candidate.requestId === request.requestId,
    )
  ) {
    return {
      pendingThreadStartRequests: state.pendingThreadStartRequests,
      threadStartRequestError: "",
    };
  }

  return {
    pendingThreadStartRequests: [...state.pendingThreadStartRequests, request],
    threadStartRequestError: "",
  };
}

export function applyMainviewShellThreadStartRequestResolved(
  state: MainviewShellThreadStartRequestState,
  requestId: string,
): MainviewShellThreadStartRequestState {
  return {
    pendingThreadStartRequests: state.pendingThreadStartRequests.filter(
      (request) => request.requestId !== requestId,
    ),
    threadStartRequestError: "",
  };
}

export function applyMainviewShellThreadStatusEvent(options: {
  projectStore: ProjectStore;
  thread: RpcThread;
  threadStore: ThreadStore;
}): ThreadStore {
  if (
    !shouldAcceptThreadStoreUpdate(
      options.projectStore,
      options.threadStore,
      options.thread,
    )
  ) {
    return options.threadStore;
  }

  return upsertThreadStore(options.threadStore, options.thread);
}

export function buildMainviewShellSelectedThreadDetailRefreshState(
  detail: Pick<RpcThreadDetail, "thread">,
): MainviewShellSelectedThreadDetailRefreshState {
  return {
    detailRefreshKey: buildSelectedThreadDetailRefreshKey(detail.thread),
    runState: detail.thread.runStatus.state,
  };
}

export function shouldRefreshMainviewShellSelectedThreadDetail(options: {
  lastLoadedSelectedDetailRefreshKey?: string | null;
  previousSelectedRunState: RpcThreadRunStatus["state"];
  selectedSummaryDetailRefreshKey?: string | null;
  selectedSummaryRunState: RpcThreadRunStatus["state"];
}): boolean {
  return shouldRefreshSelectedThreadDetail(options);
}

export function mergeMainviewShellThreadStatusSummaries(options: {
  currentThreadStore: ThreadStore;
  loadedThreadStatuses: RpcThread[];
}): ThreadStore {
  return mergeThreadStatusSummaries(options);
}

export function resolveMainviewShellThreadStatusRefreshOutcome(options: {
  currentThreadStore: ThreadStore;
  detail: RpcThreadDetail | null;
  loadedThreadStatuses: RpcThread[];
  selectedSummaryThreadId: number;
  selectedThreadId: number | null;
}): ThreadStatusRefreshOutcome {
  return resolveThreadStatusRefreshOutcome(options);
}

export function readMainviewShellThreadActivityIndicator(options: {
  completedThreadIndicatorIds: ReadonlySet<number>;
  selectedThreadId: number | null;
  thread: Pick<RpcThread, "id" | "runStatus"> | null | undefined;
}): ThreadActivityIndicator {
  return readThreadActivityIndicator(options);
}

export function clearMainviewShellCompletedThreadIndicator(
  currentCompletedThreadIds: Set<number>,
  threadId: number,
): Set<number> {
  if (!currentCompletedThreadIds.has(threadId)) {
    return currentCompletedThreadIds;
  }

  const nextCompletedThreadIds = new Set(currentCompletedThreadIds);
  nextCompletedThreadIds.delete(threadId);
  return nextCompletedThreadIds;
}

export function resolveMainviewShellCompletedThreadIndicators(options: {
  completedThreadIndicatorIds: ReadonlySet<number>;
  hasWorkingThreads: boolean;
  previousThreadRunStates: ReadonlyMap<number, RpcThreadRunStatus["state"]>;
  selectedThreadId: number | null;
  threads: RpcThread[];
}): MainviewShellCompletedThreadIndicatorUpdate {
  const { hasUnreadCompletedThread, nextCompletedThreadIds } =
    resolveCompletedThreadIndicatorState({
      currentCompletedThreadIds: options.completedThreadIndicatorIds,
      previousThreadRunStates: options.previousThreadRunStates,
      selectedThreadId: options.selectedThreadId,
      threads: options.threads,
    });

  return {
    nextCompletedThreadIndicatorIds: nextCompletedThreadIds,
    nextMobileNavigationIndicator: hasUnreadCompletedThread
      ? "completed"
      : options.hasWorkingThreads
        ? "working"
        : "none",
    nextThreadRunStates: buildThreadRunStateSnapshot(options.threads),
  };
}

export function haveSameMainviewShellCompletedThreadIndicatorIds(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): boolean {
  return haveSameCompletedThreadIndicatorIds(left, right);
}

export function createMainviewShellState(options: {
  contextFocus?: ContextFocusTarget | null;
  optimisticThread?: MainviewShellState["optimisticThread"];
  primaryView: MainviewPrimaryView;
  projectStates: ProjectStateMap;
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  sessionStateReady: boolean;
}): MainviewShellState {
  return {
    contextFocus: options.contextFocus ?? null,
    openWorktrees: serializeOpenWorktrees(options.projectStates),
    optimisticThread: options.optimisticThread ?? null,
    primaryView: options.primaryView,
    selectedProjectId: options.selectedProjectId,
    selectedThreadId: options.selectedThreadId,
    selectedWorktreePath: options.selectedWorktreePath,
    sessionStateReady: options.sessionStateReady,
  };
}

export function transitionMainviewShellState(
  state: MainviewShellState,
  intent: ThreadWorkspaceSelectionIntent,
): MainviewShellTransitionOutcome {
  const outcome = transitionThreadWorkspaceSelection(
    {
      contextFocus: state.contextFocus,
      optimisticThread: state.optimisticThread,
      primaryView: state.primaryView,
      projectId: state.selectedProjectId,
      threadId: state.selectedThreadId,
      worktreePath: state.selectedWorktreePath,
    },
    intent,
  );

  return {
    effects: outcome.effects,
    state: {
      ...state,
      contextFocus: outcome.state.contextFocus,
      optimisticThread: outcome.state.optimisticThread,
      primaryView: outcome.state.primaryView,
      selectedProjectId: outcome.state.projectId,
      selectedThreadId: outcome.state.threadId,
      selectedWorktreePath: outcome.state.worktreePath,
    },
  };
}

export function selectMainviewShellProject(options: {
  project: RpcProject;
  worktreePath: string | null | undefined;
  worktrees: RpcWorktree[];
}): MainviewShellSelection {
  return {
    selectedProjectId: options.project.id,
    selectedWorktreePath:
      options.worktreePath ??
      primaryWorktreePath(options.project, options.worktrees),
  };
}

export type MainviewShellProjectWorktreeHydration = Pick<
  ProjectNodeState,
  | "error"
  | "loadingWorktrees"
  | "worktreeByPath"
  | "worktreePaths"
  | "worktreesLoadedAt"
>;

export type MainviewShellHiddenWorktreeHydration = {
  hiddenWorktreePath: string;
  hiddenWorktrees: RpcWorktree[];
  projectUpdate: MainviewShellProjectWorktreeHydration;
};

export type MainviewShellWorktreePinPlan =
  | {
      ok: true;
      busyKey: string;
      nextPinned: boolean;
      projectUpdate: Pick<ProjectNodeState, "error" | "worktreeByPath">;
    }
  | {
      ok: false;
      projectUpdate: Pick<ProjectNodeState, "error">;
    };

export type MainviewShellHiddenWorktreeOpenPlan =
  | {
      ok: true;
      project: RpcProject;
      worktreePath: string;
    }
  | {
      ok: false;
      error?: string;
    };

export type MainviewShellActiveWorktreeHydrationTarget =
  SelectedThreadWorkspaceTarget;

export function buildMainviewShellProjectWorktreeHydration(
  worktrees: RpcWorktree[],
): MainviewShellProjectWorktreeHydration {
  return buildLoadedProjectWorktreesState(worktrees);
}

export function buildMainviewShellOpenedWorktreeHydration(options: {
  currentProjectState: ProjectNodeState;
  worktreePath: string;
  worktrees: RpcWorktree[];
}): MainviewShellProjectWorktreeHydration &
  Pick<ProjectNodeState, "openWorktrees"> {
  return {
    ...buildMainviewShellProjectWorktreeHydration(options.worktrees),
    openWorktrees: new Set([
      ...options.currentProjectState.openWorktrees,
      options.worktreePath,
    ]),
  };
}

export function buildMainviewShellHiddenWorktreeHydration(options: {
  hiddenWorktrees: RpcWorktree[];
  worktrees: RpcWorktree[];
}): MainviewShellHiddenWorktreeHydration {
  return {
    hiddenWorktrees: options.hiddenWorktrees,
    hiddenWorktreePath: options.hiddenWorktrees[0]?.path ?? "",
    projectUpdate: buildMainviewShellProjectWorktreeHydration(
      options.worktrees,
    ),
  };
}

export function planMainviewShellWorktreePin(options: {
  currentlyPinned: boolean;
  nowIso: string;
  projectId: number;
  projectState: ProjectNodeState;
  worktreePath: string;
}): MainviewShellWorktreePinPlan {
  const previousWorktree =
    options.projectState.worktreeByPath[options.worktreePath];
  if (!previousWorktree) {
    return {
      ok: false,
      projectUpdate: {
        error: "Folder metadata is still loading.",
      },
    };
  }

  const nextPinned = !options.currentlyPinned;
  return {
    ok: true,
    busyKey: worktreeKey(options.projectId, options.worktreePath),
    nextPinned,
    projectUpdate: {
      worktreeByPath: {
        ...options.projectState.worktreeByPath,
        [options.worktreePath]: {
          ...previousWorktree,
          pinnedAt: nextPinned ? options.nowIso : null,
        },
      },
      error: "",
    },
  };
}

export function buildMainviewShellWorktreePinRollback(options: {
  error: string;
  projectState: ProjectNodeState;
}): Pick<ProjectNodeState, "error" | "worktreeByPath" | "worktreePaths"> {
  return {
    worktreeByPath: options.projectState.worktreeByPath,
    worktreePaths: options.projectState.worktreePaths,
    error: options.error,
  };
}

export function planMainviewShellHiddenWorktreeOpen(options: {
  hiddenWorktreePath: string;
  isCreatingWorkspace: boolean;
  isOpeningHiddenWorktree: boolean;
  project: RpcProject | null;
  worktreePinBusyPath: string | null;
}): MainviewShellHiddenWorktreeOpenPlan {
  if (
    !options.hiddenWorktreePath ||
    options.isCreatingWorkspace ||
    options.isOpeningHiddenWorktree ||
    options.worktreePinBusyPath
  ) {
    return { ok: false };
  }

  if (!options.project) {
    return {
      ok: false,
      error: "Project no longer exists.",
    };
  }

  return {
    ok: true,
    project: options.project,
    worktreePath: options.hiddenWorktreePath,
  };
}

export function resolveMainviewShellActiveWorktreeHydrationTarget(options: {
  activeSelectedWorktreePath: string | null;
  getWorktreeState?: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  selectedProject: RpcProject | null;
  selectedThread: RpcThread | null;
  sessionStateReady: boolean;
  worktreeState?: WorktreeNodeState | null;
}): MainviewShellActiveWorktreeHydrationTarget | null {
  const targetWorkspace = deriveSelectedThreadWorkspaceTarget({
    activeSelectedWorktreePath: options.activeSelectedWorktreePath,
    selectedProject: options.selectedProject,
    selectedThread: options.selectedThread,
    sessionStateReady: options.sessionStateReady,
  });
  if (!targetWorkspace) {
    return null;
  }

  const worktreeState =
    options.worktreeState ??
    options.getWorktreeState?.(
      targetWorkspace.projectId,
      targetWorkspace.worktreePath,
    ) ??
    null;
  if (worktreeState?.loading || worktreeState?.opened) {
    return null;
  }

  return targetWorkspace;
}

export function shouldMainviewShellEnsureActiveWorktree(
  projectState: ProjectNodeState,
): boolean {
  return projectStateWorktrees(projectState).length > 0;
}

export function commitMainviewShellNavigationUpdate(
  update: MainviewShellNavigationUpdate,
  target: MainviewShellNavigationCommitTarget,
): void {
  if (hasShellUpdateField(update, "selectedProjectId")) {
    const nextProjectId = resolveSetStateAction(
      update.selectedProjectId ?? null,
      target.refs.selectedProjectIdRef.current,
    );
    target.refs.selectedProjectIdRef.current = nextProjectId;
    target.setters.setSelectedProjectId(nextProjectId);
  }

  if (hasShellUpdateField(update, "selectedWorktreePath")) {
    const nextWorktreePath = resolveSetStateAction(
      update.selectedWorktreePath ?? null,
      target.refs.selectedWorktreePathRef.current,
    );
    target.refs.selectedWorktreePathRef.current = nextWorktreePath;
    target.setters.setSelectedWorktreePath(nextWorktreePath);
  }

  if (hasShellUpdateField(update, "selectedThreadId")) {
    const nextThreadId = resolveSetStateAction(
      update.selectedThreadId ?? null,
      target.refs.selectedThreadIdRef.current,
    );
    target.refs.selectedThreadIdRef.current = nextThreadId;
    target.setters.setSelectedThreadId(nextThreadId);
  }

  if (hasShellUpdateField(update, "primaryView")) {
    target.setters.setPrimaryView(update.primaryView ?? "chat");
  }
}

export function createPersistedMainviewShellStateWriter(
  options: PersistedMainviewShellStateWriterOptions = {},
): PersistedMainviewShellStateWriter {
  const windowRef = options.windowRef ?? window;
  const debounceMs = options.debounceMs ?? MAINVIEW_STATE_WRITE_DEBOUNCE_MS;
  const writeState = options.writeState ?? writePersistedMainviewState;
  let pendingState: PersistedMainviewState | null = null;
  let timeoutHandle: number | null = null;
  let idleHandle: number | null = null;

  const cancelScheduledWrite = (): void => {
    if (timeoutHandle !== null) {
      windowRef.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (idleHandle !== null) {
      windowRef.cancelIdleCallback?.(idleHandle);
      idleHandle = null;
    }
  };

  const flush = (): void => {
    cancelScheduledWrite();
    if (pendingState === null) {
      return;
    }
    writeState(pendingState);
    pendingState = null;
  };

  const schedule = (nextState: PersistedMainviewState): void => {
    pendingState = nextState;
    cancelScheduledWrite();

    const scheduleWrite = (): void => {
      timeoutHandle = null;
      if (windowRef.requestIdleCallback) {
        idleHandle = windowRef.requestIdleCallback(flush, {
          timeout: debounceMs,
        });
        return;
      }
      flush();
    };

    timeoutHandle = windowRef.setTimeout(scheduleWrite, debounceMs);
  };

  const dispose = (): void => {
    cancelScheduledWrite();
    pendingState = null;
  };

  return { dispose, flush, schedule };
}

export function buildPersistedMainviewShellState(
  shellState: MainviewShellState,
  fields: MainviewShellPersistenceFields,
): PersistedMainviewState | null {
  if (!shellState.sessionStateReady) {
    return null;
  }

  return {
    version: MAINVIEW_STATE_STORAGE_VERSION,
    selectedProjectId: shellState.selectedProjectId,
    selectedWorktreePath: shellState.selectedWorktreePath,
    selectedThreadId: shellState.selectedThreadId,
    pendingThreadModel: fields.pendingThreadModel,
    pendingThreadReasoningEffort: fields.pendingThreadReasoningEffort,
    pendingThreadPermissions: fields.pendingThreadPermissions,
    chatInput: fields.chatInput,
    sidebarCollapsed: fields.sidebarCollapsed,
    sidebarSearchQuery: fields.sidebarSearchQuery,
    openWorktrees: shellState.openWorktrees,
  };
}
