/**
 * @file src/bun/project-procedures.ts
 * @description Module for project procedures.
 */

import type { Database } from "bun:sqlite";
import { basename, resolve } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
  type ChatImageAttachment,
  estimateBase64ByteLength,
  isChatImageByteSizeAllowed,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  normalizeChatImageMimeType,
} from "../shared/chat-images";
import type { CronJobRecord, ThreadActivityInput, ThreadRecord } from "./db";
import {
  createSecurityAuditEvent,
  getAppDataDirectoryPath,
  getTerminalSettings as getPersistedTerminalSettings,
  getUserById,
  initAppDatabase,
  resolveSingletonLocalSettingsUserId,
  updateTerminalSettings as updatePersistedTerminalSettings,
  upsertProject,
} from "./db";
import {
  getEffectiveLocalTimezone,
  readLocalRuntimeSettings,
  readLocalTimezoneSettings,
  updateLocalRuntimeSettings,
  updateLocalTimezoneSettings,
} from "./local-settings";
import { createBoundCronStore } from "./cron-store";
import { expandCronScheduleForBun } from "./cron-schedules";
import {
  DEFAULT_GIT_HISTORY_PAGE_SIZE,
  type GitCommandOptions,
  type GitCommandPriority,
  listGitWorktreesForProjectPath,
  normalizeGitCommandOptions,
  normalizeGitHistoryPageLimit,
  normalizeGitPath,
  readGitHistoryFirstPage,
  readGitHistorySummary,
  readWorktreeChangeDiff,
  readWorktreeFileContentPage,
  readWorktreeSnapshot,
  runGitCommand,
} from "./git";
import { createSubsystemLogger } from "./logging";
import { createBoundMessageActivityStore } from "./message-activity-store";
import type { PiMetidosToolHost } from "./pi/metidos/tools";
import {
  eraseMemory,
  getMemoryEvidenceDetail,
  getMemoryFactDetail,
  getMemoryStats,
  listMemoryEvidenceForObservability,
  listMemoryRecallEvents,
  listMemoryWriteEvents,
  searchMemoryFactsForObservability,
} from "./pi/memory/observability";
import {
  buildPiPromptWithPluginInjections,
  createPiThreadRuntime,
  type PiThreadRuntime,
} from "./pi/thread-runtime";
import { buildPluginInventoryWithLifecycle } from "./plugin/lifecycle";
import type { PluginSidecarProcessManager } from "./plugin/sidecar-manager";
import {
  getPluginIngressExternalBinding,
  getPluginIngressRouteConfig,
} from "./plugin/ingress-store";
import type {
  PluginIngressRoute,
  PluginIngressRouteLookupInput,
} from "./plugin/ingress-thread-router";
import type { PluginIngressBatchThreadHost } from "./plugin/ingress-batch-processor";
import {
  listAvailablePluginAccessGroupsFromInventory,
  normalizeThreadPluginAccessGroups,
} from "./plugin/tool-access";
import {
  getLocalOperatorProfile,
  getLocalOperatorState,
  requireCalendarOperatorUserId,
  requireLocalOperatorCapability,
} from "./project-procedures/local-operator";
import {
  createCalendarEventProcedure,
  createCalendarProcedure,
  createExternalIcsCalendarProcedure,
  deleteCalendarEventProcedure,
  deleteCalendarProcedure,
  deleteExternalIcsCalendarProcedure,
  dismissCalendarNotificationProcedure,
  getCalendarBootstrapProcedure,
  leaveSharedCalendarProcedure,
  listCalendarNotificationsProcedure,
  listCalendarOccurrencesProcedure,
  refreshExternalIcsCalendarProcedure,
  setCalendarShareProcedure,
  snoozeCalendarNotificationProcedure,
  updateCalendarEventProcedure,
  updateCalendarNotificationSettingsProcedure,
  updateCalendarPreferenceProcedure,
  updateCalendarProcedure,
  updateExternalIcsCalendarProcedure,
} from "./project-procedures/calendar-procedures";
import {
  deleteProject,
  ensureProjectWorktreeVisible,
  getProject,
  getProjectById,
  listProjects,
  listProjectWorktreesMetadata,
  type ProjectRecord,
  setProjectClosed,
  setProjectFaviconDataUrl,
  setProjectWorktreePinned,
} from "./project-store";

export {
  createCalendarEventProcedure,
  createCalendarProcedure,
  createExternalIcsCalendarProcedure,
  deleteCalendarEventProcedure,
  deleteCalendarProcedure,
  deleteExternalIcsCalendarProcedure,
  dismissCalendarNotificationProcedure,
  getCalendarBootstrapProcedure,
  leaveSharedCalendarProcedure,
  listCalendarNotificationsProcedure,
  listCalendarOccurrencesProcedure,
  refreshExternalIcsCalendarProcedure,
  setCalendarShareProcedure,
  snoozeCalendarNotificationProcedure,
  updateCalendarEventProcedure,
  updateCalendarNotificationSettingsProcedure,
  updateCalendarPreferenceProcedure,
  updateCalendarProcedure,
  updateExternalIcsCalendarProcedure,
};

import { logClientEventProcedure as logClientEventWithDatabase } from "./project-procedures/client-log";
import {
  listDirectorySuggestions,
  shutdownDirectorySuggestionCacheMaintenance,
  startDirectorySuggestionCacheMaintenance,
  warmDirectorySuggestionCache,
} from "./project-procedures/directory-suggestions";
import {
  abortGitHistoryPrefetch,
  buildGitHistoryResultFromCache,
  fillGitHistoryCache,
  getCachedGitCommitDiffResult,
  type PendingGitCommitDiffRequest,
  warmGitHistoryCache,
} from "./project-procedures/git-history";
import {
  assertCodexModelProviderAvailable,
  buildModelCatalog,
  codexModelProvider,
  getModelCatalogProcedure,
  normalizeStoredCodexModel,
  normalizeStoredCodexReasoningEffort,
  resolveCodexModelDescriptor,
  resolveCodexReasoningEffort,
  resolveRunnableCodexModel,
  setActiveBuiltInModelProviderSource,
  setPluginModelProviderCatalogSource,
} from "./project-procedures/model-catalog";
import {
  createPluginIngressLinkCodeProcedure,
  deletePluginIngressExternalBindingProcedure,
  getPluginInventoryProcedure,
  getPluginSettingsProcedure,
  listPluginAccessGroupsProcedure,
  listPluginIngressExternalBindingsProcedure,
  listPluginIngressRouteConfigsProcedure,
  listPluginIngressSourcesProcedure,
  runPluginAdminActionProcedure,
  runPluginLifecycleActionProcedure,
  setPluginIngressExternalBindingEnabledProcedure,
  updatePluginSettingsProcedure,
  upsertPluginIngressRouteConfigProcedure,
} from "./project-procedures/plugin-procedures";

export {
  createPluginIngressLinkCodeProcedure,
  deletePluginIngressExternalBindingProcedure,
  getModelCatalogProcedure,
  getPluginInventoryProcedure,
  getPluginSettingsProcedure,
  listPluginAccessGroupsProcedure,
  listPluginIngressExternalBindingsProcedure,
  listPluginIngressRouteConfigsProcedure,
  listPluginIngressSourcesProcedure,
  runPluginAdminActionProcedure,
  runPluginLifecycleActionProcedure,
  setPluginIngressExternalBindingEnabledProcedure,
  updatePluginSettingsProcedure,
  upsertPluginIngressRouteConfigProcedure,
};

import { createPiThreadEventProjector } from "./project-procedures/pi-event-projection";
import {
  extractPiAssistantErrorMessage,
  extractPiAssistantMessageText,
  extractPiAssistantStopReason,
  extractPiAssistantUsage,
} from "./project-procedures/pi-sdk-shapes";
import {
  buildPiRuntimeCompaction,
  buildPiRuntimeUsage,
} from "./project-procedures/pi-session-telemetry";
import { discoverProjectFaviconDataUrl } from "./project-procedures/project-favicons";
import { discoverProjectSkillsFromWorktree } from "./project-procedures/project-skills";
import type { ProjectWorktreeReadOptions } from "./project-procedures/project-worktrees";
import { projectWorktreeLifecycle } from "./project-procedures/project-worktree-lifecycle";
import { threadLifecycle } from "./project-procedures/thread-lifecycle";
import { workContextEvents } from "./project-procedures/work-context-events";
import type {
  ProjectPollState,
  ThreadAccessControls,
  WorkContextLifecycleEvent,
  WorkContextProjectWorktreeListing as ProjectWorktreeListing,
  WorktreePollState,
} from "./project-procedures/work-context-lifecycle";
import {
  awaitAbortableResult,
  createAbortError,
  createAsyncConcurrencyLimit,
  isAbortError,
  normalizePath,
  throwIfAborted,
} from "./project-procedures/shared";
import {
  adminWorkspacePathScopeForInternalCall,
  assertWorkspacePathAllowed,
  ensureWorkspaceDirectory,
  formatWorkspacePathForUser,
  isWorkspacePathAllowed,
  normalizeRequestedWorkspacePath as normalizeRequestedWorkspacePathForScope,
  type WorkspacePathScope,
  workspaceDirectorySuggestionOptions,
  workspacePathScopeForLocalOperator,
  workspacePathScopeForProject,
} from "./project-procedures/workspace-path-policy";
import { createThreadActivityPersistenceStore } from "./project-procedures/thread-activity-persistence";
import {
  buildThreadTitle,
  isStoppedThreadMessage,
  THREAD_INTERRUPTED_MESSAGE,
  THREAD_STOPPED_MESSAGE,
  toRpcThread,
  toRpcThreadMessage,
  toRpcThreadMessagesWithPreviews,
} from "./project-procedures/thread-detail";
import {
  type ThreadRunSettledEvent,
  ThreadRuntimeLifecycle,
} from "./project-procedures/thread-runtime-lifecycle";
import { ThreadTurnPersistenceCoordinator } from "./project-procedures/thread-turn-persistence";
import { ThreadTurnRunner } from "./project-procedures/thread-turn-runner";
import { ThreadTurnRuntimeCoordinator } from "./project-procedures/thread-turn-runtime";

export type { ThreadRunSettledEvent } from "./project-procedures/thread-runtime-lifecycle";

import {
  projectLegacyThreadAccessControl,
  projectThreadAccessControl,
} from "../shared/thread-access-projection";
import {
  recordCrossWorkspaceThreadAuditEvent,
  recordProjectDeletedAuditEvent,
} from "./project-security-audit";
import type {
  AppRPCSchema,
  RpcAppBootstrapResult,
  RpcClientLogRequest,
  RpcContextFocusChanged,
  RpcCreateWorktreeResult,
  RpcCronJob,
  RpcGitCommitDiffResult,
  RpcHomeDirectoryResult,
  RpcOpenProjectsBatchResultItem,
  RpcOpenWorktreeResult,
  RpcOpenWorktreesBatchResultItem,
  RpcProject,
  RpcProjectFavicon,
  RpcProjectSkill,
  RpcProjectWorktreesResult,
  RpcReasoningEffort,
  RpcRequestContext,
  RpcRequestPriority,
  RpcTerminal,
  RpcTerminalSettings,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadExtensionUiRequest,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcThreadStartRequestResolved,
  RpcThreadUsage,
  RpcUserNotificationDelivery,
  RpcUserNotificationDeliveryResult,
  RpcUserNotificationProviderReceipt,
  RpcWorktree,
  RpcWorktreeFileContentPage,
  RpcWorktreeFileDiff,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
} from "./rpc-schema";
import { MAINVIEW_HTML_BOOTSTRAP_CONTRACT } from "./rpc-schema";
import { recordSqliteRetryLoop } from "./runtime-stats";
import {
  runCronNow as runCronNowInScheduler,
  syncCronSchedulerCron,
} from "./sidecar-cron-scheduler";
import { terminalManager } from "./terminal-manager";
import { createBoundThreadStore } from "./thread-store";
import {
  hasNormalizedThreadMetadataPatch,
  normalizeThreadMetadataPatch,
} from "./thread-metadata-normalization";
import {
  createThreadPermissionRegistry,
  normalizeThreadPermissions,
  permissionDescriptorsForAgentCatalog,
  pluginPermissionDescriptorsFromInventory,
  type ThreadPermissionRegistry,
} from "./thread-permissions";
import {
  dismissUserNotificationDelivery,
  listUserNotificationDeliveries,
  recordUserNotificationDelivery,
} from "./user-notifications";

/**
 * Shared DB handle for all RPC procedures in this process.
 */

const db = initAppDatabase();
const threadStore = createBoundThreadStore(db);
const messageActivityStore = createBoundMessageActivityStore(db);
const cronStore = createBoundCronStore(db);
const logger = createSubsystemLogger("Project Procedures");
// Shared fallback for internal calls that intentionally have no caller-driven cancellation.
const NEVER_ABORT_SIGNAL = new AbortController().signal;

function requireUnsafeModeAllowed(context?: RpcRequestContext): void {
  requireLocalOperatorCapability(context, "unsafe_mode");
}

function localOperatorCanManageApp(context?: RpcRequestContext): boolean {
  return getLocalOperatorState(context).canManageApp;
}

function localOperatorUserId(context?: RpcRequestContext): number | null {
  return getLocalOperatorProfile(context).userId;
}

function persistedLocalOperatorUserId(): number {
  return resolveSingletonLocalSettingsUserId(db);
}

function requireManageApp(context?: RpcRequestContext): void {
  requireLocalOperatorCapability(context, "manage_app");
}

function requireRecentStepUp(context?: RpcRequestContext): void {
  // Step-up proves only that the current local operator recently re-authenticated.
  // Sensitive admin mutations must call requireManageApp before this helper so a
  // future refactor cannot rely on recency as an authorization grant.
  requireLocalOperatorCapability(context, "recent_step_up");
}

function workspacePathScopeForAuthenticatedContext(
  context: RpcRequestContext,
): WorkspacePathScope {
  return workspacePathScopeForLocalOperator(getLocalOperatorState(context));
}

function workspacePathScopeForContext(
  context?: RpcRequestContext,
): WorkspacePathScope {
  if (!context) {
    return adminWorkspacePathScopeForInternalCall();
  }
  return workspacePathScopeForAuthenticatedContext(context);
}

function normalizeRequestedWorkspacePath(
  value: string,
  context?: RpcRequestContext,
): string {
  return normalizeRequestedWorkspacePathForScope(
    value,
    workspacePathScopeForContext(context),
  );
}

function projectIsVisibleToContext(
  project: ProjectRecord,
  context?: RpcRequestContext,
): boolean {
  if (!context || localOperatorCanManageApp(context)) {
    return true;
  }
  return isWorkspacePathAllowed(
    project.path,
    workspacePathScopeForContext(context),
  );
}

function hasUnresolvedRegularUserContext(context?: RpcRequestContext): boolean {
  return (
    !!context &&
    !localOperatorCanManageApp(context) &&
    localOperatorUserId(context) === null
  );
}

function visibleProjects(context?: RpcRequestContext): ProjectRecord[] {
  // Visibility filtering is intentionally in-memory for non-admin contexts:
  // the SQLite list preserves global recency ordering, and workspace scope
  // checks are path-prefix checks over the small project set shown in Mainview.
  if (!context || localOperatorCanManageApp(context)) {
    return listProjects(db);
  }

  const userId = localOperatorUserId(context);
  if (typeof userId !== "number") {
    return [];
  }

  return listProjects(db).filter((project) =>
    projectIsVisibleToContext(project, context),
  );
}

function visibleThreads(context?: RpcRequestContext): ThreadRecord[] {
  if (!context || localOperatorCanManageApp(context)) {
    return threadStore.list();
  }

  return visibleThreadsForProjects(visibleProjects(context), context);
}

function visibleThreadsForProjects(
  projects: readonly ProjectRecord[],
  context?: RpcRequestContext,
): ThreadRecord[] {
  if (!context || localOperatorCanManageApp(context)) {
    return threadStore.list();
  }

  const userId = localOperatorUserId(context);
  if (typeof userId !== "number") {
    return [];
  }

  const visibleProjectIds = new Set(projects.map((project) => project.id));
  return threadStore
    .list()
    .filter((thread) => visibleProjectIds.has(thread.projectId));
}

function visibleThreadsByIds(
  threadIds: readonly number[],
  context?: RpcRequestContext,
): ThreadRecord[] {
  if (threadIds.length === 0) {
    return [];
  }

  if (!context || localOperatorCanManageApp(context)) {
    if (threadIds.length === 1) {
      const thread = threadStore.getById(threadIds[0] ?? -1);
      return thread ? [thread] : [];
    }
    return threadStore.listByIds(threadIds);
  }

  const userId = localOperatorUserId(context);
  if (typeof userId !== "number") {
    return [];
  }

  if (threadIds.length === 1) {
    const thread = threadStore.getById(threadIds[0] ?? -1);
    if (!thread) {
      return [];
    }
    const project = getProjectById(db, thread.projectId);
    return project && projectIsVisibleToContext(project, context)
      ? [thread]
      : [];
  }

  // Memoize per-project visibility within this read so repeated thread IDs in
  // the same project do not re-run workspace path checks.
  const visibleProjectIds = new Set<number>();
  const hiddenProjectIds = new Set<number>();
  return threadStore.listByIds(threadIds).filter((thread) => {
    if (visibleProjectIds.has(thread.projectId)) {
      return true;
    }
    if (hiddenProjectIds.has(thread.projectId)) {
      return false;
    }

    const project = getProjectById(db, thread.projectId);
    if (project && projectIsVisibleToContext(project, context)) {
      visibleProjectIds.add(thread.projectId);
      return true;
    }

    hiddenProjectIds.add(thread.projectId);
    return false;
  });
}

function normalizeRequestedThreadStatusIds(
  threadIds: readonly number[],
): number[] {
  if (threadIds.length <= 1) {
    return threadIds[0] === undefined ? [] : [threadIds[0]];
  }
  return [...new Set(threadIds)];
}

function cronJobWorktreeIsVisible(
  cronJob: CronJobRecord,
  project: ProjectRecord,
  context?: RpcRequestContext,
): boolean {
  if (
    context &&
    !localOperatorCanManageApp(context) &&
    !isWorkspacePathAllowed(
      cronJob.worktreePath,
      workspacePathScopeForContext(context),
    )
  ) {
    return false;
  }

  if (resolve(cronJob.worktreePath) === resolve(project.path)) {
    return true;
  }

  return listProjectWorktreesMetadata(db, project.id).some(
    (record) => resolve(record.worktreePath) === resolve(cronJob.worktreePath),
  );
}

function visibleCronJobs(context?: RpcRequestContext): CronJobRecord[] {
  if (!context || localOperatorCanManageApp(context)) {
    return cronStore.list();
  }

  const userId = localOperatorUserId(context);
  if (typeof userId !== "number") {
    return [];
  }

  const visibleProjectsById = new Map(
    visibleProjects(context).map((project) => [project.id, project]),
  );
  return cronStore.list().filter((cronJob) => {
    const project = visibleProjectsById.get(cronJob.projectId);
    return project
      ? cronJobWorktreeIsVisible(cronJob, project, context)
      : false;
  });
}

/**
 * RPC procedure: returns the caller's effective workspace home directory and
 * whether shell-like `~` expansion is supported for that scope.
 */

export async function getHomeDirectoryProcedure(
  context?: RpcRequestContext,
): Promise<RpcHomeDirectoryResult> {
  const scope = workspacePathScopeForContext(context);
  return {
    homeDirectory: scope.homeDirectory,
    supportsTildePath: scope.supportsTildePath,
  };
}

/**
 * RPC procedure: fetch all known projects from the local DB.
 */

export async function listProjectsProcedure(
  _params?: AppRPCSchema["requests"]["listProjects"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProject[]> {
  return visibleProjects(context);
}

export async function listProjectFaviconsProcedure(
  params: AppRPCSchema["requests"]["listProjectFavicons"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectFavicon[]> {
  const visibleProjectById = new Map(
    visibleProjects(context).map((project) => [project.id, project]),
  );
  const requestedProjectIds = Array.from(new Set(params.projectIds));
  return Promise.all(
    requestedProjectIds
      .filter((projectId) => visibleProjectById.has(projectId))
      .map(async (projectId) => {
        const project = visibleProjectById.get(projectId);
        if (!project) {
          return { projectId, dataUrl: null } satisfies RpcProjectFavicon;
        }
        const discoveredDataUrl = await discoverProjectFaviconDataUrl(
          project.path,
          params.forceRefresh ? { forceRefresh: true } : undefined,
        );
        if (discoveredDataUrl) {
          setProjectFaviconDataUrl(db, projectId, discoveredDataUrl);
        }
        return {
          projectId,
          dataUrl: discoveredDataUrl ?? project.faviconDataUrl ?? null,
        } satisfies RpcProjectFavicon;
      }),
  );
}

export async function logClientEventProcedure(
  params: RpcClientLogRequest,
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["logClientEvent"]["response"]> {
  return logClientEventWithDatabase(db, params, context);
}

function requireMemoryObservatoryAccess(context?: RpcRequestContext): void {
  requireLocalOperatorCapability(context, "manage_app");
}

export async function searchMemoryFactsProcedure(
  params?: AppRPCSchema["requests"]["searchMemoryFacts"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["searchMemoryFacts"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return searchMemoryFactsForObservability(db, params ?? {});
}

export async function getMemoryFactDetailProcedure(
  params: AppRPCSchema["requests"]["getMemoryFactDetail"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getMemoryFactDetail"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return getMemoryFactDetail(db, params.factId);
}

export async function getMemoryEvidenceDetailProcedure(
  params: AppRPCSchema["requests"]["getMemoryEvidenceDetail"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getMemoryEvidenceDetail"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return getMemoryEvidenceDetail(db, params.evidenceId);
}

export async function listMemoryEvidenceProcedure(
  params?: AppRPCSchema["requests"]["listMemoryEvidence"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["listMemoryEvidence"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return listMemoryEvidenceForObservability(db, params ?? {});
}

export async function listMemoryRecallEventsProcedure(
  params?: AppRPCSchema["requests"]["listMemoryRecallEvents"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["listMemoryRecallEvents"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return listMemoryRecallEvents(db, params ?? {});
}

export async function listMemoryWriteEventsProcedure(
  params?: AppRPCSchema["requests"]["listMemoryWriteEvents"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["listMemoryWriteEvents"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return listMemoryWriteEvents(db, params ?? {});
}

export async function getMemoryStatsProcedure(
  params?: AppRPCSchema["requests"]["getMemoryStats"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getMemoryStats"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return getMemoryStats(db, params ?? {});
}

export async function eraseMemoryProcedure(
  params: AppRPCSchema["requests"]["eraseMemory"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["eraseMemory"]["response"]> {
  requireMemoryObservatoryAccess(context);
  return eraseMemory(db, params);
}

/**
 * RPC procedure: list threads with a live run-status snapshot for each thread.
 */

const DEFAULT_THREAD_LIST_PAGE_SIZE = 100;
const MAX_THREAD_LIST_PAGE_SIZE = 250;

function normalizeThreadListPagination(
  params?: AppRPCSchema["requests"]["listThreads"]["params"],
): { limit: number | null; offset: number } {
  if (!params) {
    return { limit: null, offset: 0 };
  }

  const offset = Math.max(0, Math.trunc(params.offset ?? 0));
  const requestedLimit = Math.trunc(
    params.limit ?? DEFAULT_THREAD_LIST_PAGE_SIZE,
  );
  const limit = Math.min(
    MAX_THREAD_LIST_PAGE_SIZE,
    Math.max(1, requestedLimit || DEFAULT_THREAD_LIST_PAGE_SIZE),
  );
  return { limit, offset };
}

export async function listThreadsProcedure(
  params?: AppRPCSchema["requests"]["listThreads"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread[]> {
  const { limit, offset } = normalizeThreadListPagination(params);
  const page =
    limit !== null && (!context || localOperatorCanManageApp(context))
      ? threadStore.listPage({ limit, offset })
      : (() => {
          const threads = visibleThreads(context);
          return limit === null
            ? threads
            : threads.slice(offset, offset + limit);
        })();
  return page.map((thread) =>
    applyActiveThreadRuntimeTelemetry(
      toRpcThread(thread, currentThreadRunStatus(thread)),
    ),
  );
}

/**
 * RPC procedure: list live status summaries for a targeted thread subset.
 */

export async function listThreadStatusesProcedure(
  params: AppRPCSchema["requests"]["listThreadStatuses"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread[]> {
  const requestedThreadIds = normalizeRequestedThreadStatusIds(
    params.threadIds,
  );
  if (requestedThreadIds.length === 0) {
    return [];
  }

  return visibleThreadsByIds(requestedThreadIds, context).map((thread) =>
    applyActiveThreadRuntimeTelemetry(
      toRpcThread(thread, currentThreadRunStatus(thread)),
    ),
  );
}

/**
 * Start shared background cache warmup/maintenance tasks.
 */

export function startProcedureCacheMaintenance(): void {
  startDirectorySuggestionCacheMaintenance();
}

/**
 * Warm likely-on-startup caches so early UI requests avoid first-hit latency.
 */

export function warmProcedureStartupCaches(): void {
  warmDirectorySuggestionCache();
  buildModelCatalog();

  const mostRecentThread = threadStore.list()[0] ?? null;
  if (mostRecentThread) {
    warmThreadDetailCache(mostRecentThread.id);
  }
}

/**
 * On startup, recover threads left mid-turn by previous shutdown/crash.
 * Cron-owned threads are recovered through the same thread path with no special casing.
 */

export function recoverInterruptedThreadTurnsOnStartup(): void {
  threadTurnRunner.recoverInterruptedTurnsOnStartup();
}

async function persistQueuedThreadMessage(
  thread: ThreadRecord,
  input: string,
  images: ChatImageAttachment[],
  startedAt: string,
): Promise<void> {
  await withSqliteRetry(() => {
    return runImmediateSqliteTransaction(() => {
      threadStore.markErrorSeen(thread.id);
      messageActivityStore.writeMessage({
        threadId: thread.id,
        role: "user",
        text: input,
        payloadJson:
          images.length > 0
            ? JSON.stringify({
                images,
              })
            : null,
      });
      threadStore.markRunStarted(thread.id, startedAt);
    });
  });
}

export async function listUserNotificationsProcedure(
  _params: AppRPCSchema["requests"]["listUserNotifications"]["params"],
  context?: RpcRequestContext,
): Promise<RpcUserNotificationDelivery[]> {
  return listUserNotificationDeliveries(
    db,
    requireCalendarOperatorUserId(context),
  );
}

export async function dismissUserNotificationProcedure(
  params: AppRPCSchema["requests"]["dismissUserNotification"]["params"],
  context?: RpcRequestContext,
): Promise<{ success: boolean; deliveryId: number }> {
  dismissUserNotificationDelivery(
    db,
    requireCalendarOperatorUserId(context),
    params.deliveryId,
  );
  return { success: true, deliveryId: params.deliveryId };
}

/**
 * Compose startup shell payload (home, model catalog, projects, and thread list).
 * Thread detail is intentionally loaded by the client after the shell paints.
 */

function serializedJsonByteLength(value: unknown): number {
  // Bootstrap byte accounting is trace-only diagnostic work. The normal RPC
  // response path does not depend on these component serializations, and trace
  // logging is disabled unless METIDOS_TRACE_LOGS=1.
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function logAppBootstrapPayloadStats(payload: RpcAppBootstrapResult): void {
  const components = {
    homeDirectory: payload.homeDirectory,
    modelCatalogDefaults: {
      defaultModel: payload.modelCatalog.defaultModel,
      defaultReasoningEffort: payload.modelCatalog.defaultReasoningEffort,
      reasoningEfforts: payload.modelCatalog.reasoningEfforts,
    },
    modelCatalogModels: payload.modelCatalog.models,
    pluginAccessGroups: payload.pluginAccessGroups,
    threadPermissionDescriptors: payload.threadPermissionDescriptors,
    projects: payload.projects,
    pinnedWorktrees: payload.pinnedWorktrees,
    threadSummaries: payload.threads,
  } satisfies Record<string, unknown>;
  const componentBytes = Object.fromEntries(
    Object.entries(components)
      .map(([name, value]) => [name, serializedJsonByteLength(value)] as const)
      .sort((left, right) => right[1] - left[1]),
  );

  const totalBytes = serializedJsonByteLength(payload);
  logger.trace({
    message: "App bootstrap RPC payload byte summary.",
    totalBytes,
    maxInlineBytes: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.maxPayloadBytes,
    exceedsInlineBudget:
      totalBytes > MAINVIEW_HTML_BOOTSTRAP_CONTRACT.maxPayloadBytes,
    componentBytes,
    detailPolicy:
      "Startup returns list summaries only; thread transcript details remain behind getThread.",
  });
}

export async function getAppBootstrapProcedure(
  _params?: AppRPCSchema["requests"]["getAppBootstrap"]["params"],
  context?: RpcRequestContext,
): Promise<RpcAppBootstrapResult> {
  const [homeDirectory, modelCatalog, pluginInventory] = await Promise.all([
    getHomeDirectoryProcedure(context),
    getModelCatalogProcedure(undefined, context),
    buildPluginInventoryWithLifecycle(),
  ]);
  const pluginAccessGroups =
    listAvailablePluginAccessGroupsFromInventory(pluginInventory);
  let threadPermissionDescriptors = permissionDescriptorsForAgentCatalog(
    createThreadPermissionRegistry(),
  );
  try {
    threadPermissionDescriptors = permissionDescriptorsForAgentCatalog(
      createThreadPermissionRegistry({
        pluginDescriptors:
          pluginPermissionDescriptorsFromInventory(pluginInventory),
      }),
    );
  } catch (error) {
    // Keep the app shell usable if a plugin contributes an invalid permission
    // descriptor. New thread creation still validates explicit plugin
    // permissions against the current inventory, so this bootstrap fallback only
    // hides broken plugin descriptors from the selector instead of granting
    // access from stale or malformed metadata.
    logger.error({
      message:
        "Plugin permission descriptors could not be loaded for app bootstrap.",
      error: describeProjectProceduresError(error),
    });
  }
  const projects = visibleProjects(context);
  const threads = visibleThreadsForProjects(projects, context).slice(
    0,
    DEFAULT_THREAD_LIST_PAGE_SIZE,
  );
  const pinnedWorktrees = projects.flatMap((project) =>
    listProjectWorktreesMetadata(db, project.id)
      .filter((record) => record.pinnedAt !== null)
      .map((record) => ({
        projectId: project.id,
        worktree: {
          path: record.worktreePath,
          branch: null,
          head: null,
          bare: false,
          pinnedAt: record.pinnedAt,
        },
      })),
  );

  const result: RpcAppBootstrapResult = {
    homeDirectory,
    modelCatalog,
    pluginAccessGroups,
    threadPermissionDescriptors,
    projects,
    pinnedWorktrees,
    threadDetail: null,
    threads: threads.map((thread) =>
      applyActiveThreadRuntimeTelemetry(
        toRpcThread(thread, currentThreadRunStatus(thread)),
      ),
    ),
  };
  logAppBootstrapPayloadStats(result);
  return result;
}

/**
 * Polling/caching/ticker constants for project/worktree refresh loops.
 */

const PROJECT_POLL_INTERVAL_MS = 4_000;
const PROJECT_WORKTREE_CACHE_STALE_MS = 12_000;
const GIT_HISTORY_POLL_INTERVAL_MS = 2_000;
const THREAD_DETAIL_CACHE_MAX_ENTRIES = 32;
const GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES = 64;
const WORKTREE_OPEN_CONCURRENCY = 2;
const GIT_HISTORY_READ_CONCURRENCY = 2;
const DIFF_LOAD_CONCURRENCY = 2;
const RESTORE_BATCH_CONCURRENCY = 2;

/**
 * Process-local caches shared by multiple procedure calls.
 */

const projectPollMap = new Map<number, ProjectPollState>();
const THREAD_FINAL_EVENT_GRACE_MS = 50;
const THREAD_STOP_COMPLETION_WAIT_MS = 1_500;
const threadRuntimeLifecycle = new ThreadRuntimeLifecycle({
  createAbortError,
  getNow,
  notifyThreadStatusChanged,
  threadDetailCacheMaxEntries: THREAD_DETAIL_CACHE_MAX_ENTRIES,
});
const piThreadExtensionUiBridge = threadRuntimeLifecycle.extensionUiBridge;
const threadActivityPersistence = createThreadActivityPersistenceStore({
  database: db,
  invalidateThreadDetail: invalidateThreadDetailCache,
});
let piPluginSidecarManager: PluginSidecarProcessManager | null = null;
const threadTurnRuntimeCoordinator = new ThreadTurnRuntimeCoordinator({
  createRuntime: (thread) => {
    const ownerUserId = persistedLocalOperatorUserId();
    return createPiThreadRuntime(thread, {
      extensionUiBridge: piThreadExtensionUiBridge,
      extensionUiSessionId: null,
      ...(piPluginSidecarManager
        ? { ingressReplyToolHost: piPluginSidecarManager }
        : {}),
      metidosToolHost: createPiMetidosToolHost(ownerUserId),
      pluginSidecarManager: piPluginSidecarManager,
    });
  },
  lifecycle: threadRuntimeLifecycle,
  syncRuntimeSessionState: syncPiThreadSessionState,
});
const threadTurnPersistence = new ThreadTurnPersistenceCoordinator({
  invalidateThreadDetail: invalidateThreadDetailCache,
  markThreadStopped: (threadId, message, stoppedAt) =>
    threadStore.markStopped(threadId, message, stoppedAt),
  persistQueuedUserMessage: persistQueuedThreadMessage,
  readDetail: readThreadDetailCached,
  stopInProgressCronRuns: (cronJobId) =>
    cronStore.stopInProgressRuns(cronJobId),
  stopInProgressMessages: (threadId) =>
    messageActivityStore.stopInProgressMessages(threadId),
});
const threadTurnRunner = new ThreadTurnRunner({
  assertModelProviderAvailable: assertCodexModelProviderAvailable,
  createAbortError,
  getNow,
  interruptedMessage: THREAD_INTERRUPTED_MESSAGE,
  lifecycle: threadRuntimeLifecycle,
  persistence: threadTurnPersistence,
  recovery: {
    listInterruptedMessageStates: () =>
      threadStore.listWithInProgressMessages(),
    listThreads: () => threadStore.list(),
  },
  runInBackground: ({
    controller,
    images,
    input,
    sessionId,
    startedAt,
    threadId,
  }) =>
    runThreadMessageInBackground(
      threadId,
      input,
      images,
      startedAt,
      controller,
      sessionId,
    ),
  stopCompletionWaitMs: THREAD_STOP_COMPLETION_WAIT_MS,
  stoppedMessage: THREAD_STOPPED_MESSAGE,
  runtimeManager: threadTurnRuntimeCoordinator,
});

type UserNotificationSentListener = (
  userId: number,
  delivery: RpcUserNotificationDelivery,
) => void;
let notifyUserNotificationSentListener: UserNotificationSentListener | null =
  null;

export function setUserNotificationSentListener(
  listener: UserNotificationSentListener | null,
): void {
  notifyUserNotificationSentListener = listener;
}

export function setPiPluginSidecarManager(
  manager: PluginSidecarProcessManager | null,
): void {
  piPluginSidecarManager = manager;
  setPluginModelProviderCatalogSource(
    manager
      ? () => {
          if (
            typeof manager.refreshPluginModelProviderRegistrationsIfDue ===
            "function"
          ) {
            manager.refreshPluginModelProviderRegistrationsIfDue();
          }
          return typeof manager.listPluginModelProviderRegistrations ===
            "function"
            ? manager.listPluginModelProviderRegistrations()
            : [];
        }
      : null,
  );
  setActiveBuiltInModelProviderSource(
    manager && typeof manager.listPluginPiAuthBindings === "function"
      ? () => [
          ...new Set(
            manager
              .listPluginPiAuthBindings()
              .map((binding) => binding.providerId),
          ),
        ]
      : null,
  );
}
const THREAD_DETAIL_INITIAL_PAGE_MESSAGE_LIMIT = 40;
const THREAD_DETAIL_BACKFILL_PAGE_MESSAGE_LIMIT = 200;
const THREAD_DETAIL_MIN_PAGE_MESSAGE_LIMIT = 1;
const THREAD_DETAIL_MAX_PAGE_MESSAGE_LIMIT = 200;

function normalizeThreadDetailMessageLimit(
  limit: number | undefined,
): number | null {
  if (typeof limit !== "number") {
    return null;
  }
  if (!Number.isFinite(limit)) {
    return null;
  }
  return Math.min(
    THREAD_DETAIL_MAX_PAGE_MESSAGE_LIMIT,
    Math.max(THREAD_DETAIL_MIN_PAGE_MESSAGE_LIMIT, Math.floor(limit)),
  );
}
const gitCommitDiffCache = new Map<string, RpcGitCommitDiffResult>();
const gitCommitDiffRequestCache = new Map<
  string,
  PendingGitCommitDiffRequest
>();
const deferredBackgroundWork = new Map<string, () => void>();
let foregroundReadCount = 0;
const worktreeOpenLimit = createAsyncConcurrencyLimit(
  WORKTREE_OPEN_CONCURRENCY,
);
const gitHistoryReadLimit = createAsyncConcurrencyLimit(
  GIT_HISTORY_READ_CONCURRENCY,
);
const diffLoadLimit = createAsyncConcurrencyLimit(DIFF_LOAD_CONCURRENCY);
const restoreBatchLimit = createAsyncConcurrencyLimit(
  RESTORE_BATCH_CONCURRENCY,
);
let worktreeGitHistoryChangeListener:
  | ((projectId: number, worktreePath: string) => void)
  | null = null;
let cronJobsChangeListener: (() => void) | null = null;
let contextFocusChangeListener:
  | ((payload: RpcContextFocusChanged, sessionId: string | null) => void)
  | null = null;
type PendingThreadStartRequestRecord = {
  ownerUserId: number | null;
  request: RpcThreadStartRequest;
};

const pendingThreadStartRequests = new Map<
  string,
  PendingThreadStartRequestRecord
>();
let threadStartRequestCreatedListener:
  | ((request: RpcThreadStartRequest) => void)
  | null = null;
let threadStartRequestResolvedListener:
  | ((resolved: RpcThreadStartRequestResolved) => void)
  | null = null;
type ThreadStatusChangeListener = (thread: RpcThread) => void;

let threadStatusChangeListener: ThreadStatusChangeListener | null = null;
const threadStatusChangeListeners = new Set<(thread: RpcThread) => void>();
let threadExtensionUiMessageListener:
  | ((
      request: RpcThreadExtensionUiRequest,
      sessionId: string | null,
    ) => boolean)
  | null = null;

piThreadExtensionUiBridge.setMessageListener(
  (request, sessionId) =>
    threadExtensionUiMessageListener?.(request, sessionId) ?? false,
);

function hasForegroundReadPressure(): boolean {
  return foregroundReadCount > 0;
}
function flushDeferredBackgroundWork(): void {
  if (hasForegroundReadPressure() || deferredBackgroundWork.size === 0) {
    return;
  }

  const pendingWork = [...deferredBackgroundWork.values()];
  deferredBackgroundWork.clear();
  for (const callback of pendingWork) {
    callback();
  }
}
/**
 * Performs queueBackgroundWorkWhenIdle operation.
 * @param key - Queue key used to de-dupe background tasks.
 * @param callback - Callback to invoke.
 */

function queueBackgroundWorkWhenIdle(key: string, callback: () => void): void {
  if (!hasForegroundReadPressure()) {
    callback();
    return;
  }

  deferredBackgroundWork.set(key, callback);
}

function syncAllProjectBackgroundPolling(): void {
  for (const state of projectPollMap.values()) {
    syncProjectWorktreeBackgroundPolling(state);
    syncProjectRefreshPolling(state);
  }
}
/**
 * Performs withForegroundRead operation.
 * @param callback - Callback to invoke.
 */

async function withForegroundRead<T>(callback: () => Promise<T>): Promise<T> {
  foregroundReadCount += 1;
  syncAllProjectBackgroundPolling();

  try {
    return await callback();
  } finally {
    foregroundReadCount = Math.max(0, foregroundReadCount - 1);
    syncAllProjectBackgroundPolling();
    flushDeferredBackgroundWork();
  }
}
/**
 * Runs worktree open limited.
 * @param callback - Callback to invoke.
 * @param signal - Abort signal for cancellation.
 */

function runWorktreeOpenLimited<T>(
  callback: () => Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  return worktreeOpenLimit.run(callback, {
    abortMessage: "Worktree open was aborted.",
    signal: signal ?? null,
  });
}
/**
 * Runs git history read limited.
 * @param callback - Callback to invoke.
 * @param signal - Abort signal for cancellation.
 * @param abortMessage - Error message used if the git history read is aborted.
 */

function runGitHistoryReadLimited<T>(
  callback: () => Promise<T>,
  signal: AbortSignal | null | undefined,
  abortMessage: string,
): Promise<T> {
  return gitHistoryReadLimit.run(callback, {
    abortMessage,
    signal: signal ?? null,
  });
}
/**
 * Runs diff load limited.
 * @param callback - Callback to invoke.
 * @param signal - Abort signal for cancellation.
 * @param abortMessage - Error message used if the diff load is aborted.
 */

function runDiffLoadLimited<T>(
  callback: () => Promise<T>,
  signal: AbortSignal | null | undefined,
  abortMessage: string,
): Promise<T> {
  return diffLoadLimit.run(callback, {
    abortMessage,
    signal: signal ?? null,
  });
}

function runRestoreBatchLimited<T>(
  callback: () => Promise<T>,
  signal: AbortSignal | null | undefined,
  abortMessage: string,
): Promise<T> {
  return restoreBatchLimit.run(callback, {
    abortMessage,
    signal: signal ?? null,
  });
}

async function mapWithAbortableConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  signal: AbortSignal | null | undefined,
  abortMessage: string,
  mapInput: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (inputs.length === 0) {
    return [];
  }

  const results = new Array<TOutput>(inputs.length);
  await Promise.all(
    inputs.map((input, index) =>
      runRestoreBatchLimited(
        async () => {
          results[index] = await mapInput(input, index);
        },
        signal,
        abortMessage,
      ),
    ),
  );
  return results;
}
/**
 * Performs recordThreadActivityPersistenceDuration operation.
 * @param durationMs - Milliseconds elapsed before activity persistence completes.
 */

export function getProcedureRuntimeStats(): {
  deferredBackgroundWorkCount: number;
  diffLoadLimit: ReturnType<typeof diffLoadLimit.stats>;
  foregroundReadCount: number;
  gitHistoryReadLimit: ReturnType<typeof gitHistoryReadLimit.stats>;
  openWorktreeCount: number;
  projectPollerCount: number;
  threadActivityPersistenceDurationMs: {
    last: number;
    peak: number;
  };
  worktreeOpenLimit: ReturnType<typeof worktreeOpenLimit.stats>;
} {
  let openWorktreeCount = 0;

  for (const state of projectPollMap.values()) {
    openWorktreeCount += state.openWorktrees.size;
  }

  return {
    deferredBackgroundWorkCount: deferredBackgroundWork.size,
    diffLoadLimit: diffLoadLimit.stats(),
    foregroundReadCount,
    gitHistoryReadLimit: gitHistoryReadLimit.stats(),
    openWorktreeCount,
    projectPollerCount: projectPollMap.size,
    threadActivityPersistenceDurationMs:
      threadActivityPersistence.runtimeStats(),
    worktreeOpenLimit: worktreeOpenLimit.stats(),
  };
}

/**
 * Performs gitPriorityFromRpcRequest operation.
 * @param priority - Priority hint supplied in the RPC request.
 */

function gitPriorityFromRpcRequest(
  priority: RpcRequestPriority,
): GitCommandPriority {
  return priority === "background" ? "background" : "foreground";
}
/**
 * Performs gitCommandOptionsFromRequest operation.
 * @param context - Execution context.
 */

function gitCommandOptionsFromRequest(
  context?: RpcRequestContext,
): GitCommandOptions | undefined {
  if (!context) {
    return undefined;
  }

  return {
    priority: gitPriorityFromRpcRequest(context.priority),
    signal: context.signal,
  };
}
/**
 * Performs invalidateThreadDetailCache operation.
 * @param threadId - Thread identifier.
 */

function publishLifecycleEvent(event: WorkContextLifecycleEvent): void {
  switch (event.type) {
    case "worktree-git-history-changed": {
      worktreeGitHistoryChangeListener?.(event.projectId, event.worktreePath);
      break;
    }
    case "cron-list-changed": {
      cronJobsChangeListener?.();
      break;
    }
    case "context-focus-changed": {
      if (!contextFocusChangeListener) {
        break;
      }
      try {
        contextFocusChangeListener(event.payload, event.sessionId);
      } catch (error) {
        logger.error({
          message: "Failed to publish context focus",
          threadId: event.payload.threadId,
          error: describeProjectProceduresError(error),
        });
      }
      break;
    }
    case "thread-start-request-created": {
      threadStartRequestCreatedListener?.(event.request);
      break;
    }
    case "thread-start-request-resolved": {
      threadStartRequestResolvedListener?.(event.resolved);
      break;
    }
    case "thread-detail-invalidated": {
      threadRuntimeLifecycle.invalidateDetail(event.threadId);
      break;
    }
    case "thread-status-changed": {
      if (threadStatusChangeListener) {
        try {
          threadStatusChangeListener(event.thread);
        } catch (error) {
          logger.error({
            message: "Failed to publish thread status",
            threadId: event.thread.id,
            error: describeProjectProceduresError(error),
          });
        }
      }
      for (const listener of threadStatusChangeListeners) {
        try {
          listener(event.thread);
        } catch (error) {
          logger.error({
            message: "Failed to notify thread status listener",
            threadId: event.thread.id,
            error: describeProjectProceduresError(error),
          });
        }
      }
      break;
    }
  }
}

function invalidateThreadDetailCache(threadId: number): void {
  workContextEvents.publish(
    publishLifecycleEvent,
    workContextEvents.threadDetailInvalidated(threadId),
  );
}

function disposePiThreadRuntime(threadId: number): void {
  threadRuntimeLifecycle.disposeRuntime(threadId);
}
/**
 * Performs clearThreadRuntimeState operation.
 * @param threadId - Thread identifier.
 */

function clearThreadRuntimeState(threadId: number): void {
  threadRuntimeLifecycle.clearThread(threadId);
}
/**
 * Performs clearProjectThreadRuntimeState operation.
 * @param projectId - Project identifier.
 */

function clearProjectThreadRuntimeState(projectId: number): void {
  for (const thread of threadStore.list()) {
    if (thread.projectId !== projectId) {
      continue;
    }
    clearThreadRuntimeState(thread.id);
  }
}
/**
 * Sets thread run status.
 * @param threadId - Thread identifier.
 * @param status - New run status to persist for the thread.
 */

function notifyThreadStatusChanged(threadId: number): void {
  const threadRecord = threadById(threadId);
  const thread = applyActiveThreadRuntimeTelemetry(
    toRpcThread(threadRecord, currentThreadRunStatus(threadRecord)),
  );
  workContextEvents.publish(
    publishLifecycleEvent,
    workContextEvents.threadStatusChanged(thread),
  );
}

function buildContextFocusChangedForThread(threadId: number): {
  payload: RpcContextFocusChanged;
  sessionId: string | null;
} {
  const thread = threadById(threadId);
  const project = projectByIdForPath(thread.projectId);
  return {
    payload: {
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      threadId: thread.id,
      worktreePath: thread.worktreePath,
    },
    sessionId: null,
  };
}

export function notifyContextFocusChangedForThread(threadId: number): void {
  try {
    const { payload, sessionId } = buildContextFocusChangedForThread(threadId);
    workContextEvents.publish(
      publishLifecycleEvent,
      workContextEvents.contextFocusChanged(sessionId, payload),
    );
  } catch (error) {
    // Context focus notifications are best-effort UI pushes. The source action
    // has already completed by the time this helper runs, so log failures for
    // diagnostics instead of surfacing them as secondary user-facing errors.
    logger.error({
      message: "Failed to publish context focus",
      threadId,
      error: describeProjectProceduresError(error),
    });
  }
}

function setThreadRunStatus(
  threadId: number,
  status: RpcThreadRunStatus,
): void {
  threadRuntimeLifecycle.setRunStatus(threadId, status);
}

export function onThreadRunSettled(
  listener: (event: ThreadRunSettledEvent) => void,
): () => void {
  return threadRuntimeLifecycle.onRunSettled(listener);
}

function touchWorkingThreadRunStatus(threadId: number): void {
  threadRuntimeLifecycle.touchWorkingRunStatus(threadId);
}
/**
 * Performs currentThreadRunStatus operation.
 * @param thread - Thread whose current run status is being read.
 */

function currentThreadRunStatus(thread: ThreadRecord): RpcThreadRunStatus {
  return threadRuntimeLifecycle.currentRunStatus(thread);
}

function applyActiveThreadRuntimeTelemetry(thread: RpcThread): RpcThread {
  return threadRuntimeLifecycle.applyRuntimeTelemetry(thread);
}
/**
 * Resolves unsafe mode.
 * @param unsafeMode - Requested unsafe-mode value to resolve.
 */

function resolveUnsafeMode(unsafeMode: boolean | null | undefined): boolean {
  return unsafeMode === true;
}
/**
 * Resolves thread access controls with defaults.
 */

async function createThreadPermissionRegistryForRequest(): Promise<ThreadPermissionRegistry> {
  // Permission validation intentionally uses the current plugin inventory at
  // request time. A plugin that was disabled, failed validation, or lost its
  // access declaration after the UI rendered must not keep granting new thread
  // permissions from a stale client-side catalog.
  const inventory = await buildPluginInventoryWithLifecycle();
  return createThreadPermissionRegistry({
    pluginDescriptors: pluginPermissionDescriptorsFromInventory(inventory),
  });
}

function normalizeExplicitThreadPermissionStrings(
  permissions: string[],
  registry?: ThreadPermissionRegistry,
): string[] {
  const normalized = registry
    ? normalizeThreadPermissions(permissions, registry)
    : permissions.map((permission) => permission.trim()).filter(Boolean);
  return [...new Set(normalized)].sort((left, right) =>
    left.localeCompare(right),
  );
}

async function resolveThreadAccessControlsForRequest(
  input: Parameters<typeof resolveThreadAccessControls>[0],
  context?: RpcRequestContext,
  options?: Parameters<typeof resolveThreadAccessControls>[2],
): Promise<ThreadAccessControls> {
  return resolveThreadAccessControls(input, context, {
    ...options,
    ...(Array.isArray(input?.permissions)
      ? { registry: await createThreadPermissionRegistryForRequest() }
      : {}),
  });
}

function resolveThreadAccessControls(
  input: {
    webSearchAccess?: boolean | null;
    githubAccess?: boolean | null;
    gitAccess?: boolean | null;
    sqliteAccess?: boolean | null;
    webServerAccess?: boolean | null;
    agentsAccess?: boolean | null;
    calendarAccess?: boolean | null;
    notificationsAccess?: boolean | null;
    weatherAccess?: boolean | null;
    threadsAccess?: boolean | null;
    cronsAccess?: boolean | null;
    metidosAccess?: boolean | null;
    pluginAccessGroups?: string[] | null;
    permissions?: string[] | null;
    unsafeMode?: boolean | null;
  } = {},
  context?: RpcRequestContext,
  options?: {
    allowPreauthorizedUnsafeMode?: boolean;
    registry?: ThreadPermissionRegistry;
  },
): ThreadAccessControls {
  const explicitPermissions = Array.isArray(input.permissions)
    ? normalizeExplicitThreadPermissionStrings(
        input.permissions,
        options?.registry,
      )
    : null;
  const projected = explicitPermissions
    ? projectThreadAccessControl({ permissions: explicitPermissions })
    : projectLegacyThreadAccessControl(input, { defaultLegacyAccess: true });
  const unsafeMode = explicitPermissions
    ? projected.unsafeMode
    : resolveUnsafeMode(input.unsafeMode ?? null);
  if (unsafeMode && options?.allowPreauthorizedUnsafeMode !== true) {
    requireUnsafeModeAllowed(context);
  }
  return {
    ...projected,
    pluginAccessGroups: explicitPermissions
      ? []
      : normalizeThreadPluginAccessGroups(input.pluginAccessGroups),
    permissions: explicitPermissions,
    unsafeMode,
  };
}

async function ensurePiThreadRuntime(
  thread: ThreadRecord,
  sessionId: string | null,
): Promise<PiThreadRuntime> {
  return threadTurnRunner.ensureRuntime(thread, sessionId);
}

export function createPiToolRequestContext(
  ownerUserId: number,
  signal?: AbortSignal,
): RpcRequestContext {
  const ownerUser = getUserById(db, ownerUserId);

  return {
    auth: {
      isAdmin: ownerUser?.isAdmin ?? false,
      sessionId: null,
      userId: ownerUserId,
      username: ownerUser?.username ?? null,
    },
    priority: "foreground",
    signal: signal ?? NEVER_ABORT_SIGNAL,
    timeoutMs: null,
  };
}

export function createDefaultPluginIngressThreadHost(): PluginIngressBatchThreadHost {
  return {
    lookupRoute: defaultPluginIngressRouteLookup,
    assertRouteAccess(route) {
      const project = getProjectById(db, route.projectId);
      if (!project) {
        throw new Error("Ingress route target project is not available.");
      }
    },
    async createThread(params) {
      const project = getProjectById(db, params.projectId);
      if (!project) {
        throw new Error("Ingress route target project is not available.");
      }
      const detail = await createThreadProcedure(
        {
          projectId: params.projectId,
          worktreePath: params.worktreePath ?? project.path,
          model: params.model ?? null,
          reasoningEffort: (params.reasoningEffort ??
            null) as RpcReasoningEffort | null,
          permissions: [...(params.permissions ?? ["metidos:threads"])],
        },
        createPiToolRequestContext(persistedLocalOperatorUserId()),
      );
      return { threadId: detail.thread.id };
    },
    async sendThreadMessage(input) {
      await sendThreadMessageProcedure(
        {
          threadId: input.threadId,
          input: input.input,
          ...(input.images ? { images: [...input.images] } : {}),
        },
        createPiToolRequestContext(persistedLocalOperatorUserId()),
      );
    },
  };
}

function defaultPluginIngressRouteLookup(
  input: PluginIngressRouteLookupInput,
): PluginIngressRoute | null {
  const binding = getPluginIngressExternalBinding(
    db,
    input.pluginId,
    input.sourceId,
    input.externalUserId,
  );
  if (!binding?.enabled) return null;
  const route = getPluginIngressRouteConfig(db, {
    pluginId: input.pluginId,
    sourceId: input.sourceId,
  });
  if (!route?.enabled) return null;
  return {
    id: `configured:${route.id}`,
    projectId: route.projectId,
    worktreePath: route.worktreePath,
    model: route.model,
    permissions: route.permissions,
    enabled: route.enabled,
  };
}

function notificationReceiptLabel(
  receipt: RpcUserNotificationProviderReceipt,
): string {
  return receipt.provider ?? receipt.outlet ?? receipt.channel;
}

function notificationReceiptSummary(
  receipt: RpcUserNotificationProviderReceipt,
): string {
  const label = notificationReceiptLabel(receipt);
  const code = receipt.code ? ` (${receipt.code})` : "";
  const externalId = receipt.externalId
    ? ` externalId=${receipt.externalId}`
    : "";
  return `${label}: ${receipt.status}${code} - ${receipt.message}${externalId}`;
}

function notificationReceiptMessage(input: {
  inboxDeliveryId: number;
  receipts: RpcUserNotificationProviderReceipt[];
}): string {
  if (input.receipts.length === 0) {
    return `Recorded in Metidos inbox #${input.inboxDeliveryId}. No external notification provider receipts were returned.`;
  }
  return `Recorded in Metidos inbox #${input.inboxDeliveryId}. External provider receipts: ${input.receipts
    .map(notificationReceiptSummary)
    .join(" | ")}`;
}

async function sendNotificationThroughPluginProviders(
  ownerUserId: number,
  params: {
    body: string;
    clickUrl?: string | null;
    priority?: "min" | "low" | "default" | "high" | "urgent" | null;
    sourceThreadId?: number | null;
    tags?: string[] | null;
    title: string;
  },
): Promise<RpcUserNotificationDeliveryResult> {
  const inboxDelivery = recordUserNotificationDelivery(db, {
    body: params.body,
    clickUrl: params.clickUrl ?? null,
    pluginId: "metidos",
    priority: params.priority ?? null,
    status: "sent",
    tags: params.tags ?? [],
    title: params.title,
  });
  notifyUserNotificationSentListener?.(ownerUserId, inboxDelivery);
  if (!piPluginSidecarManager) {
    const message = "External notification provider runtime is not available.";
    return {
      deliveryId: inboxDelivery.id,
      lastError: null,
      message: `Recorded in Metidos inbox #${inboxDelivery.id}. ${message}`,
      receipts: [],
      status: "delivered",
    };
  }
  let receipts: RpcUserNotificationProviderReceipt[];
  try {
    receipts = await piPluginSidecarManager.dispatchPluginNotificationProviders(
      {
        request: {
          body: params.body,
          clickUrl: params.clickUrl ?? null,
          context: {
            contextKind: "threadTool",
            ownerUserId,
            sourceThreadId: params.sourceThreadId ?? null,
            threadId: params.sourceThreadId ?? null,
          },
          pluginId: "metidos",
          priority: params.priority ?? null,
          tags: params.tags ?? [],
          title: params.title,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      deliveryId: inboxDelivery.id,
      lastError: message,
      message: `Recorded in Metidos inbox #${inboxDelivery.id}. External notification provider dispatch failed: ${message}`,
      receipts: [],
      status: "delivered",
    };
  }
  const message = notificationReceiptMessage({
    inboxDeliveryId: inboxDelivery.id,
    receipts,
  });
  const failedReceipts = receipts.filter(
    (receipt) => receipt.status !== "delivered",
  );
  const deliveredReceipt = receipts.find(
    (receipt) => receipt.status === "delivered",
  );
  if (deliveredReceipt) {
    return {
      deliveryId: deliveredReceipt.deliveryId ?? inboxDelivery.id,
      lastError:
        failedReceipts.length > 0
          ? failedReceipts.map(notificationReceiptSummary).join(" | ")
          : null,
      message,
      receipts,
      status: "delivered",
    };
  }
  const lastError =
    failedReceipts.length > 0
      ? failedReceipts.map(notificationReceiptSummary).join(" | ")
      : null;
  return {
    deliveryId: inboxDelivery.id,
    lastError,
    message,
    receipts,
    status: "delivered",
  };
}

export function createPiMetidosToolHost(
  ownerUserId: number,
  options?: {
    syncCronSchedulerCron?: (cronJobId: number) => void;
  },
): PiMetidosToolHost {
  const syncCron = options?.syncCronSchedulerCron ?? syncCronSchedulerCron;
  return {
    createCalendarEvent: (params) =>
      createCalendarEventProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      ),
    updateCalendarEvent: (params) =>
      updateCalendarEventProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      ),
    getCalendarBootstrap: async () => {
      const bootstrap = await getCalendarBootstrapProcedure(
        undefined,
        createPiToolRequestContext(ownerUserId),
      );
      return {
        calendars: bootstrap.calendars,
        externalCalendars: bootstrap.externalCalendars,
      };
    },
    listCalendarOccurrences: (params) =>
      listCalendarOccurrencesProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      ),
    createTerminal: async (params) => {
      const result = await createTerminalProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      );
      return result.terminal;
    },
    createThread: (params) =>
      createThreadProcedure(params, createPiToolRequestContext(ownerUserId)),
    getModelCatalog: () =>
      getModelCatalogProcedure(
        undefined,
        createPiToolRequestContext(ownerUserId),
      ),
    getPluginInventory: () =>
      getPluginInventoryProcedure(
        undefined,
        createPiToolRequestContext(ownerUserId),
      ),
    listCrons: () =>
      listCronsProcedure(undefined, createPiToolRequestContext(ownerUserId)),
    listProjectWorktrees: (params, signal) =>
      listProjectWorktreesProcedure(
        params,
        createPiToolRequestContext(ownerUserId, signal),
      ).then((result) => result.worktrees),
    listProjects: () =>
      listProjectsProcedure(undefined, createPiToolRequestContext(ownerUserId)),
    listTerminals: (access) =>
      Promise.resolve(terminalManager.listTerminals(access)),
    listThreads: () =>
      listThreadsProcedure(undefined, createPiToolRequestContext(ownerUserId)),
    killTerminal: async (terminalIndex, access) => {
      terminalManager.killTerminalByIndex(terminalIndex, access);
    },
    newCron: async (params) => {
      const cron = await newCronProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      );
      syncCron(cron.id);
      return cron;
    },
    notifyUser: (params) =>
      sendNotificationThroughPluginProviders(ownerUserId, params),
    requestThreadStart: (params) =>
      requestThreadStartProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      ),
    sendThreadMessage: (params) =>
      sendThreadMessageProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      ),
    updateCron: async (params) => {
      const cron = await updateCronProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      );
      syncCron(cron.id);
      return cron;
    },
    updateThreadMetadata: (params) =>
      updateThreadMetadataProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      ),
    viewTerminal: async (terminalIndex, lineOffset, lineCount, access) =>
      terminalManager.viewTerminal(
        terminalIndex,
        lineOffset,
        lineCount,
        access,
      ),
    grepTerminal: async (terminalIndex, pattern, options, access) =>
      terminalManager.grepTerminal(
        terminalIndex,
        pattern,
        options?.ignoreCase,
        options?.maxMatches,
        access,
      ),
  };
}

function syncPiThreadSessionState(
  thread: Pick<
    ThreadRecord,
    "id" | "piLeafEntryId" | "piSessionFile" | "piSessionId"
  >,
  runtime: PiThreadRuntime,
): void {
  const nextState = {
    piSessionId: runtime.session.sessionId || null,
    piSessionFile: runtime.session.sessionFile ?? null,
    piLeafEntryId: runtime.session.sessionManager.getLeafId(),
  };
  if (
    nextState.piSessionId === thread.piSessionId &&
    nextState.piSessionFile === thread.piSessionFile &&
    nextState.piLeafEntryId === thread.piLeafEntryId
  ) {
    return;
  }

  threadStore.updatePiSessionState(thread.id, nextState);
  invalidateThreadDetailCache(thread.id);
}
/**
 * Performs threadById operation.
 * @param threadId - Thread identifier.
 */

function threadById(
  threadId: number,
  context?: RpcRequestContext,
): ThreadRecord {
  if (hasUnresolvedRegularUserContext(context)) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const thread = threadStore.getById(threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  // Raw thread ids are never authoritative for non-admin RPC callers. Reuse the
  // project visibility gate so direct getThread-style reads match listThreads
  // workspace scoping and fail closed for hidden project paths.
  projectByIdForPath(thread.projectId, context);
  return thread;
}
/**
 * Performs rpcThreadById operation.
 * @param threadId - Thread identifier.
 */

function rpcThreadById(
  threadId: number,
  context?: RpcRequestContext,
): RpcThread {
  const thread = threadById(threadId, context);
  return applyActiveThreadRuntimeTelemetry(
    toRpcThread(thread, currentThreadRunStatus(thread)),
  );
}

async function buildThreadDetailRaw(
  threadId: number,
  options?: {
    cursor?: number | null;
    includeHeavyContent?: boolean;
    messageLimit?: number;
  },
): Promise<RpcThreadDetail> {
  const thread = threadById(threadId);
  const cursor = options?.cursor ?? null;
  const requestedMessageLimit = normalizeThreadDetailMessageLimit(
    options?.messageLimit,
  );
  const page = messageActivityStore.listMessagesPage(thread.id, {
    cursor,
    limit:
      requestedMessageLimit ??
      (cursor === null
        ? THREAD_DETAIL_INITIAL_PAGE_MESSAGE_LIMIT
        : THREAD_DETAIL_BACKFILL_PAGE_MESSAGE_LIMIT),
  });
  return {
    thread: toRpcThread(thread, currentThreadRunStatus(thread)),
    messages: await toRpcThreadMessagesWithPreviews(page.messages, {
      includeHeavyContent: options?.includeHeavyContent ?? false,
    }),
    nextCursor: page.nextCursor,
  };
}
/**
 * Builds thread detail.
 * @param threadId - Thread identifier.
 * @param options - Configuration options used by this operation.
 */

async function buildThreadDetail(
  threadId: number,
  options?: {
    cursor?: number | null;
    includeHeavyContent?: boolean;
    messageLimit?: number;
  },
): Promise<RpcThreadDetail> {
  const detail = await buildThreadDetailRaw(threadId, options);
  return {
    ...detail,
    thread: applyActiveThreadRuntimeTelemetry(detail.thread),
  };
}

/**
 * Reads thread detail cached.
 * @param threadId - Thread identifier.
 */

async function readThreadDetailCached(
  threadId: number,
  options?: {
    expectedThread?: RpcThread | null;
  },
): Promise<RpcThreadDetail> {
  return threadRuntimeLifecycle.readDetailCached(threadId, {
    buildRaw: buildThreadDetailRaw,
    expectedThread: options?.expectedThread ?? null,
  });
}
/**
 * Performs warmThreadDetailCache operation.
 * @param threadId - Thread identifier.
 */

function warmThreadDetailCache(threadId: number): void {
  void readThreadDetailCached(threadId).catch((error) => {
    logger.error({
      message: "Failed to warm thread detail cache",
      threadId,
      error: describeProjectProceduresError(error),
    });
  });
}
/**
 * Performs settleCanceledThreadTurn operation.
 * @param threadId - Thread identifier.
 * @param startedAt - Turn start timestamp used to compute cancellation timing.
 * @param lastAssistantItemId - lastAssistantItemId identifier.
 * @param lastAssistantText - Last assistant text emitted before cancellation.
 * @param message - Message payload.
 */

async function settleCanceledThreadTurn(
  threadId: number,
  startedAt: string,
  lastAssistantItemId: string | null,
  lastAssistantText: string,
  message: string,
): Promise<void> {
  if (lastAssistantItemId && lastAssistantText.trim()) {
    await upsertAssistantChatActivity(
      threadId,
      lastAssistantItemId,
      lastAssistantText.trim(),
      "stopped",
    );
  }
  const stoppedAt = getNow();
  threadTurnPersistence.persistStoppedTurn(threadId, message, { stoppedAt });
  setThreadRunStatus(threadId, {
    state: "stopped",
    startedAt,
    updatedAt: stoppedAt,
    error: message,
    hasUnreadError: false,
  });
}
/**
 * Performs interruptionMessageFromAbort operation.
 * @param reason - Reason for this operation.
 */

function interruptionMessageFromAbort(reason: unknown): string {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  const normalizedMessage = message.trim();
  if (
    normalizedMessage === THREAD_STOPPED_MESSAGE ||
    normalizedMessage.toLowerCase().includes("stopped by the user")
  ) {
    return THREAD_STOPPED_MESSAGE;
  }
  if (isStoppedThreadMessage(normalizedMessage)) {
    return normalizedMessage;
  }
  return THREAD_INTERRUPTED_MESSAGE;
}
export function missingAssistantResponseErrorMessage(
  model: string | null | undefined,
): string {
  const baseMessage =
    "Thread run completed without returning an assistant response.";
  const provider = safeCodexModelProvider(model);
  if (provider === "ollama") {
    return `${baseMessage} The Ollama model may have emitted only thinking output without a final answer; try the Instant thinking level for chat, or use a non-thinking Ollama model.`;
  }
  if (provider === "xai") {
    return `${baseMessage} The xAI provider may have stopped after reasoning without emitting a final answer or tool call.`;
  }
  return baseMessage;
}

function safeCodexModelProvider(
  model: string | null | undefined,
): string | null {
  try {
    return codexModelProvider(model);
  } catch {
    const normalized = model?.trim();
    if (!normalized?.includes(":")) {
      return null;
    }
    return normalized.split(":", 2)[0] || null;
  }
}

const FINISHED_WITH_IMAGE_RESPONSE_MESSAGE = "Generated image.";
const FINISHED_WITH_NO_RESPONSE_MESSAGE = "Finished with no response.";

function extractAssistantMessageImageAttachments(
  message: unknown,
): ChatImageAttachment[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }

  const images: ChatImageAttachment[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as {
      data?: unknown;
      mimeType?: unknown;
      type?: unknown;
    };
    if (
      candidate.type !== "image" ||
      typeof candidate.data !== "string" ||
      typeof candidate.mimeType !== "string"
    ) {
      continue;
    }
    const data = candidate.data.trim();
    if (!data || !isChatImageByteSizeAllowed(estimateBase64ByteLength(data))) {
      continue;
    }
    const normalized = normalizeChatImageMimeType(data, candidate.mimeType);
    if ("error" in normalized) {
      continue;
    }
    images.push({ data, mimeType: normalized.mimeType, type: "image" });
    if (images.length >= MAX_CHAT_IMAGE_ATTACHMENTS) {
      break;
    }
  }
  return images;
}

export function requireAssistantResponseText(
  text: string,
  model: string | null | undefined,
): string {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error(missingAssistantResponseErrorMessage(model));
  }
  return normalizedText;
}

function isAssistantToolUseMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as {
    content?: unknown;
    stopReason?: unknown;
  };
  if (candidate.stopReason === "toolUse") {
    return true;
  }
  if (!Array.isArray(candidate.content)) {
    return false;
  }

  return candidate.content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "toolCall" || type === "tool_call" || type === "tool_use";
  });
}

export function assistantResponseTextOrToolUseFallback(
  text: string,
  lastAssistantMessage: unknown,
  model: string | null | undefined,
): string {
  const normalizedText = text.trim();
  if (!normalizedText) {
    if (
      extractAssistantMessageImageAttachments(lastAssistantMessage).length > 0
    ) {
      return FINISHED_WITH_IMAGE_RESPONSE_MESSAGE;
    }
    if (isAssistantToolUseMessage(lastAssistantMessage)) {
      return FINISHED_WITH_NO_RESPONSE_MESSAGE;
    }
  }
  return requireAssistantResponseText(normalizedText, model);
}

function findLatestAssistantMessage(messages: readonly unknown[]): unknown {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      typeof message === "object" &&
      (message as { role?: unknown }).role === "assistant"
    ) {
      return message;
    }
  }

  return null;
}
/**
 * Runs thread message in background.
 * @param threadId - Thread identifier.
 * @param input - Message payload for the background thread message handler.
 * @param startedAt - Start timestamp for background message processing.
 * @param controller - Abort controller for cancellation of background work.
 */

async function runThreadMessageInBackground(
  threadId: number,
  input: string,
  images: ChatImageAttachment[],
  startedAt: string,
  controller: AbortController,
  sessionId: string | null,
): Promise<void> {
  let lastAssistantText = "";
  let lastAssistantItemId: string | null = null;
  let usage: RpcThreadUsage | null = null;
  const bufferedActivityWriter =
    threadActivityPersistence.createBufferedWriter();

  try {
    const thread = threadById(threadId);
    const runtime = await ensurePiThreadRuntime(thread, sessionId);
    const piEventProjector = createPiThreadEventProjector({
      startedAt,
      threadId,
      worktreePath: thread.worktreePath,
    });
    let eventProcessingChain = Promise.resolve();
    let eventProcessingError: unknown = null;

    const unsubscribe = runtime.session.subscribe(
      (event: AgentSessionEvent) => {
        eventProcessingChain = eventProcessingChain
          .then(async () => {
            if (controller.signal.aborted) {
              return;
            }
            touchWorkingThreadRunStatus(threadId);
            const projectedWrites = piEventProjector.project(event);
            if (projectedWrites.length === 0) {
              return;
            }

            await queueProjectedPiActivities(
              bufferedActivityWriter,
              projectedWrites,
            );
            const snapshot = piEventProjector.snapshot();
            lastAssistantItemId = snapshot.lastAssistantItemId;
            lastAssistantText = snapshot.lastAssistantText;
            usage = snapshot.usage ?? usage;
          })
          .catch((error) => {
            if (eventProcessingError === null) {
              eventProcessingError = error;
            }
          });
      },
    );
    const abortPiRuntime = () => {
      void runtime.session.abort().catch(() => {});
    };
    controller.signal.addEventListener("abort", abortPiRuntime, { once: true });
    if (controller.signal.aborted) {
      throw createAbortError(
        controller.signal.reason,
        interruptionMessageFromAbort(controller.signal.reason),
      );
    }

    let promptError: unknown = null;
    try {
      if (images.length > 0) {
        logger.info({
          message: "Forwarding image attachments to Pi runtime",
          threadId,
          imageCount: images.length,
          images: images.map((image) => ({
            base64Length: image.data.length,
            mimeType: image.mimeType,
            type: image.type,
          })),
        });
      }
      const promptInput = await buildPiPromptWithPluginInjections({
        pluginSidecarManager: piPluginSidecarManager,
        prompt: input,
        signal: controller.signal,
        thread,
      });
      await runtime.session.prompt(
        promptInput,
        images.length > 0 ? { images } : undefined,
      );
    } catch (error) {
      promptError = error;
    } finally {
      const settleDeadline = Date.now() + THREAD_FINAL_EVENT_GRACE_MS;
      let waitingForTrailingAssistantEvent = true;
      while (waitingForTrailingAssistantEvent) {
        await Promise.resolve();
        await eventProcessingChain;
        if (promptError) {
          break;
        }
        const trailingAssistantMessage = findLatestAssistantMessage(
          runtime.session.messages,
        );
        const trailingAssistantText = (
          lastAssistantText ||
          extractPiAssistantMessageText(trailingAssistantMessage).trim()
        ).trim();
        const trailingAssistantImages = extractAssistantMessageImageAttachments(
          trailingAssistantMessage,
        );
        if (
          trailingAssistantText ||
          trailingAssistantImages.length > 0 ||
          Date.now() >= settleDeadline
        ) {
          waitingForTrailingAssistantEvent = false;
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      controller.signal.removeEventListener("abort", abortPiRuntime);
      unsubscribe();
    }

    if (eventProcessingError) {
      throw eventProcessingError;
    }
    if (promptError) {
      throw promptError;
    }
    await bufferedActivityWriter.flushAll();

    const lastAssistantMessage = findLatestAssistantMessage(
      runtime.session.messages,
    );
    const projectionSnapshot = piEventProjector.snapshot();
    lastAssistantItemId = projectionSnapshot.lastAssistantItemId;
    lastAssistantText = projectionSnapshot.lastAssistantText;
    usage = projectionSnapshot.usage ?? usage;
    if (
      controller.signal.aborted ||
      extractPiAssistantStopReason(lastAssistantMessage) === "aborted"
    ) {
      await settleCanceledThreadTurn(
        threadId,
        startedAt,
        lastAssistantItemId,
        lastAssistantText,
        interruptionMessageFromAbort(controller.signal.reason),
      );
      return;
    }
    usage = extractPiAssistantUsage(lastAssistantMessage) ?? usage;
    const finalAssistantTextCandidate =
      lastAssistantText ||
      extractPiAssistantMessageText(lastAssistantMessage).trim();
    const finalAssistantImages =
      extractAssistantMessageImageAttachments(lastAssistantMessage);
    const assistantErrorMessage =
      extractPiAssistantErrorMessage(lastAssistantMessage);
    if (
      assistantErrorMessage &&
      !finalAssistantTextCandidate.trim() &&
      finalAssistantImages.length === 0
    ) {
      throw new Error(assistantErrorMessage);
    }
    const finalAssistantText = assistantResponseTextOrToolUseFallback(
      finalAssistantTextCandidate,
      lastAssistantMessage,
      thread.model,
    );
    syncPiThreadSessionState(threadById(threadId), runtime);
    if (lastAssistantItemId) {
      if (lastAssistantText.trim()) {
        await upsertAssistantChatActivity(
          threadId,
          lastAssistantItemId,
          finalAssistantText,
          "completed",
        );
      }
    } else {
      messageActivityStore.writeMessage({
        threadId,
        role: "assistant",
        text: finalAssistantText,
        ...(finalAssistantImages.length > 0
          ? { payloadJson: JSON.stringify({ images: finalAssistantImages }) }
          : {}),
      });
      invalidateThreadDetailCache(threadId);
    }
    if (usage) {
      const currentThread = threadById(threadId);
      const currentRpcThread = toRpcThread(
        currentThread,
        currentThreadRunStatus(currentThread),
      );
      const persistedUsage = buildPiRuntimeUsage(
        currentRpcThread.usage,
        runtime,
      );
      const persistedCompaction = buildPiRuntimeCompaction(
        currentRpcThread.compaction,
        runtime,
      );
      threadStore.setUsage(threadId, persistedUsage ?? usage, {
        maxInputTokens: persistedCompaction.maxObservedInputTokens ?? 0,
        estimatedCompactionTriggerTokens:
          persistedCompaction.estimatedTriggerSource === "observed"
            ? persistedCompaction.estimatedTriggerTokens
            : null,
        compactionCount: persistedCompaction.inferredCount,
        lastCompactionAt: persistedCompaction.lastInferredAt,
        lastCompactionBeforeInputTokens:
          persistedCompaction.lastInferredBeforeInputTokens,
        lastCompactionAfterInputTokens:
          persistedCompaction.lastInferredAfterInputTokens,
      });
      invalidateThreadDetailCache(threadId);
    }
    threadStore.markRan(threadId);
    setThreadRunStatus(threadId, {
      state: "idle",
      startedAt,
      updatedAt: getNow(),
      error: null,
      hasUnreadError: false,
    });
  } catch (error) {
    try {
      await bufferedActivityWriter.flushAll();
    } catch (flushError) {
      logger.error({
        message: "Failed to flush buffered thread activity",
        threadId,
        error: describeProjectProceduresError(flushError),
      });
    }
    if (isAbortError(error) && controller.signal.aborted) {
      await settleCanceledThreadTurn(
        threadId,
        startedAt,
        lastAssistantItemId,
        lastAssistantText,
        interruptionMessageFromAbort(controller.signal.reason),
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (lastAssistantItemId && lastAssistantText.trim()) {
      await upsertAssistantChatActivity(
        threadId,
        lastAssistantItemId,
        lastAssistantText,
        "failed",
      );
    }
    const errorMessage = `Thread run failed: ${message}`;
    threadStore.markFailed(threadId, errorMessage);
    setThreadRunStatus(threadId, {
      state: "failed",
      startedAt,
      updatedAt: getNow(),
      error: errorMessage,
      hasUnreadError: true,
    });
    logger.error({
      message: "Thread run failed",
      threadId,
      error: describeProjectProceduresError(error),
    });
  } finally {
    threadRuntimeLifecycle.deleteControllerIfCurrent(threadId, controller);
    threadRuntimeLifecycle.deleteCompletion(threadId);
  }
}
function normalizeWorkspaceFolderName(name: string): string {
  const folderName = name.trim();
  if (!folderName) {
    throw new Error("Workspace folder name is required.");
  }
  if (
    folderName === "." ||
    folderName === ".." ||
    !/^[A-Za-z0-9._-]+$/u.test(folderName)
  ) {
    throw new Error(
      "Workspace folder name can only use letters, numbers, '.', '_', and '-'.",
    );
  }
  return folderName;
}

function workspaceWorktreeRootForProject(project: ProjectRecord): string {
  return resolve(getAppDataDirectoryPath(), "workspaces", String(project.id));
}
/**
 * Reads project worktrees.
 * @param projectPath - projectPath path used by readProjectWorktrees.
 * @param projectId - Project identifier.
 * @param options - Configuration options used by this operation.
 */

async function readProjectWorktrees(
  projectPath: string,
  projectId?: number,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree[]> {
  return (await readProjectWorktreeListing(projectPath, projectId, options))
    .worktrees;
}

async function readProjectWorktreeListing(
  projectPath: string,
  projectId?: number,
  options?: ProjectWorktreeReadOptions,
): Promise<ProjectWorktreeListing> {
  const { signal } = normalizeGitCommandOptions(options);
  throwIfAborted(signal, "Project worktree read was aborted.");
  const includeHidden = options?.includeHidden === true;

  if (typeof projectId === "number" && !includeHidden) {
    const state = projectPollMap.get(projectId);
    if (state && state.worktreesLoadedAt > 0 && !options?.forceRefresh) {
      if (
        Date.now() - state.worktreesLoadedAt >
        PROJECT_WORKTREE_CACHE_STALE_MS
      ) {
        void refreshProjectPoll(projectId, {
          priority: "background",
        }).catch((error) => {
          logBackgroundGitFailure(
            `Worktree refresh failed for project ${projectId}`,
            error,
          );
        });
      }
      return {
        hiddenWorktrees: [],
        worktrees: state.worktrees,
      };
    }
  }

  const listing = await listFreshProjectWorktreeListing(
    projectPath,
    projectId,
    options,
  );
  if (typeof projectId === "number") {
    const state = projectPollMap.get(projectId);
    if (state) {
      state.worktrees = listing.worktrees;
      state.worktreesLoadedAt = Date.now();
    }
  }
  return listing;
}
/**
 * Lists directory suggestions procedure.
 * @param params - Parameters object.
 */

export async function listDirectorySuggestionsProcedure(
  params: AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]> {
  if (params.query.includes("\0")) {
    throw new Error("Directory suggestion query cannot contain NUL bytes.");
  }
  const scope = workspacePathScopeForContext(context);
  return {
    directories: listDirectorySuggestions(
      params.query,
      workspaceDirectorySuggestionOptions(scope),
    ),
  };
}
function ensureProjectDirectory(
  projectPath: string,
  scope: WorkspacePathScope,
  createIfMissing: boolean,
): void {
  ensureWorkspaceDirectory(projectPath, scope, {
    createIfMissing,
    label: "Project path",
  });
}
/**
 * Performs logBackgroundGitFailure operation.
 * @param message - Message payload.
 * @param error - Error value to process.
 */

function describeProjectProceduresError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

function logBackgroundGitFailure(message: string, error: unknown): void {
  if (isAbortError(error)) {
    return;
  }

  logger.error({
    message,
    error: describeProjectProceduresError(error),
  });
}

/**
 * Performs persistThreadActivityInputs operation.
 * @param inputs - Activity input records queued for persistence.
 */

function persistThreadActivityInputs(
  inputs: Parameters<typeof threadActivityPersistence.persistInputs>[0],
): void {
  threadActivityPersistence.persistInputs(inputs);
}

const queueProjectedPiActivities =
  threadActivityPersistence.queueProjectedPiActivities;
/**
 * Builds assistant chat activity input.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param text - Input text content.
 * @param state - Current state value.
 */

function buildAssistantChatActivityInput(
  threadId: number,
  itemId: string,
  text: string,
  state: "in_progress" | "completed" | "failed" | "stopped",
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "chat",
    role: "assistant",
    text,
    state,
  };
}
/**
 * Upserts assistant chat activity.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param text - Input text content.
 * @param state - Current state value.
 */

async function upsertAssistantChatActivity(
  threadId: number,
  itemId: string,
  text: string,
  state: "in_progress" | "completed" | "failed" | "stopped",
): Promise<void> {
  persistThreadActivityInputs([
    buildAssistantChatActivityInput(threadId, itemId, text, state),
  ]);
}
/**
 * Lists fresh project worktrees.
 * @param projectPath - projectPath path used by listFreshProjectWorktrees.
 * @param projectId - Project identifier.
 * @param options - Configuration options used by this operation.
 */

async function listFreshProjectWorktreeListing(
  projectPath: string,
  projectId?: number,
  options?: ProjectWorktreeReadOptions,
): Promise<ProjectWorktreeListing> {
  let listedWorktrees: RpcWorktree[];
  try {
    listedWorktrees = await listGitWorktreesForProjectPath(
      projectPath,
      options,
    );
  } catch (error) {
    if (!projectWorktreeLifecycle.isGitWorkspaceUnavailableError(error)) {
      throw error;
    }
    listedWorktrees = [];
  }

  const reconciledGitWorktrees =
    listedWorktrees.length > 0
      ? projectWorktreeLifecycle.reconcilePrimaryWorktreePath(
          projectPath,
          listedWorktrees,
        )
      : [];
  const reconciledWorktrees =
    projectWorktreeLifecycle.hydrateOpenProjectWorktrees({
      projectPath,
      rootPinnedAt: null,
      worktrees: reconciledGitWorktrees,
    });
  if (typeof projectId !== "number") {
    return {
      hiddenWorktrees: [],
      worktrees: reconciledWorktrees,
    };
  }

  const project = getProjectById(db, projectId);
  const scope = project ? workspacePathScopeForProject(project) : null;
  const worktrees = scope?.restrictedRoot
    ? projectWorktreeLifecycle.filterForAccess(
        reconciledWorktrees,
        (worktreePath) => isWorkspacePathAllowed(worktreePath, scope),
      )
    : reconciledWorktrees;

  return projectWorktreeLifecycle.hydrateFreshListing({
    includeHidden: options?.includeHidden === true,
    projectPath,
    trackedWorktrees: listProjectWorktreesMetadata(db, projectId),
    worktrees,
  });
}

async function listFreshProjectWorktrees(
  projectPath: string,
  projectId?: number,
  options?: GitCommandOptions,
): Promise<RpcWorktree[]> {
  return (
    await listFreshProjectWorktreeListing(projectPath, projectId, options)
  ).worktrees;
}
/**
 * Finds known project worktree.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 */

function findKnownProjectWorktree(
  projectId: number,
  worktreePath: string,
): RpcWorktree | null {
  const state = projectPollMap.get(projectId);
  if (!state?.worktrees.length) {
    return null;
  }
  return state.worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

function getNow(): string {
  return new Date().toISOString();
}

const SQLITE_LOCK_RETRY_ATTEMPTS = 6;
const SQLITE_LOCK_RETRY_BASE_DELAY_MS = 40;
const SQLITE_LOCK_RETRY_MAX_DELAY_MS = 500;
const SQLITE_LOCK_RETRY_JITTER_MS = 25;

function isSqliteLockError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const typedError = error as { code?: string | number };
  if (typeof typedError.code === "string") {
    if (
      typedError.code === "SQLITE_BUSY" ||
      typedError.code === "SQLITE_LOCKED"
    ) {
      return true;
    }
  }
  if (typeof typedError.code === "number") {
    if (typedError.code === 5 || typedError.code === 6) {
      return true;
    }
  }

  return (
    message.includes("database is locked") ||
    message.includes("database is busy")
  );
}

function computeSqliteRetryDelayMs(attempt: number): number {
  const cappedAttempt = Math.max(1, attempt);
  const exponentialDelay = Math.min(
    SQLITE_LOCK_RETRY_MAX_DELAY_MS,
    SQLITE_LOCK_RETRY_BASE_DELAY_MS * 2 ** (cappedAttempt - 1),
  );
  const jitter = Math.floor(Math.random() * SQLITE_LOCK_RETRY_JITTER_MS);
  return exponentialDelay + jitter;
}

async function waitForNextRetryDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, delayMs);
  });
}

async function withSqliteRetry<T>(action: () => T | Promise<T>): Promise<T> {
  let retryCount = 0;
  let totalBackoffMs = 0;

  for (let attempt = 1; attempt <= SQLITE_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await action();
      if (retryCount > 0) {
        recordSqliteRetryLoop({
          exhausted: false,
          retryCount,
          totalBackoffMs,
        });
      }
      return result;
    } catch (error) {
      if (!isSqliteLockError(error)) {
        throw error;
      }
      if (attempt === SQLITE_LOCK_RETRY_ATTEMPTS) {
        recordSqliteRetryLoop({
          exhausted: true,
          retryCount,
          totalBackoffMs,
        });
        throw error;
      }

      retryCount += 1;
      const delayMs = computeSqliteRetryDelayMs(attempt);
      totalBackoffMs += delayMs;
      await waitForNextRetryDelay(delayMs);
    }
  }

  throw new Error("SQLite retry loop exhausted.");
}

function runImmediateSqliteTransaction<T>(action: () => T): T {
  db.run("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.run("COMMIT");
    return result;
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {
      // Ignore rollback failures after transactional contention.
    }
    throw error;
  }
}
/**
 * Performs refreshProjectPoll operation.
 * @param projectId - Project identifier.
 * @param options - Configuration options used by this operation.
 */

async function refreshProjectPoll(
  projectId: number,
  options?: GitCommandOptions,
): Promise<void> {
  const state = projectPollMap.get(projectId);
  if (!state) return;

  const worktrees = await listFreshProjectWorktrees(
    state.projectPath,
    state.id,
    options,
  );
  projectWorktreeLifecycle.applyRefreshedListingToPollState(
    state,
    worktrees,
    (worktreePath) => stopWorktreePolling(state, worktreePath),
  );
  syncProjectRefreshPolling(state);
}
/**
 * Performs startProjectRefreshPolling operation.
 * @param state - Current state value.
 */

function startProjectRefreshPolling(state: ProjectPollState): void {
  if (state.projectTimer) {
    return;
  }

  state.projectTimer = setInterval(() => {
    refreshProjectPoll(state.id, {
      priority: "background",
    }).catch((error) => {
      logBackgroundGitFailure(
        `Worktree polling failed for project ${state.id}`,
        error,
      );
    });
  }, PROJECT_POLL_INTERVAL_MS);
}
/**
 * Performs stopProjectRefreshPolling operation.
 * @param state - Current state value.
 */

function stopProjectRefreshPolling(state: ProjectPollState): void {
  if (!state.projectTimer) {
    return;
  }

  clearInterval(state.projectTimer);
  state.projectTimer = null;
}
/**
 * Performs syncProjectRefreshPolling operation.
 * @param state - Current state value.
 */

function syncProjectRefreshPolling(state: ProjectPollState): void {
  if (hasForegroundReadPressure()) {
    stopProjectRefreshPolling(state);
    return;
  }

  if (state.activeWorktreePath !== null) {
    startProjectRefreshPolling(state);
    return;
  }

  stopProjectRefreshPolling(state);
}
/**
 * Performs ensureProjectPoller operation.
 * @param project - Project descriptor used to ensure polling is configured.
 */

function ensureProjectPoller(project: ProjectRecord): ProjectPollState {
  let state = projectPollMap.get(project.id);
  if (!state) {
    state = projectWorktreeLifecycle.createPollState(project);
    projectPollMap.set(project.id, state);
  }

  projectWorktreeLifecycle.updatePollStateProject(state, project);
  syncProjectRefreshPolling(state);

  return state;
}
/**
 * Performs stopWorktreePolling operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 */

function stopWorktreePolling(
  state: ProjectPollState,
  worktreePath: string,
): void {
  projectWorktreeLifecycle.stopWorktreePolling(
    state,
    worktreePath,
    abortGitHistoryPrefetch,
  );
}
/**
 * Performs ensureWorktreePollState operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 */

function ensureWorktreePollState(
  state: ProjectPollState,
  worktreePath: string,
): WorktreePollState {
  return projectWorktreeLifecycle.ensureWorktreePollState(
    state,
    worktreePath,
    getNow(),
  );
}
/**
 * Performs stopWorktreeBackgroundPolling operation.
 * @param worktreeState - Worktree state object to stop polling for.
 * @param reason - Reason for this operation.
 */

function stopWorktreeBackgroundPolling(
  worktreeState: WorktreePollState,
  reason: string,
): void {
  projectWorktreeLifecycle.stopWorktreeBackgroundPolling(
    worktreeState,
    reason,
    abortGitHistoryPrefetch,
  );
}
/**
 * Performs startWorktreeGitHistoryPolling operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 */

function startWorktreeGitHistoryPolling(
  state: ProjectPollState,
  worktreePath: string,
): WorktreePollState {
  return projectWorktreeLifecycle.startGitHistoryPolling(state, worktreePath, {
    abortGitHistoryPrefetch,
    logBackgroundGitFailure,
    publishEvent: (event) => {
      workContextEvents.publish(publishLifecycleEvent, event);
    },
    pollIntervalMs: GIT_HISTORY_POLL_INTERVAL_MS,
    readGitHistorySummary,
  });
}
/**
 * Performs syncProjectWorktreeBackgroundPolling operation.
 * @param state - Current state value.
 */

function syncProjectWorktreeBackgroundPolling(state: ProjectPollState): void {
  projectWorktreeLifecycle.syncBackgroundPolling(state, {
    hasForegroundReadPressure: hasForegroundReadPressure(),
    startGitHistoryPolling: startWorktreeGitHistoryPolling,
    stopWorktreeBackgroundPolling,
  });
}
/**
 * Performs stopProjectPoller operation.
 * @param projectId - Project identifier.
 */

function stopProjectPoller(projectId: number): void {
  const state = projectPollMap.get(projectId);
  if (!state) return;
  if (state.projectTimer) {
    clearInterval(state.projectTimer);
  }
  for (const wtPath of state.openWorktrees.keys()) {
    stopWorktreePolling(state, wtPath);
  }
  projectPollMap.delete(projectId);
}
/**
 * Performs projectByIdForPath operation.
 * @param projectId - Project identifier.
 */

function projectByIdForPath(
  projectId: number,
  context?: RpcRequestContext,
): ProjectRecord {
  const userId = localOperatorUserId(context);
  if (hasUnresolvedRegularUserContext(context) && typeof userId !== "number") {
    throw new Error(`Project not currently tracked: ${projectId}`);
  }

  const project = getProjectById(db, projectId);
  if (!project || !projectIsVisibleToContext(project, context)) {
    throw new Error(`Project not currently tracked: ${projectId}`);
  }
  return project;
}

function cronJobById(
  cronJobId: number,
  context?: RpcRequestContext,
  options?: {
    includeNextRunDate?: boolean;
  },
): CronJobRecord | null {
  const userId = localOperatorUserId(context);
  if (hasUnresolvedRegularUserContext(context) && typeof userId !== "number") {
    return null;
  }

  const cronJob = cronStore.getById(cronJobId, options);
  if (cronJob) {
    const project = projectByIdForPath(cronJob.projectId, context);
    if (
      context &&
      !localOperatorCanManageApp(context) &&
      !cronJobWorktreeIsVisible(cronJob, project, context)
    ) {
      return null;
    }
  }
  return cronJob;
}
/**
 * Finds project worktree.
 * @param project - Project to locate an associated worktree for.
 * @param worktreePath - Worktree path.
 * @param options - Configuration options used by this operation.
 */

async function findProjectWorktree(
  project: ProjectRecord,
  worktreePath: string,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree | null> {
  const readFromListing = (
    listing: ProjectWorktreeListing,
  ): RpcWorktree | null =>
    listing.worktrees.find((entry) => entry.path === worktreePath) ??
    listing.hiddenWorktrees.find((entry) => entry.path === worktreePath) ??
    null;

  if (options?.forceRefresh || options?.includeHidden === true) {
    return readFromListing(
      await readProjectWorktreeListing(project.path, project.id, {
        ...options,
        includeHidden: true,
      }),
    );
  }

  // Hit the cached visible listing first so user-triggered thread/cron flows do
  // not stall behind a full hidden-worktree refresh on the common path.
  const visibleListing = await readProjectWorktreeListing(
    project.path,
    project.id,
    {
      ...options,
      includeHidden: false,
    },
  );
  const visibleWorktree =
    visibleListing.worktrees.find((entry) => entry.path === worktreePath) ??
    null;
  if (visibleWorktree) {
    return visibleWorktree;
  }

  return readFromListing(
    await readProjectWorktreeListing(project.path, project.id, {
      ...options,
      forceRefresh: true,
      includeHidden: true,
    }),
  );
}
/**
 * Performs assertProjectWorktree operation.
 * @param project - Project expected to have a tracked worktree.
 * @param worktreePath - Worktree path.
 * @param options - Configuration options used by this operation.
 */

async function assertProjectWorktree(
  project: ProjectRecord,
  worktreePath: string,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree> {
  const worktree = await findProjectWorktree(project, worktreePath, options);
  if (!worktree) {
    const scope = workspacePathScopeForProject(project);
    throw new Error(
      `Worktree not found for project ${formatWorkspacePathForUser(project.path, scope)}: ${formatWorkspacePathForUser(worktreePath, scope)}`,
    );
  }
  return worktree;
}

async function assertProjectWorkspacePath(
  project: ProjectRecord,
  worktreePath: string,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree | null> {
  // A null return is the accepted project-root fallback: callers only need a
  // concrete RpcWorktree when git exposes a tracked worktree row. The root path
  // is still valid even if a non-git project or stale git listing cannot supply
  // one, and downstream title building handles the null worktree explicitly.
  const worktree = await findProjectWorktree(project, worktreePath, options);
  if (worktree) {
    return worktree;
  }

  if (resolve(worktreePath) === resolve(project.path)) {
    return null;
  }

  const scope = workspacePathScopeForProject(project);
  throw new Error(
    `Worktree not found for project ${formatWorkspacePathForUser(project.path, scope)}: ${formatWorkspacePathForUser(worktreePath, scope)}`,
  );
}
/**
 * Performs trackedProjectWorktree operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 */

function trackedProjectWorktree(
  state: ProjectPollState,
  worktreePath: string,
): RpcWorktree | null {
  return projectWorktreeLifecycle.trackedWorktree(state, worktreePath);
}
/**
 * Performs ensureTrackedProjectWorktree operation.
 * @param project - Project metadata used to manage tracked worktrees.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 * @param options - Configuration options used by this operation.
 */

async function ensureTrackedProjectWorktree(
  project: ProjectRecord,
  state: ProjectPollState,
  worktreePath: string,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree> {
  const known = trackedProjectWorktree(state, worktreePath);
  if (known && !options?.forceRefresh) {
    return known;
  }

  await awaitAbortableResult(
    refreshProjectPoll(project.id, options),
    options?.signal ?? null,
    "Project worktree read was aborted.",
  );
  const refreshed = trackedProjectWorktree(state, worktreePath);
  if (refreshed) {
    return refreshed;
  }

  const scope = workspacePathScopeForProject(project);
  throw new Error(
    `Worktree not found for project ${formatWorkspacePathForUser(project.path, scope)}: ${formatWorkspacePathForUser(worktreePath, scope)}`,
  );
}
/**
 * Persists a thread row after lifecycle-owned workspace validation.
 */

async function createThreadRecord(input: {
  access: ThreadAccessControls;
  cronJobId: number | null;
  model: string;
  project: ProjectRecord;
  reasoningEffort: RpcReasoningEffort;
  worktree: RpcWorktree | null;
  worktreePath: string;
}): Promise<ThreadRecord> {
  const {
    access,
    cronJobId,
    model,
    project,
    reasoningEffort,
    worktree,
    worktreePath,
  } = input;

  if (cronJobId !== null) {
    const cronJob = cronStore.getById(cronJobId, {
      includeNextRunDate: false,
    });
    if (!cronJob) {
      throw new Error(`Cron job not found: ${cronJobId}`);
    }
    if (
      cronJob.projectId !== project.id ||
      cronJob.worktreePath !== worktreePath
    ) {
      throw new Error(
        `Cron job ${cronJobId} does not belong to project ${project.id} and worktree ${worktreePath}.`,
      );
    }
  }

  const thread = await withSqliteRetry(() =>
    threadStore.create({
      projectId: project.id,
      worktreePath,
      cronJobId,
      title: buildThreadTitle(worktree, worktreePath),
      model,
      reasoningEffort,
      webSearchAccess: access.webSearchAccess,
      githubAccess: access.githubAccess,
      gitAccess: access.gitAccess,
      sqliteAccess: access.sqliteAccess,
      webServerAccess: access.webServerAccess,
      agentsAccess: access.agentsAccess,
      calendarAccess: access.calendarAccess,
      notificationsAccess: access.notificationsAccess,
      weatherAccess: access.weatherAccess,
      threadsAccess: access.threadsAccess,
      cronsAccess: access.cronsAccess,
      metidosAccess: access.metidosAccess,
      pluginAccessGroups: access.pluginAccessGroups,
      permissions: access.permissions,
      unsafeMode: access.unsafeMode,
      piSessionId: null,
      piSessionFile: null,
      piLeafEntryId: null,
    }),
  );
  if (access.unsafeMode) {
    recordUnsafeModeAuditEvent(thread, true, "thread_create");
  }
  return thread;
}
/**
 * Performs recordUnsafeModeAuditEvent operation.
 * @param thread - Thread tied to the unsafe-mode audit event.
 * @param unsafeMode - Unsafe-mode value being audited.
 * @param source - Event source that triggered the audit entry.
 */

function recordUnsafeModeAuditEvent(
  thread: ThreadRecord,
  unsafeMode: boolean,
  source: "thread_create" | "toggle",
): void {
  createSecurityAuditEvent(db, {
    eventType: unsafeMode ? "unsafe_mode_enabled" : "unsafe_mode_disabled",
    summaryText: unsafeMode
      ? "Unsafe mode enabled. Bash access and unsafe child thread or cron creation are allowed for this thread."
      : "Unsafe mode disabled. Bash access and unsafe child thread or cron creation are blocked for this thread.",
    threadId: thread.id,
    projectId: thread.projectId,
    worktreePath: thread.worktreePath,
    payloadJson: JSON.stringify({
      source,
      unsafeMode,
    }),
  });
}
/**
 * Opens project procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function openProjectProcedure(
  params: AppRPCSchema["requests"]["openProject"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const opened = await awaitAbortableResult(
      openProjectWithGitOptions(params, requestGitOptions, context),
      context?.signal,
      "Project open was aborted.",
    );
    throwIfAborted(context?.signal, "Project open was aborted.");
    return opened;
  });
}
/**
 * Opens project with git options.
 * @param params - Parameters object.
 * @param requestGitOptions - Git-specific options requested for project opening.
 */

async function openProjectWithGitOptions(
  params: AppRPCSchema["requests"]["openProject"]["params"],
  requestGitOptions?: GitCommandOptions,
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  const workspaceScope = workspacePathScopeForContext(context);
  const projectPath = normalizeRequestedWorkspacePath(
    params.projectPath,
    context,
  );
  assertWorkspacePathAllowed(projectPath, workspaceScope);
  ensureProjectDirectory(
    projectPath,
    workspaceScope,
    params.createIfMissing === true,
  );
  const existingProject = getProject(db, projectPath);

  let hasInitializedGit = false;
  try {
    const listedWorktrees = await listGitWorktreesForProjectPath(
      projectPath,
      requestGitOptions,
    );
    hasInitializedGit =
      projectWorktreeLifecycle.reconcilePrimaryWorktreePath(
        projectPath,
        listedWorktrees,
      ).length > 0;
  } catch (error) {
    if (!projectWorktreeLifecycle.isGitWorkspaceUnavailableError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Project folder must be a git repository root or worktree: ${formatWorkspacePathForUser(projectPath, workspaceScope)}${message ? ` (${message})` : ""}`,
      );
    }
  }

  if (!hasInitializedGit && params.initGitIfNeeded === true) {
    await runGitCommand(projectPath, ["init"], requestGitOptions);
    hasInitializedGit = true;
  }

  if (params.pinWorktree === true && existingProject) {
    ensureProjectWorktreePinned(db, existingProject.id, projectPath);
  }

  let worktrees: RpcWorktree[] = [];
  if (existingProject && hasInitializedGit) {
    worktrees = await readProjectWorktrees(projectPath, existingProject.id, {
      ...requestGitOptions,
      forceRefresh: true,
    });
  }

  const project = upsertProject(db, {
    projectPath,
    name: params.name ?? basename(projectPath),
  });
  if (params.pinWorktree === true && !existingProject) {
    ensureProjectWorktreePinned(db, project.id, projectPath);
  }
  if (!existingProject && hasInitializedGit) {
    worktrees = await readProjectWorktrees(projectPath, project.id, {
      ...requestGitOptions,
      forceRefresh: true,
    });
  }
  if (worktrees.length === 0) {
    const pinnedAt =
      listProjectWorktreesMetadata(db, project.id).find(
        (record) => record.worktreePath === projectPath,
      )?.pinnedAt ?? null;
    worktrees = projectWorktreeLifecycle.hydrateOpenProjectWorktrees({
      projectPath,
      rootPinnedAt: pinnedAt,
      worktrees,
    });
  }
  const state = ensureProjectPoller(project);
  state.worktrees = worktrees;
  state.worktreesLoadedAt = Date.now();

  return {
    hiddenWorktrees: [],
    project,
    worktrees: state.worktrees,
  };
}
/**
 * Opens projects batch procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function openProjectsBatchProcedure(
  params: AppRPCSchema["requests"]["openProjectsBatch"]["params"],
  context?: RpcRequestContext,
): Promise<RpcOpenProjectsBatchResultItem[]> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    return mapWithAbortableConcurrency(
      params.projects,
      context?.signal,
      "Project restore was aborted.",
      async (project) => {
        throwIfAborted(context?.signal, "Project restore was aborted.");
        try {
          const opened = await awaitAbortableResult(
            openProjectWithGitOptions(project, requestGitOptions, context),
            context?.signal,
            "Project restore was aborted.",
          );
          return {
            ok: true,
            projectId: project.projectId,
            project: opened.project,
            worktrees: opened.worktrees,
          } satisfies RpcOpenProjectsBatchResultItem;
        } catch (error) {
          return {
            ok: false,
            projectId: project.projectId,
            error: error instanceof Error ? error.message : String(error),
          } satisfies RpcOpenProjectsBatchResultItem;
        }
      },
    );
  });
}
/**
 * Lists project worktrees procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function listProjectWorktreesProcedure(
  params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    ensureProjectPoller(project);
    const listing = await awaitAbortableResult(
      readProjectWorktreeListing(project.path, project.id, {
        ...requestGitOptions,
        ...(params.includeHidden === true ? { includeHidden: true } : {}),
      }),
      context?.signal,
      "Project worktree read was aborted.",
    );

    return {
      hiddenWorktrees: listing.hiddenWorktrees,
      project,
      worktrees: listing.worktrees,
    };
  });
}
/**
 * Creates worktree procedure.
 * @param params - Parameters object.
 */

export async function createWorktreeProcedure(
  params: AppRPCSchema["requests"]["createWorktree"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCreateWorktreeResult> {
  const project = projectByIdForPath(params.projectId, context);
  const projectScope = workspacePathScopeForProject(project);
  const worktreeName = normalizeWorkspaceFolderName(params.name);
  return projectWorktreeLifecycle.createWorktree({
    assertWorktreePathAllowed: (worktreePath) =>
      assertWorkspacePathAllowed(worktreePath, projectScope),
    ensureVisible: (worktreePath) =>
      ensureProjectWorktreeVisible(db, project.id, worktreePath),
    formatWorktreePathForError: (worktreePath) =>
      formatWorkspacePathForUser(worktreePath, projectScope),
    project,
    readListing: () =>
      readProjectWorktreeListing(project.path, project.id, {
        forceRefresh: true,
      }),
    runGitWorktreeAdd: async (worktreePath) => {
      await runGitCommand(project.path, [
        "worktree",
        "add",
        "-b",
        worktreeName,
        worktreePath,
      ]);
    },
    setPinned: (worktreePath, pinned) =>
      setProjectWorktreePinned(db, project.id, worktreePath, pinned),
    worktreeName,
    workspaceRoot: workspaceWorktreeRootForProject(project),
  });
}
function ensureProjectWorktreePinned(
  database: Database,
  projectId: number,
  worktreePath: string,
): void {
  const existingPinnedAt = listProjectWorktreesMetadata(
    database,
    projectId,
  ).find((record) => record.worktreePath === worktreePath)?.pinnedAt;
  if (existingPinnedAt) {
    return;
  }
  setProjectWorktreePinned(database, projectId, worktreePath, true);
}

/**
 * Sets worktree pinned procedure.
 * @param params - Parameters object.
 */

export async function setWorktreePinnedProcedure(
  params: AppRPCSchema["requests"]["setWorktreePinned"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  const project = projectByIdForPath(params.projectId, context);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  if (params.pinned) {
    await assertProjectWorktree(project, worktreePath, {
      forceRefresh: true,
    });
  }

  setProjectWorktreePinned(db, project.id, worktreePath, params.pinned);

  const state = ensureProjectPoller(project);
  const worktrees = await listFreshProjectWorktrees(project.path, project.id);
  state.worktrees = worktrees;
  state.worktreesLoadedAt = Date.now();

  return {
    hiddenWorktrees: [],
    project,
    worktrees,
  };
}
/**
 * Creates thread procedure.
 * @param params - Parameters object.
 */

function requireTerminalAdminContext(context?: RpcRequestContext): void {
  requireManageApp(context);
}

export async function listTerminalsProcedure(
  _params: AppRPCSchema["requests"]["listTerminals"]["params"],
  context?: RpcRequestContext,
): Promise<RpcTerminal[]> {
  requireTerminalAdminContext(context);
  return terminalManager.listTerminals();
}

export async function createTerminalProcedure(
  params: AppRPCSchema["requests"]["createTerminal"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["createTerminal"]["response"]> {
  requireTerminalAdminContext(context);
  const project = projectByIdForPath(params.projectId, context);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });
  const settings = getPersistedTerminalSettings(db);
  const terminal = terminalManager.createTerminal({
    ...params,
    ownerSessionId: context?.auth.sessionId ?? null,
    projectName: project.name,
    settings,
    worktreePath,
  });
  return {
    terminal,
    connection: terminalManager.terminalConnectionInfo(terminal.terminalId),
  };
}

export async function renameTerminalProcedure(
  params: AppRPCSchema["requests"]["renameTerminal"]["params"],
  context?: RpcRequestContext,
): Promise<RpcTerminal> {
  requireTerminalAdminContext(context);
  return terminalManager.renameTerminal(params.terminalId, params.title);
}

export async function closeTerminalProcedure(
  params: AppRPCSchema["requests"]["closeTerminal"]["params"],
  context?: RpcRequestContext,
): Promise<RpcTerminal> {
  requireTerminalAdminContext(context);
  return terminalManager.closeTerminal(params.terminalId);
}

export async function getTerminalSettingsProcedure(
  _params: AppRPCSchema["requests"]["getTerminalSettings"]["params"],
  context?: RpcRequestContext,
): Promise<RpcTerminalSettings> {
  requireTerminalAdminContext(context);
  return getPersistedTerminalSettings(db);
}

export async function getTimezoneSettingsProcedure(
  _params: AppRPCSchema["requests"]["getTimezoneSettings"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getTimezoneSettings"]["response"]> {
  requireLocalOperatorCapability(context, "authenticated");
  return readLocalTimezoneSettings(db);
}

export async function getUserRuntimeSettingsProcedure(
  _params: AppRPCSchema["requests"]["getUserRuntimeSettings"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getUserRuntimeSettings"]["response"]> {
  requireLocalOperatorCapability(context, "authenticated");
  return readLocalRuntimeSettings(db);
}

export async function updateTimezoneSettingsProcedure(
  params: AppRPCSchema["requests"]["updateTimezoneSettings"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["updateTimezoneSettings"]["response"]> {
  requireLocalOperatorCapability(context, "authenticated");
  return updateLocalTimezoneSettings(db, params);
}

export async function updateUserRuntimeSettingsProcedure(
  params: AppRPCSchema["requests"]["updateUserRuntimeSettings"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["updateUserRuntimeSettings"]["response"]> {
  requireLocalOperatorCapability(context, "authenticated");
  return updateLocalRuntimeSettings(db, params);
}

export async function updateTerminalSettingsProcedure(
  params: AppRPCSchema["requests"]["updateTerminalSettings"]["params"],
  context?: RpcRequestContext,
): Promise<RpcTerminalSettings> {
  requireTerminalAdminContext(context);
  return updatePersistedTerminalSettings(db, params);
}

export async function createThreadProcedure(
  params: AppRPCSchema["requests"]["createThread"]["params"],
  context?: RpcRequestContext,
  options?: {
    allowPreauthorizedUnsafeMode?: boolean;
    cronJobId?: number | null;
  },
): Promise<RpcThreadDetail> {
  const project = projectByIdForPath(params.projectId, context);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  const model = resolveRunnableCodexModel(params.model);
  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  const access = await resolveThreadAccessControlsForRequest(
    params,
    context,
    options,
  );
  return threadLifecycle.createThread({
    access,
    assertProjectWorkspacePath,
    createThreadRecord,
    cronJobId: options?.cronJobId ?? null,
    model,
    project,
    readDetail: readThreadDetailCached,
    reasoningEffort,
    recordCrossWorkspaceAuditEvent: (thread) => {
      recordCrossWorkspaceThreadAuditEvent(db, {
        params,
        thread,
      });
    },
    worktreePath,
  });
}

function assertThreadStartRequestApprovalAllowed(
  ownerUserId: number | null,
  context?: RpcRequestContext,
): void {
  if (
    !context ||
    localOperatorCanManageApp(context) ||
    ownerUserId === null ||
    localOperatorUserId(context) === ownerUserId
  ) {
    return;
  }

  throw new Error(
    "You can only approve thread-start requests for your own account.",
  );
}
/**
 * Performs requestThreadStartProcedure operation.
 * @param params - Parameters object.
 */

export async function requestThreadStartProcedure(
  params: AppRPCSchema["requests"]["requestThreadStart"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadStartRequest> {
  const project = projectByIdForPath(params.projectId, context);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  const input = params.input.trim();
  if (!input) {
    throw new Error("Thread input is required.");
  }

  await assertProjectWorkspacePath(project, worktreePath);
  const access = await resolveThreadAccessControlsForRequest(params, context, {
    allowPreauthorizedUnsafeMode: true,
  });

  const request = {
    requestId: crypto.randomUUID(),
    projectId: project.id,
    projectPath: project.path,
    worktreePath,
    input,
    model: params.model?.trim()
      ? resolveRunnableCodexModel(params.model)
      : null,
    reasoningEffort: params.reasoningEffort?.trim()
      ? resolveCodexReasoningEffort(params.reasoningEffort)
      : null,
    webSearchAccess: access.webSearchAccess,
    githubAccess: access.githubAccess,
    gitAccess: access.gitAccess,
    sqliteAccess: access.sqliteAccess,
    webServerAccess: access.webServerAccess,
    agentsAccess: access.agentsAccess,
    calendarAccess: access.calendarAccess,
    notificationsAccess: access.notificationsAccess,
    weatherAccess: access.weatherAccess,
    threadsAccess: access.threadsAccess,
    cronsAccess: access.cronsAccess,
    metidosAccess: access.metidosAccess,
    pluginAccessGroups: access.pluginAccessGroups,
    permissions: params.permissions ?? null,
    unsafeMode: access.unsafeMode,
    autoStart: params.autoStart ?? null,
    threadId: null,
    title: null,
    summary: null,
    pinned: null,
    pinnedAt: null,
    createdAt: new Date().toISOString(),
  } satisfies RpcThreadStartRequest;
  const ownerUserId = getLocalOperatorProfile(context).userId;
  pendingThreadStartRequests.set(request.requestId, {
    ownerUserId,
    request,
  });
  workContextEvents.publish(
    publishLifecycleEvent,
    workContextEvents.threadStartRequestCreated(request),
  );
  return request;
}
/**
 * Performs approveThreadStartRequestProcedure operation.
 * @param params - Parameters object.
 */

export async function approveThreadStartRequestProcedure(
  params: AppRPCSchema["requests"]["approveThreadStartRequest"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const requestId = params.requestId.trim();
  if (!requestId) {
    throw new Error("Thread start request id is required.");
  }

  const pending = pendingThreadStartRequests.get(requestId);
  if (!pending) {
    throw new Error("Thread start request not found or already handled.");
  }

  assertThreadStartRequestApprovalAllowed(pending.ownerUserId, context);
  if (pending.request.unsafeMode === true) {
    requireManageApp(context);
  }
  pendingThreadStartRequests.delete(requestId);
  let detail: RpcThreadDetail | null = null;

  try {
    detail = await createThreadProcedure(
      {
        model: pending.request.model,
        permissions: pending.request.permissions ?? null,
        projectId: pending.request.projectId,
        reasoningEffort: pending.request.reasoningEffort,
        worktreePath: pending.request.worktreePath,
      },
      context,
      {
        allowPreauthorizedUnsafeMode: pending.request.unsafeMode === true,
      },
    );
    const startedDetail =
      pending.request.autoStart === true && pending.request.input.trim()
        ? await sendThreadMessageProcedure(
            {
              input: pending.request.input,
              threadId: detail.thread.id,
            },
            context,
          )
        : detail;
    workContextEvents.publish(
      publishLifecycleEvent,
      workContextEvents.threadStartRequestResolved({
        requestId,
      }),
    );
    return startedDetail;
  } catch (error) {
    if (!detail) {
      pendingThreadStartRequests.set(requestId, pending);
    } else {
      workContextEvents.publish(
        publishLifecycleEvent,
        workContextEvents.threadStartRequestResolved({
          requestId,
        }),
      );
    }
    throw error;
  }
}

const MAX_CRON_TITLE_LENGTH = 72;
const MAX_CRON_DESCRIPTION_LENGTH = 240;
const MAX_CRON_PROMPT_LENGTH = 64 * 1024;
const MAX_CRON_SCHEDULE_LENGTH = 256;
const MAX_CRON_HANDLES_PER_JOB = 8;
const MAX_CRON_JOBS = 512;
const MAX_ACTIVE_CRON_JOBS = 256;

function buildCronJobDefaultTitle(
  schedule: string,
  prompt: string | null | undefined,
): string {
  const trimmedPrompt = (prompt ?? "").trim();
  const firstLine = trimmedPrompt.split("\n", 1)[0] ?? "";
  const firstLineTrimmed = firstLine.trim();
  const titleBase = firstLineTrimmed
    ? firstLineTrimmed
    : `Cron schedule ${schedule}`;
  const cleaned = titleBase.replace(/\s+/g, " ").trim();
  return cleaned.length <= MAX_CRON_TITLE_LENGTH
    ? cleaned
    : `${cleaned.slice(0, MAX_CRON_TITLE_LENGTH - 3)}...`;
}

function buildCronJobDefaultDescription(
  schedule: string,
  prompt: string | null | undefined,
): string {
  const descriptionBase = (prompt ?? "").replace(/\s+/g, " ").trim();
  const withSchedule = `Schedule ${schedule}: ${descriptionBase}`;
  return withSchedule.length <= MAX_CRON_DESCRIPTION_LENGTH
    ? withSchedule
    : `${withSchedule.slice(0, MAX_CRON_DESCRIPTION_LENGTH - 3)}...`;
}

function assertCronFieldLength(
  value: string,
  fieldName: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    throw new Error(`Cron ${fieldName} is limited to ${maxLength} characters.`);
  }
}

function assertCronJobCapacity(input: {
  currentCronJobId?: number;
  enabling: boolean;
}): void {
  const jobs = cronStore.list().filter((job) => job.deletedAt === null);
  if (input.currentCronJobId === undefined && jobs.length >= MAX_CRON_JOBS) {
    throw new Error(`Cron jobs are limited to ${MAX_CRON_JOBS}.`);
  }
  if (!input.enabling) {
    return;
  }
  const activeCount = jobs.filter(
    (job) =>
      job.enabled === 1 &&
      (input.currentCronJobId === undefined ||
        job.id !== input.currentCronJobId),
  ).length;
  if (activeCount >= MAX_ACTIVE_CRON_JOBS) {
    throw new Error(
      `Enabled cron jobs are limited to ${MAX_ACTIVE_CRON_JOBS}.`,
    );
  }
}

function assertCronScheduleIsValid(schedule: string): void {
  assertCronFieldLength(schedule, "schedule", MAX_CRON_SCHEDULE_LENGTH);
  try {
    const schedules = expandCronScheduleForBun(
      schedule,
      getEffectiveLocalTimezone(db),
    );
    if (schedules.length > MAX_CRON_HANDLES_PER_JOB) {
      throw new Error(
        `Cron schedule expands to ${schedules.length} handles; limit is ${MAX_CRON_HANDLES_PER_JOB}.`,
      );
    }
  } catch (error) {
    throw new Error(
      `Invalid cron schedule: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeCronJobForRpc(cronJob: CronJobRecord): RpcCronJob {
  return {
    ...cronJob,
    model: normalizeStoredCodexModel(cronJob.model),
    unsafeMode: cronJob.unsafeMode === 1,
    reasoningEffort: normalizeStoredCodexReasoningEffort(
      cronJob.reasoningEffort,
    ),
  };
}

/**
 * Creates a cron job row tied to a workspace.
 * @param params - Parameters object.
 */

export async function newCronProcedure(
  params: AppRPCSchema["requests"]["newCron"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCronJob> {
  const project = projectByIdForPath(params.projectId, context);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  await assertProjectWorkspacePath(project, worktreePath);
  const prompt = params.prompt.trim();
  const schedule = params.schedule.trim();
  const model = resolveRunnableCodexModel(params.model);
  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  const access = await resolveThreadAccessControlsForRequest(params, context);
  if (!schedule) {
    throw new Error("Cron schedule is required.");
  }
  assertCronScheduleIsValid(schedule);
  if (!prompt) {
    throw new Error("Cron prompt is required.");
  }
  assertCronFieldLength(prompt, "prompt", MAX_CRON_PROMPT_LENGTH);
  const title =
    typeof params.title === "string"
      ? params.title.trim()
      : buildCronJobDefaultTitle(schedule, prompt);
  const description =
    typeof params.description === "string"
      ? params.description.trim()
      : buildCronJobDefaultDescription(schedule, prompt);
  if (typeof params.title === "string" && !title) {
    throw new Error("Cron title is required.");
  }
  if (typeof params.description === "string" && !description) {
    throw new Error("Cron description is required.");
  }
  assertCronFieldLength(title, "title", MAX_CRON_TITLE_LENGTH);
  assertCronFieldLength(
    description,
    "description",
    MAX_CRON_DESCRIPTION_LENGTH,
  );
  assertCronJobCapacity({ enabling: params.enabled !== false });

  const cronJob = cronStore.create({
    projectId: project.id,
    worktreePath,
    schedule,
    prompt,
    webSearchAccess: access.webSearchAccess,
    githubAccess: access.githubAccess,
    gitAccess: access.gitAccess,
    sqliteAccess: access.sqliteAccess,
    webServerAccess: access.webServerAccess,
    agentsAccess: access.agentsAccess,
    calendarAccess: access.calendarAccess,
    notificationsAccess: access.notificationsAccess,
    weatherAccess: access.weatherAccess,
    threadsAccess: access.threadsAccess,
    cronsAccess: access.cronsAccess,
    metidosAccess: access.metidosAccess,
    pluginAccessGroups: access.pluginAccessGroups,
    permissions: params.permissions ?? null,
    unsafeMode: access.unsafeMode,
    title,
    description,
    model,
    reasoningEffort,
    enabled: params.enabled ?? null,
  });
  workContextEvents.publish(
    publishLifecycleEvent,
    workContextEvents.cronListChanged(),
  );
  return normalizeCronJobForRpc(cronJob);
}

/**
 * Updates an existing cron job.
 * @param params - Parameters object.
 */

export async function updateCronProcedure(
  params: AppRPCSchema["requests"]["updateCron"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCronJob> {
  const current = cronJobById(params.cronJobId, context);
  if (!current) {
    throw new Error(`Cron job not found: ${params.cronJobId}`);
  }

  if (typeof params.deleted === "boolean" && params.deleted) {
    if (current.deletedAt === null) {
      cronStore.softDelete(current.id);
      const cronJob = cronJobById(current.id, context) ?? current;
      workContextEvents.publish(
        publishLifecycleEvent,
        workContextEvents.cronListChanged(),
      );
      return normalizeCronJobForRpc(cronJob);
    }
    return normalizeCronJobForRpc(current);
  }

  if (current.deletedAt !== null) {
    throw new Error("Deleted cron jobs cannot be modified.");
  }

  if (params.deleted === false) {
    throw new Error("Cannot undelete cron jobs.");
  }

  const updates: {
    projectId?: number;
    worktreePath?: string;
    schedule?: string;
    prompt?: string;
    title?: string;
    description?: string;
    model?: string;
    reasoningEffort?: string;
    permissions?: string[];
    enabled?: boolean;
  } = {};

  if (
    typeof params.projectId !== "undefined" ||
    typeof params.worktreePath !== "undefined"
  ) {
    const projectId = params.projectId ?? current.projectId;
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath ?? current.worktreePath,
      context,
    );
    const project = projectByIdForPath(projectId, context);
    await assertProjectWorkspacePath(project, worktreePath);
    updates.projectId = project.id;
    updates.worktreePath = worktreePath;
  }

  if (typeof params.model !== "undefined") {
    updates.model = resolveRunnableCodexModel(params.model);
  }

  if (typeof params.reasoningEffort !== "undefined") {
    updates.reasoningEffort = resolveCodexReasoningEffort(
      params.reasoningEffort,
    );
  }

  if (Array.isArray(params.permissions)) {
    updates.permissions = normalizeExplicitThreadPermissionStrings(
      params.permissions,
      await createThreadPermissionRegistryForRequest(),
    );
    if (updates.permissions.includes("metidos:unsafe")) {
      requireUnsafeModeAllowed(context);
    }
  }

  if (typeof params.schedule !== "undefined") {
    const schedule = params.schedule.trim();
    if (!schedule) {
      throw new Error("Cron schedule is required.");
    }
    assertCronScheduleIsValid(schedule);
    updates.schedule = schedule;
  }

  if (typeof params.prompt !== "undefined") {
    const prompt = params.prompt.trim();
    if (!prompt) {
      throw new Error("Cron prompt is required.");
    }
    assertCronFieldLength(prompt, "prompt", MAX_CRON_PROMPT_LENGTH);
    updates.prompt = prompt;
  }

  if (typeof params.title !== "undefined") {
    const title = params.title.trim();
    if (!title) {
      throw new Error("Cron title is required.");
    }
    assertCronFieldLength(title, "title", MAX_CRON_TITLE_LENGTH);
    updates.title = title;
  }

  if (typeof params.description !== "undefined") {
    const description = params.description.trim();
    if (!description) {
      throw new Error("Cron description is required.");
    }
    assertCronFieldLength(
      description,
      "description",
      MAX_CRON_DESCRIPTION_LENGTH,
    );
    updates.description = description;
  }

  if (typeof params.enabled === "boolean") {
    updates.enabled = params.enabled;
  }

  if (
    typeof updates.projectId === "undefined" &&
    typeof updates.worktreePath === "undefined" &&
    typeof updates.schedule === "undefined" &&
    typeof updates.prompt === "undefined" &&
    typeof updates.title === "undefined" &&
    typeof updates.description === "undefined" &&
    typeof updates.model === "undefined" &&
    typeof updates.reasoningEffort === "undefined" &&
    typeof updates.permissions === "undefined" &&
    typeof updates.enabled === "undefined"
  ) {
    throw new Error("At least one update field is required.");
  }

  assertCronJobCapacity({
    currentCronJobId: current.id,
    enabling: updates.enabled ?? current.enabled === 1,
  });

  const cronJob = cronStore.update(current.id, updates);
  workContextEvents.publish(
    publishLifecycleEvent,
    workContextEvents.cronListChanged(),
  );
  return normalizeCronJobForRpc(cronJob);
}

/**
 * Triggers a cron job to run immediately.
 */
export async function runCronNowProcedure(
  params: AppRPCSchema["requests"]["runCronNow"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["runCronNow"]["response"]> {
  const cronJob = cronJobById(params.cronJobId, context);
  if (!cronJob) {
    throw new Error(`Cron job not found: ${params.cronJobId}`);
  }

  if (cronJob.deletedAt !== null) {
    throw new Error("Cannot run a deleted cron job.");
  }

  // Manual cron execution is owner-scoped and already bounded by the cron's
  // stored permissions. Step-up is reserved for high-impact local mutations so
  // routine reruns do not require repeated TOTP proof.
  const threadId = await runCronNowInScheduler(cronJob.id);
  if (threadId === null) {
    const currentCronJob = cronJobById(cronJob.id, context, {
      includeNextRunDate: false,
    });
    if (
      currentCronJob?.lastRunStatus === "InProgress" ||
      threadStore.hasActiveForCronJob(cronJob.id)
    ) {
      throw new Error("Cron job is already running.");
    }
    throw new Error("Cron job could not be started at this time.");
  }

  return {
    success: true,
    cronJobId: cronJob.id,
    threadId,
  };
}

/**
 * Lists non-deleted cron jobs.
 * @returns List of all cron jobs where deletedAt is null.
 */
export async function listCronsProcedure(
  _params: AppRPCSchema["requests"]["listCrons"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCronJob[]> {
  return visibleCronJobs(context)
    .filter((cronJob) => cronJob.deletedAt === null)
    .map(normalizeCronJobForRpc);
}
/**
 * Gets thread procedure.
 * @param params - Parameters object.
 */

export async function getThreadProcedure(
  params: AppRPCSchema["requests"]["getThread"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId, context);
  const messageLimit = normalizeThreadDetailMessageLimit(params.messageLimit);
  const includeHeavyContent = params.includeHeavyContent ?? false;
  return threadLifecycle.readDetail({
    buildDetail: buildThreadDetail,
    ...(typeof params.cursor === "number" ? { cursor: params.cursor } : {}),
    expectedThread: applyActiveThreadRuntimeTelemetry(
      toRpcThread(thread, currentThreadRunStatus(thread)),
    ),
    includeHeavyContent,
    messageLimit,
    readCachedDetail: readThreadDetailCached,
    threadId: params.threadId,
  });
}

export async function getThreadMessageContentProcedure(
  params: AppRPCSchema["requests"]["getThreadMessageContent"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadMessage> {
  threadById(params.threadId, context);
  const message = messageActivityStore
    .listMessages(params.threadId)
    .find((candidate) => candidate.id === params.messageId);
  if (!message) {
    throw new Error(`Thread message not found: ${params.messageId}`);
  }
  return toRpcThreadMessage(message, { includeHeavyContent: true });
}
/**
 * Marks thread error seen procedure.
 * @param params - Parameters object.
 */

export async function markThreadErrorSeenProcedure(
  params: AppRPCSchema["requests"]["markThreadErrorSeen"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId, context);
  threadStore.markErrorSeen(thread.id);
  const currentStatus = currentThreadRunStatus(thread);
  setThreadRunStatus(thread.id, {
    ...currentStatus,
    hasUnreadError: false,
  });
  return readThreadDetailCached(thread.id);
}

function normalizeThreadMessageImageAttachments(
  images: AppRPCSchema["requests"]["sendThreadMessage"]["params"]["images"],
): ChatImageAttachment[] {
  if (!images || images.length === 0) {
    return [];
  }
  if (images.length > MAX_CHAT_IMAGE_ATTACHMENTS) {
    throw new Error(
      `A message can include at most ${MAX_CHAT_IMAGE_ATTACHMENTS} images.`,
    );
  }

  return images.map((image, index) => {
    const mimeType = image.mimeType.trim().toLowerCase();
    const data = image.data.trim();
    if (image.type !== "image" || !data) {
      throw new Error(
        `Image ${index + 1} is not a supported image attachment.`,
      );
    }
    const imageTypeResult = normalizeChatImageMimeType(data, mimeType);
    if ("error" in imageTypeResult) {
      throw new Error(
        `Image ${index + 1} is invalid: ${imageTypeResult.error}`,
      );
    }
    if (!isChatImageByteSizeAllowed(estimateBase64ByteLength(data))) {
      throw new Error(`Image ${index + 1} exceeds the 10 MB size limit.`);
    }
    return {
      type: "image",
      data,
      mimeType: imageTypeResult.mimeType,
    };
  });
}

/**
 * Sends thread message procedure.
 * @param params - Parameters object.
 */

export async function sendThreadMessageProcedure(
  params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId, context);
  const images = normalizeThreadMessageImageAttachments(params.images);
  return threadLifecycle.queueTurn({
    images,
    logImageAttachments: (attachments) => {
      logger.info({
        message: "sendThreadMessage received image attachments",
        threadId: params.threadId,
        imageCount: attachments.length,
        images: attachments.map((image) => ({
          base64Length: image.data.length,
          mimeType: image.mimeType,
          type: image.type,
        })),
      });
    },
    modelSupportsImageInput: (model) =>
      resolveCodexModelDescriptor(model).supportsImageInput,
    rawInput: params.input,
    runner: threadTurnRunner,
    sessionId: context?.auth.sessionId ?? null,
    thread,
  });
}
/**
 * Reads and store worktree snapshot.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 * @param options - Configuration options used by this operation.
 */

async function readAndStoreWorktreeSnapshot(
  state: ProjectPollState,
  worktreePath: string,
  options?: GitCommandOptions,
): Promise<RpcWorktreeSnapshot> {
  const worktreeState = ensureWorktreePollState(state, worktreePath);
  if (worktreeState.snapshotRead) {
    return await awaitAbortableResult(
      worktreeState.snapshotRead,
      options?.signal ?? null,
      "Worktree snapshot read was aborted.",
    );
  }

  const snapshotRead = (async (): Promise<RpcWorktreeSnapshot> => {
    const snapshot = await readWorktreeSnapshot(worktreePath, options);
    worktreeState.changes = snapshot.changes;
    worktreeState.diff = snapshot.diff;
    worktreeState.files = snapshot.files;
    worktreeState.lastUpdatedAt = snapshot.lastUpdatedAt;

    return {
      path: worktreePath,
      ...snapshot,
    };
  })();
  worktreeState.snapshotRead = snapshotRead;

  try {
    return await snapshotRead;
  } finally {
    if (worktreeState.snapshotRead === snapshotRead) {
      worktreeState.snapshotRead = null;
    }
  }
}
/**
 * Performs stopThreadTurnProcedure operation.
 * @param params - Parameters object.
 */

export async function stopThreadTurnProcedure(
  params: AppRPCSchema["requests"]["stopThreadTurn"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId, context);
  return threadLifecycle.stopTurn({
    runner: threadTurnRunner,
    thread,
  });
}
/**
 * Performs renameThreadProcedure operation.
 * @param params - Parameters object.
 */

export async function renameThreadProcedure(
  params: AppRPCSchema["requests"]["renameThread"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  return updateThreadMetadataProcedure(
    {
      threadId: params.threadId,
      title: params.title,
      ...(typeof params.summary === "undefined"
        ? {}
        : { summary: params.summary }),
    },
    context,
  );
}
/**
 * Updates thread metadata procedure.
 * @param params - Parameters object.
 */

export async function updateThreadMetadataProcedure(
  params: AppRPCSchema["requests"]["updateThreadMetadata"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  const thread = threadById(params.threadId, context);
  const normalizedPatch = normalizeThreadMetadataPatch(params);
  if (!hasNormalizedThreadMetadataPatch(normalizedPatch)) {
    throw new Error("At least one thread metadata field is required.");
  }

  if (
    typeof normalizedPatch.title !== "undefined" ||
    typeof normalizedPatch.summary !== "undefined"
  ) {
    threadStore.rename(
      thread.id,
      normalizedPatch.title ?? thread.title,
      normalizedPatch.summary,
    );
  }

  if (typeof normalizedPatch.pinned === "boolean") {
    threadStore.setPinned(thread.id, normalizedPatch.pinned);
  }

  invalidateThreadDetailCache(thread.id);
  notifyThreadStatusChanged(thread.id);
  return rpcThreadById(thread.id, context);
}
/**
 * Sets thread pinned procedure.
 * @param params - Parameters object.
 */

export async function setThreadPinnedProcedure(
  params: AppRPCSchema["requests"]["setThreadPinned"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  return updateThreadMetadataProcedure(params, context);
}
/**
 * Updates thread model procedure.
 * @param params - Parameters object.
 */

export async function updateThreadModelProcedure(
  params: AppRPCSchema["requests"]["updateThreadModel"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  const thread = threadById(params.threadId, context);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error("Thread model cannot change while a run is processing.");
  }

  const model = resolveRunnableCodexModel(params.model);
  threadStore.setModel(thread.id, model);
  disposePiThreadRuntime(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id, context);
}
/**
 * Updates thread reasoning effort procedure.
 * @param params - Parameters object.
 */

export async function updateThreadReasoningEffortProcedure(
  params: AppRPCSchema["requests"]["updateThreadReasoningEffort"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  const thread = threadById(params.threadId, context);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error(
      "Thread reasoning effort cannot change while a run is processing.",
    );
  }

  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  threadStore.setReasoningEffort(thread.id, reasoningEffort);
  disposePiThreadRuntime(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id, context);
}
/**
 * Updates thread access controls procedure.
 * @param params - Parameters object.
 */

export async function updateThreadAccessProcedure(
  params: AppRPCSchema["requests"]["updateThreadAccess"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  const thread = threadById(params.threadId, context);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error(
      "Thread access controls cannot change while a run is processing.",
    );
  }

  if (!Array.isArray(params.permissions)) {
    throw new Error(
      "Thread permissions must be supplied as an array of permission strings.",
    );
  }
  const currentAccess = {
    agentsAccess: thread.agentsAccess === true,
    calendarAccess: thread.calendarAccess === true,
    cronsAccess: (thread.cronsAccess ?? thread.metidosAccess) === true,
    gitAccess: thread.gitAccess === true,
    githubAccess: thread.githubAccess === true,
    notificationsAccess: thread.notificationsAccess === true,
    sqliteAccess: thread.sqliteAccess === true,
    threadsAccess: (thread.threadsAccess ?? thread.metidosAccess) === true,
    unsafeMode: thread.unsafeMode === 1,
    weatherAccess: thread.weatherAccess === true,
    webSearchAccess: thread.webSearchAccess === true,
    webServerAccess: thread.webServerAccess === true,
  };
  const next = await resolveThreadAccessControlsForRequest(params, context);
  next.metidosAccess = next.threadsAccess || next.cronsAccess;

  const permissionsUnchanged =
    next.permissions?.length === thread.permissions.length &&
    next.permissions.every(
      (permission, index) => permission === thread.permissions[index],
    );

  if (
    permissionsUnchanged &&
    next.webSearchAccess === currentAccess.webSearchAccess &&
    next.githubAccess === currentAccess.githubAccess &&
    next.gitAccess === currentAccess.gitAccess &&
    next.sqliteAccess === currentAccess.sqliteAccess &&
    next.webServerAccess === currentAccess.webServerAccess &&
    next.agentsAccess === currentAccess.agentsAccess &&
    next.calendarAccess === currentAccess.calendarAccess &&
    next.notificationsAccess === currentAccess.notificationsAccess &&
    next.weatherAccess === currentAccess.weatherAccess &&
    next.threadsAccess === currentAccess.threadsAccess &&
    next.cronsAccess === currentAccess.cronsAccess &&
    next.unsafeMode === currentAccess.unsafeMode
  ) {
    return rpcThreadById(thread.id, context);
  }

  threadStore.setAccess(thread.id, next);
  if (next.unsafeMode !== (thread.unsafeMode === 1)) {
    recordUnsafeModeAuditEvent(thread, next.unsafeMode, "toggle");
  }
  disposePiThreadRuntime(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id, context);
}
/**
 * Updates thread unsafe mode procedure.
 * @param params - Parameters object.
 */

/**
 * Deletes thread procedure.
 * @param params - Parameters object.
 */

export async function deleteThreadProcedure(
  params: AppRPCSchema["requests"]["deleteThread"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["deleteThread"]["response"]> {
  const thread = threadById(params.threadId, context);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error("Thread is currently processing and cannot be deleted.");
  }

  clearThreadRuntimeState(thread.id);
  threadStore.delete(thread.id);
  return {
    success: true,
    threadId: thread.id,
    message: `Deleted thread ${thread.title}`,
  };
}
/**
 * Performs discardEmptyThreadProcedure operation.
 * @param params - Parameters object.
 */

export async function discardEmptyThreadProcedure(
  params: AppRPCSchema["requests"]["discardEmptyThread"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["discardEmptyThread"]["response"]> {
  let thread: ThreadRecord;
  try {
    thread = threadById(params.threadId, context);
  } catch {
    return {
      threadId: params.threadId,
      discarded: false,
    };
  }

  if (currentThreadRunStatus(thread).state === "working") {
    return {
      threadId: params.threadId,
      discarded: false,
    };
  }

  const messages = messageActivityStore.listMessages(thread.id);
  if (thread.lastRunAt !== null || messages.length > 0) {
    return {
      threadId: thread.id,
      discarded: false,
    };
  }

  clearThreadRuntimeState(thread.id);
  threadStore.delete(thread.id);
  return {
    threadId: thread.id,
    discarded: true,
  };
}
/**
 * Opens worktree procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function openWorktreeProcedure(
  params: AppRPCSchema["requests"]["openWorktree"]["params"],
  context?: RpcRequestContext,
): Promise<RpcOpenWorktreeResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    return openWorktreeWithGitOptions(
      params,
      requestGitOptions,
      context?.signal,
      context,
    );
  });
}
/**
 * Opens worktree with git options.
 * @param params - Parameters object.
 * @param requestGitOptions - Git options used when opening a worktree.
 * @param signal - Abort signal for cancellation.
 */

async function openWorktreeWithGitOptions(
  params: AppRPCSchema["requests"]["openWorktree"]["params"],
  requestGitOptions?: GitCommandOptions,
  signal?: AbortSignal,
  context?: RpcRequestContext,
): Promise<RpcOpenWorktreeResult> {
  const project = projectByIdForPath(params.projectId, context);
  const state = ensureProjectPoller(project);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  await assertProjectWorktree(project, worktreePath, {
    ...requestGitOptions,
    includeHidden: true,
    forceRefresh: true,
  });
  if (worktreePath !== project.path) {
    ensureProjectWorktreeVisible(db, project.id, worktreePath);
  }
  const { worktrees } = await readProjectWorktreeListing(
    project.path,
    project.id,
    {
      ...requestGitOptions,
      forceRefresh: true,
    },
  );

  if (!trackedProjectWorktree(state, worktreePath)) {
    const scope = workspacePathScopeForProject(project);
    throw new Error(
      `Worktree not found for project ${formatWorkspacePathForUser(project.path, scope)}: ${formatWorkspacePathForUser(worktreePath, scope)}`,
    );
  }

  return projectWorktreeLifecycle.openWorktree({
    project,
    queueHistoryWarmup: (worktreeState) => {
      queueBackgroundWorkWhenIdle(
        `git-history-warm:${project.id}:${worktreePath}`,
        () => {
          warmGitHistoryCache(
            worktreeState,
            worktreePath,
            logBackgroundGitFailure,
          );
        },
      );
    },
    readAndStoreSnapshot: () =>
      readAndStoreWorktreeSnapshot(state, worktreePath, requestGitOptions),
    readGitHistoryFirstPage: () =>
      readGitHistoryFirstPage(
        project.id,
        worktreePath,
        DEFAULT_GIT_HISTORY_PAGE_SIZE,
        requestGitOptions,
      ),
    runWorktreeOpenLimited: (callback) =>
      runWorktreeOpenLimited(callback, signal),
    state,
    syncBackgroundPolling: () => syncProjectWorktreeBackgroundPolling(state),
    worktreePath,
    worktrees,
  });
}
/**
 * Opens worktrees batch procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function openWorktreesBatchProcedure(
  params: AppRPCSchema["requests"]["openWorktreesBatch"]["params"],
  context?: RpcRequestContext,
): Promise<RpcOpenWorktreesBatchResultItem[]> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    return mapWithAbortableConcurrency(
      params.worktrees,
      context?.signal,
      "Worktree restore was aborted.",
      async (worktree) => {
        throwIfAborted(context?.signal, "Worktree restore was aborted.");
        try {
          const opened = await openWorktreeWithGitOptions(
            worktree,
            requestGitOptions,
            context?.signal,
            context,
          );
          return {
            ok: true,
            projectId: worktree.projectId,
            worktreePath: worktree.worktreePath,
            ...opened,
          } satisfies RpcOpenWorktreesBatchResultItem;
        } catch (error) {
          return {
            ok: false,
            projectId: worktree.projectId,
            worktreePath: worktree.worktreePath,
            error: error instanceof Error ? error.message : String(error),
          } satisfies RpcOpenWorktreesBatchResultItem;
        }
      },
    );
  });
}
/**
 * Gets worktree snapshot procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function getWorktreeSnapshotProcedure(
  params: AppRPCSchema["requests"]["getWorktreeSnapshot"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeSnapshot> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    assertWorkspacePathAllowed(
      worktreePath,
      workspacePathScopeForContext(context),
    );
    await ensureTrackedProjectWorktree(project, state, worktreePath, {
      ...requestGitOptions,
    });

    return runWorktreeOpenLimited(
      () =>
        readAndStoreWorktreeSnapshot(state, worktreePath, requestGitOptions),
      context?.signal,
    );
  });
}
/**
 * Reads worktree file content page procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

/**
 * Reads project-local skills from the worktree `.pi/skills/` directory.
 * @param params - Parameters object.
 * @param context - Execution context.
 */
export async function listProjectSkillsProcedure(
  params: AppRPCSchema["requests"]["listProjectSkills"]["params"],
  context?: RpcRequestContext,
): Promise<{ skills: RpcProjectSkill[] }> {
  return withForegroundRead(async () => {
    const project = projectByIdForPath(params.projectId, context);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    assertWorkspacePathAllowed(
      worktreePath,
      workspacePathScopeForContext(context),
    );
    await ensureTrackedProjectWorktree(project, state, worktreePath, {
      ...gitCommandOptionsFromRequest(context),
    });

    return { skills: discoverProjectSkillsFromWorktree(worktreePath) };
  });
}

export async function readWorktreeFileContentPageProcedure(
  params: AppRPCSchema["requests"]["readWorktreeFileContentPage"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeFileContentPage> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    assertWorkspacePathAllowed(
      worktreePath,
      workspacePathScopeForContext(context),
    );
    await ensureTrackedProjectWorktree(project, state, worktreePath, {
      ...requestGitOptions,
    });

    // RPC validation checks the basic shape only. The final containment guard
    // lives in git.normalizeGitPath, after this procedure has resolved the
    // authenticated project/worktree scope, so traversal and symlink escapes are
    // judged against the actual selected worktree root.
    const page = await readWorktreeFileContentPage(worktreePath, params.path, {
      ...(typeof params.cursor === "number" ? { cursor: params.cursor } : {}),
      ...(typeof params.limitBytes === "number"
        ? { limitBytes: params.limitBytes }
        : {}),
      signal: context?.signal ?? null,
    });

    return {
      projectId: project.id,
      worktreePath,
      ...page,
    };
  });
}
/**
 * Reads worktree file diff procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function readWorktreeFileDiffProcedure(
  params: AppRPCSchema["requests"]["readWorktreeFileDiff"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeFileDiff> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    assertWorkspacePathAllowed(
      worktreePath,
      workspacePathScopeForContext(context),
    );
    await ensureTrackedProjectWorktree(project, state, worktreePath, {
      ...requestGitOptions,
    });

    // File paths in the change object are re-normalized by readWorktreeChangeDiff
    // and normalizeGitPath before any git pathspec or filesystem fallback is
    // used. Keeping that guard here would duplicate work without access to the
    // lower-level symlink/realpath checks.
    const diffText = await runDiffLoadLimited(
      () =>
        readWorktreeChangeDiff(worktreePath, params.change, requestGitOptions),
      context?.signal,
      "Worktree diff read was aborted.",
    );

    return {
      projectId: project.id,
      worktreePath,
      path: normalizeGitPath(worktreePath, params.change.path),
      diffText,
    };
  });
}
/**
 * Lists worktree git history procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function listWorktreeGitHistoryProcedure(
  params: AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeGitHistoryResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    const offset =
      Number.isInteger(params.offset) && typeof params.offset === "number"
        ? Math.max(params.offset, 0)
        : 0;
    const limit = normalizeGitHistoryPageLimit(params.limit);

    const projectState = ensureProjectPoller(project);
    await ensureTrackedProjectWorktree(
      project,
      projectState,
      worktreePath,
      requestGitOptions,
    );
    const state = ensureWorktreePollState(projectState, worktreePath);
    if (offset === 0 && state.historySignature !== null) {
      if (!state.history.headHash) {
        const { history, summary, signature } = await runGitHistoryReadLimited(
          () =>
            readGitHistoryFirstPage(
              project.id,
              worktreePath,
              limit,
              requestGitOptions,
            ),
          context?.signal,
          "Git history read was aborted.",
        );
        state.history = summary;
        state.historyEntries = history.entries;
        state.historyNextOffset = history.nextOffset;
        state.historySignature = signature;
        state.lastUpdatedAt = summary.lastUpdatedAt;
        syncProjectWorktreeBackgroundPolling(projectState);
        queueBackgroundWorkWhenIdle(
          `git-history-warm:${project.id}:${worktreePath}`,
          () => {
            warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
          },
        );
        return history;
      }

      await runGitHistoryReadLimited(
        () =>
          fillGitHistoryCache(state, worktreePath, 0, limit, requestGitOptions),
        context?.signal,
        "Git history read was aborted.",
      );
      syncProjectWorktreeBackgroundPolling(projectState);
      queueBackgroundWorkWhenIdle(
        `git-history-warm:${project.id}:${worktreePath}`,
        () => {
          warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
        },
      );
      return buildGitHistoryResultFromCache(state, limit, 0);
    }

    if (offset === 0) {
      const { history, summary, signature } = await runGitHistoryReadLimited(
        () =>
          readGitHistoryFirstPage(
            project.id,
            worktreePath,
            limit,
            requestGitOptions,
          ),
        context?.signal,
        "Git history read was aborted.",
      );
      state.history = summary;
      state.historyEntries = history.entries;
      state.historyNextOffset = history.nextOffset;
      state.historySignature = signature;
      state.lastUpdatedAt = summary.lastUpdatedAt;
      syncProjectWorktreeBackgroundPolling(projectState);
      queueBackgroundWorkWhenIdle(
        `git-history-warm:${project.id}:${worktreePath}`,
        () => {
          warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
        },
      );
      return history;
    }

    let summary = state.history;
    let signature = state.historySignature;
    if (signature === null) {
      const loadedSummary = await runGitHistoryReadLimited(
        () =>
          readGitHistorySummary(project.id, worktreePath, requestGitOptions),
        context?.signal,
        "Git history read was aborted.",
      );
      summary = loadedSummary.history;
      signature = loadedSummary.signature;
      state.history = summary;
      state.historyNextOffset = summary.headHash ? 0 : null;
      state.historySignature = signature;
      state.lastUpdatedAt = summary.lastUpdatedAt;
    }

    if (!summary.headHash) {
      return {
        ...summary,
        entries: [],
        limit,
        nextOffset: null,
      };
    }

    await runGitHistoryReadLimited(
      () =>
        fillGitHistoryCache(
          state,
          worktreePath,
          offset,
          limit,
          requestGitOptions,
        ),
      context?.signal,
      "Git history read was aborted.",
    );
    syncProjectWorktreeBackgroundPolling(projectState);
    queueBackgroundWorkWhenIdle(
      `git-history-warm:${project.id}:${worktreePath}`,
      () => {
        warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
      },
    );
    return buildGitHistoryResultFromCache(state, limit, offset);
  });
}
/**
 * Gets worktree git commit diff procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function getWorktreeGitCommitDiffProcedure(
  params: AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
  context?: RpcRequestContext,
): Promise<RpcGitCommitDiffResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    const worktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    if (!findKnownProjectWorktree(project.id, worktreePath)) {
      await assertProjectWorktree(project, worktreePath, requestGitOptions);
    }

    return runDiffLoadLimited(
      () =>
        getCachedGitCommitDiffResult(
          project.id,
          worktreePath,
          params.commitHash,
          {
            gitCommitDiffCache,
            gitCommitDiffRequestCache,
            maxEntries: GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES,
            requestOptions: requestGitOptions,
          },
        ),
      context?.signal,
      "Commit diff read was aborted.",
    );
  });
}
/**
 * Sets active worktree procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function setActiveWorktreeProcedure(
  params: AppRPCSchema["requests"]["setActiveWorktree"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["setActiveWorktree"]["response"]> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const hasProjectId = typeof params.projectId === "number";
  const hasWorktreePath =
    typeof params.worktreePath === "string" &&
    params.worktreePath.trim().length > 0;
  if (hasProjectId !== hasWorktreePath) {
    throw new Error(
      "Active worktree updates must provide both projectId and worktreePath, or neither.",
    );
  }

  const requestedProjectId = hasProjectId ? params.projectId : null;
  const requestedWorktreePath = hasWorktreePath
    ? normalizeRequestedWorkspacePath(params.worktreePath ?? "", context)
    : null;
  throwIfAborted(context?.signal, "Active worktree update was aborted.");
  let projectId: number | null = null;
  let worktreePath: string | null = null;
  if (requestedProjectId !== null) {
    const project = projectByIdForPath(requestedProjectId, context);
    if (project.isOpen === 1) {
      ensureProjectPoller(project);
      projectId = project.id;
      // Validate against a fresh worktree listing so outdated UI selections do not
      // become the backend's active worktree.
      try {
        const worktrees = await awaitAbortableResult(
          readProjectWorktrees(project.path, project.id, {
            ...requestGitOptions,
            forceRefresh: true,
            priority: "background",
          }),
          context?.signal,
          "Active worktree update was aborted.",
        );
        throwIfAborted(context?.signal, "Active worktree update was aborted.");
        worktreePath = worktrees.some(
          (worktree) => worktree.path === requestedWorktreePath,
        )
          ? requestedWorktreePath
          : null;
      } catch (error) {
        if (isAbortError(error) && context?.signal?.aborted) {
          throw createAbortError(
            context.signal.reason,
            "Active worktree update was aborted.",
          );
        }
        // This validation intentionally runs as background work so user-facing
        // foreground git reads can preempt it. In that case, fall back to the
        // freshest cached worktree list instead of failing the RPC outright.
        worktreePath =
          requestedWorktreePath &&
          findKnownProjectWorktree(project.id, requestedWorktreePath)
            ? requestedWorktreePath
            : null;
      }
    } else {
      stopProjectPoller(project.id);
    }
  }

  throwIfAborted(context?.signal, "Active worktree update was aborted.");
  for (const state of projectPollMap.values()) {
    const nextActiveWorktreePath = state.id === projectId ? worktreePath : null;
    if (state.activeWorktreePath === nextActiveWorktreePath) {
      syncProjectRefreshPolling(state);
      continue;
    }
    state.activeWorktreePath = nextActiveWorktreePath;
    syncProjectWorktreeBackgroundPolling(state);
    syncProjectRefreshPolling(state);
  }

  return {
    success: true,
    projectId,
    worktreePath,
  };
}
/**
 * Performs focusContextProcedure operation.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

export async function focusContextProcedureWithSession(
  params: AppRPCSchema["requests"]["focusContext"]["params"],
  context?: RpcRequestContext,
): Promise<{ payload: RpcContextFocusChanged; sessionId: string | null }> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId, context);
    const openedProject = await awaitAbortableResult(
      openProjectWithGitOptions(
        {
          projectPath: project.path,
          name: project.name,
        },
        requestGitOptions,
        context,
      ),
      context?.signal,
      "Context focus was aborted.",
    );
    throwIfAborted(context?.signal, "Context focus was aborted.");

    // focusContext accepts an absolute worktree path from the client, then
    // normalizes it inside the authenticated user's workspace scope and routes
    // it through openWorktreeWithGitOptions. That call reuses the same tracked
    // project/worktree visibility checks as ordinary worktree opening before
    // this focus update is published.
    const normalizedWorktreePath = normalizeRequestedWorkspacePath(
      params.worktreePath,
      context,
    );
    const openedWorktree = await awaitAbortableResult(
      openWorktreeWithGitOptions(
        {
          projectId: openedProject.project.id,
          worktreePath: normalizedWorktreePath,
        },
        requestGitOptions,
        context?.signal,
        context,
      ),
      context?.signal,
      "Context focus was aborted.",
    );
    throwIfAborted(context?.signal, "Context focus was aborted.");

    await setActiveWorktreeProcedure(
      {
        projectId: openedProject.project.id,
        worktreePath: normalizedWorktreePath,
      },
      context,
    );

    if (typeof params.threadId === "number") {
      const thread = threadById(params.threadId, context);
      if (
        thread.projectId !== openedProject.project.id ||
        normalizePath(thread.worktreePath) !== normalizedWorktreePath
      ) {
        throw new Error(
          `Thread ${params.threadId} does not belong to project ${openedProject.project.id} and worktree ${normalizedWorktreePath}.`,
        );
      }
    }

    // Keep the project poller in sync with the refreshed open-project result.
    const state = ensureProjectPoller(project);
    state.worktrees = openedProject.worktrees;
    state.worktreesLoadedAt = Date.now();
    state.activeWorktreePath = normalizedWorktreePath;
    ensureWorktreePollState(state, normalizedWorktreePath);
    const focused = {
      sessionId: context?.auth.sessionId ?? null,
      payload: {
        projectId: openedProject.project.id,
        projectPath: openedProject.project.path,
        projectName: openedProject.project.name,
        worktreePath: openedWorktree.worktree.path,
        threadId: params.threadId ?? null,
      },
    };
    workContextEvents.publish(
      publishLifecycleEvent,
      workContextEvents.contextFocusChanged(focused.sessionId, focused.payload),
    );
    return focused;
  });
}

export async function focusContextProcedure(
  params: AppRPCSchema["requests"]["focusContext"]["params"],
  context?: RpcRequestContext,
): Promise<RpcContextFocusChanged> {
  const { payload } = await focusContextProcedureWithSession(params, context);
  return payload;
}

export async function respondThreadExtensionUiProcedure(
  params: AppRPCSchema["requests"]["respondThreadExtensionUi"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["respondThreadExtensionUi"]["response"]> {
  threadById(params.threadId, context);
  return {
    accepted: piThreadExtensionUiBridge.handleResponse(
      params.threadId,
      params.response,
    ),
  };
}

export async function updateThreadExtensionEditorProcedure(
  params: AppRPCSchema["requests"]["updateThreadExtensionEditor"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["updateThreadExtensionEditor"]["response"]
> {
  threadById(params.threadId, context);
  piThreadExtensionUiBridge.updateEditorText(params.threadId, params.text);
  return {
    success: true,
    threadId: params.threadId,
  };
}
/**
 * Closes worktree procedure.
 * @param params - Parameters object.
 */

export async function closeWorktreeProcedure(
  params: AppRPCSchema["requests"]["closeWorktree"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["closeWorktree"]["response"]> {
  projectByIdForPath(params.projectId, context);
  const state = projectPollMap.get(params.projectId);
  const normalizedWorktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  if (state) {
    if (state.activeWorktreePath === normalizedWorktreePath) {
      state.activeWorktreePath = null;
    }
    stopWorktreePolling(state, normalizedWorktreePath);
    syncProjectRefreshPolling(state);
  }

  return {
    success: true,
    projectId: params.projectId,
    worktreePath: normalizedWorktreePath,
  };
}
/**
 * Closes project procedure.
 * @param params - Parameters object.
 */

export async function closeProjectProcedure(
  params: AppRPCSchema["requests"]["closeProject"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["closeProject"]["response"]> {
  const project = projectByIdForPath(params.projectId, context);
  stopProjectPoller(project.id);
  setProjectClosed(db, project.id);
  return {
    success: true,
    projectId: project.id,
    message: `Closed project ${project.name}`,
  };
}
/**
 * Deletes project procedure.
 * @param params - Parameters object.
 */

export async function deleteProjectProcedure(
  params: AppRPCSchema["requests"]["deleteProject"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["deleteProject"]["response"]> {
  requireManageApp(context);
  requireRecentStepUp(context);
  const project = projectByIdForPath(params.projectId, context);
  const projectThreads = threadStore
    .list()
    .filter((thread) => thread.projectId === project.id);
  const workingThread = projectThreads.find(
    (thread) => currentThreadRunStatus(thread).state === "working",
  );
  if (workingThread) {
    throw new Error(
      `Project cannot be deleted while thread "${workingThread.title}" is processing.`,
    );
  }

  stopProjectPoller(project.id);
  clearProjectThreadRuntimeState(project.id);
  deleteProject(db, project.id);
  recordProjectDeletedAuditEvent(db, {
    project,
    threadCount: projectThreads.length,
  });
  return {
    success: true,
    projectId: project.id,
    message: `Removed project ${project.name}`,
  };
}
/**
 * Gets open worktree snapshot.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 */

export function getOpenWorktreeSnapshot(
  projectId: number,
  worktreePath: string,
): RpcWorktreeSnapshot | null {
  const state = projectPollMap.get(projectId);
  if (!state) return null;
  const normalized = normalizePath(worktreePath);
  const worktreeState = state.openWorktrees.get(normalized);
  if (!worktreeState) return null;
  return {
    path: normalized,
    changes: worktreeState.changes,
    diff: worktreeState.diff,
    files: worktreeState.files,
    lastUpdatedAt: worktreeState.lastUpdatedAt,
  };
}

export function shutdownProjectPolling(): void {
  for (const projectId of projectPollMap.keys()) {
    stopProjectPoller(projectId);
  }
}

export async function shutdownActiveThreadTurns(): Promise<void> {
  const activeTurns = threadRuntimeLifecycle.getActiveTurns();

  for (const activeTurn of activeTurns) {
    if (!activeTurn.controller.signal.aborted) {
      activeTurn.controller.abort(
        createAbortError(null, THREAD_INTERRUPTED_MESSAGE),
      );
    }
  }

  await Promise.allSettled(
    activeTurns.flatMap((activeTurn) =>
      activeTurn.promise ? [activeTurn.promise] : [],
    ),
  );
}

export function suspendActiveWorktreePolling(): void {
  for (const state of projectPollMap.values()) {
    if (state.activeWorktreePath === null) {
      continue;
    }
    state.activeWorktreePath = null;
    syncProjectWorktreeBackgroundPolling(state);
  }
}

export function shutdownProcedureCacheMaintenance(): void {
  shutdownDirectorySuggestionCacheMaintenance();
}
/**
 * Sets worktree git history change listener.
 * @param listener - Event listener callback.
 */

export function setWorktreeGitHistoryChangeListener(
  listener: ((projectId: number, worktreePath: string) => void) | null,
): void {
  worktreeGitHistoryChangeListener = listener;
}

export function setCronJobsChangeListener(listener: (() => void) | null): void {
  cronJobsChangeListener = listener;
}

export function setContextFocusChangeListener(
  listener:
    | ((payload: RpcContextFocusChanged, sessionId: string | null) => void)
    | null,
): void {
  contextFocusChangeListener = listener;
}

export function setThreadStartRequestCreatedListener(
  listener: ((request: RpcThreadStartRequest) => void) | null,
): void {
  threadStartRequestCreatedListener = listener;
}

export function setThreadStartRequestResolvedListener(
  listener: ((resolved: RpcThreadStartRequestResolved) => void) | null,
): void {
  threadStartRequestResolvedListener = listener;
}

export function setThreadStatusChangeListener(
  listener: ThreadStatusChangeListener | null,
): void {
  threadStatusChangeListener = listener;
}

export function onThreadStatusChanged(
  listener: (thread: RpcThread) => void,
): () => void {
  threadStatusChangeListeners.add(listener);
  return () => {
    threadStatusChangeListeners.delete(listener);
  };
}

export function setThreadExtensionUiMessageListener(
  listener:
    | ((
        request: RpcThreadExtensionUiRequest,
        sessionId: string | null,
      ) => boolean)
    | null,
): void {
  threadExtensionUiMessageListener = listener;
}
