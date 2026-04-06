/**
 * @file src/mainview/App.tsx
 * @description Module for app.
 */

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
import type { AuthPrimaryFactorType } from "../bun/db";
import type {
  ProjectProcedures,
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
  RpcContextFocusChanged,
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
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
} from "../bun/rpc-schema";
import { ProjectActionMenu, ThreadActionMenu } from "./app/action-menus";
import { AuthStepUpDialog } from "./app/auth-step-up-dialog";
import { DesktopChatView, MobileChatView } from "./app/chat-workspace";
import { DesktopSidebar } from "./app/desktop-sidebar";
import { DiffWorkspace } from "./app/diff-workspace";
import {
  subscribeToWorktreeGitHistoryChanged,
  subscribeToWorktreeTasksChanged,
} from "./app/invalidation-events";
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
  buildProjectWorktreeIndex,
  CONTEXT_FOCUS_CHANGED_EVENT_NAME,
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
  GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
  GIT_HISTORY_PAGE_SIZE,
  GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
  type GitHistoryDiffCacheEntry,
  type GitHistoryModalState,
  gitHistoryDiffCacheKey,
  isAbortError,
  isCodexReasoningEffort,
  MAINVIEW_STATE_STORAGE_VERSION,
  MAINVIEW_STATE_WRITE_DEBOUNCE_MS,
  mergeResetGitHistory,
  type OpenThreadOptions,
  type PendingSharedRequest,
  type PersistedMainviewState,
  PROJECT_TASK_RESULT_CACHE_MAX_ENTRIES,
  type ProjectActionMenuState,
  type ProjectNodeState,
  type ProjectStateMap,
  type ProjectStore,
  patchPersistedMainviewState,
  pickInitialThread,
  preferredThreadForWorktree,
  primaryWorktreePath,
  projectStateWorktrees,
  projectStoreItems,
  readLruValue,
  readPersistedMainviewState,
  removeThreadFromStore,
  serializeOpenWorktrees,
  THREAD_START_REQUEST_CREATED_EVENT_NAME,
  THREAD_STATUS_POLL_INTERVAL_MS,
  type ThreadActionMenuState,
  type ThreadStore,
  threadStoreItems,
  upsertProjectStore,
  upsertThreadStore,
  type VisibleMessage,
  type WorktreeNodeState,
  type WorktreeStateMap,
  withAcknowledgedUnreadThread,
  withAcknowledgedUnreadThreadDetail,
  worktreeKey,
  worktreeThreadPopoverAnchorId,
  writeLruValue,
  writePersistedMainviewState,
} from "./app/state";
import { ThreadList } from "./app/thread-list-row";
import { useAddProjectForm } from "./app/use-add-project-form";
import { useMainviewDerivedState } from "./app/use-mainview-derived-state";
import { useWorktreeDiff } from "./app/use-worktree-diff";
import { stepUpAuth } from "./auth-client";
import {
  readChatComposerDraft,
  setChatComposerDraft,
} from "./controls/chat-composer-control";
import { brandBoltIcon, materialSymbol } from "./controls/icons";
import { runRollbackSafeProjectClose } from "./project-close";
import { createProjectLifecycleRequestTracker } from "./project-lifecycle";
import { shouldRefreshProjectActionMenuWorktrees } from "./project-worktree-refresh";
import { isStepUpRequiredError } from "./rpc-errors";
import {
  closeProjectsForStartupRestore,
  reconcileStartupProjectRestore,
} from "./startup-project-restore";
import {
  filterStartupWorktreeRestoreRequests,
  reconcileStartupSelectedWorktreePath,
} from "./startup-worktree-restore";
import {
  shouldApplySentThreadDetailToSelection,
  shouldApplyThreadSendFailureToSelection,
} from "./thread-send";
import {
  mergeThreadStatusSummaries,
  resolveThreadStatusRefreshOutcome,
} from "./thread-status-refresh";

/**
 * Merges thread message history.
 * @param current - current argument for mergeThreadMessageHistory.
 * @param incoming - incoming argument for mergeThreadMessageHistory.
 */

function mergeThreadMessageHistory(
  current: RpcThreadMessage[],
  incoming: RpcThreadMessage[],
): RpcThreadMessage[] {
  if (incoming.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return incoming;
  }

  const currentLastMessageId = current[current.length - 1]?.id ?? 0;
  const incomingFirstMessageId = incoming[0]?.id ?? 0;
  if (currentLastMessageId < incomingFirstMessageId) {
    let canAppendIncomingRange = true;
    let previousMessageId = currentLastMessageId;
    for (const message of incoming) {
      if (message.id <= previousMessageId) {
        canAppendIncomingRange = false;
        break;
      }
      previousMessageId = message.id;
    }
    if (canAppendIncomingRange) {
      return [...current, ...incoming];
    }
  }

  const messagesById = new Map<number, RpcThreadMessage>();
  for (const message of current) {
    messagesById.set(message.id, message);
  }
  for (const message of incoming) {
    messagesById.set(message.id, message);
  }

  return Array.from(messagesById.values()).sort(
    (left, right) => left.id - right.id,
  );
}

type VisibleMessageCacheEntry = {
  signature: string;
  value: VisibleMessage;
};

/**
 * Reads cached visible message.
 * @param cache - cache argument for readCachedVisibleMessage.
 * @param cacheKey - cacheKey argument for readCachedVisibleMessage.
 * @param signature - signature argument for readCachedVisibleMessage.
 * @param createValue - createValue argument for readCachedVisibleMessage.
 */

function readCachedVisibleMessage(
  cache: Map<string, VisibleMessageCacheEntry>,
  cacheKey: string,
  signature: string,
  createValue: () => VisibleMessage,
): VisibleMessage {
  const existing = cache.get(cacheKey);
  if (existing && existing.signature === signature) {
    return existing.value;
  }

  const nextValue = createValue();
  cache.set(cacheKey, {
    signature,
    value: nextValue,
  });
  return nextValue;
}

/**
 * Performs threadMessageVisibleSignature operation.
 * @param message - Message payload.
 */

function threadMessageVisibleSignature(message: RpcThreadMessage): string {
  switch (message.kind) {
    case "reasoning":
      return `reasoning:${message.state}:${message.text}`;
    case "command":
      return `command:${message.state}:${message.exitCode ?? "null"}:${message.command}:${message.output}`;
    case "file_change":
      return `file_change:${message.state}:${message.changeKind}:${message.path}:${message.diffText}`;
    case "tool_call":
      return `tool_call:${message.state}:${message.server}:${message.tool}:${message.argumentsText}:${message.output}`;
    case "web_search":
      return `web_search:${message.state}:${message.query}`;
    case "error":
      return `error:${message.state}:${message.text}`;
    case "chat":
      return `chat:${message.state}:${message.role}:${message.text}`;
  }
}

/**
 * Builds thread visible message.
 * @param message - Message payload.
 */

function buildThreadVisibleMessage(message: RpcThreadMessage): VisibleMessage {
  const key = `thread-message:${message.id}`;
  switch (message.kind) {
    case "reasoning":
      return {
        key,
        kind: "reasoning",
        text: message.text,
        state: message.state,
      };
    case "command":
      return {
        key,
        kind: "command",
        command: message.command,
        output: message.output,
        state: message.state,
        exitCode: message.exitCode,
      };
    case "file_change":
      return {
        key,
        kind: "file_change",
        path: message.path,
        diffText: message.diffText,
        changeKind: message.changeKind,
        state: message.state,
      };
    case "tool_call":
      return {
        key,
        kind: "tool_call",
        server: message.server,
        tool: message.tool,
        argumentsText: message.argumentsText,
        output: message.output,
        state: message.state,
      };
    case "web_search":
      return {
        key,
        kind: "web_search",
        query: message.query,
        state: message.state,
      };
    case "error":
      return {
        key,
        kind: "error",
        text: message.text,
        state: message.state,
      };
    case "chat":
      return {
        key,
        kind: "chat",
        speaker: message.role,
        tone: "normal",
        text: message.text,
      };
  }
}

type AppProps = {
  primaryFactorType: AuthPrimaryFactorType | null;
  procedures: ProjectProcedures;
};

type ProjectWorktreeRequestCacheEntry = {
  lifecycleRequestId: number;
  promise: Promise<RpcWorktree[]>;
};

/**
 * App-level sizing and interaction constants for responsive layout decisions.
 */

const WORKTREE_THREAD_POPOVER_DESKTOP_WIDTH_PX = 360;
const WORKTREE_THREAD_POPOVER_MOBILE_WIDTH_PX = 320;
const WORKTREE_THREAD_POPOVER_ESTIMATED_HEIGHT_PX = 420;
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
type PrimaryView = "chat" | "diff";
type WorktreeThreadPopoverState = {
  maxHeight: number;
  width: number;
  x: number;
  y: number;
};
type MobileNavigationIndicatorState = "none" | "working" | "completed";

/**
 * Stable sort for thread collections by updated timestamp, newest-first.
 * @param items - items argument for items.
 */
function sortThreadsByUpdatedAt(items: RpcThread[]): RpcThread[] {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

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
     * @param event - event argument for handleChange.
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
 * Normalizes backend thread errors to a quick classification predicate.
 * @param error - Error value to process.
 */
function isThreadNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Thread not found:");
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
 * @param left - left argument for left.
 * @param right - right argument for right.
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

/**
 * Builds loaded project worktrees state.
 * @param worktrees - worktrees argument for buildLoadedProjectWorktreesState.
 * @param loadedAtMs - loadedAtMs argument for buildLoadedProjectWorktreesState.
 */

function buildLoadedProjectWorktreesState(
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

declare global {
  interface Window {
    __joltAppMountedAt?: number;
  }
}

/**
 * Root mainview component.
 *
 * It composes sidebar/workspace panels, thread/project state derivation, and
 * RPC-driven update handlers into a single interface.
 */

export default function App({
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
  const [threadActionMenuError, setThreadActionMenuError] = useState("");
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [threadRenameTitle, setThreadRenameTitle] = useState("");
  const [threadRenameSummary, setThreadRenameSummary] = useState("");
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [worktreePinBusyPath, setWorktreePinBusyPath] = useState<string | null>(
    null,
  );
  const [threadStore, setThreadStore] = useState<ThreadStore>(() =>
    emptyThreadStore(),
  );
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
  const [stepUpActionLabel, setStepUpActionLabel] = useState("");
  const [stepUpDialogOpen, setStepUpDialogOpen] = useState(false);
  const [stepUpError, setStepUpError] = useState("");
  const [stepUpPrimaryFactor, setStepUpPrimaryFactor] = useState("");
  const [stepUpTotpCode, setStepUpTotpCode] = useState("");
  const [isSubmittingStepUp, setIsSubmittingStepUp] = useState(false);
  const [expandedTranscriptItemIds, setExpandedTranscriptItemIds] = useState(
    () => new Set<string>(),
  );
  const [worktreeThreadPopover, setWorktreeThreadPopover] =
    useState<WorktreeThreadPopoverState | null>(null);
  const isDesktopViewport = useDesktopViewport();
  const projects = useMemo(
    () => projectStoreItems(projectStore),
    [projectStore],
  );
  const threads = useMemo(() => threadStoreItems(threadStore), [threadStore]);

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
  const worktreeThreadPopoverRef = useRef<HTMLDivElement | null>(null);
  const desktopSidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarScrollRef = useRef<HTMLElement | null>(null);
  const stepUpRequestResolveRef = useRef<
    ((authorized: boolean) => void) | null
  >(null);
  const projectActionMenuRequestId = useRef(0);
  const projectTasksRequestIdRef = useRef(0);
  const projectTasksAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryRequestIdRef = useRef(0);
  const gitHistoryAbortControllerRef = useRef<AbortController | null>(null);
  const persistedMainviewStateWriteTimeoutRef = useRef<number | null>(null);
  const pendingPersistedMainviewStateRef =
    useRef<PersistedMainviewState | null>(null);

  const closeStepUpDialog = useCallback((authorized: boolean) => {
    setStepUpDialogOpen(false);
    setIsSubmittingStepUp(false);
    setStepUpError("");
    setStepUpPrimaryFactor("");
    setStepUpTotpCode("");
    const resolveStepUp = stepUpRequestResolveRef.current;
    stepUpRequestResolveRef.current = null;
    resolveStepUp?.(authorized);
  }, []);
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

  const requestStepUp = useCallback((actionLabel: string): Promise<boolean> => {
    setStepUpActionLabel(actionLabel);
    setStepUpDialogOpen(true);
    setStepUpError("");
    setStepUpPrimaryFactor("");
    setStepUpTotpCode("");
    setIsSubmittingStepUp(false);

    return new Promise<boolean>((resolve) => {
      stepUpRequestResolveRef.current = resolve;
    });
  }, []);

  const executeWithStepUp = useCallback(
    async <T,>(
      actionLabel: string,
      action: () => Promise<T>,
    ): Promise<T | null> => {
      try {
        return await action();
      } catch (error) {
        if (!isStepUpRequiredError(error)) {
          throw error;
        }

        const authorized = await requestStepUp(actionLabel);
        if (!authorized) {
          return null;
        }
        return action();
      }
    },
    [requestStepUp],
  );

  const submitStepUp = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSubmittingStepUp(true);
      setStepUpError("");
      try {
        await stepUpAuth({
          primaryFactor: stepUpPrimaryFactor,
          totpCode: stepUpTotpCode,
        });
        closeStepUpDialog(true);
      } catch (error) {
        setStepUpError(error instanceof Error ? error.message : String(error));
        setIsSubmittingStepUp(false);
      }
    },
    [closeStepUpDialog, stepUpPrimaryFactor, stepUpTotpCode],
  );

  useEffect(() => {
    return () => {
      stepUpRequestResolveRef.current?.(false);
      stepUpRequestResolveRef.current = null;
    };
  }, []);

  useEffect(() => {
    void selectedThreadId;
    visibleMessageCacheRef.current.clear();
  }, [selectedThreadId]);

  const gitHistoryDiffRequestIdRef = useRef(0);
  const gitHistoryDiffAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryLoadMoreAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  // Request/caching refs below track in-flight RPCs by key so refreshes can be
  // shared, cancelled, or ignored without extra state transitions.
  const activeWorktreeSyncAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const threadOpenRequestIdRef = useRef(0);
  const threadOpenAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryLoadingMoreRef = useRef(false);
  const projectWorktreeRequestCacheRef = useRef(
    new Map<number, ProjectWorktreeRequestCacheEntry>(),
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
  const selectedThreadHistoryCursorRef = useRef<number | null>(null);
  const visibleMessageCacheRef = useRef(
    new Map<string, VisibleMessageCacheEntry>(),
  );
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
  const autoThreadCreationWorktreeKeysRef = useRef(new Set<string>());
  const gitHistoryRefreshedThreadIdRef = useRef<number | null>(null);
  const threadStatusPollInFlightRef = useRef(false);
  const threadHistoryBackfillAbortControllerRef =
    useRef<AbortController | null>(null);
  const initializedRef = useRef(false);
  const previousThreadRunStatesRef = useRef(
    new Map<number, RpcThreadRunStatus["state"]>(),
  );
  const previousDocumentVisibilityRef = useRef(isDocumentVisible);
  const projectLifecycleRequestTracker = useMemo(
    () => createProjectLifecycleRequestTracker(),
    [],
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
    projectThreadErrorLevel,
    reasoningEffortSelectorDisabled,
    selectedDiffFileChange,
    selectedProject,
    selectedThread,
    selectedThreadIsWorking,
    taskSelectorDisabled,
    threadActionMenuThread,
    unsafeModeToggleDisabled,
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
    worktreeSearchTextByKey,
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

    // Position recalculation is deferred to rAF and debounced across rapid
    // animation frames to avoid jitter when the sidebar moves or resizes.
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

    /**
     * Handles pointer down.
     * @param event - event argument for handlePointerDown.
     */

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

  const replaceProjects = useCallback((items: RpcProject[]): void => {
    setProjectStore(createProjectStore(items));
  }, []);

  const upsertProject = useCallback((project: RpcProject): void => {
    setProjectStore((prev) => upsertProjectStore(prev, project));
  }, []);

  const replaceThreads = useCallback((items: RpcThread[]): void => {
    setThreadStore(createThreadStore(items));
  }, []);

  const upsertThread = useCallback((thread: RpcThread): void => {
    setThreadStore((prev) => upsertThreadStore(prev, thread));
  }, []);

  const removeThread = useCallback((threadId: number): void => {
    setThreadStore((prev) => removeThreadFromStore(prev, threadId));
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

  const clearProjectWorktreeToggleRequests = useCallback(
    (projectId: number) => {
      const keyPrefix = `${projectId}::`;
      for (const key of [...worktreeToggleRequestIdRef.current.keys()]) {
        if (key.startsWith(keyPrefix)) {
          worktreeToggleRequestIdRef.current.delete(key);
        }
      }
    },
    [],
  );

  const beginProjectLifecycleRequest = useCallback(
    (projectId: number) => {
      projectWorktreeRequestCacheRef.current.delete(projectId);
      return projectLifecycleRequestTracker.begin(projectId);
    },
    [projectLifecycleRequestTracker],
  );

  const snapshotProjectLifecycleRequest = useCallback(
    (projectId: number) => projectLifecycleRequestTracker.snapshot(projectId),
    [projectLifecycleRequestTracker],
  );

  const requestProjectWorktrees = useCallback(
    async (projectId: number): Promise<RpcWorktree[]> => {
      const lifecycleRequest = snapshotProjectLifecycleRequest(projectId);
      const existing = projectWorktreeRequestCacheRef.current.get(projectId);
      if (
        existing &&
        existing.lifecycleRequestId === lifecycleRequest.requestId
      ) {
        return existing.promise;
      }

      const requestEntry: ProjectWorktreeRequestCacheEntry = {
        lifecycleRequestId: lifecycleRequest.requestId,
        promise: procedures
          .listProjectWorktrees({ projectId })
          .then((result) => {
            if (!lifecycleRequest.isCurrent()) {
              return result.worktrees;
            }
            setProjectState(
              projectId,
              buildLoadedProjectWorktreesState(result.worktrees),
            );
            return result.worktrees;
          })
          .catch((error) => {
            if (lifecycleRequest.isCurrent()) {
              setProjectState(projectId, {
                loadingWorktrees: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            throw error;
          })
          .finally(() => {
            if (
              projectWorktreeRequestCacheRef.current.get(projectId) ===
              requestEntry
            ) {
              projectWorktreeRequestCacheRef.current.delete(projectId);
            }
          }),
      };
      projectWorktreeRequestCacheRef.current.set(projectId, requestEntry);
      return requestEntry.promise;
    },
    [procedures, setProjectState, snapshotProjectLifecycleRequest],
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
      const currentWorktrees = projectStateWorktrees(current);
      if ((options?.preferCached ?? true) && currentWorktrees.length > 0) {
        setProjectState(projectId, {
          loadingWorktrees: false,
          error: "",
        });
        if (options?.backgroundRefresh) {
          void requestProjectWorktrees(projectId).catch(() => {
            // Keep rendering the cached worktree list if the background refresh fails.
          });
        }
        return currentWorktrees;
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
        const detail = await executeWithStepUp(
          "create a thread outside the current workspace",
          () =>
            procedures.createThread({
              projectId,
              worktreePath,
              currentProjectId: selectedProjectIdRef.current,
              currentWorktreePath: selectedWorktreePathRef.current,
              model: activeCodexModel || defaultCodexModel || null,
              reasoningEffort:
                activeReasoningEffort || defaultCodexReasoningEffort || null,
              unsafeMode: activeUnsafeMode,
            }),
        );
        if (!detail) {
          return null;
        }
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
              // Ignore stale auto-thread cleanup failures; UI state stays tied to current selection.
            });
          return null;
        }

        upsertThread(detail.thread);
        setSelectedThreadId(detail.thread.id);
        selectedThreadIdRef.current = detail.thread.id;
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        setThreadMessages(detail.messages);
        syncThreadContext(detail.thread);
        setMobileProjectListOpen(false);
        try {
          await loadProjectWorktrees(detail.thread.projectId);
        } catch {
          // Ignore worktree refresh failures; thread creation flow remains functional.
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
      executeWithStepUp,
      loadProjectWorktrees,
      procedures,
      syncThreadContext,
      upsertThread,
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
          // Commit the full older-history backfill once so large threads do not
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
      setThreadMessages(detail.messages);
      startThreadHistoryBackfill(detail.thread.id, detail.nextCursor);
    },
    [startThreadHistoryBackfill],
  );

  const mergeSelectedThreadMessageHistory = useCallback(
    (detail: RpcThreadDetail) => {
      setThreadMessages((current) =>
        mergeThreadMessageHistory(current, detail.messages),
      );
    },
    [],
  );

  const clearThreadSelection = useCallback(() => {
    threadOpenRequestIdRef.current += 1;
    abortThreadOpenRequest("Thread selection was cleared.");
    abortThreadHistoryBackfill("Thread selection was cleared.");
    setSelectedThreadId(null);
    setThreadMessages([]);
    setChatError("");
    setModelControlError("");
    setIsThreadLoading(false);
    selectedThreadIdRef.current = null;
    selectedThreadRunStateRef.current = "idle";
  }, [abortThreadHistoryBackfill, abortThreadOpenRequest]);

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

  const refreshThreadStatuses = useCallback(
    async (threadIds: number[]) => {
      if (threadIds.length === 0) {
        return;
      }

      const activeSelectedThreadId = selectedThreadIdRef.current;
      const loadedThreadStatuses = applyOptimisticThreadErrorSeenToList(
        await procedures.listThreadStatuses({ threadIds }),
      );
      const selectedSummary =
        activeSelectedThreadId === null
          ? null
          : (loadedThreadStatuses.find(
              (thread) => thread.id === activeSelectedThreadId,
            ) ?? null);

      if (!selectedSummary) {
        setThreadStore((currentThreadStore) =>
          mergeThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
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
        setThreadStore((currentThreadStore) =>
          mergeThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
        return;
      }

      try {
        const detail = prepareOpenedThreadDetail(
          await procedures.getThread({
            threadId: selectedSummary.id,
          }),
        );
        const selectedThreadIdForCommit = selectedThreadIdRef.current;
        setThreadStore(
          (currentThreadStore) =>
            resolveThreadStatusRefreshOutcome({
              currentThreadStore,
              detail,
              loadedThreadStatuses,
              selectedSummaryThreadId: selectedSummary.id,
              selectedThreadId: selectedThreadIdForCommit,
            }).nextThreadStore,
        );
        if (selectedThreadIdForCommit !== selectedSummary.id) {
          return;
        }
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        mergeSelectedThreadMessageHistory(detail);
      } catch (error) {
        const selectedThreadIdForCommit = selectedThreadIdRef.current;
        setThreadStore(
          (currentThreadStore) =>
            resolveThreadStatusRefreshOutcome({
              currentThreadStore,
              detail: null,
              loadedThreadStatuses,
              selectedSummaryThreadId: selectedSummary.id,
              selectedThreadId: selectedThreadIdForCommit,
            }).nextThreadStore,
        );
        console.error(
          `Failed to refresh selected thread detail for ${selectedSummary.id}`,
          error,
        );
        return;
      }
    },
    [
      applyOptimisticThreadErrorSeenToList,
      mergeSelectedThreadMessageHistory,
      prepareOpenedThreadDetail,
      procedures,
    ],
  );

  const applyOpenedThreadDetail = useCallback(
    (detail: RpcThreadDetail) => {
      upsertThread(detail.thread);
      setSelectedThreadId(detail.thread.id);
      selectedThreadIdRef.current = detail.thread.id;
      selectedThreadRunStateRef.current = detail.thread.runStatus.state;
      replaceSelectedThreadMessageHistory(detail);
      syncThreadContext(detail.thread);
      if (sessionStateReady) {
        void loadProjectWorktrees(detail.thread.projectId).catch(() => {
          // Ignore metadata refresh failures; still render loaded thread history.
        });
      }
      setMobileProjectListOpen(false);
    },
    [
      loadProjectWorktrees,
      replaceSelectedThreadMessageHistory,
      sessionStateReady,
      syncThreadContext,
      upsertThread,
    ],
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
        createdDetail = await executeWithStepUp(
          "create a thread outside the current workspace",
          () =>
            procedures.createThread({
              projectId: request.projectId,
              worktreePath: request.worktreePath,
              currentProjectId: selectedProjectIdRef.current,
              currentWorktreePath: selectedWorktreePathRef.current,
              model: request.model,
              reasoningEffort: request.reasoningEffort,
              unsafeMode: request.unsafeMode,
            }),
        );
        if (!createdDetail) {
          return;
        }

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
      executeWithStepUp,
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
      const optimisticThread = threadStore.byId[threadId] ?? null;
      abortThreadOpenRequest("Thread open request was superseded.");
      abortThreadHistoryBackfill("Thread open request was superseded.");
      const controller = new AbortController();
      threadOpenAbortControllerRef.current = controller;
      setSelectedThreadId(threadId);
      selectedThreadIdRef.current = threadId;
      selectedThreadRunStateRef.current =
        optimisticThread?.runStatus.state ?? "idle";
      setThreadMessages([]);
      if (optimisticThread) {
        syncThreadContext(optimisticThread);
      }
      setMobileProjectListOpen(false);
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
          upsertThread(detail.thread);
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
      abortThreadHistoryBackfill,
      abortThreadOpenRequest,
      applyOpenedThreadDetail,
      loadThreadDetailForOpen,
      prepareOpenedThreadDetail,
      syncThreadContext,
      threadStore,
      upsertThread,
    ],
  );

  const syncSelectedWorktreeThread = useCallback(
    (projectId: number, worktreePath: string): void => {
      const preferredThread = preferredThreadForWorktree(
        threads,
        projectId,
        worktreePath,
      );
      if (preferredThread) {
        if (selectedThreadIdRef.current === preferredThread.id) {
          return;
        }
        if (threadOpenAbortControllerRef.current !== null) {
          return;
        }
        void openThread(preferredThread.id, {
          selectionGuard: {
            projectId,
            worktreePath,
          },
        });
        return;
      }

      if (
        selectedProjectIdRef.current !== projectId ||
        selectedWorktreePathRef.current !== worktreePath ||
        selectedThreadIdRef.current !== null ||
        threadOpenAbortControllerRef.current !== null
      ) {
        return;
      }

      const key = worktreeKey(projectId, worktreePath);
      if (autoThreadCreationWorktreeKeysRef.current.has(key)) {
        return;
      }

      autoThreadCreationWorktreeKeysRef.current.add(key);
      void createThreadForWorktree(projectId, worktreePath, {
        requireNoSelectedThread: true,
      }).finally(() => {
        autoThreadCreationWorktreeKeysRef.current.delete(key);
      });
    },
    [createThreadForWorktree, openThread, threads],
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
        threadDetail: bootstrapThreadDetail,
        threads: loadedThreads,
      } = await procedures.getAppBootstrap(
        {
          selectedProjectId: persistedState.selectedProjectId,
          selectedWorktreePath: persistedState.selectedWorktreePath,
          threadIdHint: persistedState.selectedThreadId,
        },
        {
          priority: "foreground",
        },
      );
      let startupThreads = threadStoreItems(createThreadStore(loadedThreads));
      let initialThread = pickInitialThread(startupThreads, persistedState);
      let initialThreadDetailPromise: Promise<RpcThreadDetail> | null = null;
      if (initialThread) {
        try {
          const initialThreadDetail =
            bootstrapThreadDetail?.thread.id === initialThread.id
              ? bootstrapThreadDetail
              : await procedures.getThread(
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
      const startupProjects = closeProjectsForStartupRestore(loadedProjects);
      const initialThreadProject =
        initialThread === null
          ? undefined
          : startupProjects.find(
              (project) => project.id === initialThread.projectId,
            );
      const initialProject =
        initialThreadProject ??
        startupProjects.find(
          (project) => project.id === persistedState.selectedProjectId,
        ) ??
        startupProjects[0] ??
        null;
      const initialWorktreePath =
        initialThread?.worktreePath ??
        (initialProject === null
          ? null
          : initialProject.id === persistedState.selectedProjectId &&
              persistedState.selectedWorktreePath
            ? persistedState.selectedWorktreePath
            : initialProject.path);

      replaceProjects(startupProjects);
      replaceThreads(startupThreads);
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

      const startupWorktreesToOpen = new Map<
        string,
        {
          projectId: number;
          worktreePath: string;
        }
      >();
      for (const entry of persistedState.openWorktrees) {
        if (!restoredOpenProjectIds.has(entry.projectId)) {
          continue;
        }
        startupWorktreesToOpen.set(
          worktreeKey(entry.projectId, entry.worktreePath),
          entry,
        );
      }
      if (initialThread) {
        startupWorktreesToOpen.set(
          worktreeKey(initialThread.projectId, initialThread.worktreePath),
          {
            projectId: initialThread.projectId,
            worktreePath: initialThread.worktreePath,
          },
        );
      }

      await Promise.resolve();

      const initialThreadOpenPromise = initialThread
        ? openThread(initialThread.id, {
            detailPromise: initialThreadDetailPromise,
          })
        : null;

      const restoredProjects = startupProjects.filter((project) =>
        restoredOpenProjectIds.has(project.id),
      );

      for (const project of restoredProjects) {
        setProjectState(project.id, {
          loadingWorktrees:
            initiallyOpenProjectTreePaths.has(project.path) &&
            projectStateWorktrees(getProjectState(project.id)).length === 0,
          error: "",
        });
      }

      let startupProjectsAfterRestore = startupProjects;
      const restoredProjectWorktreesById = new Map<number, RpcWorktree[]>();
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
        const reconciledRestore = reconcileStartupProjectRestore({
          allowSelectedProjectFallback: initialThread === null,
          projects: startupProjects,
          results: restoredProjectResults,
          selectedProjectId: selectedProjectIdRef.current,
          selectedWorktreePath: selectedWorktreePathRef.current,
        });
        startupProjectsAfterRestore = reconciledRestore.projects;
        replaceProjects(reconciledRestore.projects);
        for (const path of reconciledRestore.failedProjectPaths) {
          setProjectTreeOpen(path, false);
        }
        if (
          reconciledRestore.selectedProjectId !==
            selectedProjectIdRef.current ||
          reconciledRestore.selectedWorktreePath !==
            selectedWorktreePathRef.current
        ) {
          selectedProjectIdRef.current = reconciledRestore.selectedProjectId;
          selectedWorktreePathRef.current =
            reconciledRestore.selectedWorktreePath;
          setSelectedProjectId(reconciledRestore.selectedProjectId);
          setSelectedWorktreePath(reconciledRestore.selectedWorktreePath);
        }
        for (const result of restoredProjectResults) {
          if (result.ok) {
            restoredProjectWorktreesById.set(
              result.project.id,
              result.worktrees,
            );
            setProjectState(
              result.project.id,
              buildLoadedProjectWorktreesState(result.worktrees),
            );
            continue;
          }

          setProjectState(result.projectId, {
            loadingWorktrees: false,
            error: result.error,
          });
        }
      }

      const confirmedRestoredOpenProjectIds = new Set(
        startupProjectsAfterRestore
          .filter((project) => project.isOpen === 1)
          .map((project) => project.id),
      );
      const worktreesToRestore = filterStartupWorktreeRestoreRequests(
        [...startupWorktreesToOpen.values()],
        confirmedRestoredOpenProjectIds,
      );
      const restoredOpenWorktrees =
        worktreesToRestore.length > 0
          ? await procedures.openWorktreesBatch(
              {
                worktrees: worktreesToRestore,
              },
              {
                priority: "foreground",
              },
            )
          : [];

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

      const selectedProjectAfterRestore =
        selectedProjectIdRef.current === null
          ? null
          : (startupProjectsAfterRestore.find(
              (project) => project.id === selectedProjectIdRef.current,
            ) ?? null);
      const selectedProjectWorktreesAfterRestore =
        selectedProjectAfterRestore === null
          ? []
          : (restoredProjectWorktreesById.get(selectedProjectAfterRestore.id) ??
            projectStateWorktrees(
              getProjectState(selectedProjectAfterRestore.id),
            ));
      const reconciledSelectedWorktreePath =
        reconcileStartupSelectedWorktreePath({
          allowFallback: initialThread === null,
          project: selectedProjectAfterRestore,
          restoredOpenWorktrees,
          selectedWorktreePath: selectedWorktreePathRef.current,
          worktrees: selectedProjectWorktreesAfterRestore,
        });
      if (reconciledSelectedWorktreePath !== selectedWorktreePathRef.current) {
        selectedWorktreePathRef.current = reconciledSelectedWorktreePath;
        setSelectedWorktreePath(reconciledSelectedWorktreePath);
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
    replaceProjects,
    replaceThreads,
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

      if (
        !shouldRefreshProjectActionMenuWorktrees(getProjectState(project.id))
      ) {
        return;
      }

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
    [closeThreadActionMenu, getProjectState, loadProjectWorktrees],
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
        setProjectState(
          projectActionMenu.projectId,
          buildLoadedProjectWorktreesState(result.worktrees),
        );
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

    /**
     * Handles pointer down.
     * @param event - event argument for handlePointerDown.
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
     * @param event - event argument for handleKeyDown.
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
     * @param event - event argument for handlePointerDown.
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
     * @param event - event argument for handleKeyDown.
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

  const polledThreadIds = useMemo(
    () =>
      threads
        .filter((thread) => thread.runStatus.state === "working")
        .map((thread) => thread.id),
    [threads],
  );

  useEffect(() => {
    const wasVisible = previousDocumentVisibilityRef.current;
    previousDocumentVisibilityRef.current = isDocumentVisible;
    if (!isDocumentVisible || wasVisible || polledThreadIds.length === 0) {
      return;
    }
    if (threadStatusPollInFlightRef.current) {
      return;
    }

    threadStatusPollInFlightRef.current = true;
    void refreshThreadStatuses(polledThreadIds)
      .catch((error) => {
        console.error(
          "Failed to refresh thread statuses after document became visible",
          error,
        );
      })
      .finally(() => {
        threadStatusPollInFlightRef.current = false;
      });
  }, [isDocumentVisible, polledThreadIds, refreshThreadStatuses]);

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
      pendingThreadUnsafeMode: false,
      chatInput: "",
      sidebarCollapsed,
      sidebarSearchQuery,
      openWorktrees: serializeOpenWorktrees(projectStates),
    };
  }, [
    pendingThreadModel,
    pendingThreadReasoningEffort,
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
    if (!sessionStateReady) {
      return;
    }
    if (!selectedThread) {
      gitHistoryRefreshedThreadIdRef.current = null;
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      selectedThread.projectId !== selectedProject.id ||
      selectedThread.worktreePath !== activeSelectedWorktreePath
    ) {
      return;
    }
    if (gitHistoryRefreshedThreadIdRef.current === selectedThread.id) {
      return;
    }

    gitHistoryRefreshedThreadIdRef.current = selectedThread.id;
    void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
      preferCached: true,
    });
  }, [
    activeSelectedWorktreePath,
    loadGitHistory,
    selectedProject,
    selectedThread,
    sessionStateReady,
  ]);

  useEffect(() => {
    const unsubscribe = subscribeToWorktreeTasksChanged((payload) => {
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
        payload.projectId !== selectedProject.id ||
        payload.worktreePath !== activeSelectedWorktreePath
      ) {
        return;
      }
      void loadProjectTasks(payload.projectId, payload.worktreePath, {
        priority: "default",
      });
    });
    return unsubscribe;
  }, [
    activeSelectedWorktreePath,
    activeSelectedWorktreeOpened,
    loadProjectTasks,
    sessionStateReady,
    selectedProject,
  ]);

  useEffect(() => {
    const unsubscribe = subscribeToWorktreeGitHistoryChanged((payload) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        return;
      }
      if (
        payload.projectId !== selectedProject.id ||
        payload.worktreePath !== activeSelectedWorktreePath
      ) {
        return;
      }
      void loadGitHistory(payload.projectId, payload.worktreePath, {
        silent: true,
      });
    });
    return unsubscribe;
  }, [activeSelectedWorktreePath, loadGitHistory, selectedProject]);

  useEffect(() => {
    /**
     * Handles thread start request created.
     * @param event - event argument for handleThreadStartRequestCreated.
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

    /**
     * Handles key down.
     * @param event - event argument for handleKeyDown.
     */

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
    const preferredThread = preferredThreadForWorktree(
      threads,
      selectedProjectId,
      activeSelectedWorktreePath,
    );
    if (!preferredThread) {
      if (selectedThreadId !== null) {
        clearThreadSelection();
      }
      syncSelectedWorktreeThread(selectedProjectId, activeSelectedWorktreePath);
      return;
    }
    if (selectedThreadId === preferredThread.id) {
      return;
    }
    syncSelectedWorktreeThread(selectedProjectId, activeSelectedWorktreePath);
  }, [
    activeSelectedWorktreePath,
    activeSelectedWorktreeOpened,
    clearThreadSelection,
    selectedProjectId,
    selectedThread,
    selectedThreadId,
    syncSelectedWorktreeThread,
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
    if (polledThreadIds.length === 0) {
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
        await refreshThreadStatuses(polledThreadIds);
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
  }, [polledThreadIds, refreshThreadStatuses, threads.length]);

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
        upsertThread(updatedThread);
        setPendingThreadUnsafeMode(updatedThread.unsafeMode);
      } catch (error) {
        setUnsafeModeControlError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsUpdatingThreadUnsafeMode(false);
      }
    },
    [isUpdatingThreadUnsafeMode, procedures, selectedThread, upsertThread],
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
        const detail = await executeWithStepUp("run this project task", () =>
          procedures.runProjectTask({
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
          }),
        );
        if (!detail) {
          return;
        }
        upsertThread(detail.thread);
        if (
          selectedProjectIdRef.current !== requestedProjectId ||
          selectedWorktreePathRef.current !== requestedWorktreePath
        ) {
          return;
        }
        setSelectedThreadId(detail.thread.id);
        selectedThreadIdRef.current = detail.thread.id;
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        if (selectedThreadIdRef.current === detail.thread.id) {
          mergeSelectedThreadMessageHistory(detail);
        } else {
          replaceSelectedThreadMessageHistory(detail);
        }
        syncThreadContext(detail.thread);
        setMobileProjectListOpen(false);
        try {
          await loadProjectWorktrees(detail.thread.projectId);
        } catch {
          // Ignore worktree-refresh failures so task execution remains available.
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
      executeWithStepUp,
      loadProjectWorktrees,
      mergeSelectedThreadMessageHistory,
      procedures,
      replaceSelectedThreadMessageHistory,
      selectedProject,
      selectedThread,
      syncThreadContext,
      upsertThread,
    ],
  );

  const handleCreateThreadForWorktree = useCallback(
    (projectId: number, worktreePath: string) => {
      void createThreadForWorktree(projectId, worktreePath);
    },
    [createThreadForWorktree],
  );

  const handleCreateThreadForActiveWorktree = useCallback(() => {
    if (
      !selectedProject ||
      !activeSelectedWorktreePath
    ) {
      return;
    }
    void createThreadForWorktree(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
  }, [
    activeSelectedWorktreePath,
    createThreadForWorktree,
    selectedProject,
  ]);

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
      const lifecycleRequest = beginProjectLifecycleRequest(project.id);
      const current = getProjectState(project.id);
      const hasCachedWorktrees = projectStateWorktrees(current).length > 0;
      if (expanded) {
        setProjectTreeOpen(project.path, true);
      }
      setProjectState(project.id, {
        loadingWorktrees: expanded && !hasCachedWorktrees,
        error: "",
      });

      if (!expanded) {
        await runRollbackSafeProjectClose({
          closeProject: async () => {
            await procedures.closeProject({ projectId: project.id });
          },
          commitLocalClose: () => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            clearProjectWorktreeToggleRequests(project.id);
            setWorktreeStates((prev) => {
              const next = { ...prev } as WorktreeStateMap;
              const keyPrefix = `${project.id}::`;
              for (const key of Object.keys(next)) {
                if (key.startsWith(keyPrefix)) {
                  delete next[key];
                }
              }
              return next;
            });
            setProjectState(project.id, {
              openWorktrees: new Set(),
              loadingWorktrees: false,
              error: "",
            });
            upsertProject({
              ...project,
              isOpen: 0,
            });
            setProjectTreeOpen(project.path, false);
            if (selectedProjectIdRef.current === project.id) {
              selectedWorktreePathRef.current = project.path;
              setSelectedWorktreePath(project.path);
            }
          },
          onCloseError: (error) => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            setProjectState(project.id, {
              loadingWorktrees: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
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
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            upsertProject(result.project);
            setProjectState(
              project.id,
              buildLoadedProjectWorktreesState(result.worktrees),
            );
          })
          .catch((error) => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
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
        if (!lifecycleRequest.isCurrent()) {
          return;
        }
        upsertProject(result.project);
        setProjectState(
          project.id,
          buildLoadedProjectWorktreesState(result.worktrees),
        );
        if (!selectedProjectId) {
          selectProject(project);
        }
      } catch (error) {
        if (!lifecycleRequest.isCurrent()) {
          return;
        }
        setProjectState(project.id, {
          loadingWorktrees: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      beginProjectLifecycleRequest,
      clearProjectWorktreeToggleRequests,
      getProjectState,
      setProjectState,
      procedures,
      selectedProjectId,
      selectProject,
      upsertProject,
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
      getWorktreeState,
      finishWorktreeToggleRequest,
      isCurrentWorktreeToggleRequest,
      primeProjectTasks,
      primeGitHistoryResult,
      procedures,
      setWorktreeState,
      updateProjectState,
    ],
  );

  useEffect(() => {
    /**
     * Handles context focus changed.
     * @param event - event argument for handleContextFocusChanged.
     */

    const handleContextFocusChanged = (
      event: CustomEvent<RpcContextFocusChanged>,
    ) => {
      if (!sessionStateReady) {
        return;
      }

      const payload = event.detail;
      void (async () => {
        try {
          const openedProject = await procedures.openProject(
            {
              projectPath: payload.projectPath,
              name: payload.projectName,
            },
            {
              priority: "foreground",
            },
          );
          upsertProject(openedProject.project);
          setProjectState(
            openedProject.project.id,
            buildLoadedProjectWorktreesState(openedProject.worktrees),
          );

          const targetWorktreePath =
            payload.worktreePath ??
            primaryWorktreePath(openedProject.project, openedProject.worktrees);
          selectProject(openedProject.project, targetWorktreePath);
          await ensureWorktreeOpen(
            openedProject.project.id,
            targetWorktreePath,
          );

          if (payload.threadId !== null) {
            await openThread(payload.threadId);
          }
        } catch (error) {
          console.error("Failed to apply focused Jolt context", error);
        }
      })();
    };

    window.addEventListener(
      CONTEXT_FOCUS_CHANGED_EVENT_NAME,
      handleContextFocusChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        CONTEXT_FOCUS_CHANGED_EVENT_NAME,
        handleContextFocusChanged as EventListener,
      );
    };
  }, [
    ensureWorktreeOpen,
    openThread,
    procedures,
    selectProject,
    sessionStateReady,
    setProjectState,
    upsertProject,
  ]);

  const handleProjectWorktreeClick = useCallback(
    (project: RpcProject, worktreePath: string) => {
      setThreadsError("");
      const target = getWorktreeState(project.id, worktreePath);
      const alreadySelected =
        selectedProjectIdRef.current === project.id &&
        selectedWorktreePathRef.current === worktreePath;
      if (!alreadySelected) {
        clearThreadSelection();
        selectProject(project, worktreePath);
      }
      syncSelectedWorktreeThread(project.id, worktreePath);
      if (target.opened || target.loading) {
        return;
      }
      void ensureWorktreeOpen(project.id, worktreePath);
    },
    [
      clearThreadSelection,
      ensureWorktreeOpen,
      getWorktreeState,
      selectProject,
      syncSelectedWorktreeThread,
    ],
  );

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }
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
    sessionStateReady,
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

  const visibleMessages = useMemo<VisibleMessage[]>(() => {
    const visibleMessageCache = visibleMessageCacheRef.current;
    let messages: VisibleMessage[];
    const hasInProgressAssistantChat = threadMessages.some(
      (message) =>
        message.kind === "chat" &&
        message.role === "assistant" &&
        message.state === "in_progress",
    );
    if (isThreadLoading) {
      messages = [
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-loading:${selectedThreadId ?? "none"}`,
          "chat:normal:assistant:Loading thread history...",
          () => ({
            key: `thread-loading:${selectedThreadId ?? "none"}`,
            kind: "chat",
            speaker: "assistant",
            tone: "normal",
            text: "Loading thread history...",
          }),
        ),
      ];
    } else if (!selectedThread) {
      const emptyThreadMessageText = selectedProject
        ? `Use the Threads panel or the selected worktree popover in the sidebar to create or open a ${APP_TITLE} thread.`
        : "Add a project, choose a worktree, and create a thread to begin.";
      messages = [
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
          `chat:normal:assistant:${emptyThreadMessageText}`,
          () => ({
            key: `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
            kind: "chat",
            speaker: "assistant",
            tone: "normal",
            text: emptyThreadMessageText,
          }),
        ),
      ];
    } else if (threadMessages.length === 0) {
      const threadReadyMessageText = `Thread ready in ${selectedProject?.name ?? "this project"} · ${activeSelectedWorktreeFolder}. Ask ${APP_TITLE} to inspect, refactor, or debug this worktree.`;
      messages = [
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-ready:${selectedThread.id}`,
          `chat:normal:assistant:${threadReadyMessageText}`,
          () => ({
            key: `thread-ready:${selectedThread.id}`,
            kind: "chat",
            speaker: "assistant",
            tone: "normal",
            text: threadReadyMessageText,
          }),
        ),
      ];
    } else {
      messages = threadMessages.map((message) =>
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-message:${message.id}`,
          threadMessageVisibleSignature(message),
          () => buildThreadVisibleMessage(message),
        ),
      );
    }
    if (
      selectedThread?.runStatus.state === "working" &&
      !hasInProgressAssistantChat
    ) {
      messages.push(
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-working:${selectedThread.id}:${selectedThread.updatedAt}`,
          "chat:working:assistant:Processing",
          () => ({
            key: `thread-working:${selectedThread.id}:${selectedThread.updatedAt}`,
            kind: "chat",
            speaker: "assistant",
            tone: "working",
            text: "Processing",
          }),
        ),
      );
    }
    if (activeChatError) {
      messages.push(
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
          `chat:error:assistant:${activeChatError}`,
          () => ({
            key: `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
            kind: "chat",
            speaker: "assistant",
            tone: "error",
            text: activeChatError,
          }),
        ),
      );
    }
    if (activeChatNotice) {
      messages.push(
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
          `chat:notice:assistant:${activeChatNotice}`,
          () => ({
            key: `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
            kind: "chat",
            speaker: "assistant",
            tone: "notice",
            text: activeChatNotice,
          }),
        ),
      );
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
                    onRefreshProject: refreshProject,
                    onSelectDirectorySuggestion: selectDirectorySuggestion,
                    onSubmitAddProject: submitAddProject,
                    onToggleAddProjectForm: toggleAddProjectForm,
                    onToggleWorktreePinned: handleToggleWorktreePinned,
                    projectById,
                    projectThreadErrorLevel,
                    selectedProjectId,
                    sidebarActionButtonClass,
                    supportsTildePath,
                    worktreePinBusyPath,
                    worktreeDisplayPathByKey,
                    worktreeSearchTextByKey,
                    worktreeThreadErrorLevel,
                  }}
                  selectedProjectName={selectedProject?.name ?? null}
                  sidebarSearchQuery={sidebarSearchQuery}
                  workspacePanelProps={{
                    acknowledgeThreadErrorSeenInBackground,
                    activeSelectedWorktreeBranch:
                      activeSelectedWorktree?.branch?.trim() || "Primary",
                    activeSelectedWorktreeFolder:
                      activeSelectedWorktreePath
                        ? formatPathForDisplay(
                            activeSelectedWorktreePath,
                            homeDirectory,
                            true,
                          )
                        : activeSelectedWorktreeFolder || "Current worktree",
                    canCreateThread:
                      selectedProject !== null && activeSelectedWorktreePath !== null,
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
                      selectedProject?.name ?? "Current project",
                    threadPreviewsDisabled: threadActionMenu !== null,
                    threadActivityIndicator,
                    threadsError,
                    worktreeDisplayPathByKey,
                    workspaceActiveThreads: filteredWorkspaceActiveThreads,
                    workspacePinnedThreads: filteredWorkspacePinnedThreads,
                    worktreeByProjectAndPath,
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
                onRefreshProject: refreshProject,
                onSelectDirectorySuggestion: selectDirectorySuggestion,
                onSubmitAddProject: submitAddProject,
                onToggleAddProjectForm: toggleAddProjectForm,
                onToggleWorktreePinned: handleToggleWorktreePinned,
                projectById,
                projectThreadErrorLevel,
                selectedProjectId,
                sidebarActionButtonClass,
                supportsTildePath,
                worktreePinBusyPath,
                worktreeDisplayPathByKey,
                worktreeSearchTextByKey,
                worktreeThreadErrorLevel,
              }}
              selectedProjectName={selectedProject?.name ?? null}
              sidebarSearchQuery={sidebarSearchQuery}
              workspacePanelProps={{
                acknowledgeThreadErrorSeenInBackground,
                activeSelectedWorktreeBranch:
                  activeSelectedWorktree?.branch?.trim() || "Primary",
                activeSelectedWorktreeFolder:
                  activeSelectedWorktreePath
                    ? formatPathForDisplay(
                        activeSelectedWorktreePath,
                        homeDirectory,
                        true,
                      )
                    : activeSelectedWorktreeFolder || "Current worktree",
                canCreateThread:
                  selectedProject !== null && activeSelectedWorktreePath !== null,
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
                  selectedProject?.name ?? "Current project",
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
          <nav className="grid h-16 grid-cols-2 items-center bg-[#0e0e0e]">
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
                isThreadStatusDismissed={isThreadStatusDismissed}
                onOpenThread={handleOpenThread}
                onOpenThreadActionMenu={openThreadActionMenu}
                previewDisabled={threadActionMenu !== null}
                projectById={projectById}
                selectedThreadId={selectedThreadId}
                threadActivityIndicator={threadActivityIndicator}
                threads={selectedWorktreeThreads}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
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
      <AuthStepUpDialog
        actionLabel={stepUpActionLabel}
        busy={isSubmittingStepUp}
        error={stepUpError}
        onCancel={() => {
          closeStepUpDialog(false);
        }}
        onPrimaryFactorChange={(value) => {
          setStepUpPrimaryFactor(
            primaryFactorType === "pin" ? value.replace(/\D+/g, "") : value,
          );
        }}
        onSubmit={submitStepUp}
        onTotpCodeChange={(value) => {
          setStepUpTotpCode(value.replace(/\D+/g, ""));
        }}
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
