import {
  type FormEvent,
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ProjectProcedures,
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
  RpcGitHistoryEntry,
  RpcProject,
  RpcProjectTask,
  RpcRequestPriority,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
  RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";
import { ProjectActionMenu, ThreadActionMenu } from "./app/action-menus";
import { DesktopChatView, MobileChatView } from "./app/chat-workspace";
import { DesktopSidebar } from "./app/desktop-sidebar";
import { DiffWorkspace } from "./app/diff-workspace";
import { GitHistoryDiffModal } from "./app/message-ui";
import { SidebarContent } from "./app/sidebar-content";
import {
  readSidebarPanelsSnapshot,
  setProjectTreeOpen,
} from "./app/sidebar-panels-state";
import {
  APP_TITLE,
  appendGitHistoryPage,
  awaitAbortableResult,
  clampProjectMenuCoordinate,
  createAbortError,
  defaultProjectState,
  defaultWorktreeState,
  formatDirectoryPathForInput,
  GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
  GIT_HISTORY_PAGE_SIZE,
  GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
  type GitHistoryDiffCacheEntry,
  type GitHistoryModalState,
  gitHistoryDiffCacheKey,
  isAbortError,
  isCodexReasoningEffort,
  latestThreadForWorktree,
  MAINVIEW_STATE_STORAGE_VERSION,
  mergeResetGitHistory,
  type OpenThreadOptions,
  type PendingSharedRequest,
  type PersistedMainviewState,
  PROJECT_TASK_RESULT_CACHE_MAX_ENTRIES,
  type ProjectActionMenuState,
  type ProjectNodeState,
  type ProjectStateMap,
  patchPersistedMainviewState,
  pickInitialThread,
  pinnedThreadForWorktree,
  primaryWorktreePath,
  readLruValue,
  readPersistedMainviewState,
  removeThreadFromList,
  serializeOpenWorktrees,
  sortThreads,
  THREAD_START_REQUEST_CREATED_EVENT_NAME,
  THREAD_STATUS_POLL_INTERVAL_MS,
  type ThreadActionMenuState,
  upsertProjectList,
  upsertThreadList,
  type VisibleMessage,
  WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
  WORKTREE_TASKS_CHANGED_EVENT_NAME,
  type WorktreeNodeState,
  type WorktreeStateMap,
  withAcknowledgedUnreadThread,
  withAcknowledgedUnreadThreadDetail,
  worktreeKey,
  worktreeThreadPopoverAnchorId,
  writeLruValue,
  writePersistedMainviewState,
} from "./app/state";
import { TasksWorkspace } from "./app/tasks-workspace";
import { ThreadList } from "./app/thread-list-row";
import { useAddProjectForm } from "./app/use-add-project-form";
import { useMainviewDerivedState } from "./app/use-mainview-derived-state";
import { useWorktreeDiff } from "./app/use-worktree-diff";
import {
  readChatComposerDraft,
  setChatComposerDraft,
} from "./controls/chat-composer-control";
import { brandBoltIcon, materialSymbol } from "./controls/icons";

type AppProps = {
  procedures: ProjectProcedures;
};

const WORKTREE_THREAD_POPOVER_DESKTOP_WIDTH_PX = 360;
const WORKTREE_THREAD_POPOVER_MOBILE_WIDTH_PX = 320;
const WORKTREE_THREAD_POPOVER_ESTIMATED_HEIGHT_PX = 420;
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
type PrimaryView = "chat" | "diff" | "tasks";
type WorktreeThreadPopoverState = {
  maxHeight: number;
  width: number;
  x: number;
  y: number;
};
type MobileNavigationIndicatorState = "none" | "working" | "completed";

function sortThreadsByUpdatedAt(items: RpcThread[]): RpcThread[] {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function useDesktopViewport(): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return matches;
}

function isThreadNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Thread not found:");
}

function areWorktreeChangesEqual(
  left: RpcWorktreeChange[],
  right: RpcWorktreeChange[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every((change, index) => {
    const other = right[index];
    return (
      change.path === other?.path &&
      change.previousPath === other.previousPath &&
      change.stagedStatus === other.stagedStatus &&
      change.unstagedStatus === other.unstagedStatus
    );
  });
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function areWorktreeSnapshotsEquivalent(
  left: RpcWorktreeSnapshot | undefined,
  right: RpcWorktreeSnapshot | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.path === right.path &&
    areWorktreeChangesEqual(left.changes, right.changes) &&
    areStringArraysEqual(left.diff, right.diff) &&
    areStringArraysEqual(left.files, right.files)
  );
}

declare global {
  interface Window {
    __joltAppMountedAt?: number;
  }
}

export default function App({ procedures }: AppProps): JSX.Element {
  const initialMainviewStateRef = useRef<PersistedMainviewState | null>(null);
  if (!initialMainviewStateRef.current) {
    initialMainviewStateRef.current = readPersistedMainviewState();
  }
  const initialMainviewState = initialMainviewStateRef.current;

  const [projects, setProjects] = useState<RpcProject[]>([]);
  const [projectStates, setProjectStates] = useState<ProjectStateMap>({});
  const [worktreeStates, setWorktreeStates] = useState<WorktreeStateMap>({});
  const [homeDirectory, setHomeDirectory] = useState("");
  const [supportsTildePath, setSupportsTildePath] = useState(false);
  const [projectActionMenu, setProjectActionMenu] =
    useState<ProjectActionMenuState | null>(null);
  const [threadActionMenu, setThreadActionMenu] =
    useState<ThreadActionMenuState | null>(null);
  const [projectActionMenuError, setProjectActionMenuError] = useState("");
  const [threadActionMenuError, setThreadActionMenuError] = useState("");
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [threadRenameTitle, setThreadRenameTitle] = useState("");
  const [threadRenameSummary, setThreadRenameSummary] = useState("");
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [worktreePinBusyPath, setWorktreePinBusyPath] = useState<string | null>(
    null,
  );
  const [threads, setThreads] = useState<RpcThread[]>([]);
  const [projectTasks, setProjectTasks] = useState<RpcProjectTask[]>([]);
  const [gitHistory, setGitHistory] =
    useState<RpcWorktreeGitHistoryResult | null>(null);
  const [gitHistoryLoading, setGitHistoryLoading] = useState(false);
  const [gitHistoryLoadingMore, setGitHistoryLoadingMore] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState("");
  const [gitHistoryModal, setGitHistoryModal] =
    useState<GitHistoryModalState | null>(null);
  const [codexModels, setCodexModels] = useState<RpcCodexModelOption[]>([]);
  const [reasoningEfforts, setReasoningEfforts] = useState<
    RpcCodexReasoningEffortOption[]
  >([]);
  const [defaultCodexModel, setDefaultCodexModel] = useState("");
  const [defaultCodexReasoningEffort, setDefaultCodexReasoningEffort] =
    useState<RpcCodexReasoningEffort>("medium");
  const [pendingThreadModel, setPendingThreadModel] = useState(
    initialMainviewState.pendingThreadModel,
  );
  const [pendingThreadReasoningEffort, setPendingThreadReasoningEffort] =
    useState<RpcCodexReasoningEffort>(
      isCodexReasoningEffort(initialMainviewState.pendingThreadReasoningEffort)
        ? initialMainviewState.pendingThreadReasoningEffort
        : defaultCodexReasoningEffort,
    );
  const [pendingThreadUnsafeMode, setPendingThreadUnsafeMode] = useState(
    initialMainviewState.pendingThreadUnsafeMode === true,
  );
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(
    initialMainviewState.selectedThreadId,
  );
  const [threadMessages, setThreadMessages] = useState<RpcThreadMessage[]>([]);
  const [threadsError, setThreadsError] = useState("");
  const [modelControlError, setModelControlError] = useState("");
  const [taskControlError, setTaskControlError] = useState("");
  const [chatError, setChatError] = useState("");
  const [pendingThreadStartRequests, setPendingThreadStartRequests] = useState<
    RpcThreadStartRequest[]
  >([]);
  const [threadStartRequestError, setThreadStartRequestError] = useState("");
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState(
    initialMainviewState.sidebarSearchQuery,
  );
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isApprovingThreadStartRequest, setIsApprovingThreadStartRequest] =
    useState(false);
  const [isLoadingProjectTasks, setIsLoadingProjectTasks] = useState(false);
  const [isRunningProjectTask, setIsRunningProjectTask] = useState(false);
  const [isUpdatingThreadModel, setIsUpdatingThreadModel] = useState(false);
  const [isUpdatingThreadReasoningEffort, setIsUpdatingThreadReasoningEffort] =
    useState(false);
  const [isUpdatingThreadUnsafeMode, setIsUpdatingThreadUnsafeMode] =
    useState(false);
  const [threadActionBusy, setThreadActionBusy] = useState<
    "rename" | "pin" | "delete" | null
  >(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialMainviewState.sidebarCollapsed,
  );
  const sidebarCollapsedRef = useRef(initialMainviewState.sidebarCollapsed);
  const [mobileProjectListOpen, setMobileProjectListOpen] = useState(false);
  const [mobileNavigationIndicator, setMobileNavigationIndicator] =
    useState<MobileNavigationIndicatorState>("none");
  const [completedThreadIndicatorIds, setCompletedThreadIndicatorIds] =
    useState(() => new Set<number>());
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    initialMainviewState.selectedProjectId,
  );
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<
    string | null
  >(initialMainviewState.selectedWorktreePath);
  const [isSending, setIsSending] = useState(false);
  const [isStoppingThread, setIsStoppingThread] = useState(false);
  const [reasoningEffortControlError, setReasoningEffortControlError] =
    useState("");
  const [unsafeModeControlError, setUnsafeModeControlError] = useState("");
  const [sessionStateReady, setSessionStateReady] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const [primaryView, setPrimaryView] = useState<PrimaryView>("chat");
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<
    string | null
  >(null);
  const [expandedTranscriptItemIds, setExpandedTranscriptItemIds] = useState(
    () => new Set<string>(),
  );
  const [worktreeThreadPopover, setWorktreeThreadPopover] =
    useState<WorktreeThreadPopoverState | null>(null);
  const isDesktopViewport = useDesktopViewport();

  const handleSidebarCollapsedChange = useCallback(
    (collapsed: boolean): void => {
      sidebarCollapsedRef.current = collapsed;
      setSidebarCollapsed(collapsed);
      patchPersistedMainviewState({
        sidebarCollapsed: collapsed,
      });
    },
    [],
  );
  const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
  const worktreeThreadPopoverRef = useRef<HTMLDivElement | null>(null);
  const desktopSidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarScrollRef = useRef<HTMLElement | null>(null);
  const projectActionMenuRequestId = useRef(0);
  const projectTasksRequestIdRef = useRef(0);
  const projectTasksAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryRequestIdRef = useRef(0);
  const gitHistoryAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryDiffRequestIdRef = useRef(0);
  const gitHistoryDiffAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryDiffPreloadAbortControllerRef = useRef(
    new Map<string, AbortController>(),
  );
  const gitHistoryLoadMoreAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const activeWorktreeSyncAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const threadOpenRequestIdRef = useRef(0);
  const threadOpenAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryLoadingMoreRef = useRef(false);
  const projectWorktreeRequestCacheRef = useRef(
    new Map<number, Promise<RpcWorktree[]>>(),
  );
  const gitHistoryDiffCacheRef = useRef(
    new Map<string, GitHistoryDiffCacheEntry>(),
  );
  const gitHistoryDiffRequestCacheRef = useRef(
    new Map<string, PendingSharedRequest<GitHistoryDiffCacheEntry>>(),
  );
  const gitHistoryCacheRef = useRef(
    new Map<string, RpcWorktreeGitHistoryResult>(),
  );
  const projectTaskCacheRef = useRef(new Map<string, RpcProjectTask[]>());
  const skipFreshGitHistoryRefreshRef = useRef(new Set<string>());
  const skipFreshProjectTaskRefreshRef = useRef(new Set<string>());
  const homeDirectoryPrefetchQueryRef = useRef<string | null>(null);
  const selectedThreadIdRef = useRef<number | null>(null);
  const previousSelectedThreadIdRef = useRef<number | null>(
    initialMainviewState.selectedThreadId,
  );
  const selectedProjectIdRef = useRef<number | null>(
    initialMainviewState.selectedProjectId,
  );
  const selectedWorktreePathRef = useRef<string | null>(
    initialMainviewState.selectedWorktreePath,
  );
  const threadCreationInFlightCountRef = useRef(0);
  const selectedThreadRunStateRef = useRef<RpcThreadRunStatus["state"]>("idle");
  const optimisticallyAcknowledgedThreadIdsRef = useRef(new Set<number>());
  const threadErrorSeenRequestCacheRef = useRef(
    new Map<number, Promise<RpcThreadDetail>>(),
  );
  const worktreeToggleRequestIdRef = useRef(new Map<string, number>());
  const threadStatusPollInFlightRef = useRef(false);
  const initializedRef = useRef(false);
  const previousThreadRunStatesRef = useRef(
    new Map<number, RpcThreadRunStatus["state"]>(),
  );
  const getProjectState = useCallback(
    (projectId: number): ProjectNodeState =>
      projectStates[projectId] ?? defaultProjectState(),
    [projectStates],
  );

  const getWorktreeState = useCallback(
    (projectId: number, worktreePath: string): WorktreeNodeState => {
      const key = worktreeKey(projectId, worktreePath);
      return worktreeStates[key] ?? defaultWorktreeState();
    },
    [worktreeStates],
  );

  const selectProject = useCallback(
    (project: RpcProject, worktreePath?: string | null): void => {
      const nextWorktreePath =
        worktreePath ??
        primaryWorktreePath(project, getProjectState(project.id).worktrees);
      selectedProjectIdRef.current = project.id;
      selectedWorktreePathRef.current = nextWorktreePath;
      setSelectedProjectId(project.id);
      setSelectedWorktreePath(nextWorktreePath);
    },
    [getProjectState],
  );

  const {
    activeChatError,
    activeChatNotice,
    activeCodexModel,
    activeContextInputTokens,
    activeContextWindowTokens,
    activePollingProjectId,
    activePollingWorktreePath,
    activeReasoningEffort,
    activeUnsafeMode,
    activeScreenSubtitlePrimary,
    activeScreenSubtitleSecondary,
    activeScreenTitle,
    activeSelectedWorktree,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreeName,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    activeWorktreeChanges,
    activeWorktreeSnapshot,
    composerActionDisabled,
    composerActionLabel,
    diffFileTree,
    dismissThreadStatus,
    filteredGitHistoryEntries,
    filteredProjects,
    filteredWorkspaceActiveThreads,
    filteredWorkspacePinnedThreads,
    hasWorkingThreads,
    isActiveWorktree,
    isThreadStatusDismissed,
    localUserLabel,
    modelSelectorDisabled,
    normalizedSidebarSearchQuery,
    projectActionMenuProject,
    projectThreadErrorLevel,
    reasoningEffortSelectorDisabled,
    selectedDiffFileChange,
    selectedProject,
    selectedThread,
    selectedThreadIsWorking,
    taskSelectorDisabled,
    threadActionMenuThread,
    unsafeModeToggleDisabled,
    worktreeThreadErrorLevel,
  } = useMainviewDerivedState({
    chatError,
    codexModels,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    getProjectState,
    getWorktreeState,
    gitHistory,
    homeDirectory,
    isCreatingThread,
    isDocumentVisible,
    isLoadingProjectTasks,
    isRunningProjectTask,
    isSending,
    isStoppingThread,
    isThreadLoading,
    isUpdatingThreadModel,
    isUpdatingThreadReasoningEffort,
    isUpdatingThreadUnsafeMode,
    pendingThreadModel,
    pendingThreadReasoningEffort,
    pendingThreadUnsafeMode,
    projectActionMenu,
    projects,
    reasoningEfforts,
    selectedDiffFilePath,
    selectedProjectId,
    selectedThreadId,
    selectedWorktreePath,
    sidebarSearchQuery,
    supportsTildePath,
    threadActionMenu,
    threads,
  });

  const currentThreadStartRequest = pendingThreadStartRequests[0] ?? null;
  const currentThreadStartRequestProject =
    currentThreadStartRequest === null
      ? null
      : (projects.find(
          (project) => project.id === currentThreadStartRequest.projectId,
        ) ?? null);
  const currentThreadStartRequestWorkspace = currentThreadStartRequest
    ? formatDirectoryPathForInput(
        currentThreadStartRequest.worktreePath,
        homeDirectory,
        supportsTildePath,
      )
    : "";
  const dismissWorktreeThreadPopover = useCallback((): void => {
    setWorktreeThreadPopover(null);
  }, []);
  const selectedWorktreeThreads = useMemo(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return [];
    }

    return sortThreadsByUpdatedAt(
      threads.filter(
        (thread) =>
          thread.projectId === selectedProject.id &&
          thread.worktreePath === activeSelectedWorktreePath,
      ),
    );
  }, [activeSelectedWorktreePath, selectedProject, threads]);
  const clearCompletedThreadIndicator = useCallback(
    (threadId: number): void => {
      setCompletedThreadIndicatorIds((current) => {
        if (!current.has(threadId)) {
          return current;
        }

        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    },
    [],
  );
  const threadActivityIndicator = useCallback(
    (threadId: number): "none" | "working" | "completed" => {
      if (completedThreadIndicatorIds.has(threadId)) {
        return "completed";
      }

      return threads.find((thread) => thread.id === threadId)?.runStatus
        .state === "working"
        ? "working"
        : "none";
    },
    [completedThreadIndicatorIds, threads],
  );
  const toggleTranscriptItemExpanded = useCallback((messageKey: string) => {
    setExpandedTranscriptItemIds((current) => {
      const next = new Set(current);
      if (next.has(messageKey)) {
        next.delete(messageKey);
      } else {
        next.add(messageKey);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void selectedThreadId;
    setExpandedTranscriptItemIds(new Set());
  }, [selectedThreadId]);

  useLayoutEffect(() => {
    void mobileProjectListOpen;
    void normalizedSidebarSearchQuery;
    void projectStates;

    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      sidebarCollapsed ||
      typeof window === "undefined"
    ) {
      setWorktreeThreadPopover(null);
      return;
    }

    const anchorId = worktreeThreadPopoverAnchorId(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
    let frameId: number | null = null;

    const updatePopoverPosition = (): void => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        const anchor = document.getElementById(anchorId);
        if (!(anchor instanceof HTMLElement)) {
          setWorktreeThreadPopover(null);
          return;
        }
        if (anchor.closest('[aria-hidden="true"]')) {
          setWorktreeThreadPopover(null);
          return;
        }

        const rect = anchor.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          setWorktreeThreadPopover(null);
          return;
        }

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const preferredWidth =
          viewportWidth >= 768
            ? WORKTREE_THREAD_POPOVER_DESKTOP_WIDTH_PX
            : WORKTREE_THREAD_POPOVER_MOBILE_WIDTH_PX;
        const width = Math.min(preferredWidth, Math.max(0, viewportWidth - 16));
        const left = clampProjectMenuCoordinate(
          rect.right + 14,
          viewportWidth,
          width,
        );
        const top = clampProjectMenuCoordinate(
          rect.top,
          viewportHeight,
          WORKTREE_THREAD_POPOVER_ESTIMATED_HEIGHT_PX,
        );
        const maxHeight = Math.max(
          180,
          Math.min(
            WORKTREE_THREAD_POPOVER_ESTIMATED_HEIGHT_PX,
            viewportHeight - top - 12,
          ),
        );

        setWorktreeThreadPopover((current) => {
          if (
            current &&
            current.x === left &&
            current.y === top &&
            current.width === width &&
            current.maxHeight === maxHeight
          ) {
            return current;
          }
          return {
            maxHeight,
            width,
            x: left,
            y: top,
          };
        });
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [
    activeSelectedWorktreePath,
    mobileProjectListOpen,
    normalizedSidebarSearchQuery,
    projectStates,
    selectedProject,
    sidebarCollapsed,
  ]);

  useEffect(() => {
    if (!worktreeThreadPopover) {
      return;
    }

    const containers = [
      desktopSidebarScrollRef.current,
      mobileSidebarScrollRef.current,
    ].filter((container): container is HTMLElement => container !== null);
    for (const container of containers) {
      container.addEventListener("scroll", dismissWorktreeThreadPopover, true);
    }

    return () => {
      for (const container of containers) {
        container.removeEventListener(
          "scroll",
          dismissWorktreeThreadPopover,
          true,
        );
      }
    };
  }, [dismissWorktreeThreadPopover, worktreeThreadPopover]);

  useEffect(() => {
    if (
      !worktreeThreadPopover ||
      !selectedProject ||
      !activeSelectedWorktreePath
    ) {
      return;
    }

    const anchorId = worktreeThreadPopoverAnchorId(
      selectedProject.id,
      activeSelectedWorktreePath,
    );

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (worktreeThreadPopoverRef.current?.contains(target)) {
        return;
      }

      const anchor = document.getElementById(anchorId);
      if (anchor?.contains(target)) {
        return;
      }

      dismissWorktreeThreadPopover();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [
    activeSelectedWorktreePath,
    dismissWorktreeThreadPopover,
    selectedProject,
    worktreeThreadPopover,
  ]);

  const abortGitHistoryDiffRequest = useCallback((reason: string) => {
    const controller = gitHistoryDiffAbortControllerRef.current;
    if (!controller) {
      return;
    }

    gitHistoryDiffAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const abortAllGitHistoryDiffPreloads = useCallback((reason: string) => {
    for (const controller of gitHistoryDiffPreloadAbortControllerRef.current.values()) {
      controller.abort(createAbortError(null, reason));
    }
    gitHistoryDiffPreloadAbortControllerRef.current.clear();
  }, []);

  const closeGitHistoryModal = useCallback(() => {
    gitHistoryDiffRequestIdRef.current += 1;
    abortGitHistoryDiffRequest("Commit diff request was cleared.");
    setGitHistoryModal(null);
  }, [abortGitHistoryDiffRequest]);

  const loadGitHistoryDiff = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      entry: RpcGitHistoryEntry,
      options?: {
        priority?: RpcRequestPriority;
        signal?: AbortSignal;
      },
    ): Promise<GitHistoryDiffCacheEntry> => {
      const cacheKey = gitHistoryDiffCacheKey(
        projectId,
        worktreePath,
        entry.hash,
      );
      const cached = readLruValue(gitHistoryDiffCacheRef.current, cacheKey);
      if (cached) {
        return Promise.resolve(cached);
      }

      const pending = gitHistoryDiffRequestCacheRef.current.get(cacheKey);
      if (pending) {
        pending.waiterCount += 1;
        try {
          return await awaitAbortableResult(
            pending.promise,
            options?.signal,
            "Commit diff read was aborted.",
          );
        } finally {
          pending.waiterCount = Math.max(0, pending.waiterCount - 1);
          if (
            pending.waiterCount === 0 &&
            gitHistoryDiffRequestCacheRef.current.get(cacheKey) === pending
          ) {
            pending.controller.abort(
              createAbortError(null, "Commit diff read was aborted."),
            );
          }
        }
      }

      const controller = new AbortController();
      const pendingRequest: PendingSharedRequest<GitHistoryDiffCacheEntry> = {
        controller,
        promise: Promise.resolve(null as never),
        waiterCount: 1,
      };
      const request = procedures
        .getWorktreeGitCommitDiff(
          {
            projectId,
            worktreePath,
            commitHash: entry.hash,
          },
          {
            priority: options?.priority ?? "foreground",
            signal: controller.signal,
          },
        )
        .then((result) => {
          const nextValue = {
            commit: result.commit,
            diffText: result.diffText,
          };
          writeLruValue(
            gitHistoryDiffCacheRef.current,
            cacheKey,
            nextValue,
            GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
          );
          return nextValue;
        })
        .finally(() => {
          if (
            gitHistoryDiffRequestCacheRef.current.get(cacheKey) ===
            pendingRequest
          ) {
            gitHistoryDiffRequestCacheRef.current.delete(cacheKey);
          }
        });
      pendingRequest.promise = request;
      gitHistoryDiffRequestCacheRef.current.set(cacheKey, pendingRequest);

      try {
        return await awaitAbortableResult(
          request,
          options?.signal,
          "Commit diff read was aborted.",
        );
      } finally {
        pendingRequest.waiterCount = Math.max(
          0,
          pendingRequest.waiterCount - 1,
        );
        if (
          pendingRequest.waiterCount === 0 &&
          gitHistoryDiffRequestCacheRef.current.get(cacheKey) === pendingRequest
        ) {
          controller.abort(
            createAbortError(null, "Commit diff read was aborted."),
          );
        }
      }
    },
    [procedures],
  );

  const preloadGitHistoryDiff = useCallback(
    (entry: RpcGitHistoryEntry) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        return;
      }

      const cacheKey = gitHistoryDiffCacheKey(
        selectedProject.id,
        activeSelectedWorktreePath,
        entry.hash,
      );
      if (gitHistoryDiffPreloadAbortControllerRef.current.has(cacheKey)) {
        return;
      }

      const controller = new AbortController();
      gitHistoryDiffPreloadAbortControllerRef.current.set(cacheKey, controller);
      void loadGitHistoryDiff(
        selectedProject.id,
        activeSelectedWorktreePath,
        entry,
        {
          priority: "default",
          signal: controller.signal,
        },
      )
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          // Hover preloads should never surface errors ahead of explicit open.
        })
        .finally(() => {
          if (
            gitHistoryDiffPreloadAbortControllerRef.current.get(cacheKey) ===
            controller
          ) {
            gitHistoryDiffPreloadAbortControllerRef.current.delete(cacheKey);
          }
        });
    },
    [activeSelectedWorktreePath, loadGitHistoryDiff, selectedProject],
  );

  const cancelPreloadGitHistoryDiff = useCallback(
    (entry: RpcGitHistoryEntry) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        return;
      }

      const cacheKey = gitHistoryDiffCacheKey(
        selectedProject.id,
        activeSelectedWorktreePath,
        entry.hash,
      );
      const controller =
        gitHistoryDiffPreloadAbortControllerRef.current.get(cacheKey);
      if (!controller) {
        return;
      }

      gitHistoryDiffPreloadAbortControllerRef.current.delete(cacheKey);
      controller.abort(
        createAbortError(null, "Commit diff preload was aborted."),
      );
    },
    [activeSelectedWorktreePath, selectedProject],
  );

  const openGitHistoryDiff = useCallback(
    async (entry: RpcGitHistoryEntry) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        return;
      }

      const projectId = selectedProject.id;
      const worktreePath = activeSelectedWorktreePath;
      const cacheKey = gitHistoryDiffCacheKey(
        projectId,
        worktreePath,
        entry.hash,
      );
      const cached = readLruValue(gitHistoryDiffCacheRef.current, cacheKey);
      const requestId = gitHistoryDiffRequestIdRef.current + 1;
      gitHistoryDiffRequestIdRef.current = requestId;
      abortGitHistoryDiffRequest("Commit diff request was superseded.");

      setGitHistoryModal({
        projectId,
        worktreePath,
        entry: cached?.commit ?? entry,
        diffText: cached?.diffText ?? "",
        loading: !cached,
        error: "",
      });

      if (cached) {
        return;
      }

      const controller = new AbortController();
      gitHistoryDiffAbortControllerRef.current = controller;
      try {
        const result = await loadGitHistoryDiff(
          projectId,
          worktreePath,
          entry,
          {
            priority: "foreground",
            signal: controller.signal,
          },
        );
        if (gitHistoryDiffRequestIdRef.current !== requestId) {
          return;
        }

        setGitHistoryModal((current) =>
          current &&
          current.projectId === projectId &&
          current.worktreePath === worktreePath &&
          current.entry.hash === entry.hash
            ? {
                ...current,
                entry: result.commit,
                diffText: result.diffText,
                loading: false,
                error: "",
              }
            : current,
        );
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (gitHistoryDiffRequestIdRef.current !== requestId) {
          return;
        }
        setGitHistoryModal((current) =>
          current &&
          current.projectId === projectId &&
          current.worktreePath === worktreePath &&
          current.entry.hash === entry.hash
            ? {
                ...current,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : current,
        );
      } finally {
        if (gitHistoryDiffAbortControllerRef.current === controller) {
          gitHistoryDiffAbortControllerRef.current = null;
        }
      }
    },
    [
      abortGitHistoryDiffRequest,
      activeSelectedWorktreePath,
      loadGitHistoryDiff,
      selectedProject,
    ],
  );

  const setProjectState = useCallback(
    (projectId: number, update: Partial<ProjectNodeState>): void => {
      setProjectStates((prev) => {
        const next = {
          ...prev,
        } as ProjectStateMap;
        next[projectId] = {
          ...(next[projectId] ?? defaultProjectState()),
          ...update,
        };
        return next;
      });
    },
    [],
  );

  const updateProjectState = useCallback(
    (
      projectId: number,
      updater: (current: ProjectNodeState) => ProjectNodeState,
    ): void => {
      setProjectStates((prev) => {
        const current = prev[projectId] ?? defaultProjectState();
        const nextProjectState = updater(current);
        if (nextProjectState === current) {
          return prev;
        }
        return {
          ...prev,
          [projectId]: nextProjectState,
        } satisfies ProjectStateMap;
      });
    },
    [],
  );

  const setWorktreeState = useCallback(
    (
      projectId: number,
      worktreePath: string,
      update: Partial<WorktreeNodeState>,
    ): void => {
      const key = worktreeKey(projectId, worktreePath);
      setWorktreeStates((prev) => {
        const current = prev[key] ?? defaultWorktreeState();
        const nextSnapshot =
          "snapshot" in update
            ? areWorktreeSnapshotsEquivalent(current.snapshot, update.snapshot)
              ? current.snapshot
              : update.snapshot
            : current.snapshot;
        const nextState: WorktreeNodeState = {
          ...current,
          ...update,
          ...(typeof nextSnapshot === "undefined"
            ? {}
            : { snapshot: nextSnapshot }),
        };
        if (
          current.loading === nextState.loading &&
          current.opened === nextState.opened &&
          current.error === nextState.error &&
          current.snapshot === nextState.snapshot
        ) {
          return prev;
        }

        return {
          ...prev,
          [key]: nextState,
        } satisfies WorktreeStateMap;
      });
    },
    [],
  );

  const hydrateProjectRows = useCallback((items: RpcProject[]) => {
    setProjectStates((prev) => {
      const next = { ...prev } as ProjectStateMap;
      for (const item of items) {
        if (!next[item.id]) {
          next[item.id] = defaultProjectState();
        }
      }
      return next;
    });
  }, []);

  const {
    addProjectError,
    addProjectInputIsPreviewing,
    addProjectOpen,
    addProjectPath,
    closeAddProjectForm,
    directorySuggestions,
    directorySuggestionsLoading,
    displayedAddProjectPath,
    handleAddProjectPathChange,
    handleDirectorySuggestionEnter,
    handleDirectorySuggestionLeave,
    hoveredDirectorySuggestion,
    isAddingProject,
    prefetchDirectorySuggestions,
    seedAddProjectPath,
    selectDirectorySuggestion,
    submitAddProject,
    toggleAddProjectForm,
  } = useAddProjectForm({
    getProjectState,
    homeDirectory,
    hydrateProjectRows,
    procedures,
    selectProject,
    setMobileProjectListOpen,
    setProjects,
    setProjectState,
    supportsTildePath,
  });

  const clearProjectState = useCallback((projectId: number) => {
    setProjectStates((prev) => {
      const next = { ...prev } as ProjectStateMap;
      delete next[projectId];
      return next;
    });
    setWorktreeStates((prev) => {
      const next = { ...prev } as WorktreeStateMap;
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${projectId}::`)) {
          delete next[key];
        }
      }
      return next;
    });
  }, []);

  const syncThreadContext = useCallback((thread: RpcThread) => {
    selectedProjectIdRef.current = thread.projectId;
    selectedWorktreePathRef.current = thread.worktreePath;
    setSelectedProjectId(thread.projectId);
    setSelectedWorktreePath(thread.worktreePath);
  }, []);

  const beginWorktreeToggleRequest = useCallback(
    (projectId: number, worktreePath: string) => {
      const key = worktreeKey(projectId, worktreePath);
      const nextRequestId =
        (worktreeToggleRequestIdRef.current.get(key) ?? 0) + 1;
      worktreeToggleRequestIdRef.current.set(key, nextRequestId);
      return {
        key,
        requestId: nextRequestId,
      };
    },
    [],
  );

  const isCurrentWorktreeToggleRequest = useCallback(
    (key: string, requestId: number): boolean =>
      worktreeToggleRequestIdRef.current.get(key) === requestId,
    [],
  );

  const finishWorktreeToggleRequest = useCallback(
    (key: string, requestId: number): void => {
      if (worktreeToggleRequestIdRef.current.get(key) === requestId) {
        worktreeToggleRequestIdRef.current.delete(key);
      }
    },
    [],
  );

  const requestProjectWorktrees = useCallback(
    async (projectId: number): Promise<RpcWorktree[]> => {
      const existing = projectWorktreeRequestCacheRef.current.get(projectId);
      if (existing) {
        return existing;
      }

      const request = procedures
        .listProjectWorktrees({ projectId })
        .then((result) => {
          setProjectState(projectId, {
            worktrees: result.worktrees,
            loadingWorktrees: false,
            error: "",
          });
          return result.worktrees;
        })
        .finally(() => {
          projectWorktreeRequestCacheRef.current.delete(projectId);
        });
      projectWorktreeRequestCacheRef.current.set(projectId, request);
      return request;
    },
    [procedures, setProjectState],
  );

  const loadProjectWorktrees = useCallback(
    async (
      projectId: number,
      options?: {
        backgroundRefresh?: boolean;
        preferCached?: boolean;
      },
    ): Promise<RpcWorktree[]> => {
      const current = getProjectState(projectId);
      if ((options?.preferCached ?? true) && current.worktrees.length > 0) {
        setProjectState(projectId, {
          loadingWorktrees: false,
          error: "",
        });
        if (options?.backgroundRefresh) {
          void requestProjectWorktrees(projectId).catch(() => {
            // Keep rendering the cached worktree list if the background refresh fails.
          });
        }
        return current.worktrees;
      }

      setProjectState(projectId, {
        loadingWorktrees: true,
        error: "",
      });
      return requestProjectWorktrees(projectId);
    },
    [getProjectState, requestProjectWorktrees, setProjectState],
  );

  const createThreadForWorktree = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      options?: {
        requireNoSelectedThread?: boolean;
      },
    ): Promise<RpcThreadDetail | null> => {
      threadCreationInFlightCountRef.current += 1;
      setIsCreatingThread(true);
      setThreadsError("");
      setModelControlError("");
      setReasoningEffortControlError("");
      setUnsafeModeControlError("");
      setChatError("");
      try {
        const detail = await procedures.createThread({
          projectId,
          worktreePath,
          model: activeCodexModel || defaultCodexModel || null,
          reasoningEffort:
            activeReasoningEffort || defaultCodexReasoningEffort || null,
          unsafeMode: activeUnsafeMode,
        });
        const isActiveSelection =
          selectedProjectIdRef.current === projectId &&
          selectedWorktreePathRef.current === worktreePath;
        const canApplySelection =
          !options?.requireNoSelectedThread ||
          (selectedThreadIdRef.current === null &&
            threadOpenAbortControllerRef.current === null);
        if (!isActiveSelection || !canApplySelection) {
          void procedures
            .discardEmptyThread({
              threadId: detail.thread.id,
            })
            .catch(() => {
              // Best effort; stale auto-created threads should not break the UI.
            });
          return null;
        }

        setThreads((prev) => upsertThreadList(prev, detail.thread));
        setSelectedThreadId(detail.thread.id);
        selectedThreadIdRef.current = detail.thread.id;
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        setThreadMessages(detail.messages);
        syncThreadContext(detail.thread);
        setMobileProjectListOpen(false);
        try {
          await loadProjectWorktrees(detail.thread.projectId);
        } catch {
          // Best effort; thread creation should still succeed even if the worktree refresh fails.
        }
        return detail;
      } catch (error) {
        if (
          selectedProjectIdRef.current === projectId &&
          selectedWorktreePathRef.current === worktreePath
        ) {
          setThreadsError(
            error instanceof Error ? error.message : String(error),
          );
        }
        return null;
      } finally {
        threadCreationInFlightCountRef.current = Math.max(
          0,
          threadCreationInFlightCountRef.current - 1,
        );
        setIsCreatingThread(threadCreationInFlightCountRef.current > 0);
      }
    },
    [
      activeCodexModel,
      activeReasoningEffort,
      activeUnsafeMode,
      defaultCodexModel,
      defaultCodexReasoningEffort,
      loadProjectWorktrees,
      procedures,
      syncThreadContext,
    ],
  );

  const dismissThreadStartRequest = useCallback((requestId: string) => {
    setPendingThreadStartRequests((current) =>
      current.filter((request) => request.requestId !== requestId),
    );
    setThreadStartRequestError("");
  }, []);

  const {
    diffFilePatchState,
    isRefreshingWorktreeSnapshot,
    refreshActiveWorktreeSnapshot,
    worktreeDiffError,
  } = useWorktreeDiff({
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    activeWorktreeChanges,
    isDocumentVisible,
    primaryView,
    procedures,
    selectedDiffFileChange,
    selectedDiffFilePath,
    selectedProject,
    setSelectedDiffFilePath,
    setWorktreeState,
  });

  const abortProjectTasksRequest = useCallback((reason: string) => {
    const controller = projectTasksAbortControllerRef.current;
    if (!controller) {
      return;
    }

    projectTasksAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const abortGitHistoryRequests = useCallback((reason: string) => {
    const historyController = gitHistoryAbortControllerRef.current;
    if (historyController) {
      gitHistoryAbortControllerRef.current = null;
      historyController.abort(createAbortError(null, reason));
    }

    const loadMoreController = gitHistoryLoadMoreAbortControllerRef.current;
    if (loadMoreController) {
      gitHistoryLoadMoreAbortControllerRef.current = null;
      loadMoreController.abort(createAbortError(null, reason));
    }
  }, []);

  const abortThreadOpenRequest = useCallback((reason: string) => {
    const controller = threadOpenAbortControllerRef.current;
    if (!controller) {
      return;
    }

    threadOpenAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const clearThreadSelection = useCallback(() => {
    threadOpenRequestIdRef.current += 1;
    abortThreadOpenRequest("Thread selection was cleared.");
    setSelectedThreadId(null);
    setThreadMessages([]);
    setChatError("");
    setModelControlError("");
    setIsThreadLoading(false);
    selectedThreadIdRef.current = null;
    selectedThreadRunStateRef.current = "idle";
  }, [abortThreadOpenRequest]);

  const discardThreadIfEmpty = useCallback(
    async (threadId: number): Promise<void> => {
      try {
        const result = await procedures.discardEmptyThread({ threadId });
        if (!result.discarded) {
          return;
        }
        setThreads((prev) => removeThreadFromList(prev, result.threadId));
      } catch (error) {
        console.error(`Failed to discard empty thread ${threadId}`, error);
      }
    },
    [procedures],
  );

  const loadProjectTasks = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      options?: {
        preferCached?: boolean;
        priority?: RpcRequestPriority;
        skipRefreshWhenCached?: boolean;
      },
    ): Promise<void> => {
      const requestId = ++projectTasksRequestIdRef.current;
      abortProjectTasksRequest("Project task request was superseded.");
      const cacheKey = worktreeKey(projectId, worktreePath);
      const cachedTasks = readLruValue(projectTaskCacheRef.current, cacheKey);
      const serveCachedTasks = Boolean(options?.preferCached && cachedTasks);
      const skipRefreshWhenCached = Boolean(
        serveCachedTasks && options?.skipRefreshWhenCached,
      );
      const silentRefresh = serveCachedTasks;

      if (serveCachedTasks && cachedTasks) {
        setProjectTasks(cachedTasks);
        setIsLoadingProjectTasks(false);
        setTaskControlError("");
      }
      if (skipRefreshWhenCached) {
        projectTasksAbortControllerRef.current = null;
        return;
      }

      const controller = new AbortController();
      projectTasksAbortControllerRef.current = controller;
      if (!silentRefresh) {
        setIsLoadingProjectTasks(true);
        setTaskControlError("");
      }

      try {
        const tasks = await procedures.listProjectTasks(
          {
            projectId,
            worktreePath,
          },
          {
            priority: options?.priority ?? "default",
            signal: controller.signal,
          },
        );
        if (projectTasksRequestIdRef.current !== requestId) {
          return;
        }
        writeLruValue(
          projectTaskCacheRef.current,
          cacheKey,
          tasks,
          PROJECT_TASK_RESULT_CACHE_MAX_ENTRIES,
        );
        setProjectTasks(tasks);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (projectTasksRequestIdRef.current !== requestId) {
          return;
        }
        if (!silentRefresh || !cachedTasks) {
          setProjectTasks([]);
          setTaskControlError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (projectTasksAbortControllerRef.current === controller) {
          projectTasksAbortControllerRef.current = null;
        }
        if (projectTasksRequestIdRef.current === requestId) {
          setIsLoadingProjectTasks(false);
        }
      }
    },
    [abortProjectTasksRequest, procedures],
  );

  const primeProjectTasks = useCallback(
    (projectId: number, worktreePath: string, tasks: RpcProjectTask[]) => {
      const cacheKey = worktreeKey(projectId, worktreePath);
      writeLruValue(
        projectTaskCacheRef.current,
        cacheKey,
        tasks,
        PROJECT_TASK_RESULT_CACHE_MAX_ENTRIES,
      );
      skipFreshProjectTaskRefreshRef.current.add(cacheKey);
    },
    [],
  );

  const cacheGitHistoryResult = useCallback(
    (history: RpcWorktreeGitHistoryResult) => {
      writeLruValue(
        gitHistoryCacheRef.current,
        worktreeKey(history.projectId, history.worktreePath),
        history,
        GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
      );
    },
    [],
  );

  const primeGitHistoryResult = useCallback(
    (history: RpcWorktreeGitHistoryResult) => {
      cacheGitHistoryResult(history);
      skipFreshGitHistoryRefreshRef.current.add(
        worktreeKey(history.projectId, history.worktreePath),
      );
    },
    [cacheGitHistoryResult],
  );

  const loadGitHistory = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      options?: {
        silent?: boolean;
        preferCached?: boolean;
        skipRefreshWhenCached?: boolean;
      },
    ): Promise<void> => {
      const requestId = ++gitHistoryRequestIdRef.current;
      abortGitHistoryRequests("Git history request was superseded.");
      const cacheKey = worktreeKey(projectId, worktreePath);
      const cachedHistory = readLruValue(gitHistoryCacheRef.current, cacheKey);
      const serveCachedHistory = Boolean(
        options?.preferCached && cachedHistory,
      );
      const skipRefreshWhenCached = Boolean(
        serveCachedHistory && options?.skipRefreshWhenCached,
      );
      const silentRefresh = options?.silent || serveCachedHistory;
      if (serveCachedHistory && cachedHistory) {
        setGitHistory(cachedHistory);
        setGitHistoryLoading(false);
        setGitHistoryLoadingMore(false);
        gitHistoryLoadingMoreRef.current = false;
        setGitHistoryError("");
      }
      if (skipRefreshWhenCached) {
        gitHistoryAbortControllerRef.current = null;
        return;
      }

      const controller = new AbortController();
      gitHistoryAbortControllerRef.current = controller;
      if (!silentRefresh) {
        setGitHistoryLoading(true);
        setGitHistoryError("");
      }

      try {
        const result = await procedures.listWorktreeGitHistory(
          {
            projectId,
            worktreePath,
            offset: 0,
            limit: GIT_HISTORY_PAGE_SIZE,
          },
          {
            priority: silentRefresh ? "default" : "foreground",
            signal: controller.signal,
          },
        );
        if (gitHistoryRequestIdRef.current !== requestId) {
          return;
        }

        const nextHistory = mergeResetGitHistory(cachedHistory, result);
        setGitHistory(nextHistory);
        cacheGitHistoryResult(nextHistory);
        setGitHistoryError("");
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (gitHistoryRequestIdRef.current !== requestId) {
          return;
        }
        if (!silentRefresh && !cachedHistory) {
          setGitHistory(null);
          setGitHistoryError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (gitHistoryAbortControllerRef.current === controller) {
          gitHistoryAbortControllerRef.current = null;
        }
        if (gitHistoryRequestIdRef.current === requestId) {
          setGitHistoryLoading(false);
          setGitHistoryLoadingMore(false);
          gitHistoryLoadingMoreRef.current = false;
        }
      }
    },
    [abortGitHistoryRequests, cacheGitHistoryResult, procedures],
  );

  const loadMoreGitHistory = useCallback(async (): Promise<void> => {
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      !gitHistory ||
      gitHistory.nextOffset === null ||
      gitHistoryLoading ||
      gitHistoryLoadingMore ||
      gitHistoryLoadingMoreRef.current
    ) {
      return;
    }

    const requestId = gitHistoryRequestIdRef.current;
    const nextOffset = gitHistory.nextOffset;
    const expectedHeadHash = gitHistory.headHash;
    const expectedBranch = gitHistory.branch;
    const controller = new AbortController();
    if (gitHistoryLoadMoreAbortControllerRef.current) {
      gitHistoryLoadMoreAbortControllerRef.current.abort(
        createAbortError(
          null,
          "Git history pagination request was superseded.",
        ),
      );
    }
    gitHistoryLoadMoreAbortControllerRef.current = controller;

    gitHistoryLoadingMoreRef.current = true;
    setGitHistoryLoadingMore(true);

    try {
      const result = await procedures.listWorktreeGitHistory(
        {
          projectId: selectedProject.id,
          worktreePath: activeSelectedWorktreePath,
          offset: nextOffset,
          limit: GIT_HISTORY_PAGE_SIZE,
        },
        {
          priority: "foreground",
          signal: controller.signal,
        },
      );
      if (gitHistoryRequestIdRef.current !== requestId) {
        return;
      }

      if (
        result.headHash !== expectedHeadHash ||
        result.branch !== expectedBranch
      ) {
        void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
          silent: true,
        });
        return;
      }

      const nextHistory = appendGitHistoryPage(gitHistory, result);
      setGitHistory((current) =>
        current &&
        current.projectId === nextHistory.projectId &&
        current.worktreePath === nextHistory.worktreePath
          ? nextHistory
          : current,
      );
      cacheGitHistoryResult(nextHistory);
      setGitHistoryError("");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      if (gitHistoryRequestIdRef.current !== requestId) {
        return;
      }
      setGitHistoryError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (gitHistoryLoadMoreAbortControllerRef.current === controller) {
        gitHistoryLoadMoreAbortControllerRef.current = null;
      }
      if (gitHistoryRequestIdRef.current === requestId) {
        setGitHistoryLoadingMore(false);
        gitHistoryLoadingMoreRef.current = false;
      }
    }
  }, [
    activeSelectedWorktreePath,
    cacheGitHistoryResult,
    gitHistory,
    gitHistoryLoading,
    gitHistoryLoadingMore,
    loadGitHistory,
    procedures,
    selectedProject,
  ]);

  const applyOptimisticThreadErrorSeen = useCallback((thread: RpcThread) => {
    if (!optimisticallyAcknowledgedThreadIdsRef.current.has(thread.id)) {
      return thread;
    }

    return withAcknowledgedUnreadThread(thread);
  }, []);

  const applyOptimisticThreadErrorSeenToDetail = useCallback(
    (detail: RpcThreadDetail) => {
      if (
        !optimisticallyAcknowledgedThreadIdsRef.current.has(detail.thread.id)
      ) {
        return detail;
      }

      return withAcknowledgedUnreadThreadDetail(detail);
    },
    [],
  );

  const applyOptimisticThreadErrorSeenToList = useCallback(
    (items: RpcThread[]) => {
      if (optimisticallyAcknowledgedThreadIdsRef.current.size === 0) {
        return items;
      }

      let changed = false;
      const nextItems = items.map((thread) => {
        const nextThread = applyOptimisticThreadErrorSeen(thread);
        if (nextThread !== thread) {
          changed = true;
        }
        return nextThread;
      });

      return changed ? nextItems : items;
    },
    [applyOptimisticThreadErrorSeen],
  );

  const requestThreadErrorSeen = useCallback(
    (threadId: number): Promise<RpcThreadDetail> => {
      const existing = threadErrorSeenRequestCacheRef.current.get(threadId);
      if (existing) {
        return existing;
      }

      const request = procedures
        .markThreadErrorSeen({
          threadId,
        })
        .finally(() => {
          if (
            threadErrorSeenRequestCacheRef.current.get(threadId) === request
          ) {
            threadErrorSeenRequestCacheRef.current.delete(threadId);
          }
        });
      threadErrorSeenRequestCacheRef.current.set(threadId, request);
      return request;
    },
    [procedures],
  );

  const acknowledgeThreadErrorSeenInBackground = useCallback(
    (threadId: number) => {
      optimisticallyAcknowledgedThreadIdsRef.current.add(threadId);
      setThreads((prev) => applyOptimisticThreadErrorSeenToList(prev));
      void requestThreadErrorSeen(threadId)
        .then((detail) => {
          optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);

          const settledDetail = applyOptimisticThreadErrorSeenToDetail(detail);
          setThreads((prev) =>
            prev.some((entry) => entry.id === settledDetail.thread.id)
              ? upsertThreadList(prev, settledDetail.thread)
              : prev,
          );
          if (selectedThreadIdRef.current === threadId) {
            selectedThreadRunStateRef.current =
              settledDetail.thread.runStatus.state;
            setThreadMessages(settledDetail.messages);
          }
        })
        .catch((error) => {
          optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);
          console.error(
            `Failed to acknowledge unread thread error for ${threadId}`,
            error,
          );
        });
    },
    [
      applyOptimisticThreadErrorSeenToDetail,
      applyOptimisticThreadErrorSeenToList,
      requestThreadErrorSeen,
    ],
  );

  const prepareOpenedThreadDetail = useCallback(
    (detail: RpcThreadDetail): RpcThreadDetail => {
      const optimisticDetail = applyOptimisticThreadErrorSeenToDetail(detail);
      if (!optimisticDetail.thread.runStatus.hasUnreadError) {
        return optimisticDetail;
      }

      acknowledgeThreadErrorSeenInBackground(detail.thread.id);
      return withAcknowledgedUnreadThreadDetail(detail);
    },
    [
      acknowledgeThreadErrorSeenInBackground,
      applyOptimisticThreadErrorSeenToDetail,
    ],
  );

  const refreshThreadStatuses = useCallback(async () => {
    const activeSelectedThreadId = selectedThreadIdRef.current;
    const loadedThreads = applyOptimisticThreadErrorSeenToList(
      sortThreads(await procedures.listThreads()),
    );
    const selectedSummary =
      activeSelectedThreadId === null
        ? null
        : (loadedThreads.find(
            (thread) => thread.id === activeSelectedThreadId,
          ) ?? null);

    if (!selectedSummary) {
      selectedThreadRunStateRef.current = "idle";
      setThreads(loadedThreads);
      return;
    }

    const shouldRefreshSelectedDetail =
      selectedSummary.runStatus.state === "working" ||
      selectedThreadRunStateRef.current === "working" ||
      (selectedSummary.runStatus.state === "failed" &&
        selectedThreadRunStateRef.current !== "failed") ||
      (selectedSummary.runStatus.state === "stopped" &&
        selectedThreadRunStateRef.current !== "stopped");

    if (!shouldRefreshSelectedDetail) {
      selectedThreadRunStateRef.current = selectedSummary.runStatus.state;
      setThreads(loadedThreads);
      return;
    }

    const detail = prepareOpenedThreadDetail(
      await procedures.getThread({
        threadId: selectedSummary.id,
      }),
    );
    if (selectedThreadIdRef.current !== selectedSummary.id) {
      setThreads(loadedThreads);
      return;
    }
    selectedThreadRunStateRef.current = detail.thread.runStatus.state;
    setThreads(upsertThreadList(loadedThreads, detail.thread));
    setThreadMessages(detail.messages);
  }, [
    applyOptimisticThreadErrorSeenToList,
    prepareOpenedThreadDetail,
    procedures,
  ]);

  const applyOpenedThreadDetail = useCallback(
    (detail: RpcThreadDetail) => {
      setThreads((prev) => upsertThreadList(prev, detail.thread));
      setSelectedThreadId(detail.thread.id);
      selectedThreadIdRef.current = detail.thread.id;
      selectedThreadRunStateRef.current = detail.thread.runStatus.state;
      setThreadMessages(detail.messages);
      syncThreadContext(detail.thread);
      void loadProjectWorktrees(detail.thread.projectId).catch(() => {
        // Best effort; thread history should still open even if worktree metadata refresh fails.
      });
      setMobileProjectListOpen(false);
    },
    [loadProjectWorktrees, syncThreadContext],
  );

  const approveThreadStartRequest = useCallback(
    async (request: RpcThreadStartRequest) => {
      if (isApprovingThreadStartRequest) {
        return;
      }

      threadCreationInFlightCountRef.current += 1;
      setIsCreatingThread(true);
      setIsApprovingThreadStartRequest(true);
      setThreadStartRequestError("");
      setThreadsError("");
      setModelControlError("");
      setReasoningEffortControlError("");
      setUnsafeModeControlError("");
      setChatError("");

      let createdDetail: RpcThreadDetail | null = null;
      try {
        createdDetail = await procedures.createThread({
          projectId: request.projectId,
          worktreePath: request.worktreePath,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          unsafeMode: request.unsafeMode,
        });

        const finalDetail =
          request.input.trim().length > 0
            ? await procedures.sendThreadMessage({
                threadId: createdDetail.thread.id,
                input: request.input,
              })
            : createdDetail;

        applyOpenedThreadDetail(finalDetail);
        dismissThreadStartRequest(request.requestId);
      } catch (error) {
        if (createdDetail) {
          applyOpenedThreadDetail(createdDetail);
        }
        const message = error instanceof Error ? error.message : String(error);
        setThreadStartRequestError(message);
        setThreadsError(message);
      } finally {
        setIsApprovingThreadStartRequest(false);
        threadCreationInFlightCountRef.current = Math.max(
          0,
          threadCreationInFlightCountRef.current - 1,
        );
        setIsCreatingThread(threadCreationInFlightCountRef.current > 0);
      }
    },
    [
      applyOpenedThreadDetail,
      dismissThreadStartRequest,
      isApprovingThreadStartRequest,
      procedures,
    ],
  );

  const loadThreadDetailForOpen = useCallback(
    async (
      threadId: number,
      signal: AbortSignal,
      options?: OpenThreadOptions,
    ): Promise<RpcThreadDetail> => {
      const prefetchedDetail = options?.detailPromise
        ? await awaitAbortableResult(
            options.detailPromise.catch(() => null),
            signal,
            "Thread open request was aborted.",
          )
        : null;
      if (prefetchedDetail) {
        return prefetchedDetail;
      }

      return procedures.getThread(
        { threadId },
        {
          priority: "foreground",
          signal,
        },
      );
    },
    [procedures],
  );

  const openThread = useCallback(
    async (threadId: number, options?: OpenThreadOptions) => {
      const requestId = ++threadOpenRequestIdRef.current;
      abortThreadOpenRequest("Thread open request was superseded.");
      const controller = new AbortController();
      threadOpenAbortControllerRef.current = controller;
      setIsThreadLoading(true);
      setThreadsError("");
      setChatError("");
      setModelControlError("");
      try {
        const detail = prepareOpenedThreadDetail(
          await loadThreadDetailForOpen(threadId, controller.signal, options),
        );
        if (threadOpenRequestIdRef.current !== requestId) {
          return;
        }
        if (
          options?.selectionGuard &&
          (selectedProjectIdRef.current !== options.selectionGuard.projectId ||
            selectedWorktreePathRef.current !==
              options.selectionGuard.worktreePath)
        ) {
          setThreads((prev) => upsertThreadList(prev, detail.thread));
          return;
        }
        applyOpenedThreadDetail(detail);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (threadOpenRequestIdRef.current !== requestId) {
          return;
        }
        setThreadsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (threadOpenAbortControllerRef.current === controller) {
          threadOpenAbortControllerRef.current = null;
        }
        if (threadOpenRequestIdRef.current === requestId) {
          setIsThreadLoading(false);
        }
      }
    },
    [
      abortThreadOpenRequest,
      applyOpenedThreadDetail,
      loadThreadDetailForOpen,
      prepareOpenedThreadDetail,
    ],
  );

  const initialize = useCallback(async () => {
    const persistedState = initialMainviewState;
    const initiallyOpenProjectTreePaths =
      readSidebarPanelsSnapshot().openProjectPaths;

    try {
      const {
        homeDirectory: homeDirectoryResult,
        modelCatalog,
        projects: loadedProjects,
        threads: loadedThreads,
      } = await procedures.getAppBootstrap(undefined, {
        priority: "foreground",
      });
      let startupThreads = sortThreads(loadedThreads);
      let initialThread = pickInitialThread(startupThreads, persistedState);
      let initialThreadDetailPromise: Promise<RpcThreadDetail> | null = null;
      if (initialThread) {
        try {
          const initialThreadDetail = await procedures.getThread(
            {
              threadId: initialThread.id,
            },
            {
              priority: "foreground",
            },
          );
          initialThreadDetailPromise = Promise.resolve(initialThreadDetail);
        } catch (error) {
          if (!isThreadNotFoundError(error)) {
            throw error;
          }
          startupThreads = startupThreads.filter(
            (thread) => thread.id !== initialThread?.id,
          );
          initialThread = pickInitialThread(startupThreads, {
            ...persistedState,
            selectedThreadId:
              persistedState.selectedThreadId === initialThread.id
                ? null
                : persistedState.selectedThreadId,
          });
          initialThreadDetailPromise = null;
        }
      }
      const restoredOpenProjectIds = new Set<number>();
      for (const project of loadedProjects) {
        if (initiallyOpenProjectTreePaths.has(project.path)) {
          restoredOpenProjectIds.add(project.id);
        }
      }
      for (const entry of persistedState.openWorktrees) {
        restoredOpenProjectIds.add(entry.projectId);
      }
      if (persistedState.selectedProjectId !== null) {
        restoredOpenProjectIds.add(persistedState.selectedProjectId);
      }
      if (initialThread) {
        restoredOpenProjectIds.add(initialThread.projectId);
      }
      const initialProjectId =
        initialThread?.projectId ?? persistedState.selectedProjectId ?? null;
      if (initialProjectId !== null) {
        restoredOpenProjectIds.add(initialProjectId);
      } else if (loadedProjects[0]) {
        restoredOpenProjectIds.add(loadedProjects[0].id);
      }
      const optimisticProjects = loadedProjects.map((project) => ({
        ...project,
        isOpen: restoredOpenProjectIds.has(project.id)
          ? (1 as const)
          : (0 as const),
      }));
      const initialThreadProject =
        initialThread === null
          ? undefined
          : optimisticProjects.find(
              (project) => project.id === initialThread.projectId,
            );
      const initialProject =
        initialThreadProject ??
        optimisticProjects.find(
          (project) => project.id === persistedState.selectedProjectId,
        ) ??
        optimisticProjects[0] ??
        null;
      const initialWorktreePath =
        initialThread?.worktreePath ??
        (initialProject === null
          ? null
          : initialProject.id === persistedState.selectedProjectId &&
              persistedState.selectedWorktreePath
            ? persistedState.selectedWorktreePath
            : initialProject.path);

      setProjects(optimisticProjects);
      setThreads(startupThreads);
      setCodexModels(modelCatalog.models);
      setDefaultCodexModel(modelCatalog.defaultModel);
      setReasoningEfforts(modelCatalog.reasoningEfforts);
      setDefaultCodexReasoningEffort(modelCatalog.defaultReasoningEffort);
      setPendingThreadModel((current) => current || modelCatalog.defaultModel);
      setPendingThreadReasoningEffort(
        (current) => current || modelCatalog.defaultReasoningEffort,
      );
      hydrateProjectRows(loadedProjects);
      setHomeDirectory(homeDirectoryResult.homeDirectory);
      setSupportsTildePath(homeDirectoryResult.supportsTildePath);
      seedAddProjectPath(
        homeDirectoryResult.homeDirectory,
        homeDirectoryResult.supportsTildePath,
      );
      selectedProjectIdRef.current = initialProject?.id ?? null;
      selectedWorktreePathRef.current = initialWorktreePath;
      setSelectedProjectId(initialProject?.id ?? null);
      setSelectedWorktreePath(initialWorktreePath);

      const startupDirectoryPrefetchQuery =
        homeDirectoryResult.supportsTildePath
          ? "~/"
          : formatDirectoryPathForInput(
              homeDirectoryResult.homeDirectory,
              homeDirectoryResult.homeDirectory,
              homeDirectoryResult.supportsTildePath,
            );
      homeDirectoryPrefetchQueryRef.current = startupDirectoryPrefetchQuery;
      void prefetchDirectorySuggestions(startupDirectoryPrefetchQuery);

      await Promise.resolve();

      const initialThreadOpenPromise = initialThread
        ? openThread(initialThread.id, {
            detailPromise: initialThreadDetailPromise,
          })
        : null;

      const restoredProjects = optimisticProjects.filter((project) =>
        restoredOpenProjectIds.has(project.id),
      );

      for (const project of restoredProjects) {
        setProjectState(project.id, {
          loadingWorktrees:
            initiallyOpenProjectTreePaths.has(project.path) &&
            getProjectState(project.id).worktrees.length === 0,
          error: "",
        });
      }

      if (restoredProjects.length > 0) {
        const restoredProjectResults = await procedures.openProjectsBatch(
          {
            projects: restoredProjects.map((project) => ({
              projectId: project.id,
              projectPath: project.path,
              name: project.name,
            })),
          },
          {
            priority: "foreground",
          },
        );
        for (const result of restoredProjectResults) {
          if (result.ok) {
            setProjects((prev) => upsertProjectList(prev, result.project));
            setProjectState(result.project.id, {
              worktrees: result.worktrees,
              loadingWorktrees: false,
              error: "",
            });
            continue;
          }

          setProjectState(result.projectId, {
            loadingWorktrees: false,
            error: result.error,
          });
        }
      }

      const restoredOpenWorktrees = await procedures.openWorktreesBatch(
        {
          worktrees: persistedState.openWorktrees.filter(({ projectId }) =>
            restoredOpenProjectIds.has(projectId),
          ),
        },
        {
          priority: "foreground",
        },
      );

      for (const result of restoredOpenWorktrees) {
        if (result.ok) {
          primeGitHistoryResult(result.history);
          primeProjectTasks(
            result.projectId,
            result.worktreePath,
            result.tasks,
          );
          setWorktreeState(result.projectId, result.worktreePath, {
            loading: false,
            opened: true,
            snapshot: result.worktree,
            error: "",
          });
          continue;
        }

        setWorktreeState(result.projectId, result.worktreePath, {
          loading: false,
          opened: false,
          snapshot: undefined,
          error: result.error,
        });
      }

      if (restoredOpenWorktrees.some((result) => result.ok)) {
        setProjectStates((prev) => {
          const next = { ...prev } as ProjectStateMap;
          for (const result of restoredOpenWorktrees) {
            if (!result.ok) {
              continue;
            }
            const current = next[result.projectId] ?? defaultProjectState();
            next[result.projectId] = {
              ...current,
              openWorktrees: new Set([
                ...current.openWorktrees,
                result.worktreePath,
              ]),
            };
          }
          return next;
        });
      }

      if (initialThread) {
        await initialThreadOpenPromise;
        return;
      }
    } catch (error) {
      setThreadsError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionStateReady(true);
    }
  }, [
    getProjectState,
    hydrateProjectRows,
    initialMainviewState,
    openThread,
    prefetchDirectorySuggestions,
    primeProjectTasks,
    primeGitHistoryResult,
    procedures,
    seedAddProjectPath,
    setProjectState,
    setWorktreeState,
  ]);

  const closeProjectActionMenu = useCallback(() => {
    setProjectActionMenu(null);
    setProjectActionMenuError("");
    setNewWorktreeName("");
  }, []);

  const closeThreadActionMenu = useCallback(() => {
    setThreadActionMenu(null);
    setThreadActionMenuError("");
    setThreadRenameTitle("");
    setThreadRenameSummary("");
    setThreadActionBusy(null);
  }, []);

  const openProjectActionMenu = useCallback(
    async (project: RpcProject, x: number, y: number) => {
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      const viewportHeight =
        typeof window === "undefined" ? 720 : window.innerHeight;
      const requestId = ++projectActionMenuRequestId.current;

      closeThreadActionMenu();
      setProjectActionMenu({
        projectId: project.id,
        x: clampProjectMenuCoordinate(x, viewportWidth, 336),
        y: clampProjectMenuCoordinate(y, viewportHeight, 420),
      });
      setProjectActionMenuError("");
      setNewWorktreeName("");

      try {
        await loadProjectWorktrees(project.id, {
          backgroundRefresh: true,
        });
      } catch (error) {
        if (projectActionMenuRequestId.current === requestId) {
          setProjectActionMenuError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
    [closeThreadActionMenu, loadProjectWorktrees],
  );

  const openThreadActionMenu = useCallback(
    (thread: RpcThread, x: number, y: number) => {
      const viewportWidth =
        typeof window === "undefined" ? 1280 : window.innerWidth;
      const viewportHeight =
        typeof window === "undefined" ? 720 : window.innerHeight;

      closeProjectActionMenu();
      setThreadActionMenu({
        threadId: thread.id,
        x: clampProjectMenuCoordinate(x, viewportWidth, 336),
        y: clampProjectMenuCoordinate(y, viewportHeight, 396),
      });
      setThreadActionMenuError("");
      setThreadRenameTitle(thread.title);
      setThreadRenameSummary(thread.summary ?? "");
      setThreadActionBusy(null);
    },
    [closeProjectActionMenu],
  );

  const deleteTrackedProject = useCallback(
    async (projectId: number) => {
      const removedProjectPath =
        projects.find((project) => project.id === projectId)?.path ?? null;
      try {
        await procedures.deleteProject({ projectId });
        const [loaded, loadedThreads] = await Promise.all([
          procedures.listProjects({ includeClosed: true }),
          procedures.listThreads(),
        ]);
        setProjects(loaded);
        setThreads(sortThreads(loadedThreads));
        hydrateProjectRows(loaded);
        clearProjectState(projectId);
        if (removedProjectPath) {
          setProjectTreeOpen(removedProjectPath, false);
        }
        const nextSelectedProjectId =
          selectedProjectId &&
          loaded.some((project) => project.id === selectedProjectId)
            ? selectedProjectId
            : (loaded[0]?.id ?? null);
        selectedProjectIdRef.current = nextSelectedProjectId;
        setSelectedProjectId(nextSelectedProjectId);
        if (selectedProjectId === projectId) {
          selectedWorktreePathRef.current = loaded[0]?.path ?? null;
          setSelectedWorktreePath(loaded[0]?.path ?? null);
        }
        if (selectedThreadId) {
          if (loadedThreads.some((thread) => thread.id === selectedThreadId)) {
            void openThread(selectedThreadId);
          } else if (loadedThreads[0]) {
            void openThread(loadedThreads[0].id);
          } else {
            clearThreadSelection();
          }
        }
        setProjectActionMenu((current) =>
          current?.projectId === projectId ? null : current,
        );
        setProjectActionMenuError("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (projectActionMenu?.projectId === projectId) {
          setProjectActionMenuError(message);
        } else {
          setProjectState(projectId, { error: message });
        }
      }
    },
    [
      clearProjectState,
      clearThreadSelection,
      hydrateProjectRows,
      openThread,
      projects,
      procedures,
      projectActionMenu,
      selectedProjectId,
      selectedThreadId,
      setProjectState,
    ],
  );

  const toggleWorktreePinned = useCallback(
    async (projectId: number, worktreePath: string, pinned: boolean) => {
      if (worktreePinBusyPath || isCreatingWorktree) {
        return;
      }

      setWorktreePinBusyPath(worktreePath);
      setProjectActionMenuError("");
      setProjectState(projectId, { error: "" });
      try {
        const result = await procedures.setWorktreePinned({
          projectId,
          worktreePath,
          pinned: !pinned,
        });
        setProjectState(projectId, {
          worktrees: result.worktrees,
          loadingWorktrees: false,
          error: "",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProjectState(projectId, { error: message });
        if (projectActionMenu?.projectId === projectId) {
          setProjectActionMenuError(message);
        }
      } finally {
        setWorktreePinBusyPath(null);
      }
    },
    [
      isCreatingWorktree,
      procedures,
      projectActionMenu,
      setProjectState,
      worktreePinBusyPath,
    ],
  );

  const submitThreadRename = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!threadActionMenuThread || threadActionBusy) {
        return;
      }

      const title = threadRenameTitle.trim();
      if (!title) {
        setThreadActionMenuError("Enter a thread title.");
        return;
      }

      setThreadActionBusy("rename");
      setThreadActionMenuError("");
      try {
        const updatedThread = await procedures.renameThread({
          threadId: threadActionMenuThread.id,
          title,
          summary: threadRenameSummary,
        });
        setThreads((prev) => upsertThreadList(prev, updatedThread));
        setThreadRenameTitle(updatedThread.title);
        setThreadRenameSummary(updatedThread.summary ?? "");
      } catch (error) {
        setThreadActionMenuError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setThreadActionBusy(null);
      }
    },
    [
      procedures,
      threadActionBusy,
      threadActionMenuThread,
      threadRenameSummary,
      threadRenameTitle,
    ],
  );

  const toggleThreadPinned = useCallback(async () => {
    if (!threadActionMenuThread || threadActionBusy) {
      return;
    }

    setThreadActionBusy("pin");
    setThreadActionMenuError("");
    try {
      const updatedThread = await procedures.setThreadPinned({
        threadId: threadActionMenuThread.id,
        pinned: !threadActionMenuThread.pinnedAt,
      });
      setThreads((prev) => upsertThreadList(prev, updatedThread));
    } catch (error) {
      setThreadActionMenuError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setThreadActionBusy(null);
    }
  }, [procedures, threadActionBusy, threadActionMenuThread]);

  const deleteSelectedThread = useCallback(async () => {
    if (!threadActionMenuThread || threadActionBusy) {
      return;
    }

    setThreadActionBusy("delete");
    setThreadActionMenuError("");
    try {
      await procedures.deleteThread({
        threadId: threadActionMenuThread.id,
      });
      setThreads((prev) =>
        removeThreadFromList(prev, threadActionMenuThread.id),
      );
      if (selectedThreadId === threadActionMenuThread.id) {
        clearThreadSelection();
      }
      closeThreadActionMenu();
    } catch (error) {
      setThreadActionMenuError(
        error instanceof Error ? error.message : String(error),
      );
      setThreadActionBusy(null);
    }
  }, [
    clearThreadSelection,
    closeThreadActionMenu,
    procedures,
    selectedThreadId,
    threadActionBusy,
    threadActionMenuThread,
  ]);

  const submitNewWorktree = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!projectActionMenu || isCreatingWorktree || worktreePinBusyPath) {
        return;
      }

      const name = newWorktreeName.trim();
      if (!name) {
        setProjectActionMenuError("Enter a worktree name.");
        return;
      }

      setIsCreatingWorktree(true);
      setProjectActionMenuError("");
      try {
        const result = await procedures.createWorktree({
          projectId: projectActionMenu.projectId,
          name,
        });
        setProjectState(projectActionMenu.projectId, {
          worktrees: result.worktrees,
          error: "",
        });
        setNewWorktreeName("");
      } catch (error) {
        setProjectActionMenuError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsCreatingWorktree(false);
      }
    },
    [
      isCreatingWorktree,
      newWorktreeName,
      procedures,
      projectActionMenu,
      setProjectState,
      worktreePinBusyPath,
    ],
  );

  useEffect(() => {
    if (!projectActionMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        projectActionMenuRef.current &&
        !projectActionMenuRef.current.contains(event.target as Node)
      ) {
        closeProjectActionMenu();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeProjectActionMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProjectActionMenu, projectActionMenu]);

  useEffect(() => {
    if (projectActionMenu && !projectActionMenuProject) {
      closeProjectActionMenu();
    }
  }, [closeProjectActionMenu, projectActionMenu, projectActionMenuProject]);

  useEffect(() => {
    if (!threadActionMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        threadActionMenuRef.current &&
        !threadActionMenuRef.current.contains(event.target as Node)
      ) {
        closeThreadActionMenu();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeThreadActionMenu();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeThreadActionMenu, threadActionMenu]);

  useEffect(() => {
    if (threadActionMenu && !threadActionMenuThread) {
      closeThreadActionMenu();
    }
  }, [closeThreadActionMenu, threadActionMenu, threadActionMenuThread]);

  useEffect(() => {
    const previousThreadId = previousSelectedThreadIdRef.current;
    selectedThreadIdRef.current = selectedThreadId;
    if (previousThreadId !== null && previousThreadId !== selectedThreadId) {
      void discardThreadIfEmpty(previousThreadId);
    }
    previousSelectedThreadIdRef.current = selectedThreadId;
  }, [discardThreadIfEmpty, selectedThreadId]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    selectedWorktreePathRef.current = selectedWorktreePath;
  }, [selectedWorktreePath]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    activeWorktreeSyncAbortControllerRef.current?.abort(
      createAbortError(
        null,
        "Active worktree synchronization request was superseded.",
      ),
    );

    const controller = new AbortController();
    activeWorktreeSyncAbortControllerRef.current = controller;
    void procedures
      .setActiveWorktree(
        {
          projectId: activePollingProjectId,
          worktreePath: activePollingWorktreePath,
        },
        {
          priority: "background",
          signal: controller.signal,
        },
      )
      .catch((error) => {
        if (isAbortError(error)) {
          return;
        }
        // Best effort; active worktree polling will resync on the next selection or visibility change.
      });

    return () => {
      if (activeWorktreeSyncAbortControllerRef.current === controller) {
        activeWorktreeSyncAbortControllerRef.current = null;
      }
      controller.abort(
        createAbortError(
          null,
          "Active worktree synchronization request was superseded.",
        ),
      );
    };
  }, [activePollingProjectId, activePollingWorktreePath, procedures]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }

    writePersistedMainviewState({
      version: MAINVIEW_STATE_STORAGE_VERSION,
      selectedProjectId,
      selectedWorktreePath,
      selectedThreadId,
      pendingThreadModel,
      pendingThreadReasoningEffort,
      pendingThreadUnsafeMode,
      chatInput: readChatComposerDraft(initialMainviewState.chatInput),
      sidebarCollapsed: sidebarCollapsedRef.current,
      sidebarSearchQuery,
      openWorktrees: serializeOpenWorktrees(projectStates),
    });
  }, [
    initialMainviewState.chatInput,
    pendingThreadModel,
    pendingThreadReasoningEffort,
    pendingThreadUnsafeMode,
    projectStates,
    selectedProjectId,
    selectedThreadId,
    selectedWorktreePath,
    sessionStateReady,
    sidebarSearchQuery,
  ]);

  useEffect(() => {
    if (selectedThread?.model) {
      setPendingThreadModel(selectedThread.model);
      setModelControlError("");
      return;
    }
    if (defaultCodexModel) {
      setPendingThreadModel(defaultCodexModel);
    }
  }, [defaultCodexModel, selectedThread]);

  useEffect(() => {
    if (selectedThread?.reasoningEffort) {
      setPendingThreadReasoningEffort(selectedThread.reasoningEffort);
      setReasoningEffortControlError("");
      return;
    }
    if (defaultCodexReasoningEffort) {
      setPendingThreadReasoningEffort(defaultCodexReasoningEffort);
    }
  }, [defaultCodexReasoningEffort, selectedThread]);

  useEffect(() => {
    if (!selectedThread) {
      return;
    }
    setPendingThreadUnsafeMode(selectedThread.unsafeMode);
    setUnsafeModeControlError("");
  }, [selectedThread]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      !activeSelectedWorktreeOpened
    ) {
      projectTasksRequestIdRef.current += 1;
      abortProjectTasksRequest("Project task request was cleared.");
      setProjectTasks([]);
      setIsLoadingProjectTasks(false);
      setTaskControlError("");
      return;
    }
    const cacheKey = worktreeKey(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
    void loadProjectTasks(selectedProject.id, activeSelectedWorktreePath, {
      preferCached: true,
      priority: "default",
      skipRefreshWhenCached:
        skipFreshProjectTaskRefreshRef.current.delete(cacheKey),
    });
  }, [
    activeSelectedWorktreePath,
    activeSelectedWorktreeOpened,
    abortProjectTasksRequest,
    loadProjectTasks,
    sessionStateReady,
    selectedProject,
  ]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }
    if (!selectedProject || !activeSelectedWorktreePath) {
      gitHistoryRequestIdRef.current += 1;
      abortGitHistoryRequests("Git history request was cleared.");
      setGitHistory(null);
      setGitHistoryLoading(false);
      setGitHistoryLoadingMore(false);
      gitHistoryLoadingMoreRef.current = false;
      setGitHistoryError("");
      return;
    }
    const cacheKey = worktreeKey(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
    void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
      preferCached: true,
      skipRefreshWhenCached:
        skipFreshGitHistoryRefreshRef.current.delete(cacheKey),
    });
  }, [
    activeSelectedWorktreePath,
    abortGitHistoryRequests,
    loadGitHistory,
    sessionStateReady,
    selectedProject,
  ]);

  useEffect(() => {
    const handleWorktreeTasksChanged = (
      event: CustomEvent<RpcWorktreeTasksChanged>,
    ) => {
      if (!sessionStateReady) {
        return;
      }
      if (
        !selectedProject ||
        !activeSelectedWorktreePath ||
        !activeSelectedWorktreeOpened
      ) {
        return;
      }
      if (
        event.detail.projectId !== selectedProject.id ||
        event.detail.worktreePath !== activeSelectedWorktreePath
      ) {
        return;
      }
      void loadProjectTasks(event.detail.projectId, event.detail.worktreePath, {
        priority: "default",
      });
    };

    window.addEventListener(
      WORKTREE_TASKS_CHANGED_EVENT_NAME,
      handleWorktreeTasksChanged,
    );
    return () => {
      window.removeEventListener(
        WORKTREE_TASKS_CHANGED_EVENT_NAME,
        handleWorktreeTasksChanged,
      );
    };
  }, [
    activeSelectedWorktreePath,
    activeSelectedWorktreeOpened,
    loadProjectTasks,
    sessionStateReady,
    selectedProject,
  ]);

  useEffect(() => {
    const handleWorktreeGitHistoryChanged = (
      event: CustomEvent<RpcWorktreeGitHistoryChanged>,
    ) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        return;
      }
      if (
        event.detail.projectId !== selectedProject.id ||
        event.detail.worktreePath !== activeSelectedWorktreePath
      ) {
        return;
      }
      void loadGitHistory(event.detail.projectId, event.detail.worktreePath, {
        silent: true,
      });
    };

    window.addEventListener(
      WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
      handleWorktreeGitHistoryChanged,
    );
    return () => {
      window.removeEventListener(
        WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
        handleWorktreeGitHistoryChanged,
      );
    };
  }, [activeSelectedWorktreePath, loadGitHistory, selectedProject]);

  useEffect(() => {
    const handleThreadStartRequestCreated = (
      event: CustomEvent<RpcThreadStartRequest>,
    ) => {
      setPendingThreadStartRequests((current) => {
        if (
          current.some(
            (request) => request.requestId === event.detail.requestId,
          )
        ) {
          return current;
        }
        return [...current, event.detail];
      });
      setThreadStartRequestError("");
    };

    window.addEventListener(
      THREAD_START_REQUEST_CREATED_EVENT_NAME,
      handleThreadStartRequestCreated,
    );
    return () => {
      window.removeEventListener(
        THREAD_START_REQUEST_CREATED_EVENT_NAME,
        handleThreadStartRequestCreated,
      );
    };
  }, []);

  useEffect(() => {
    if (!gitHistoryModal) {
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      gitHistoryModal.projectId !== selectedProject.id ||
      gitHistoryModal.worktreePath !== activeSelectedWorktreePath
    ) {
      closeGitHistoryModal();
    }
  }, [
    activeSelectedWorktreePath,
    closeGitHistoryModal,
    gitHistoryModal,
    selectedProject,
  ]);

  useEffect(() => {
    const preloadScope = `${selectedProject?.id ?? "none"}::${
      activeSelectedWorktreePath ?? "none"
    }`;
    return () => {
      abortAllGitHistoryDiffPreloads(
        `Commit diff preload was cleared for ${preloadScope}.`,
      );
    };
  }, [
    abortAllGitHistoryDiffPreloads,
    activeSelectedWorktreePath,
    selectedProject?.id,
  ]);

  useEffect(
    () => () => {
      gitHistoryDiffRequestIdRef.current += 1;
      abortGitHistoryDiffRequest("Commit diff request was cleared.");
    },
    [abortGitHistoryDiffRequest],
  );

  useEffect(() => {
    if (!gitHistoryModal) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeGitHistoryModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeGitHistoryModal, gitHistoryModal]);

  useEffect(() => {
    if (
      !selectedProjectId ||
      !activeSelectedWorktreePath ||
      !activeSelectedWorktreeOpened
    ) {
      return;
    }
    if (
      selectedThread &&
      selectedThread.projectId === selectedProjectId &&
      selectedThread.worktreePath === activeSelectedWorktreePath
    ) {
      return;
    }
    const preferredThread =
      pinnedThreadForWorktree(
        threads,
        selectedProjectId,
        activeSelectedWorktreePath,
      ) ??
      latestThreadForWorktree(
        threads,
        selectedProjectId,
        activeSelectedWorktreePath,
      );
    if (!preferredThread) {
      if (selectedThreadId !== null) {
        clearThreadSelection();
      }
      return;
    }
    if (selectedThreadId === preferredThread.id) {
      return;
    }
    void openThread(preferredThread.id, {
      selectionGuard: {
        projectId: selectedProjectId,
        worktreePath: activeSelectedWorktreePath,
      },
    });
  }, [
    activeSelectedWorktreePath,
    activeSelectedWorktreeOpened,
    clearThreadSelection,
    openThread,
    selectedProjectId,
    selectedThread,
    selectedThreadId,
    threads,
  ]);

  useEffect(() => {
    if (!selectedThreadId || selectedThread) {
      return;
    }
    if (threads[0]) {
      void openThread(threads[0].id);
      return;
    }
    clearThreadSelection();
  }, [
    clearThreadSelection,
    openThread,
    selectedThread,
    selectedThreadId,
    threads,
  ]);

  useEffect(() => {
    const previousThreadRunStates = previousThreadRunStatesRef.current;
    let completedThreadDetected = false;
    const nextCompletedThreadIds = new Set<number>();

    for (const thread of threads) {
      if (thread.runStatus.state === "working") {
        continue;
      }

      if (completedThreadIndicatorIds.has(thread.id)) {
        nextCompletedThreadIds.add(thread.id);
      }

      if (
        previousThreadRunStates.get(thread.id) === "working" &&
        thread.runStatus.state === "idle"
      ) {
        completedThreadDetected = true;
        nextCompletedThreadIds.add(thread.id);
      }
    }

    previousThreadRunStatesRef.current = new Map(
      threads.map((thread) => [thread.id, thread.runStatus.state]),
    );
    setCompletedThreadIndicatorIds((current) => {
      const currentIds = [...current].sort((left, right) => left - right);
      const nextIds = [...nextCompletedThreadIds].sort(
        (left, right) => left - right,
      );
      if (
        currentIds.length === nextIds.length &&
        currentIds.every((value, index) => value === nextIds[index])
      ) {
        return current;
      }
      return nextCompletedThreadIds;
    });

    if (completedThreadDetected) {
      setMobileNavigationIndicator("completed");
      return;
    }

    if (hasWorkingThreads) {
      setMobileNavigationIndicator((current) =>
        current === "completed" ? current : "working",
      );
      return;
    }

    setMobileNavigationIndicator((current) =>
      current === "completed" ? current : "none",
    );
  }, [completedThreadIndicatorIds, hasWorkingThreads, threads]);

  useEffect(() => {
    if (!mobileProjectListOpen) {
      return;
    }

    setMobileNavigationIndicator("none");
  }, [mobileProjectListOpen]);

  useEffect(() => {
    if (!hasWorkingThreads) {
      if (threads.length === 0) {
        selectedThreadRunStateRef.current = "idle";
      }
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (threadStatusPollInFlightRef.current) {
        return;
      }

      threadStatusPollInFlightRef.current = true;
      try {
        await refreshThreadStatuses();
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to poll thread statuses", error);
        }
      } finally {
        threadStatusPollInFlightRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, THREAD_STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasWorkingThreads, refreshThreadStatuses, threads.length]);

  useEffect(() => {
    if (!homeDirectory) {
      return;
    }

    const prefetchQuery = supportsTildePath
      ? "~/"
      : formatDirectoryPathForInput(
          homeDirectory,
          homeDirectory,
          supportsTildePath,
        );
    if (homeDirectoryPrefetchQueryRef.current === prefetchQuery) {
      return;
    }

    homeDirectoryPrefetchQueryRef.current = prefetchQuery;
    void prefetchDirectorySuggestions(prefetchQuery);
  }, [homeDirectory, prefetchDirectorySuggestions, supportsTildePath]);

  useEffect(() => {
    return () => {
      abortProjectTasksRequest("Project task request was canceled.");
      abortGitHistoryRequests("Git history request was canceled.");
    };
  }, [abortGitHistoryRequests, abortProjectTasksRequest]);

  const updateActiveCodexModel = useCallback(
    async (model: string) => {
      setModelControlError("");
      if (!model) {
        return;
      }

      if (!selectedThread) {
        setPendingThreadModel(model);
        return;
      }

      if (selectedThread.model === model || isUpdatingThreadModel) {
        return;
      }

      setIsUpdatingThreadModel(true);
      try {
        const updatedThread = await procedures.updateThreadModel({
          threadId: selectedThread.id,
          model,
        });
        setThreads((prev) => upsertThreadList(prev, updatedThread));
        setPendingThreadModel(updatedThread.model);
      } catch (error) {
        setModelControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadModel(false);
      }
    },
    [isUpdatingThreadModel, procedures, selectedThread],
  );

  const updateActiveReasoningEffort = useCallback(
    async (reasoningEffort: RpcCodexReasoningEffort) => {
      setReasoningEffortControlError("");
      if (!reasoningEffort) {
        return;
      }

      if (!selectedThread) {
        setPendingThreadReasoningEffort(reasoningEffort);
        return;
      }

      if (
        selectedThread.reasoningEffort === reasoningEffort ||
        isUpdatingThreadReasoningEffort
      ) {
        return;
      }

      setIsUpdatingThreadReasoningEffort(true);
      try {
        const updatedThread = await procedures.updateThreadReasoningEffort({
          threadId: selectedThread.id,
          reasoningEffort,
        });
        setThreads((prev) => upsertThreadList(prev, updatedThread));
        setPendingThreadReasoningEffort(updatedThread.reasoningEffort);
      } catch (error) {
        setReasoningEffortControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadReasoningEffort(false);
      }
    },
    [isUpdatingThreadReasoningEffort, procedures, selectedThread],
  );

  const updateActiveUnsafeMode = useCallback(
    async (unsafeMode: boolean) => {
      setUnsafeModeControlError("");

      if (!selectedThread) {
        setPendingThreadUnsafeMode(unsafeMode);
        return;
      }

      if (
        selectedThread.unsafeMode === unsafeMode ||
        isUpdatingThreadUnsafeMode
      ) {
        return;
      }

      setIsUpdatingThreadUnsafeMode(true);
      try {
        const updatedThread = await procedures.updateThreadUnsafeMode({
          threadId: selectedThread.id,
          unsafeMode,
        });
        setThreads((prev) => upsertThreadList(prev, updatedThread));
        setPendingThreadUnsafeMode(updatedThread.unsafeMode);
      } catch (error) {
        setUnsafeModeControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadUnsafeMode(false);
      }
    },
    [isUpdatingThreadUnsafeMode, procedures, selectedThread],
  );

  const runSelectedTask = useCallback(
    async (task: RpcProjectTask) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        setTaskControlError("Select a project worktree before running a task.");
        return;
      }

      const requestedProjectId = selectedProject.id;
      const requestedWorktreePath = activeSelectedWorktreePath;
      setIsRunningProjectTask(true);
      setTaskControlError("");
      setThreadsError("");
      setChatError("");
      setReasoningEffortControlError("");
      setUnsafeModeControlError("");
      try {
        const detail = await procedures.runProjectTask({
          projectId: requestedProjectId,
          worktreePath: requestedWorktreePath,
          task,
          threadId: selectedThread?.id ?? null,
          model: selectedThread
            ? null
            : activeCodexModel || defaultCodexModel || null,
          reasoningEffort: selectedThread
            ? null
            : activeReasoningEffort || defaultCodexReasoningEffort || null,
          unsafeMode: selectedThread ? null : activeUnsafeMode,
        });
        setThreads((prev) => upsertThreadList(prev, detail.thread));
        if (
          selectedProjectIdRef.current !== requestedProjectId ||
          selectedWorktreePathRef.current !== requestedWorktreePath
        ) {
          return;
        }
        setSelectedThreadId(detail.thread.id);
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        setThreadMessages(detail.messages);
        syncThreadContext(detail.thread);
        setMobileProjectListOpen(false);
        try {
          await loadProjectWorktrees(detail.thread.projectId);
        } catch {
          // Best effort; task execution should still succeed without a worktree refresh.
        }
      } catch (error) {
        setTaskControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsRunningProjectTask(false);
      }
    },
    [
      activeCodexModel,
      activeReasoningEffort,
      activeUnsafeMode,
      activeSelectedWorktreePath,
      defaultCodexModel,
      defaultCodexReasoningEffort,
      loadProjectWorktrees,
      procedures,
      selectedProject,
      selectedThread,
      syncThreadContext,
    ],
  );

  const handleCreateThreadForWorktree = useCallback(
    (projectId: number, worktreePath: string) => {
      void createThreadForWorktree(projectId, worktreePath);
    },
    [createThreadForWorktree],
  );

  const handleToggleWorktreePinned = useCallback(
    (projectId: number, worktreePath: string, pinned: boolean) => {
      void toggleWorktreePinned(projectId, worktreePath, pinned);
    },
    [toggleWorktreePinned],
  );

  const handleOpenThread = useCallback(
    (threadId: number) => {
      void openThread(threadId);
    },
    [openThread],
  );

  const handleLoadMoreGitHistory = useCallback(() => {
    void loadMoreGitHistory();
  }, [loadMoreGitHistory]);

  const handleOpenGitHistoryDiff = useCallback(
    (entry: RpcGitHistoryEntry) => {
      void openGitHistoryDiff(entry);
    },
    [openGitHistoryDiff],
  );

  const refreshProject = useCallback(
    async (project: RpcProject, expanded: boolean) => {
      const current = getProjectState(project.id);
      const hasCachedWorktrees = current.worktrees.length > 0;
      setProjectState(project.id, {
        loadingWorktrees: expanded && !hasCachedWorktrees,
        error: "",
      });

      if (!expanded) {
        const removed = [...current.openWorktrees];
        for (const path of removed) {
          try {
            await procedures.closeWorktree({
              projectId: project.id,
              worktreePath: path,
            });
          } catch {
            // best effort
          }
        }
        setWorktreeStates((prev) => {
          const next = { ...prev } as WorktreeStateMap;
          for (const path of removed) {
            delete next[worktreeKey(project.id, path)];
          }
          return next;
        });
        setProjectState(project.id, {
          openWorktrees: new Set(),
          loadingWorktrees: false,
        });
        try {
          await procedures.closeProject({ projectId: project.id });
          setProjects((prev) =>
            upsertProjectList(prev, {
              ...project,
              isOpen: 0,
            }),
          );
        } catch {
          // best effort
        }
        if (selectedProjectId === project.id) {
          selectedWorktreePathRef.current = project.path;
          setSelectedWorktreePath(project.path);
        }
        return;
      }

      if (hasCachedWorktrees) {
        if (!selectedProjectId) {
          selectProject(project);
        }
        void procedures
          .openProject({
            projectPath: project.path,
            name: project.name,
          })
          .then((result) => {
            setProjects((prev) => upsertProjectList(prev, result.project));
            setProjectState(project.id, {
              worktrees: result.worktrees,
              loadingWorktrees: false,
              error: "",
            });
          })
          .catch((error) => {
            setProjectState(project.id, {
              loadingWorktrees: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      try {
        const result = await procedures.openProject({
          projectPath: project.path,
          name: project.name,
        });
        setProjects((prev) => upsertProjectList(prev, result.project));
        setProjectState(project.id, {
          worktrees: result.worktrees,
          loadingWorktrees: false,
          error: "",
        });
        if (!selectedProjectId) {
          selectProject(project);
        }
      } catch (error) {
        setProjectState(project.id, {
          loadingWorktrees: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      getProjectState,
      setProjectState,
      procedures,
      selectedProjectId,
      selectProject,
    ],
  );

  const ensureWorktreeOpen = useCallback(
    async (projectId: number, worktreePath: string) => {
      const target = getWorktreeState(projectId, worktreePath);
      if (target.loading || target.opened) {
        return;
      }

      const { key, requestId } = beginWorktreeToggleRequest(
        projectId,
        worktreePath,
      );
      setWorktreeState(projectId, worktreePath, {
        loading: true,
        error: "",
      });

      try {
        const result = await procedures.openWorktree({
          projectId,
          worktreePath,
        });
        if (!isCurrentWorktreeToggleRequest(key, requestId)) {
          return;
        }
        primeGitHistoryResult(result.history);
        primeProjectTasks(projectId, worktreePath, result.tasks);
        setWorktreeState(projectId, worktreePath, {
          loading: false,
          opened: true,
          snapshot: result.worktree,
          error: "",
        });
        updateProjectState(projectId, (current) => ({
          ...current,
          loadingWorktrees: false,
          openWorktrees: new Set([...current.openWorktrees, worktreePath]),
        }));
        const existingThread =
          pinnedThreadForWorktree(threads, projectId, worktreePath) ??
          latestThreadForWorktree(threads, projectId, worktreePath);
        if (
          existingThread ||
          selectedProjectIdRef.current !== projectId ||
          selectedWorktreePathRef.current !== worktreePath
        ) {
          return;
        }
        await createThreadForWorktree(projectId, worktreePath, {
          requireNoSelectedThread: true,
        });
      } catch (error) {
        if (!isCurrentWorktreeToggleRequest(key, requestId)) {
          return;
        }
        setWorktreeState(projectId, worktreePath, {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        finishWorktreeToggleRequest(key, requestId);
      }
    },
    [
      beginWorktreeToggleRequest,
      createThreadForWorktree,
      getWorktreeState,
      finishWorktreeToggleRequest,
      isCurrentWorktreeToggleRequest,
      primeProjectTasks,
      primeGitHistoryResult,
      procedures,
      setWorktreeState,
      threads,
      updateProjectState,
    ],
  );

  const handleProjectWorktreeClick = useCallback(
    (project: RpcProject, worktreePath: string) => {
      setThreadsError("");
      const target = getWorktreeState(project.id, worktreePath);
      const alreadySelected =
        selectedProjectIdRef.current === project.id &&
        selectedWorktreePathRef.current === worktreePath;
      if (alreadySelected) {
        if (!target.opened && !target.loading) {
          clearThreadSelection();
          void ensureWorktreeOpen(project.id, worktreePath);
        }
        return;
      }
      clearThreadSelection();
      selectProject(project, worktreePath);
      void ensureWorktreeOpen(project.id, worktreePath);
    },
    [clearThreadSelection, ensureWorktreeOpen, getWorktreeState, selectProject],
  );

  useEffect(() => {
    if (
      !selectedThread ||
      !selectedProject ||
      selectedProject.id !== selectedThread.projectId ||
      selectedProject.isOpen !== 1 ||
      !activeSelectedWorktreePath ||
      activeSelectedWorktreePath !== selectedThread.worktreePath
    ) {
      return;
    }

    const target = getWorktreeState(
      selectedThread.projectId,
      selectedThread.worktreePath,
    );
    if (target.loading || target.opened) {
      return;
    }

    void ensureWorktreeOpen(
      selectedThread.projectId,
      selectedThread.worktreePath,
    );
  }, [
    activeSelectedWorktreePath,
    ensureWorktreeOpen,
    getWorktreeState,
    selectedProject,
    selectedThread,
  ]);

  const postMessage = useCallback(() => {
    const text = readChatComposerDraft(initialMainviewState.chatInput).trim();
    if (!text || isSending || selectedThreadIsWorking) {
      return;
    }
    if (!selectedThreadId) {
      setChatError("Create or select a thread before sending a message.");
      return;
    }

    const pendingInput = text;
    setIsSending(true);
    setChatError("");
    setChatComposerDraft("");
    void (async () => {
      try {
        const detail = await procedures.sendThreadMessage({
          threadId: selectedThreadId,
          input: pendingInput,
        });
        setThreads((prev) => upsertThreadList(prev, detail.thread));
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        setThreadMessages(detail.messages);
      } catch (error) {
        setChatError(error instanceof Error ? error.message : String(error));
        if (!readChatComposerDraft()) {
          setChatComposerDraft(pendingInput);
        }
      } finally {
        setIsSending(false);
      }
    })();
  }, [
    initialMainviewState.chatInput,
    isSending,
    procedures,
    selectedThreadId,
    selectedThreadIsWorking,
  ]);

  const stopSelectedThreadTurn = useCallback(() => {
    if (!selectedThreadId || !selectedThreadIsWorking || isStoppingThread) {
      return;
    }

    setIsStoppingThread(true);
    setChatError("");
    void (async () => {
      try {
        const detail = await procedures.stopThreadTurn({
          threadId: selectedThreadId,
        });
        setThreads((prev) => upsertThreadList(prev, detail.thread));
        if (selectedThreadIdRef.current === detail.thread.id) {
          selectedThreadRunStateRef.current = detail.thread.runStatus.state;
          setThreadMessages(detail.messages);
        }
      } catch (error) {
        setChatError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsStoppingThread(false);
      }
    })();
  }, [isStoppingThread, procedures, selectedThreadId, selectedThreadIsWorking]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (selectedThreadIsWorking) {
        stopSelectedThreadTurn();
        return;
      }
      postMessage();
    },
    [postMessage, selectedThreadIsWorking, stopSelectedThreadTurn],
  );

  const visibleMessages = useMemo<VisibleMessage[]>(() => {
    let messages: VisibleMessage[];
    const hasInProgressAssistantChat = threadMessages.some(
      (message) =>
        message.kind === "chat" &&
        message.role === "assistant" &&
        message.state === "in_progress",
    );
    if (isThreadLoading) {
      messages = [
        {
          key: `thread-loading:${selectedThreadId ?? "none"}`,
          kind: "chat",
          speaker: "assistant",
          tone: "normal",
          text: "Loading thread history...",
        },
      ];
    } else if (!selectedThread) {
      messages = [
        {
          key: `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
          kind: "chat",
          speaker: "assistant",
          tone: "normal",
          text: selectedProject
            ? `Use the Threads panel or the selected worktree popover in the sidebar to create or open a ${APP_TITLE} thread.`
            : "Add a project, choose a worktree, and create a thread to begin.",
        },
      ];
    } else if (threadMessages.length === 0) {
      messages = [
        {
          key: `thread-ready:${selectedThread.id}`,
          kind: "chat",
          speaker: "assistant",
          tone: "normal",
          text: `Thread ready in ${selectedProject?.name ?? "this project"} · ${activeSelectedWorktreeFolder}. Ask ${APP_TITLE} to inspect, refactor, or debug this worktree.`,
        },
      ];
    } else {
      messages = threadMessages.map((message) => {
        if (message.kind === "reasoning") {
          return {
            key: `thread-message:${message.id}`,
            kind: "reasoning",
            text: message.text,
            state: message.state,
          };
        }
        if (message.kind === "command") {
          return {
            key: `thread-message:${message.id}`,
            kind: "command",
            command: message.command,
            output: message.output,
            state: message.state,
            exitCode: message.exitCode,
          };
        }
        if (message.kind === "file_change") {
          return {
            key: `thread-message:${message.id}`,
            kind: "file_change",
            path: message.path,
            diffText: message.diffText,
            changeKind: message.changeKind,
            state: message.state,
          };
        }
        if (message.kind === "tool_call") {
          return {
            key: `thread-message:${message.id}`,
            kind: "tool_call",
            server: message.server,
            tool: message.tool,
            argumentsText: message.argumentsText,
            output: message.output,
            state: message.state,
          };
        }
        if (message.kind === "web_search") {
          return {
            key: `thread-message:${message.id}`,
            kind: "web_search",
            query: message.query,
            state: message.state,
          };
        }
        if (message.kind === "error") {
          return {
            key: `thread-message:${message.id}`,
            kind: "error",
            text: message.text,
            state: message.state,
          };
        }
        return {
          key: `thread-message:${message.id}`,
          kind: "chat",
          speaker: message.role,
          tone: "normal",
          text: message.text,
        };
      });
    }
    if (
      selectedThread?.runStatus.state === "working" &&
      !hasInProgressAssistantChat
    ) {
      messages.push({
        key: `thread-working:${selectedThread.id}:${selectedThread.updatedAt}`,
        kind: "chat",
        speaker: "assistant",
        tone: "working",
        text: "Processing",
      });
    }
    if (activeChatError) {
      messages.push({
        key: `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
        kind: "chat",
        speaker: "assistant",
        tone: "error",
        text: activeChatError,
      });
    }
    if (activeChatNotice) {
      messages.push({
        key: `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
        kind: "chat",
        speaker: "assistant",
        tone: "notice",
        text: activeChatNotice,
      });
    }
    return messages;
  }, [
    activeSelectedWorktreeFolder,
    activeChatError,
    activeChatNotice,
    activeSelectedWorktreePath,
    isThreadLoading,
    selectedProject,
    selectedThread,
    selectedThreadId,
    threadMessages,
  ]);

  const sidebarActionButtonClass =
    "flex h-6 w-6 shrink-0 items-center justify-center border border-[#2f3b43] bg-[#182026] text-[#9db9cb] transition-colors hover:border-[#435561] hover:bg-[#212b31] hover:text-[#dfebf3] disabled:cursor-not-allowed disabled:opacity-50";
  const activeSidebarBranchLabel =
    activeSelectedWorktree?.branch?.trim() ||
    (selectedProject
      ? activeSelectedWorktreeName || activeSelectedWorktreeFolder
      : "Select a project");
  const composerDisabled =
    !selectedThread || isSending || selectedThreadIsWorking || isThreadLoading;

  const handleRefreshActiveDiff = useCallback(() => {
    void refreshActiveWorktreeSnapshot();
  }, [refreshActiveWorktreeSnapshot]);

  const handleNewWorktreeNameChange = useCallback((value: string) => {
    setProjectActionMenuError("");
    setNewWorktreeName(value);
  }, []);

  const handleThreadRenameTitleChange = useCallback((value: string) => {
    setThreadActionMenuError("");
    setThreadRenameTitle(value);
  }, []);

  const handleThreadRenameSummaryChange = useCallback((value: string) => {
    setThreadActionMenuError("");
    setThreadRenameSummary(value);
  }, []);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    window.__joltAppMountedAt = Date.now();
    console.log("App.tsx mounted", window.__joltAppMountedAt);
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-[#0e0e0e] text-[#ffffff]">
      <div className="hidden h-full md:flex md:flex-col">
        <header className="flex justify-between items-center w-full px-6 h-14 bg-[#131313] border-b border-[#262626] z-50">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-black tracking-tighter text-[#bdd5e6]">
              {APP_TITLE}
            </h1>
            <nav className="flex items-center gap-6">
              <button
                type="button"
                className={`font-label text-xs uppercase tracking-wider pb-1 transition-colors duration-200 ${
                  primaryView === "chat"
                    ? "border-b-2 border-[#7eadce] text-[#bdd5e6]"
                    : "text-[#adabaa] hover:text-[#f2f0ef]"
                }`}
                onClick={() => {
                  setPrimaryView("chat");
                }}
              >
                Chat
              </button>
              <button
                type="button"
                className={`font-label text-xs uppercase tracking-wider pb-1 transition-colors duration-200 ${
                  primaryView === "diff"
                    ? "border-b-2 border-[#7eadce] text-[#bdd5e6]"
                    : "text-[#adabaa] hover:text-[#f2f0ef]"
                }`}
                onClick={() => {
                  setPrimaryView("diff");
                }}
              >
                Diff
              </button>
              <button
                type="button"
                className={`font-label text-xs uppercase tracking-wider pb-1 transition-colors duration-200 ${
                  primaryView === "tasks"
                    ? "border-b-2 border-[#7eadce] text-[#bdd5e6]"
                    : "text-[#adabaa] hover:text-[#f2f0ef]"
                }`}
                onClick={() => {
                  setPrimaryView("tasks");
                }}
              >
                Tasks
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {materialSymbol(
              "account_circle",
              "text-on-surface-variant hover:bg-[#262626] p-2 rounded transition-all",
            )}
            {materialSymbol(
              "settings",
              "text-on-surface-variant hover:bg-[#262626] p-2 rounded transition-all",
            )}
          </div>
        </header>

        <nav
          aria-label="Selected thread context"
          className="h-10 bg-[#131313] flex items-center px-6 gap-2"
        >
          <span className="font-label text-xs font-bold text-[#bdd5e6] shrink-0">
            {selectedThread?.title ??
              selectedProject?.name ??
              "No project selected"}
          </span>
          {selectedProject ? (
            <>
              <span className="text-[#545d64] text-xs shrink-0">|</span>
              <span className="font-label text-xs text-[#f2f0ef] truncate">
                {activeSelectedWorktreeFolder}
              </span>
              <span className="font-label text-xs text-[#8f8d8b] truncate">
                {activeSelectedWorktreeName}
              </span>
            </>
          ) : null}
        </nav>

        <main className="flex flex-1 min-h-0 overflow-hidden">
          <DesktopSidebar
            initialCollapsed={initialMainviewState.sidebarCollapsed}
            onCollapsedChange={handleSidebarCollapsedChange}
            renderExpandedContent={(collapseSidebar) => (
              <div
                ref={desktopSidebarScrollRef}
                className="app-scrollbar flex-1 overflow-y-auto px-3 pb-5 pt-3"
              >
                <SidebarContent
                  activeSidebarBranchLabel={activeSidebarBranchLabel}
                  collapseControl={
                    <button
                      type="button"
                      aria-label="Collapse sidebar"
                      className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#2f3b43] bg-[#182026] text-[#bdd5e6] transition-colors hover:bg-[#212b31]"
                      onClick={collapseSidebar}
                    >
                      {materialSymbol(
                        "chevron_right",
                        "rotate-180 text-[17px]",
                      )}
                    </button>
                  }
                  gitHistoryPanelKey={`${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`}
                  gitHistoryPanelProps={{
                    activeSelectedWorktreePath,
                    filteredGitHistoryEntries,
                    gitHistoryError,
                    gitHistoryLoading,
                    gitHistoryLoadingMore,
                    onCancelPreloadGitHistoryDiff: cancelPreloadGitHistoryDiff,
                    onLoadMoreGitHistory: handleLoadMoreGitHistory,
                    onOpenGitHistoryDiff: handleOpenGitHistoryDiff,
                    onPreloadGitHistoryDiff: preloadGitHistoryDiff,
                    selectedProject,
                  }}
                  onSidebarSearchQueryChange={setSidebarSearchQuery}
                  projectsPanelProps={{
                    addProjectError,
                    addProjectInputIsPreviewing,
                    addProjectOpen,
                    addProjectPath,
                    directorySuggestions,
                    directorySuggestionsLoading,
                    displayedAddProjectPath,
                    filteredProjects,
                    getProjectState,
                    getWorktreeState,
                    homeDirectory,
                    hoveredDirectorySuggestion,
                    isActiveWorktree,
                    isAddingProject,
                    normalizedSidebarSearchQuery,
                    onAddProjectPathChange: handleAddProjectPathChange,
                    onCloseAddProjectForm: closeAddProjectForm,
                    onDirectorySuggestionEnter: handleDirectorySuggestionEnter,
                    onDirectorySuggestionLeave: handleDirectorySuggestionLeave,
                    onOpenProjectActionMenu: openProjectActionMenu,
                    onProjectWorktreeClick: handleProjectWorktreeClick,
                    onRefreshProject: refreshProject,
                    onSelectDirectorySuggestion: selectDirectorySuggestion,
                    onSubmitAddProject: submitAddProject,
                    onToggleAddProjectForm: toggleAddProjectForm,
                    onToggleWorktreePinned: handleToggleWorktreePinned,
                    projectThreadErrorLevel,
                    selectedProjectId,
                    sidebarActionButtonClass,
                    supportsTildePath,
                    worktreePinBusyPath,
                    worktreeThreadErrorLevel,
                  }}
                  selectedProjectName={selectedProject?.name ?? null}
                  sidebarSearchQuery={sidebarSearchQuery}
                  workspacePanelProps={{
                    acknowledgeThreadErrorSeenInBackground,
                    clearCompletedThreadIndicator,
                    dismissThreadStatus,
                    getProjectState,
                    homeDirectory,
                    isThreadStatusDismissed,
                    onOpenThread: handleOpenThread,
                    onOpenThreadActionMenu: openThreadActionMenu,
                    projects,
                    selectedThreadId,
                    supportsTildePath,
                    threadPreviewsDisabled: threadActionMenu !== null,
                    threadActivityIndicator,
                    threadsError,
                    workspaceActiveThreads: filteredWorkspaceActiveThreads,
                    workspacePinnedThreads: filteredWorkspacePinnedThreads,
                  }}
                />
              </div>
            )}
          />

          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0e0e0e]">
            {primaryView === "chat" ? (
              isDesktopViewport ? (
                <DesktopChatView
                  activeCodexModel={activeCodexModel}
                  activeContextInputTokens={activeContextInputTokens}
                  activeContextWindowTokens={activeContextWindowTokens}
                  activeReasoningEffort={activeReasoningEffort}
                  activeUnsafeMode={activeUnsafeMode}
                  activeScreenSubtitlePrimary={activeScreenSubtitlePrimary}
                  activeScreenSubtitleSecondary={activeScreenSubtitleSecondary}
                  activeScreenTitle={activeScreenTitle}
                  activeThreadId={selectedThreadId}
                  codexModels={codexModels}
                  composerActionDisabled={composerActionDisabled}
                  composerActionLabel={composerActionLabel}
                  composerDisabled={composerDisabled}
                  expandedItemIds={expandedTranscriptItemIds}
                  hasSelectedThread={Boolean(selectedThread)}
                  initialChatInput={initialMainviewState.chatInput}
                  isLoadingProjectTasks={isLoadingProjectTasks}
                  isWorking={selectedThreadIsWorking}
                  localUserLabel={localUserLabel}
                  messages={visibleMessages}
                  modelControlError={modelControlError}
                  modelSelectorDisabled={modelSelectorDisabled}
                  onChangeModel={(value) => {
                    void updateActiveCodexModel(value);
                  }}
                  onChangeReasoningEffort={(value) => {
                    void updateActiveReasoningEffort(value);
                  }}
                  onChangeUnsafeMode={(value) => {
                    void updateActiveUnsafeMode(value);
                  }}
                  onSelectTask={(task) => {
                    void runSelectedTask(task);
                  }}
                  onSubmit={onSubmit}
                  onSubmitMessage={postMessage}
                  onToggleItemExpanded={toggleTranscriptItemExpanded}
                  projectTasks={projectTasks}
                  reasoningEffortControlError={reasoningEffortControlError}
                  reasoningEffortSelectorDisabled={
                    reasoningEffortSelectorDisabled
                  }
                  reasoningEfforts={reasoningEfforts}
                  selectedThreadIsWorking={selectedThreadIsWorking}
                  taskControlError={taskControlError}
                  taskSelectorDisabled={taskSelectorDisabled}
                  unsafeModeControlError={unsafeModeControlError}
                  unsafeModeToggleDisabled={unsafeModeToggleDisabled}
                />
              ) : null
            ) : primaryView === "diff" ? (
              <div className="flex min-h-0 flex-1 px-6 py-6">
                <DiffWorkspace
                  activeSelectedWorktreeFolder={activeSelectedWorktreeFolder}
                  activeSelectedWorktreeOpened={activeSelectedWorktreeOpened}
                  activeSelectedWorktreePath={activeSelectedWorktreePath}
                  activeWorktreeChanges={activeWorktreeChanges}
                  diffFilePatchState={diffFilePatchState}
                  diffFileTree={diffFileTree}
                  hasActiveWorktreeSnapshot={Boolean(activeWorktreeSnapshot)}
                  homeDirectory={homeDirectory}
                  isRefreshingWorktreeSnapshot={isRefreshingWorktreeSnapshot}
                  onRefresh={handleRefreshActiveDiff}
                  onSelectedDiffFilePathChange={setSelectedDiffFilePath}
                  refreshDisabled={
                    !selectedProject ||
                    !activeSelectedWorktreePath ||
                    !activeSelectedWorktreeOpened ||
                    isRefreshingWorktreeSnapshot
                  }
                  selectedDiffFileChange={selectedDiffFileChange}
                  selectedDiffFilePath={selectedDiffFilePath}
                  selectedProject={selectedProject}
                  supportsTildePath={supportsTildePath}
                  variant="desktop"
                  worktreeDiffError={worktreeDiffError}
                />
              </div>
            ) : (
              <TasksWorkspace
                activeSelectedWorktreeOpened={activeSelectedWorktreeOpened}
                activeSelectedWorktreePath={activeSelectedWorktreePath}
                homeDirectory={homeDirectory}
                isLoadingProjectTasks={isLoadingProjectTasks}
                onRunTask={(task) => {
                  void runSelectedTask(task);
                }}
                runDisabled={taskSelectorDisabled}
                selectedProject={selectedProject}
                supportsTildePath={supportsTildePath}
                taskControlError={taskControlError}
                tasks={projectTasks}
                variant="desktop"
              />
            )}
          </section>
        </main>
      </div>

      <div className="flex h-full flex-col overflow-hidden md:hidden">
        <header className="fixed top-0 w-full z-50 bg-[#0e0e0e] flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="relative text-[#bdd5e6]"
              aria-controls="mobile-navigation-drawer"
              aria-expanded={mobileProjectListOpen}
              aria-label={
                mobileProjectListOpen ? "Close navigation" : "Open navigation"
              }
              onClick={() => setMobileProjectListOpen((value) => !value)}
            >
              {materialSymbol("menu")}
              {mobileNavigationIndicator !== "none" ? (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full border border-[#0e0e0e] ${
                    mobileNavigationIndicator === "completed"
                      ? "bg-[#5df28b]"
                      : "bg-[#4aa8ff]"
                  }`}
                />
              ) : null}
            </button>
            <h1 className="font-headline tracking-wider uppercase text-sm font-bold text-[#bdd5e6]">
              {APP_TITLE}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {materialSymbol("search", "text-on-surface-variant")}
          </div>
        </header>

        {mobileProjectListOpen ? (
          <aside
            aria-label="Project, thread, and git navigation"
            className="fixed inset-x-0 top-14 z-40 h-[68vh] overflow-y-auto border-b border-[#3f3f3f] bg-[#131313] px-3 py-3"
            id="mobile-navigation-drawer"
            ref={mobileSidebarScrollRef}
          >
            <SidebarContent
              activeSidebarBranchLabel={activeSidebarBranchLabel}
              collapseControl={null}
              gitHistoryPanelKey={`${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`}
              gitHistoryPanelProps={{
                activeSelectedWorktreePath,
                filteredGitHistoryEntries,
                gitHistoryError,
                gitHistoryLoading,
                gitHistoryLoadingMore,
                onCancelPreloadGitHistoryDiff: cancelPreloadGitHistoryDiff,
                onLoadMoreGitHistory: handleLoadMoreGitHistory,
                onOpenGitHistoryDiff: handleOpenGitHistoryDiff,
                onPreloadGitHistoryDiff: preloadGitHistoryDiff,
                selectedProject,
              }}
              onSidebarSearchQueryChange={setSidebarSearchQuery}
              projectsPanelProps={{
                addProjectError,
                addProjectInputIsPreviewing,
                addProjectOpen,
                addProjectPath,
                directorySuggestions,
                directorySuggestionsLoading,
                displayedAddProjectPath,
                filteredProjects,
                getProjectState,
                getWorktreeState,
                homeDirectory,
                hoveredDirectorySuggestion,
                isActiveWorktree,
                isAddingProject,
                normalizedSidebarSearchQuery,
                onAddProjectPathChange: handleAddProjectPathChange,
                onCloseAddProjectForm: closeAddProjectForm,
                onDirectorySuggestionEnter: handleDirectorySuggestionEnter,
                onDirectorySuggestionLeave: handleDirectorySuggestionLeave,
                onOpenProjectActionMenu: openProjectActionMenu,
                onProjectWorktreeClick: handleProjectWorktreeClick,
                onRefreshProject: refreshProject,
                onSelectDirectorySuggestion: selectDirectorySuggestion,
                onSubmitAddProject: submitAddProject,
                onToggleAddProjectForm: toggleAddProjectForm,
                onToggleWorktreePinned: handleToggleWorktreePinned,
                projectThreadErrorLevel,
                selectedProjectId,
                sidebarActionButtonClass,
                supportsTildePath,
                worktreePinBusyPath,
                worktreeThreadErrorLevel,
              }}
              selectedProjectName={selectedProject?.name ?? null}
              sidebarSearchQuery={sidebarSearchQuery}
              workspacePanelProps={{
                acknowledgeThreadErrorSeenInBackground,
                clearCompletedThreadIndicator,
                dismissThreadStatus,
                getProjectState,
                homeDirectory,
                isThreadStatusDismissed,
                onOpenThread: handleOpenThread,
                onOpenThreadActionMenu: openThreadActionMenu,
                projects,
                selectedThreadId,
                supportsTildePath,
                threadPreviewsDisabled: threadActionMenu !== null,
                threadActivityIndicator,
                threadsError,
                workspaceActiveThreads: filteredWorkspaceActiveThreads,
                workspacePinnedThreads: filteredWorkspacePinnedThreads,
              }}
            />
          </aside>
        ) : null}

        <main className="mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col gap-6 px-4 pt-14 pb-16">
          {primaryView === "chat" ? (
            !isDesktopViewport ? (
              <MobileChatView
                activeCodexModel={activeCodexModel}
                activeReasoningEffort={activeReasoningEffort}
                activeUnsafeMode={activeUnsafeMode}
                activeScreenSubtitlePrimary={activeScreenSubtitlePrimary}
                activeScreenSubtitleSecondary={activeScreenSubtitleSecondary}
                activeScreenTitle={activeScreenTitle}
                activeThreadId={selectedThreadId}
                codexModels={codexModels}
                composerActionDisabled={composerActionDisabled}
                composerActionLabel={composerActionLabel}
                composerDisabled={composerDisabled}
                expandedItemIds={expandedTranscriptItemIds}
                hasSelectedThread={Boolean(selectedThread)}
                initialChatInput={initialMainviewState.chatInput}
                isLoadingProjectTasks={isLoadingProjectTasks}
                isWorking={selectedThreadIsWorking}
                localUserLabel={localUserLabel}
                messages={visibleMessages}
                modelControlError={modelControlError}
                modelSelectorDisabled={modelSelectorDisabled}
                onChangeModel={(value) => {
                  void updateActiveCodexModel(value);
                }}
                onChangeReasoningEffort={(value) => {
                  void updateActiveReasoningEffort(value);
                }}
                onChangeUnsafeMode={(value) => {
                  void updateActiveUnsafeMode(value);
                }}
                onSelectTask={(task) => {
                  void runSelectedTask(task);
                }}
                onSubmit={onSubmit}
                onSubmitMessage={postMessage}
                onToggleItemExpanded={toggleTranscriptItemExpanded}
                projectTasks={projectTasks}
                reasoningEffortControlError={reasoningEffortControlError}
                reasoningEffortSelectorDisabled={
                  reasoningEffortSelectorDisabled
                }
                reasoningEfforts={reasoningEfforts}
                selectedThreadIsWorking={selectedThreadIsWorking}
                taskControlError={taskControlError}
                taskSelectorDisabled={taskSelectorDisabled}
                unsafeModeControlError={unsafeModeControlError}
                unsafeModeToggleDisabled={unsafeModeToggleDisabled}
              />
            ) : null
          ) : primaryView === "diff" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 pt-6">
              <DiffWorkspace
                activeSelectedWorktreeFolder={activeSelectedWorktreeFolder}
                activeSelectedWorktreeOpened={activeSelectedWorktreeOpened}
                activeSelectedWorktreePath={activeSelectedWorktreePath}
                activeWorktreeChanges={activeWorktreeChanges}
                diffFilePatchState={diffFilePatchState}
                diffFileTree={diffFileTree}
                hasActiveWorktreeSnapshot={Boolean(activeWorktreeSnapshot)}
                homeDirectory={homeDirectory}
                isRefreshingWorktreeSnapshot={isRefreshingWorktreeSnapshot}
                onRefresh={handleRefreshActiveDiff}
                onSelectedDiffFilePathChange={setSelectedDiffFilePath}
                refreshDisabled={
                  !selectedProject ||
                  !activeSelectedWorktreePath ||
                  !activeSelectedWorktreeOpened ||
                  isRefreshingWorktreeSnapshot
                }
                selectedDiffFileChange={selectedDiffFileChange}
                selectedDiffFilePath={selectedDiffFilePath}
                selectedProject={selectedProject}
                supportsTildePath={supportsTildePath}
                variant="mobile"
                worktreeDiffError={worktreeDiffError}
              />
            </div>
          ) : (
            <TasksWorkspace
              activeSelectedWorktreeOpened={activeSelectedWorktreeOpened}
              activeSelectedWorktreePath={activeSelectedWorktreePath}
              homeDirectory={homeDirectory}
              isLoadingProjectTasks={isLoadingProjectTasks}
              onRunTask={(task) => {
                void runSelectedTask(task);
              }}
              runDisabled={taskSelectorDisabled}
              selectedProject={selectedProject}
              supportsTildePath={supportsTildePath}
              taskControlError={taskControlError}
              tasks={projectTasks}
              variant="mobile"
            />
          )}
        </main>

        <div className="fixed bottom-0 left-0 w-full z-50">
          <div className="w-full h-1 bg-[#000000]">
            <div className="h-full bg-[#bdd5e6]/40 w-[100%] relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          </div>
          <nav className="grid h-16 grid-cols-3 items-center bg-[#0e0e0e]">
            <button
              type="button"
              className={`flex h-full flex-col items-center justify-center pt-2 transition-colors ${
                primaryView === "tasks"
                  ? "border-t-2 border-[#bdd5e6] font-bold text-[#bdd5e6]"
                  : "text-[#adabaa] hover:text-[#f2f0ef]"
              }`}
              onClick={() => {
                setPrimaryView("tasks");
              }}
            >
              {materialSymbol("checklist")}
              <span className="mt-1 font-label text-[10px] uppercase tracking-widest">
                Tasks
              </span>
            </button>
            <button
              type="button"
              className={`flex h-full flex-col items-center justify-center pt-2 transition-colors ${
                primaryView === "diff"
                  ? "border-t-2 border-[#bdd5e6] font-bold text-[#bdd5e6]"
                  : "text-[#adabaa] hover:text-[#f2f0ef]"
              }`}
              onClick={() => {
                setPrimaryView("diff");
              }}
            >
              {materialSymbol("difference")}
              <span className="mt-1 font-label text-[10px] uppercase tracking-widest">
                Diff
              </span>
            </button>
            <button
              type="button"
              className={`flex h-full flex-col items-center justify-center pt-2 transition-colors ${
                primaryView === "chat"
                  ? "text-[#bdd5e6] font-bold border-t-2 border-[#bdd5e6]"
                  : "text-[#adabaa] hover:text-[#f2f0ef]"
              }`}
              onClick={() => {
                setPrimaryView("chat");
              }}
            >
              {brandBoltIcon("text-sm")}
              <span className="mt-1 font-label text-[10px] uppercase tracking-widest">
                Chat
              </span>
            </button>
          </nav>
        </div>
      </div>
      {worktreeThreadPopover &&
      selectedProject &&
      activeSelectedWorktreePath ? (
        <div
          ref={worktreeThreadPopoverRef}
          className="fixed z-[85] flex select-none flex-col overflow-hidden border border-[#35414a] bg-[#13181b]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
          style={{
            left: worktreeThreadPopover.x,
            maxHeight: worktreeThreadPopover.maxHeight,
            top: worktreeThreadPopover.y,
            width: worktreeThreadPopover.width,
          }}
        >
          <div className="border-b border-[#2b343b] bg-[#181f24] px-3 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
                  Threads
                </div>
                <div className="truncate text-sm font-semibold text-[#f2f0ef]">
                  {activeSelectedWorktreeName || activeSelectedWorktreeFolder}
                </div>
                <div className="truncate text-[11px] text-[#8f9aa2]">
                  {activeScreenSubtitleSecondary}
                </div>
              </div>
              <button
                type="button"
                className={sidebarActionButtonClass}
                onClick={() => {
                  handleCreateThreadForWorktree(
                    selectedProject.id,
                    activeSelectedWorktreePath,
                  );
                }}
                disabled={isCreatingThread}
                aria-label="Create thread for selected worktree"
                title="Create thread"
              >
                {isCreatingThread ? "…" : "+"}
              </button>
            </div>
          </div>
          <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
            {selectedWorktreeThreads.length > 0 ? (
              <ThreadList
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                anchorIdPrefix="worktree-thread"
                clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                dismissThreadStatus={dismissThreadStatus}
                getProjectState={getProjectState}
                homeDirectory={homeDirectory}
                isThreadStatusDismissed={isThreadStatusDismissed}
                onOpenThread={handleOpenThread}
                onOpenThreadActionMenu={openThreadActionMenu}
                previewDisabled={threadActionMenu !== null}
                projects={projects}
                selectedThreadId={selectedThreadId}
                supportsTildePath={supportsTildePath}
                threadActivityIndicator={threadActivityIndicator}
                threads={selectedWorktreeThreads}
              />
            ) : (
              <div className="px-3 py-3 text-xs text-[#8f8d8b]">
                {isCreatingThread
                  ? "Creating thread..."
                  : `No threads in this worktree yet. Use + to start a ${APP_TITLE} thread.`}
              </div>
            )}
          </div>
          {threadsError ? (
            <div className="border-t border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff9db0]">
              {threadsError}
            </div>
          ) : null}
        </div>
      ) : null}
      {currentThreadStartRequest ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-xl rounded-2xl border border-[#3a4751] bg-[#151718] p-5 shadow-2xl shadow-black/50">
            <div className="mb-2 font-label text-[11px] uppercase tracking-[0.18em] text-[#8fb5cd]">
              New Thread Request
            </div>
            <div className="mb-2 text-lg font-semibold text-[#f2f0ef]">
              Create a thread for this workspace?
            </div>
            <div className="mb-4 text-sm text-[#bfd1dc]">
              {currentThreadStartRequestProject?.name ??
                currentThreadStartRequest.projectPath}
            </div>
            <div className="mb-4 rounded-xl border border-[#2b343b] bg-[#0e1011] px-4 py-3">
              <div className="mb-1 font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                Workspace
              </div>
              <div className="break-all font-mono text-sm text-[#d8e5ee]">
                {currentThreadStartRequestWorkspace}
              </div>
            </div>
            <div className="mb-4 rounded-xl border border-[#2b343b] bg-[#0e1011] px-4 py-3">
              <div className="mb-1 font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                Initial Prompt
              </div>
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-[#d8e5ee]">
                {currentThreadStartRequest.input}
              </div>
            </div>
            <div className="mb-4 flex flex-wrap gap-2 text-xs text-[#9db4c2]">
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Model: {currentThreadStartRequest.model ?? "default"}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Reasoning:{" "}
                {currentThreadStartRequest.reasoningEffort ?? "default"}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Unsafe:{" "}
                {currentThreadStartRequest.unsafeMode === null
                  ? "default"
                  : currentThreadStartRequest.unsafeMode
                    ? "on"
                    : "off"}
              </span>
            </div>
            {threadStartRequestError ? (
              <div className="mb-4 rounded-xl border border-[#6b3a3a] bg-[#2a1717] px-4 py-3 text-sm text-[#ffb9b9]">
                {threadStartRequestError}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[#7f959f]">
                {pendingThreadStartRequests.length > 1
                  ? `${pendingThreadStartRequests.length} requests queued`
                  : "Approve to create and open the requested thread."}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-full border border-[#46535c] px-4 py-2 text-sm text-[#d4dee5] transition hover:border-[#6d7b85] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isApprovingThreadStartRequest}
                  onClick={() => {
                    dismissThreadStartRequest(
                      currentThreadStartRequest.requestId,
                    );
                  }}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[#bdd5e6] px-4 py-2 text-sm font-semibold text-[#0f1418] transition hover:bg-[#d8e6f0] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isApprovingThreadStartRequest}
                  onClick={() => {
                    void approveThreadStartRequest(currentThreadStartRequest);
                  }}
                >
                  {isApprovingThreadStartRequest
                    ? "Creating..."
                    : "Create Thread"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {gitHistoryModal ? (
        <GitHistoryDiffModal
          state={gitHistoryModal}
          onClose={closeGitHistoryModal}
        />
      ) : null}
      <ProjectActionMenu
        error={projectActionMenuError}
        homeDirectory={homeDirectory}
        isCreatingWorktree={isCreatingWorktree}
        menu={projectActionMenu}
        newWorktreeName={newWorktreeName}
        onClose={closeProjectActionMenu}
        onDeleteProject={() => {
          if (!projectActionMenuProject) {
            return;
          }
          void deleteTrackedProject(projectActionMenuProject.id);
        }}
        onNewWorktreeNameChange={handleNewWorktreeNameChange}
        onSubmit={submitNewWorktree}
        project={projectActionMenuProject}
        projectActionMenuRef={projectActionMenuRef}
        supportsTildePath={supportsTildePath}
        worktreePinBusyPath={worktreePinBusyPath}
      />
      <ThreadActionMenu
        error={threadActionMenuError}
        homeDirectory={homeDirectory}
        menu={threadActionMenu}
        onClose={closeThreadActionMenu}
        onDeleteThread={() => {
          void deleteSelectedThread();
        }}
        onSummaryChange={handleThreadRenameSummaryChange}
        onSubmit={submitThreadRename}
        onTitleChange={handleThreadRenameTitleChange}
        onTogglePinned={() => {
          void toggleThreadPinned();
        }}
        supportsTildePath={supportsTildePath}
        thread={threadActionMenuThread}
        threadActionBusy={threadActionBusy}
        threadActionMenuRef={threadActionMenuRef}
        threadRenameSummary={threadRenameSummary}
        threadRenameTitle={threadRenameTitle}
      />
    </div>
  );
}
