/**
 * @file src/mainview/App.tsx
 * @description Module for app.
 */

import {
  type FormEvent,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthPrimaryFactorType } from "../bun/db";
import type {
  ProjectProcedures,
  RpcCronJob,
  RpcGitHistoryEntry,
  RpcModelCatalog,
  RpcModelOption,
  RpcProject,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
} from "../bun/rpc-schema";
import { ProjectActionMenu, ThreadActionMenu } from "./app/action-menus";
import { AuthStepUpDialog } from "./app/auth-step-up-dialog";
import { DesktopChatView, MobileChatView } from "./app/chat-workspace";
import { CronjobWorkspace } from "./app/cronjob-workspace";
import { DesktopSidebar } from "./app/desktop-sidebar";
import { DesktopSidebarContent } from "./app/desktop-sidebar-content";
import { DesktopThreadSwitcher } from "./app/desktop-thread-switcher";
import { DiffWorkspace } from "./app/diff-workspace";
import { GitHistoryDiffModal } from "./app/message-ui";
import { SettingsPanel } from "./app/settings-panel";
import { SidebarContent } from "./app/sidebar-content";
import {
  setProjectTreeOpen,
  setWorkspaceActiveSectionOpen,
  setWorkspacePanelOpen,
} from "./app/sidebar-panels-state";
import {
  APP_TITLE,
  clampProjectMenuCoordinate,
  createAbortError,
  createProjectStore,
  createThreadStore,
  defaultProjectState,
  defaultWorktreeState,
  emptyProjectStore,
  emptyThreadStore,
  formatDirectoryPathForInput,
  formatPathForDisplay,
  isAbortError,
  isCodexReasoningEffort,
  MAINVIEW_STATE_STORAGE_VERSION,
  MAINVIEW_STATE_WRITE_DEBOUNCE_MS,
  type PersistedMainviewState,
  type ProjectActionMenuState,
  type ProjectNodeState,
  type ProjectStateMap,
  type ProjectStore,
  patchPersistedMainviewState,
  primaryWorktreePath,
  projectStateWorktrees,
  projectStoreItems,
  readPersistedMainviewState,
  removeThreadFromStore,
  serializeOpenWorktrees,
  THREAD_START_REQUEST_CREATED_EVENT_NAME,
  THREAD_STATUS_CHANGED_EVENT_NAME,
  THREAD_STATUS_POLL_INTERVAL_MS,
  type ThreadActionMenuState,
  type ThreadStore,
  threadStoreItems,
  upsertProjectStore,
  upsertThreadStore,
  type WorktreeNodeState,
  type WorktreeStateMap,
  withAcknowledgedUnreadThread,
  withAcknowledgedUnreadThreadDetail,
  worktreeKey,
  writePersistedMainviewState,
} from "./app/state";
import { deriveSafeChildAccessDefaults } from "./app/thread-access-defaults";
import { ThreadExtensionUiDialog } from "./app/thread-extension-ui-dialog";
import { useAddProjectForm } from "./app/use-add-project-form";
import { useDesktopThreadSwitcher } from "./app/use-desktop-thread-switcher";
import { useGitHistoryController } from "./app/use-git-history-controller";
import { useMainviewDerivedState } from "./app/use-mainview-derived-state";
import { useMainviewStartupController } from "./app/use-mainview-startup-controller";
import { useProjectWorktreeController } from "./app/use-project-worktree-controller";
import { useStepUpController } from "./app/use-step-up-controller";
import { useThreadExtensionUiController } from "./app/use-thread-extension-ui-controller";
import { ThreadStatusController } from "./app/use-thread-status-controller";
import { useThreadWorkspaceSelectionController } from "./app/use-thread-workspace-selection-controller";
import {
  mergeThreadMessageHistory,
  useVisibleMessages,
} from "./app/use-visible-messages";
import { useWorktreeDiff } from "./app/use-worktree-diff";
import { stepUpAuth } from "./auth-client";
import { brandLogoIcon } from "./controls/brand-logo";
import {
  readChatComposerDraft,
  setChatComposerDraft,
} from "./controls/chat-composer-control";
import { CodexModelSelector } from "./controls/codex-model-selector";
import {
  codexModelScopeCallout,
  codexModelSelectorLabel,
  codexModelSupportsThinkingLevel,
  findCodexModel,
  findReasoningEffortOption,
} from "./controls/codex-utils";
import { materialSymbol } from "./controls/icons";
import {
  ThreadAccessControl,
  type ThreadAccessValue,
} from "./controls/thread-access-control";
import { buildLoadedProjectWorktreesState } from "./project-worktree-refresh";
import {
  shouldApplySentThreadDetailToSelection,
  shouldApplyThreadSendFailureToSelection,
} from "./thread-send";
import { buildSelectedThreadDetailRefreshKey } from "./thread-status-refresh";
import { derivePrimaryViewForPinnedThreadOpen } from "./thread-workspace-selection";

type AppProps = {
  isAdmin: boolean;
  primaryFactorType: AuthPrimaryFactorType | null;
  procedures: ProjectProcedures;
};

/**
 * App-level sizing and interaction constants for responsive layout decisions.
 */

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
type PrimaryView = "chat" | "diff" | "cronjobs";
type CronCreatorMode = "describe" | "edit";
type MobileNavigationIndicatorState = "none" | "working" | "completed";

/**
 * Subscribes to a media query and keeps a boolean in sync with viewport width.
 */

function useDesktopViewport(): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    /**
     * Handles change.
     * @param event - event value.
     */

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

/**
 * Compares worktree change arrays by field values and array order.
 */

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

/**
 * Compares simple string arrays in a deterministic, order-sensitive way.
 * @param left - left value.
 * @param right - right value.
 */
function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

/**
 * Compares worktree snapshots by path and change/diff metadata before deciding to
 * trigger refresh work.
 */

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
    __metidosAppMountedAt?: number;
  }
}

/**
 * Root mainview component.
 *
 * It composes sidebar/workspace panels, thread/project state derivation, and
 * RPC-driven update handlers into a single interface.
 */

export default function App({
  isAdmin,
  primaryFactorType,
  procedures,
}: AppProps): JSX.Element {
  // Persisted UI state is loaded once and stored in a ref so initialization is
  // cached while state references remain stable across renders.
  const initialMainviewStateRef = useRef<PersistedMainviewState | null>(null);
  if (!initialMainviewStateRef.current) {
    initialMainviewStateRef.current = readPersistedMainviewState();
  }
  const initialMainviewState = initialMainviewStateRef.current;

  const [projectStore, setProjectStore] = useState<ProjectStore>(() =>
    emptyProjectStore(),
  );
  const [projectStates, setProjectStates] = useState<ProjectStateMap>({});
  const [worktreeStates, setWorktreeStates] = useState<WorktreeStateMap>({});
  const [homeDirectory, setHomeDirectory] = useState("");
  const [supportsTildePath, setSupportsTildePath] = useState(false);
  const [projectActionMenu, setProjectActionMenu] =
    useState<ProjectActionMenuState | null>(null);
  const [threadActionMenu, setThreadActionMenu] =
    useState<ThreadActionMenuState | null>(null);
  const [projectActionMenuError, setProjectActionMenuError] = useState("");
  const [
    projectActionMenuHiddenWorktreePath,
    setProjectActionMenuHiddenWorktreePath,
  ] = useState("");
  const [
    projectActionMenuHiddenWorktrees,
    setProjectActionMenuHiddenWorktrees,
  ] = useState<RpcWorktree[]>([]);
  const [threadActionMenuError, setThreadActionMenuError] = useState("");
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [threadRenameTitle, setThreadRenameTitle] = useState("");
  const [threadRenameSummary, setThreadRenameSummary] = useState("");
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [isOpeningHiddenWorktree, setIsOpeningHiddenWorktree] = useState(false);
  const [worktreePinBusyPath, setWorktreePinBusyPath] = useState<string | null>(
    null,
  );
  const [threadStore, setThreadStore] = useState<ThreadStore>(() =>
    emptyThreadStore(),
  );
  const [gitHistory, setGitHistory] =
    useState<RpcWorktreeGitHistoryResult | null>(null);
  const [gitHistoryLoading, setGitHistoryLoading] = useState(false);
  const [gitHistoryLoadingMore, setGitHistoryLoadingMore] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState("");
  const [codexModels, setCodexModels] = useState<RpcModelOption[]>([]);
  const [reasoningEfforts, setReasoningEfforts] = useState<
    RpcReasoningEffortOption[]
  >([]);
  const [defaultCodexModel, setDefaultCodexModel] = useState("");
  const [defaultCodexReasoningEffort, setDefaultCodexReasoningEffort] =
    useState<RpcReasoningEffort>("medium");
  const [pendingThreadModel, setPendingThreadModel] = useState(
    initialMainviewState.pendingThreadModel,
  );
  const [pendingThreadReasoningEffort, setPendingThreadReasoningEffort] =
    useState<RpcReasoningEffort>(
      isCodexReasoningEffort(initialMainviewState.pendingThreadReasoningEffort)
        ? initialMainviewState.pendingThreadReasoningEffort
        : defaultCodexReasoningEffort,
    );
  const [pendingThreadWebSearchAccess, setPendingThreadWebSearchAccess] =
    useState(initialMainviewState.pendingThreadWebSearchAccess);
  const [pendingThreadGithubAccess, setPendingThreadGithubAccess] = useState(
    initialMainviewState.pendingThreadGithubAccess,
  );
  const [pendingThreadAgentsAccess, setPendingThreadAgentsAccess] = useState(
    initialMainviewState.pendingThreadAgentsAccess,
  );
  const [pendingThreadMetidosAccess, setPendingThreadMetidosAccess] = useState(
    initialMainviewState.pendingThreadMetidosAccess,
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
  const [cronJobs, setCronJobs] = useState<RpcCronJob[]>([]);
  const [cronJobsError, setCronJobsError] = useState("");
  const [isLoadingCronJobs, setIsLoadingCronJobs] = useState(false);
  const [isCreatingCronJob, setIsCreatingCronJob] = useState(false);
  const [runningCronJobs, setRunningCronJobs] = useState(new Set<number>());
  const [deletingCronJobs, setDeletingCronJobs] = useState(new Set<number>());
  const [cronCreatorMode, setCronCreatorMode] =
    useState<CronCreatorMode>("describe");
  const [cronCreatorOpen, setCronCreatorOpen] = useState(false);
  const [cronCreatorError, setCronCreatorError] = useState("");
  const [cronCreatorModel, setCronCreatorModel] = useState("");
  const [cronCreatorReasoningEffort, setCronCreatorReasoningEffort] =
    useState<RpcReasoningEffort>(defaultCodexReasoningEffort);
  const [cronDescribePrompt, setCronDescribePrompt] = useState("");
  const [cronEditTitle, setCronEditTitle] = useState("");
  const [cronEditDescription, setCronEditDescription] = useState("");
  const [cronEditSchedule, setCronEditSchedule] = useState("");
  const [cronEditPrompt, setCronEditPrompt] = useState("");
  const [cronEditEnabled, setCronEditEnabled] = useState(true);
  const [cronEditWebSearchAccess, setCronEditWebSearchAccess] = useState(true);
  const [cronEditGithubAccess, setCronEditGithubAccess] = useState(false);
  const [cronEditAgentsAccess, setCronEditAgentsAccess] = useState(false);
  const [cronEditMetidosAccess, setCronEditMetidosAccess] = useState(true);
  const [cronEditUnsafeMode, setCronEditUnsafeMode] = useState(false);
  const [cronEditingCronJobId, setCronEditingCronJobId] = useState<
    number | null
  >(null);
  const [isUpdatingThreadModel, setIsUpdatingThreadModel] = useState(false);
  const [isUpdatingThreadReasoningEffort, setIsUpdatingThreadReasoningEffort] =
    useState(false);
  const [isUpdatingThreadAccess, setIsUpdatingThreadAccess] = useState(false);
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
  const [threadAccessControlError, setThreadAccessControlError] = useState("");
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
  const defaultCodexModelRef = useRef(defaultCodexModel);
  const defaultCodexReasoningEffortRef = useRef(defaultCodexReasoningEffort);
  const isDesktopViewport = useDesktopViewport();
  const projects = useMemo(
    () => projectStoreItems(projectStore),
    [projectStore],
  );
  const threads = useMemo(() => threadStoreItems(threadStore), [threadStore]);
  const threadStoreRef = useRef(threadStore);

  useEffect(() => {
    threadStoreRef.current = threadStore;
  }, [threadStore]);

  const applyModelCatalog = useCallback(
    (modelCatalog: RpcModelCatalog): void => {
      const previousDefaultModel = defaultCodexModelRef.current;
      const previousDefaultReasoningEffort =
        defaultCodexReasoningEffortRef.current;
      defaultCodexModelRef.current = modelCatalog.defaultModel;
      defaultCodexReasoningEffortRef.current =
        modelCatalog.defaultReasoningEffort;

      setCodexModels(modelCatalog.models);
      setDefaultCodexModel(modelCatalog.defaultModel);
      setReasoningEfforts(modelCatalog.reasoningEfforts);
      setDefaultCodexReasoningEffort(modelCatalog.defaultReasoningEffort);
      setPendingThreadModel((current) =>
        !current || current === previousDefaultModel
          ? modelCatalog.defaultModel
          : current,
      );
      setPendingThreadReasoningEffort((current) =>
        current === previousDefaultReasoningEffort
          ? modelCatalog.defaultReasoningEffort
          : current,
      );
      setCronCreatorModel((current) =>
        !current || current === previousDefaultModel
          ? modelCatalog.defaultModel
          : current,
      );
      setCronCreatorReasoningEffort((current) =>
        current === previousDefaultReasoningEffort
          ? modelCatalog.defaultReasoningEffort
          : current,
      );
    },
    [],
  );

  const handleSidebarCollapsedChange = useCallback(
    (collapsed: boolean): void => {
      sidebarCollapsedRef.current = collapsed;
      setSidebarCollapsed(collapsed);
      // Keep in sync with persisted layout state so reloads restore preference.
      patchPersistedMainviewState({
        sidebarCollapsed: collapsed,
      });
    },
    [],
  );
  const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopSidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarScrollRef = useRef<HTMLElement | null>(null);
  const projectActionMenuRequestId = useRef(0);
  const persistedMainviewStateWriteTimeoutRef = useRef<number | null>(null);
  const pendingPersistedMainviewStateRef =
    useRef<PersistedMainviewState | null>(null);
  const flushPersistedMainviewStateWrite = useCallback((): void => {
    if (persistedMainviewStateWriteTimeoutRef.current !== null) {
      window.clearTimeout(persistedMainviewStateWriteTimeoutRef.current);
      persistedMainviewStateWriteTimeoutRef.current = null;
    }
    if (pendingPersistedMainviewStateRef.current === null) {
      return;
    }
    writePersistedMainviewState(pendingPersistedMainviewStateRef.current);
    pendingPersistedMainviewStateRef.current = null;
  }, []);
  const schedulePersistedMainviewStateWrite = useCallback(
    (nextState: PersistedMainviewState): void => {
      pendingPersistedMainviewStateRef.current = nextState;
      if (persistedMainviewStateWriteTimeoutRef.current !== null) {
        window.clearTimeout(persistedMainviewStateWriteTimeoutRef.current);
      }
      persistedMainviewStateWriteTimeoutRef.current = window.setTimeout(() => {
        flushPersistedMainviewStateWrite();
      }, MAINVIEW_STATE_WRITE_DEBOUNCE_MS);
    },
    [flushPersistedMainviewStateWrite],
  );

  const cronJobsRequestIdRef = useRef(0);
  const cronJobsAbortControllerRef = useRef<AbortController | null>(null);
  // Request/caching refs below track in-flight RPCs by key so refreshes can be
  // shared, cancelled, or ignored without extra state transitions.
  const activeWorktreeSyncAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const homeDirectoryPrefetchQueryRef = useRef<string | null>(null);
  const selectedThreadIdRef = useRef<number | null>(null);
  const selectedThreadHistoryCursorRef = useRef<number | null>(null);
  const selectedProjectIdRef = useRef<number | null>(
    initialMainviewState.selectedProjectId,
  );
  const selectedWorktreePathRef = useRef<string | null>(
    initialMainviewState.selectedWorktreePath,
  );
  const selectedThreadRunStateRef = useRef<RpcThreadRunStatus["state"]>("idle");
  const selectedThreadDetailRefreshKeyRef = useRef<string | null>(null);
  const optimisticallyAcknowledgedThreadIdsRef = useRef(new Set<number>());
  const threadErrorSeenRequestCacheRef = useRef(
    new Map<number, Promise<RpcThreadDetail>>(),
  );
  const threadHistoryBackfillAbortControllerRef =
    useRef<AbortController | null>(null);
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
        primaryWorktreePath(
          project,
          projectStateWorktrees(getProjectState(project.id)),
        );
      // Keep both refs and state aligned so all async handlers observe new selection.
      selectedProjectIdRef.current = project.id;
      selectedWorktreePathRef.current = nextWorktreePath;
      setSelectedProjectId(project.id);
      setSelectedWorktreePath(nextWorktreePath);
    },
    [getProjectState],
  );

  // Derive normalized UI state in one pass so child props stay internally
  // consistent and side panels share the same source of truth.
  const {
    activeChatError,
    activeChatNotice,
    activeCodexModel,
    activeContextInputTokens,
    activeContextWindowTokens,
    activeWebSearchAccess,
    activeGithubAccess,
    activeAgentsAccess,
    activeMetidosAccess,
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
    projectById,
    reasoningEffortSelectorDisabled,
    selectedDiffFileChange,
    selectedProject,
    selectedThread,
    selectedThreadIsWorking,
    threadActionMenuThread,
    threadAccessControlDisabled,
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
    worktreeSearchTextByKey,
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
    isSending,
    isStoppingThread,
    isThreadLoading,
    isUpdatingThreadModel,
    isUpdatingThreadReasoningEffort,
    isUpdatingThreadAccess,
    pendingThreadWebSearchAccess,
    pendingThreadGithubAccess,
    pendingThreadAgentsAccess,
    pendingThreadMetidosAccess,
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

  const {
    closeGitHistoryModal,
    gitHistoryModal,
    loadMoreGitHistory,
    openGitHistoryDiff,
    primeGitHistoryResult,
  } = useGitHistoryController({
    activeSelectedWorktreePath,
    gitHistory,
    gitHistoryLoading,
    gitHistoryLoadingMore,
    procedures,
    selectedProject,
    selectedThread,
    sessionStateReady,
    setGitHistory,
    setGitHistoryError,
    setGitHistoryLoading,
    setGitHistoryLoadingMore,
  });

  const activeThreadAccessValue: ThreadAccessValue = {
    webSearchAccess: activeWebSearchAccess,
    githubAccess: activeGithubAccess,
    agentsAccess: activeAgentsAccess,
    metidosAccess: activeMetidosAccess,
    unsafeMode: activeUnsafeMode,
  };
  const safeChildAccessDefaults = deriveSafeChildAccessDefaults(
    activeThreadAccessValue,
  );
  const {
    closeStepUpDialog,
    executeWithStepUp,
    isSubmittingStepUp,
    stepUpActionLabel,
    stepUpDialogOpen,
    stepUpError,
    stepUpPrimaryFactor,
    stepUpTotpCode,
    submitStepUp,
    updateStepUpPrimaryFactor,
    updateStepUpTotpCode,
  } = useStepUpController({
    primaryFactorType,
    stepUpAuth,
  });
  const {
    activeThreadExtensionStatuses,
    activeThreadExtensionUiState,
    activeThreadExtensionWidgetsAbove,
    activeThreadExtensionWidgetsBelow,
    currentThreadExtensionUiDialog,
    dismissNotification,
    respondToCurrentThreadExtensionUiDialog,
    syncThreadExtensionEditor,
    threadExtensionUiDialogBusy,
    threadExtensionUiDialogDraft,
    threadExtensionUiDialogError,
    threadExtensionUiNotifications,
    updateThreadExtensionUiDialogDraft: setThreadExtensionUiDialogDraft,
  } = useThreadExtensionUiController({
    activeScreenTitle,
    initialChatInput: initialMainviewState.chatInput,
    procedures,
    selectedThreadId,
  });
  const {
    closeDesktopThreadSwitcher,
    desktopPinnedThreads,
    desktopThreadSwitcherAnchorId,
    desktopThreadSwitcherOpen,
    desktopThreadSwitcherSearchQuery,
    desktopThreadSwitcherSections,
    handleToggleDesktopThreadSwitcher,
    setDesktopThreadSwitcherSearchQuery,
    worktreeLabel,
    worktreeSubtitle,
  } = useDesktopThreadSwitcher({
    activeSelectedWorktree,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreeName,
    activeSelectedWorktreePath,
    homeDirectory,
    isDesktopViewport,
    selectedProject,
    sidebarCollapsed,
    threads,
  });

  // Request queue handling: show and resolve the oldest pending thread-start request
  // first so users always act on the oldest queued action.
  const currentThreadStartRequest = pendingThreadStartRequests[0] ?? null;
  const currentThreadStartRequestProject =
    currentThreadStartRequest === null
      ? null
      : (projectById.get(currentThreadStartRequest.projectId) ?? null);
  const currentThreadStartRequestWorkspace = currentThreadStartRequest
    ? formatDirectoryPathForInput(
        currentThreadStartRequest.worktreePath,
        homeDirectory,
        supportsTildePath,
      )
    : "";
  const currentThreadStartRequestModelOption = useMemo(() => {
    if (!currentThreadStartRequest) {
      return null;
    }
    return findCodexModel(
      codexModels,
      currentThreadStartRequest.model ?? defaultCodexModel,
    );
  }, [codexModels, currentThreadStartRequest, defaultCodexModel]);
  const currentThreadStartRequestModelLabel =
    currentThreadStartRequestModelOption
      ? currentThreadStartRequest?.model
        ? codexModelSelectorLabel(currentThreadStartRequestModelOption)
        : `Default (${codexModelSelectorLabel(currentThreadStartRequestModelOption)})`
      : (currentThreadStartRequest?.model ?? "default");
  const currentThreadStartRequestReasoningOption = currentThreadStartRequest
    ? findReasoningEffortOption(
        reasoningEfforts,
        currentThreadStartRequest.reasoningEffort ??
          defaultCodexReasoningEffort,
      )
    : null;
  const currentThreadStartRequestThinkingLabel =
    currentThreadStartRequestReasoningOption
      ? currentThreadStartRequest?.reasoningEffort
        ? currentThreadStartRequestReasoningOption.label
        : `Default (${currentThreadStartRequestReasoningOption.label})`
      : (currentThreadStartRequest?.reasoningEffort ?? "default");

  // Maintain a compact set of acknowledged-completed thread IDs to avoid
  // recomputing this visual state from full thread objects.
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

      return threadStore.byId[threadId]?.runStatus.state === "working"
        ? "working"
        : "none";
    },
    [completedThreadIndicatorIds, threadStore],
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

  const replaceProjects = useCallback((items: RpcProject[]): void => {
    setProjectStore(createProjectStore(items));
  }, []);

  const upsertProject = useCallback((project: RpcProject): void => {
    setProjectStore((prev) => upsertProjectStore(prev, project));
  }, []);

  const replaceThreads = useCallback((items: RpcThread[]): void => {
    setThreadStore((_current) => {
      const next = createThreadStore(items);
      threadStoreRef.current = next;
      return next;
    });
  }, []);

  const upsertThread = useCallback((thread: RpcThread): void => {
    setThreadStore((prev) => {
      const next = upsertThreadStore(prev, thread);
      threadStoreRef.current = next;
      return next;
    });
  }, []);

  const removeThread = useCallback((threadId: number): void => {
    setThreadStore((prev) => {
      const next = removeThreadFromStore(prev, threadId);
      threadStoreRef.current = next;
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
    setProjectState,
    supportsTildePath,
    upsertProject,
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

  const { ensureWorktreeOpen, loadProjectWorktrees } =
    useProjectWorktreeController({
      activeSelectedWorktreePath,
      getProjectState,
      getWorktreeState,
      primeGitHistoryResult,
      procedures,
      selectProject,
      selectedProject,
      selectedProjectId,
      selectedProjectIdRef,
      selectedThread,
      selectedThreadIdRef,
      selectedWorktreePathRef,
      sessionStateReady,
      setProjectState,
      setSelectedWorktreePath,
      setThreadsError,
      setWorktreeState,
      setWorktreeStates,
      upsertProject,
    });

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

  const abortCronJobsRequest = useCallback((reason: string) => {
    const controller = cronJobsAbortControllerRef.current;
    if (!controller) {
      return;
    }

    cronJobsAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const loadCronJobs = useCallback(
    async (options?: { background?: boolean }): Promise<void> => {
      if (isLoadingCronJobs) {
        return;
      }

      const isBackgroundRefresh = options?.background === true;
      const requestId = ++cronJobsRequestIdRef.current;
      abortCronJobsRequest("Cron job request was superseded.");
      const controller = new AbortController();
      cronJobsAbortControllerRef.current = controller;
      if (!isBackgroundRefresh || cronJobs.length === 0) {
        setIsLoadingCronJobs(true);
      }
      if (!isBackgroundRefresh) {
        setCronJobsError("");
      }

      try {
        const result = await procedures.listCrons(undefined, {
          priority: isBackgroundRefresh ? "background" : "foreground",
          signal: controller.signal,
        });
        if (cronJobsRequestIdRef.current !== requestId) {
          return;
        }
        setCronJobs(result);
        setCronJobsError("");
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (cronJobsRequestIdRef.current !== requestId) {
          return;
        }
        if (cronJobs.length === 0) {
          setCronJobs([]);
        }
        setCronJobsError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (cronJobsAbortControllerRef.current === controller) {
          cronJobsAbortControllerRef.current = null;
        }
        if (cronJobsRequestIdRef.current === requestId) {
          setIsLoadingCronJobs(false);
        }
      }
    },
    [abortCronJobsRequest, cronJobs.length, isLoadingCronJobs, procedures],
  );

  const primeCronJobs = useCallback(() => {
    void loadCronJobs();
  }, [loadCronJobs]);

  const abortThreadHistoryBackfill = useCallback((reason: string) => {
    selectedThreadHistoryCursorRef.current = null;
    const controller = threadHistoryBackfillAbortControllerRef.current;
    if (!controller) {
      return;
    }

    threadHistoryBackfillAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const startThreadHistoryBackfill = useCallback(
    (threadId: number, initialCursor: number | null) => {
      abortThreadHistoryBackfill("Thread history backfill was superseded.");
      selectedThreadHistoryCursorRef.current = initialCursor;
      if (initialCursor === null) {
        return;
      }

      const controller = new AbortController();
      threadHistoryBackfillAbortControllerRef.current = controller;
      void (async () => {
        let nextCursor: number | null = initialCursor;
        let backfilledMessages: RpcThreadMessage[] = [];
        while (nextCursor !== null) {
          const detail = await procedures.getThread(
            {
              threadId,
              cursor: nextCursor,
            },
            {
              priority: "default",
              signal: controller.signal,
            },
          );
          if (selectedThreadIdRef.current !== threadId) {
            return;
          }

          backfilledMessages = mergeThreadMessageHistory(
            backfilledMessages,
            detail.messages,
          );
          nextCursor =
            detail.nextCursor === nextCursor ? null : detail.nextCursor;
          selectedThreadHistoryCursorRef.current = nextCursor;
        }

        if (
          backfilledMessages.length > 0 &&
          selectedThreadIdRef.current === threadId
        ) {
          // Commit the full accumulated history backfill once so large threads do not
          // repeatedly reflow and repaint while pagination is still in flight.
          setThreadMessages((current) =>
            mergeThreadMessageHistory(current, backfilledMessages),
          );
        }
      })()
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          console.error(
            `Failed to backfill thread history for thread ${threadId}`,
            error,
          );
        })
        .finally(() => {
          if (threadHistoryBackfillAbortControllerRef.current === controller) {
            threadHistoryBackfillAbortControllerRef.current = null;
          }
        });
    },
    [abortThreadHistoryBackfill, procedures],
  );

  const replaceSelectedThreadMessageHistory = useCallback(
    (detail: RpcThreadDetail) => {
      selectedThreadDetailRefreshKeyRef.current =
        buildSelectedThreadDetailRefreshKey(detail.thread);
      setThreadMessages(detail.messages);
      startThreadHistoryBackfill(detail.thread.id, detail.nextCursor);
    },
    [startThreadHistoryBackfill],
  );

  const mergeSelectedThreadMessageHistory = useCallback(
    (detail: RpcThreadDetail) => {
      selectedThreadDetailRefreshKeyRef.current =
        buildSelectedThreadDetailRefreshKey(detail.thread);
      setThreadMessages((current) =>
        mergeThreadMessageHistory(current, detail.messages),
      );
    },
    [],
  );

  const discardThreadIfEmpty = useCallback(
    async (threadId: number): Promise<void> => {
      try {
        const result = await procedures.discardEmptyThread({ threadId });
        if (!result.discarded) {
          return;
        }
        removeThread(result.threadId);
      } catch (error) {
        console.error(`Failed to discard empty thread ${threadId}`, error);
      }
    },
    [procedures, removeThread],
  );

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

  const applyOptimisticThreadErrorSeenToStore = useCallback(
    (store: ThreadStore): ThreadStore => {
      if (optimisticallyAcknowledgedThreadIdsRef.current.size === 0) {
        return store;
      }

      let nextStore = store;
      for (const thread of threadStoreItems(store)) {
        const nextThread = applyOptimisticThreadErrorSeen(thread);
        if (nextThread !== thread) {
          nextStore = upsertThreadStore(nextStore, nextThread);
        }
      }

      return nextStore;
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
      setThreadStore((prev) => applyOptimisticThreadErrorSeenToStore(prev));
      void requestThreadErrorSeen(threadId)
        .then((detail) => {
          optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);

          const settledDetail = applyOptimisticThreadErrorSeenToDetail(detail);
          setThreadStore((prev) =>
            prev.byId[settledDetail.thread.id]
              ? upsertThreadStore(prev, settledDetail.thread)
              : prev,
          );
          if (selectedThreadIdRef.current === threadId) {
            selectedThreadRunStateRef.current =
              settledDetail.thread.runStatus.state;
            mergeSelectedThreadMessageHistory(settledDetail);
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
      applyOptimisticThreadErrorSeenToStore,
      mergeSelectedThreadMessageHistory,
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

  const {
    approveThreadStartRequest,
    clearThreadSelection,
    createThreadForWorktree,
    dismissThreadStartRequest,
    handleProjectWorktreeClick,
    openThread,
  } = useThreadWorkspaceSelectionController({
    abortThreadHistoryBackfill,
    activeCodexModel,
    activeReasoningEffort,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    ensureWorktreeOpen,
    executeWithStepUp,
    getProjectState,
    getWorktreeState,
    isApprovingThreadStartRequest,
    isThreadLoading,
    loadProjectWorktrees,
    prepareOpenedThreadDetail,
    procedures,
    replaceSelectedThreadMessageHistory,
    safeChildAccessDefaults,
    selectProject,
    selectedProjectId,
    selectedProjectIdRef,
    selectedThread,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadId,
    selectedThreadIdRef,
    selectedThreadRunStateRef,
    selectedWorktreePathRef,
    sessionStateReady,
    setChatError,
    setIsApprovingThreadStartRequest,
    setIsCreatingThread,
    setIsThreadLoading,
    setMobileProjectListOpen,
    setModelControlError,
    setPendingThreadStartRequests,
    setPrimaryView,
    setProjectState,
    setReasoningEffortControlError,
    setSelectedProjectId,
    setSelectedThreadId,
    setSelectedWorktreePath,
    setThreadAccessControlError,
    setThreadMessages,
    setThreadsError,
    setThreadStartRequestError,
    threadStoreRef,
    threads,
    upsertProject,
    upsertThread,
  });

  useMainviewStartupController({
    applyModelCatalog,
    getProjectState,
    hydrateProjectRows,
    initialMainviewState,
    openThread,
    prefetchDirectorySuggestions,
    primeGitHistoryResult,
    procedures,
    replaceProjects,
    replaceThreads,
    seedAddProjectPath,
    selectedProjectIdRef,
    selectedWorktreePathRef,
    setHomeDirectory,
    setProjectState,
    setProjectStates,
    setSelectedProjectId,
    setSelectedWorktreePath,
    setSessionStateReady,
    setSupportsTildePath,
    setThreadsError,
    setWorktreeState,
  });

  const closeProjectActionMenu = useCallback(() => {
    setProjectActionMenu(null);
    setProjectActionMenuError("");
    setProjectActionMenuHiddenWorktreePath("");
    setProjectActionMenuHiddenWorktrees([]);
    setNewWorktreeName("");
    setIsOpeningHiddenWorktree(false);
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
        y: clampProjectMenuCoordinate(y, viewportHeight, 520),
      });
      setProjectActionMenuError("");
      setProjectActionMenuHiddenWorktreePath("");
      setProjectActionMenuHiddenWorktrees([]);
      setNewWorktreeName("");
      setIsOpeningHiddenWorktree(false);

      try {
        const result = await procedures.listProjectWorktrees(
          {
            includeHidden: true,
            projectId: project.id,
          },
          {
            priority: "foreground",
          },
        );
        if (projectActionMenuRequestId.current !== requestId) {
          return;
        }
        setProjectState(
          project.id,
          buildLoadedProjectWorktreesState(result.worktrees),
        );
        setProjectActionMenuHiddenWorktrees(result.hiddenWorktrees);
        setProjectActionMenuHiddenWorktreePath(
          result.hiddenWorktrees[0]?.path ?? "",
        );
      } catch (error) {
        if (projectActionMenuRequestId.current === requestId) {
          setProjectActionMenuError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
    [closeThreadActionMenu, procedures, setProjectState],
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
      const removedProjectPath = projectStore.byId[projectId]?.path ?? null;
      try {
        const deletedProject = await executeWithStepUp(
          "delete this project",
          () => procedures.deleteProject({ projectId }),
        );
        if (!deletedProject) {
          return;
        }
        const [loaded, loadedThreads] = await Promise.all([
          procedures.listProjects({ includeClosed: true }),
          procedures.listThreads(),
        ]);
        replaceProjects(loaded);
        replaceThreads(loadedThreads);
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
      executeWithStepUp,
      hydrateProjectRows,
      openThread,
      projectStore,
      procedures,
      projectActionMenu,
      replaceProjects,
      replaceThreads,
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
        setProjectState(
          projectId,
          buildLoadedProjectWorktreesState(result.worktrees),
        );
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
        upsertThread(updatedThread);
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
      upsertThread,
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
      upsertThread(updatedThread);
    } catch (error) {
      setThreadActionMenuError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setThreadActionBusy(null);
    }
  }, [procedures, threadActionBusy, threadActionMenuThread, upsertThread]);

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
      removeThread(threadActionMenuThread.id);
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
    removeThread,
    selectedThreadId,
    threadActionBusy,
    threadActionMenuThread,
  ]);

  const submitNewWorktree = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !projectActionMenu ||
        isCreatingWorktree ||
        isOpeningHiddenWorktree ||
        worktreePinBusyPath
      ) {
        return;
      }

      const name = newWorktreeName.trim();
      if (!name) {
        setProjectActionMenuError("Enter a subproject name.");
        return;
      }

      setIsCreatingWorktree(true);
      setProjectActionMenuError("");
      try {
        const result = await procedures.createWorktree({
          projectId: projectActionMenu.projectId,
          name,
        });
        setProjectState(
          projectActionMenu.projectId,
          buildLoadedProjectWorktreesState(result.worktrees),
        );
        clearThreadSelection();
        selectProject(result.project, result.worktreePath);
        closeProjectActionMenu();
        void ensureWorktreeOpen(result.project.id, result.worktreePath);
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
      clearThreadSelection,
      closeProjectActionMenu,
      ensureWorktreeOpen,
      isCreatingWorktree,
      isOpeningHiddenWorktree,
      newWorktreeName,
      procedures,
      projectActionMenu,
      selectProject,
      setProjectState,
      worktreePinBusyPath,
    ],
  );

  const openHiddenProjectWorktree = useCallback(async () => {
    if (
      !projectActionMenu ||
      !projectActionMenuHiddenWorktreePath ||
      isCreatingWorktree ||
      isOpeningHiddenWorktree ||
      worktreePinBusyPath
    ) {
      return;
    }

    const project = projectStore.byId[projectActionMenu.projectId] ?? null;
    if (!project) {
      setProjectActionMenuError("Project no longer exists.");
      return;
    }

    setIsOpeningHiddenWorktree(true);
    setProjectActionMenuError("");
    try {
      await ensureWorktreeOpen(project.id, projectActionMenuHiddenWorktreePath);
      clearThreadSelection();
      selectProject(project, projectActionMenuHiddenWorktreePath);
      closeProjectActionMenu();
    } catch (error) {
      setProjectActionMenuError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsOpeningHiddenWorktree(false);
    }
  }, [
    clearThreadSelection,
    closeProjectActionMenu,
    ensureWorktreeOpen,
    isCreatingWorktree,
    isOpeningHiddenWorktree,
    projectActionMenu,
    projectActionMenuHiddenWorktreePath,
    projectStore.byId,
    selectProject,
    worktreePinBusyPath,
  ]);

  useEffect(() => {
    if (!projectActionMenu) {
      return;
    }

    /**
     * Handles pointer down.
     * @param event - event value.
     */

    const handlePointerDown = (event: MouseEvent) => {
      if (
        projectActionMenuRef.current &&
        !projectActionMenuRef.current.contains(event.target as Node)
      ) {
        closeProjectActionMenu();
      }
    };

    /**
     * Handles key down.
     * @param event - event value.
     */

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

    /**
     * Handles pointer down.
     * @param event - event value.
     */

    const handlePointerDown = (event: MouseEvent) => {
      if (
        threadActionMenuRef.current &&
        !threadActionMenuRef.current.contains(event.target as Node)
      ) {
        closeThreadActionMenu();
      }
    };

    /**
     * Handles key down.
     * @param event - event value.
     */

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
        // Ignore sync failures here; active worktree state refreshes on next poll/selection.
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

  const persistedMainviewState = useMemo<PersistedMainviewState | null>(() => {
    if (!sessionStateReady) {
      return null;
    }

    return {
      version: MAINVIEW_STATE_STORAGE_VERSION,
      selectedProjectId,
      selectedWorktreePath,
      selectedThreadId,
      pendingThreadModel,
      pendingThreadReasoningEffort,
      pendingThreadWebSearchAccess,
      pendingThreadGithubAccess,
      pendingThreadAgentsAccess,
      pendingThreadMetidosAccess,
      pendingThreadUnsafeMode,
      chatInput: "",
      sidebarCollapsed,
      sidebarSearchQuery,
      openWorktrees: serializeOpenWorktrees(projectStates),
    };
  }, [
    pendingThreadModel,
    pendingThreadReasoningEffort,
    pendingThreadWebSearchAccess,
    pendingThreadGithubAccess,
    pendingThreadAgentsAccess,
    pendingThreadMetidosAccess,
    pendingThreadUnsafeMode,
    projectStates,
    selectedProjectId,
    selectedThreadId,
    selectedWorktreePath,
    sessionStateReady,
    sidebarCollapsed,
    sidebarSearchQuery,
  ]);

  useEffect(() => {
    if (persistedMainviewState === null) {
      return;
    }

    schedulePersistedMainviewStateWrite(persistedMainviewState);
  }, [persistedMainviewState, schedulePersistedMainviewStateWrite]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }

    const flushPendingPersistedState = (): void => {
      flushPersistedMainviewStateWrite();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== "visible") {
        flushPersistedMainviewStateWrite();
      }
    };

    window.addEventListener("beforeunload", flushPendingPersistedState);
    window.addEventListener("pagehide", flushPendingPersistedState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushPendingPersistedState);
      window.removeEventListener("pagehide", flushPendingPersistedState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPersistedMainviewStateWrite();
    };
  }, [flushPersistedMainviewStateWrite, sessionStateReady]);

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
    setPendingThreadWebSearchAccess(selectedThread.webSearchAccess);
    setPendingThreadGithubAccess(selectedThread.githubAccess);
    setPendingThreadAgentsAccess(selectedThread.agentsAccess);
    setPendingThreadMetidosAccess(selectedThread.metidosAccess);
    setPendingThreadUnsafeMode(selectedThread.unsafeMode);
    setThreadAccessControlError("");
  }, [selectedThread]);

  useEffect(() => {
    /**
     * Handles thread start request created.
     * @param event - event value.
     */

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
    const handleThreadStatusChanged = (event: CustomEvent<RpcThread>) => {
      setThreadStore((current) => upsertThreadStore(current, event.detail));
    };

    window.addEventListener(
      THREAD_STATUS_CHANGED_EVENT_NAME,
      handleThreadStatusChanged,
    );
    return () => {
      window.removeEventListener(
        THREAD_STATUS_CHANGED_EVENT_NAME,
        handleThreadStatusChanged,
      );
    };
  }, []);

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
      abortCronJobsRequest("Cron job request was canceled.");
    };
  }, [abortCronJobsRequest]);

  useEffect(() => {
    if (primaryView !== "cronjobs" || !isDocumentVisible) {
      return;
    }

    void loadCronJobs({ background: cronJobs.length > 0 });
    const timer = window.setInterval(() => {
      void loadCronJobs({ background: true });
    }, THREAD_STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [cronJobs.length, isDocumentVisible, loadCronJobs, primaryView]);

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
        upsertThread(updatedThread);
        setPendingThreadModel(updatedThread.model);
      } catch (error) {
        setModelControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadModel(false);
      }
    },
    [isUpdatingThreadModel, procedures, selectedThread, upsertThread],
  );

  const updateActiveReasoningEffort = useCallback(
    async (reasoningEffort: RpcReasoningEffort) => {
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
        upsertThread(updatedThread);
        setPendingThreadReasoningEffort(updatedThread.reasoningEffort);
      } catch (error) {
        setReasoningEffortControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadReasoningEffort(false);
      }
    },
    [isUpdatingThreadReasoningEffort, procedures, selectedThread, upsertThread],
  );

  const updateActiveThreadAccess = useCallback(
    async (access: ThreadAccessValue) => {
      setThreadAccessControlError("");

      if (!selectedThread) {
        setPendingThreadWebSearchAccess(access.webSearchAccess);
        setPendingThreadGithubAccess(access.githubAccess);
        setPendingThreadAgentsAccess(access.agentsAccess);
        setPendingThreadMetidosAccess(access.metidosAccess);
        setPendingThreadUnsafeMode(access.unsafeMode);
        return;
      }

      if (
        (selectedThread.webSearchAccess === access.webSearchAccess &&
          selectedThread.githubAccess === access.githubAccess &&
          selectedThread.agentsAccess === access.agentsAccess &&
          selectedThread.metidosAccess === access.metidosAccess &&
          selectedThread.unsafeMode === access.unsafeMode) ||
        isUpdatingThreadAccess
      ) {
        return;
      }

      setIsUpdatingThreadAccess(true);
      try {
        const updatedThread = await procedures.updateThreadAccess({
          threadId: selectedThread.id,
          webSearchAccess: access.webSearchAccess,
          githubAccess: access.githubAccess,
          agentsAccess: access.agentsAccess,
          metidosAccess: access.metidosAccess,
          unsafeMode: access.unsafeMode,
        });
        upsertThread(updatedThread);
        setPendingThreadWebSearchAccess(updatedThread.webSearchAccess);
        setPendingThreadGithubAccess(updatedThread.githubAccess);
        setPendingThreadAgentsAccess(updatedThread.agentsAccess);
        setPendingThreadMetidosAccess(updatedThread.metidosAccess);
        setPendingThreadUnsafeMode(updatedThread.unsafeMode);
      } catch (error) {
        setThreadAccessControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadAccess(false);
      }
    },
    [isUpdatingThreadAccess, procedures, selectedThread, upsertThread],
  );

  const handleCreateThreadForActiveWorktree = useCallback(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return;
    }
    void createThreadForWorktree(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
  }, [activeSelectedWorktreePath, createThreadForWorktree, selectedProject]);

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
  const handleOpenPinnedThread = useCallback(
    (threadId: number): void => {
      setPrimaryView((current) =>
        derivePrimaryViewForPinnedThreadOpen(current),
      );
      handleOpenThread(threadId);
    },
    [handleOpenThread],
  );
  const handleOpenThreadFromDesktopThreadSwitcher = useCallback(
    (threadId: number): void => {
      closeDesktopThreadSwitcher(false);
      handleOpenThread(threadId);
    },
    [closeDesktopThreadSwitcher, handleOpenThread],
  );
  const handleCreateThreadFromDesktopThreadSwitcher = useCallback((): void => {
    closeDesktopThreadSwitcher(false);
    handleCreateThreadForActiveWorktree();
  }, [closeDesktopThreadSwitcher, handleCreateThreadForActiveWorktree]);

  const handleLoadMoreGitHistory = useCallback(() => {
    void loadMoreGitHistory();
  }, [loadMoreGitHistory]);

  const handleOpenGitHistoryDiff = useCallback(
    (entry: RpcGitHistoryEntry) => {
      void openGitHistoryDiff(entry);
    },
    [openGitHistoryDiff],
  );

  const postMessage = useCallback(() => {
    const text = readChatComposerDraft(initialMainviewState.chatInput).trim();
    if (!text || isSending || selectedThreadIsWorking) {
      return;
    }
    if (!selectedThreadId) {
      setChatError("Create or select a thread before sending a message.");
      return;
    }

    const sendingThreadId = selectedThreadId;
    const pendingInput = text;
    setIsSending(true);
    setChatError("");
    setChatComposerDraft("");
    void (async () => {
      try {
        const detail = await procedures.sendThreadMessage({
          threadId: sendingThreadId,
          input: pendingInput,
        });
        upsertThread(detail.thread);
        if (
          shouldApplySentThreadDetailToSelection({
            detail,
            requestedThreadId: sendingThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          selectedThreadRunStateRef.current = detail.thread.runStatus.state;
          mergeSelectedThreadMessageHistory(detail);
        }
      } catch (error) {
        if (
          shouldApplyThreadSendFailureToSelection({
            requestedThreadId: sendingThreadId,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          setChatError(error instanceof Error ? error.message : String(error));
          if (!readChatComposerDraft()) {
            setChatComposerDraft(pendingInput);
          }
        } else {
          console.error(
            `Failed to send message for stale thread selection ${sendingThreadId}`,
            error,
          );
        }
      } finally {
        setIsSending(false);
      }
    })();
  }, [
    initialMainviewState.chatInput,
    isSending,
    mergeSelectedThreadMessageHistory,
    procedures,
    selectedThreadId,
    selectedThreadIsWorking,
    upsertThread,
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
        upsertThread(detail.thread);
        if (selectedThreadIdRef.current === detail.thread.id) {
          selectedThreadRunStateRef.current = detail.thread.runStatus.state;
          mergeSelectedThreadMessageHistory(detail);
        }
      } catch (error) {
        setChatError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsStoppingThread(false);
      }
    })();
  }, [
    isStoppingThread,
    mergeSelectedThreadMessageHistory,
    procedures,
    selectedThreadId,
    selectedThreadIsWorking,
    upsertThread,
  ]);

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

  const visibleMessages = useVisibleMessages({
    activeChatError,
    activeChatNotice,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreePath,
    activeThreadWorkingMessage: activeThreadExtensionUiState?.workingMessage,
    isThreadLoading,
    selectedProject,
    selectedThread,
    selectedThreadId,
    threadMessages,
  });

  const sidebarActionButtonClass =
    "flex h-6 w-6 shrink-0 items-center justify-center border border-[#2f3b43] bg-[#182026] text-[#9db9cb] transition-colors hover:border-[#435561] hover:bg-[#212b31] hover:text-[#dfebf3] disabled:cursor-not-allowed disabled:opacity-50";
  const selectedThreadContextBranchLabel =
    activeSelectedWorktree?.branch?.trim() || "Primary";
  const selectedThreadContextPathLabel = activeSelectedWorktreePath
    ? activeScreenSubtitleSecondary
    : activeSelectedWorktreeFolder || "No worktree selected";
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

  const handleShowCronjobs = useCallback(() => {
    setPrimaryView("cronjobs");
    primeCronJobs();
  }, [primeCronJobs]);

  const openCronThreadInRecent = useCallback(
    async (threadId: number): Promise<void> => {
      setWorkspacePanelOpen(true);
      setWorkspaceActiveSectionOpen(true);

      const detailPromise = procedures.getThread(
        { threadId },
        {
          priority: "foreground",
        },
      );
      const loadedThreads = await procedures.listThreads();
      replaceThreads(loadedThreads);

      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }

        window.requestAnimationFrame(() => resolve());
      });

      setPrimaryView("chat");
      await openThread(threadId, {
        detailPromise,
      });
    },
    [openThread, procedures, replaceThreads],
  );

  const handleRunCronNow = useCallback(
    (cronJobId: number) => {
      void (async () => {
        setRunningCronJobs((current) => {
          if (current.has(cronJobId)) {
            return current;
          }
          const next = new Set(current);
          next.add(cronJobId);
          return next;
        });
        setCronJobsError("");

        try {
          const result = await procedures.runCronNow({ cronJobId });
          if (!result.success) {
            throw new Error(`Cron job ${cronJobId} did not start.`);
          }
          await openCronThreadInRecent(result.threadId);
          await loadCronJobs();
        } catch (error) {
          setCronJobsError(
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          setRunningCronJobs((current) => {
            if (!current.has(cronJobId)) {
              return current;
            }
            const next = new Set(current);
            next.delete(cronJobId);
            return next;
          });
        }
      })();
    },
    [loadCronJobs, openCronThreadInRecent, procedures],
  );

  const handleDeleteCron = useCallback(
    (cronJob: RpcCronJob) => {
      if (deletingCronJobs.has(cronJob.id)) {
        return;
      }

      const cronLabel = cronJob.title.trim()
        ? `"${cronJob.title.trim()}"`
        : `#${cronJob.id}`;
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Delete cron job ${cronLabel}? This disables the cron and keeps its run history.`,
        )
      ) {
        return;
      }

      void (async () => {
        setDeletingCronJobs((current) => {
          if (current.has(cronJob.id)) {
            return current;
          }
          const next = new Set(current);
          next.add(cronJob.id);
          return next;
        });
        setCronJobsError("");

        try {
          await procedures.updateCron({
            cronJobId: cronJob.id,
            deleted: true,
          });
          setCronJobs((current) =>
            current.filter((entry) => entry.id !== cronJob.id),
          );
          if (cronEditingCronJobId === cronJob.id) {
            setCronCreatorOpen(false);
            setCronCreatorError("");
            setCronEditingCronJobId(null);
          }
          void loadCronJobs();
        } catch (error) {
          setCronJobsError(
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          setDeletingCronJobs((current) => {
            if (!current.has(cronJob.id)) {
              return current;
            }
            const next = new Set(current);
            next.delete(cronJob.id);
            return next;
          });
        }
      })();
    },
    [cronEditingCronJobId, deletingCronJobs, loadCronJobs, procedures],
  );

  const refreshCronJobsForDescribeCron = useCallback(async () => {
    await loadCronJobs();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(() => {
          resolve();
        }, 1_200);
      });
      await loadCronJobs();
    }
  }, [loadCronJobs]);

  const resetCronCreatorFields = useCallback(() => {
    setCronEditingCronJobId(null);
    setCronDescribePrompt("");
    setCronEditTitle("");
    setCronEditDescription("");
    setCronEditSchedule("");
    setCronEditPrompt("");
    setCronEditEnabled(true);
    setCronEditWebSearchAccess(safeChildAccessDefaults.webSearchAccess);
    setCronEditGithubAccess(safeChildAccessDefaults.githubAccess);
    setCronEditAgentsAccess(safeChildAccessDefaults.agentsAccess);
    setCronEditMetidosAccess(safeChildAccessDefaults.metidosAccess);
    setCronEditUnsafeMode(safeChildAccessDefaults.unsafeMode);
    setCronCreatorModel(activeCodexModel || defaultCodexModel || "");
    setCronCreatorReasoningEffort(
      activeReasoningEffort || defaultCodexReasoningEffort,
    );
    setCronCreatorError("");
  }, [
    activeCodexModel,
    activeReasoningEffort,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    safeChildAccessDefaults,
  ]);

  const openCronCreator = useCallback(
    (mode: CronCreatorMode = "describe") => {
      setCronCreatorMode(mode);
      resetCronCreatorFields();
      setCronCreatorOpen(true);
    },
    [resetCronCreatorFields],
  );

  const openCronEditor = useCallback((cronJob: RpcCronJob) => {
    setCronCreatorMode("edit");
    setCronEditingCronJobId(cronJob.id);
    setCronDescribePrompt("");
    setCronEditTitle(cronJob.title);
    setCronEditDescription(cronJob.description);
    setCronEditSchedule(cronJob.schedule);
    setCronEditPrompt(cronJob.prompt);
    setCronEditEnabled(cronJob.enabled === 1);
    setCronEditWebSearchAccess(cronJob.webSearchAccess);
    setCronEditGithubAccess(cronJob.githubAccess);
    setCronEditAgentsAccess(cronJob.agentsAccess);
    setCronEditMetidosAccess(cronJob.metidosAccess);
    setCronEditUnsafeMode(cronJob.unsafeMode);
    setCronCreatorModel(cronJob.model);
    setCronCreatorReasoningEffort(cronJob.reasoningEffort);
    setCronCreatorError("");
    setCronCreatorOpen(true);
  }, []);

  const closeCronCreator = useCallback(() => {
    setCronCreatorOpen(false);
    setCronCreatorError("");
    setCronEditingCronJobId(null);
  }, []);

  const setCronCreatorReasoningEffortValue = useCallback(
    (nextReasoningEffort: RpcReasoningEffort) => {
      setCronCreatorReasoningEffort(nextReasoningEffort);
    },
    [],
  );

  const handleDescribeCronSubmit = useCallback(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      setCronCreatorError("Select a workspace before creating a cron job.");
      return;
    }

    const describePrompt = cronDescribePrompt.trim();
    if (!describePrompt) {
      setCronCreatorError("Describe the cron you want to create.");
      return;
    }

    const model = cronCreatorModel.trim()
      ? cronCreatorModel.trim()
      : activeCodexModel || defaultCodexModel || null;
    const reasoningEffort =
      cronCreatorReasoningEffort || defaultCodexReasoningEffort;

    setIsCreatingCronJob(true);
    setCronCreatorError("");

    void (async () => {
      let createdDetail: RpcThreadDetail | null = null;
      try {
        createdDetail = await executeWithStepUp(
          "create a thread outside the current workspace",
          () =>
            procedures.createThread({
              projectId: selectedProject.id,
              worktreePath: activeSelectedWorktreePath,
              currentProjectId: selectedProjectIdRef.current,
              currentWorktreePath: selectedWorktreePathRef.current,
              model,
              reasoningEffort:
                reasoningEffort || defaultCodexReasoningEffort || null,
              webSearchAccess: cronEditWebSearchAccess,
              githubAccess: cronEditGithubAccess,
              agentsAccess: cronEditAgentsAccess,
              metidosAccess: cronEditMetidosAccess,
              unsafeMode: cronEditUnsafeMode,
            }),
        );
        if (!createdDetail) {
          return;
        }

        const threadId = createdDetail.thread.id;
        const threadMessage = [
          "Use the new_cron tool to create this cron job for the current workspace.",
          `Set webSearchAccess to ${cronEditWebSearchAccess ? "true" : "false"}.`,
          `Set githubAccess to ${cronEditGithubAccess ? "true" : "false"}.`,
          `Set agentsAccess to ${cronEditAgentsAccess ? "true" : "false"}.`,
          `Set metidosAccess to ${cronEditMetidosAccess ? "true" : "false"}.`,
          `Set unsafeMode to ${cronEditUnsafeMode ? "true" : "false"}.`,
          "",
          describePrompt,
        ].join("\n");
        const sentDetail = await executeWithStepUp(
          "create a cron job from a natural-language description",
          () =>
            procedures.sendThreadMessage({
              threadId,
              input: `${threadMessage}\n\nUse projectId ${selectedProject.id} and worktree ${activeSelectedWorktreePath}.`,
            }),
        );
        if (!sentDetail) {
          return;
        }

        upsertThread(sentDetail.thread);
        if (
          shouldApplySentThreadDetailToSelection({
            detail: sentDetail,
            requestedThreadId: createdDetail.thread.id,
            selectedThreadId: selectedThreadIdRef.current,
          })
        ) {
          selectedThreadRunStateRef.current = sentDetail.thread.runStatus.state;
          mergeSelectedThreadMessageHistory(sentDetail);
        }

        await refreshCronJobsForDescribeCron();
        closeCronCreator();
        setCronDescribePrompt("");
      } catch (error) {
        if (createdDetail) {
          upsertThread(createdDetail.thread);
        }
        setCronCreatorError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsCreatingCronJob(false);
      }
    })();
  }, [
    activeSelectedWorktreePath,
    closeCronCreator,
    defaultCodexModel,
    activeCodexModel,
    cronCreatorModel,
    cronEditAgentsAccess,
    cronEditGithubAccess,
    cronEditMetidosAccess,
    cronEditWebSearchAccess,
    cronEditUnsafeMode,
    defaultCodexReasoningEffort,
    cronCreatorReasoningEffort,
    cronDescribePrompt,
    executeWithStepUp,
    mergeSelectedThreadMessageHistory,
    procedures,
    selectedProject,
    refreshCronJobsForDescribeCron,
    upsertThread,
  ]);

  const handleEditCronSubmit = useCallback(() => {
    const updatingExistingCron =
      cronCreatorMode === "edit" && cronEditingCronJobId !== null;

    const schedule = cronEditSchedule.trim();
    const prompt = cronEditPrompt.trim();

    if (!schedule) {
      setCronCreatorError("Cron schedule is required.");
      return;
    }

    if (!prompt) {
      setCronCreatorError("Cron prompt is required.");
      return;
    }

    const model = cronCreatorModel.trim()
      ? cronCreatorModel.trim()
      : activeCodexModel || defaultCodexModel;
    const reasoningEffort =
      cronCreatorReasoningEffort || defaultCodexReasoningEffort;

    setIsCreatingCronJob(true);
    setCronCreatorError("");

    void (async () => {
      try {
        if (updatingExistingCron) {
          await procedures.updateCron({
            cronJobId: cronEditingCronJobId,
            schedule,
            prompt,
            ...(model ? { model } : {}),
            reasoningEffort,
            ...(cronEditTitle.trim() ? { title: cronEditTitle.trim() } : {}),
            ...(cronEditDescription.trim()
              ? { description: cronEditDescription.trim() }
              : {}),
            webSearchAccess: cronEditWebSearchAccess,
            githubAccess: cronEditGithubAccess,
            agentsAccess: cronEditAgentsAccess,
            metidosAccess: cronEditMetidosAccess,
            unsafeMode: cronEditUnsafeMode,
            enabled: cronEditEnabled,
          });
        } else {
          if (!selectedProject || !activeSelectedWorktreePath) {
            throw new Error("Select a workspace before creating a cron job.");
          }
          await procedures.newCron({
            projectId: selectedProject.id,
            worktreePath: activeSelectedWorktreePath,
            schedule,
            prompt,
            ...(model ? { model } : {}),
            reasoningEffort,
            ...(cronEditTitle.trim() ? { title: cronEditTitle.trim() } : {}),
            ...(cronEditDescription.trim()
              ? { description: cronEditDescription.trim() }
              : {}),
            webSearchAccess: cronEditWebSearchAccess,
            githubAccess: cronEditGithubAccess,
            agentsAccess: cronEditAgentsAccess,
            metidosAccess: cronEditMetidosAccess,
            unsafeMode: cronEditUnsafeMode,
            enabled: cronEditEnabled,
          });
        }
        await loadCronJobs();
        closeCronCreator();
      } catch (error) {
        setCronCreatorError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsCreatingCronJob(false);
      }
    })();
  }, [
    activeSelectedWorktreePath,
    closeCronCreator,
    cronEditDescription,
    activeCodexModel,
    cronCreatorModel,
    cronCreatorReasoningEffort,
    cronEditEnabled,
    cronEditAgentsAccess,
    cronEditGithubAccess,
    cronEditMetidosAccess,
    cronEditWebSearchAccess,
    cronEditPrompt,
    cronEditSchedule,
    cronEditTitle,
    cronEditUnsafeMode,
    cronCreatorMode,
    cronEditingCronJobId,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    loadCronJobs,
    procedures,
    selectedProject,
  ]);

  useEffect(() => {
    if (primaryView !== "cronjobs") {
      closeCronCreator();
    }
  }, [closeCronCreator, primaryView]);

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
    window.__metidosAppMountedAt = Date.now();
    console.log("App.tsx mounted", window.__metidosAppMountedAt);
  }, []);

  const cronEditorAccessValue: ThreadAccessValue = {
    webSearchAccess: cronEditWebSearchAccess,
    githubAccess: cronEditGithubAccess,
    agentsAccess: cronEditAgentsAccess,
    metidosAccess: cronEditMetidosAccess,
    unsafeMode: cronEditUnsafeMode,
  };
  const handleCronEditorAccessChange = useCallback(
    (value: ThreadAccessValue) => {
      setCronEditWebSearchAccess(value.webSearchAccess);
      setCronEditGithubAccess(value.githubAccess);
      setCronEditAgentsAccess(value.agentsAccess);
      setCronEditMetidosAccess(value.metidosAccess);
      setCronEditUnsafeMode(value.unsafeMode);
    },
    [],
  );
  const cronCreatorModelValue = cronCreatorModel.trim()
    ? cronCreatorModel
    : activeCodexModel || defaultCodexModel || "";
  const cronCreatorModelOption = findCodexModel(
    codexModels,
    cronCreatorModelValue,
  );
  const cronCreatorModelScope = codexModelScopeCallout(
    codexModels,
    cronCreatorModelValue,
  );
  const cronThinkingLevelDisabled =
    isCreatingCronJob ||
    !codexModelSupportsThinkingLevel(cronCreatorModelOption);
  const isEditingExistingCron =
    cronCreatorMode === "edit" && cronEditingCronJobId !== null;
  const cronCreatorSubmitLabel = isCreatingCronJob
    ? isEditingExistingCron
      ? "Updating…"
      : "Creating…"
    : isEditingExistingCron
      ? "Update Cron"
      : "Create Cron";
  const renderCronCreatorModelControls = (
    variant: "desktop" | "mobile",
  ): JSX.Element => (
    <div className="space-y-1">
      <div className="space-y-1">
        <div
          className={`font-label text-[10px] uppercase tracking-[0.16em] ${
            variant === "desktop" ? "text-[#7ea2b8]" : "text-[#7ea2b8]"
          }`}
        >
          Model
        </div>
        <CodexModelSelector
          disabled={isCreatingCronJob}
          models={codexModels}
          onChange={setCronCreatorModel}
          onChangeReasoningEffort={setCronCreatorReasoningEffortValue}
          reasoningDisabled={cronThinkingLevelDisabled}
          reasoningOptions={reasoningEfforts}
          reasoningValue={cronCreatorReasoningEffort}
          value={cronCreatorModelValue}
          variant={variant}
        />
        {cronCreatorModelScope ? (
          <div className="rounded-xl border border-[#31414d] bg-[#101416] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[#45606f] bg-[#132129] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#d7ebfb]">
                {cronCreatorModelScope.badge}
              </span>
              <span className="font-label text-[10px] font-bold uppercase tracking-[0.16em] text-[#f4f8fb]">
                {`Provider: ${cronCreatorModelScope.providerLabel}`}
              </span>
              <span className="text-[10px] font-medium text-[#b1c6d4]">
                {cronCreatorModelScope.summary}
              </span>
            </div>
            <div className="mt-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-[#d7ebfb]">
              {`Model: ${cronCreatorModelScope.modelLabel}`}
            </div>
            <div className="mt-2 text-[11px] leading-4 text-[#9cb5c6]">
              {`New cron runs will create child threads with ${cronCreatorModelScope.providerLabel} for ${cronCreatorModelScope.modelLabel}. ${cronCreatorModelScope.detail}`}
            </div>
            {!cronCreatorModelScope.providerAvailable &&
            cronCreatorModelScope.providerAvailabilityNote ? (
              <div className="mt-2 text-[11px] leading-4 text-[#e9c28c]">
                {cronCreatorModelScope.providerAvailabilityNote}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="h-screen overflow-hidden bg-[#0e0e0e] text-[#ffffff]">
      <ThreadStatusController
        applyOptimisticThreadErrorSeenToList={
          applyOptimisticThreadErrorSeenToList
        }
        discardThreadIfEmpty={discardThreadIfEmpty}
        isDocumentVisible={isDocumentVisible}
        mergeSelectedThreadMessageHistory={mergeSelectedThreadMessageHistory}
        prepareOpenedThreadDetail={prepareOpenedThreadDetail}
        procedures={procedures}
        selectedThreadId={selectedThreadId}
        selectedThreadDetailRefreshKeyRef={selectedThreadDetailRefreshKeyRef}
        selectedThreadIdRef={selectedThreadIdRef}
        selectedThreadRunStateRef={selectedThreadRunStateRef}
        setThreadStore={setThreadStore}
        threads={threads}
      />
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
                  primaryView === "cronjobs"
                    ? "border-b-2 border-[#7eadce] text-[#bdd5e6]"
                    : "text-[#adabaa] hover:text-[#f2f0ef]"
                }`}
                onMouseEnter={() => {
                  primeCronJobs();
                }}
                onClick={handleShowCronjobs}
              >
                Cronjobs
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <SettingsPanel
              isAdmin={isAdmin}
              onModelCatalogChange={applyModelCatalog}
              procedures={procedures}
              variant="desktop"
            />
          </div>
        </header>

        <nav
          aria-label="Selected thread context"
          className="h-10 bg-[#131313] flex items-center px-6 gap-2"
        >
          <span className="font-label text-xs font-bold text-[#bdd5e6] shrink-0">
            {selectedThread?.title ??
              activeSelectedWorktreeFolder ??
              "No project selected"}
          </span>
          {selectedProject ? (
            <>
              <span className="text-[#545d64] text-xs shrink-0">|</span>
              <span className="font-label text-xs text-[#f2f0ef] truncate">
                {selectedThreadContextBranchLabel}
              </span>
              <span className="font-label text-xs text-[#8f8d8b] truncate">
                {selectedThreadContextPathLabel}
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
                <DesktopSidebarContent
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
                    onLoadMoreGitHistory: handleLoadMoreGitHistory,
                    onOpenGitHistoryDiff: handleOpenGitHistoryDiff,
                    selectedProject,
                  }}
                  pinnedThreadsPanelProps={{
                    acknowledgeThreadErrorSeenInBackground,
                    clearCompletedThreadIndicator,
                    dismissThreadStatus,
                    isThreadStatusDismissed,
                    onOpenThread: handleOpenPinnedThread,
                    onOpenThreadActionMenu: openThreadActionMenu,
                    pinnedThreads: desktopPinnedThreads,
                    projectById,
                    recentThreads: filteredWorkspaceActiveThreads,
                    selectedThreadId,
                    threadActivityIndicator,
                    threadPreviewsDisabled: threadActionMenu !== null,
                    threadsError,
                    worktreeDisplayPathByKey,
                    worktreeByProjectAndPath,
                  }}
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
                    onSelectDirectorySuggestion: selectDirectorySuggestion,
                    onSubmitAddProject: submitAddProject,
                    onToggleAddProjectForm: toggleAddProjectForm,
                    onToggleWorktreePinned: handleToggleWorktreePinned,
                    onToggleWorktreeThreadSwitcher:
                      handleToggleDesktopThreadSwitcher,
                    sidebarActionButtonClass,
                    supportsTildePath,
                    threadSwitcherEnabled: true,
                    threadSwitcherOpen: desktopThreadSwitcherOpen,
                    worktreePinBusyPath,
                    worktreeDisplayPathByKey,
                    worktreeSearchTextByKey,
                  }}
                  selectedProjectName={activeSelectedWorktreeFolder}
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
                  activeScreenSubtitlePrimary={activeScreenSubtitlePrimary}
                  activeScreenSubtitleSecondary={activeScreenSubtitleSecondary}
                  activeScreenTitle={activeScreenTitle}
                  activeThreadId={selectedThreadId}
                  codexModels={codexModels}
                  composerActionDisabled={composerActionDisabled}
                  composerActionLabel={composerActionLabel}
                  composerDisabled={composerDisabled}
                  extensionHiddenThinkingLabel={
                    activeThreadExtensionUiState?.hiddenThinkingLabel ?? null
                  }
                  extensionStatusEntries={activeThreadExtensionStatuses}
                  extensionWidgetsAbove={activeThreadExtensionWidgetsAbove}
                  extensionWidgetsBelow={activeThreadExtensionWidgetsBelow}
                  expandedItemIds={expandedTranscriptItemIds}
                  hasSelectedThread={Boolean(selectedThread)}
                  initialChatInput={initialMainviewState.chatInput}
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
                  onChangeThreadAccess={(value) => {
                    void updateActiveThreadAccess(value);
                  }}
                  onComposerDraftChange={(value) => {
                    syncThreadExtensionEditor(selectedThreadId, value);
                  }}
                  onSubmit={onSubmit}
                  onSubmitMessage={postMessage}
                  onToggleItemExpanded={toggleTranscriptItemExpanded}
                  reasoningEffortControlError={reasoningEffortControlError}
                  reasoningEffortSelectorDisabled={
                    reasoningEffortSelectorDisabled
                  }
                  reasoningEfforts={reasoningEfforts}
                  selectedThreadIsWorking={selectedThreadIsWorking}
                  threadAccessControlError={threadAccessControlError}
                  threadAccessControlDisabled={threadAccessControlDisabled}
                  threadAccessValue={activeThreadAccessValue}
                />
              ) : null
            ) : primaryView === "cronjobs" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6">
                <div className="flex items-center justify-between">
                  <div className="font-label text-xs uppercase tracking-[0.14em] text-[#9db9cb]">
                    Cron jobs
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-[#2f3b43] bg-[#182026] px-3 py-2 text-[11px] font-label uppercase tracking-[0.12em] text-[#9db9cb] transition-colors hover:border-[#435561] hover:bg-[#212b31] hover:text-[#dfebf3] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      openCronCreator("describe");
                    }}
                  >
                    New Cron
                  </button>
                </div>
                {cronCreatorOpen ? (
                  <div className="rounded-lg border border-[#2b3a45] bg-[#161a1d] p-4">
                    <div className="mb-4 flex gap-2 border-b border-[#27333a] pb-3">
                      <button
                        type="button"
                        className={`rounded px-3 py-1 text-[11px] font-label uppercase tracking-[0.14em] transition-colors ${
                          cronCreatorMode === "describe"
                            ? "bg-[#2f3b43] text-[#f2f0ef]"
                            : "text-[#9db9cb] hover:text-[#f2f0ef]"
                        }`}
                        onClick={() => {
                          setCronCreatorError("");
                          setCronCreatorMode("describe");
                        }}
                      >
                        Describe Cron
                      </button>
                      <button
                        type="button"
                        className={`rounded px-3 py-1 text-[11px] font-label uppercase tracking-[0.14em] transition-colors ${
                          cronCreatorMode === "edit"
                            ? "bg-[#2f3b43] text-[#f2f0ef]"
                            : "text-[#9db9cb] hover:text-[#f2f0ef]"
                        }`}
                        onClick={() => {
                          setCronCreatorError("");
                          setCronCreatorMode("edit");
                        }}
                      >
                        Edit Cron
                      </button>
                    </div>

                    {isEditingExistingCron ? (
                      <div className="mb-4 rounded border border-[#32414b] bg-[#11181d] px-3 py-2 text-xs text-[#c5d6df]">
                        Editing cron job #{cronEditingCronJobId}
                      </div>
                    ) : null}

                    {cronCreatorMode === "describe" ? (
                      <div className="space-y-3">
                        <label
                          htmlFor="cron-describe-input"
                          className="font-label text-[11px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                        >
                          Cron description
                        </label>
                        <textarea
                          id="cron-describe-input"
                          className="min-h-28 w-full resize-y rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                          placeholder="Describe cron schedule and work to perform."
                          rows={6}
                          value={cronDescribePrompt}
                          onChange={(event) => {
                            setCronDescribePrompt(event.target.value);
                          }}
                        />
                        {renderCronCreatorModelControls("desktop")}
                        <div className="space-y-1">
                          <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                            Access controls
                          </div>
                          <ThreadAccessControl
                            disabled={isCreatingCronJob}
                            onChange={handleCronEditorAccessChange}
                            title="Access controls for this cron job."
                            unsafeModeDisabled={!isAdmin}
                            value={cronEditorAccessValue}
                            variant="desktop"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label
                            htmlFor="cron-edit-title"
                            className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                          >
                            Title
                          </label>
                          <input
                            id="cron-edit-title"
                            className="w-full rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                            placeholder="Optional title"
                            value={cronEditTitle}
                            onChange={(event) => {
                              setCronEditTitle(event.target.value);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor="cron-edit-description"
                            className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                          >
                            Description
                          </label>
                          <textarea
                            id="cron-edit-description"
                            className="min-h-16 w-full resize-y rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                            placeholder="Optional description"
                            rows={3}
                            value={cronEditDescription}
                            onChange={(event) => {
                              setCronEditDescription(event.target.value);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor="cron-edit-schedule"
                            className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                          >
                            Schedule
                          </label>
                          <input
                            id="cron-edit-schedule"
                            className="w-full rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                            placeholder="cron expression, e.g. */5 * * * *"
                            value={cronEditSchedule}
                            onChange={(event) => {
                              setCronEditSchedule(event.target.value);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor="cron-edit-prompt"
                            className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                          >
                            Prompt
                          </label>
                          <textarea
                            id="cron-edit-prompt"
                            className="min-h-20 w-full resize-y rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                            placeholder="What the cron run thread should do"
                            rows={4}
                            value={cronEditPrompt}
                            onChange={(event) => {
                              setCronEditPrompt(event.target.value);
                            }}
                          />
                        </div>
                        {renderCronCreatorModelControls("desktop")}
                        <div className="space-y-1">
                          <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                            Access controls
                          </div>
                          <ThreadAccessControl
                            disabled={isCreatingCronJob}
                            onChange={handleCronEditorAccessChange}
                            title="Access controls for this cron job."
                            unsafeModeDisabled={!isAdmin}
                            value={cronEditorAccessValue}
                            variant="desktop"
                          />
                        </div>
                        <label className="inline-flex items-center gap-2 text-xs text-[#bfd1dc]">
                          <input
                            checked={cronEditEnabled}
                            className="h-4 w-4"
                            type="checkbox"
                            onChange={(event) => {
                              setCronEditEnabled(event.target.checked);
                            }}
                          />
                          Enable immediately
                        </label>
                      </div>
                    )}

                    {cronCreatorError ? (
                      <div className="mt-4 rounded border border-[#4f2734] bg-[#2a121b] px-3 py-2 text-xs text-[#ff9db0]">
                        {cronCreatorError}
                      </div>
                    ) : null}

                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[#39464f] bg-[#1a242b] px-3 py-2 text-xs font-label uppercase tracking-[0.14em] text-[#9ab2c0] transition-colors hover:border-[#4a5e6c] hover:bg-[#242f38]"
                        onClick={closeCronCreator}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[#2f3b43] bg-[#263743] px-3 py-2 text-xs font-label uppercase tracking-[0.14em] text-[#f2f0ef] transition-colors hover:border-[#5ba6d8] hover:bg-[#2f4f66] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isCreatingCronJob}
                        onClick={() => {
                          if (cronCreatorMode === "describe") {
                            handleDescribeCronSubmit();
                            return;
                          }
                          handleEditCronSubmit();
                        }}
                      >
                        {cronCreatorSubmitLabel}
                      </button>
                    </div>
                  </div>
                ) : null}
                <CronjobWorkspace
                  cronJobs={cronJobs}
                  cronJobsError={cronJobsError}
                  deletingCronJobs={deletingCronJobs}
                  isLoadingCronJobs={isLoadingCronJobs}
                  onDeleteCron={handleDeleteCron}
                  onEditCron={openCronEditor}
                  onRunCron={handleRunCronNow}
                  runningCronJobs={runningCronJobs}
                />
              </div>
            ) : (
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
            <SettingsPanel
              isAdmin={isAdmin}
              onModelCatalogChange={applyModelCatalog}
              procedures={procedures}
              variant="mobile"
            />
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
                onLoadMoreGitHistory: handleLoadMoreGitHistory,
                onOpenGitHistoryDiff: handleOpenGitHistoryDiff,
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
                onSelectDirectorySuggestion: selectDirectorySuggestion,
                onSubmitAddProject: submitAddProject,
                onToggleAddProjectForm: toggleAddProjectForm,
                onToggleWorktreePinned: handleToggleWorktreePinned,
                onToggleWorktreeThreadSwitcher:
                  handleToggleDesktopThreadSwitcher,
                sidebarActionButtonClass,
                supportsTildePath,
                threadSwitcherEnabled: false,
                threadSwitcherOpen: false,
                worktreePinBusyPath,
                worktreeDisplayPathByKey,
                worktreeSearchTextByKey,
              }}
              selectedProjectName={activeSelectedWorktreeFolder}
              sidebarSearchQuery={sidebarSearchQuery}
              workspacePanelProps={{
                acknowledgeThreadErrorSeenInBackground,
                activeSelectedWorktreeBranch:
                  activeSelectedWorktree?.branch?.trim() || "Primary",
                activeSelectedWorktreeFolder: activeSelectedWorktreePath
                  ? formatPathForDisplay(
                      activeSelectedWorktreePath,
                      homeDirectory,
                      true,
                    )
                  : activeSelectedWorktreeFolder || "Current worktree",
                canCreateThread:
                  selectedProject !== null &&
                  activeSelectedWorktreePath !== null,
                clearCompletedThreadIndicator,
                dismissThreadStatus,
                isThreadStatusDismissed,
                isCreatingThread,
                onCreateThread: handleCreateThreadForActiveWorktree,
                onOpenThread: handleOpenThread,
                onOpenThreadActionMenu: openThreadActionMenu,
                projectById,
                selectedThreadId,
                sidebarActionButtonClass,
                selectedProjectNameForThread:
                  activeSelectedWorktreeFolder ?? "Current project",
                threadPreviewsDisabled: threadActionMenu !== null,
                threadActivityIndicator,
                threadsError,
                worktreeDisplayPathByKey,
                workspaceActiveThreads: filteredWorkspaceActiveThreads,
                workspacePinnedThreads: filteredWorkspacePinnedThreads,
                worktreeByProjectAndPath,
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
                activeScreenSubtitlePrimary={activeScreenSubtitlePrimary}
                activeScreenSubtitleSecondary={activeScreenSubtitleSecondary}
                activeScreenTitle={activeScreenTitle}
                activeThreadId={selectedThreadId}
                codexModels={codexModels}
                composerActionDisabled={composerActionDisabled}
                composerActionLabel={composerActionLabel}
                composerDisabled={composerDisabled}
                extensionHiddenThinkingLabel={
                  activeThreadExtensionUiState?.hiddenThinkingLabel ?? null
                }
                extensionStatusEntries={activeThreadExtensionStatuses}
                extensionWidgetsAbove={activeThreadExtensionWidgetsAbove}
                extensionWidgetsBelow={activeThreadExtensionWidgetsBelow}
                expandedItemIds={expandedTranscriptItemIds}
                hasSelectedThread={Boolean(selectedThread)}
                initialChatInput={initialMainviewState.chatInput}
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
                onChangeThreadAccess={(value) => {
                  void updateActiveThreadAccess(value);
                }}
                onComposerDraftChange={(value) => {
                  syncThreadExtensionEditor(selectedThreadId, value);
                }}
                onSubmit={onSubmit}
                onSubmitMessage={postMessage}
                onToggleItemExpanded={toggleTranscriptItemExpanded}
                reasoningEffortControlError={reasoningEffortControlError}
                reasoningEffortSelectorDisabled={
                  reasoningEffortSelectorDisabled
                }
                reasoningEfforts={reasoningEfforts}
                selectedThreadIsWorking={selectedThreadIsWorking}
                threadAccessControlError={threadAccessControlError}
                threadAccessControlDisabled={threadAccessControlDisabled}
                threadAccessValue={activeThreadAccessValue}
              />
            ) : null
          ) : primaryView === "cronjobs" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-6">
              <div className="flex items-center justify-between">
                <div className="font-label text-xs uppercase tracking-[0.14em] text-[#9db9cb]">
                  Cron jobs
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-[#2f3b43] bg-[#182026] px-3 py-2 text-[11px] font-label uppercase tracking-[0.12em] text-[#9db9cb] transition-colors hover:border-[#435561] hover:bg-[#212b31] hover:text-[#dfebf3]"
                  onClick={() => {
                    openCronCreator("describe");
                  }}
                >
                  New Cron
                </button>
              </div>
              {cronCreatorOpen ? (
                <div className="rounded-lg border border-[#2b3a45] bg-[#161a1d] p-4">
                  <div className="mb-4 flex gap-2 border-b border-[#27333a] pb-3">
                    <button
                      type="button"
                      className={`rounded px-3 py-1 text-[11px] font-label uppercase tracking-[0.14em] transition-colors ${
                        cronCreatorMode === "describe"
                          ? "bg-[#2f3b43] text-[#f2f0ef]"
                          : "text-[#9db9cb] hover:text-[#f2f0ef]"
                      }`}
                      onClick={() => {
                        setCronCreatorError("");
                        setCronCreatorMode("describe");
                      }}
                    >
                      Describe Cron
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1 text-[11px] font-label uppercase tracking-[0.14em] transition-colors ${
                        cronCreatorMode === "edit"
                          ? "bg-[#2f3b43] text-[#f2f0ef]"
                          : "text-[#9db9cb] hover:text-[#f2f0ef]"
                      }`}
                      onClick={() => {
                        setCronCreatorError("");
                        setCronCreatorMode("edit");
                      }}
                    >
                      Edit Cron
                    </button>
                  </div>

                  {isEditingExistingCron ? (
                    <div className="mb-4 rounded border border-[#32414b] bg-[#11181d] px-3 py-2 text-xs text-[#c5d6df]">
                      Editing cron job #{cronEditingCronJobId}
                    </div>
                  ) : null}

                  {cronCreatorMode === "describe" ? (
                    <div className="space-y-3">
                      <label
                        htmlFor="cron-describe-input-mobile"
                        className="font-label text-[11px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                      >
                        Cron description
                      </label>
                      <textarea
                        id="cron-describe-input-mobile"
                        className="min-h-28 w-full resize-y rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                        placeholder="Describe cron schedule and work to perform."
                        rows={6}
                        value={cronDescribePrompt}
                        onChange={(event) => {
                          setCronDescribePrompt(event.target.value);
                        }}
                      />
                      {renderCronCreatorModelControls("mobile")}
                      <div className="space-y-1">
                        <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                          Access controls
                        </div>
                        <ThreadAccessControl
                          disabled={isCreatingCronJob}
                          onChange={handleCronEditorAccessChange}
                          title="Access controls for this cron job."
                          unsafeModeDisabled={!isAdmin}
                          value={cronEditorAccessValue}
                          variant="mobile"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label
                          htmlFor="cron-edit-title-mobile"
                          className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                        >
                          Title
                        </label>
                        <input
                          id="cron-edit-title-mobile"
                          className="w-full rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                          placeholder="Optional title"
                          value={cronEditTitle}
                          onChange={(event) => {
                            setCronEditTitle(event.target.value);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="cron-edit-description-mobile"
                          className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                        >
                          Description
                        </label>
                        <textarea
                          id="cron-edit-description-mobile"
                          className="min-h-16 w-full resize-y rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                          placeholder="Optional description"
                          rows={3}
                          value={cronEditDescription}
                          onChange={(event) => {
                            setCronEditDescription(event.target.value);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="cron-edit-schedule-mobile"
                          className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                        >
                          Schedule
                        </label>
                        <input
                          id="cron-edit-schedule-mobile"
                          className="w-full rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                          placeholder="cron expression, e.g. */5 * * * *"
                          value={cronEditSchedule}
                          onChange={(event) => {
                            setCronEditSchedule(event.target.value);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="cron-edit-prompt-mobile"
                          className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]"
                        >
                          Prompt
                        </label>
                        <textarea
                          id="cron-edit-prompt-mobile"
                          className="min-h-20 w-full resize-y rounded-md border border-[#29353d] bg-[#0d1012] px-3 py-2 text-sm text-[#d8e5ee] outline-none focus:border-[#4a89b3] focus:ring-2 focus:ring-[#4a89b3]/25"
                          placeholder="What the cron run thread should do"
                          rows={4}
                          value={cronEditPrompt}
                          onChange={(event) => {
                            setCronEditPrompt(event.target.value);
                          }}
                        />
                      </div>
                      {renderCronCreatorModelControls("mobile")}
                      <div className="space-y-1">
                        <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7ea2b8]">
                          Access controls
                        </div>
                        <ThreadAccessControl
                          disabled={isCreatingCronJob}
                          onChange={handleCronEditorAccessChange}
                          title="Access controls for this cron job."
                          unsafeModeDisabled={!isAdmin}
                          value={cronEditorAccessValue}
                          variant="mobile"
                        />
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs text-[#bfd1dc]">
                        <input
                          checked={cronEditEnabled}
                          className="h-4 w-4"
                          type="checkbox"
                          onChange={(event) => {
                            setCronEditEnabled(event.target.checked);
                          }}
                        />
                        Enable immediately
                      </label>
                    </div>
                  )}

                  {cronCreatorError ? (
                    <div className="mt-4 rounded border border-[#4f2734] bg-[#2a121b] px-3 py-2 text-xs text-[#ff9db0]">
                      {cronCreatorError}
                    </div>
                  ) : null}

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[#39464f] bg-[#1a242b] px-3 py-2 text-xs font-label uppercase tracking-[0.14em] text-[#9ab2c0] transition-colors hover:border-[#4a5e6c] hover:bg-[#242f38]"
                      onClick={closeCronCreator}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#2f3b43] bg-[#263743] px-3 py-2 text-xs font-label uppercase tracking-[0.14em] text-[#f2f0ef] transition-colors hover:border-[#5ba6d8] hover:bg-[#2f4f66] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isCreatingCronJob}
                      onClick={() => {
                        if (cronCreatorMode === "describe") {
                          handleDescribeCronSubmit();
                          return;
                        }
                        handleEditCronSubmit();
                      }}
                    >
                      {cronCreatorSubmitLabel}
                    </button>
                  </div>
                </div>
              ) : null}
              <CronjobWorkspace
                cronJobs={cronJobs}
                cronJobsError={cronJobsError}
                deletingCronJobs={deletingCronJobs}
                isLoadingCronJobs={isLoadingCronJobs}
                onDeleteCron={handleDeleteCron}
                onEditCron={openCronEditor}
                onRunCron={handleRunCronNow}
                runningCronJobs={runningCronJobs}
              />
            </div>
          ) : (
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
                primaryView === "cronjobs"
                  ? "text-[#bdd5e6] font-bold border-t-2 border-[#bdd5e6]"
                  : "text-[#adabaa] hover:text-[#f2f0ef]"
              }`}
              onMouseEnter={() => {
                primeCronJobs();
              }}
              onClick={handleShowCronjobs}
            >
              {materialSymbol("task_alt")}
              <span className="mt-1 font-label text-[10px] uppercase tracking-widest">
                Cronjobs
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
              {brandLogoIcon("h-4 w-4")}
              <span className="mt-1 font-label text-[10px] uppercase tracking-widest">
                Chat
              </span>
            </button>
          </nav>
        </div>
      </div>
      <DesktopThreadSwitcher
        acknowledgeThreadErrorSeenInBackground={
          acknowledgeThreadErrorSeenInBackground
        }
        anchorId={desktopThreadSwitcherAnchorId}
        clearCompletedThreadIndicator={clearCompletedThreadIndicator}
        dismissThreadStatus={dismissThreadStatus}
        isCreatingThread={isCreatingThread}
        isThreadStatusDismissed={isThreadStatusDismissed}
        onClose={closeDesktopThreadSwitcher}
        onCreateThread={handleCreateThreadFromDesktopThreadSwitcher}
        onOpenThread={handleOpenThreadFromDesktopThreadSwitcher}
        onOpenThreadActionMenu={openThreadActionMenu}
        onSearchQueryChange={setDesktopThreadSwitcherSearchQuery}
        open={desktopThreadSwitcherOpen}
        previewDisabled={threadActionMenu !== null}
        project={selectedProject}
        projectById={projectById}
        scrollContainer={desktopSidebarScrollRef.current}
        searchQuery={desktopThreadSwitcherSearchQuery}
        sections={desktopThreadSwitcherSections}
        selectedThreadId={selectedThreadId}
        threadActivityIndicator={threadActivityIndicator}
        threadsError={threadsError}
        worktreeDisplayPathByKey={worktreeDisplayPathByKey}
        worktreeByProjectAndPath={worktreeByProjectAndPath}
        worktreeLabel={worktreeLabel}
        worktreeSubtitle={worktreeSubtitle}
      />
      <div className="pointer-events-none fixed right-4 top-4 z-[109] flex max-w-sm flex-col gap-2">
        {threadExtensionUiNotifications.map((notification) => (
          <button
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-left text-sm shadow-xl shadow-black/35 ${
              notification.type === "error"
                ? "border-[#6b3a3a] bg-[#2a1717] text-[#ffb9b9]"
                : notification.type === "warning"
                  ? "border-[#6a5a2c] bg-[#231d11] text-[#f2d79b]"
                  : "border-[#32414b] bg-[#141a1d] text-[#d6e7f2]"
            }`}
            key={notification.id}
            onClick={() => {
              dismissNotification(notification.id);
            }}
            type="button"
          >
            <div className="font-label text-[10px] uppercase tracking-[0.14em] opacity-75">
              Thread #{notification.threadId}
            </div>
            <div className="mt-1">{notification.message}</div>
          </button>
        ))}
      </div>
      <ThreadExtensionUiDialog
        busy={threadExtensionUiDialogBusy}
        dialog={currentThreadExtensionUiDialog}
        error={threadExtensionUiDialogError}
        onCancel={() => {
          void respondToCurrentThreadExtensionUiDialog(undefined);
        }}
        onConfirm={(value) => {
          void respondToCurrentThreadExtensionUiDialog(value);
        }}
        onDraftChange={setThreadExtensionUiDialogDraft}
        value={threadExtensionUiDialogDraft}
      />
      <AuthStepUpDialog
        actionLabel={stepUpActionLabel}
        busy={isSubmittingStepUp}
        error={stepUpError}
        onCancel={() => {
          closeStepUpDialog(false);
        }}
        onPrimaryFactorChange={updateStepUpPrimaryFactor}
        onSubmit={submitStepUp}
        onTotpCodeChange={updateStepUpTotpCode}
        open={stepUpDialogOpen}
        primaryFactorType={primaryFactorType}
        primaryFactorValue={stepUpPrimaryFactor}
        totpCodeValue={stepUpTotpCode}
      />
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
                Model: {currentThreadStartRequestModelLabel}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Thinking: {currentThreadStartRequestThinkingLabel}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Web Search:{" "}
                {currentThreadStartRequest.webSearchAccess === null
                  ? "default"
                  : currentThreadStartRequest.webSearchAccess
                    ? "on"
                    : "off"}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                GitHub:{" "}
                {currentThreadStartRequest.githubAccess === null
                  ? "default"
                  : currentThreadStartRequest.githubAccess
                    ? "on"
                    : "off"}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Agents:{" "}
                {currentThreadStartRequest.agentsAccess === null
                  ? "default"
                  : currentThreadStartRequest.agentsAccess
                    ? "on"
                    : "off"}
              </span>
              <span className="rounded-full border border-[#3a4751] px-3 py-1">
                Metidos:{" "}
                {currentThreadStartRequest.metidosAccess === null
                  ? "default"
                  : currentThreadStartRequest.metidosAccess
                    ? "on"
                    : "off"}
              </span>
              <span className="rounded-full border border-[#8a6b2f] bg-[#231d11] px-3 py-1 text-[#f2d79b]">
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
        hiddenWorktreePath={projectActionMenuHiddenWorktreePath}
        hiddenWorktrees={projectActionMenuHiddenWorktrees}
        isCreatingWorktree={isCreatingWorktree}
        isOpeningHiddenWorktree={isOpeningHiddenWorktree}
        menu={projectActionMenu}
        newWorktreeName={newWorktreeName}
        onClose={closeProjectActionMenu}
        onDeleteProject={() => {
          if (!projectActionMenuProject) {
            return;
          }
          void deleteTrackedProject(projectActionMenuProject.id);
        }}
        onHiddenWorktreePathChange={setProjectActionMenuHiddenWorktreePath}
        onNewWorktreeNameChange={handleNewWorktreeNameChange}
        onOpenHiddenWorktree={() => {
          void openHiddenProjectWorktree();
        }}
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
