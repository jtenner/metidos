/**
 * @file src/mainview/App.tsx
 * @description Module for app.
 */

import {
  type FormEvent,
  type JSX,
  lazy,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RpcCalendarReminderDelivery } from "../bun/calendar/types";
import type {
  ProjectProcedures,
  RpcGitHistoryEntry,
  RpcModelCatalog,
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcProject,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadPermissionDescriptor,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcUserNotificationDelivery,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
} from "../bun/rpc-schema";
import { MODEL_CATALOG_REFRESH_INTERVAL_MS } from "../shared/provider-refresh";
import { ProjectActionMenu, ThreadActionMenu } from "./app/action-menus";
import {
  readFrontendGitCacheTelemetry,
  useFrontendMemoryTelemetry,
  type FrontendMemoryTelemetrySnapshot,
} from "./app/frontend-memory-telemetry";
import { createAbortError, isAbortError } from "./app/async-request-state";
import {
  CALENDAR_NOTIFICATIONS_DUE_EVENT_NAME,
  limitCalendarNotifications,
  limitUserNotifications,
  mergeCalendarNotifications,
  mergeUserNotifications,
  showBrowserCalendarNotification,
  USER_NOTIFICATION_SENT_EVENT_NAME,
} from "./app/calendar-notifications";
import { DesktopChatView, MobileChatView } from "./app/chat-workspace";
import { DesktopSidebar } from "./app/desktop-sidebar";
import { DesktopSidebarContent } from "./app/desktop-sidebar-content";
import { DesktopThreadSwitcher } from "./app/desktop-thread-switcher";
import { MainviewCronWorkspaceController } from "./app/mainview-cron-workspace-controller";
import { FolderPathSelectorControl } from "./app/folder-path-selector-control";
import {
  applyMainviewShellThreadStartRequestCreated,
  applyMainviewShellThreadStartRequestResolved,
  applyMainviewShellThreadStatusEvent,
  buildMainviewShellHiddenWorktreeHydration,
  buildMainviewShellOpenedWorktreeHydration,
  buildMainviewShellProjectWorktreeHydration,
  buildMainviewShellSelectedThreadDetailRefreshState,
  buildMainviewShellWorktreePinRollback,
  clearMainviewShellCompletedThreadIndicator,
  haveSameMainviewShellCompletedThreadIndicatorIds,
  planMainviewShellHiddenWorktreeOpen,
  planMainviewShellWorktreePin,
  readMainviewShellThreadActivityIndicator,
  resolveMainviewShellCompletedThreadIndicators,
  type MainviewPrimaryView,
  selectMainviewShellProject,
} from "./app/mainview-shell-state";
import { APP_TITLE } from "./app/mainview-ui-state";
import {
  modelCatalogsEqual,
  subscribeToModelCatalogChanged,
} from "./app/model-catalog-events";
import { formatDirectoryPathForInput } from "./app/path-display-state";
import {
  useInitialMainviewState,
  useMainviewShellController,
} from "./app/use-mainview-shell-controller";
import {
  createProjectStore,
  emptyProjectStore,
  type ProjectStore,
  projectStoreItems,
  upsertProjectStore,
} from "./app/project-store";
import {
  defaultProjectState,
  defaultWorktreeState,
  type ProjectNodeState,
  type ProjectStateMap,
  projectStateWorktrees,
  pruneProjectStates,
  pruneWorktreeStates,
  type WorktreeNodeState,
  type WorktreeStateMap,
  worktreeKey,
} from "./app/project-worktree-state";
import { safeExternalHttpUrl } from "./app/safe-external-url";

import { SidebarContent } from "./app/sidebar-content";
import { setProjectTreeOpen } from "./app/sidebar-panels-state";
import { deriveSafeChildAccessDefaults } from "./app/thread-access-defaults";
import {
  sanitizeThreadAccessValue,
  threadAccessPermissionsWereSanitized,
} from "./app/thread-access-sanitization";

import {
  mergeTranscriptMediaPayloadData,
  type TranscriptMediaPayloadCacheEntry,
  writeTranscriptMediaPayloads,
} from "./app/transcript-media-payload-cache";

import {
  createThreadStore,
  emptyThreadStore,
  pruneThreadStore,
  removeThreadFromStore,
  type ThreadStore,
  threadStoreItems,
  upsertThreadStore,
  withAcknowledgedUnreadThread,
  withAcknowledgedUnreadThreadDetail,
} from "./app/thread-store";
import {
  isCodexReasoningEffort,
  type ProjectActionMenuState,
  THREAD_START_REQUEST_CREATED_EVENT_NAME,
  THREAD_START_REQUEST_RESOLVED_EVENT_NAME,
  THREAD_STATUS_CHANGED_EVENT_NAME,
  type ThreadActionMenuState,
} from "./app/thread-ui-state";
import { useAccessPermissions } from "./app/use-access-permissions";
import { useAddProjectForm } from "./app/use-add-project-form";
import { useDesktopThreadSwitcher } from "./app/use-desktop-thread-switcher";
import { useGitHistoryController } from "./app/use-git-history-controller";
import { useMainviewDerivedState } from "./app/use-mainview-derived-state";
import { useMainviewStartupController } from "./app/use-mainview-startup-controller";
import { useMainviewStalenessRefreshController } from "./app/use-mainview-staleness-refresh-controller";
import { useThreadTurnBusyState } from "./app/use-thread-turn-controller";
import { useProjectSkills } from "./app/use-project-skills";
import { useProjectWorktreeController } from "./app/use-project-worktree-controller";
import {
  readPersistedChatDraft,
  schedulePersistedChatDraftWrite,
  useTerminalsController,
} from "./app/use-terminals-controller";
import { useThreadExtensionUiController } from "./app/use-thread-extension-ui-controller";
import { useThreadWorkspaceController } from "./app/use-thread-workspace-controller";
import { stripThreadMessageMediaPayloadData } from "./app/transcript-state";
import { useVisibleMessages } from "./app/use-visible-messages";
import { useWorktreeDiff } from "./app/use-worktree-diff";
import { logClientError, logClientEvent } from "./client-logging";
import { brandLogoIcon } from "./controls/brand-logo";
import { AppButton, NotificationButton, TabButton } from "./controls/button";
import {
  chatComposerDraftKey,
  pruneChatComposerDraftsForActiveThreads,
} from "./controls/chat-composer-draft-store";
import {
  codexModelSelectorLabel,
  codexModelSupportsThinkingLevel,
  codexReasoningPresentation,
  findCodexModel,
} from "./controls/codex-utils";
import { materialSymbol } from "./controls/icons";
import { PopoverSurface } from "./controls/popover";
import { StatusIcon } from "./controls/status-icon";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
} from "./controls/search-utils";
import { devLog } from "./dev-log";
import { derivePrimaryViewForPinnedThreadOpen } from "./thread-workspace-selection";

type AppProps = {
  isAdmin: boolean;
  procedures: ProjectProcedures;
};

const CalendarWorkspace = lazy(async () => {
  const module = await import("./app/calendar-workspace");
  return { default: module.CalendarWorkspace };
});

const DiffWorkspace = lazy(async () => {
  const module = await import("./app/diff-workspace");
  return { default: module.DiffWorkspace };
});

const GitHistoryDiffModal = lazy(async () => {
  const module = await import("./app/git-history-diff-modal");
  return { default: module.GitHistoryDiffModal };
});

const SettingsPanel = lazy(async () => {
  const module = await import("./app/settings-panel");
  return { default: module.SettingsPanel };
});

const ThreadExtensionUiDialog = lazy(async () => {
  const module = await import("./app/thread-extension-ui-dialog");
  return { default: module.ThreadExtensionUiDialog };
});

const ThreadStartRequestDialog = lazy(async () => {
  const module = await import("./app/thread-start-request-dialog");
  return { default: module.ThreadStartRequestDialog };
});

/**
 * App-level sizing and interaction constants for responsive layout decisions.
 */

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
type PrimaryView = MainviewPrimaryView;
const PRIMARY_VIEW_TAB_IDS = {
  desktop: {
    chat: "desktop-primary-view-tab-chat",
    diff: "desktop-primary-view-tab-diff",
    cronjobs: "desktop-primary-view-tab-cronjobs",
    calendar: "desktop-primary-view-tab-calendar",
  },
  mobile: {
    chat: "mobile-primary-view-tab-chat",
    diff: "mobile-primary-view-tab-diff",
    cronjobs: "mobile-primary-view-tab-cronjobs",
    calendar: "mobile-primary-view-tab-calendar",
  },
} satisfies Record<"desktop" | "mobile", Record<PrimaryView, string>>;

const PRIMARY_VIEW_PANEL_IDS = {
  desktop: {
    chat: "desktop-primary-view-panel-chat",
    diff: "desktop-primary-view-panel-diff",
    cronjobs: "desktop-primary-view-panel-cronjobs",
    calendar: "desktop-primary-view-panel-calendar",
  },
  mobile: {
    chat: "mobile-primary-view-panel-chat",
    diff: "mobile-primary-view-panel-diff",
    cronjobs: "mobile-primary-view-panel-cronjobs",
    calendar: "mobile-primary-view-panel-calendar",
  },
} satisfies Record<"desktop" | "mobile", Record<PrimaryView, string>>;

const PRIMARY_VIEW_TAB_ORDER = {
  desktop: ["chat", "diff", "cronjobs", "calendar"],
  mobile: ["diff", "cronjobs", "calendar", "chat"],
} satisfies Record<"desktop" | "mobile", PrimaryView[]>;

const THREAD_MESSAGE_CONTENT_RPC_TIMEOUT_MS = 60_000;
const OPTIMISTIC_THREAD_ERROR_SEEN_TTL_MS = 120_000;

/**
 * Memoized chat surfaces form a feature-island boundary inside the root App.
 * Keeping this branch behind React.memo lets unrelated shell state updates
 * (cron editor fields, sidebar search, calendar notifications, dialogs) bail
 * out before traversing the transcript and composer subtree when chat props are
 * unchanged.
 */
const MemoizedDesktopChatView = memo(DesktopChatView);
const MemoizedMobileChatView = memo(MobileChatView);

type WorkspaceLoadingFallbackProps = {
  label: string;
  variant?: "desktop" | "mobile" | "popover";
};

function WorkspaceLoadingFallback({
  label,
  variant = "desktop",
}: WorkspaceLoadingFallbackProps): JSX.Element {
  if (variant === "popover") {
    return (
      <div
        className="px-3 py-2 text-xs text-text-muted"
        role="status"
        aria-live="polite"
      >
        {label}
      </div>
    );
  }

  const spacingClass =
    variant === "mobile" ? "px-4 py-6" : "min-h-0 flex-1 px-6 py-6";

  return (
    <div className={`flex ${spacingClass}`} role="status" aria-live="polite">
      <div className="w-full border-t border-border-subtle pt-3 text-xs text-text-muted">
        {label}
      </div>
    </div>
  );
}

/**
 * Subscribes to a media query and keeps a boolean in sync with viewport width.
 */

function subscribeDesktopViewport(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
  };
}

function getDesktopViewportSnapshot(): boolean {
  return typeof window !== "undefined"
    ? window.matchMedia(DESKTOP_MEDIA_QUERY).matches
    : false;
}

function useDesktopViewport(): boolean {
  return useSyncExternalStore(
    subscribeDesktopViewport,
    getDesktopViewportSnapshot,
    getDesktopViewportSnapshot,
  );
}

type SidebarPinnedFolderRow = {
  displayPath: string;
  project: RpcProject;
  worktree: RpcWorktree;
};

function compareSidebarPinnedFolderRows(
  left: SidebarPinnedFolderRow,
  right: SidebarPinnedFolderRow,
): number {
  const pinCompare = (right.worktree.pinnedAt ?? "").localeCompare(
    left.worktree.pinnedAt ?? "",
  );
  if (pinCompare !== 0) {
    return pinCompare;
  }
  return left.worktree.path.localeCompare(right.worktree.path);
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

const PROJECT_FAVICON_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PROJECT_FAVICON_REQUEST_BATCH_SIZE = 100;

function mergeProjectFaviconDataUrl(
  project: RpcProject,
  fallbackDataUrl: string | null | undefined,
): RpcProject {
  const faviconDataUrl = project.faviconDataUrl ?? fallbackDataUrl;
  return faviconDataUrl === undefined
    ? project
    : { ...project, faviconDataUrl };
}

function estimateLoadedTranscriptMediaBytes(
  payloads: ReadonlyMap<string, TranscriptMediaPayloadCacheEntry>,
): number {
  let totalBytes = 0;
  for (const payload of payloads.values()) {
    totalBytes += payload.byteSize;
  }
  return totalBytes;
}

export default function App({ isAdmin, procedures }: AppProps): JSX.Element {
  const initialMainviewState = useInitialMainviewState();

  const [projectStore, setProjectStore] = useState<ProjectStore>(() =>
    emptyProjectStore(),
  );
  const requestedProjectFaviconIdsRef = useRef<Set<number>>(new Set());
  const projectFaviconCheckedAtRef = useRef<Map<number, number>>(new Map());
  const [
    projectFaviconRefreshRequestedAt,
    setProjectFaviconRefreshRequestedAt,
  ] = useState(0);
  const [projectStates, setProjectStates] = useState<ProjectStateMap>({});
  const [worktreeStates, setWorktreeStates] = useState<WorktreeStateMap>({});
  const [homeDirectory, setHomeDirectory] = useState("");
  const [supportsTildePath, setSupportsTildePath] = useState(false);
  const [projectActionMenu, setProjectActionMenu] =
    useState<ProjectActionMenuState | null>(null);
  const [threadActionMenu, setThreadActionMenu] =
    useState<ThreadActionMenuState | null>(null);
  const [projectActionMenuError, setProjectActionMenuError] = useState("");
  const [gitInitializationState, setGitInitializationState] = useState<
    "idle" | "initializing"
  >("idle");
  const [gitInitializationError, setGitInitializationError] = useState("");
  const [declinedGitInitializationKeys, setDeclinedGitInitializationKeys] =
    useState<Set<string>>(() => new Set());
  const [
    projectActionMenuHiddenWorktreePath,
    setProjectActionMenuHiddenWorktreePath,
  ] = useState("");
  const [
    projectActionMenuHiddenWorktrees,
    setProjectActionMenuHiddenWorktrees,
  ] = useState<RpcWorktree[]>([]);
  const [threadActionMenuError, setThreadActionMenuError] = useState("");
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceError, setNewWorkspaceError] = useState("");
  const [threadRenameTitle, setThreadRenameTitle] = useState("");
  const [threadRenameSummary, setThreadRenameSummary] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
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
  const [availablePluginAccessGroups, setAvailablePluginAccessGroups] =
    useState<RpcPluginAccessGroupOption[]>([]);
  const [
    availableThreadPermissionDescriptors,
    setAvailableThreadPermissionDescriptors,
  ] = useState<RpcThreadPermissionDescriptor[]>([]);
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
  const {
    access: pendingThreadAccessValue,
    setAccess: setPendingThreadAccessValue,
  } = useAccessPermissions({
    initialAccess: {
      permissions: initialMainviewState.pendingThreadPermissions,
    },
  });
  const { permissions: pendingThreadPermissions } = pendingThreadAccessValue;
  const [threadMessages, setThreadMessages] = useState<RpcThreadMessage[]>([]);
  const [loadedTranscriptMediaPayloads, setLoadedTranscriptMediaPayloads] =
    useState<ReadonlyMap<string, TranscriptMediaPayloadCacheEntry>>(
      () => new Map(),
    );
  const [threadsError, setThreadsError] = useState("");
  const [isRefreshingModelCatalog, setIsRefreshingModelCatalog] =
    useState(false);
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
  const [isUpdatingThreadModel, setIsUpdatingThreadModel] = useState(false);
  const [isUpdatingThreadReasoningEffort, setIsUpdatingThreadReasoningEffort] =
    useState(false);
  const [isUpdatingThreadAccess, setIsUpdatingThreadAccess] = useState(false);
  const [threadActionBusy, setThreadActionBusy] = useState<
    "rename" | "pin" | "delete" | null
  >(null);
  const [mobileProjectListOpen, setMobileProjectListOpen] = useState(false);
  const shellController = useMainviewShellController({
    initialMainviewState,
    persistenceInputs: {
      pendingThreadModel,
      pendingThreadPermissions,
      pendingThreadReasoningEffort,
      sidebarSearchQuery,
    },
    projectStates,
    setThreadMessages,
  });
  const {
    completedThreadIndicatorIds,
    mobileNavigationIndicator,
    primaryView,
    selectedProjectId,
    selectedThreadId,
    selectedWorktreePath,
    sessionStateReady,
    sidebarCollapsed,
  } = shellController.state;
  const { selectedProjectIdRef, selectedThreadIdRef, selectedWorktreePathRef } =
    shellController.refs;
  const {
    commitShellNavigationUpdate,
    handleSidebarCollapsedChange,
    setPrimaryViewForNavigation,
    setSelectedProjectIdForNavigation,
    setSelectedThreadIdForNavigation,
    setSelectedWorktreePathForNavigation,
    setThreadMessagesForNavigation,
  } = shellController.commands;
  const {
    setCompletedThreadIndicatorIds,
    setMobileNavigationIndicator,
    setSessionStateReady,
  } = shellController.setters;
  const threadTurnBusyState = useThreadTurnBusyState();
  const { isSending, isStoppingThread } = threadTurnBusyState.state;
  const [reasoningEffortControlError, setReasoningEffortControlError] =
    useState("");
  const [threadAccessControlError, setThreadAccessControlError] = useState("");
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const [calendarNotifications, setCalendarNotifications] = useState<
    RpcCalendarReminderDelivery[]
  >([]);
  const [userNotifications, setUserNotifications] = useState<
    RpcUserNotificationDelivery[]
  >([]);
  const [calendarNotificationTrayOpen, setCalendarNotificationTrayOpen] =
    useState(false);
  const desktopNotificationTrayButtonRef = useRef<HTMLButtonElement | null>(
    null,
  );
  const mobileNotificationTrayButtonRef = useRef<HTMLButtonElement | null>(
    null,
  );
  const [openCalendarNotificationEvent, setOpenCalendarNotificationEvent] =
    useState<RpcCalendarReminderDelivery | null>(null);
  // Notification tray projection is intentionally local to App: the memo only
  // depends on notification arrays, so unrelated shell renders do not re-sort
  // tray items. The slice cap keeps the rendered tray bounded even if backend
  // notification retention grows.
  const notificationPanelItems = useMemo(
    () =>
      [
        ...calendarNotifications.map((notification) => ({
          id: `calendar:${notification.id}`,
          notification,
          sortAt: notification.scheduledAt,
          type: "calendar" as const,
        })),
        ...userNotifications.map((notification) => ({
          id: `user:${notification.id}`,
          notification,
          sortAt: notification.sentAt,
          type: "user" as const,
        })),
      ]
        .sort((left, right) => right.sortAt.localeCompare(left.sortAt))
        .slice(0, 10),
    [calendarNotifications, userNotifications],
  );
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<
    string | null
  >(null);
  const [expandedTranscriptItemIds, setExpandedTranscriptItemIds] = useState(
    () => new Set<string>(),
  );
  const defaultCodexModelRef = useRef(defaultCodexModel);
  const defaultCodexReasoningEffortRef = useRef(defaultCodexReasoningEffort);
  const appliedModelCatalogRef = useRef<RpcModelCatalog | null>(null);
  const isDesktopViewport = useDesktopViewport();
  const projects = useMemo(
    () => projectStoreItems(projectStore),
    [projectStore],
  );
  const threads = useMemo(() => threadStoreItems(threadStore), [threadStore]);
  const activeThreadIds = useMemo(
    () => new Set(threads.map((thread) => thread.id)),
    [threads],
  );
  const [threadPagesExhausted, setThreadPagesExhausted] = useState(false);
  const threadPageLoadingRef = useRef(false);
  const threadStoreRef = useRef(threadStore);

  useEffect(() => {
    threadStoreRef.current = threadStore;
  }, [threadStore]);

  const applyModelCatalog = useCallback(
    (modelCatalog: RpcModelCatalog): void => {
      if (modelCatalogsEqual(appliedModelCatalogRef.current, modelCatalog)) {
        return;
      }
      appliedModelCatalogRef.current = modelCatalog;
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
    },
    [],
  );

  const refreshModelCatalog = useCallback(
    async (
      signal: AbortSignal,
      options?: {
        priority?: "background" | "foreground";
        refresh?: boolean;
        refreshProviders?: boolean;
      },
    ): Promise<void> => {
      const result = await procedures.getModelCatalog(
        options?.refresh || options?.refreshProviders
          ? {
              ...(options?.refresh ? { refresh: true } : {}),
              ...(options?.refreshProviders ? { refreshProviders: true } : {}),
            }
          : undefined,
        {
          priority: options?.priority ?? "background",
          signal,
        },
      );
      applyModelCatalog(result);
    },
    [applyModelCatalog, procedures],
  );

  const handleRefreshModelCatalog = useCallback(async (): Promise<void> => {
    setModelControlError("");
    setIsRefreshingModelCatalog(true);

    const inFlightController = modelCatalogRefreshAbortControllerRef.current;
    if (inFlightController !== null) {
      modelCatalogRefreshAbortControllerRef.current = null;
      inFlightController.abort(
        createAbortError(null, "Model catalog refresh was superseded."),
      );
    }

    const controller = new AbortController();
    modelCatalogRefreshAbortControllerRef.current = controller;
    try {
      await refreshModelCatalog(controller.signal, {
        priority: "foreground",
        refresh: true,
        refreshProviders: true,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      logClientError("Failed to refresh model catalog", error, {
        context: "model-catalog-refresh",
      });
      setModelControlError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (modelCatalogRefreshAbortControllerRef.current === controller) {
        modelCatalogRefreshAbortControllerRef.current = null;
      }
      setIsRefreshingModelCatalog(false);
    }
  }, [refreshModelCatalog]);
  const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const projectDeleteAbortControllerRef = useRef<AbortController | null>(null);
  const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopSidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarScrollRef = useRef<HTMLElement | null>(null);
  const projectActionMenuRequestId = useRef(0);
  const modelCatalogRefreshAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const modelCatalogRefreshStartedRef = useRef(false);

  const activeWorktreeSyncAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const stalenessRefreshAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const homeDirectoryPrefetchQueryRef = useRef<string | null>(null);
  const selectedThreadRunStateRef = useRef<RpcThreadRunStatus["state"]>("idle");
  const selectedThreadDetailRefreshKeyRef = useRef<string | null>(null);
  const mergeSelectedThreadMessageHistoryRef = useRef<
    (detail: RpcThreadDetail) => void
  >(() => {});
  const optimisticallyAcknowledgedThreadIdsRef = useRef(new Set<number>());
  const optimisticThreadErrorSeenTimeoutsRef = useRef(
    new Map<number, number>(),
  );
  const threadErrorSeenRequestCacheRef = useRef(
    new Map<number, Promise<RpcThreadDetail>>(),
  );
  const threadMessageContentRequestControllersRef = useRef(
    new Map<string, AbortController>(),
  );
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
      const nextSelection = selectMainviewShellProject({
        project,
        worktreePath,
        worktrees: projectStateWorktrees(getProjectState(project.id)),
      });
      commitShellNavigationUpdate(nextSelection);
    },
    [commitShellNavigationUpdate, getProjectState],
  );

  // Derive normalized UI state in one pass so child props stay internally
  // consistent and side panels share the same source of truth.
  const {
    activeChatError,
    activeChatNotice,
    activeCodexModel,
    activeContextInputTokens,
    activeContextWindowTokens,
    activeThreadAccessValue,
    activePollingProjectId,
    activePollingWorktreePath,
    activeReasoningEffort,

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
    filteredWorkspaceActiveThreads,
    hasWorkingThreads,
    isThreadStatusDismissed,
    localUserLabel,
    modelSelectorDisabled,
    normalizedSidebarSearchQuery,
    projectActionMenuProject,
    projectById,
    projectWorktreesById,
    reasoningEffortSelectorDisabled,
    selectedDiffFileChange,
    selectedProject,
    selectedThread,
    selectedThreadIsWorking,
    threadActionMenuThread,
    threadAccessControlDisabled,
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
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
    pendingThreadAccessValue,
    pendingThreadModel,
    pendingThreadReasoningEffort,
    projectActionMenu,
    projectStore,
    projects,
    reasoningEfforts,
    selectedDiffFilePath,
    selectedProjectId,
    selectedThreadId,
    selectedWorktreePath,
    sidebarSearchQuery,
    supportsTildePath,
    threadActionMenu,
    threadStore,
    threads,
  });
  const selectedThreadProjectId = selectedThread?.projectId ?? null;
  const selectedThreadWorktreePath = selectedThread?.worktreePath ?? null;
  const selectedComposerDraftKey = chatComposerDraftKey(selectedThreadId);
  const availableSkills = useProjectSkills({
    isDocumentVisible,
    procedures,
    projectId: selectedThreadProjectId,
    worktreePath: selectedThreadWorktreePath,
  });
  const terminalsController = useTerminalsController({
    activeProjectId: selectedProject?.id ?? null,
    activeThreadId: selectedThreadId,
    activeWorktreePath: activeSelectedWorktreePath,
    isAdmin,
    procedures,
  });

  const activeSelectedWorktreeMissing = useMemo(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return false;
    }

    const selectedProjectState = getProjectState(selectedProject.id);
    if (
      selectedProjectState.worktreesLoadedAt === null ||
      selectedProjectState.loadingWorktrees
    ) {
      return false;
    }

    return !selectedProjectState.worktreeByPath[activeSelectedWorktreePath];
  }, [activeSelectedWorktreePath, getProjectState, selectedProject]);

  const {
    closeGitHistoryModal,
    gitHistoryModal,
    loadMoreGitHistory,
    openGitHistoryDiff,
    primeGitHistoryResult,
  } = useGitHistoryController({
    activeSelectedWorktreeMissing,
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

  const frontendMemoryTelemetrySnapshot =
    useMemo<FrontendMemoryTelemetrySnapshot>(
      () => ({
        calendarNotifications: calendarNotifications.length,
        expandedTranscriptItems: expandedTranscriptItemIds.size,
        gitCache: readFrontendGitCacheTelemetry(),
        gitHistoryEntries: gitHistory?.entries.length ?? 0,
        loadedTranscriptMediaBytes: estimateLoadedTranscriptMediaBytes(
          loadedTranscriptMediaPayloads,
        ),
        loadedTranscriptMediaEntries: loadedTranscriptMediaPayloads.size,
        openTerminals: terminalsController.terminals.length,
        pendingThreadStartRequests: pendingThreadStartRequests.length,
        projectCount: projects.length,
        threadCount: threads.length,
        threadMessageCount: threadMessages.length,
        userNotifications: userNotifications.length,
      }),
      [
        calendarNotifications.length,
        expandedTranscriptItemIds.size,
        gitHistory?.entries.length,
        loadedTranscriptMediaPayloads,
        pendingThreadStartRequests.length,
        projects.length,
        terminalsController.terminals.length,
        threadMessages.length,
        threads.length,
        userNotifications.length,
      ],
    );
  useFrontendMemoryTelemetry(frontendMemoryTelemetrySnapshot);

  const sanitizedActiveThreadAccessValue = useMemo(
    () =>
      sanitizeThreadAccessValue({
        access: activeThreadAccessValue,
        availablePluginAccessGroups,
        availableThreadPermissionDescriptors,
      }),
    [
      activeThreadAccessValue,
      availablePluginAccessGroups,
      availableThreadPermissionDescriptors,
    ],
  );
  const hasDesyncedThreadAccessPermissions = useMemo(
    () =>
      threadAccessPermissionsWereSanitized({
        access: activeThreadAccessValue,
        sanitizedAccess: sanitizedActiveThreadAccessValue,
      }),
    [activeThreadAccessValue, sanitizedActiveThreadAccessValue],
  );

  useEffect(() => {
    if (!hasDesyncedThreadAccessPermissions) {
      return;
    }
    setThreadAccessControlError("");
  }, [hasDesyncedThreadAccessPermissions]);

  const safeChildAccessDefaults = deriveSafeChildAccessDefaults(
    sanitizedActiveThreadAccessValue,
  );
  const activeModelProviderAvailableForThreadCreation = useMemo(() => {
    const activeModelOption = findCodexModel(codexModels, activeCodexModel);
    return Boolean(
      activeModelOption &&
        activeModelOption.providerAvailable !== false &&
        activeModelOption.isPlaceholder !== true,
    );
  }, [activeCodexModel, codexModels]);
  const executeRpcAction = useCallback(
    async <T,>(_actionLabel: string, action: () => Promise<T>) => action(),
    [],
  );
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

  // Filter threads by sidebar search query (threads only, no project filtering).
  const sidebarFilteredPinnedThreads = useMemo(() => {
    if (!normalizedSidebarSearchQuery) return desktopPinnedThreads;
    return desktopPinnedThreads.filter((thread) =>
      matchesNormalizedSearchText(
        normalizedSidebarSearchQuery,
        buildNormalizedSearchText(thread.title, thread.summary),
      ),
    );
  }, [normalizedSidebarSearchQuery, desktopPinnedThreads]);

  const sidebarFilteredRecentThreads = useMemo(() => {
    if (!normalizedSidebarSearchQuery) return filteredWorkspaceActiveThreads;
    return filteredWorkspaceActiveThreads.filter((thread) =>
      matchesNormalizedSearchText(
        normalizedSidebarSearchQuery,
        buildNormalizedSearchText(thread.title, thread.summary),
      ),
    );
  }, [normalizedSidebarSearchQuery, filteredWorkspaceActiveThreads]);

  // Pinned-folder projection scans all hydrated worktrees, but it is memoized
  // to project/worktree display inputs and returns only pinned rows. Keeping it
  // derived here avoids storing a second mutable pinned-folder index that could
  // drift from project/worktree hydration state.
  const sidebarPinnedFolders = useMemo(() => {
    const rows: SidebarPinnedFolderRow[] = [];

    for (const project of projects) {
      for (const worktree of projectWorktreesById.get(project.id) ?? []) {
        if (worktree.pinnedAt === null) {
          continue;
        }

        const key = worktreeKey(project.id, worktree.path);
        const displayPath = worktreeDisplayPathByKey.get(key) ?? worktree.path;
        if (
          normalizedSidebarSearchQuery &&
          !matchesNormalizedSearchText(
            normalizedSidebarSearchQuery,
            buildNormalizedSearchText(
              project.name,
              worktree.branch,
              worktree.path,
              displayPath,
            ),
          )
        ) {
          continue;
        }

        rows.push({
          displayPath,
          project,
          worktree,
        });
      }
    }

    return rows.sort(compareSidebarPinnedFolderRows);
  }, [
    normalizedSidebarSearchQuery,
    projectWorktreesById,
    projects,
    worktreeDisplayPathByKey,
  ]);
  const activeWorktreePinned = Boolean(activeSelectedWorktree?.pinnedAt);
  const activeWorktreePinDisabled =
    !selectedProject ||
    !activeSelectedWorktreePath ||
    !activeSelectedWorktree ||
    worktreePinBusyPath !== null;

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
  const currentThreadStartRequestReasoningPresentation =
    currentThreadStartRequestModelOption
      ? codexReasoningPresentation(
          currentThreadStartRequestModelOption,
          reasoningEfforts,
          currentThreadStartRequest?.reasoningEffort ??
            defaultCodexReasoningEffort,
        )
      : null;
  const currentThreadStartRequestThinkingLabel =
    currentThreadStartRequestModelOption &&
    !codexModelSupportsThinkingLevel(currentThreadStartRequestModelOption)
      ? "Not configurable"
      : currentThreadStartRequestReasoningPresentation?.activeOption
        ? currentThreadStartRequest?.reasoningEffort
          ? currentThreadStartRequestReasoningPresentation.activeOption.label
          : `Default (${currentThreadStartRequestReasoningPresentation.activeOption.label})`
        : (currentThreadStartRequest?.reasoningEffort ?? "default");
  const currentThreadStartRequestAccessEntries = useMemo(
    () =>
      currentThreadStartRequest
        ? [
            {
              label: "Model",
              value: currentThreadStartRequestModelLabel,
            },
            {
              label: "Thinking",
              value: currentThreadStartRequestThinkingLabel,
            },
            {
              label: "Permissions",
              value: currentThreadStartRequest.permissions?.length
                ? currentThreadStartRequest.permissions.join(", ")
                : "default",
            },
          ]
        : [],
    [
      currentThreadStartRequest,
      currentThreadStartRequestModelLabel,
      currentThreadStartRequestThinkingLabel,
    ],
  );

  // Maintain a compact set of acknowledged-completed thread IDs to avoid
  // recomputing this visual state from full thread objects.
  const clearCompletedThreadIndicator = useCallback(
    (threadId: number): void => {
      setCompletedThreadIndicatorIds((current) =>
        clearMainviewShellCompletedThreadIndicator(current, threadId),
      );
    },
    [setCompletedThreadIndicatorIds],
  );
  const threadActivityIndicator = useCallback(
    (threadId: number): "none" | "working" | "completed" =>
      readMainviewShellThreadActivityIndicator({
        completedThreadIndicatorIds,
        selectedThreadId,
        thread: threadStore.byId[threadId],
      }),
    [completedThreadIndicatorIds, selectedThreadId, threadStore],
  );
  const abortThreadMessageContentRequests = useCallback((reason: string) => {
    const error = createAbortError(null, reason);
    for (const controller of threadMessageContentRequestControllersRef.current.values()) {
      controller.abort(error);
    }
    threadMessageContentRequestControllersRef.current.clear();
  }, []);

  const requestThreadMessageContent = useCallback(
    (threadId: number, messageId: number) => {
      if (
        !Number.isInteger(threadId) ||
        threadId <= 0 ||
        !Number.isInteger(messageId) ||
        messageId <= 0
      ) {
        return;
      }

      const requestKey = `${threadId}:${messageId}`;
      if (threadMessageContentRequestControllersRef.current.has(requestKey)) {
        return;
      }

      const controller = new AbortController();
      threadMessageContentRequestControllersRef.current.set(
        requestKey,
        controller,
      );
      void procedures
        .getThreadMessageContent(
          { threadId, messageId },
          {
            priority: "foreground",
            signal: controller.signal,
            timeoutMs: THREAD_MESSAGE_CONTENT_RPC_TIMEOUT_MS,
          },
        )
        .then((message) => {
          // Guard the narrow thread-switch/unmount race: aborting the controller
          // clears the request map, but a transport response may already be queued.
          if (
            controller.signal.aborted ||
            selectedThreadIdRef.current !== threadId
          ) {
            return;
          }
          const baseKey = `thread-message:${message.id}`;
          const mediaPayloads = new Map<string, string>();
          if (message.kind === "chat" && message.images) {
            message.images.forEach((image, index) => {
              if (image.data) {
                mediaPayloads.set(`${baseKey}:image:${index}`, image.data);
              }
            });
          } else if (message.kind === "tool_call" && message.outputImages) {
            message.outputImages.forEach((image, index) => {
              if (image.data) {
                mediaPayloads.set(
                  `${baseKey}:output-image:${index}`,
                  image.data,
                );
              }
            });
          }
          const messageHasMediaPayloads = mediaPayloads.size > 0;
          if (messageHasMediaPayloads) {
            setLoadedTranscriptMediaPayloads((current) =>
              writeTranscriptMediaPayloads(current, mediaPayloads),
            );
          }
          const stateMessage = messageHasMediaPayloads
            ? stripThreadMessageMediaPayloadData(message)
            : message;
          setThreadMessages((current) =>
            current.map((candidate) =>
              candidate.id === message.id ? stateMessage : candidate,
            ),
          );
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          logClientError("Failed to load thread message", error, {
            context: `threadMessageId:${messageId}`,
          });
        })
        .finally(() => {
          if (
            threadMessageContentRequestControllersRef.current.get(
              requestKey,
            ) === controller
          ) {
            threadMessageContentRequestControllersRef.current.delete(
              requestKey,
            );
          }
        });
    },
    [procedures, selectedThreadIdRef],
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
    abortThreadMessageContentRequests(
      "Thread message content request was superseded.",
    );
    setExpandedTranscriptItemIds(new Set());
    setLoadedTranscriptMediaPayloads(new Map());
  }, [abortThreadMessageContentRequests, selectedThreadId]);

  useEffect(
    () => () => {
      abortThreadMessageContentRequests(
        "Thread message content request was cleared.",
      );
    },
    [abortThreadMessageContentRequests],
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
    const nextProjectIds = createProjectStore(items).orderedIds;
    setProjectStore((prevProjectStore) =>
      createProjectStore(
        items.map((item) =>
          mergeProjectFaviconDataUrl(
            item,
            prevProjectStore.byId[item.id]?.faviconDataUrl,
          ),
        ),
      ),
    );
    setProjectStates((prevProjectStates) => {
      const nextProjectStates = pruneProjectStates(
        prevProjectStates,
        nextProjectIds,
      );
      setWorktreeStates((prevWorktreeStates) =>
        pruneWorktreeStates(prevWorktreeStates, nextProjectStates),
      );
      return nextProjectStates;
    });
  }, []);

  const upsertProject = useCallback((project: RpcProject): void => {
    setProjectStore((prev) =>
      upsertProjectStore(
        prev,
        mergeProjectFaviconDataUrl(
          project,
          prev.byId[project.id]?.faviconDataUrl,
        ),
      ),
    );
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProjectFaviconRefreshRequestedAt(Date.now());
    }, PROJECT_FAVICON_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const shouldForceFaviconRefresh = projectFaviconRefreshRequestedAt === 0;
    const now = projectFaviconRefreshRequestedAt || Date.now();
    const projectsNeedingFavicons = projectStoreItems(projectStore).filter(
      (project) => {
        if (requestedProjectFaviconIdsRef.current.has(project.id)) {
          return false;
        }
        const checkedAt = projectFaviconCheckedAtRef.current.get(project.id);
        return (
          checkedAt === undefined ||
          now - checkedAt >= PROJECT_FAVICON_REFRESH_INTERVAL_MS
        );
      },
    );
    if (projectsNeedingFavicons.length === 0) {
      return;
    }

    const projectIds = projectsNeedingFavicons.map((project) => project.id);
    for (const projectId of projectIds) {
      requestedProjectFaviconIdsRef.current.add(projectId);
    }

    const projectIdBatches: number[][] = [];
    for (
      let index = 0;
      index < projectIds.length;
      index += PROJECT_FAVICON_REQUEST_BATCH_SIZE
    ) {
      projectIdBatches.push(
        projectIds.slice(index, index + PROJECT_FAVICON_REQUEST_BATCH_SIZE),
      );
    }

    void Promise.all(
      projectIdBatches.map((batchProjectIds) =>
        procedures.listProjectFavicons(
          {
            forceRefresh: shouldForceFaviconRefresh,
            projectIds: batchProjectIds,
          },
          { priority: "background" },
        ),
      ),
    )
      .then((faviconBatches) => {
        const favicons = faviconBatches.flat();
        const checkedAt = Date.now();
        for (const projectId of projectIds) {
          projectFaviconCheckedAtRef.current.set(projectId, checkedAt);
        }
        if (favicons.length === 0) {
          return;
        }
        setProjectStore((prev) => {
          let next = prev;
          for (const favicon of favicons) {
            const project = next.byId[favicon.projectId];
            if (
              !project ||
              !favicon.dataUrl ||
              project.faviconDataUrl === favicon.dataUrl
            ) {
              continue;
            }
            next = upsertProjectStore(next, {
              ...project,
              faviconDataUrl: favicon.dataUrl,
            });
          }
          return next;
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }
        logClientError("Failed to load project favicons", error, {
          context: "App.projectFavicons",
        });
      })
      .finally(() => {
        for (const projectId of projectIds) {
          requestedProjectFaviconIdsRef.current.delete(projectId);
        }
      });
  }, [procedures, projectFaviconRefreshRequestedAt, projectStore]);

  const replaceThreads = useCallback((items: RpcThread[]): void => {
    setThreadStore((_current) => {
      const next = createThreadStore(items);
      threadStoreRef.current = next;
      setThreadPagesExhausted(items.length < 100);
      return next;
    });
  }, []);

  const upsertThread = useCallback(
    (thread: RpcThread): void => {
      setThreadStore((prev) => {
        const next = applyMainviewShellThreadStatusEvent({
          projectStore,
          thread,
          threadStore: prev,
        });
        threadStoreRef.current = next;
        return next;
      });
    },
    [projectStore],
  );

  const removeThread = useCallback((threadId: number): void => {
    setThreadStore((prev) => {
      const next = removeThreadFromStore(prev, threadId);
      threadStoreRef.current = next;
      return next;
    });
  }, []);

  const loadMoreThreads = useCallback((): void => {
    if (threadPageLoadingRef.current || threadPagesExhausted) {
      return;
    }
    threadPageLoadingRef.current = true;
    void procedures
      .listThreads({
        offset: threadStoreRef.current.orderedIds.length,
        limit: 100,
      })
      .then((loadedThreads) => {
        if (loadedThreads.length < 100) {
          setThreadPagesExhausted(true);
        }
        setThreadStore((prev) => {
          let next = prev;
          for (const thread of loadedThreads) {
            next = applyMainviewShellThreadStatusEvent({
              projectStore,
              thread,
              threadStore: next,
            });
          }
          threadStoreRef.current = next;
          return next;
        });
      })
      .catch((error) => {
        setThreadsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        threadPageLoadingRef.current = false;
      });
  }, [procedures, projectStore, threadPagesExhausted]);

  const {
    addProjectError,
    addProjectInputIsPreviewing,
    addProjectOpen,
    addProjectPath,
    cancelCreateFolderPrompt,
    closeAddProjectForm,
    confirmCreateFolderPrompt,
    createFolderPromptPath,
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
      selectedProjectIdRef,
      selectedThread,
      selectedThreadIdRef,
      selectedWorktreePathRef,
      sessionStateReady,
      setProjectState,
      setSelectedWorktreePath: setSelectedWorktreePathForNavigation,
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
  const gitInitializationKey =
    selectedProject && activeSelectedWorktreePath
      ? `${selectedProject.id}:${activeSelectedWorktreePath}`
      : null;
  const nonGitRepositoryDeclined = gitInitializationKey
    ? declinedGitInitializationKeys.has(gitInitializationKey)
    : false;

  const handleDeclineGitInitialization = useCallback(() => {
    if (!gitInitializationKey) {
      return;
    }
    setGitInitializationError("");
    setDeclinedGitInitializationKeys((current) => {
      const next = new Set(current);
      next.add(gitInitializationKey);
      return next;
    });
  }, [gitInitializationKey]);

  const handleInitializeGitRepository = useCallback(async (): Promise<void> => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return;
    }

    setGitInitializationState("initializing");
    setGitInitializationError("");
    try {
      const result = await procedures.openProject({
        projectPath: selectedProject.path,
        name: selectedProject.name,
        initGitIfNeeded: true,
        pinWorktree: true,
      });
      upsertProject(result.project);
      setProjectState(
        result.project.id,
        buildMainviewShellProjectWorktreeHydration(result.worktrees),
      );
      setWorktreeState(result.project.id, activeSelectedWorktreePath, {
        loading: true,
        opened: true,
        error: "",
      });
      const openedWorktree = await procedures.openWorktree({
        projectId: result.project.id,
        worktreePath: activeSelectedWorktreePath,
      });
      primeGitHistoryResult(openedWorktree.history);
      setWorktreeState(result.project.id, activeSelectedWorktreePath, {
        loading: false,
        opened: true,
        snapshot: openedWorktree.worktree,
        error: "",
      });
      setProjectState(
        result.project.id,
        buildMainviewShellOpenedWorktreeHydration({
          currentProjectState: getProjectState(result.project.id),
          worktreePath: activeSelectedWorktreePath,
          worktrees: openedWorktree.worktrees,
        }),
      );
      if (gitInitializationKey) {
        setDeclinedGitInitializationKeys((current) => {
          if (!current.has(gitInitializationKey)) {
            return current;
          }
          const next = new Set(current);
          next.delete(gitInitializationKey);
          return next;
        });
      }
      await refreshActiveWorktreeSnapshot();
    } catch (error) {
      setWorktreeState(selectedProject.id, activeSelectedWorktreePath, {
        loading: false,
        opened: false,
        snapshot: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      setGitInitializationError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setGitInitializationState("idle");
    }
  }, [
    activeSelectedWorktreePath,
    getProjectState,
    gitInitializationKey,
    primeGitHistoryResult,
    procedures,
    refreshActiveWorktreeSnapshot,
    selectedProject,
    setProjectState,
    setWorktreeState,
    upsertProject,
  ]);

  const discardThreadIfEmpty = useCallback(
    async (threadId: number): Promise<void> => {
      try {
        const result = await procedures.discardEmptyThread({ threadId });
        if (!result.discarded) {
          return;
        }
        removeThread(result.threadId);
      } catch (error) {
        logClientError("Failed to discard empty thread", error, {
          context: `threadId:${threadId}`,
        });
      }
    },
    [procedures, removeThread],
  );

  useEffect(() => {
    pruneChatComposerDraftsForActiveThreads(activeThreadIds);

    for (const threadId of threadErrorSeenRequestCacheRef.current.keys()) {
      if (!activeThreadIds.has(threadId)) {
        threadErrorSeenRequestCacheRef.current.delete(threadId);
      }
    }
    for (const threadId of optimisticallyAcknowledgedThreadIdsRef.current) {
      if (!activeThreadIds.has(threadId)) {
        optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);
      }
    }
    for (const threadId of previousThreadRunStatesRef.current.keys()) {
      if (!activeThreadIds.has(threadId)) {
        previousThreadRunStatesRef.current.delete(threadId);
      }
    }
    for (const [
      threadId,
      timeoutId,
    ] of optimisticThreadErrorSeenTimeoutsRef.current) {
      if (!activeThreadIds.has(threadId)) {
        window.clearTimeout(timeoutId);
        optimisticThreadErrorSeenTimeoutsRef.current.delete(threadId);
      }
    }
    setThreadStore((currentThreadStore) => {
      const nextThreadStore = pruneThreadStore(currentThreadStore, {
        preserveThreadIds: selectedThreadId === null ? [] : [selectedThreadId],
      });
      if (nextThreadStore !== currentThreadStore) {
        threadStoreRef.current = nextThreadStore;
      }
      return nextThreadStore;
    });
  }, [activeThreadIds, selectedThreadId]);

  useEffect(
    () => () => {
      threadErrorSeenRequestCacheRef.current.clear();
    },
    [],
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

  useEffect(() => {
    return () => {
      for (const timeoutId of optimisticThreadErrorSeenTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      optimisticThreadErrorSeenTimeoutsRef.current.clear();
    };
  }, []);

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
      const clearOptimisticAcknowledgement = (): void => {
        optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);
        const timeoutId =
          optimisticThreadErrorSeenTimeoutsRef.current.get(threadId);
        if (typeof timeoutId === "number") {
          window.clearTimeout(timeoutId);
          optimisticThreadErrorSeenTimeoutsRef.current.delete(threadId);
        }
      };

      optimisticallyAcknowledgedThreadIdsRef.current.add(threadId);
      const previousTimeoutId =
        optimisticThreadErrorSeenTimeoutsRef.current.get(threadId);
      if (typeof previousTimeoutId === "number") {
        window.clearTimeout(previousTimeoutId);
      }
      optimisticThreadErrorSeenTimeoutsRef.current.set(
        threadId,
        window.setTimeout(() => {
          optimisticThreadErrorSeenTimeoutsRef.current.delete(threadId);
          optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);
          setThreadStore((prev) => applyOptimisticThreadErrorSeenToStore(prev));
        }, OPTIMISTIC_THREAD_ERROR_SEEN_TTL_MS),
      );
      setThreadStore((prev) => applyOptimisticThreadErrorSeenToStore(prev));
      void requestThreadErrorSeen(threadId)
        .then((detail) => {
          clearOptimisticAcknowledgement();

          const settledDetail = applyOptimisticThreadErrorSeenToDetail(detail);
          setThreadStore((prev) =>
            prev.byId[settledDetail.thread.id]
              ? upsertThreadStore(prev, settledDetail.thread)
              : prev,
          );
          if (selectedThreadIdRef.current === threadId) {
            selectedThreadRunStateRef.current =
              buildMainviewShellSelectedThreadDetailRefreshState(
                settledDetail,
              ).runState;
            mergeSelectedThreadMessageHistoryRef.current(settledDetail);
          }
        })
        .catch((error) => {
          clearOptimisticAcknowledgement();
          logClientError("Failed to acknowledge unread thread error", error, {
            context: `threadId:${threadId}`,
          });
        });
    },
    [
      applyOptimisticThreadErrorSeenToDetail,
      applyOptimisticThreadErrorSeenToStore,
      requestThreadErrorSeen,
      selectedThreadIdRef,
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

  const threadWorkspaceController = useThreadWorkspaceController({
    activeCodexModel,
    activeModelProviderAvailableForThreadCreation,
    activeReasoningEffort,
    applyOptimisticThreadErrorSeenToList,
    availablePluginAccessGroups,
    availableThreadPermissionDescriptors,
    codexModels,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    discardThreadIfEmpty,
    initialChatInput: initialMainviewState.chatInput,
    isDocumentVisible,
    isUpdatingThreadAccess,
    isUpdatingThreadModel,
    isUpdatingThreadReasoningEffort,
    prepareOpenedThreadDetail,
    procedures,
    selection: {
      actions: {
        ensureWorktreeOpen,
        executeRpcAction,
        loadProjectWorktrees,
        removeThread,
        selectProject,
        upsertProject,
        upsertThread,
      },
      projectState: {
        getProjectState,
        getWorktreeState,
        setProjectState,
      },
      refs: {
        selectedProjectIdRef,
        selectedThreadDetailRefreshKeyRef,
        selectedThreadIdRef,
        selectedThreadRunStateRef,
        selectedWorktreePathRef,
        threadStoreRef,
      },
      selection: {
        activeSelectedWorktreeOpened,
        activeSelectedWorktreePath,
        isApprovingThreadStartRequest,
        isThreadLoading,
        selectedProjectId,
        selectedThread,
        selectedThreadId,
        sessionStateReady,
      },
      setters: {
        setChatError,
        setIsApprovingThreadStartRequest,
        setIsCreatingThread,
        setIsThreadLoading,
        setMobileProjectListOpen,
        setModelControlError,
        setPendingThreadStartRequests,
        setPrimaryView: setPrimaryViewForNavigation,
        setReasoningEffortControlError,
        setSelectedProjectId: setSelectedProjectIdForNavigation,
        setSelectedThreadId: setSelectedThreadIdForNavigation,
        setSelectedWorktreePath: setSelectedWorktreePathForNavigation,
        setThreadAccessControlError,
        setThreadMessages: setThreadMessagesForNavigation,
        setThreadsError,
        setThreadStartRequestError,
      },
      threads: {
        safeChildAccessDefaults,
      },
    },
    selectedComposerDraftKey,
    selectedThread,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadId,
    selectedThreadIdRef,
    selectedThreadIsWorking,
    selectedThreadRunStateRef,
    setChatError,
    setIsUpdatingThreadAccess,
    setIsUpdatingThreadModel,
    setIsUpdatingThreadReasoningEffort,
    setModelControlError,
    setPendingThreadAccessValue,
    setPendingThreadModel,
    setPendingThreadReasoningEffort,
    setReasoningEffortControlError,
    setThreadAccessControlError,
    setThreadMessages,
    setThreadStore,
    threadStoreRef,
    threadTurnBusyState,
    threads,
    upsertThread,
  });
  const { mergeSelectedThreadMessageHistory } =
    threadWorkspaceController.history;
  mergeSelectedThreadMessageHistoryRef.current =
    mergeSelectedThreadMessageHistory;
  const {
    updateActiveCodexModel,
    updateActiveReasoningEffort,
    updateActiveThreadAccess,
  } = threadWorkspaceController.settings;
  const { postMessage, stopSelectedThreadTurn } =
    threadWorkspaceController.turn;

  const {
    approveThreadStartRequest,
    clearThreadSelection,
    createThreadForWorktree,
    dismissThreadStartRequest,
    handleProjectWorktreeClick,
    openThread,
  } = threadWorkspaceController.selection;

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
    setAvailablePluginAccessGroups,
    setAvailableThreadPermissionDescriptors,
    selectedWorktreePathRef,
    setHomeDirectory,
    setProjectState,
    setProjectStates,
    setSelectedProjectId: setSelectedProjectIdForNavigation,
    setSelectedWorktreePath: setSelectedWorktreePathForNavigation,
    setSessionStateReady,
    setSupportsTildePath,
    setThreadsError,
    setWorktreeState,
  });

  const requestMainviewStalenessRefresh = useCallback(
    (reason: "event-loop-gap" | "visibility-return"): void => {
      if (stalenessRefreshAbortControllerRef.current !== null) {
        return;
      }

      const controller = new AbortController();
      stalenessRefreshAbortControllerRef.current = controller;
      logClientEvent({
        severity: "info",
        message: "Refreshing mainview state after stale client interval",
        context: reason,
        route: typeof window !== "undefined" ? window.location.pathname : null,
      });
      void procedures
        .getAppBootstrap(
          {
            selectedProjectId: selectedProjectIdRef.current,
            selectedWorktreePath: selectedWorktreePathRef.current,
            threadIdHint: selectedThreadIdRef.current,
          },
          {
            priority: "background",
            signal: controller.signal,
          },
        )
        .then(async (bootstrapResult) => {
          if (controller.signal.aborted) {
            return;
          }

          replaceProjects(bootstrapResult.projects);
          hydrateProjectRows(bootstrapResult.projects);
          replaceThreads(
            applyOptimisticThreadErrorSeenToList(bootstrapResult.threads),
          );
          applyModelCatalog(bootstrapResult.modelCatalog);
          setAvailablePluginAccessGroups(bootstrapResult.pluginAccessGroups);
          setAvailableThreadPermissionDescriptors(
            bootstrapResult.threadPermissionDescriptors,
          );
          setHomeDirectory(bootstrapResult.homeDirectory.homeDirectory);
          setSupportsTildePath(bootstrapResult.homeDirectory.supportsTildePath);
          seedAddProjectPath(
            bootstrapResult.homeDirectory.homeDirectory,
            bootstrapResult.homeDirectory.supportsTildePath,
          );

          const selectedThreadId = selectedThreadIdRef.current;
          const inlineDetail = bootstrapResult.threadDetail;
          const detail =
            inlineDetail !== null && inlineDetail.thread.id === selectedThreadId
              ? inlineDetail
              : selectedThreadId === null
                ? null
                : await procedures.getThread(
                    { threadId: selectedThreadId },
                    {
                      priority: "background",
                      signal: controller.signal,
                    },
                  );
          if (
            detail !== null &&
            !controller.signal.aborted &&
            selectedThreadIdRef.current === detail.thread.id
          ) {
            const preparedDetail = prepareOpenedThreadDetail(detail);
            const refreshState =
              buildMainviewShellSelectedThreadDetailRefreshState(
                preparedDetail,
              );
            selectedThreadRunStateRef.current = refreshState.runState;
            selectedThreadDetailRefreshKeyRef.current =
              refreshState.detailRefreshKey;
            mergeSelectedThreadMessageHistoryRef.current(preparedDetail);
          }
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          logClientError("Failed to refresh stale mainview state", error, {
            context: reason,
          });
        })
        .finally(() => {
          if (stalenessRefreshAbortControllerRef.current === controller) {
            stalenessRefreshAbortControllerRef.current = null;
          }
        });
    },
    [
      applyModelCatalog,
      applyOptimisticThreadErrorSeenToList,
      hydrateProjectRows,
      prepareOpenedThreadDetail,
      procedures,
      replaceProjects,
      replaceThreads,
      seedAddProjectPath,
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedWorktreePathRef,
      setAvailablePluginAccessGroups,
      setAvailableThreadPermissionDescriptors,
      setHomeDirectory,
      setSupportsTildePath,
    ],
  );

  useMainviewStalenessRefreshController({
    enabled: sessionStateReady,
    requestRefresh: requestMainviewStalenessRefresh,
  });

  useEffect(
    () => () => {
      const controller = stalenessRefreshAbortControllerRef.current;
      if (controller !== null) {
        stalenessRefreshAbortControllerRef.current = null;
        controller.abort(
          createAbortError(null, "Stale mainview refresh was canceled."),
        );
      }
    },
    [],
  );

  const closeProjectActionMenu = useCallback(() => {
    setProjectActionMenu(null);
    setProjectActionMenuError("");
    setProjectActionMenuHiddenWorktreePath("");
    setProjectActionMenuHiddenWorktrees([]);
    setIsOpeningHiddenWorktree(false);
  }, []);

  const closeNewWorkspacePopover = useCallback(() => {
    setNewWorkspaceOpen(false);
    setNewWorkspaceName("");
    setNewWorkspaceError("");
  }, []);

  const closeThreadActionMenu = useCallback(() => {
    setThreadActionMenu(null);
    setThreadActionMenuError("");
    setThreadRenameTitle("");
    setThreadRenameSummary("");
    setThreadActionBusy(null);
  }, []);

  const _openProjectActionMenu = useCallback(
    async (project: RpcProject, x: number, y: number) => {
      const requestId = ++projectActionMenuRequestId.current;

      closeThreadActionMenu();
      setProjectActionMenu({
        mode: "actions",
        projectId: project.id,
        x,
        y,
      });
      setProjectActionMenuError("");
      setProjectActionMenuHiddenWorktreePath("");
      setProjectActionMenuHiddenWorktrees([]);
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
        const hydration = buildMainviewShellHiddenWorktreeHydration(result);
        setProjectState(project.id, hydration.projectUpdate);
        setProjectActionMenuHiddenWorktrees(hydration.hiddenWorktrees);
        setProjectActionMenuHiddenWorktreePath(hydration.hiddenWorktreePath);
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

  const openProjectDeleteMenu = useCallback(() => {
    setProjectActionMenu((current) =>
      current
        ? {
            ...current,
            mode: "delete",
          }
        : current,
    );
    setProjectActionMenuError("");
  }, []);

  const openThreadActionMenu = useCallback(
    (thread: RpcThread, x: number, y: number) => {
      closeProjectActionMenu();
      setThreadActionMenu({
        threadId: thread.id,
        x,
        y,
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
      projectDeleteAbortControllerRef.current?.abort(
        createAbortError(null, "Project delete request was superseded."),
      );
      const controller = new AbortController();
      projectDeleteAbortControllerRef.current = controller;
      const removedProjectPath = projectStore.byId[projectId]?.path ?? null;
      try {
        const deletedProject = await procedures.deleteProject(
          { projectId },
          { priority: "foreground", signal: controller.signal },
        );
        if (!deletedProject) {
          return;
        }
        const [loaded, loadedThreads] = await Promise.all([
          procedures.listProjects(
            { includeClosed: true },
            { priority: "foreground", signal: controller.signal },
          ),
          procedures.listThreads(undefined, {
            priority: "foreground",
            signal: controller.signal,
          }),
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
        const nextSelectedProject =
          nextSelectedProjectId === null
            ? null
            : (loaded.find((project) => project.id === nextSelectedProjectId) ??
              null);
        commitShellNavigationUpdate({
          selectedProjectId: nextSelectedProjectId,
          ...(selectedProjectId === projectId
            ? { selectedWorktreePath: nextSelectedProject?.path ?? null }
            : {}),
        });
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
        if (isAbortError(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (projectActionMenu?.projectId === projectId) {
          setProjectActionMenuError(message);
        } else {
          setProjectState(projectId, { error: message });
        }
      } finally {
        if (projectDeleteAbortControllerRef.current === controller) {
          projectDeleteAbortControllerRef.current = null;
        }
      }
    },
    [
      clearProjectState,
      clearThreadSelection,
      commitShellNavigationUpdate,
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

  useEffect(() => {
    return () => {
      projectDeleteAbortControllerRef.current?.abort(
        createAbortError(null, "Project delete request was canceled."),
      );
      projectDeleteAbortControllerRef.current = null;
    };
  }, []);

  const toggleWorktreePinned = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      currentlyPinned: boolean,
    ) => {
      if (worktreePinBusyPath) {
        return;
      }

      const currentProjectState = getProjectState(projectId);
      const pinPlan = planMainviewShellWorktreePin({
        currentlyPinned,
        nowIso: new Date().toISOString(),
        projectId,
        projectState: currentProjectState,
        worktreePath,
      });
      if (!pinPlan.ok) {
        setProjectState(projectId, pinPlan.projectUpdate);
        return;
      }

      setWorktreePinBusyPath(pinPlan.busyKey);
      setProjectState(projectId, pinPlan.projectUpdate);

      try {
        const result = await procedures.setWorktreePinned({
          projectId,
          worktreePath,
          pinned: pinPlan.nextPinned,
        });
        setProjectState(
          projectId,
          buildMainviewShellProjectWorktreeHydration(result.worktrees),
        );
      } catch (error) {
        setProjectState(
          projectId,
          buildMainviewShellWorktreePinRollback({
            error: error instanceof Error ? error.message : String(error),
            projectState: currentProjectState,
          }),
        );
      } finally {
        setWorktreePinBusyPath((current) =>
          current === pinPlan.busyKey ? null : current,
        );
      }
    },
    [getProjectState, procedures, setProjectState, worktreePinBusyPath],
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
      const previousThread = threadActionMenuThread;
      const optimisticUpdatedAt = new Date().toISOString();
      const optimisticThread: RpcThread = {
        ...previousThread,
        title,
        summary: threadRenameSummary.trim() ? threadRenameSummary : null,
        updatedAt: optimisticUpdatedAt,
      };
      upsertThread(optimisticThread);
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
        upsertThread(previousThread);
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
    const previousThread = threadActionMenuThread;
    const optimisticUpdatedAt = new Date().toISOString();
    upsertThread({
      ...previousThread,
      pinnedAt: previousThread.pinnedAt ? null : optimisticUpdatedAt,
      updatedAt: optimisticUpdatedAt,
    });
    try {
      const updatedThread = await procedures.setThreadPinned({
        threadId: threadActionMenuThread.id,
        pinned: !threadActionMenuThread.pinnedAt,
      });
      upsertThread(updatedThread);
    } catch (error) {
      upsertThread(previousThread);
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

  const submitNewWorkspace = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !selectedProject ||
        isCreatingWorkspace ||
        isOpeningHiddenWorktree ||
        worktreePinBusyPath
      ) {
        return;
      }

      const name = newWorkspaceName.trim();
      if (!/^[A-Za-z0-9._-]+$/u.test(name) || name === "." || name === "..") {
        setNewWorkspaceError(
          "Use letters, numbers, '.', '_', or '-' for the folder name.",
        );
        return;
      }

      setIsCreatingWorkspace(true);
      setNewWorkspaceError("");
      try {
        const result = await procedures.createWorktree({
          projectId: selectedProject.id,
          name,
        });
        upsertProject(result.project);
        setProjectState(
          result.project.id,
          buildMainviewShellProjectWorktreeHydration(result.worktrees),
        );
        closeNewWorkspacePopover();
        void handleProjectWorktreeClick(result.project, result.worktreePath);
      } catch (error) {
        setNewWorkspaceError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsCreatingWorkspace(false);
      }
    },
    [
      closeNewWorkspacePopover,
      handleProjectWorktreeClick,
      isCreatingWorkspace,
      isOpeningHiddenWorktree,
      newWorkspaceName,
      procedures,
      selectedProject,
      setProjectState,
      upsertProject,
      worktreePinBusyPath,
    ],
  );

  const openHiddenProjectWorktree = useCallback(async () => {
    const openPlan = planMainviewShellHiddenWorktreeOpen({
      hiddenWorktreePath: projectActionMenuHiddenWorktreePath,
      isCreatingWorkspace,
      isOpeningHiddenWorktree,
      project: projectActionMenu
        ? (projectStore.byId[projectActionMenu.projectId] ?? null)
        : null,
      worktreePinBusyPath,
    });
    if (!openPlan.ok) {
      if (openPlan.error) {
        setProjectActionMenuError(openPlan.error);
      }
      return;
    }

    setIsOpeningHiddenWorktree(true);
    setProjectActionMenuError("");
    try {
      await handleProjectWorktreeClick(openPlan.project, openPlan.worktreePath);
      closeProjectActionMenu();
    } catch (error) {
      setProjectActionMenuError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsOpeningHiddenWorktree(false);
    }
  }, [
    closeProjectActionMenu,
    handleProjectWorktreeClick,
    isCreatingWorkspace,
    isOpeningHiddenWorktree,
    projectActionMenu,
    projectActionMenuHiddenWorktreePath,
    projectStore.byId,
    worktreePinBusyPath,
  ]);

  useEffect(() => {
    if (projectActionMenu && !projectActionMenuProject) {
      closeProjectActionMenu();
    }
  }, [closeProjectActionMenu, projectActionMenu, projectActionMenuProject]);

  useEffect(() => {
    if (threadActionMenu && !threadActionMenuThread) {
      closeThreadActionMenu();
    }
  }, [closeThreadActionMenu, threadActionMenu, threadActionMenuThread]);

  useEffect(() => {
    if (newWorkspaceOpen && !selectedProject) {
      closeNewWorkspacePopover();
    }
  }, [closeNewWorkspacePopover, newWorkspaceOpen, selectedProject]);

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
    if (!sessionStateReady || !isDocumentVisible) {
      return;
    }

    const runRefresh = (options?: { refreshProviders?: boolean }): void => {
      if (modelCatalogRefreshAbortControllerRef.current !== null) {
        return;
      }

      const controller = new AbortController();
      modelCatalogRefreshAbortControllerRef.current = controller;
      void refreshModelCatalog(controller.signal, {
        refresh: true,
        ...(options?.refreshProviders ? { refreshProviders: true } : {}),
      })
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          logClientError("Failed to refresh model catalog", error, {
            context: "model-catalog-background-refresh",
          });
        })
        .finally(() => {
          if (modelCatalogRefreshAbortControllerRef.current === controller) {
            modelCatalogRefreshAbortControllerRef.current = null;
          }
        });
    };

    let startupRefreshFrame: number | null = null;
    let startupRefreshTimer: number | null = null;
    const scheduleStartupRefresh = (): void => {
      const startRefresh = (): void => runRefresh({ refreshProviders: true });

      if (typeof window.requestAnimationFrame === "function") {
        startupRefreshFrame = window.requestAnimationFrame(() => {
          startupRefreshFrame = null;
          startupRefreshTimer = window.setTimeout(startRefresh, 0);
        });
        return;
      }

      startupRefreshTimer = window.setTimeout(startRefresh, 0);
    };

    if (modelCatalogRefreshStartedRef.current) {
      runRefresh();
    } else {
      modelCatalogRefreshStartedRef.current = true;
      scheduleStartupRefresh();
    }

    const timer = window.setInterval(
      runRefresh,
      MODEL_CATALOG_REFRESH_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timer);
      if (startupRefreshFrame !== null) {
        window.cancelAnimationFrame(startupRefreshFrame);
      }
      if (startupRefreshTimer !== null) {
        window.clearTimeout(startupRefreshTimer);
      }
      const controller = modelCatalogRefreshAbortControllerRef.current;
      if (controller !== null) {
        modelCatalogRefreshAbortControllerRef.current = null;
        controller.abort(
          createAbortError(null, "Model catalog refresh was canceled."),
        );
      }
    };
  }, [isDocumentVisible, refreshModelCatalog, sessionStateReady]);

  useEffect(() => {
    return subscribeToModelCatalogChanged(applyModelCatalog);
  }, [applyModelCatalog]);

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

  useEffect(() => {
    /**
     * Handles thread start request created.
     * @param event - event value.
     */

    const handleThreadStartRequestCreated = (
      event: CustomEvent<RpcThreadStartRequest>,
    ) => {
      setThreadStartRequestError("");
      setPendingThreadStartRequests(
        (current) =>
          applyMainviewShellThreadStartRequestCreated(
            {
              pendingThreadStartRequests: current,
              threadStartRequestError: "",
            },
            event.detail,
          ).pendingThreadStartRequests,
      );
    };

    const handleThreadStartRequestResolved = (
      event: CustomEvent<{ requestId: string }>,
    ) => {
      setThreadStartRequestError("");
      setPendingThreadStartRequests(
        (current) =>
          applyMainviewShellThreadStartRequestResolved(
            {
              pendingThreadStartRequests: current,
              threadStartRequestError: "",
            },
            event.detail.requestId,
          ).pendingThreadStartRequests,
      );
    };

    window.addEventListener(
      THREAD_START_REQUEST_CREATED_EVENT_NAME,
      handleThreadStartRequestCreated,
    );
    window.addEventListener(
      THREAD_START_REQUEST_RESOLVED_EVENT_NAME,
      handleThreadStartRequestResolved,
    );
    return () => {
      window.removeEventListener(
        THREAD_START_REQUEST_CREATED_EVENT_NAME,
        handleThreadStartRequestCreated,
      );
      window.removeEventListener(
        THREAD_START_REQUEST_RESOLVED_EVENT_NAME,
        handleThreadStartRequestResolved,
      );
    };
  }, []);

  useEffect(() => {
    const handleThreadStatusChanged = (event: CustomEvent<RpcThread>) => {
      setThreadStore((current) => {
        const next = applyMainviewShellThreadStatusEvent({
          projectStore,
          thread: event.detail,
          threadStore: current,
        });
        threadStoreRef.current = next;
        return next;
      });
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
  }, [projectStore]);

  useEffect(() => {
    const nextIndicators = resolveMainviewShellCompletedThreadIndicators({
      completedThreadIndicatorIds,
      hasWorkingThreads,
      previousThreadRunStates: previousThreadRunStatesRef.current,
      selectedThreadId,
      threads,
    });

    previousThreadRunStatesRef.current = nextIndicators.nextThreadRunStates;
    setCompletedThreadIndicatorIds((current) =>
      haveSameMainviewShellCompletedThreadIndicatorIds(
        current,
        nextIndicators.nextCompletedThreadIndicatorIds,
      )
        ? current
        : nextIndicators.nextCompletedThreadIndicatorIds,
    );
    setMobileNavigationIndicator(nextIndicators.nextMobileNavigationIndicator);
  }, [
    completedThreadIndicatorIds,
    hasWorkingThreads,
    selectedThreadId,
    setCompletedThreadIndicatorIds,
    setMobileNavigationIndicator,
    threads,
  ]);

  useEffect(() => {
    if (!mobileProjectListOpen) {
      return;
    }

    setMobileNavigationIndicator("none");
  }, [mobileProjectListOpen, setMobileNavigationIndicator]);

  const dismissUserNotification = useCallback(
    (deliveryId: number): void => {
      setUserNotifications((current) =>
        current.filter((notification) => notification.id !== deliveryId),
      );
      void procedures
        .dismissUserNotification({ deliveryId }, { priority: "background" })
        .catch((error) => {
          logClientError("Failed to dismiss user notification", error, {
            context: `deliveryId:${deliveryId}`,
          });
          void procedures
            .listUserNotifications(undefined, { priority: "background" })
            .then((notifications) => {
              setUserNotifications(limitUserNotifications(notifications));
            })
            .catch((listError) => {
              logClientError("Failed to refresh user notifications", listError);
            });
        });
    },
    [procedures],
  );

  const dismissCalendarNotification = useCallback(
    (deliveryId: number): void => {
      setCalendarNotifications((current) =>
        current.filter((notification) => notification.id !== deliveryId),
      );
      setOpenCalendarNotificationEvent((current) =>
        current?.id === deliveryId ? null : current,
      );
      void procedures
        .dismissCalendarNotification({ deliveryId }, { priority: "background" })
        .catch((error) => {
          logClientError("Failed to dismiss calendar notification", error, {
            context: `deliveryId:${deliveryId}`,
          });
          void procedures
            .listCalendarNotifications(undefined, { priority: "background" })
            .then((notifications) => {
              setCalendarNotifications(
                limitCalendarNotifications(notifications),
              );
            })
            .catch((listError) => {
              logClientError(
                "Failed to refresh calendar notifications",
                listError,
              );
            });
        });
    },
    [procedures],
  );

  useEffect(() => {
    let cancelled = false;
    void procedures
      .listCalendarNotifications(undefined, { priority: "background" })
      .then((notifications) => {
        if (!cancelled) {
          setCalendarNotifications(limitCalendarNotifications(notifications));
        }
      })
      .catch((error) => {
        logClientError("Failed to load calendar notifications", error);
      });
    void procedures
      .listUserNotifications(undefined, { priority: "background" })
      .then((notifications) => {
        if (!cancelled) {
          setUserNotifications(limitUserNotifications(notifications));
        }
      })
      .catch((error) => {
        logClientError("Failed to load user notifications", error);
      });
    return () => {
      cancelled = true;
    };
  }, [procedures]);

  useEffect(() => {
    const handleCalendarNotifications = (
      event: CustomEvent<RpcCalendarReminderDelivery[]>,
    ): void => {
      setCalendarNotifications((current) =>
        mergeCalendarNotifications(current, event.detail),
      );
      for (const delivery of event.detail) {
        if (delivery.channel === "browser") {
          showBrowserCalendarNotification(delivery);
        }
      }
    };
    const handleUserNotification = (
      event: CustomEvent<RpcUserNotificationDelivery>,
    ): void => {
      setUserNotifications((current) =>
        mergeUserNotifications(current, [event.detail]),
      );
    };
    window.addEventListener(
      CALENDAR_NOTIFICATIONS_DUE_EVENT_NAME,
      handleCalendarNotifications,
    );
    window.addEventListener(
      USER_NOTIFICATION_SENT_EVENT_NAME,
      handleUserNotification,
    );
    return () => {
      window.removeEventListener(
        CALENDAR_NOTIFICATIONS_DUE_EVENT_NAME,
        handleCalendarNotifications,
      );
      window.removeEventListener(
        USER_NOTIFICATION_SENT_EVENT_NAME,
        handleUserNotification,
      );
    };
  }, []);

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

  const handleCreateThreadForActiveWorktree = useCallback(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return;
    }
    void createThreadForWorktree(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
  }, [activeSelectedWorktreePath, createThreadForWorktree, selectedProject]);

  const handleToggleFolderSelector = useCallback((): void => {
    if (addProjectOpen) {
      closeAddProjectForm();
      return;
    }

    toggleAddProjectForm();
  }, [addProjectOpen, closeAddProjectForm, toggleAddProjectForm]);

  const handleToggleActiveWorktreePinned = useCallback((): void => {
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      !activeSelectedWorktree
    ) {
      return;
    }

    void toggleWorktreePinned(
      selectedProject.id,
      activeSelectedWorktreePath,
      Boolean(activeSelectedWorktree.pinnedAt),
    );
  }, [
    activeSelectedWorktree,
    activeSelectedWorktreePath,
    selectedProject,
    toggleWorktreePinned,
  ]);

  const handleOpenThread = useCallback(
    (threadId: number) => {
      void openThread(threadId);
    },
    [openThread],
  );
  const handleOpenPinnedThread = useCallback(
    (threadId: number): void => {
      setPrimaryViewForNavigation((current) =>
        derivePrimaryViewForPinnedThreadOpen(current),
      );
      handleOpenThread(threadId);
    },
    [handleOpenThread, setPrimaryViewForNavigation],
  );
  const handleOpenPinnedFolder = useCallback(
    (project: RpcProject, worktreePath: string): void => {
      void handleProjectWorktreeClick(project, worktreePath);
    },
    [handleProjectWorktreeClick],
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

  const {
    mediaPayloads: visibleMediaPayloads,
    messages: visibleMessages,
    transcriptIsBusy: visibleTranscriptIsBusy,
  } = useVisibleMessages({
    activeChatError,
    activeChatNotice,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreePath,
    activeThreadWorkingMessage: activeThreadExtensionUiState?.workingMessage,
    activeThreadWorkingVisible: activeThreadExtensionUiState?.workingVisible,
    isCreatingThread,
    isThreadLoading,
    selectedProject,
    selectedThread,
    selectedThreadId,
    threadMessages,
  });

  const transcriptMediaPayloads = useMemo(
    () =>
      mergeTranscriptMediaPayloadData(
        visibleMediaPayloads,
        loadedTranscriptMediaPayloads,
      ),
    [loadedTranscriptMediaPayloads, visibleMediaPayloads],
  );

  const _sidebarActionButtonClass =
    "flex h-8 w-8 shrink-0 items-center justify-center border border-border-default bg-surface-2 text-accent transition-colors hover:border-border-default hover:bg-surface-2 hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50";
  const _selectedThreadContextBranchLabel =
    activeSelectedWorktree?.branch?.trim() || "Primary";
  const _selectedThreadContextPathLabel = activeSelectedWorktreePath
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
    setPrimaryViewForNavigation("cronjobs");
  }, [setPrimaryViewForNavigation]);

  const handlePrimaryViewTabKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLElement>,
      variant: "desktop" | "mobile",
    ): void => {
      const order = PRIMARY_VIEW_TAB_ORDER[variant];
      const currentIndex = Math.max(0, order.indexOf(primaryView));
      let nextIndex: number | null = null;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (currentIndex + 1) % order.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (currentIndex - 1 + order.length) % order.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = order.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextView = order[nextIndex];
      if (!nextView) {
        return;
      }
      if (variant === "mobile") {
        setMobileProjectListOpen(false);
      }
      setPrimaryViewForNavigation(nextView);
      window.requestAnimationFrame(() => {
        document
          .getElementById(PRIMARY_VIEW_TAB_IDS[variant][nextView])
          ?.focus();
      });
    },
    [primaryView, setPrimaryViewForNavigation],
  );

  const handleNewWorkspaceNameChange = useCallback((value: string) => {
    setNewWorkspaceError("");
    setNewWorkspaceName(value);
  }, []);

  const toggleNewWorkspacePopover = useCallback(() => {
    if (!selectedProject) {
      return;
    }
    closeProjectActionMenu();
    closeThreadActionMenu();
    setNewWorkspaceOpen((current) => !current);
    setNewWorkspaceError("");
  }, [closeProjectActionMenu, closeThreadActionMenu, selectedProject]);

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
    devLog("App mounted", window.__metidosAppMountedAt);
  }, []);

  const renderNotificationTrayBody = (): JSX.Element => (
    <>
      <div className="mb-2 font-label text-[10px] uppercase tracking-[0.1em] text-accent">
        Notifications
      </div>
      {notificationPanelItems.length === 0 ? (
        <div className="px-2 py-3 text-xs text-text-muted">
          No notifications.
        </div>
      ) : (
        notificationPanelItems.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-2 border-b border-border-subtle hover:bg-hover-surface"
          >
            <AppButton
              unstyled
              type="button"
              className="min-w-0 flex-1 px-2 py-2 text-left text-xs"
              onClick={() => {
                if (item.type === "calendar") {
                  setOpenCalendarNotificationEvent(item.notification);
                  setPrimaryViewForNavigation("calendar");
                  setCalendarNotificationTrayOpen(false);
                  dismissCalendarNotification(item.notification.id);
                  return;
                }
                const clickUrl = safeExternalHttpUrl(
                  item.notification.clickUrl,
                );
                if (clickUrl) {
                  window.open(clickUrl, "_blank", "noopener,noreferrer");
                }
                dismissUserNotification(item.notification.id);
              }}
            >
              <span className="block font-medium text-text-secondary">
                {item.notification.title}
              </span>
              <span className="block text-[11px] text-text-faint">
                {item.notification.body}
              </span>
            </AppButton>
            <AppButton
              unstyled
              type="button"
              className="px-2 py-2 text-xs text-text-faint hover:text-text-primary"
              aria-label={`Dismiss notification ${item.notification.title}`}
              onClick={() => {
                if (item.type === "calendar") {
                  dismissCalendarNotification(item.notification.id);
                } else {
                  dismissUserNotification(item.notification.id);
                }
              }}
            >
              {materialSymbol("close", "text-[15px]")}
            </AppButton>
          </div>
        ))
      )}
    </>
  );

  return (
    <div className="h-screen overflow-hidden bg-bg-app text-text-primary">
      <div className="hidden h-full md:flex md:flex-col">
        <header className="flex justify-between items-center w-full px-6 h-14 bg-bg-app border-b border-border-subtle z-50">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-black tracking-tighter text-accent-strong">
              {APP_TITLE}
            </h1>
            <nav aria-label="Primary views">
              <div
                className="flex items-center gap-6"
                role="tablist"
                onKeyDown={(event) =>
                  handlePrimaryViewTabKeyDown(event, "desktop")
                }
              >
                <AppButton
                  unstyled
                  type="button"
                  id={PRIMARY_VIEW_TAB_IDS.desktop.chat}
                  role="tab"
                  aria-controls={PRIMARY_VIEW_PANEL_IDS.desktop.chat}
                  aria-selected={primaryView === "chat"}
                  tabIndex={primaryView === "chat" ? 0 : -1}
                  className={`font-label text-xs uppercase tracking-[0.1em] pb-1 transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2 ${
                    primaryView === "chat"
                      ? "border-b-2 border-accent text-accent-strong"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                  onClick={() => {
                    setPrimaryViewForNavigation("chat");
                  }}
                >
                  Chat
                </AppButton>
                <AppButton
                  unstyled
                  type="button"
                  id={PRIMARY_VIEW_TAB_IDS.desktop.diff}
                  role="tab"
                  aria-controls={PRIMARY_VIEW_PANEL_IDS.desktop.diff}
                  aria-selected={primaryView === "diff"}
                  tabIndex={primaryView === "diff" ? 0 : -1}
                  className={`font-label text-xs uppercase tracking-[0.1em] pb-1 transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2 ${
                    primaryView === "diff"
                      ? "border-b-2 border-accent text-accent-strong"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                  onClick={() => {
                    setPrimaryViewForNavigation("diff");
                  }}
                >
                  Diff
                </AppButton>
                <AppButton
                  unstyled
                  type="button"
                  id={PRIMARY_VIEW_TAB_IDS.desktop.cronjobs}
                  role="tab"
                  aria-controls={PRIMARY_VIEW_PANEL_IDS.desktop.cronjobs}
                  aria-selected={primaryView === "cronjobs"}
                  tabIndex={primaryView === "cronjobs" ? 0 : -1}
                  className={`font-label text-xs uppercase tracking-[0.1em] pb-1 transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2 ${
                    primaryView === "cronjobs"
                      ? "border-b-2 border-accent text-accent-strong"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                  onClick={handleShowCronjobs}
                >
                  Crons
                </AppButton>
                <AppButton
                  unstyled
                  type="button"
                  id={PRIMARY_VIEW_TAB_IDS.desktop.calendar}
                  role="tab"
                  aria-controls={PRIMARY_VIEW_PANEL_IDS.desktop.calendar}
                  aria-selected={primaryView === "calendar"}
                  tabIndex={primaryView === "calendar" ? 0 : -1}
                  className={`font-label text-xs uppercase tracking-[0.1em] pb-1 transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2 ${
                    primaryView === "calendar"
                      ? "border-b-2 border-accent text-accent-strong"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                  onClick={() => {
                    setPrimaryViewForNavigation("calendar");
                  }}
                >
                  Calendar
                </AppButton>
              </div>
            </nav>
          </div>
          <div className="relative flex items-center gap-3">
            <AppButton
              aria-label="Notifications"
              buttonStyle={calendarNotificationTrayOpen ? "secondary" : "muted"}
              className="relative"
              iconOnly
              onClick={() => setCalendarNotificationTrayOpen((value) => !value)}
              ref={desktopNotificationTrayButtonRef}
            >
              {materialSymbol("notifications", "text-[17px]")}
              {notificationPanelItems.length > 0 ? (
                <span className="absolute -right-1 -top-1 bg-accent px-1 text-[10px] text-bg-app">
                  {notificationPanelItems.length}
                </span>
              ) : null}
            </AppButton>
            {calendarNotificationTrayOpen && isDesktopViewport ? (
              <PopoverSurface
                aria-label="Notifications"
                className="z-[120] w-[26rem] max-w-[calc(100vw-2rem)] border border-border-default bg-surface-overlay p-2 shadow-overlay"
                onRequestClose={() => setCalendarNotificationTrayOpen(false)}
                open
                placement="bottom-end"
                reference={desktopNotificationTrayButtonRef.current}
                surfaceMode="nonmodal-dialog"
              >
                {renderNotificationTrayBody()}
              </PopoverSurface>
            ) : null}
            <Suspense
              fallback={
                <WorkspaceLoadingFallback
                  label="Loading settings..."
                  variant="popover"
                />
              }
            >
              <SettingsPanel
                active={isDesktopViewport}
                availablePluginAccessGroups={availablePluginAccessGroups}
                availableThreadPermissionDescriptors={
                  availableThreadPermissionDescriptors
                }
                codexModels={codexModels}
                defaultCodexModel={defaultCodexModel}
                homeDirectory={homeDirectory}
                isAdmin={isAdmin}
                onModelCatalogChange={applyModelCatalog}
                onPluginAccessGroupsChange={setAvailablePluginAccessGroups}
                procedures={procedures}
                supportsTildePath={supportsTildePath}
              />
            </Suspense>
          </div>
        </header>

        <main className="flex flex-1 min-h-0 overflow-hidden">
          <DesktopSidebar
            initialCollapsed={initialMainviewState.sidebarCollapsed}
            onCollapsedChange={handleSidebarCollapsedChange}
            renderExpandedContent={(collapseSidebar) => (
              <div className="flex h-full flex-1 flex-col">
                <DesktopSidebarContent
                  activeSidebarBranchLabel={activeSidebarBranchLabel}
                  activeWorktreePinDisabled={activeWorktreePinDisabled}
                  activeWorktreePinned={activeWorktreePinned}
                  collapseControl={
                    <AppButton
                      aria-label="Collapse sidebar"
                      buttonStyle="muted"
                      iconOnly
                      onClick={collapseSidebar}
                    >
                      {materialSymbol(
                        "chevron_right",
                        "rotate-180 text-[17px]",
                      )}
                    </AppButton>
                  }
                  folderSelectorControl={
                    addProjectOpen ? (
                      <FolderPathSelectorControl
                        addProjectError={addProjectError}
                        addProjectInputIsPreviewing={
                          addProjectInputIsPreviewing
                        }
                        addProjectPath={addProjectPath}
                        directorySuggestions={directorySuggestions}
                        directorySuggestionsLoading={
                          directorySuggestionsLoading
                        }
                        createFolderPromptPath={createFolderPromptPath}
                        displayedAddProjectPath={displayedAddProjectPath}
                        homeDirectory={homeDirectory}
                        hoveredDirectorySuggestion={hoveredDirectorySuggestion}
                        isAddingProject={isAddingProject}
                        onAddProjectPathChange={handleAddProjectPathChange}
                        onCancelCreateFolderPrompt={cancelCreateFolderPrompt}
                        onClose={closeAddProjectForm}
                        onDirectorySuggestionEnter={
                          handleDirectorySuggestionEnter
                        }
                        onDirectorySuggestionLeave={
                          handleDirectorySuggestionLeave
                        }
                        onConfirmCreateFolderPrompt={confirmCreateFolderPrompt}
                        onSelectDirectorySuggestion={selectDirectorySuggestion}
                        onSubmit={submitAddProject}
                        supportsTildePath={supportsTildePath}
                      />
                    ) : null
                  }
                  folderSelectorOpen={addProjectOpen}
                  gitHistoryPanelKey={`${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`}
                  isCreatingWorkspace={isCreatingWorkspace}
                  activeSelectedWorktreeMissing={activeSelectedWorktreeMissing}
                  activeSelectedWorktreePath={activeSelectedWorktreePath}
                  filteredGitHistoryEntries={filteredGitHistoryEntries}
                  gitHistoryError={gitHistoryError}
                  gitHistoryLoading={gitHistoryLoading}
                  gitHistoryLoadingMore={gitHistoryLoadingMore}
                  isCreatingThread={isCreatingThread}
                  terminalAccessAllowed={isAdmin}
                  newWorkspaceError={newWorkspaceError}
                  newWorkspaceName={newWorkspaceName}
                  newWorkspaceOpen={isDesktopViewport && newWorkspaceOpen}
                  normalizedSidebarSearchQuery={normalizedSidebarSearchQuery}
                  onCreateThread={handleCreateThreadForActiveWorktree}
                  onCreateTerminal={() => {
                    void terminalsController.createTerminal();
                    setPrimaryViewForNavigation("chat");
                  }}
                  onCloseNewWorkspace={closeNewWorkspacePopover}
                  onLoadMoreGitHistory={handleLoadMoreGitHistory}
                  onLoadMoreThreads={loadMoreThreads}
                  onNewWorkspaceNameChange={handleNewWorkspaceNameChange}
                  onOpenFolder={handleOpenPinnedFolder}
                  onOpenGitHistoryDiff={handleOpenGitHistoryDiff}
                  onOpenThread={handleOpenPinnedThread}
                  onOpenThreadActionMenu={openThreadActionMenu}
                  onSidebarSearchQueryChange={setSidebarSearchQuery}
                  onSubmitNewWorkspace={(event) => {
                    void submitNewWorkspace(event);
                  }}
                  onToggleActiveWorktreePinned={
                    handleToggleActiveWorktreePinned
                  }
                  onToggleFolderSelector={handleToggleFolderSelector}
                  onToggleNewWorkspace={toggleNewWorkspacePopover}
                  activeProjectId={selectedProject?.id ?? null}
                  activeWorktreePath={activeSelectedWorktreePath}
                  pinnedFolders={sidebarPinnedFolders}
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                  dismissThreadStatus={dismissThreadStatus}
                  isThreadStatusDismissed={isThreadStatusDismissed}
                  pinnedThreads={sidebarFilteredPinnedThreads}
                  projectById={projectById}
                  recentThreads={sidebarFilteredRecentThreads}
                  scrollRef={desktopSidebarScrollRef}
                  selectedProject={selectedProject}
                  selectedThreadId={selectedThreadId}
                  selectedProjectName={activeSelectedWorktreeFolder}
                  sidebarSearchQuery={sidebarSearchQuery}
                  threadActivityIndicator={threadActivityIndicator}
                  threadPreviewsDisabled={threadActionMenu !== null}
                  threadsError={threadsError}
                  worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                  worktreeByProjectAndPath={worktreeByProjectAndPath}
                />
              </div>
            )}
          />

          <section
            id={PRIMARY_VIEW_PANEL_IDS.desktop[primaryView]}
            role="tabpanel"
            aria-labelledby={PRIMARY_VIEW_TAB_IDS.desktop[primaryView]}
            className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-app"
          >
            {primaryView === "chat" ? (
              isDesktopViewport ? (
                <MemoizedDesktopChatView
                  activeCodexModel={activeCodexModel}
                  activeContextInputTokens={activeContextInputTokens}
                  activeContextWindowTokens={activeContextWindowTokens}
                  activeReasoningEffort={activeReasoningEffort}
                  activeScreenSubtitlePrimary={activeScreenSubtitlePrimary}
                  activeScreenSubtitleSecondary={activeScreenSubtitleSecondary}
                  activeScreenTitle={activeScreenTitle}
                  activeTerminalId={terminalsController.selectedTerminalId}
                  activeThreadId={selectedThreadId}
                  availablePluginAccessGroups={availablePluginAccessGroups}
                  availableThreadPermissionDescriptors={
                    availableThreadPermissionDescriptors
                  }
                  availableSkills={availableSkills}
                  canCreateTerminal={Boolean(
                    selectedProject && activeSelectedWorktreePath,
                  )}
                  codexModels={codexModels}
                  composerActionDisabled={composerActionDisabled}
                  composerActionLabel={composerActionLabel}
                  composerDisabled={composerDisabled}
                  composerDraftKey={selectedComposerDraftKey}
                  homeDirectory={homeDirectory}
                  supportsTildePath={supportsTildePath}
                  extensionHiddenThinkingLabel={
                    activeThreadExtensionUiState?.hiddenThinkingLabel ?? null
                  }
                  extensionStatusEntries={activeThreadExtensionStatuses}
                  extensionWidgetsAbove={activeThreadExtensionWidgetsAbove}
                  extensionWidgetsBelow={activeThreadExtensionWidgetsBelow}
                  expandedItemIds={expandedTranscriptItemIds}
                  hasSelectedThread={Boolean(selectedThread)}
                  initialChatInput={readPersistedChatDraft(selectedThreadId)}
                  interactionMode={terminalsController.interactionMode}
                  isRefreshingModelCatalog={isRefreshingModelCatalog}
                  isWorking={selectedThreadIsWorking}
                  localUserLabel={localUserLabel}
                  mediaPayloads={transcriptMediaPayloads}
                  messages={visibleMessages}
                  transcriptIsBusy={visibleTranscriptIsBusy}
                  modelControlError={modelControlError}
                  modelSelectorDisabled={modelSelectorDisabled}
                  onChangeModel={updateActiveCodexModel}
                  onChangeReasoningEffort={updateActiveReasoningEffort}
                  onChangeThreadAccess={(value) => {
                    void updateActiveThreadAccess(value);
                  }}
                  onRefreshModelCatalog={() => {
                    void handleRefreshModelCatalog();
                  }}
                  onCloseTerminal={(terminal) => {
                    void terminalsController.closeTerminal(terminal);
                  }}
                  onComposerDraftChange={(value) => {
                    schedulePersistedChatDraftWrite(selectedThreadId, value);
                    syncThreadExtensionEditor(selectedThreadId, value);
                  }}
                  onCreateTerminal={(options) => {
                    void terminalsController.createTerminal(options);
                    setPrimaryViewForNavigation("chat");
                  }}
                  onRenameTerminal={(terminalId, title) => {
                    void terminalsController.renameTerminal(terminalId, title);
                  }}
                  onSelectTerminal={terminalsController.setSelectedTerminalId}
                  onSetInteractionMode={terminalsController.setInteractionMode}
                  onSubmit={onSubmit}
                  onSubmitMessage={postMessage}
                  onRequestMessageContent={requestThreadMessageContent}
                  onToggleItemExpanded={toggleTranscriptItemExpanded}
                  reasoningEffortControlError={reasoningEffortControlError}
                  reasoningEffortSelectorDisabled={
                    reasoningEffortSelectorDisabled
                  }
                  reasoningEfforts={reasoningEfforts}
                  selectedThreadIsWorking={selectedThreadIsWorking}
                  terminalAccessAllowed={isAdmin}
                  terminals={terminalsController.terminals}
                  threadAccessControlError={threadAccessControlError}
                  threadAccessControlDisabled={threadAccessControlDisabled}
                  threadAccessValue={sanitizedActiveThreadAccessValue}
                  showUnsafeModeControl={isAdmin}
                />
              ) : null
            ) : primaryView === "cronjobs" ? (
              <MainviewCronWorkspaceController
                activeCodexModel={activeCodexModel}
                activeReasoningEffort={activeReasoningEffort}
                activeSelectedWorktreePath={activeSelectedWorktreePath}
                availablePluginAccessGroups={availablePluginAccessGroups}
                availableThreadPermissionDescriptors={
                  availableThreadPermissionDescriptors
                }
                codexModels={codexModels}
                defaultCodexModel={defaultCodexModel}
                defaultCodexReasoningEffort={defaultCodexReasoningEffort}
                executeRpcAction={executeRpcAction}
                getProjectState={getProjectState}
                handleRefreshModelCatalog={handleRefreshModelCatalog}
                homeDirectory={homeDirectory}
                hydrateProjectRows={hydrateProjectRows}
                isAdmin={isAdmin}
                isDocumentVisible={isDocumentVisible}
                isRefreshingModelCatalog={isRefreshingModelCatalog}
                openThread={openThread}
                prepareOpenedThreadDetail={prepareOpenedThreadDetail}
                procedures={procedures}
                reasoningEfforts={reasoningEfforts}
                replaceThreads={replaceThreads}
                safeChildAccessDefaults={safeChildAccessDefaults}
                selectedProject={selectedProject}
                selectedProjectId={selectedProjectId}
                selectedWorktreePath={selectedWorktreePath}
                setPrimaryViewForNavigation={setPrimaryViewForNavigation}
                setProjectState={setProjectState}
                supportsTildePath={supportsTildePath}
                upsertProject={upsertProject}
                upsertThread={upsertThread}
                variant="desktop"
              />
            ) : primaryView === "calendar" ? (
              <Suspense
                fallback={
                  <WorkspaceLoadingFallback label="Loading calendar..." />
                }
              >
                <CalendarWorkspace
                  openNotificationEvent={openCalendarNotificationEvent}
                  procedures={procedures}
                  variant="desktop"
                />
              </Suspense>
            ) : (
              <div className="flex min-h-0 flex-1 px-6 py-6">
                <Suspense
                  fallback={
                    <WorkspaceLoadingFallback label="Loading diff workspace..." />
                  }
                >
                  <DiffWorkspace
                    activeSelectedWorktreeFolder={activeSelectedWorktreeFolder}
                    activeSelectedWorktreeName={activeSelectedWorktreeName}
                    activeSelectedWorktreeOpened={activeSelectedWorktreeOpened}
                    activeSelectedWorktreePath={activeSelectedWorktreePath}
                    activeWorktreeChanges={activeWorktreeChanges}
                    diffFilePatchState={diffFilePatchState}
                    diffFileTree={diffFileTree}
                    gitInitializationError={gitInitializationError}
                    gitInitializationState={gitInitializationState}
                    hasActiveWorktreeSnapshot={Boolean(activeWorktreeSnapshot)}
                    isRefreshingWorktreeSnapshot={isRefreshingWorktreeSnapshot}
                    nonGitRepositoryDeclined={nonGitRepositoryDeclined}
                    onDeclineGitInitialization={handleDeclineGitInitialization}
                    onInitializeGitRepository={handleInitializeGitRepository}
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
                    variant="desktop"
                    worktreeDiffError={worktreeDiffError}
                  />
                </Suspense>
              </div>
            )}
          </section>
        </main>
      </div>

      <div className="flex h-full flex-col overflow-hidden md:hidden">
        <header className="fixed top-0 w-full z-50 bg-bg-app flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <AppButton
              unstyled
              type="button"
              className="relative text-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2"
              aria-controls="mobile-navigation-drawer"
              aria-expanded={mobileProjectListOpen}
              aria-label={
                mobileProjectListOpen ? "Close navigation" : "Open navigation"
              }
              onClick={() => setMobileProjectListOpen((value) => !value)}
            >
              {materialSymbol("menu")}
              {mobileNavigationIndicator !== "none" ? (
                <StatusIcon
                  className="absolute bottom-0 right-0 border border-bg-app"
                  tone={
                    mobileNavigationIndicator === "completed"
                      ? "success"
                      : "info"
                  }
                />
              ) : null}
            </AppButton>
            <h1 className="font-headline tracking-[0.1em] uppercase text-sm font-semibold text-accent-strong">
              {APP_TITLE}
            </h1>
          </div>
          <div className="relative flex items-center gap-3">
            <AppButton
              aria-label="Notifications"
              buttonStyle={calendarNotificationTrayOpen ? "secondary" : "muted"}
              className="relative"
              iconOnly
              onClick={() => setCalendarNotificationTrayOpen((value) => !value)}
              ref={mobileNotificationTrayButtonRef}
            >
              {materialSymbol("notifications", "text-[17px]")}
              {notificationPanelItems.length > 0 ? (
                <span className="absolute -right-1 -top-1 bg-accent px-1 text-[10px] text-bg-app">
                  {notificationPanelItems.length}
                </span>
              ) : null}
            </AppButton>
            {calendarNotificationTrayOpen && !isDesktopViewport ? (
              <PopoverSurface
                aria-label="Notifications"
                className="z-[120] w-[26rem] max-w-[calc(100vw-2rem)] border border-border-default bg-surface-overlay p-2 shadow-overlay"
                onRequestClose={() => setCalendarNotificationTrayOpen(false)}
                open
                placement="bottom-end"
                reference={mobileNotificationTrayButtonRef.current}
                surfaceMode="nonmodal-dialog"
              >
                {renderNotificationTrayBody()}
              </PopoverSurface>
            ) : null}
            <Suspense
              fallback={
                <WorkspaceLoadingFallback
                  label="Loading settings..."
                  variant="popover"
                />
              }
            >
              <SettingsPanel
                active={!isDesktopViewport}
                availablePluginAccessGroups={availablePluginAccessGroups}
                availableThreadPermissionDescriptors={
                  availableThreadPermissionDescriptors
                }
                codexModels={codexModels}
                defaultCodexModel={defaultCodexModel}
                homeDirectory={homeDirectory}
                isAdmin={isAdmin}
                onModelCatalogChange={applyModelCatalog}
                onPluginAccessGroupsChange={setAvailablePluginAccessGroups}
                procedures={procedures}
                supportsTildePath={supportsTildePath}
              />
            </Suspense>
          </div>
        </header>

        {mobileProjectListOpen ? (
          <aside
            aria-label="Thread and git navigation"
            className="fixed inset-x-0 top-14 z-40 h-[68vh] overflow-y-auto border-b border-border-subtle bg-bg-app px-3 py-3"
            id="mobile-navigation-drawer"
            ref={mobileSidebarScrollRef}
          >
            <SidebarContent
              activeSidebarBranchLabel={activeSidebarBranchLabel}
              activeWorktreePinDisabled={activeWorktreePinDisabled}
              activeWorktreePinned={activeWorktreePinned}
              collapseControl={null}
              folderSelectorControl={
                addProjectOpen ? (
                  <FolderPathSelectorControl
                    addProjectError={addProjectError}
                    addProjectInputIsPreviewing={addProjectInputIsPreviewing}
                    addProjectPath={addProjectPath}
                    directorySuggestions={directorySuggestions}
                    directorySuggestionsLoading={directorySuggestionsLoading}
                    createFolderPromptPath={createFolderPromptPath}
                    displayedAddProjectPath={displayedAddProjectPath}
                    homeDirectory={homeDirectory}
                    hoveredDirectorySuggestion={hoveredDirectorySuggestion}
                    isAddingProject={isAddingProject}
                    onAddProjectPathChange={handleAddProjectPathChange}
                    onCancelCreateFolderPrompt={cancelCreateFolderPrompt}
                    onClose={closeAddProjectForm}
                    onDirectorySuggestionEnter={handleDirectorySuggestionEnter}
                    onDirectorySuggestionLeave={handleDirectorySuggestionLeave}
                    onConfirmCreateFolderPrompt={confirmCreateFolderPrompt}
                    onSelectDirectorySuggestion={selectDirectorySuggestion}
                    onSubmit={submitAddProject}
                    supportsTildePath={supportsTildePath}
                  />
                ) : null
              }
              folderSelectorOpen={addProjectOpen}
              gitHistoryPanelKey={`${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`}
              gitHistoryPanelProps={{
                activeSelectedWorktreeMissing,
                activeSelectedWorktreePath,
                filteredGitHistoryEntries,
                gitHistoryError,
                gitHistoryLoading,
                gitHistoryLoadingMore,
                onLoadMoreGitHistory: handleLoadMoreGitHistory,
                onOpenGitHistoryDiff: handleOpenGitHistoryDiff,
                selectedProject,
              }}
              isCreatingThread={isCreatingThread}
              isCreatingWorkspace={isCreatingWorkspace}
              newWorkspaceError={newWorkspaceError}
              newWorkspaceName={newWorkspaceName}
              newWorkspaceOpen={!isDesktopViewport && newWorkspaceOpen}
              onCloseNewWorkspace={closeNewWorkspacePopover}
              onCreateThread={handleCreateThreadForActiveWorktree}
              onNewWorkspaceNameChange={handleNewWorkspaceNameChange}
              onSidebarSearchQueryChange={setSidebarSearchQuery}
              onSubmitNewWorkspace={(event) => {
                void submitNewWorkspace(event);
              }}
              onToggleActiveWorktreePinned={handleToggleActiveWorktreePinned}
              onToggleFolderSelector={handleToggleFolderSelector}
              onToggleNewWorkspace={toggleNewWorkspacePopover}
              pinnedFoldersPanelProps={{
                activeProjectId: selectedProject?.id ?? null,
                activeWorktreePath: activeSelectedWorktreePath,
                normalizedSidebarSearchQuery,
                onOpenFolder: handleOpenPinnedFolder,
                pinnedFolders: sidebarPinnedFolders,
              }}
              pinnedThreadsPanelProps={{
                acknowledgeThreadErrorSeenInBackground,
                clearCompletedThreadIndicator,
                dismissThreadStatus,
                isThreadStatusDismissed,
                normalizedSidebarSearchQuery,
                onLoadMoreThreads: loadMoreThreads,
                onOpenThread: handleOpenThread,
                onOpenThreadActionMenu: openThreadActionMenu,
                pinnedThreads: sidebarFilteredPinnedThreads,
                projectById,
                recentThreads: sidebarFilteredRecentThreads,
                selectedThreadId,
                threadActivityIndicator,
                threadPreviewsDisabled: threadActionMenu !== null,
                threadsError,
                worktreeDisplayPathByKey,
                worktreeByProjectAndPath,
              }}
              selectedProjectName={activeSelectedWorktreeFolder}
              sidebarSearchQuery={sidebarSearchQuery}
              workspaceActionDisabled={!selectedProject}
            />
          </aside>
        ) : null}

        <main
          id={PRIMARY_VIEW_PANEL_IDS.mobile[primaryView]}
          role="tabpanel"
          aria-labelledby={PRIMARY_VIEW_TAB_IDS.mobile[primaryView]}
          className={`mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col gap-6 px-4 pt-14 pb-16 ${
            primaryView === "diff" || primaryView === "calendar"
              ? "app-scrollbar overflow-y-auto"
              : ""
          }`}
        >
          {primaryView === "chat" ? (
            !isDesktopViewport ? (
              <MemoizedMobileChatView
                activeCodexModel={activeCodexModel}
                activeReasoningEffort={activeReasoningEffort}
                activeScreenSubtitlePrimary={activeScreenSubtitlePrimary}
                activeScreenSubtitleSecondary={activeScreenSubtitleSecondary}
                activeScreenTitle={activeScreenTitle}
                activeThreadId={selectedThreadId}
                availablePluginAccessGroups={availablePluginAccessGroups}
                availableThreadPermissionDescriptors={
                  availableThreadPermissionDescriptors
                }
                availableSkills={availableSkills}
                codexModels={codexModels}
                composerActionDisabled={composerActionDisabled}
                composerActionLabel={composerActionLabel}
                composerDisabled={composerDisabled}
                composerDraftKey={selectedComposerDraftKey}
                homeDirectory={homeDirectory}
                supportsTildePath={supportsTildePath}
                extensionHiddenThinkingLabel={
                  activeThreadExtensionUiState?.hiddenThinkingLabel ?? null
                }
                extensionStatusEntries={activeThreadExtensionStatuses}
                extensionWidgetsAbove={activeThreadExtensionWidgetsAbove}
                extensionWidgetsBelow={activeThreadExtensionWidgetsBelow}
                expandedItemIds={expandedTranscriptItemIds}
                hasSelectedThread={Boolean(selectedThread)}
                initialChatInput={initialMainviewState.chatInput}
                isRefreshingModelCatalog={isRefreshingModelCatalog}
                isWorking={selectedThreadIsWorking}
                localUserLabel={localUserLabel}
                mediaPayloads={transcriptMediaPayloads}
                messages={visibleMessages}
                transcriptIsBusy={visibleTranscriptIsBusy}
                modelControlError={modelControlError}
                modelSelectorDisabled={modelSelectorDisabled}
                onChangeModel={updateActiveCodexModel}
                onChangeReasoningEffort={updateActiveReasoningEffort}
                onChangeThreadAccess={(value) => {
                  void updateActiveThreadAccess(value);
                }}
                onRefreshModelCatalog={() => {
                  void handleRefreshModelCatalog();
                }}
                onComposerDraftChange={(value) => {
                  schedulePersistedChatDraftWrite(selectedThreadId, value);
                  syncThreadExtensionEditor(selectedThreadId, value);
                }}
                onSubmit={onSubmit}
                onSubmitMessage={postMessage}
                onRequestMessageContent={requestThreadMessageContent}
                onToggleItemExpanded={toggleTranscriptItemExpanded}
                reasoningEffortControlError={reasoningEffortControlError}
                reasoningEffortSelectorDisabled={
                  reasoningEffortSelectorDisabled
                }
                reasoningEfforts={reasoningEfforts}
                selectedThreadIsWorking={selectedThreadIsWorking}
                threadAccessControlError={threadAccessControlError}
                threadAccessControlDisabled={threadAccessControlDisabled}
                threadAccessValue={sanitizedActiveThreadAccessValue}
                showUnsafeModeControl={isAdmin}
              />
            ) : null
          ) : primaryView === "cronjobs" ? (
            <MainviewCronWorkspaceController
              activeCodexModel={activeCodexModel}
              activeReasoningEffort={activeReasoningEffort}
              activeSelectedWorktreePath={activeSelectedWorktreePath}
              availablePluginAccessGroups={availablePluginAccessGroups}
              availableThreadPermissionDescriptors={
                availableThreadPermissionDescriptors
              }
              codexModels={codexModels}
              defaultCodexModel={defaultCodexModel}
              defaultCodexReasoningEffort={defaultCodexReasoningEffort}
              executeRpcAction={executeRpcAction}
              getProjectState={getProjectState}
              handleRefreshModelCatalog={handleRefreshModelCatalog}
              homeDirectory={homeDirectory}
              hydrateProjectRows={hydrateProjectRows}
              isAdmin={isAdmin}
              isDocumentVisible={isDocumentVisible}
              isRefreshingModelCatalog={isRefreshingModelCatalog}
              openThread={openThread}
              prepareOpenedThreadDetail={prepareOpenedThreadDetail}
              procedures={procedures}
              reasoningEfforts={reasoningEfforts}
              replaceThreads={replaceThreads}
              safeChildAccessDefaults={safeChildAccessDefaults}
              selectedProject={selectedProject}
              selectedProjectId={selectedProjectId}
              selectedWorktreePath={selectedWorktreePath}
              setPrimaryViewForNavigation={setPrimaryViewForNavigation}
              setProjectState={setProjectState}
              supportsTildePath={supportsTildePath}
              upsertProject={upsertProject}
              upsertThread={upsertThread}
              variant="mobile"
            />
          ) : primaryView === "calendar" ? (
            <Suspense
              fallback={
                <WorkspaceLoadingFallback
                  label="Loading calendar..."
                  variant="mobile"
                />
              }
            >
              <CalendarWorkspace
                openNotificationEvent={openCalendarNotificationEvent}
                procedures={procedures}
                variant="mobile"
              />
            </Suspense>
          ) : (
            <div className="flex flex-col gap-4 pt-6">
              <Suspense
                fallback={
                  <WorkspaceLoadingFallback
                    label="Loading diff workspace..."
                    variant="mobile"
                  />
                }
              >
                <DiffWorkspace
                  activeSelectedWorktreeFolder={activeSelectedWorktreeFolder}
                  activeSelectedWorktreeName={activeSelectedWorktreeName}
                  activeSelectedWorktreeOpened={activeSelectedWorktreeOpened}
                  activeSelectedWorktreePath={activeSelectedWorktreePath}
                  activeWorktreeChanges={activeWorktreeChanges}
                  diffFilePatchState={diffFilePatchState}
                  diffFileTree={diffFileTree}
                  gitInitializationError={gitInitializationError}
                  gitInitializationState={gitInitializationState}
                  hasActiveWorktreeSnapshot={Boolean(activeWorktreeSnapshot)}
                  isRefreshingWorktreeSnapshot={isRefreshingWorktreeSnapshot}
                  nonGitRepositoryDeclined={nonGitRepositoryDeclined}
                  onDeclineGitInitialization={handleDeclineGitInitialization}
                  onInitializeGitRepository={handleInitializeGitRepository}
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
                  variant="mobile"
                  worktreeDiffError={worktreeDiffError}
                />
              </Suspense>
            </div>
          )}
        </main>

        <div className="fixed bottom-0 left-0 z-50 w-full">
          <div className="h-1 w-full bg-bg-app">
            <div className="relative h-full w-[100%] overflow-hidden bg-accent-strong/40">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          </div>
          <nav aria-label="Primary views">
            <div
              className="grid h-16 grid-cols-4 items-center bg-bg-app"
              role="tablist"
              onKeyDown={(event) =>
                handlePrimaryViewTabKeyDown(event, "mobile")
              }
            >
              <TabButton
                id={PRIMARY_VIEW_TAB_IDS.mobile.diff}
                role="tab"
                aria-controls={PRIMARY_VIEW_PANEL_IDS.mobile.diff}
                aria-selected={primaryView === "diff"}
                selected={primaryView === "diff"}
                tabIndex={primaryView === "diff" ? 0 : -1}
                onClick={() => {
                  setMobileProjectListOpen(false);
                  setPrimaryViewForNavigation("diff");
                }}
              >
                {materialSymbol("difference")}
                <span className="mt-1 uppercase-label">Diff</span>
              </TabButton>
              <TabButton
                id={PRIMARY_VIEW_TAB_IDS.mobile.cronjobs}
                role="tab"
                aria-controls={PRIMARY_VIEW_PANEL_IDS.mobile.cronjobs}
                aria-selected={primaryView === "cronjobs"}
                selected={primaryView === "cronjobs"}
                tabIndex={primaryView === "cronjobs" ? 0 : -1}
                onClick={() => {
                  setMobileProjectListOpen(false);
                  handleShowCronjobs();
                }}
              >
                {materialSymbol("task_alt")}
                <span className="mt-1 uppercase-label">Crons</span>
              </TabButton>
              <TabButton
                id={PRIMARY_VIEW_TAB_IDS.mobile.calendar}
                role="tab"
                aria-controls={PRIMARY_VIEW_PANEL_IDS.mobile.calendar}
                aria-selected={primaryView === "calendar"}
                selected={primaryView === "calendar"}
                tabIndex={primaryView === "calendar" ? 0 : -1}
                onClick={() => {
                  setMobileProjectListOpen(false);
                  setPrimaryViewForNavigation("calendar");
                }}
              >
                {materialSymbol("schedule")}
                <span className="mt-1 uppercase-label">Calendar</span>
              </TabButton>
              <TabButton
                id={PRIMARY_VIEW_TAB_IDS.mobile.chat}
                role="tab"
                aria-controls={PRIMARY_VIEW_PANEL_IDS.mobile.chat}
                aria-selected={primaryView === "chat"}
                selected={primaryView === "chat"}
                tabIndex={primaryView === "chat" ? 0 : -1}
                onClick={() => {
                  setMobileProjectListOpen(false);
                  setPrimaryViewForNavigation("chat");
                }}
              >
                {brandLogoIcon("h-4 w-4")}
                <span className="mt-1 uppercase-label">Chat</span>
              </TabButton>
            </div>
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
          <NotificationButton
            key={notification.id}
            onClick={() => {
              dismissNotification(notification.id);
            }}
            tone={notification.type === "error" ? "danger" : notification.type}
          >
            <div className="uppercase-label opacity-75">
              Thread #{notification.threadId}
            </div>
            <div className="mt-1">{notification.message}</div>
          </NotificationButton>
        ))}
      </div>
      {currentThreadExtensionUiDialog ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}
      {currentThreadStartRequest !== null ? (
        <Suspense fallback={null}>
          <ThreadStartRequestDialog
            accessEntries={currentThreadStartRequestAccessEntries}
            busy={isApprovingThreadStartRequest}
            error={threadStartRequestError}
            open={true}
            projectLabel={
              currentThreadStartRequestProject?.name ??
              currentThreadStartRequest.projectPath ??
              ""
            }
            prompt={currentThreadStartRequest.input}
            queueLabel={
              pendingThreadStartRequests.length > 1
                ? `${pendingThreadStartRequests.length} requests queued`
                : "Approve to create and open the requested thread."
            }
            worktreePath={currentThreadStartRequestWorkspace}
            onApprove={() => {
              void approveThreadStartRequest(currentThreadStartRequest);
            }}
            onDismiss={() => {
              dismissThreadStartRequest(currentThreadStartRequest.requestId);
            }}
          />
        </Suspense>
      ) : null}
      {gitHistoryModal ? (
        <Suspense fallback={null}>
          <GitHistoryDiffModal
            state={gitHistoryModal}
            onClose={closeGitHistoryModal}
          />
        </Suspense>
      ) : null}
      <ProjectActionMenu
        error={projectActionMenuError}
        homeDirectory={homeDirectory}
        hiddenWorktreePath={projectActionMenuHiddenWorktreePath}
        hiddenWorktrees={projectActionMenuHiddenWorktrees}
        isOpeningHiddenWorktree={isOpeningHiddenWorktree}
        menu={projectActionMenu}
        onClose={closeProjectActionMenu}
        onDeleteProject={() => {
          if (!projectActionMenuProject) {
            return;
          }
          void deleteTrackedProject(projectActionMenuProject.id);
        }}
        onHiddenWorktreePathChange={setProjectActionMenuHiddenWorktreePath}
        onOpenDeleteProject={openProjectDeleteMenu}
        onOpenHiddenWorktree={() => {
          void openHiddenProjectWorktree();
        }}
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
