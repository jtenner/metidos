import type {
  CalendarEventInput,
  CalendarEventUpdateInput,
  CalendarNotificationChannel,
  CalendarSharePermission,
  RpcCalendar,
  RpcCalendarBootstrap,
  RpcCalendarNotificationSettings,
  RpcCalendarOccurrence,
  RpcCalendarReminderDelivery,
  RpcCalendarShare,
  RpcExternalIcsCalendar,
} from "./calendar/types";

import type {
  RpcAppBootstrapHint,
  RpcAppBootstrapResult,
} from "./rpc-schema/app-bootstrap";
import type { RpcCronJob } from "./rpc-schema/cron";
import type {
  RpcModelCatalog,
  RpcReasoningEffort,
} from "./rpc-schema/model-catalog";
import type { RpcUserNotificationDelivery } from "./rpc-schema/notifications";
import type {
  RpcTimezoneSettings,
  RpcUserRuntimeSettings,
} from "./rpc-schema/settings";
import type {
  RpcChatImageAttachment,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadStartRequest,
} from "./rpc-schema/thread";
import type { RpcThreadExtensionUiResponse } from "./rpc-schema/thread-extension-ui";
import type {
  RpcCreateTerminalRequest,
  RpcCreateTerminalResult,
  RpcTerminal,
  RpcTerminalSettings,
} from "./rpc-schema/terminal";

import type {
  RpcPluginAccessGroupOption,
  RpcPluginAdminAction,
  RpcPluginAdminActionResult,
  RpcPluginIngressBindingMutationResult,
  RpcPluginIngressExternalBinding,
  RpcPluginIngressLinkCode,
  RpcPluginIngressRouteConfig,
  RpcPluginIngressSourceDescriptor,
  RpcPluginInventory,
  RpcPluginLifecycleAction,
  RpcPluginLifecycleActionResult,
  RpcPluginManifestSettingDefault,
  RpcPluginSecurityDiagnostics,
  RpcPluginSettingsSnapshot,
  RpcPluginSidecarDiagnostics,
} from "./rpc-schema/plugin";
import type {
  RpcContextFocusChanged,
  RpcCreateWorktreeResult,
  RpcDirectorySuggestionsResult,
  RpcGitCommitDiffResult,
  RpcHomeDirectoryResult,
  RpcOpenProjectRequest,
  RpcOpenProjectsBatchRequestItem,
  RpcOpenProjectsBatchResultItem,
  RpcOpenWorktreeRequest,
  RpcOpenWorktreeResult,
  RpcOpenWorktreesBatchResultItem,
  RpcProject,
  RpcProjectFavicon,
  RpcProjectSkill,
  RpcProjectWorktreesResult,
  RpcSetActiveWorktreeResult,
  RpcWorktreeChange,
  RpcWorktreeFileContentPage,
  RpcWorktreeFileDiff,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
} from "./rpc-schema/project-worktree";

export { RPC_PLUGIN_INVENTORY_GROUP_LABELS } from "./rpc-schema/plugin";
export { MAINVIEW_HTML_BOOTSTRAP_CONTRACT } from "./rpc-schema/app-bootstrap";
export type {
  RpcAppBootstrapHint,
  RpcAppBootstrapPinnedWorktree,
  RpcAppBootstrapResult,
  RpcMainviewHtmlBootstrapComponent,
  RpcMainviewHtmlBootstrapContract,
  RpcMainviewHtmlBootstrapFieldContract,
  RpcMainviewHtmlBootstrapFieldPolicy,
} from "./rpc-schema/app-bootstrap";
export type { RpcCronJob, RpcCronJobRunStatus } from "./rpc-schema/cron";
export type {
  RpcModelCatalog,
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "./rpc-schema/model-catalog";
export type {
  RpcUserNotificationDelivery,
  RpcUserNotificationDeliveryResult,
  RpcUserNotificationProviderReceipt,
} from "./rpc-schema/notifications";
export type {
  RpcTimezoneSettings,
  RpcUserRuntimeSettings,
} from "./rpc-schema/settings";
export type {
  RpcChatImageAttachment,
  RpcChatThreadMessage,
  RpcCommandThreadMessage,
  RpcErrorThreadMessage,
  RpcFileChangeThreadMessage,
  RpcReasoningThreadMessage,
  RpcThread,
  RpcThreadCompaction,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadQueueStatus,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcThreadStartRequestResolved,
  RpcThreadUsage,
  RpcToolCallThreadMessage,
  RpcWebSearchThreadMessage,
} from "./rpc-schema/thread";
export type {
  RpcThreadExtensionUiDialogMethod,
  RpcThreadExtensionUiRequest,
  RpcThreadExtensionUiResponse,
} from "./rpc-schema/thread-extension-ui";
export type {
  RpcCreateTerminalRequest,
  RpcCreateTerminalResult,
  RpcTerminal,
  RpcTerminalConnectionInfo,
  RpcTerminalSettings,
  RpcTerminalStatus,
} from "./rpc-schema/terminal";
export type {
  RpcPluginInventoryGroupLabel,
  RpcPluginInventoryStatus,
  RpcPluginInventoryIssue,
  RpcPluginManifestToolSummary,
  RpcPluginManifestAccessGroupSummary,
  RpcThreadPermissionDescriptor,
  RpcPluginAccessGroupOption,
  RpcPluginManifestFileAccessSummary,
  RpcPluginManifestFileSummary,
  RpcPluginManifestNetworkSummary,
  RpcPluginManifestEnvVarSummary,
  RpcPluginManifestSettingDefault,
  RpcPluginManifestSettingItemSummary,
  RpcPluginManifestSettingSummary,
  RpcPluginSettingValueSummary,
  RpcPluginSettingsSnapshot,
  RpcPluginManifestProviderSummary,
  RpcPluginManifestPiAuthSummary,
  RpcPluginManifestIngressSourceSummary,
  RpcPluginIngressSourceDescriptor,
  RpcPluginIngressLinkCode,
  RpcPluginIngressExternalBinding,
  RpcPluginIngressBindingMutationResult,
  RpcPluginIngressRouteConfig,
  RpcPluginManifestStorageDefaultsSummary,
  RpcPluginManifestGcSummary,
  RpcPluginManifestReviewSummary,
  RpcPluginAdminAction,
  RpcPluginAdminActionAvailability,
  RpcPluginDataUsage,
  RpcPluginLifecycleSettings,
  RpcPluginLifecycleCrashLoop,
  RpcPluginLifecycleMetadata,
  RpcPluginInventoryPlugin,
  RpcPluginLifecycleAction,
  RpcPluginLifecycleActionResult,
  RpcPluginAdminActionResult,
  RpcPluginSidecarStderrLine,
  RpcPluginSidecarFailureDiagnostic,
  RpcPluginSqliteNativeSecurityDiagnostic,
  RpcPluginSecurityDiagnostics,
  RpcPluginSidecarDiagnostics,
  RpcPluginInventoryGroup,
  RpcPluginInventory,
} from "./rpc-schema/plugin";
export type {
  RpcProject,
  RpcProjectFavicon,
  RpcWorktree,
  RpcWorktreeChangeStatus,
  RpcWorktreeChange,
  RpcWorktreeSnapshot,
  RpcWorktreeFileDiff,
  RpcProjectWorktreesResult,
  RpcOpenProjectRequest,
  RpcOpenProjectsBatchRequestItem,
  RpcOpenProjectsBatchResultItem,
  RpcOpenWorktreeRequest,
  RpcOpenWorktreesBatchResultItem,
  RpcOpenWorktreeResult,
  RpcSetActiveWorktreeResult,
  RpcHomeDirectoryResult,
  RpcDirectorySuggestionsResult,
  RpcProjectSkill,
  RpcCreateWorktreeResult,
  RpcWorktreeGitHistoryChanged,
  RpcContextFocusChanged,
  RpcGitHistoryEntry,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeGitHistoryResult,
  RpcGitCommitDiffResult,
  RpcWorktreeFileContentPage,
} from "./rpc-schema/project-worktree";

export type RpcMemoryFactPreview = {
  id: number;
  projectId: number;
  worktreePath: string;
  originThreadId: number | null;
  statement: string;
  factType: string;
  memoryKind: string;
  scopeEntity: string | null;
  status: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  erasedAt: string | null;
  supersedesFactId: number | null;
  supersededByFactId: number | null;
  evidenceCount: number;
  recallCount: number;
};

export type RpcMemoryEvidencePreview = {
  id: number;
  projectId: number;
  worktreePath: string;
  originThreadId: number | null;
  originMessageId: number | null;
  sourceKind: string;
  sourceRole: string | null;
  textPreview: string;
  textSha256: string;
  capturedAt: string;
  createdAt: string;
  erasedAt: string | null;
};

export type RpcMemoryStats = Record<string, unknown>;
export type RpcMemoryFactDetail = Record<string, unknown> | null;
export type RpcMemoryEvidenceDetail = Record<string, unknown> | null;
export type RpcMemoryRecallEvent = Record<string, unknown>;
export type RpcMemoryWriteEvent = Record<string, unknown>;
export type RpcMemoryEraseResult = {
  erasedFactIds: number[];
  erasedEvidenceIds: number[];
  factCount: number;
  evidenceCount: number;
};

export type RpcClientLogSeverity = "debug" | "info" | "warn" | "error";

export type RpcClientLogRequest = {
  severity: RpcClientLogSeverity;
  message: string;
  details?: Record<string, unknown> | null;
  route?: string | null;
  context?: string | null;
  timestamp?: string | null;
};

export type RpcSecurityAuditPayload = Record<
  string,
  string | number | boolean | null
>;

export type RpcSecurityAuditEvent = {
  id: number;
  eventType: string;
  summaryText: string;
  threadId: number | null;
  projectId: number | null;
  worktreePath: string | null;
  payload: RpcSecurityAuditPayload | null;
  createdAt: string;
};

export type RpcRequestPriority = "background" | "default" | "foreground";

export type RpcProcedureCallOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  priority?: RpcRequestPriority;
};

export type RpcAuthContext = {
  isAdmin: boolean;
  sessionId: string | null;
  stepUpValidUntil?: string | null;
  userId: number | null;
  username: string | null;
};

export type RpcRequestContext = {
  auth: RpcAuthContext;
  signal: AbortSignal;
  priority: RpcRequestPriority;
  timeoutMs: number | null;
};

/**
 * Full schema of client-callable RPC request/response pairs.
 */
export type AppRPCSchema = {
  requests: {
    getHomeDirectory: {
      params: undefined;
      response: RpcHomeDirectoryResult;
    };
    listDirectorySuggestions: {
      params: { query: string };
      response: RpcDirectorySuggestionsResult;
    };
    getModelCatalog: {
      params:
        | {
            refresh?: boolean;
            refreshProviders?: boolean;
          }
        | undefined;
      response: RpcModelCatalog;
    };
    getPluginInventory: {
      params: undefined;
      response: RpcPluginInventory;
    };
    listPluginAccessGroups: {
      params: undefined;
      response: RpcPluginAccessGroupOption[];
    };
    getPluginSettings: {
      params: {
        directoryName: string;
      };
      response: RpcPluginSettingsSnapshot;
    };
    listPluginIngressSources: {
      params: undefined;
      response: RpcPluginIngressSourceDescriptor[];
    };
    createPluginIngressLinkCode: {
      params: {
        pluginId: string;
        sourceId: string;
      };
      response: RpcPluginIngressLinkCode;
    };
    listPluginIngressExternalBindings: {
      params:
        | {
            pluginId?: string;
            sourceId?: string;
            metidosUserId?: number;
            currentUserOnly?: boolean;
          }
        | undefined;
      response: RpcPluginIngressExternalBinding[];
    };
    setPluginIngressExternalBindingEnabled: {
      params: {
        id: number;
        enabled: boolean;
      };
      response: RpcPluginIngressBindingMutationResult;
    };
    deletePluginIngressExternalBinding: {
      params: {
        id: number;
      };
      response: RpcPluginIngressBindingMutationResult;
    };
    listPluginIngressRouteConfigs: {
      params:
        | {
            pluginId?: string;
            sourceId?: string;
            metidosUserId?: number;
            currentUserOnly?: boolean;
          }
        | undefined;
      response: RpcPluginIngressRouteConfig[];
    };
    upsertPluginIngressRouteConfig: {
      params: {
        pluginId: string;
        sourceId: string;
        projectId: number;
        worktreePath: string;
        model: string | null;
        permissions: string[];
        enabled: boolean;
      };
      response: RpcPluginIngressRouteConfig;
    };
    updatePluginSettings: {
      params: {
        directoryName: string;
        values: Record<string, RpcPluginManifestSettingDefault>;
      };
      response: RpcPluginSettingsSnapshot;
    };
    getPluginSidecarDiagnostics: {
      params:
        | {
            directoryName?: string;
            pluginId?: string;
          }
        | undefined;
      response: RpcPluginSidecarDiagnostics[];
    };
    getPluginSecurityDiagnostics: {
      params: undefined;
      response: RpcPluginSecurityDiagnostics;
    };
    runPluginLifecycleAction: {
      params: {
        action: RpcPluginLifecycleAction;
        directoryName: string;
      };
      response: RpcPluginLifecycleActionResult;
    };
    runPluginAdminAction: {
      params: {
        action: RpcPluginAdminAction;
        confirmation?: string;
        directoryName: string;
      };
      response: RpcPluginAdminActionResult;
    };
    getAppBootstrap: {
      params: RpcAppBootstrapHint | undefined;
      response: RpcAppBootstrapResult;
    };
    searchMemoryFacts: {
      params:
        | {
            projectId?: number;
            worktreePath?: string;
            query?: string;
            status?: string;
            factType?: string;
            memoryKind?: string;
            scopeEntity?: string;
            sort?: string;
            limit?: number;
            offset?: number;
          }
        | undefined;
      response: { facts: RpcMemoryFactPreview[]; limit: number };
    };
    getMemoryFactDetail: {
      params: { factId: number };
      response: RpcMemoryFactDetail;
    };
    getMemoryEvidenceDetail: {
      params: { evidenceId: number };
      response: RpcMemoryEvidenceDetail;
    };
    listMemoryEvidence: {
      params:
        | {
            projectId?: number;
            worktreePath?: string;
            query?: string;
            limit?: number;
            offset?: number;
          }
        | undefined;
      response: { evidence: RpcMemoryEvidencePreview[]; limit: number };
    };
    listMemoryRecallEvents: {
      params:
        | { projectId?: number; worktreePath?: string; limit?: number }
        | undefined;
      response: RpcMemoryRecallEvent[];
    };
    listMemoryWriteEvents: {
      params:
        | { projectId?: number; worktreePath?: string; limit?: number }
        | undefined;
      response: RpcMemoryWriteEvent[];
    };
    getMemoryStats: {
      params: { projectId?: number; worktreePath?: string } | undefined;
      response: RpcMemoryStats;
    };
    eraseMemory: {
      params: {
        projectId: number;
        worktreePath: string;
        factIds?: number[];
        evidenceIds?: number[];
        query?: string;
        scope?: "project" | "worktree" | "thread";
        confirm: string;
      };
      response: RpcMemoryEraseResult;
    };
    listProjects: {
      params:
        | {
            includeClosed?: boolean;
          }
        | undefined;
      response: RpcProject[];
    };
    listProjectFavicons: {
      params: { forceRefresh?: boolean; projectIds: number[] };
      response: RpcProjectFavicon[];
    };
    logClientEvent: {
      params: RpcClientLogRequest;
      response: { accepted: true; id: number };
    };
    openProject: {
      params: RpcOpenProjectRequest;
      response: RpcProjectWorktreesResult;
    };
    openProjectsBatch: {
      params: {
        projects: RpcOpenProjectsBatchRequestItem[];
      };
      response: RpcOpenProjectsBatchResultItem[];
    };
    closeProject: {
      params: { projectId: number };
      response: { success: boolean; projectId: number; message?: string };
    };
    deleteProject: {
      params: { projectId: number };
      response: { success: boolean; projectId: number; message?: string };
    };
    listProjectWorktrees: {
      params: { projectId: number; includeHidden?: boolean };
      response: RpcProjectWorktreesResult;
    };
    createWorktree: {
      params: { projectId: number; name: string };
      response: RpcCreateWorktreeResult;
    };
    openWorktree: {
      params: RpcOpenWorktreeRequest;
      response: RpcOpenWorktreeResult;
    };
    openWorktreesBatch: {
      params: {
        worktrees: RpcOpenWorktreeRequest[];
      };
      response: RpcOpenWorktreesBatchResultItem[];
    };
    getWorktreeSnapshot: {
      params: { projectId: number; worktreePath: string };
      response: RpcWorktreeSnapshot;
    };
    listProjectSkills: {
      params: { projectId: number; worktreePath: string };
      response: { skills: RpcProjectSkill[] };
    };
    readWorktreeFileContentPage: {
      params: {
        projectId: number;
        worktreePath: string;
        path: string;
        cursor?: number;
        limitBytes?: number;
      };
      response: RpcWorktreeFileContentPage;
    };
    readWorktreeFileDiff: {
      params: {
        projectId: number;
        worktreePath: string;
        change: RpcWorktreeChange;
      };
      response: RpcWorktreeFileDiff;
    };
    setActiveWorktree: {
      params: {
        projectId: number | null;
        worktreePath: string | null;
      };
      response: RpcSetActiveWorktreeResult;
    };
    focusContext: {
      params: {
        projectId: number;
        worktreePath: string;
        threadId?: number | null;
      };
      response: RpcContextFocusChanged;
    };
    respondThreadExtensionUi: {
      params: {
        threadId: number;
        response: RpcThreadExtensionUiResponse;
      };
      response: {
        accepted: boolean;
      };
    };
    updateThreadExtensionEditor: {
      params: {
        threadId: number;
        text: string;
      };
      response: {
        success: boolean;
        threadId: number;
      };
    };
    listWorktreeGitHistory: {
      params: {
        projectId: number;
        worktreePath: string;
        offset?: number;
        limit?: number;
      };
      response: RpcWorktreeGitHistoryResult;
    };
    getWorktreeGitCommitDiff: {
      params: { projectId: number; worktreePath: string; commitHash: string };
      response: RpcGitCommitDiffResult;
    };
    closeWorktree: {
      params: { projectId: number; worktreePath: string };
      response: {
        success: boolean;
        projectId: number;
        worktreePath: string;
      };
    };
    setWorktreePinned: {
      params: { projectId: number; worktreePath: string; pinned: boolean };
      response: RpcProjectWorktreesResult;
    };
    listTerminals: {
      params: undefined;
      response: RpcTerminal[];
    };
    createTerminal: {
      params: RpcCreateTerminalRequest;
      response: RpcCreateTerminalResult;
    };
    renameTerminal: {
      params: { terminalId: string; title: string };
      response: RpcTerminal;
    };
    closeTerminal: {
      params: { terminalId: string };
      response: RpcTerminal;
    };
    getTerminalSettings: {
      params: undefined;
      response: RpcTerminalSettings;
    };
    getTimezoneSettings: {
      params: undefined;
      response: RpcTimezoneSettings;
    };
    getUserRuntimeSettings: {
      params: undefined;
      response: RpcUserRuntimeSettings;
    };
    updateTimezoneSettings: {
      params: Partial<Pick<RpcTimezoneSettings, "timezone">>;
      response: RpcTimezoneSettings;
    };
    updateTerminalSettings: {
      params: Partial<RpcTerminalSettings>;
      response: RpcTerminalSettings;
    };
    updateUserRuntimeSettings: {
      params: Partial<
        Pick<RpcUserRuntimeSettings, "commandTimeoutSeconds" | "embeddingModel">
      >;
      response: RpcUserRuntimeSettings;
    };
    listThreads: {
      params: { offset?: number; limit?: number } | undefined;
      response: RpcThread[];
    };
    listThreadStatuses: {
      params: { threadIds: number[] };
      response: RpcThread[];
    };
    createThread: {
      params: {
        projectId: number;
        worktreePath: string;
        currentProjectId?: number | null;
        currentWorktreePath?: string | null;
        model?: string | null;
        reasoningEffort?: RpcReasoningEffort | null;
        permissions?: string[] | null;
      };
      response: RpcThreadDetail;
    };
    requestThreadStart: {
      params: {
        projectId: number;
        worktreePath: string;
        input: string;
        model: string | null;
        reasoningEffort: RpcReasoningEffort | null;
        permissions?: string[] | null;
        autoStart: boolean | null;
      };
      response: RpcThreadStartRequest;
    };
    approveThreadStartRequest: {
      params: {
        requestId: string;
      };
      response: RpcThreadDetail;
    };
    newCron: {
      params: {
        projectId: number;
        worktreePath: string;
        schedule: string;
        prompt: string;
        permissions?: string[];
        model?: string;
        reasoningEffort?: RpcReasoningEffort;
        title?: string;
        description?: string;
        enabled?: boolean;
      };
      response: RpcCronJob;
    };
    updateCron: {
      params: {
        cronJobId: number;
        projectId?: number;
        worktreePath?: string;
        model?: string;
        reasoningEffort?: RpcReasoningEffort;
        permissions?: string[];
        schedule?: string;
        prompt?: string;
        title?: string;
        description?: string;
        enabled?: boolean;
        deleted?: boolean;
      };
      response: RpcCronJob;
    };
    listCrons: {
      params: undefined;
      response: RpcCronJob[];
    };
    runCronNow: {
      params: {
        cronJobId: number;
      };
      response: {
        success: boolean;
        cronJobId: number;
        threadId: number;
      };
    };
    getCalendarBootstrap: {
      params: undefined;
      response: RpcCalendarBootstrap;
    };
    listCalendarOccurrences: {
      params: { start: string; end: string; timezone?: string | null };
      response: RpcCalendarOccurrence[];
    };
    createCalendar: {
      params: {
        title: string;
        color?: string | null;
        isPublic?: boolean | null;
        publicSlug?: string | null;
      };
      response: RpcCalendar;
    };
    updateCalendar: {
      params: {
        calendarId: number;
        title?: string | null;
        color?: string | null;
        isPublic?: boolean | null;
        publicSlug?: string | null;
      };
      response: RpcCalendar;
    };
    deleteCalendar: {
      params: { calendarId: number };
      response: { success: boolean; calendarId: number };
    };
    leaveSharedCalendar: {
      params: { calendarId: number };
      response: { success: boolean; calendarId: number };
    };
    updateCalendarPreference: {
      params: {
        calendarId: number;
        visible?: boolean | null;
        colorOverride?: string | null;
        notificationsEnabled?: boolean | null;
        notificationChannels?: CalendarNotificationChannel[] | null;
      };
      response: RpcCalendar;
    };
    setCalendarShare: {
      params: {
        calendarId: number;
        userId: number;
        permission: CalendarSharePermission | null;
      };
      response: RpcCalendarShare[];
    };
    createCalendarEvent: {
      params: CalendarEventInput;
      response: import("./calendar/types").RpcCalendarEvent;
    };
    updateCalendarEvent: {
      params: CalendarEventUpdateInput;
      response: import("./calendar/types").RpcCalendarEvent;
    };
    deleteCalendarEvent: {
      params: {
        eventId: number;
        scope?: "whole_series" | "after_this" | "just_this" | null;
        occurrenceStart?: string | null;
        expectedVersion?: number | null;
      };
      response: { success: boolean; eventId: number };
    };
    createExternalIcsCalendar: {
      params: { title: string; url: string; color?: string | null };
      response: RpcExternalIcsCalendar;
    };
    updateExternalIcsCalendar: {
      params: {
        externalCalendarId: number;
        title?: string | null;
        url?: string | null;
        color?: string | null;
        visible?: boolean | null;
        enabled?: boolean | null;
        notificationsEnabled?: boolean | null;
        notificationMode?: "source" | "default" | null;
        refreshIntervalMinutes?: number | null;
      };
      response: RpcExternalIcsCalendar;
    };
    refreshExternalIcsCalendar: {
      params: { externalCalendarId: number };
      response: { refreshed: boolean; eventCount: number; status: number };
    };
    deleteExternalIcsCalendar: {
      params: { externalCalendarId: number };
      response: { success: boolean; externalCalendarId: number };
    };
    updateCalendarNotificationSettings: {
      params: Partial<
        Omit<
          RpcCalendarNotificationSettings,
          "userId" | "updatedAt" | "browserPermission"
        >
      >;
      response: RpcCalendarNotificationSettings;
    };
    listCalendarNotifications: {
      params: undefined;
      response: RpcCalendarReminderDelivery[];
    };
    listUserNotifications: {
      params: undefined;
      response: RpcUserNotificationDelivery[];
    };
    dismissUserNotification: {
      params: { deliveryId: number };
      response: { success: boolean; deliveryId: number };
    };
    dismissCalendarNotification: {
      params: { deliveryId: number };
      response: { success: boolean; deliveryId: number };
    };
    snoozeCalendarNotification: {
      params: { deliveryId: number; snoozedUntil: string };
      response: RpcCalendarReminderDelivery;
    };
    getThread: {
      params: {
        threadId: number;
        cursor?: number | null;
        includeHeavyContent?: boolean;
        messageLimit?: number;
      };
      response: RpcThreadDetail;
    };
    getThreadMessageContent: {
      params: {
        threadId: number;
        messageId: number;
      };
      response: RpcThreadMessage;
    };
    markThreadErrorSeen: {
      params: { threadId: number };
      response: RpcThreadDetail;
    };
    sendThreadMessage: {
      params: {
        threadId: number;
        input: string;
        images?: RpcChatImageAttachment[];
      };
      response: RpcThreadDetail;
    };
    stopThreadTurn: {
      params: { threadId: number };
      response: RpcThreadDetail;
    };
    updateThreadAccess: {
      params: {
        threadId: number;
        permissions?: string[];
      };
      response: RpcThread;
    };
    updateThreadMetadata: {
      params: {
        threadId: number;
        title?: string;
        summary?: string | null;
        pinned?: boolean;
      };
      response: RpcThread;
    };
    renameThread: {
      params: { threadId: number; title: string; summary?: string | null };
      response: RpcThread;
    };
    setThreadPinned: {
      params: { threadId: number; pinned: boolean };
      response: RpcThread;
    };
    updateThreadModel: {
      params: { threadId: number; model: string };
      response: RpcThread;
    };
    updateThreadReasoningEffort: {
      params: {
        threadId: number;
        reasoningEffort: RpcReasoningEffort;
      };
      response: RpcThread;
    };
    deleteThread: {
      params: { threadId: number };
      response: { success: boolean; threadId: number; message?: string };
    };
    discardEmptyThread: {
      params: { threadId: number };
      response: { threadId: number; discarded: boolean };
    };
  };
};

/**
 * Helper for RPC procedure signatures: params may be optional if explicitly undefined.
 */
type RpcProcedureCall<Params, Response> = undefined extends Params
  ? (params?: Params, options?: RpcProcedureCallOptions) => Promise<Response>
  : (params: Params, options?: RpcProcedureCallOptions) => Promise<Response>;

/**
 * Typed RPC surface used across Bun and UI bridge layers.
 */
export interface ProjectProcedures {
  getHomeDirectory: RpcProcedureCall<
    AppRPCSchema["requests"]["getHomeDirectory"]["params"],
    AppRPCSchema["requests"]["getHomeDirectory"]["response"]
  >;
  listDirectorySuggestions: RpcProcedureCall<
    AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
    AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]
  >;
  getModelCatalog: RpcProcedureCall<
    AppRPCSchema["requests"]["getModelCatalog"]["params"],
    AppRPCSchema["requests"]["getModelCatalog"]["response"]
  >;
  getPluginInventory: RpcProcedureCall<
    AppRPCSchema["requests"]["getPluginInventory"]["params"],
    AppRPCSchema["requests"]["getPluginInventory"]["response"]
  >;
  getPluginSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["getPluginSettings"]["params"],
    AppRPCSchema["requests"]["getPluginSettings"]["response"]
  >;
  createPluginIngressLinkCode: RpcProcedureCall<
    AppRPCSchema["requests"]["createPluginIngressLinkCode"]["params"],
    AppRPCSchema["requests"]["createPluginIngressLinkCode"]["response"]
  >;
  listPluginIngressSources: RpcProcedureCall<
    AppRPCSchema["requests"]["listPluginIngressSources"]["params"],
    AppRPCSchema["requests"]["listPluginIngressSources"]["response"]
  >;
  listPluginIngressExternalBindings: RpcProcedureCall<
    AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["params"],
    AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["response"]
  >;
  setPluginIngressExternalBindingEnabled: RpcProcedureCall<
    AppRPCSchema["requests"]["setPluginIngressExternalBindingEnabled"]["params"],
    AppRPCSchema["requests"]["setPluginIngressExternalBindingEnabled"]["response"]
  >;
  deletePluginIngressExternalBinding: RpcProcedureCall<
    AppRPCSchema["requests"]["deletePluginIngressExternalBinding"]["params"],
    AppRPCSchema["requests"]["deletePluginIngressExternalBinding"]["response"]
  >;
  listPluginIngressRouteConfigs: RpcProcedureCall<
    AppRPCSchema["requests"]["listPluginIngressRouteConfigs"]["params"],
    AppRPCSchema["requests"]["listPluginIngressRouteConfigs"]["response"]
  >;
  upsertPluginIngressRouteConfig: RpcProcedureCall<
    AppRPCSchema["requests"]["upsertPluginIngressRouteConfig"]["params"],
    AppRPCSchema["requests"]["upsertPluginIngressRouteConfig"]["response"]
  >;
  listPluginAccessGroups: RpcProcedureCall<
    AppRPCSchema["requests"]["listPluginAccessGroups"]["params"],
    AppRPCSchema["requests"]["listPluginAccessGroups"]["response"]
  >;
  updatePluginSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["updatePluginSettings"]["params"],
    AppRPCSchema["requests"]["updatePluginSettings"]["response"]
  >;
  getPluginSidecarDiagnostics: RpcProcedureCall<
    AppRPCSchema["requests"]["getPluginSidecarDiagnostics"]["params"],
    AppRPCSchema["requests"]["getPluginSidecarDiagnostics"]["response"]
  >;
  getPluginSecurityDiagnostics: RpcProcedureCall<
    AppRPCSchema["requests"]["getPluginSecurityDiagnostics"]["params"],
    AppRPCSchema["requests"]["getPluginSecurityDiagnostics"]["response"]
  >;
  runPluginLifecycleAction: RpcProcedureCall<
    AppRPCSchema["requests"]["runPluginLifecycleAction"]["params"],
    AppRPCSchema["requests"]["runPluginLifecycleAction"]["response"]
  >;
  runPluginAdminAction: RpcProcedureCall<
    AppRPCSchema["requests"]["runPluginAdminAction"]["params"],
    AppRPCSchema["requests"]["runPluginAdminAction"]["response"]
  >;
  getAppBootstrap: RpcProcedureCall<
    AppRPCSchema["requests"]["getAppBootstrap"]["params"],
    AppRPCSchema["requests"]["getAppBootstrap"]["response"]
  >;
  searchMemoryFacts: RpcProcedureCall<
    AppRPCSchema["requests"]["searchMemoryFacts"]["params"],
    AppRPCSchema["requests"]["searchMemoryFacts"]["response"]
  >;
  getMemoryFactDetail: RpcProcedureCall<
    AppRPCSchema["requests"]["getMemoryFactDetail"]["params"],
    AppRPCSchema["requests"]["getMemoryFactDetail"]["response"]
  >;
  getMemoryEvidenceDetail: RpcProcedureCall<
    AppRPCSchema["requests"]["getMemoryEvidenceDetail"]["params"],
    AppRPCSchema["requests"]["getMemoryEvidenceDetail"]["response"]
  >;
  listMemoryEvidence: RpcProcedureCall<
    AppRPCSchema["requests"]["listMemoryEvidence"]["params"],
    AppRPCSchema["requests"]["listMemoryEvidence"]["response"]
  >;
  listMemoryRecallEvents: RpcProcedureCall<
    AppRPCSchema["requests"]["listMemoryRecallEvents"]["params"],
    AppRPCSchema["requests"]["listMemoryRecallEvents"]["response"]
  >;
  listMemoryWriteEvents: RpcProcedureCall<
    AppRPCSchema["requests"]["listMemoryWriteEvents"]["params"],
    AppRPCSchema["requests"]["listMemoryWriteEvents"]["response"]
  >;
  getMemoryStats: RpcProcedureCall<
    AppRPCSchema["requests"]["getMemoryStats"]["params"],
    AppRPCSchema["requests"]["getMemoryStats"]["response"]
  >;
  eraseMemory: RpcProcedureCall<
    AppRPCSchema["requests"]["eraseMemory"]["params"],
    AppRPCSchema["requests"]["eraseMemory"]["response"]
  >;
  listProjects: RpcProcedureCall<
    AppRPCSchema["requests"]["listProjects"]["params"],
    AppRPCSchema["requests"]["listProjects"]["response"]
  >;
  listProjectFavicons: RpcProcedureCall<
    AppRPCSchema["requests"]["listProjectFavicons"]["params"],
    AppRPCSchema["requests"]["listProjectFavicons"]["response"]
  >;
  logClientEvent: RpcProcedureCall<
    AppRPCSchema["requests"]["logClientEvent"]["params"],
    AppRPCSchema["requests"]["logClientEvent"]["response"]
  >;
  openProject: RpcProcedureCall<
    AppRPCSchema["requests"]["openProject"]["params"],
    RpcProjectWorktreesResult
  >;
  openProjectsBatch: RpcProcedureCall<
    AppRPCSchema["requests"]["openProjectsBatch"]["params"],
    AppRPCSchema["requests"]["openProjectsBatch"]["response"]
  >;
  closeProject: RpcProcedureCall<
    AppRPCSchema["requests"]["closeProject"]["params"],
    AppRPCSchema["requests"]["closeProject"]["response"]
  >;
  deleteProject: RpcProcedureCall<
    AppRPCSchema["requests"]["deleteProject"]["params"],
    AppRPCSchema["requests"]["deleteProject"]["response"]
  >;
  listProjectWorktrees: RpcProcedureCall<
    AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
    RpcProjectWorktreesResult
  >;
  createWorktree: RpcProcedureCall<
    AppRPCSchema["requests"]["createWorktree"]["params"],
    RpcCreateWorktreeResult
  >;
  openWorktree: RpcProcedureCall<
    AppRPCSchema["requests"]["openWorktree"]["params"],
    RpcOpenWorktreeResult
  >;
  openWorktreesBatch: RpcProcedureCall<
    AppRPCSchema["requests"]["openWorktreesBatch"]["params"],
    AppRPCSchema["requests"]["openWorktreesBatch"]["response"]
  >;
  getWorktreeSnapshot: RpcProcedureCall<
    AppRPCSchema["requests"]["getWorktreeSnapshot"]["params"],
    AppRPCSchema["requests"]["getWorktreeSnapshot"]["response"]
  >;
  listProjectSkills: RpcProcedureCall<
    AppRPCSchema["requests"]["listProjectSkills"]["params"],
    AppRPCSchema["requests"]["listProjectSkills"]["response"]
  >;
  readWorktreeFileContentPage: RpcProcedureCall<
    AppRPCSchema["requests"]["readWorktreeFileContentPage"]["params"],
    AppRPCSchema["requests"]["readWorktreeFileContentPage"]["response"]
  >;
  readWorktreeFileDiff: RpcProcedureCall<
    AppRPCSchema["requests"]["readWorktreeFileDiff"]["params"],
    AppRPCSchema["requests"]["readWorktreeFileDiff"]["response"]
  >;
  setActiveWorktree: RpcProcedureCall<
    AppRPCSchema["requests"]["setActiveWorktree"]["params"],
    AppRPCSchema["requests"]["setActiveWorktree"]["response"]
  >;
  focusContext: RpcProcedureCall<
    AppRPCSchema["requests"]["focusContext"]["params"],
    AppRPCSchema["requests"]["focusContext"]["response"]
  >;
  respondThreadExtensionUi: RpcProcedureCall<
    AppRPCSchema["requests"]["respondThreadExtensionUi"]["params"],
    AppRPCSchema["requests"]["respondThreadExtensionUi"]["response"]
  >;
  updateThreadExtensionEditor: RpcProcedureCall<
    AppRPCSchema["requests"]["updateThreadExtensionEditor"]["params"],
    AppRPCSchema["requests"]["updateThreadExtensionEditor"]["response"]
  >;
  listWorktreeGitHistory: RpcProcedureCall<
    AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
    AppRPCSchema["requests"]["listWorktreeGitHistory"]["response"]
  >;
  getWorktreeGitCommitDiff: RpcProcedureCall<
    AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
    AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["response"]
  >;
  closeWorktree: RpcProcedureCall<
    AppRPCSchema["requests"]["closeWorktree"]["params"],
    AppRPCSchema["requests"]["closeWorktree"]["response"]
  >;
  setWorktreePinned: RpcProcedureCall<
    AppRPCSchema["requests"]["setWorktreePinned"]["params"],
    AppRPCSchema["requests"]["setWorktreePinned"]["response"]
  >;
  listTerminals: RpcProcedureCall<
    AppRPCSchema["requests"]["listTerminals"]["params"],
    AppRPCSchema["requests"]["listTerminals"]["response"]
  >;
  createTerminal: RpcProcedureCall<
    AppRPCSchema["requests"]["createTerminal"]["params"],
    AppRPCSchema["requests"]["createTerminal"]["response"]
  >;
  renameTerminal: RpcProcedureCall<
    AppRPCSchema["requests"]["renameTerminal"]["params"],
    AppRPCSchema["requests"]["renameTerminal"]["response"]
  >;
  closeTerminal: RpcProcedureCall<
    AppRPCSchema["requests"]["closeTerminal"]["params"],
    AppRPCSchema["requests"]["closeTerminal"]["response"]
  >;
  getTerminalSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["getTerminalSettings"]["params"],
    AppRPCSchema["requests"]["getTerminalSettings"]["response"]
  >;
  getTimezoneSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["getTimezoneSettings"]["params"],
    AppRPCSchema["requests"]["getTimezoneSettings"]["response"]
  >;
  getUserRuntimeSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["getUserRuntimeSettings"]["params"],
    AppRPCSchema["requests"]["getUserRuntimeSettings"]["response"]
  >;
  updateTimezoneSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["updateTimezoneSettings"]["params"],
    AppRPCSchema["requests"]["updateTimezoneSettings"]["response"]
  >;
  updateTerminalSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["updateTerminalSettings"]["params"],
    AppRPCSchema["requests"]["updateTerminalSettings"]["response"]
  >;
  updateUserRuntimeSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["updateUserRuntimeSettings"]["params"],
    AppRPCSchema["requests"]["updateUserRuntimeSettings"]["response"]
  >;
  listThreads: RpcProcedureCall<
    AppRPCSchema["requests"]["listThreads"]["params"],
    AppRPCSchema["requests"]["listThreads"]["response"]
  >;
  listThreadStatuses: RpcProcedureCall<
    AppRPCSchema["requests"]["listThreadStatuses"]["params"],
    AppRPCSchema["requests"]["listThreadStatuses"]["response"]
  >;
  createThread: RpcProcedureCall<
    AppRPCSchema["requests"]["createThread"]["params"],
    AppRPCSchema["requests"]["createThread"]["response"]
  >;
  requestThreadStart: RpcProcedureCall<
    AppRPCSchema["requests"]["requestThreadStart"]["params"],
    AppRPCSchema["requests"]["requestThreadStart"]["response"]
  >;
  approveThreadStartRequest: RpcProcedureCall<
    AppRPCSchema["requests"]["approveThreadStartRequest"]["params"],
    AppRPCSchema["requests"]["approveThreadStartRequest"]["response"]
  >;
  getThread: RpcProcedureCall<
    AppRPCSchema["requests"]["getThread"]["params"],
    AppRPCSchema["requests"]["getThread"]["response"]
  >;
  getThreadMessageContent: RpcProcedureCall<
    AppRPCSchema["requests"]["getThreadMessageContent"]["params"],
    AppRPCSchema["requests"]["getThreadMessageContent"]["response"]
  >;
  markThreadErrorSeen: RpcProcedureCall<
    AppRPCSchema["requests"]["markThreadErrorSeen"]["params"],
    AppRPCSchema["requests"]["markThreadErrorSeen"]["response"]
  >;
  sendThreadMessage: RpcProcedureCall<
    AppRPCSchema["requests"]["sendThreadMessage"]["params"],
    AppRPCSchema["requests"]["sendThreadMessage"]["response"]
  >;
  stopThreadTurn: RpcProcedureCall<
    AppRPCSchema["requests"]["stopThreadTurn"]["params"],
    AppRPCSchema["requests"]["stopThreadTurn"]["response"]
  >;
  newCron: RpcProcedureCall<
    AppRPCSchema["requests"]["newCron"]["params"],
    AppRPCSchema["requests"]["newCron"]["response"]
  >;
  updateCron: RpcProcedureCall<
    AppRPCSchema["requests"]["updateCron"]["params"],
    AppRPCSchema["requests"]["updateCron"]["response"]
  >;
  listCrons: RpcProcedureCall<
    AppRPCSchema["requests"]["listCrons"]["params"],
    AppRPCSchema["requests"]["listCrons"]["response"]
  >;
  runCronNow: RpcProcedureCall<
    AppRPCSchema["requests"]["runCronNow"]["params"],
    AppRPCSchema["requests"]["runCronNow"]["response"]
  >;
  getCalendarBootstrap: RpcProcedureCall<
    AppRPCSchema["requests"]["getCalendarBootstrap"]["params"],
    AppRPCSchema["requests"]["getCalendarBootstrap"]["response"]
  >;
  listCalendarOccurrences: RpcProcedureCall<
    AppRPCSchema["requests"]["listCalendarOccurrences"]["params"],
    AppRPCSchema["requests"]["listCalendarOccurrences"]["response"]
  >;
  createCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["createCalendar"]["params"],
    AppRPCSchema["requests"]["createCalendar"]["response"]
  >;
  updateCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["updateCalendar"]["params"],
    AppRPCSchema["requests"]["updateCalendar"]["response"]
  >;
  deleteCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["deleteCalendar"]["params"],
    AppRPCSchema["requests"]["deleteCalendar"]["response"]
  >;
  leaveSharedCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["leaveSharedCalendar"]["params"],
    AppRPCSchema["requests"]["leaveSharedCalendar"]["response"]
  >;
  updateCalendarPreference: RpcProcedureCall<
    AppRPCSchema["requests"]["updateCalendarPreference"]["params"],
    AppRPCSchema["requests"]["updateCalendarPreference"]["response"]
  >;
  setCalendarShare: RpcProcedureCall<
    AppRPCSchema["requests"]["setCalendarShare"]["params"],
    AppRPCSchema["requests"]["setCalendarShare"]["response"]
  >;
  createCalendarEvent: RpcProcedureCall<
    AppRPCSchema["requests"]["createCalendarEvent"]["params"],
    AppRPCSchema["requests"]["createCalendarEvent"]["response"]
  >;
  updateCalendarEvent: RpcProcedureCall<
    AppRPCSchema["requests"]["updateCalendarEvent"]["params"],
    AppRPCSchema["requests"]["updateCalendarEvent"]["response"]
  >;
  deleteCalendarEvent: RpcProcedureCall<
    AppRPCSchema["requests"]["deleteCalendarEvent"]["params"],
    AppRPCSchema["requests"]["deleteCalendarEvent"]["response"]
  >;
  createExternalIcsCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["createExternalIcsCalendar"]["params"],
    AppRPCSchema["requests"]["createExternalIcsCalendar"]["response"]
  >;
  updateExternalIcsCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["updateExternalIcsCalendar"]["params"],
    AppRPCSchema["requests"]["updateExternalIcsCalendar"]["response"]
  >;
  refreshExternalIcsCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["refreshExternalIcsCalendar"]["params"],
    AppRPCSchema["requests"]["refreshExternalIcsCalendar"]["response"]
  >;
  deleteExternalIcsCalendar: RpcProcedureCall<
    AppRPCSchema["requests"]["deleteExternalIcsCalendar"]["params"],
    AppRPCSchema["requests"]["deleteExternalIcsCalendar"]["response"]
  >;
  updateCalendarNotificationSettings: RpcProcedureCall<
    AppRPCSchema["requests"]["updateCalendarNotificationSettings"]["params"],
    AppRPCSchema["requests"]["updateCalendarNotificationSettings"]["response"]
  >;
  listCalendarNotifications: RpcProcedureCall<
    AppRPCSchema["requests"]["listCalendarNotifications"]["params"],
    AppRPCSchema["requests"]["listCalendarNotifications"]["response"]
  >;
  listUserNotifications: RpcProcedureCall<
    AppRPCSchema["requests"]["listUserNotifications"]["params"],
    AppRPCSchema["requests"]["listUserNotifications"]["response"]
  >;
  dismissUserNotification: RpcProcedureCall<
    AppRPCSchema["requests"]["dismissUserNotification"]["params"],
    AppRPCSchema["requests"]["dismissUserNotification"]["response"]
  >;
  dismissCalendarNotification: RpcProcedureCall<
    AppRPCSchema["requests"]["dismissCalendarNotification"]["params"],
    AppRPCSchema["requests"]["dismissCalendarNotification"]["response"]
  >;
  snoozeCalendarNotification: RpcProcedureCall<
    AppRPCSchema["requests"]["snoozeCalendarNotification"]["params"],
    AppRPCSchema["requests"]["snoozeCalendarNotification"]["response"]
  >;
  updateThreadMetadata: RpcProcedureCall<
    AppRPCSchema["requests"]["updateThreadMetadata"]["params"],
    AppRPCSchema["requests"]["updateThreadMetadata"]["response"]
  >;
  renameThread: RpcProcedureCall<
    AppRPCSchema["requests"]["renameThread"]["params"],
    AppRPCSchema["requests"]["renameThread"]["response"]
  >;
  setThreadPinned: RpcProcedureCall<
    AppRPCSchema["requests"]["setThreadPinned"]["params"],
    AppRPCSchema["requests"]["setThreadPinned"]["response"]
  >;
  updateThreadModel: RpcProcedureCall<
    AppRPCSchema["requests"]["updateThreadModel"]["params"],
    AppRPCSchema["requests"]["updateThreadModel"]["response"]
  >;
  updateThreadReasoningEffort: RpcProcedureCall<
    AppRPCSchema["requests"]["updateThreadReasoningEffort"]["params"],
    AppRPCSchema["requests"]["updateThreadReasoningEffort"]["response"]
  >;
  updateThreadAccess: RpcProcedureCall<
    AppRPCSchema["requests"]["updateThreadAccess"]["params"],
    AppRPCSchema["requests"]["updateThreadAccess"]["response"]
  >;
  deleteThread: RpcProcedureCall<
    AppRPCSchema["requests"]["deleteThread"]["params"],
    AppRPCSchema["requests"]["deleteThread"]["response"]
  >;
  discardEmptyThread: RpcProcedureCall<
    AppRPCSchema["requests"]["discardEmptyThread"]["params"],
    AppRPCSchema["requests"]["discardEmptyThread"]["response"]
  >;
}
