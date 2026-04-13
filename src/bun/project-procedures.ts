/**
 * @file src/bun/project-procedures.ts
 * @description Module for project procedures.
 */

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import { AuthServiceError, createPendingUser } from "./auth-service";
import { normalizeWorkspaceHomeUsername } from "./auth-usernames";
import type {
  CronJobRecord,
  ProjectRecord,
  ThreadActivityInput,
  ThreadRecord,
  UserSetupRecord,
} from "./db";
import {
  createCronJob,
  createSecurityAuditEvent,
  createThread,
  createThreadMessage,
  deleteProject,
  deleteThread,
  ensureProjectWorktreeVisible,
  getAppDataDirectoryPath,
  getCronJobById,
  getCronJobByIdForUser,
  getProject,
  getProjectById,
  getProjectByIdForUser,
  getProjectForUser,
  getThreadById,
  getThreadByIdForUser,
  getUserById,
  initAppDatabase,
  listCronJobs,
  listCronJobsForUser,
  listProjects,
  listProjectsForUser,
  listProjectWorktreesMetadata,
  listThreadMessages,
  listThreadMessagesPage,
  listThreads,
  listThreadsForUser,
  listThreadsWithInProgressMessages,
  listUsersWithSetupStatus,
  markThreadErrorSeen,
  markThreadFailed,
  markThreadRan,
  markThreadRunStarted,
  markThreadStopped,
  renameThread,
  setProjectClosed,
  setProjectWorktreePinned,
  setThreadAccess,
  setThreadModel,
  setThreadPinned,
  setThreadReasoningEffort,
  setThreadUnsafeMode,
  setThreadUsage,
  softDeleteCronJob,
  stopInProgressThreadMessages,
  updateCronJob,
  updateThreadPiSessionState,
  upsertProject,
  upsertThreadActivities,
} from "./db";
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
import { createPiThreadExtensionUiBridge } from "./pi-extension-ui";
import type { PiMetidosToolHost } from "./pi-metidos-tools";
import {
  buildPiAgentDirectoryPath,
  createPiThreadRuntime,
  type PiThreadRuntime,
} from "./pi-thread-runtime";
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
  type PendingGitHistoryPrefetch,
  warmGitHistoryCache,
} from "./project-procedures/git-history";
import {
  assertCodexModelProviderAvailable,
  buildModelCatalog,
  codexModelProvider,
  normalizeStoredCodexModel,
  normalizeStoredCodexReasoningEffort,
  resolveCodexReasoningEffort,
  resolveRunnableCodexModel,
} from "./project-procedures/model-catalog";
import {
  getOllamaProviderConfig,
  saveOllamaProviderConfig,
} from "./project-procedures/ollama-provider-config";
import {
  createPiThreadEventProjector,
  type ProjectedPiActivityWrite,
} from "./project-procedures/pi-event-projection";
import {
  extractPiAssistantMessageText,
  extractPiAssistantUsage,
} from "./project-procedures/pi-sdk-shapes";
import {
  applyPiRuntimeTelemetry,
  buildPiRuntimeCompaction,
  buildPiRuntimeUsage,
} from "./project-procedures/pi-session-telemetry";
import {
  completeProviderAuthLogin,
  getProviderAuthStatus,
  logoutProviderAuth,
  refreshProviderAuth,
  startProviderAuthLogin,
} from "./project-procedures/provider-auth";
import {
  awaitAbortableResult,
  createAbortError,
  createAsyncConcurrencyLimit,
  isAbortError,
  normalizePath,
  pathIsWithinRoot,
  readLruValue,
  safeIsDirectory,
  throwIfAborted,
  writeLruValue,
} from "./project-procedures/shared";
import { initTaskGraphFilesystem } from "./project-procedures/task-graph-filesystem";
import { normalizeTaskGraphFilesystem } from "./project-procedures/task-graph-normalization";
import { validateTaskGraphFilesystem } from "./project-procedures/task-graph-validation";
import {
  buildThreadTitle,
  isStoppedThreadMessage,
  THREAD_INTERRUPTED_MESSAGE,
  THREAD_STOPPED_MESSAGE,
  threadRunStatusFromRecord,
  toRpcThread,
  toRpcThreadMessages,
} from "./project-procedures/thread-detail";
import {
  recordCrossWorkspaceThreadAuditEvent,
  recordProjectDeletedAuditEvent,
} from "./project-security-audit";
import type {
  AppRPCSchema,
  RpcAppBootstrapResult,
  RpcContextFocusChanged,
  RpcCreateWorktreeResult,
  RpcCronJob,
  RpcGitCommitDiffResult,
  RpcGitHistoryEntry,
  RpcHomeDirectoryResult,
  RpcInitTaskGraphRequest,
  RpcInitTaskGraphResult,
  RpcManagedUser,
  RpcModelCatalog,
  RpcNormalizeTaskGraphRequest,
  RpcNormalizeTaskGraphResult,
  RpcOllamaProviderConfig,
  RpcOllamaProviderConfigResult,
  RpcOpenProjectsBatchResultItem,
  RpcOpenWorktreeResult,
  RpcOpenWorktreesBatchResultItem,
  RpcProject,
  RpcProjectWorktreesResult,
  RpcProviderAuthResult,
  RpcReasoningEffort,
  RpcRequestContext,
  RpcRequestPriority,
  RpcThread,
  RpcThreadDetail,
  RpcThreadExtensionUiRequest,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcThreadUsage,
  RpcValidateTaskGraphRequest,
  RpcValidateTaskGraphResult,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeFileContentPage,
  RpcWorktreeFileDiff,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeSnapshot,
} from "./rpc-schema";
import { recordSqliteRetryLoop } from "./runtime-stats";
import {
  runCronNow as runCronNowInScheduler,
  syncCronSchedulerCron,
} from "./sidecar-cron-scheduler";

/**
 * Shared DB handle for all RPC procedures in this process.
 */

const db = initAppDatabase();
const NEVER_ABORT_SIGNAL = new AbortController().signal;

function authUserId(context?: RpcRequestContext): number | null {
  return context?.auth.authBypass
    ? null
    : typeof context?.auth.userId === "number"
      ? context.auth.userId
      : null;
}

function isAdminContext(context?: RpcRequestContext): boolean {
  return context?.auth.authBypass === true || context?.auth.isAdmin === true;
}

function requireAdminContext(context?: RpcRequestContext): void {
  if (isAdminContext(context)) {
    return;
  }
  throw new AuthServiceError(
    "admin_required",
    "Administrator privileges are required for this action.",
    403,
  );
}

function requireUnsafeModeAllowed(context?: RpcRequestContext): void {
  if (isAdminContext(context)) {
    return;
  }
  throw new AuthServiceError(
    "admin_required",
    "Administrator privileges are required to enable unsafe mode.",
    403,
  );
}

type WorkspacePathScope = {
  homeDirectory: string;
  restrictedRoot: string | null;
  supportsTildePath: boolean;
};

const RESTRICTED_WORKSPACE_ERROR_MESSAGE =
  "Regular users can only access workspaces inside ~/.";

function defaultWorkspaceSupportsTildePath(): boolean {
  return process.platform === "darwin" || process.platform === "linux";
}

function normalizeWorkspaceUsernameSegment(username: string): string {
  try {
    return normalizeWorkspaceHomeUsername(username);
  } catch {
    throw new Error(
      "The current account username cannot be mapped to a private workspace home.",
    );
  }
}

function restrictedWorkspacePathScope(username: string): WorkspacePathScope {
  const homeDirectory = resolve(
    getAppDataDirectoryPath(),
    "users",
    normalizeWorkspaceUsernameSegment(username),
  );
  mkdirSync(homeDirectory, {
    recursive: true,
  });
  return {
    homeDirectory,
    restrictedRoot: homeDirectory,
    supportsTildePath: true,
  };
}

function adminWorkspacePathScope(): WorkspacePathScope {
  return {
    homeDirectory: homedir(),
    restrictedRoot: null,
    supportsTildePath: defaultWorkspaceSupportsTildePath(),
  };
}

function workspacePathScopeForContext(
  context?: RpcRequestContext,
): WorkspacePathScope {
  if (isAdminContext(context)) {
    return adminWorkspacePathScope();
  }

  const username = context?.auth.username?.trim();
  if (!username) {
    return adminWorkspacePathScope();
  }

  return restrictedWorkspacePathScope(username);
}

function workspacePathScopeForProject(
  project: Pick<ProjectRecord, "ownerUserId">,
): WorkspacePathScope {
  const ownerUser = getUserById(db, project.ownerUserId);
  if (!ownerUser || ownerUser.isAdmin) {
    return adminWorkspacePathScope();
  }
  return restrictedWorkspacePathScope(ownerUser.username);
}

function normalizeRequestedWorkspacePath(
  value: string,
  context?: RpcRequestContext,
): string {
  const scope = workspacePathScopeForContext(context);
  return normalizePath(value, {
    homeDirectory: scope.homeDirectory,
    supportsTildePath: scope.supportsTildePath,
  });
}

function formatWorkspacePathForUser(
  path: string,
  scope: WorkspacePathScope,
): string {
  const normalizedPath = resolve(path);
  if (!scope.supportsTildePath || !scope.restrictedRoot) {
    return normalizedPath;
  }
  if (!pathIsWithinRoot(scope.restrictedRoot, normalizedPath)) {
    return normalizedPath;
  }

  const suffix = normalizedPath.slice(scope.restrictedRoot.length);
  return suffix ? `~${suffix}` : "~";
}

function isWorkspacePathAllowed(
  path: string,
  scope: WorkspacePathScope,
): boolean {
  const normalizedPath = resolve(path);
  if (!scope.restrictedRoot) {
    return true;
  }
  if (!pathIsWithinRoot(scope.restrictedRoot, normalizedPath)) {
    return false;
  }
  if (!existsSync(normalizedPath)) {
    return true;
  }

  try {
    return pathIsWithinRoot(scope.restrictedRoot, realpathSync(normalizedPath));
  } catch {
    return false;
  }
}

function assertWorkspacePathAllowed(
  path: string,
  scope: WorkspacePathScope,
): void {
  if (isWorkspacePathAllowed(path, scope)) {
    return;
  }
  throw new Error(RESTRICTED_WORKSPACE_ERROR_MESSAGE);
}

function projectIsVisibleToContext(
  project: ProjectRecord,
  context?: RpcRequestContext,
): boolean {
  if (!context || isAdminContext(context)) {
    return true;
  }
  return isWorkspacePathAllowed(
    project.path,
    workspacePathScopeForProject(project),
  );
}

function visibleProjects(context?: RpcRequestContext): ProjectRecord[] {
  const userId = authUserId(context);
  const projects =
    typeof userId === "number"
      ? listProjectsForUser(db, userId)
      : listProjects(db);
  return projects.filter((project) =>
    projectIsVisibleToContext(project, context),
  );
}

function visibleThreads(context?: RpcRequestContext): ThreadRecord[] {
  const userId = authUserId(context);
  const visibleProjectIds = new Set(
    visibleProjects(context).map((project) => project.id),
  );
  const threads =
    typeof userId === "number"
      ? listThreadsForUser(db, userId)
      : listThreads(db);
  return threads.filter((thread) => visibleProjectIds.has(thread.projectId));
}

function visibleCronJobs(context?: RpcRequestContext): CronJobRecord[] {
  const userId = authUserId(context);
  const visibleProjectIds = new Set(
    visibleProjects(context).map((project) => project.id),
  );
  const cronJobs =
    typeof userId === "number"
      ? listCronJobsForUser(db, userId)
      : listCronJobs(db);
  return cronJobs.filter((cronJob) => visibleProjectIds.has(cronJob.projectId));
}

function toRpcManagedUser(user: UserSetupRecord): RpcManagedUser {
  return {
    configured: user.configured,
    createdAt: user.createdAt,
    id: user.id,
    isAdmin: user.isAdmin,
    updatedAt: user.updatedAt,
    username: user.username,
  };
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

/**
 * RPC procedure: list threads with a live run-status snapshot for each thread.
 */

export async function listThreadsProcedure(
  _params?: AppRPCSchema["requests"]["listThreads"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread[]> {
  return visibleThreads(context).map((thread) =>
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
  const requestedThreadIds = new Set(params.threadIds);
  if (requestedThreadIds.size === 0) {
    return [];
  }

  return visibleThreads(context)
    .filter((thread) => requestedThreadIds.has(thread.id))
    .map((thread) =>
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

  const mostRecentThread = listThreads(db)[0] ?? null;
  if (mostRecentThread) {
    warmThreadDetailCache(mostRecentThread.id);
  }
}

/**
 * Return the latest terminal timestamp from a thread (run or error), if any.
 * @param thread - The thread entity currently being processed.
 */
function latestSettledThreadTimestamp(thread: ThreadRecord): string | null {
  if (thread.lastRunAt && thread.lastErrorAt) {
    return thread.lastRunAt >= thread.lastErrorAt
      ? thread.lastRunAt
      : thread.lastErrorAt;
  }

  return thread.lastRunAt ?? thread.lastErrorAt ?? null;
}

/**
 * Detect threads that should be marked interrupted after a crash/restart.
 */

function shouldRecoverInterruptedThread(
  thread: ThreadRecord,
  lastInProgressMessageUpdatedAt: string | null,
): boolean {
  if (thread.activeTurnStartedAt) {
    return true;
  }

  if (!lastInProgressMessageUpdatedAt) {
    return false;
  }

  const lastSettledAt = latestSettledThreadTimestamp(thread);
  if (!lastSettledAt) {
    return true;
  }

  return lastInProgressMessageUpdatedAt >= lastSettledAt;
}

/**
 * Select bootstrap thread from hints:
 * - explicit `threadIdHint`
 * - project + worktree match
 */

function pickBootstrapThreadRecord(
  threads: ThreadRecord[],
  params?: AppRPCSchema["requests"]["getAppBootstrap"]["params"],
): ThreadRecord | null {
  const threadIdHint =
    typeof params?.threadIdHint === "number" ? params.threadIdHint : null;
  if (threadIdHint !== null) {
    const hintedThread =
      threads.find((thread) => thread.id === threadIdHint) ?? null;
    if (hintedThread) {
      return hintedThread;
    }
  }

  if (
    typeof params?.selectedProjectId === "number" &&
    typeof params.selectedWorktreePath === "string" &&
    params.selectedWorktreePath
  ) {
    const matchingThread =
      threads.find(
        (thread) =>
          thread.projectId === params.selectedProjectId &&
          thread.worktreePath === params.selectedWorktreePath,
      ) ?? null;
    if (matchingThread) {
      return matchingThread;
    }
  }

  return null;
}

/**
 * On startup, recover threads left mid-turn by previous shutdown/crash.
 */

export function recoverInterruptedThreadTurnsOnStartup(): void {
  const threads = listThreads(db);
  if (threads.length === 0) {
    return;
  }

  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const recoveredThreadIds = new Set<number>();

  for (const interrupted of listThreadsWithInProgressMessages(db)) {
    const thread = threadsById.get(interrupted.threadId);
    if (!thread) {
      continue;
    }

    stopInProgressThreadMessages(db, thread.id);
    if (shouldRecoverInterruptedThread(thread, interrupted.lastUpdatedAt)) {
      markThreadStopped(db, thread.id, THREAD_INTERRUPTED_MESSAGE);
      recoveredThreadIds.add(thread.id);
    }
  }

  for (const thread of threads) {
    if (!thread.activeTurnStartedAt || recoveredThreadIds.has(thread.id)) {
      continue;
    }

    markThreadStopped(db, thread.id, THREAD_INTERRUPTED_MESSAGE);
  }
}

/**
 * RPC procedure: return the current provider-backed model catalog.
 */

export async function getModelCatalogProcedure(
  _params?: AppRPCSchema["requests"]["getModelCatalog"]["params"],
): Promise<RpcModelCatalog> {
  return buildModelCatalog();
}

/**
 * RPC procedure: return the current Ollama provider config editor state.
 */
export async function getOllamaProviderConfigProcedure(
  _params?: AppRPCSchema["requests"]["getOllamaProviderConfig"]["params"],
  context?: RpcRequestContext,
): Promise<RpcOllamaProviderConfig> {
  requireAdminContext(context);
  return getOllamaProviderConfig();
}

/**
 * RPC procedure: save Ollama provider settings and refresh the exposed model catalog.
 */
export async function saveOllamaProviderConfigProcedure(
  params: AppRPCSchema["requests"]["saveOllamaProviderConfig"]["params"],
  context?: RpcRequestContext,
): Promise<RpcOllamaProviderConfigResult> {
  requireAdminContext(context);
  const ollama = await saveOllamaProviderConfig({
    apiKey: params.apiKey,
    url: params.url,
  });
  return {
    modelCatalog: buildModelCatalog(),
    ollama,
  };
}

function buildProviderAuthResult(providerId: string): RpcProviderAuthResult {
  return {
    modelCatalog: buildModelCatalog(),
    provider: getProviderAuthStatus(buildPiAgentDirectoryPath(), providerId),
  };
}

/**
 * RPC procedure: read the current backend-managed provider-auth state.
 */
export async function getProviderAuthStatusProcedure(
  params: AppRPCSchema["requests"]["getProviderAuthStatus"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProviderAuthResult> {
  requireAdminContext(context);
  return buildProviderAuthResult(params.providerId);
}

/**
 * RPC procedure: start a backend-managed provider login flow.
 */
export async function startProviderAuthLoginProcedure(
  params: AppRPCSchema["requests"]["startProviderAuthLogin"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProviderAuthResult> {
  requireAdminContext(context);
  await startProviderAuthLogin(buildPiAgentDirectoryPath(), params);
  return buildProviderAuthResult(params.providerId);
}

/**
 * RPC procedure: complete a provider login flow after browser redirect or manual code paste.
 */
export async function completeProviderAuthLoginProcedure(
  params: AppRPCSchema["requests"]["completeProviderAuthLogin"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProviderAuthResult> {
  requireAdminContext(context);
  await completeProviderAuthLogin(buildPiAgentDirectoryPath(), params);
  return buildProviderAuthResult(params.providerId);
}

/**
 * RPC procedure: refresh provider credentials and return the resulting availability state.
 */
export async function refreshProviderAuthProcedure(
  params: AppRPCSchema["requests"]["refreshProviderAuth"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProviderAuthResult> {
  requireAdminContext(context);
  await refreshProviderAuth(buildPiAgentDirectoryPath(), params.providerId);
  return buildProviderAuthResult(params.providerId);
}

/**
 * RPC procedure: clear stored provider credentials and return the resulting availability state.
 */
export async function logoutProviderAuthProcedure(
  params: AppRPCSchema["requests"]["logoutProviderAuth"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProviderAuthResult> {
  requireAdminContext(context);
  await logoutProviderAuth(buildPiAgentDirectoryPath(), params.providerId);
  return buildProviderAuthResult(params.providerId);
}

/**
 * RPC procedure: list all configured and pending user accounts for admin management.
 */
export async function listUsersProcedure(
  _params: AppRPCSchema["requests"]["listUsers"]["params"],
  context?: RpcRequestContext,
): Promise<RpcManagedUser[]> {
  requireAdminContext(context);
  return listUsersWithSetupStatus(db).map(toRpcManagedUser);
}

/**
 * RPC procedure: create a regular pending user account that must finish auth setup.
 */
export async function createUserProcedure(
  params: AppRPCSchema["requests"]["createUser"]["params"],
  context?: RpcRequestContext,
): Promise<RpcManagedUser> {
  requireAdminContext(context);
  const user = await createPendingUser(db, {
    actorUserId: context?.auth.userId ?? null,
    actorUsername: context?.auth.username ?? null,
    pin: params.pin,
    username: params.username,
  });
  return toRpcManagedUser({
    ...user,
    configured: false,
  });
}

/**
 * Compose startup bootstrap payload (home, model catalog, projects, and thread detail).
 * Thread detail errors are non-fatal to allow UI to continue booting.
 */

export async function getAppBootstrapProcedure(
  params?: AppRPCSchema["requests"]["getAppBootstrap"]["params"],
  context?: RpcRequestContext,
): Promise<RpcAppBootstrapResult> {
  const [homeDirectory, modelCatalog] = await Promise.all([
    getHomeDirectoryProcedure(context),
    getModelCatalogProcedure(),
  ]);
  const threads = visibleThreads(context);
  const hintedThread = pickBootstrapThreadRecord(threads, params);
  const threadDetail =
    hintedThread === null
      ? null
      : await readThreadDetailCached(hintedThread.id).catch(() => null);

  return {
    homeDirectory,
    modelCatalog,
    projects: visibleProjects(context),
    threadDetail,
    threads: threads.map((thread) =>
      applyActiveThreadRuntimeTelemetry(
        toRpcThread(thread, currentThreadRunStatus(thread)),
      ),
    ),
  };
}

/**
 * Polling/caching/ticker constants for project/worktree refresh loops.
 */

const PROJECT_POLL_INTERVAL_MS = 4_000;
const PROJECT_WORKTREE_CACHE_STALE_MS = 12_000;
const GIT_HISTORY_POLL_INTERVAL_MS = 2_000;
const THREAD_DETAIL_CACHE_MAX_ENTRIES = 32;
const GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES = 64;
const COMMAND_ACTIVITY_FLUSH_INTERVAL_MS = 500;
const WORKTREE_OPEN_CONCURRENCY = 2;
const GIT_HISTORY_READ_CONCURRENCY = 2;
const DIFF_LOAD_CONCURRENCY = 2;

/**
 * Per-worktree command options, including an explicit refresh override.
 */

type ProjectWorktreeReadOptions = GitCommandOptions & {
  forceRefresh?: boolean;
  includeHidden?: boolean;
};

type ProjectWorktreeListing = {
  hiddenWorktrees: RpcWorktree[];
  worktrees: RpcWorktree[];
};

type CreateThreadRecordOptions = ProjectWorktreeReadOptions & {
  sessionId?: string | null;
};

/**
 * Mutable per-worktree polling/caching state while worktree details are open.
 */

type WorktreePollState = {
  changes: RpcWorktreeChange[];
  diff: string[];
  files: string[];
  history: RpcWorktreeGitHistorySummary;
  historyEntries: RpcGitHistoryEntry[];
  historyNextOffset: number | null;
  historyPolling: boolean;
  historyPrefetch: PendingGitHistoryPrefetch | null;
  historySignature: string | null;
  historyTimer: ReturnType<typeof setInterval> | null;
  lastUpdatedAt: string;
};

/**
 * Mutable per-project polling/caching state while project is active in UI.
 */

type ProjectPollState = {
  id: number;
  project: ProjectRecord;
  projectPath: string;
  worktrees: RpcWorktree[];
  worktreesLoadedAt: number;
  activeWorktreePath: string | null;
  projectTimer: ReturnType<typeof setInterval> | null;
  openWorktrees: Map<string, WorktreePollState>;
};

/**
 * Process-local caches shared by multiple procedure calls.
 */

const projectPollMap = new Map<number, ProjectPollState>();
const piThreadRuntimeMap = new Map<number, PiThreadRuntime>();
const piThreadExtensionUiBridge = createPiThreadExtensionUiBridge();
const threadRunStatusMap = new Map<number, RpcThreadRunStatus>();
const threadTurnAbortControllerMap = new Map<number, AbortController>();
const threadTurnCompletionMap = new Map<number, Promise<void>>();
const threadDetailCache = new Map<number, RpcThreadDetail>();
const THREAD_DETAIL_PAGE_MESSAGE_LIMIT = 100;
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
let lastThreadActivityPersistenceDurationMs = 0;
let peakThreadActivityPersistenceDurationMs = 0;
let worktreeGitHistoryChangeListener:
  | ((projectId: number, worktreePath: string) => void)
  | null = null;
let threadStatusChangeListener: ((thread: RpcThread) => void) | null = null;
let threadExtensionUiMessageListener:
  | ((request: RpcThreadExtensionUiRequest) => boolean)
  | null = null;

piThreadExtensionUiBridge.setMessageListener(
  (request) => threadExtensionUiMessageListener?.(request) ?? false,
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
/**
 * Performs recordThreadActivityPersistenceDuration operation.
 * @param durationMs - Milliseconds elapsed before activity persistence completes.
 */

function recordThreadActivityPersistenceDuration(durationMs: number): void {
  lastThreadActivityPersistenceDurationMs = durationMs;
  peakThreadActivityPersistenceDurationMs = Math.max(
    peakThreadActivityPersistenceDurationMs,
    durationMs,
  );
}

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
    threadActivityPersistenceDurationMs: {
      last: lastThreadActivityPersistenceDurationMs,
      peak: peakThreadActivityPersistenceDurationMs,
    },
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

function invalidateThreadDetailCache(threadId: number): void {
  threadDetailCache.delete(threadId);
}

function disposePiThreadRuntime(threadId: number): void {
  const runtime = piThreadRuntimeMap.get(threadId);
  if (runtime) {
    runtime.session.dispose();
  }
  piThreadRuntimeMap.delete(threadId);
}
/**
 * Performs clearThreadRuntimeState operation.
 * @param threadId - Thread identifier.
 */

function clearThreadRuntimeState(threadId: number): void {
  const activeController = threadTurnAbortControllerMap.get(threadId);
  if (activeController && !activeController.signal.aborted) {
    activeController.abort(
      createAbortError(null, "Thread runtime state was cleared."),
    );
  }
  threadTurnAbortControllerMap.delete(threadId);
  threadTurnCompletionMap.delete(threadId);
  piThreadExtensionUiBridge.clearThread(threadId);
  disposePiThreadRuntime(threadId);
  threadRunStatusMap.delete(threadId);
  invalidateThreadDetailCache(threadId);
}
/**
 * Performs clearProjectThreadRuntimeState operation.
 * @param projectId - Project identifier.
 */

function clearProjectThreadRuntimeState(projectId: number): void {
  for (const thread of listThreads(db)) {
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
  if (!threadStatusChangeListener) {
    return;
  }

  try {
    threadStatusChangeListener(rpcThreadById(threadId));
  } catch (error) {
    console.error(`Failed to publish thread status for ${threadId}`, error);
  }
}

function setThreadRunStatus(
  threadId: number,
  status: RpcThreadRunStatus,
): void {
  threadRunStatusMap.set(threadId, status);
  invalidateThreadDetailCache(threadId);
  notifyThreadStatusChanged(threadId);
}

function touchWorkingThreadRunStatus(threadId: number): void {
  const current = threadRunStatusMap.get(threadId);
  if (!current || current.state !== "working") {
    return;
  }

  threadRunStatusMap.set(threadId, {
    ...current,
    updatedAt: getNow(),
  });
  invalidateThreadDetailCache(threadId);
}
/**
 * Performs currentThreadRunStatus operation.
 * @param thread - Thread whose current run status is being read.
 */

function currentThreadRunStatus(thread: ThreadRecord): RpcThreadRunStatus {
  return threadRunStatusFromRecord(thread, threadRunStatusMap.get(thread.id));
}

function applyActiveThreadRuntimeTelemetry(thread: RpcThread): RpcThread {
  return applyPiRuntimeTelemetry(thread, piThreadRuntimeMap.get(thread.id));
}
/**
 * Thread access flags used for thread and cron creation.
 */

type ThreadAccessControls = {
  webSearchAccess: boolean;
  githubAccess: boolean;
  agentsAccess: boolean;
  metidosAccess: boolean;
  unsafeMode: boolean;
};

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

function resolveThreadAccessControls(
  input: {
    webSearchAccess?: boolean | null;
    githubAccess?: boolean | null;
    agentsAccess?: boolean | null;
    metidosAccess?: boolean | null;
    unsafeMode?: boolean | null;
  } = {},
  context?: RpcRequestContext,
  options?: {
    allowPreauthorizedUnsafeMode?: boolean;
  },
): ThreadAccessControls {
  const unsafeMode = resolveUnsafeMode(input.unsafeMode ?? null);
  if (unsafeMode && options?.allowPreauthorizedUnsafeMode !== true) {
    requireUnsafeModeAllowed(context);
  }
  return {
    webSearchAccess: input.webSearchAccess !== false,
    githubAccess: input.githubAccess === true,
    agentsAccess: input.agentsAccess === true,
    metidosAccess: input.metidosAccess !== false,
    unsafeMode,
  };
}

async function ensurePiThreadRuntime(
  thread: ThreadRecord,
  _sessionId: string | null,
): Promise<PiThreadRuntime> {
  const active = piThreadRuntimeMap.get(thread.id);
  if (active) {
    syncPiThreadSessionState(thread, active);
    return active;
  }

  const next = await createPiThreadRuntime(thread, {
    extensionUiBridge: piThreadExtensionUiBridge,
    metidosToolHost: createPiMetidosToolHost(thread.ownerUserId),
  });
  piThreadRuntimeMap.set(thread.id, next);
  syncPiThreadSessionState(thread, next);
  return next;
}

function createPiToolRequestContext(
  ownerUserId: number,
  signal?: AbortSignal,
): RpcRequestContext {
  const ownerUser = getUserById(db, ownerUserId);

  return {
    auth: {
      authBypass: false,
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

function resolveTaskGraphRootPath(worktreePath: string): string {
  return resolve(worktreePath, ".metidos", "tasks");
}

function toRpcTaskGraphConfig(
  config: Awaited<ReturnType<typeof initTaskGraphFilesystem>>["config"],
): RpcInitTaskGraphResult["config"] {
  return {
    bodyFormat: config.body_format,
    defaults: {
      priority: config.defaults.priority,
      status: config.defaults.status,
      type: config.defaults.type,
    },
    idPrefix: config.id_prefix,
    schema: config.schema,
    strictTags: config.strict_tags,
    strictTypes: config.strict_types,
  };
}

function toRpcInitTaskGraphResult(
  result: Awaited<ReturnType<typeof initTaskGraphFilesystem>>,
): RpcInitTaskGraphResult {
  return {
    config: toRpcTaskGraphConfig(result.config),
    paths: result.paths,
    status: result.status,
  };
}

function toRpcValidateTaskGraphResult(
  result: Awaited<ReturnType<typeof validateTaskGraphFilesystem>>,
): RpcValidateTaskGraphResult {
  const findings = result.findings.map((finding) => ({
    code: finding.code,
    field: finding.field,
    message: finding.message,
    path: finding.path,
    relatedTaskId: finding.related_task_id,
    severity: finding.severity,
    taskId: finding.task_id,
  }));
  return {
    errors: findings.filter((finding) => finding.severity === "error"),
    findings,
    ok: result.ok,
    root: result.root,
    validatedTaskIds: result.validated_task_ids,
    warnings: findings.filter((finding) => finding.severity === "warning"),
  };
}

function toRpcNormalizeTaskGraphResult(
  result: Awaited<ReturnType<typeof normalizeTaskGraphFilesystem>>,
): RpcNormalizeTaskGraphResult {
  const mapFileResult = (
    file: (typeof result.changed_files)[number],
  ): RpcNormalizeTaskGraphResult["changedFiles"][number] => ({
    changed: file.changed,
    fileKind: file.file_kind,
    path: file.path,
    taskId: file.task_id,
  });
  return {
    changedFiles: result.changed_files.map(mapFileResult),
    normalizedTaskIds: result.normalized_task_ids,
    root: result.root,
    unchangedFiles: result.unchanged_files.map(mapFileResult),
  };
}

export async function initTaskGraphProcedure(
  params: RpcInitTaskGraphRequest = {},
  worktreePath: string,
  context?: RpcRequestContext,
): Promise<RpcInitTaskGraphResult> {
  requireAdminContext(context);
  const result = await initTaskGraphFilesystem(
    resolveTaskGraphRootPath(worktreePath),
    {
      ...(typeof params.createTagsRegistry === "boolean"
        ? { createTagsRegistry: params.createTagsRegistry }
        : {}),
      ...(typeof params.createTypesRegistry === "boolean"
        ? { createTypesRegistry: params.createTypesRegistry }
        : {}),
      ...(typeof params.idPrefix === "string"
        ? { idPrefix: params.idPrefix }
        : {}),
      ...(typeof params.strictTags === "boolean"
        ? { strictTags: params.strictTags }
        : {}),
      ...(typeof params.strictTypes === "boolean"
        ? { strictTypes: params.strictTypes }
        : {}),
    },
  );
  return toRpcInitTaskGraphResult(result);
}

export async function validateTaskGraphProcedure(
  params: RpcValidateTaskGraphRequest = {},
  worktreePath: string,
  context?: RpcRequestContext,
): Promise<RpcValidateTaskGraphResult> {
  requireAdminContext(context);
  const result = await validateTaskGraphFilesystem(
    resolveTaskGraphRootPath(worktreePath),
    {
      ...(params.taskIds ? { taskIds: params.taskIds } : {}),
    },
  );
  return toRpcValidateTaskGraphResult(result);
}

export async function normalizeTaskGraphProcedure(
  params: RpcNormalizeTaskGraphRequest = {},
  worktreePath: string,
  context?: RpcRequestContext,
): Promise<RpcNormalizeTaskGraphResult> {
  requireAdminContext(context);
  const result = await normalizeTaskGraphFilesystem(
    resolveTaskGraphRootPath(worktreePath),
    {
      ...(params.taskIds ? { taskIds: params.taskIds } : {}),
    },
  );
  return toRpcNormalizeTaskGraphResult(result);
}

export function createPiMetidosToolHost(
  ownerUserId: number,
  options?: {
    syncCronSchedulerCron?: (cronJobId: number) => void;
    taskGraphAdmin?: boolean;
  },
): PiMetidosToolHost {
  const ownerUser = getUserById(db, ownerUserId);
  const syncCron = options?.syncCronSchedulerCron ?? syncCronSchedulerCron;
  const taskGraphAdmin = options?.taskGraphAdmin ?? ownerUser?.isAdmin ?? false;
  return {
    capabilities: {
      taskGraphAdmin,
    },
    createThread: (params) =>
      createThreadProcedure(params, createPiToolRequestContext(ownerUserId)),
    focusContext: (params, signal) =>
      focusContextProcedure(
        params,
        createPiToolRequestContext(ownerUserId, signal),
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
    listThreads: () =>
      listThreadsProcedure(undefined, createPiToolRequestContext(ownerUserId)),
    initTaskGraph: (params, worktreePath) =>
      initTaskGraphProcedure(
        params,
        worktreePath,
        createPiToolRequestContext(ownerUserId),
      ),
    newCron: async (params) => {
      const cron = await newCronProcedure(
        params,
        createPiToolRequestContext(ownerUserId),
      );
      syncCron(cron.id);
      return cron;
    },
    normalizeTaskGraph: (params, worktreePath) =>
      normalizeTaskGraphProcedure(
        params,
        worktreePath,
        createPiToolRequestContext(ownerUserId),
      ),
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
    validateTaskGraph: (params, worktreePath) =>
      validateTaskGraphProcedure(
        params,
        worktreePath,
        createPiToolRequestContext(ownerUserId),
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

  updateThreadPiSessionState(db, thread.id, nextState);
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
  const userId = authUserId(context);
  const thread =
    typeof userId === "number"
      ? getThreadByIdForUser(db, userId, threadId)
      : getThreadById(db, threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
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
  },
): Promise<RpcThreadDetail> {
  const thread = threadById(threadId);
  const page = listThreadMessagesPage(db, thread.id, {
    cursor: options?.cursor ?? null,
    limit: THREAD_DETAIL_PAGE_MESSAGE_LIMIT,
  });
  return {
    thread: toRpcThread(thread, currentThreadRunStatus(thread)),
    messages: toRpcThreadMessages(page.messages),
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
): Promise<RpcThreadDetail> {
  const cached = readLruValue(threadDetailCache, threadId);
  if (cached) {
    return {
      ...cached,
      thread: applyActiveThreadRuntimeTelemetry(cached.thread),
    };
  }

  const detail = await buildThreadDetailRaw(threadId);
  writeLruValue(
    threadDetailCache,
    threadId,
    detail,
    THREAD_DETAIL_CACHE_MAX_ENTRIES,
  );
  return {
    ...detail,
    thread: applyActiveThreadRuntimeTelemetry(detail.thread),
  };
}
/**
 * Performs warmThreadDetailCache operation.
 * @param threadId - Thread identifier.
 */

function warmThreadDetailCache(threadId: number): void {
  void readThreadDetailCached(threadId).catch((error) => {
    console.error(`Failed to warm thread detail cache for ${threadId}`, error);
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
  stopInProgressThreadMessages(db, threadId);
  invalidateThreadDetailCache(threadId);
  markThreadStopped(db, threadId, message);
  setThreadRunStatus(threadId, {
    state: "stopped",
    startedAt,
    updatedAt: getNow(),
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
const THREAD_FINAL_EVENT_GRACE_MS = 50;

export function missingAssistantResponseErrorMessage(
  model: string | null | undefined,
): string {
  const baseMessage =
    "Thread run completed without returning an assistant response.";
  if (codexModelProvider(model) === "xai") {
    return `${baseMessage} The xAI provider may have stopped after reasoning without emitting a final answer or tool call.`;
  }
  return baseMessage;
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
  startedAt: string,
  controller: AbortController,
  sessionId: string | null,
): Promise<void> {
  let lastAssistantText = "";
  let lastAssistantItemId: string | null = null;
  let usage: RpcThreadUsage | null = null;
  const bufferedActivityWriter = createBufferedThreadActivityWriter();

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
      void runtime.session.abort();
    };
    controller.signal.addEventListener("abort", abortPiRuntime, { once: true });

    let promptError: unknown = null;
    try {
      await runtime.session.prompt(input);
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
        const trailingAssistantMessage = [...runtime.session.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        const trailingAssistantText = (
          lastAssistantText ||
          extractPiAssistantMessageText(trailingAssistantMessage).trim()
        ).trim();
        if (trailingAssistantText || Date.now() >= settleDeadline) {
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

    const lastAssistantMessage = [...runtime.session.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const projectionSnapshot = piEventProjector.snapshot();
    lastAssistantItemId = projectionSnapshot.lastAssistantItemId;
    lastAssistantText = projectionSnapshot.lastAssistantText;
    usage = projectionSnapshot.usage ?? usage;
    usage = extractPiAssistantUsage(lastAssistantMessage) ?? usage;
    const finalAssistantTextCandidate =
      lastAssistantText ||
      extractPiAssistantMessageText(lastAssistantMessage).trim();
    const finalAssistantText = requireAssistantResponseText(
      finalAssistantTextCandidate,
      thread.model,
    );
    syncPiThreadSessionState(threadById(threadId), runtime);
    if (lastAssistantItemId && lastAssistantText.trim()) {
      await upsertAssistantChatActivity(
        threadId,
        lastAssistantItemId,
        finalAssistantText,
        "completed",
      );
    } else {
      createThreadMessage(db, {
        threadId,
        role: "assistant",
        text: finalAssistantText,
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
      setThreadUsage(db, threadId, persistedUsage ?? usage, {
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
    markThreadRan(db, threadId);
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
      console.error(
        `Failed to flush buffered thread activity for thread ${threadId}`,
        flushError,
      );
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
    markThreadFailed(db, threadId, errorMessage);
    setThreadRunStatus(threadId, {
      state: "failed",
      startedAt,
      updatedAt: getNow(),
      error: errorMessage,
      hasUnreadError: true,
    });
    console.error(`Thread run failed for thread ${threadId}`, error);
  } finally {
    if (threadTurnAbortControllerMap.get(threadId) === controller) {
      threadTurnAbortControllerMap.delete(threadId);
    }
    threadTurnCompletionMap.delete(threadId);
  }
}
/**
 * Performs worktreePathFromName operation.
 * @param projectPath - projectPath path used by worktreePathFromName.
 * @param worktreeName - Worktree name to resolve into a filesystem path.
 */

function worktreePathFromName(
  projectPath: string,
  worktreeName: string,
): string {
  const token = worktreeName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!token) {
    throw new Error("Worktree name must contain at least one valid character.");
  }

  return resolve(dirname(projectPath), `${basename(projectPath)}-${token}`);
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
  const scope = workspacePathScopeForContext(context);
  return {
    directories: listDirectorySuggestions(params.query, {
      homeDirectory: scope.homeDirectory,
      rootDirectory: scope.restrictedRoot,
      supportsTildePath: scope.supportsTildePath,
    }),
  };
}
/**
 * Performs assertProjectDirectory operation.
 * @param projectPath - projectPath path used by assertProjectDirectory.
 */

function assertProjectDirectory(
  projectPath: string,
  scope: WorkspacePathScope,
): void {
  const displayPath = formatWorkspacePathForUser(projectPath, scope);
  if (!existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${displayPath}`);
  }
  if (!safeIsDirectory(projectPath)) {
    throw new Error(`Project path must be a directory: ${displayPath}`);
  }
}
/**
 * Performs logBackgroundGitFailure operation.
 * @param message - Message payload.
 * @param error - Error value to process.
 */

function logBackgroundGitFailure(message: string, error: unknown): void {
  if (isAbortError(error)) {
    return;
  }

  console.error(message, error);
}

type BufferedThreadActivityWrite = {
  buildInputs: () => Promise<ThreadActivityInput[]>;
  lastPersistedAt: number;
  lastPersistedSignature: string | null;
  messageIds: Array<number | null>;
  persisted: boolean;
  signature: string;
  terminal: boolean;
};

function createBufferedThreadActivityWriter(): {
  flushAll: () => Promise<void>;
  queue: (
    activityId: string,
    signature: string,
    buildInputs: () => Promise<ThreadActivityInput[]>,
    options?: {
      force?: boolean;
      terminal?: boolean;
    },
  ) => Promise<void>;
} {
  const entries = new Map<string, BufferedThreadActivityWrite>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushChain = Promise.resolve();

  const clearFlushTimer = (): void => {
    if (!flushTimer) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const scheduleFlush = (): void => {
    if (flushTimer || entries.size === 0) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void enqueueFlush(false);
    }, COMMAND_ACTIVITY_FLUSH_INTERVAL_MS);
  };

  /**
   * Performs flushEntries operation.
   * @param force - Whether to force immediate persistence.
   */

  const flushEntries = async (force: boolean): Promise<void> => {
    const now = Date.now();
    let needsReschedule = false;
    const dueEntries: Array<{
      activityId: string;
      entry: BufferedThreadActivityWrite;
      signatureChanged: boolean;
    }> = [];

    for (const [activityId, entry] of entries) {
      const dueToFlush =
        force ||
        !entry.persisted ||
        entry.terminal ||
        now - entry.lastPersistedAt >= COMMAND_ACTIVITY_FLUSH_INTERVAL_MS;
      if (!dueToFlush) {
        needsReschedule = true;
        continue;
      }

      const signatureChanged =
        !entry.persisted || entry.lastPersistedSignature !== entry.signature;
      dueEntries.push({ activityId, entry, signatureChanged });
    }

    const entriesToPersist = dueEntries.filter(
      ({ signatureChanged }) => signatureChanged,
    );
    if (entriesToPersist.length > 0) {
      const resolvedEntries = await Promise.all(
        entriesToPersist.map(async ({ entry }) => ({
          entry,
          inputs: await entry.buildInputs(),
        })),
      );

      const flattenedInputs: ThreadActivityInput[] = [];
      const flattenedMessageIds: Array<number | null> = [];
      for (const { entry, inputs } of resolvedEntries) {
        flattenedInputs.push(...inputs);
        flattenedMessageIds.push(
          ...inputs.map((_, index) => entry.messageIds[index] ?? null),
        );
      }

      if (flattenedInputs.length > 0) {
        const persistStartedAt = performance.now();
        const persistedMessageIds = upsertThreadActivities(
          db,
          flattenedInputs.map((input, index) => ({
            ...input,
            messageId: flattenedMessageIds[index] ?? null,
          })),
        );
        recordThreadActivityPersistenceDuration(
          Math.max(0, performance.now() - persistStartedAt),
        );
        const affectedThreadIds = new Set<number>();
        let nextMessageIdIndex = 0;

        for (const { entry, inputs } of resolvedEntries) {
          entry.messageIds = persistedMessageIds.slice(
            nextMessageIdIndex,
            nextMessageIdIndex + inputs.length,
          );
          nextMessageIdIndex += inputs.length;
          for (const input of inputs) {
            affectedThreadIds.add(input.threadId);
          }
        }

        for (const threadId of affectedThreadIds) {
          invalidateThreadDetailCache(threadId);
        }
      }
    }

    const persistedAt = Date.now();
    for (const { activityId, entry, signatureChanged } of dueEntries) {
      if (signatureChanged) {
        entry.lastPersistedSignature = entry.signature;
      }
      entry.lastPersistedAt = persistedAt;
      entry.persisted = true;

      if (entry.terminal) {
        entries.delete(activityId);
      }
    }

    if (needsReschedule || entries.size > 0) {
      scheduleFlush();
    }
  };

  /**
   * Performs enqueueFlush operation.
   * @param force - Whether to schedule an immediate flush cycle.
   */

  const enqueueFlush = (force: boolean): Promise<void> => {
    flushChain = flushChain.then(() => flushEntries(force));
    return flushChain;
  };

  return {
    flushAll: async (): Promise<void> => {
      clearFlushTimer();
      try {
        await enqueueFlush(true);
      } finally {
        clearFlushTimer();
      }
    },
    queue: async (
      activityId: string,
      signature: string,
      buildInputs: () => Promise<ThreadActivityInput[]>,
      options?: {
        force?: boolean;
        terminal?: boolean;
      },
    ): Promise<void> => {
      const entry = entries.get(activityId) ?? {
        buildInputs,
        lastPersistedAt: 0,
        lastPersistedSignature: null,
        messageIds: [],
        persisted: false,
        signature,
        terminal: false,
      };
      entry.buildInputs = buildInputs;
      entry.signature = signature;
      entry.terminal = options?.terminal === true;
      entries.set(activityId, entry);

      const shouldFlushNow =
        options?.force === true || options?.terminal === true;
      if (shouldFlushNow) {
        clearFlushTimer();
        await enqueueFlush(true);
        return;
      }

      scheduleFlush();
    },
  };
}
/**
 * Performs persistThreadActivityInputs operation.
 * @param inputs - Activity input records queued for persistence.
 */

function persistThreadActivityInputs(
  inputs: readonly ThreadActivityInput[],
): void {
  const persistStartedAt = performance.now();
  const persistedMessageIds = upsertThreadActivities(
    db,
    inputs.map((input) => ({
      ...input,
      messageId: null,
    })),
  );
  recordThreadActivityPersistenceDuration(
    Math.max(0, performance.now() - persistStartedAt),
  );
  if (persistedMessageIds.length === 0) {
    return;
  }

  const affectedThreadIds = new Set(inputs.map((input) => input.threadId));
  for (const threadId of affectedThreadIds) {
    invalidateThreadDetailCache(threadId);
  }
}

async function queueProjectedPiActivities(
  bufferedActivityWriter: ReturnType<typeof createBufferedThreadActivityWriter>,
  writes: readonly ProjectedPiActivityWrite[],
): Promise<void> {
  for (const write of writes) {
    await bufferedActivityWriter.queue(
      write.activityId,
      write.signature,
      async () => write.inputs,
      {
        ...(write.force === true ? { force: true } : {}),
        ...(write.terminal === true ? { terminal: true } : {}),
      },
    );
  }
}
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
 * Merges project worktree pins.
 * @param projectId - Project identifier.
 * @param worktrees - Worktree descriptors to merge into pinning metadata.
 */

function splitProjectWorktreesForVisibility(
  projectPath: string,
  projectId: number,
  worktrees: RpcWorktree[],
  includeHidden: boolean,
): ProjectWorktreeListing {
  const trackedWorktreePaths = new Map(
    listProjectWorktreesMetadata(db, projectId).map((record) => [
      record.worktreePath,
      record.pinnedAt,
    ]),
  );

  const visibleWorktrees: RpcWorktree[] = [];
  const hiddenWorktrees: RpcWorktree[] = [];

  for (const worktree of worktrees) {
    const nextWorktree = {
      ...worktree,
      pinnedAt: trackedWorktreePaths.get(worktree.path) ?? null,
    } satisfies RpcWorktree;
    if (
      worktree.path === projectPath ||
      trackedWorktreePaths.has(worktree.path)
    ) {
      visibleWorktrees.push(nextWorktree);
      continue;
    }
    if (includeHidden) {
      hiddenWorktrees.push(nextWorktree);
    }
  }

  return {
    hiddenWorktrees,
    worktrees: visibleWorktrees,
  };
}

function filterProjectWorktreesForAccess(
  projectId: number | undefined,
  worktrees: RpcWorktree[],
): RpcWorktree[] {
  if (typeof projectId !== "number") {
    return worktrees;
  }

  const project = getProjectById(db, projectId);
  if (!project) {
    return worktrees;
  }

  const scope = workspacePathScopeForProject(project);
  if (!scope.restrictedRoot) {
    return worktrees;
  }

  return worktrees.filter((worktree) =>
    isWorkspacePathAllowed(worktree.path, scope),
  );
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
  const worktrees = filterProjectWorktreesForAccess(
    projectId,
    await listGitWorktreesForProjectPath(projectPath, options),
  );
  if (typeof projectId !== "number") {
    return {
      hiddenWorktrees: [],
      worktrees,
    };
  }
  return splitProjectWorktreesForVisibility(
    projectPath,
    projectId,
    worktrees,
    options?.includeHidden === true,
  );
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
  state.worktrees = worktrees;
  state.worktreesLoadedAt = Date.now();

  const activeWorktrees = new Set(worktrees.map((w) => w.path));
  for (const [wtPath] of state.openWorktrees) {
    if (!activeWorktrees.has(wtPath)) {
      stopWorktreePolling(state, wtPath);
    }
  }
  if (
    state.activeWorktreePath !== null &&
    !activeWorktrees.has(state.activeWorktreePath)
  ) {
    state.activeWorktreePath = null;
  }
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
    state = {
      id: project.id,
      project,
      projectPath: project.path,
      worktrees: [],
      worktreesLoadedAt: 0,
      activeWorktreePath: null,
      projectTimer: null,
      openWorktrees: new Map(),
    };
    projectPollMap.set(project.id, state);
  }

  state.project = project;
  state.projectPath = project.path;
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
  const active = state.openWorktrees.get(worktreePath);
  if (!active) return;

  stopWorktreeBackgroundPolling(
    active,
    `Stopped worktree polling for ${worktreePath}.`,
  );
  state.openWorktrees.delete(worktreePath);
}
/**
 * Creates worktree poll state.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 */

function createWorktreePollState(
  projectId: number,
  worktreePath: string,
): WorktreePollState {
  const lastUpdatedAt = getNow();
  return {
    changes: [],
    diff: [],
    files: [],
    history: {
      projectId,
      worktreePath,
      branch: null,
      headHash: null,
      headShortHash: null,
      lastUpdatedAt,
    },
    historyEntries: [],
    historyNextOffset: null,
    historyPolling: false,
    historyPrefetch: null,
    historySignature: null,
    historyTimer: null,
    lastUpdatedAt,
  };
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
  const existing = state.openWorktrees.get(worktreePath);
  if (existing) {
    return existing;
  }

  const worktreeState = createWorktreePollState(state.id, worktreePath);
  state.openWorktrees.set(worktreePath, worktreeState);
  return worktreeState;
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
  if (worktreeState.historyTimer) {
    clearInterval(worktreeState.historyTimer);
    worktreeState.historyTimer = null;
  }
  abortGitHistoryPrefetch(worktreeState, reason);
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
  const worktreeState = ensureWorktreePollState(state, worktreePath);
  if (worktreeState.historyTimer) {
    return worktreeState;
  }

  const pollGitHistory = async () => {
    if (worktreeState.historyPolling) {
      return;
    }
    worktreeState.historyPolling = true;
    try {
      const previousSignature = worktreeState.historySignature;
      const { history, signature } = await readGitHistorySummary(
        state.id,
        worktreePath,
        "background",
      );
      worktreeState.history = history;
      if (previousSignature !== null && previousSignature !== signature) {
        worktreeState.historyEntries = [];
        worktreeState.historyNextOffset = null;
        abortGitHistoryPrefetch(
          worktreeState,
          `Git history signature changed for ${worktreePath}.`,
        );
      }
      worktreeState.historySignature = signature;
      worktreeState.lastUpdatedAt = history.lastUpdatedAt;

      if (previousSignature !== null && previousSignature !== signature) {
        worktreeGitHistoryChangeListener?.(state.id, worktreePath);
      }
    } catch (error) {
      logBackgroundGitFailure(
        `Git history poll failed for ${worktreePath}`,
        error,
      );
    } finally {
      worktreeState.historyPolling = false;
    }
  };

  worktreeState.historyTimer = setInterval(() => {
    void pollGitHistory();
  }, GIT_HISTORY_POLL_INTERVAL_MS);

  void pollGitHistory();

  return worktreeState;
}
/**
 * Performs syncProjectWorktreeBackgroundPolling operation.
 * @param state - Current state value.
 */

function syncProjectWorktreeBackgroundPolling(state: ProjectPollState): void {
  if (hasForegroundReadPressure()) {
    for (const [worktreePath, worktreeState] of state.openWorktrees) {
      stopWorktreeBackgroundPolling(
        worktreeState,
        `Foreground read pressure paused worktree polling for ${worktreePath}.`,
      );
    }
    return;
  }

  for (const [worktreePath, worktreeState] of state.openWorktrees) {
    if (state.activeWorktreePath === worktreePath) {
      startWorktreeGitHistoryPolling(state, worktreePath);
      continue;
    }

    stopWorktreeBackgroundPolling(
      worktreeState,
      `Worktree ${worktreePath} is no longer the active view.`,
    );
  }
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
  const userId = authUserId(context);
  const project =
    typeof userId === "number"
      ? getProjectByIdForUser(db, userId, projectId)
      : getProjectById(db, projectId);
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
  const userId = authUserId(context);
  const cronJob =
    typeof userId === "number"
      ? getCronJobByIdForUser(db, userId, cronJobId, options)
      : getCronJobById(db, cronJobId, options);
  if (cronJob) {
    projectByIdForPath(cronJob.projectId, context);
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
  const listing = await readProjectWorktreeListing(project.path, project.id, {
    ...options,
    includeHidden: true,
  });
  return (
    [...listing.worktrees, ...listing.hiddenWorktrees].find(
      (entry) => entry.path === worktreePath,
    ) ?? null
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
/**
 * Performs trackedProjectWorktree operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 */

function trackedProjectWorktree(
  state: ProjectPollState,
  worktreePath: string,
): RpcWorktree | null {
  return state.worktrees.find((entry) => entry.path === worktreePath) ?? null;
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
 * Creates thread record.
 * @param project - Project associated with the new thread record.
 * @param worktreePath - Worktree path.
 * @param model - Model identifier assigned to the new thread record.
 * @param reasoningEffort - Reasoning effort assigned to the new thread record.
 * @param access - Access level assigned at thread creation time.
 * @param options - Configuration options used by this operation.
 */

async function createThreadRecord(
  project: ProjectRecord,
  worktreePath: string,
  model: string,
  reasoningEffort: RpcReasoningEffort,
  access: ThreadAccessControls,
  options?: CreateThreadRecordOptions,
): Promise<ThreadRecord> {
  const worktree = await assertProjectWorktree(project, worktreePath, {
    ...options,
    forceRefresh: true,
  });

  const thread = await withSqliteRetry(() =>
    createThread(db, {
      projectId: project.id,
      worktreePath,
      title: buildThreadTitle(worktree, worktreePath),
      model,
      reasoningEffort,
      webSearchAccess: access.webSearchAccess,
      githubAccess: access.githubAccess,
      agentsAccess: access.agentsAccess,
      metidosAccess: access.metidosAccess,
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
  assertProjectDirectory(projectPath, workspaceScope);
  const userId = authUserId(context);
  const existingProject =
    typeof userId === "number"
      ? getProjectForUser(db, userId, projectPath)
      : getProject(db, projectPath);

  let worktrees: RpcWorktree[];
  try {
    if (existingProject) {
      worktrees = await readProjectWorktrees(
        projectPath,
        existingProject.id,
        requestGitOptions,
      );
    } else {
      await listGitWorktreesForProjectPath(projectPath, requestGitOptions);
      worktrees = [];
    }
  } catch (error) {
    if (params.initGitIfNeeded === true) {
      await runGitCommand(projectPath, ["init"], requestGitOptions);
      if (existingProject) {
        worktrees = await readProjectWorktrees(
          projectPath,
          existingProject.id,
          {
            ...requestGitOptions,
            forceRefresh: true,
          },
        );
      } else {
        worktrees = [];
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Project folder must be a git repository root or worktree: ${formatWorkspacePathForUser(projectPath, workspaceScope)}${message ? ` (${message})` : ""}`,
      );
    }
  }

  const project = upsertProject(db, {
    ...(typeof userId === "number" ? { ownerUserId: userId } : {}),
    projectPath,
    name: params.name ?? basename(projectPath),
  });
  if (!existingProject) {
    worktrees = await readProjectWorktrees(projectPath, project.id, {
      ...requestGitOptions,
      forceRefresh: true,
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
    const results: RpcOpenProjectsBatchResultItem[] = [];

    for (const project of params.projects) {
      throwIfAborted(context?.signal, "Project restore was aborted.");
      try {
        const opened = await awaitAbortableResult(
          openProjectWithGitOptions(project, requestGitOptions, context),
          context?.signal,
          "Project restore was aborted.",
        );
        results.push({
          ok: true,
          projectId: project.projectId,
          project: opened.project,
          worktrees: opened.worktrees,
        });
      } catch (error) {
        results.push({
          ok: false,
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
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
  const worktreeName = params.name.trim();
  if (!worktreeName) {
    throw new Error("Worktree name is required.");
  }

  const worktreePath = worktreePathFromName(project.path, worktreeName);
  assertWorkspacePathAllowed(worktreePath, projectScope);
  if (existsSync(worktreePath)) {
    throw new Error(
      `Worktree path already exists: ${formatWorkspacePathForUser(worktreePath, projectScope)}`,
    );
  }

  await runGitCommand(project.path, [
    "worktree",
    "add",
    "-b",
    worktreeName,
    worktreePath,
  ]);

  ensureProjectWorktreeVisible(db, project.id, worktreePath);

  const listing = await readProjectWorktreeListing(project.path, project.id, {
    forceRefresh: true,
  });
  return {
    hiddenWorktrees: listing.hiddenWorktrees,
    project,
    worktrees: listing.worktrees,
    worktreePath,
  };
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
  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });

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

export async function createThreadProcedure(
  params: AppRPCSchema["requests"]["createThread"]["params"],
  context?: RpcRequestContext,
  options?: {
    allowPreauthorizedUnsafeMode?: boolean;
  },
): Promise<RpcThreadDetail> {
  const project = projectByIdForPath(params.projectId, context);
  const worktreePath = normalizeRequestedWorkspacePath(
    params.worktreePath,
    context,
  );
  const model = resolveRunnableCodexModel(params.model);
  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  const access = resolveThreadAccessControls(params, context, options);
  const thread = await createThreadRecord(
    project,
    worktreePath,
    model,
    reasoningEffort,
    access,
    {
      forceRefresh: true,
      sessionId: context?.auth.sessionId ?? null,
    },
  );
  recordCrossWorkspaceThreadAuditEvent(db, {
    params,
    thread,
  });
  return readThreadDetailCached(thread.id);
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

  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });
  const access = resolveThreadAccessControls(params, context);

  return {
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
    agentsAccess: access.agentsAccess,
    metidosAccess: access.metidosAccess,
    unsafeMode: access.unsafeMode,
    autoStart: params.autoStart ?? null,
    threadId: null,
    title: null,
    summary: null,
    pinned: null,
    pinnedAt: null,
    createdAt: new Date().toISOString(),
  };
}

const MAX_CRON_TITLE_LENGTH = 72;
const MAX_CRON_DESCRIPTION_LENGTH = 240;

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

function normalizeCronJobReasoningEffort(cronJob: CronJobRecord): RpcCronJob {
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
  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });
  const prompt = params.prompt.trim();
  const schedule = params.schedule.trim();
  const model = resolveRunnableCodexModel(params.model);
  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  const access = resolveThreadAccessControls(params, context);
  if (!schedule) {
    throw new Error("Cron schedule is required.");
  }
  if (!prompt) {
    throw new Error("Cron prompt is required.");
  }
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

  return normalizeCronJobReasoningEffort(
    createCronJob(db, {
      projectId: project.id,
      worktreePath,
      schedule,
      prompt,
      webSearchAccess: access.webSearchAccess,
      githubAccess: access.githubAccess,
      agentsAccess: access.agentsAccess,
      metidosAccess: access.metidosAccess,
      unsafeMode: access.unsafeMode,
      title,
      description,
      model,
      reasoningEffort,
      enabled: params.enabled ?? null,
    }),
  );
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
      softDeleteCronJob(db, current.id);
      return normalizeCronJobReasoningEffort(
        cronJobById(current.id, context) ?? current,
      );
    }
    return normalizeCronJobReasoningEffort(current);
  }

  if (current.deletedAt !== null) {
    throw new Error("Deleted cron jobs cannot be modified.");
  }

  if (params.deleted === false) {
    throw new Error("Cannot undelete cron jobs.");
  }

  const updates: {
    webSearchAccess?: boolean;
    schedule?: string;
    prompt?: string;
    title?: string;
    description?: string;
    model?: string;
    reasoningEffort?: string;
    githubAccess?: boolean;
    agentsAccess?: boolean;
    metidosAccess?: boolean;
    enabled?: boolean;
    unsafeMode?: boolean;
  } = {};

  if (typeof params.model !== "undefined") {
    updates.model = resolveRunnableCodexModel(params.model);
  }

  if (typeof params.reasoningEffort !== "undefined") {
    updates.reasoningEffort = resolveCodexReasoningEffort(
      params.reasoningEffort,
    );
  }

  if (typeof params.webSearchAccess === "boolean") {
    updates.webSearchAccess = params.webSearchAccess;
  }

  if (typeof params.githubAccess === "boolean") {
    updates.githubAccess = params.githubAccess;
  }

  if (typeof params.agentsAccess === "boolean") {
    updates.agentsAccess = params.agentsAccess;
  }

  if (typeof params.metidosAccess === "boolean") {
    updates.metidosAccess = params.metidosAccess;
  }

  if (typeof params.schedule !== "undefined") {
    const schedule = params.schedule.trim();
    if (!schedule) {
      throw new Error("Cron schedule is required.");
    }
    updates.schedule = schedule;
  }

  if (typeof params.prompt !== "undefined") {
    const prompt = params.prompt.trim();
    if (!prompt) {
      throw new Error("Cron prompt is required.");
    }
    updates.prompt = prompt;
  }

  if (typeof params.title !== "undefined") {
    const title = params.title.trim();
    if (!title) {
      throw new Error("Cron title is required.");
    }
    updates.title = title;
  }

  if (typeof params.description !== "undefined") {
    const description = params.description.trim();
    if (!description) {
      throw new Error("Cron description is required.");
    }
    updates.description = description;
  }

  if (typeof params.enabled === "boolean") {
    updates.enabled = params.enabled;
  }

  if (typeof params.unsafeMode === "boolean") {
    if (params.unsafeMode) {
      requireUnsafeModeAllowed(context);
    }
    updates.unsafeMode = params.unsafeMode;
  }

  if (
    typeof updates.schedule === "undefined" &&
    typeof updates.prompt === "undefined" &&
    typeof updates.title === "undefined" &&
    typeof updates.description === "undefined" &&
    typeof updates.model === "undefined" &&
    typeof updates.reasoningEffort === "undefined" &&
    typeof updates.webSearchAccess === "undefined" &&
    typeof updates.githubAccess === "undefined" &&
    typeof updates.agentsAccess === "undefined" &&
    typeof updates.metidosAccess === "undefined" &&
    typeof updates.unsafeMode === "undefined" &&
    typeof updates.enabled === "undefined"
  ) {
    throw new Error("At least one update field is required.");
  }

  return normalizeCronJobReasoningEffort(
    updateCronJob(db, current.id, updates),
  );
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

  if (cronJob.enabled !== 1) {
    throw new Error("Cannot run a disabled cron job.");
  }

  const threadId = await runCronNowInScheduler(cronJob.id);
  if (threadId === null) {
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
    .map(normalizeCronJobReasoningEffort);
}
/**
 * Gets thread procedure.
 * @param params - Parameters object.
 */

export async function getThreadProcedure(
  params: AppRPCSchema["requests"]["getThread"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  threadById(params.threadId, context);
  if (typeof params.cursor === "number") {
    return buildThreadDetail(params.threadId, {
      cursor: params.cursor,
    });
  }

  return readThreadDetailCached(params.threadId);
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
  markThreadErrorSeen(db, thread.id);
  const currentStatus = currentThreadRunStatus(thread);
  setThreadRunStatus(thread.id, {
    ...currentStatus,
    hasUnreadError: false,
  });
  return readThreadDetailCached(thread.id);
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
  const input = params.input.trim();
  if (!input) {
    throw new Error("Thread input is required.");
  }

  return queueThreadMessage(thread, input, context?.auth.sessionId ?? null);
}
/**
 * Performs queueThreadMessage operation.
 * @param thread - Target thread receiving the message to queue.
 * @param input - Raw input payload for the queued message.
 */

async function queueThreadMessage(
  thread: ThreadRecord,
  input: string,
  sessionId: string | null,
): Promise<RpcThreadDetail> {
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error("Thread is already processing a message.");
  }
  assertCodexModelProviderAvailable(thread.model);
  const startedAt = getNow();
  await withSqliteRetry(() => {
    return runImmediateSqliteTransaction(() => {
      markThreadErrorSeen(db, thread.id);
      createThreadMessage(db, {
        threadId: thread.id,
        role: "user",
        text: input,
      });
      markThreadRunStarted(db, thread.id, startedAt);
    });
  });

  const controller = new AbortController();
  threadTurnAbortControllerMap.set(thread.id, controller);
  setThreadRunStatus(thread.id, {
    state: "working",
    startedAt,
    updatedAt: startedAt,
    error: null,
    hasUnreadError: false,
  });

  const completion = runThreadMessageInBackground(
    thread.id,
    input,
    startedAt,
    controller,
    sessionId,
  );
  threadTurnCompletionMap.set(thread.id, completion);
  void completion;

  return readThreadDetailCached(thread.id);
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
  const snapshot = await readWorktreeSnapshot(worktreePath, options);
  worktreeState.changes = snapshot.changes;
  worktreeState.diff = snapshot.diff;
  worktreeState.files = snapshot.files;
  worktreeState.lastUpdatedAt = snapshot.lastUpdatedAt;

  return {
    path: worktreePath,
    ...snapshot,
  };
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
  if (currentThreadRunStatus(thread).state !== "working") {
    return readThreadDetailCached(thread.id);
  }

  const controller = threadTurnAbortControllerMap.get(thread.id);
  if (!controller) {
    throw new Error(
      "Thread stop is unavailable because no active run was found.",
    );
  }

  if (!controller.signal.aborted) {
    controller.abort(createAbortError(null, THREAD_STOPPED_MESSAGE));
  }

  await threadTurnCompletionMap.get(thread.id);
  return readThreadDetailCached(thread.id);
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
  if (
    typeof params.title === "undefined" &&
    typeof params.summary === "undefined" &&
    typeof params.pinned === "undefined"
  ) {
    throw new Error("At least one thread metadata field is required.");
  }

  const normalizedTitle =
    typeof params.title === "undefined" ? undefined : params.title.trim();
  if (typeof normalizedTitle !== "undefined" && !normalizedTitle) {
    throw new Error("Thread title is required.");
  }

  const normalizedSummary =
    typeof params.summary === "undefined"
      ? undefined
      : params.summary?.trim() || null;
  if (
    typeof normalizedTitle !== "undefined" ||
    typeof normalizedSummary !== "undefined"
  ) {
    renameThread(
      db,
      thread.id,
      normalizedTitle ?? thread.title,
      normalizedSummary,
    );
  }

  if (typeof params.pinned === "boolean") {
    setThreadPinned(db, thread.id, params.pinned);
  }

  invalidateThreadDetailCache(thread.id);
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
  setThreadModel(db, thread.id, model);
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
  setThreadReasoningEffort(db, thread.id, reasoningEffort);
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

  const next = {
    webSearchAccess:
      typeof params.webSearchAccess === "boolean"
        ? params.webSearchAccess
        : thread.webSearchAccess,
    githubAccess:
      typeof params.githubAccess === "boolean"
        ? params.githubAccess
        : thread.githubAccess,
    agentsAccess:
      typeof params.agentsAccess === "boolean"
        ? params.agentsAccess
        : thread.agentsAccess,
    metidosAccess:
      typeof params.metidosAccess === "boolean"
        ? params.metidosAccess
        : thread.metidosAccess,
    unsafeMode:
      typeof params.unsafeMode === "boolean"
        ? params.unsafeMode
        : thread.unsafeMode === 1,
  };
  if (next.unsafeMode) {
    requireUnsafeModeAllowed(context);
  }

  if (
    next.webSearchAccess === thread.webSearchAccess &&
    next.githubAccess === thread.githubAccess &&
    next.agentsAccess === thread.agentsAccess &&
    next.metidosAccess === thread.metidosAccess &&
    next.unsafeMode === (thread.unsafeMode === 1)
  ) {
    return rpcThreadById(thread.id, context);
  }

  setThreadAccess(db, thread.id, next);
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

export async function updateThreadUnsafeModeProcedure(
  params: AppRPCSchema["requests"]["updateThreadUnsafeMode"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThread> {
  const thread = threadById(params.threadId, context);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error(
      "Thread unsafe mode cannot change while a run is processing.",
    );
  }

  const unsafeMode = resolveUnsafeMode(params.unsafeMode);
  if (unsafeMode) {
    requireUnsafeModeAllowed(context);
  }
  if ((thread.unsafeMode === 1) === unsafeMode) {
    return rpcThreadById(thread.id, context);
  }

  setThreadUnsafeMode(db, thread.id, unsafeMode);
  recordUnsafeModeAuditEvent(thread, unsafeMode, "toggle");
  disposePiThreadRuntime(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id, context);
}
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
  deleteThread(db, thread.id);
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
  const userId = authUserId(context);
  const thread =
    typeof userId === "number"
      ? getThreadByIdForUser(db, userId, params.threadId)
      : getThreadById(db, params.threadId);
  if (!thread || currentThreadRunStatus(thread).state === "working") {
    return {
      threadId: params.threadId,
      discarded: false,
    };
  }

  const messages = listThreadMessages(db, thread.id);
  if (thread.lastRunAt !== null || messages.length > 0) {
    return {
      threadId: thread.id,
      discarded: false,
    };
  }

  clearThreadRuntimeState(thread.id);
  deleteThread(db, thread.id);
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

  const worktreeState = ensureWorktreePollState(state, worktreePath);
  const [{ history, summary, signature }, snapshot] =
    await runWorktreeOpenLimited(
      () =>
        Promise.all([
          readGitHistoryFirstPage(
            project.id,
            worktreePath,
            DEFAULT_GIT_HISTORY_PAGE_SIZE,
            requestGitOptions,
          ),
          readAndStoreWorktreeSnapshot(state, worktreePath, requestGitOptions),
        ]),
      signal,
    );
  worktreeState.history = summary;
  worktreeState.historyEntries = history.entries;
  worktreeState.historyNextOffset = history.nextOffset;
  worktreeState.historySignature = signature;
  syncProjectWorktreeBackgroundPolling(state);
  queueBackgroundWorkWhenIdle(
    `git-history-warm:${project.id}:${worktreePath}`,
    () => {
      warmGitHistoryCache(worktreeState, worktreePath, logBackgroundGitFailure);
    },
  );

  return {
    history,
    project,
    worktree: snapshot,
    worktrees,
  };
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
    const results: RpcOpenWorktreesBatchResultItem[] = [];

    for (const worktree of params.worktrees) {
      throwIfAborted(context?.signal, "Worktree restore was aborted.");
      try {
        const opened = await openWorktreeWithGitOptions(
          worktree,
          requestGitOptions,
          context?.signal,
          context,
        );
        results.push({
          ok: true,
          projectId: worktree.projectId,
          worktreePath: worktree.worktreePath,
          ...opened,
        });
      } catch (error) {
        results.push({
          ok: false,
          projectId: worktree.projectId,
          worktreePath: worktree.worktreePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
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
    await ensureTrackedProjectWorktree(project, state, worktreePath, {
      ...requestGitOptions,
    });

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
    await ensureTrackedProjectWorktree(project, state, worktreePath, {
      ...requestGitOptions,
    });

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
        syncProjectWorktreeBackgroundPolling(projectState);
        return {
          ...state.history,
          entries: [],
          limit,
          nextOffset: null,
        };
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

export async function focusContextProcedure(
  params: AppRPCSchema["requests"]["focusContext"]["params"],
  context?: RpcRequestContext,
): Promise<RpcContextFocusChanged> {
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
    return {
      projectId: openedProject.project.id,
      projectPath: openedProject.project.path,
      projectName: openedProject.project.name,
      worktreePath: openedWorktree.worktree.path,
      threadId: params.threadId ?? null,
    };
  });
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
  const project = projectByIdForPath(params.projectId, context);
  const projectThreads = listThreads(db).filter(
    (thread) => thread.projectId === project.id,
  );
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
  const activeTurns = [...threadTurnAbortControllerMap.entries()].map(
    ([threadId, controller]) => ({
      controller,
      promise: threadTurnCompletionMap.get(threadId) ?? null,
      threadId,
    }),
  );

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

export function setThreadStatusChangeListener(
  listener: ((thread: RpcThread) => void) | null,
): void {
  threadStatusChangeListener = listener;
}

export function setThreadExtensionUiMessageListener(
  listener: ((request: RpcThreadExtensionUiRequest) => boolean) | null,
): void {
  threadExtensionUiMessageListener = listener;
}
