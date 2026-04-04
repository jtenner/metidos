import { existsSync, type FSWatcher, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import {
  Codex,
  type Thread as CodexThread,
  type ThreadItem,
} from "@openai/codex-sdk";

import type { ProjectRecord, ThreadActivityInput, ThreadRecord } from "./db";
import {
  createSecurityAuditEvent,
  createThread,
  createThreadMessage,
  deleteProject,
  deleteThread,
  getProject,
  getProjectById,
  getThreadById,
  initAppDatabase,
  listProjects,
  listProjectWorktreePins,
  listThreadMessages,
  listThreads,
  listThreadsWithInProgressMessages,
  markThreadErrorSeen,
  markThreadFailed,
  markThreadRan,
  markThreadRunStarted,
  markThreadStopped,
  renameThread,
  setProjectClosed,
  setProjectWorktreePinned,
  setThreadModel,
  setThreadPinned,
  setThreadReasoningEffort,
  setThreadUnsafeMode,
  setThreadUsage,
  stopInProgressThreadMessages,
  updateThreadCodexId,
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
  readFileChangeDiff,
  readGitHistoryFirstPage,
  readGitHistorySummary,
  readWorktreeChangeDiff,
  readWorktreeFileContentPage,
  readWorktreeSnapshot,
  runGitCommand,
} from "./git";
import {
  buildCodexModelCatalog,
  contextWindowTokensForModel,
  normalizeStoredCodexModel,
  normalizeStoredCodexReasoningEffort,
  resolveCodexModel,
  resolveCodexReasoningEffort,
} from "./project-procedures/codex-catalog";
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
  formatTaskPrompt,
  readProjectTasksFromDisk,
  readTaskWatchTargets,
  resolvePackageJsonTask,
  resolveProjectTaskFilePath,
  type TaskWatchTarget,
  taskTitleFromPath,
} from "./project-procedures/project-tasks";
import {
  awaitAbortableResult,
  createAbortError,
  createAsyncConcurrencyLimit,
  isAbortError,
  normalizePath,
  readLruValue,
  safeIsDirectory,
  throwIfAborted,
  writeLruValue,
} from "./project-procedures/shared";
import {
  buildNextCompactionTelemetry,
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
  recordProjectTaskQueuedAuditEvent,
} from "./project-security-audit";
import type {
  AppRPCSchema,
  RpcAppBootstrapResult,
  RpcCodexModelCatalog,
  RpcCodexReasoningEffort,
  RpcCreateWorktreeResult,
  RpcGitCommitDiffResult,
  RpcGitHistoryEntry,
  RpcHomeDirectoryResult,
  RpcOpenProjectsBatchResultItem,
  RpcOpenWorktreeResult,
  RpcOpenWorktreesBatchResultItem,
  RpcProject,
  RpcProjectTask,
  RpcProjectWorktreesResult,
  RpcRequestContext,
  RpcRequestPriority,
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcThreadUsage,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeFileContentPage,
  RpcWorktreeFileDiff,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeSnapshot,
} from "./rpc-schema";

/**
 * Shared DB handle for all RPC procedures in this process.
 */
const db = initAppDatabase();

/**
 * Default RPC websocket URL used when no MCP override is supplied.
 */
const JOLT_DEFAULT_RPC_URL = "ws://127.0.0.1:7599/rpc";

/**
 * Stable MCP server identity for Codex sidecar integration.
 */
const JOLT_MCP_SERVER_NAME = "jolt";

/**
 * Entry point used by procedures that launch/connect to the MCP wrapper script.
 */
const JOLT_SIDECAR_SERVER_PATH = resolve(
  process.cwd(),
  "src/bun/codex-sidecar-mcp.ts",
);

/**
 * RPC procedure: returns OS home directory and whether shell-like `~` expansion
 * is supported on this platform.
 */
export async function getHomeDirectoryProcedure(): Promise<RpcHomeDirectoryResult> {
  return {
    homeDirectory: homedir(),
    supportsTildePath:
      process.platform === "darwin" || process.platform === "linux",
  };
}

/**
 * RPC procedure: fetch all known projects from the local DB.
 */
export async function listProjectsProcedure(
  _params?: AppRPCSchema["requests"]["listProjects"]["params"],
): Promise<RpcProject[]> {
  return listProjects(db);
}

/**
 * RPC procedure: list threads with a live run-status snapshot for each thread.
 */
export async function listThreadsProcedure(
  _params?: AppRPCSchema["requests"]["listThreads"]["params"],
): Promise<RpcThread[]> {
  return listThreads(db).map((thread) =>
    toRpcThread(thread, currentThreadRunStatus(thread)),
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
 * RPC procedure: return the current codex model catalog.
 */
export async function getCodexModelCatalogProcedure(
  _params?: AppRPCSchema["requests"]["getCodexModelCatalog"]["params"],
): Promise<RpcCodexModelCatalog> {
  return buildCodexModelCatalog();
}

/**
 * Compose startup bootstrap payload (home, model catalog, projects, and thread detail).
 * Thread detail errors are non-fatal to allow UI to continue booting.
 */
export async function getAppBootstrapProcedure(
  params?: AppRPCSchema["requests"]["getAppBootstrap"]["params"],
): Promise<RpcAppBootstrapResult> {
  const [homeDirectory, modelCatalog] = await Promise.all([
    getHomeDirectoryProcedure(),
    getCodexModelCatalogProcedure(),
  ]);
  const threads = listThreads(db);
  const hintedThread = pickBootstrapThreadRecord(threads, params);
  const threadDetail =
    hintedThread === null
      ? null
      : await readThreadDetailCached(hintedThread.id).catch(() => null);

  return {
    homeDirectory,
    modelCatalog,
    projects: listProjects(db),
    threadDetail,
    threads: threads.map((thread) =>
      toRpcThread(thread, currentThreadRunStatus(thread)),
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
const TASK_CACHE_REFRESH_CONCURRENCY = 1;
const DIFF_LOAD_CONCURRENCY = 2;
const WORKTREE_TASK_CACHE_REFRESH_INTERVAL_MS = 30_000;
const TASK_WATCH_RETRY_DELAY_MS = 60_000;

/**
 * Per-worktree command options, including an explicit refresh override.
 */
type ProjectWorktreeReadOptions = GitCommandOptions & {
  forceRefresh?: boolean;
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
  tasks: RpcProjectTask[] | null;
  taskWatchTargets: TaskWatchTarget[];
  taskWatchTargetRetryAt: Map<string, number>;
  taskWatchers: FSWatcher[];
  taskRefreshPromise: Promise<RpcProjectTask[]> | null;
  taskRefreshQueued: boolean;
  taskCacheRefreshedAt: number;
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
const codexThreadMap = new Map<number, CodexThread>();
const threadRunStatusMap = new Map<number, RpcThreadRunStatus>();
const threadTurnAbortControllerMap = new Map<number, AbortController>();
const threadTurnCompletionMap = new Map<number, Promise<void>>();
const threadDetailCache = new Map<number, RpcThreadDetail>();
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
const taskCacheRefreshLimit = createAsyncConcurrencyLimit(
  TASK_CACHE_REFRESH_CONCURRENCY,
);
const diffLoadLimit = createAsyncConcurrencyLimit(DIFF_LOAD_CONCURRENCY);
let lastTaskCacheRefreshDurationMs = 0;
let peakTaskCacheRefreshDurationMs = 0;
let lastThreadActivityPersistenceDurationMs = 0;
let peakThreadActivityPersistenceDurationMs = 0;
let worktreeTaskChangeListener:
  | ((projectId: number, worktreePath: string) => void)
  | null = null;
let worktreeGitHistoryChangeListener:
  | ((projectId: number, worktreePath: string) => void)
  | null = null;

function hasForegroundReadPressure(): boolean {
  return foregroundReadCount > 0;
}

function shouldRefreshWorktreeTaskCache(state: WorktreePollState): boolean {
  return (
    state.taskCacheRefreshedAt === 0 ||
    Date.now() - state.taskCacheRefreshedAt >=
      WORKTREE_TASK_CACHE_REFRESH_INTERVAL_MS
  );
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

function runTaskCacheRefreshLimited<T>(callback: () => Promise<T>): Promise<T> {
  return taskCacheRefreshLimit.run(callback, {
    abortMessage: "Project task refresh was aborted.",
  });
}

function runWorktreeOpenLimited<T>(
  callback: () => Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  return worktreeOpenLimit.run(callback, {
    abortMessage: "Worktree open was aborted.",
    signal: signal ?? null,
  });
}

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

function recordTaskCacheRefreshDuration(durationMs: number): void {
  lastTaskCacheRefreshDurationMs = durationMs;
  peakTaskCacheRefreshDurationMs = Math.max(
    peakTaskCacheRefreshDurationMs,
    durationMs,
  );
}

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
  taskCacheRefreshInFlightCount: number;
  taskCacheRefreshDurationMs: {
    last: number;
    peak: number;
  };
  taskCacheRefreshLimit: ReturnType<typeof taskCacheRefreshLimit.stats>;
  threadActivityPersistenceDurationMs: {
    last: number;
    peak: number;
  };
  worktreeOpenLimit: ReturnType<typeof worktreeOpenLimit.stats>;
} {
  let openWorktreeCount = 0;
  let taskCacheRefreshInFlightCount = 0;

  for (const state of projectPollMap.values()) {
    openWorktreeCount += state.openWorktrees.size;
    for (const worktreeState of state.openWorktrees.values()) {
      if (worktreeState.taskRefreshPromise !== null) {
        taskCacheRefreshInFlightCount += 1;
      }
    }
  }

  return {
    deferredBackgroundWorkCount: deferredBackgroundWork.size,
    diffLoadLimit: diffLoadLimit.stats(),
    foregroundReadCount,
    gitHistoryReadLimit: gitHistoryReadLimit.stats(),
    openWorktreeCount,
    projectPollerCount: projectPollMap.size,
    taskCacheRefreshInFlightCount,
    taskCacheRefreshDurationMs: {
      last: lastTaskCacheRefreshDurationMs,
      peak: peakTaskCacheRefreshDurationMs,
    },
    taskCacheRefreshLimit: taskCacheRefreshLimit.stats(),
    threadActivityPersistenceDurationMs: {
      last: lastThreadActivityPersistenceDurationMs,
      peak: peakThreadActivityPersistenceDurationMs,
    },
    worktreeOpenLimit: worktreeOpenLimit.stats(),
  };
}

function joltRpcUrl(): string {
  const configured = process.env.JOLT_RPC_URL?.trim();
  if (configured) {
    return configured;
  }

  const configuredPort = process.env.JOLT_PORT?.trim();
  if (configuredPort) {
    return `ws://127.0.0.1:${configuredPort}/rpc`;
  }

  return JOLT_DEFAULT_RPC_URL;
}

function createCodexClient(
  thread: Pick<ThreadRecord, "id" | "projectId" | "worktreePath">,
): Codex {
  return new Codex({
    config: {
      mcp_servers: {
        [JOLT_MCP_SERVER_NAME]: {
          command: process.execPath,
          args: [JOLT_SIDECAR_SERVER_PATH],
          env: {
            JOLT_PROJECT_ID: String(thread.projectId),
            JOLT_THREAD_ID: String(thread.id),
            JOLT_WORKTREE_PATH: thread.worktreePath,
            JOLT_RPC_URL: joltRpcUrl(),
          },
        },
      },
    },
  });
}

function gitPriorityFromRpcRequest(
  priority: RpcRequestPriority,
): GitCommandPriority {
  return priority === "background" ? "background" : "foreground";
}

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

function invalidateThreadDetailCache(threadId: number): void {
  threadDetailCache.delete(threadId);
}

function clearThreadRuntimeState(threadId: number): void {
  const activeController = threadTurnAbortControllerMap.get(threadId);
  if (activeController && !activeController.signal.aborted) {
    activeController.abort(
      createAbortError(null, "Thread runtime state was cleared."),
    );
  }
  threadTurnAbortControllerMap.delete(threadId);
  threadTurnCompletionMap.delete(threadId);
  codexThreadMap.delete(threadId);
  threadRunStatusMap.delete(threadId);
  invalidateThreadDetailCache(threadId);
}

function clearProjectThreadRuntimeState(projectId: number): void {
  for (const thread of listThreads(db)) {
    if (thread.projectId !== projectId) {
      continue;
    }
    clearThreadRuntimeState(thread.id);
  }
}

function setThreadRunStatus(
  threadId: number,
  status: RpcThreadRunStatus,
): void {
  threadRunStatusMap.set(threadId, status);
  invalidateThreadDetailCache(threadId);
}

function currentThreadRunStatus(thread: ThreadRecord): RpcThreadRunStatus {
  return threadRunStatusFromRecord(thread, threadRunStatusMap.get(thread.id));
}

function resolveUnsafeMode(unsafeMode: boolean | null | undefined): boolean {
  return unsafeMode === true;
}

function codexThreadOptions(
  worktreePath: string,
  model: string,
  reasoningEffort: RpcCodexReasoningEffort,
  unsafeMode: boolean,
) {
  return {
    approvalPolicy: "never" as const,
    model,
    modelReasoningEffort: reasoningEffort,
    networkAccessEnabled: unsafeMode,
    sandboxMode: unsafeMode
      ? ("danger-full-access" as const)
      : ("workspace-write" as const),
    workingDirectory: worktreePath,
  };
}

function createManagedCodexThread(thread: ThreadRecord): CodexThread {
  const client = createCodexClient(thread);
  const model = normalizeStoredCodexModel(thread.model);
  const normalizedReasoningEffort = normalizeStoredCodexReasoningEffort(
    thread.reasoningEffort,
  );

  return thread.codexThreadId
    ? client.resumeThread(
        thread.codexThreadId,
        codexThreadOptions(
          thread.worktreePath,
          model,
          normalizedReasoningEffort,
          thread.unsafeMode === 1,
        ),
      )
    : client.startThread(
        codexThreadOptions(
          thread.worktreePath,
          model,
          normalizedReasoningEffort,
          thread.unsafeMode === 1,
        ),
      );
}

async function ensureCodexThread(thread: ThreadRecord): Promise<CodexThread> {
  const active = codexThreadMap.get(thread.id);
  if (active) {
    return active;
  }

  const next = createManagedCodexThread(thread);
  codexThreadMap.set(thread.id, next);
  return next;
}

function threadById(threadId: number): ThreadRecord {
  const thread = getThreadById(db, threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  return thread;
}

function rpcThreadById(threadId: number): RpcThread {
  const thread = threadById(threadId);
  return toRpcThread(thread, currentThreadRunStatus(thread));
}

async function buildThreadDetail(threadId: number): Promise<RpcThreadDetail> {
  const thread = threadById(threadId);
  return {
    thread: toRpcThread(thread, currentThreadRunStatus(thread)),
    messages: toRpcThreadMessages(listThreadMessages(db, thread.id)),
  };
}

async function readThreadDetailCached(
  threadId: number,
): Promise<RpcThreadDetail> {
  const cached = readLruValue(threadDetailCache, threadId);
  if (cached) {
    return cached;
  }

  const detail = await buildThreadDetail(threadId);
  writeLruValue(
    threadDetailCache,
    threadId,
    detail,
    THREAD_DETAIL_CACHE_MAX_ENTRIES,
  );
  return detail;
}

function warmThreadDetailCache(threadId: number): void {
  void readThreadDetailCached(threadId).catch((error) => {
    console.error(`Failed to warm thread detail cache for ${threadId}`, error);
  });
}

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

function buildThreadTurnActivityId(startedAt: string, itemId: string): string {
  return `${startedAt}:${itemId}`;
}

async function runThreadMessageInBackground(
  threadId: number,
  input: string,
  startedAt: string,
  controller: AbortController,
): Promise<void> {
  let lastAssistantText = "";
  let lastAssistantItemId: string | null = null;
  let terminalError: string | null = null;
  let usage: RpcThreadUsage | null = null;
  const bufferedActivityWriter = createBufferedThreadActivityWriter();

  try {
    const thread = threadById(threadId);
    const codexThread = await ensureCodexThread(thread);
    const { events } = await codexThread.runStreamed(input, {
      signal: controller.signal,
    });

    for await (const event of events) {
      if (event.type === "thread.started") {
        if (event.thread_id && event.thread_id !== thread.codexThreadId) {
          updateThreadCodexId(db, thread.id, event.thread_id);
          invalidateThreadDetailCache(thread.id);
        }
        continue;
      }

      if (event.type === "turn.failed") {
        terminalError = event.error.message || "Codex turn failed.";
        continue;
      }

      if (event.type === "error") {
        terminalError = event.message || "Codex event stream failed.";
        continue;
      }

      if (event.type === "turn.completed") {
        usage = {
          inputTokens: event.usage.input_tokens,
          cachedInputTokens: event.usage.cached_input_tokens,
          outputTokens: event.usage.output_tokens,
        };
        continue;
      }

      if (
        event.type !== "item.started" &&
        event.type !== "item.updated" &&
        event.type !== "item.completed"
      ) {
        continue;
      }

      const item = event.item;
      if (item.type === "agent_message") {
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        const nextAssistantText = item.text.trim();
        if (nextAssistantText) {
          lastAssistantText = nextAssistantText;
          lastAssistantItemId = activityItemId;
        }
        if (nextAssistantText) {
          const state =
            event.type === "item.completed" ? "completed" : "in_progress";
          await bufferedActivityWriter.queue(
            activityItemId,
            `${state}\u0000${nextAssistantText}`,
            async () => [
              buildAssistantChatActivityInput(
                threadId,
                activityItemId,
                nextAssistantText,
                state,
              ),
            ],
            {
              force: state !== "in_progress",
              terminal: state !== "in_progress",
            },
          );
        }
        continue;
      }

      if (item.type === "reasoning") {
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        const state =
          event.type === "item.completed" ? "completed" : "in_progress";
        const text = item.text.trim() || "Reasoning";
        await bufferedActivityWriter.queue(
          activityItemId,
          `${state}\u0000${text}`,
          async () => [
            buildReasoningActivityInput(threadId, activityItemId, item, state),
          ],
          {
            force: state !== "in_progress",
            terminal: state !== "in_progress",
          },
        );
        continue;
      }

      if (item.type === "command_execution") {
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        await bufferedActivityWriter.queue(
          activityItemId,
          [
            item.status,
            item.command,
            String(item.exit_code ?? ""),
            item.aggregated_output,
          ].join("\u0000"),
          async () => [
            buildCommandActivityInput(threadId, activityItemId, item),
          ],
          {
            force: item.status !== "in_progress",
            terminal: item.status !== "in_progress",
          },
        );
        continue;
      }

      if (item.type === "mcp_tool_call") {
        if (item.server === JOLT_MCP_SERVER_NAME) {
          continue;
        }
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        await bufferedActivityWriter.queue(
          activityItemId,
          [
            item.status,
            item.server,
            item.tool,
            stringifyActivityValue(item.arguments),
            formatToolCallOutput(item),
          ].join("\u0000"),
          async () => [
            buildToolCallActivityInput(threadId, activityItemId, item),
          ],
          {
            force: item.status !== "in_progress",
            terminal: item.status !== "in_progress",
          },
        );
        continue;
      }

      if (item.type === "web_search") {
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        const state =
          event.type === "item.completed" ? "completed" : "in_progress";
        const query = item.query.trim() || "Web search";
        await bufferedActivityWriter.queue(
          activityItemId,
          `${state}\u0000${query}`,
          async () => [
            buildWebSearchActivityInput(threadId, activityItemId, item, state),
          ],
          {
            force: state !== "in_progress",
            terminal: state !== "in_progress",
          },
        );
        continue;
      }

      if (item.type === "error") {
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        const state =
          event.type === "item.completed" ? "completed" : "in_progress";
        const message =
          item.message.trim() || "Codex reported a non-fatal error.";
        await bufferedActivityWriter.queue(
          activityItemId,
          `${state}\u0000${message}`,
          async () => [
            buildErrorActivityInput(threadId, activityItemId, item, state),
          ],
          {
            force: state !== "in_progress",
            terminal: state !== "in_progress",
          },
        );
        continue;
      }

      if (item.type === "file_change") {
        const activityItemId = buildThreadTurnActivityId(startedAt, item.id);
        await bufferedActivityWriter.queue(
          activityItemId,
          [
            item.status,
            ...item.changes.map((change) => `${change.kind}:${change.path}`),
          ].join("\u0000"),
          () =>
            buildFileChangeActivityInputs(
              threadId,
              activityItemId,
              thread.worktreePath,
              item,
            ),
          {
            force: event.type === "item.completed",
            terminal: event.type === "item.completed",
          },
        );
      }
    }

    await bufferedActivityWriter.flushAll();

    if (terminalError) {
      throw new Error(terminalError);
    }

    const finalAssistantText =
      lastAssistantText.trim() || "No response returned.";
    if (codexThread.id && codexThread.id !== thread.codexThreadId) {
      updateThreadCodexId(db, thread.id, codexThread.id);
      invalidateThreadDetailCache(thread.id);
    }
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
      setThreadUsage(
        db,
        threadId,
        usage,
        buildNextCompactionTelemetry(
          currentThread,
          usage,
          contextWindowTokensForModel(currentThread.model),
        ),
      );
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
        `Failed to flush buffered Codex activity for thread ${threadId}`,
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
    const errorMessage = `Codex turn failed: ${message}`;
    markThreadFailed(db, threadId, errorMessage);
    setThreadRunStatus(threadId, {
      state: "failed",
      startedAt,
      updatedAt: getNow(),
      error: errorMessage,
      hasUnreadError: true,
    });
    console.error(`Codex turn failed for thread ${threadId}`, error);
  } finally {
    if (threadTurnAbortControllerMap.get(threadId) === controller) {
      threadTurnAbortControllerMap.delete(threadId);
    }
    threadTurnCompletionMap.delete(threadId);
  }
}

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

async function readProjectWorktrees(
  projectPath: string,
  projectId?: number,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree[]> {
  const { signal } = normalizeGitCommandOptions(options);
  throwIfAborted(signal, "Project worktree read was aborted.");

  if (typeof projectId === "number") {
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
      return state.worktrees;
    }
  }

  const worktrees = await listFreshProjectWorktrees(
    projectPath,
    projectId,
    options,
  );
  if (typeof projectId === "number") {
    const state = projectPollMap.get(projectId);
    if (state) {
      state.worktrees = worktrees;
      state.worktreesLoadedAt = Date.now();
    }
  }
  return worktrees;
}

export async function listDirectorySuggestionsProcedure(
  params: AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
): Promise<AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]> {
  return {
    directories: listDirectorySuggestions(params.query),
  };
}

function assertProjectDirectory(projectPath: string): void {
  if (!existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (!safeIsDirectory(projectPath)) {
    throw new Error(`Project path must be a directory: ${projectPath}`);
  }
}

function logBackgroundGitFailure(message: string, error: unknown): void {
  if (isAbortError(error)) {
    return;
  }

  console.error(message, error);
}

type CommandActivityPayload = {
  command: string;
  output: string;
  exitCode: number | null;
};

type FileChangeActivityPayload = {
  path: string;
  changeKind: "add" | "delete" | "update";
  diffText: string;
};

type ToolCallActivityPayload = {
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
};

type BufferedThreadActivityWrite = {
  buildInputs: () => Promise<ThreadActivityInput[]>;
  lastPersistedAt: number;
  lastPersistedSignature: string | null;
  messageIds: Array<number | null>;
  persisted: boolean;
  signature: string;
  terminal: boolean;
};

function stringifyActivityValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "undefined") {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function extractToolCallTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const candidate = block as { type?: unknown; text?: unknown };
      if (
        candidate.type !== "text" ||
        typeof candidate.text !== "string" ||
        !candidate.text.trim()
      ) {
        return [];
      }
      return [candidate.text];
    })
    .join("\n\n");
}

function formatToolCallOutput(
  item: Extract<ThreadItem, { type: "mcp_tool_call" }>,
): string {
  const errorMessage = item.error?.message?.trim();
  if (errorMessage) {
    return errorMessage;
  }

  const sections: string[] = [];
  const textContent = extractToolCallTextContent(item.result?.content);
  if (textContent) {
    sections.push(textContent);
  }
  if (typeof item.result?.structured_content !== "undefined") {
    const structuredContent = stringifyActivityValue(
      item.result.structured_content,
    );
    if (structuredContent) {
      sections.push(
        textContent
          ? `Structured content\n${structuredContent}`
          : structuredContent,
      );
    }
  }
  if (sections.length > 0) {
    return sections.join("\n\n");
  }

  return stringifyActivityValue(item.result?.content);
}

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

function buildReasoningActivityInput(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "reasoning" }>,
  state: "in_progress" | "completed" | "stopped",
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "reasoning",
    text: item.text.trim() || "Reasoning",
    state,
  };
}

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

function buildCommandActivityInputPayload(
  threadId: number,
  itemId: string,
  payload: CommandActivityPayload & {
    state: "in_progress" | "completed" | "failed" | "stopped";
  },
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "command",
    text: payload.command,
    state: payload.state,
    payloadJson: JSON.stringify({
      command: payload.command,
      output: payload.output,
      exitCode: payload.exitCode,
    } satisfies CommandActivityPayload),
  };
}

function buildCommandActivityInput(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "command_execution" }>,
): ThreadActivityInput {
  return buildCommandActivityInputPayload(threadId, itemId, {
    command: item.command,
    exitCode: item.exit_code ?? null,
    output: item.aggregated_output,
    state: item.status,
  });
}

async function buildFileChangeActivityInputs(
  threadId: number,
  itemId: string,
  worktreePath: string,
  item: Extract<ThreadItem, { type: "file_change" }>,
): Promise<ThreadActivityInput[]> {
  return Promise.all(
    item.changes.map(async (change) => {
      const diffText =
        item.status === "completed"
          ? await readFileChangeDiff(worktreePath, change.path, change.kind)
          : "";
      const gitPath = normalizeGitPath(worktreePath, change.path);
      return {
        threadId,
        itemId: `${itemId}:${gitPath}`,
        kind: "file_change",
        text: gitPath,
        state: item.status,
        payloadJson: JSON.stringify({
          path: gitPath,
          changeKind: change.kind,
          diffText,
        } satisfies FileChangeActivityPayload),
      } satisfies ThreadActivityInput;
    }),
  );
}

function buildToolCallActivityInput(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "mcp_tool_call" }>,
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "tool_call",
    text: `${item.server}.${item.tool}`,
    state: item.status,
    payloadJson: JSON.stringify({
      server: item.server,
      tool: item.tool,
      argumentsText: stringifyActivityValue(item.arguments),
      output: formatToolCallOutput(item),
    } satisfies ToolCallActivityPayload),
  };
}

function buildWebSearchActivityInput(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "web_search" }>,
  state: "in_progress" | "completed" | "stopped",
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "web_search",
    text: item.query.trim() || "Web search",
    state,
  };
}

function buildErrorActivityInput(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "error" }>,
  state: "in_progress" | "completed" | "stopped",
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "error",
    text: item.message.trim() || "Codex reported a non-fatal error.",
    state,
  };
}

function mergeProjectWorktreePins(
  projectId: number,
  worktrees: RpcWorktree[],
): RpcWorktree[] {
  const pinnedAtByPath = new Map(
    listProjectWorktreePins(db, projectId).map((record) => [
      record.worktreePath,
      record.pinnedAt,
    ]),
  );

  return worktrees.map((worktree) => ({
    ...worktree,
    pinnedAt: pinnedAtByPath.get(worktree.path) ?? null,
  }));
}

async function listFreshProjectWorktrees(
  projectPath: string,
  projectId?: number,
  options?: GitCommandOptions,
): Promise<RpcWorktree[]> {
  const worktrees = await listGitWorktreesForProjectPath(projectPath, options);
  if (typeof projectId !== "number") {
    return worktrees;
  }
  return mergeProjectWorktreePins(projectId, worktrees);
}

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

function stopProjectRefreshPolling(state: ProjectPollState): void {
  if (!state.projectTimer) {
    return;
  }

  clearInterval(state.projectTimer);
  state.projectTimer = null;
}

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
  closeTaskWatchers(active);
  state.openWorktrees.delete(worktreePath);
}

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
    tasks: null,
    taskWatchTargets: [],
    taskWatchTargetRetryAt: new Map(),
    taskWatchers: [],
    taskRefreshPromise: null,
    taskRefreshQueued: false,
    taskCacheRefreshedAt: 0,
    lastUpdatedAt,
  };
}

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

function closeTaskWatchers(worktreeState: WorktreePollState): void {
  for (const watcher of worktreeState.taskWatchers) {
    try {
      watcher.close();
    } catch {
      // Ignore watcher shutdown failures during task watcher cleanup.
    }
  }
  worktreeState.taskWatchers = [];
}

function areTaskWatchTargetsEqual(
  left: TaskWatchTarget[],
  right: TaskWatchTarget[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (target, index) =>
      target.kind === right[index]?.kind && target.path === right[index]?.path,
  );
}

function areProjectTasksEqual(
  left: RpcProjectTask[],
  right: RpcProjectTask[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  return left.every((task, index) => {
    const other = right[index];
    return (
      task.id === other?.id &&
      task.kind === other.kind &&
      task.path === other.path &&
      task.title === other.title &&
      task.scriptName === other.scriptName &&
      task.command === other.command
    );
  });
}

function logBackgroundTaskFailure(message: string, error: unknown): void {
  if (isAbortError(error)) {
    return;
  }

  console.error(message, error);
}

async function refreshWorktreeTaskCache(
  state: ProjectPollState,
  worktreePath: string,
  options?: {
    notify?: boolean;
    startWatching?: boolean;
  },
): Promise<RpcProjectTask[]> {
  const worktreeState = ensureWorktreePollState(state, worktreePath);
  if (worktreeState.taskRefreshPromise) {
    if (options?.notify === true) {
      worktreeState.taskRefreshQueued = true;
    }
    return worktreeState.taskRefreshPromise;
  }

  const hadTaskWatchers = worktreeState.taskWatchers.length > 0;
  const previousTasks = worktreeState.tasks ?? [];
  const previousTaskWatchTargets = worktreeState.taskWatchTargets;
  const refreshPromise = (async () => {
    const refreshStartedAt = performance.now();
    const [taskWatchTargets, tasks] = await runTaskCacheRefreshLimited(() =>
      Promise.all([
        readTaskWatchTargets(worktreePath),
        readProjectTasksFromDisk(worktreePath),
      ]),
    );
    recordTaskCacheRefreshDuration(
      Math.max(0, performance.now() - refreshStartedAt),
    );
    worktreeState.taskWatchTargets = taskWatchTargets;
    worktreeState.tasks = tasks;
    worktreeState.taskCacheRefreshedAt = Date.now();
    worktreeState.lastUpdatedAt = getNow();

    if (hadTaskWatchers || options?.startWatching === true) {
      closeTaskWatchers(worktreeState);
      startWorktreeTaskPolling(state, worktreePath);
    }

    if (
      options?.notify === true &&
      (!areTaskWatchTargetsEqual(previousTaskWatchTargets, taskWatchTargets) ||
        !areProjectTasksEqual(previousTasks, tasks))
    ) {
      worktreeTaskChangeListener?.(state.id, worktreePath);
    }

    return tasks;
  })();
  worktreeState.taskRefreshPromise = refreshPromise;

  try {
    return await refreshPromise;
  } finally {
    if (worktreeState.taskRefreshPromise === refreshPromise) {
      worktreeState.taskRefreshPromise = null;
    }
    if (worktreeState.taskRefreshQueued) {
      worktreeState.taskRefreshQueued = false;
      void refreshWorktreeTaskCache(state, worktreePath, {
        notify: true,
        startWatching: hadTaskWatchers || options?.startWatching === true,
      }).catch((error) => {
        logBackgroundTaskFailure(
          `Task cache refresh failed for ${worktreePath}`,
          error,
        );
      });
    }
  }
}

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

function startWorktreeTaskPolling(
  state: ProjectPollState,
  worktreePath: string,
): WorktreePollState {
  const worktreeState = ensureWorktreePollState(state, worktreePath);
  if (worktreeState.taskWatchers.length > 0) {
    return worktreeState;
  }

  const invalidateTaskState = () => {
    queueBackgroundWorkWhenIdle(
      `task-cache-refresh:${state.id}:${worktreePath}`,
      () => {
        void refreshWorktreeTaskCache(state, worktreePath, {
          notify: true,
          startWatching: true,
        }).catch((error) => {
          logBackgroundTaskFailure(
            `Task cache refresh failed for ${worktreePath}`,
            error,
          );
        });
      },
    );
  };

  for (const target of worktreeState.taskWatchTargets) {
    const nextRetryAt =
      worktreeState.taskWatchTargetRetryAt.get(target.path) ?? 0;
    if (Date.now() < nextRetryAt) {
      continue;
    }
    if (!safeIsDirectory(target.path)) {
      worktreeState.taskWatchTargetRetryAt.set(
        target.path,
        Date.now() + TASK_WATCH_RETRY_DELAY_MS,
      );
      continue;
    }

    const unregisterWatcher = (watcherToRemove: FSWatcher | null) => {
      if (!watcherToRemove) {
        return;
      }

      const index = worktreeState.taskWatchers.indexOf(watcherToRemove);
      if (index >= 0) {
        worktreeState.taskWatchers.splice(index, 1);
      }
    };

    let watcher: FSWatcher | null = null;
    const onWatchError = (error: unknown) => {
      const watchErrorCode =
        error instanceof Error ? (error as NodeJS.ErrnoException).code : null;
      const shouldBackoffWatchTarget =
        watchErrorCode === "EINVAL" ||
        watchErrorCode === "ENOENT" ||
        watchErrorCode === "ENOTDIR";
      if (shouldBackoffWatchTarget) {
        worktreeState.taskWatchTargetRetryAt.set(
          target.path,
          Date.now() + TASK_WATCH_RETRY_DELAY_MS,
        );
        unregisterWatcher(watcher);
        if (watcher) {
          try {
            watcher.close();
          } catch {
            // Ignore watcher close failures during task watch error recovery.
          }
        }
        return;
      }

      console.error(`Task watcher failed for ${target.path}`, error);
      invalidateTaskState();
    };

    try {
      watcher = watch(target.path, (eventType, filename) => {
        const watchedName = filename ? String(filename) : "";
        if (target.kind === "tasks") {
          if (watchedName.startsWith(".")) {
            return;
          }
          invalidateTaskState();
          return;
        }

        if (
          eventType === "rename" ||
          watchedName === "package.json" ||
          watchedName === ".tasks" ||
          !watchedName
        ) {
          invalidateTaskState();
        }
      });
      watcher.on("error", onWatchError);
      worktreeState.taskWatchTargetRetryAt.delete(target.path);
      worktreeState.taskWatchers.push(watcher);
    } catch (error) {
      const watchErrorCode =
        error instanceof Error ? (error as NodeJS.ErrnoException).code : null;
      if (
        watchErrorCode === "EINVAL" ||
        watchErrorCode === "ENOENT" ||
        watchErrorCode === "ENOTDIR"
      ) {
        worktreeState.taskWatchTargetRetryAt.set(
          target.path,
          Date.now() + TASK_WATCH_RETRY_DELAY_MS,
        );
        continue;
      }

      console.error(`Failed to watch task inputs in ${target.path}`, error);
    }
  }

  return worktreeState;
}

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

function projectByIdForPath(projectId: number): ProjectRecord {
  const project = getProjectById(db, projectId);
  if (!project) {
    throw new Error(`Project not currently tracked: ${projectId}`);
  }
  return project;
}

async function findProjectWorktree(
  project: ProjectRecord,
  worktreePath: string,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree | null> {
  const worktrees = await readProjectWorktrees(
    project.path,
    project.id,
    options,
  );
  return worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

async function assertProjectWorktree(
  project: ProjectRecord,
  worktreePath: string,
  options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree> {
  const worktree = await findProjectWorktree(project, worktreePath, options);
  if (!worktree) {
    throw new Error(
      `Worktree not found for project ${project.path}: ${worktreePath}`,
    );
  }
  return worktree;
}

function trackedProjectWorktree(
  state: ProjectPollState,
  worktreePath: string,
): RpcWorktree | null {
  return state.worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

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

  throw new Error(
    `Worktree not found for project ${project.path}: ${worktreePath}`,
  );
}

async function createThreadRecord(
  project: ProjectRecord,
  worktreePath: string,
  model: string,
  reasoningEffort: RpcCodexReasoningEffort,
  unsafeMode: boolean,
  options?: ProjectWorktreeReadOptions,
): Promise<ThreadRecord> {
  const worktree = await assertProjectWorktree(project, worktreePath, {
    ...options,
    forceRefresh: true,
  });

  const thread = createThread(db, {
    projectId: project.id,
    worktreePath,
    title: buildThreadTitle(worktree, worktreePath),
    model,
    reasoningEffort,
    unsafeMode,
    codexThreadId: null,
  });
  try {
    const codexThread = createManagedCodexThread(thread);
    codexThreadMap.set(thread.id, codexThread);
    if (unsafeMode) {
      recordUnsafeModeAuditEvent(thread, true, "thread_create");
    }
    return thread;
  } catch (error) {
    clearThreadRuntimeState(thread.id);
    deleteThread(db, thread.id);
    throw error;
  }
}

function recordUnsafeModeAuditEvent(
  thread: ThreadRecord,
  unsafeMode: boolean,
  source: "thread_create" | "toggle",
): void {
  createSecurityAuditEvent(db, {
    eventType: unsafeMode ? "unsafe_mode_enabled" : "unsafe_mode_disabled",
    summaryText: unsafeMode
      ? "Unsafe mode enabled. This thread can use the danger-full-access sandbox."
      : "Unsafe mode disabled. This thread returned to the standard sandbox.",
    threadId: thread.id,
    projectId: thread.projectId,
    worktreePath: thread.worktreePath,
    payloadJson: JSON.stringify({
      source,
      unsafeMode,
    }),
  });
}

export async function openProjectProcedure(
  params: AppRPCSchema["requests"]["openProject"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const opened = await awaitAbortableResult(
      openProjectWithGitOptions(params, requestGitOptions),
      context?.signal,
      "Project open was aborted.",
    );
    throwIfAborted(context?.signal, "Project open was aborted.");
    return opened;
  });
}

async function openProjectWithGitOptions(
  params: AppRPCSchema["requests"]["openProject"]["params"],
  requestGitOptions?: GitCommandOptions,
): Promise<RpcProjectWorktreesResult> {
  const projectPath = normalizePath(params.projectPath);
  assertProjectDirectory(projectPath);
  const existingProject = getProject(db, projectPath);

  let worktrees: RpcWorktree[];
  try {
    worktrees = await readProjectWorktrees(
      projectPath,
      existingProject?.id,
      requestGitOptions,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Project folder must be a git repository root or worktree: ${projectPath}${message ? ` (${message})` : ""}`,
    );
  }

  const project = upsertProject(db, {
    projectPath,
    name: params.name ?? basename(projectPath),
  });
  const state = ensureProjectPoller(project);
  state.worktrees = worktrees;
  state.worktreesLoadedAt = Date.now();

  return {
    project,
    worktrees: state.worktrees,
  };
}

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
          openProjectWithGitOptions(project, requestGitOptions),
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

export async function listProjectWorktreesProcedure(
  params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    ensureProjectPoller(project);
    const worktrees = await awaitAbortableResult(
      readProjectWorktrees(project.path, project.id, requestGitOptions),
      context?.signal,
      "Project worktree read was aborted.",
    );

    return {
      project,
      worktrees,
    };
  });
}

export async function listProjectTasksProcedure(
  params: AppRPCSchema["requests"]["listProjectTasks"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectTask[]> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    const worktreePath = normalizePath(params.worktreePath);
    const projectState = ensureProjectPoller(project);
    await ensureTrackedProjectWorktree(
      project,
      projectState,
      worktreePath,
      requestGitOptions,
    );
    const worktreeState = ensureWorktreePollState(projectState, worktreePath);
    const shouldRefresh = shouldRefreshWorktreeTaskCache(worktreeState);
    if (worktreeState.tasks !== null && !shouldRefresh) {
      startWorktreeTaskPolling(projectState, worktreePath);
      return worktreeState.tasks;
    }

    if (worktreeState.tasks !== null && shouldRefresh) {
      void refreshWorktreeTaskCache(projectState, worktreePath, {
        notify: true,
        startWatching: true,
      }).catch((error) => {
        logBackgroundTaskFailure(
          `Task cache refresh failed for ${worktreePath}`,
          error,
        );
      });
      startWorktreeTaskPolling(projectState, worktreePath);
      return worktreeState.tasks;
    }

    throwIfAborted(context?.signal, "Project task read was aborted.");
    const tasks = await awaitAbortableResult(
      refreshWorktreeTaskCache(projectState, worktreePath, {
        startWatching: true,
      }),
      context?.signal,
      "Project task read was aborted.",
    );
    startWorktreeTaskPolling(projectState, worktreePath);
    return tasks;
  });
}

export async function createWorktreeProcedure(
  params: AppRPCSchema["requests"]["createWorktree"]["params"],
): Promise<RpcCreateWorktreeResult> {
  const project = projectByIdForPath(params.projectId);
  const worktreeName = params.name.trim();
  if (!worktreeName) {
    throw new Error("Worktree name is required.");
  }

  const worktreePath = worktreePathFromName(project.path, worktreeName);
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  await runGitCommand(project.path, [
    "worktree",
    "add",
    "-b",
    worktreeName,
    worktreePath,
  ]);

  const worktrees = await readProjectWorktrees(project.path, project.id, {
    forceRefresh: true,
  });
  return {
    project,
    worktrees,
    worktreePath,
  };
}

export async function setWorktreePinnedProcedure(
  params: AppRPCSchema["requests"]["setWorktreePinned"]["params"],
): Promise<RpcProjectWorktreesResult> {
  const project = projectByIdForPath(params.projectId);
  const worktreePath = normalizePath(params.worktreePath);
  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });

  setProjectWorktreePinned(db, project.id, worktreePath, params.pinned);

  const state = ensureProjectPoller(project);
  const worktrees = await listFreshProjectWorktrees(project.path, project.id);
  state.worktrees = worktrees;
  state.worktreesLoadedAt = Date.now();

  return {
    project,
    worktrees,
  };
}

export async function createThreadProcedure(
  params: AppRPCSchema["requests"]["createThread"]["params"],
): Promise<RpcThreadDetail> {
  const project = projectByIdForPath(params.projectId);
  const worktreePath = normalizePath(params.worktreePath);
  const model = resolveCodexModel(params.model);
  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  const unsafeMode = resolveUnsafeMode(params.unsafeMode);
  const thread = await createThreadRecord(
    project,
    worktreePath,
    model,
    reasoningEffort,
    unsafeMode,
    {
      forceRefresh: true,
    },
  );
  recordCrossWorkspaceThreadAuditEvent(db, {
    params,
    thread,
  });
  return readThreadDetailCached(thread.id);
}

export async function requestThreadStartProcedure(
  params: AppRPCSchema["requests"]["requestThreadStart"]["params"],
): Promise<RpcThreadStartRequest> {
  const project = projectByIdForPath(params.projectId);
  const worktreePath = normalizePath(params.worktreePath);
  const input = params.input.trim();
  if (!input) {
    throw new Error("Thread input is required.");
  }

  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });

  return {
    requestId: crypto.randomUUID(),
    projectId: project.id,
    projectPath: project.path,
    worktreePath,
    input,
    model: params.model?.trim() ? resolveCodexModel(params.model) : null,
    reasoningEffort: params.reasoningEffort?.trim()
      ? resolveCodexReasoningEffort(params.reasoningEffort)
      : null,
    unsafeMode: params.unsafeMode ?? null,
    autoStart: params.autoStart ?? null,
    threadId: null,
    title: null,
    summary: null,
    pinned: null,
    pinnedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export async function getThreadProcedure(
  params: AppRPCSchema["requests"]["getThread"]["params"],
): Promise<RpcThreadDetail> {
  return readThreadDetailCached(params.threadId);
}

export async function markThreadErrorSeenProcedure(
  params: AppRPCSchema["requests"]["markThreadErrorSeen"]["params"],
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId);
  markThreadErrorSeen(db, thread.id);
  const currentStatus = currentThreadRunStatus(thread);
  setThreadRunStatus(thread.id, {
    ...currentStatus,
    hasUnreadError: false,
  });
  return readThreadDetailCached(thread.id);
}

export async function sendThreadMessageProcedure(
  params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId);
  const input = params.input.trim();
  if (!input) {
    throw new Error("Thread input is required.");
  }

  return queueThreadMessage(thread, input);
}

async function queueThreadMessage(
  thread: ThreadRecord,
  input: string,
): Promise<RpcThreadDetail> {
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error("Thread is already processing a message.");
  }

  markThreadErrorSeen(db, thread.id);
  createThreadMessage(db, {
    threadId: thread.id,
    role: "user",
    text: input,
  });

  const startedAt = getNow();
  markThreadRunStarted(db, thread.id, startedAt);
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
  );
  threadTurnCompletionMap.set(thread.id, completion);
  void completion;

  return readThreadDetailCached(thread.id);
}

function packageScriptDisplayCommand(task: {
  packageDirectory: string;
  scriptName: string;
}): string {
  return task.packageDirectory === "."
    ? `bun run ${task.scriptName}`
    : `cd ${task.packageDirectory} && bun run ${task.scriptName}`;
}

async function readProcessOutputStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onChunk: (chunk: string) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }
      const chunk = decoder.decode(value, {
        stream: true,
      });
      if (chunk) {
        await onChunk(chunk);
      }
      if (signal.aborted) {
        return;
      }
    }

    const trailing = decoder.decode();
    if (trailing) {
      await onChunk(trailing);
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    reader.releaseLock();
  }
}

async function queuePackageScriptTask(
  thread: ThreadRecord,
  task: {
    packageDirectory: string;
    scriptName: string;
    command: string;
  },
): Promise<RpcThreadDetail> {
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error("Thread is already processing a message.");
  }

  markThreadErrorSeen(db, thread.id);

  const startedAt = getNow();
  markThreadRunStarted(db, thread.id, startedAt);
  const controller = new AbortController();
  threadTurnAbortControllerMap.set(thread.id, controller);
  setThreadRunStatus(thread.id, {
    state: "working",
    startedAt,
    updatedAt: startedAt,
    error: null,
    hasUnreadError: false,
  });

  const completion = runPackageScriptTaskInBackground(
    thread.id,
    thread.worktreePath,
    task,
    startedAt,
    controller,
  );
  threadTurnCompletionMap.set(thread.id, completion);
  void completion;

  return readThreadDetailCached(thread.id);
}

async function runPackageScriptTaskInBackground(
  threadId: number,
  worktreePath: string,
  task: {
    packageDirectory: string;
    scriptName: string;
    command: string;
  },
  startedAt: string,
  controller: AbortController,
): Promise<void> {
  const command = packageScriptDisplayCommand(task);
  const activityItemId = buildThreadTurnActivityId(
    startedAt,
    `project-task:${task.packageDirectory}:${task.scriptName}`,
  );
  const cwd = resolve(worktreePath, task.packageDirectory);
  let output = "";
  let exitCode: number | null = null;
  const bufferedActivityWriter = createBufferedThreadActivityWriter();

  const queueCommandActivity = async (
    state: "in_progress" | "completed" | "failed" | "stopped",
    options?: {
      force?: boolean;
      terminal?: boolean;
    },
  ): Promise<void> => {
    await bufferedActivityWriter.queue(
      activityItemId,
      [state, command, String(exitCode ?? ""), output].join("\u0000"),
      async () => [
        buildCommandActivityInputPayload(threadId, activityItemId, {
          command,
          exitCode,
          output,
          state,
        }),
      ],
      {
        ...(typeof options?.force === "boolean"
          ? { force: options.force }
          : {}),
        ...(typeof options?.terminal === "boolean"
          ? { terminal: options.terminal }
          : {}),
      },
    );
  };

  try {
    await queueCommandActivity("in_progress");

    const proc = Bun.spawn({
      cmd: [process.execPath, "run", task.scriptName],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    });

    const appendOutput = async (chunk: string) => {
      output += chunk;
      await queueCommandActivity("in_progress");
    };

    const [settledExitCode] = await Promise.all([
      proc.exited,
      readProcessOutputStream(proc.stdout, appendOutput, controller.signal),
      readProcessOutputStream(proc.stderr, appendOutput, controller.signal),
    ]);
    exitCode = settledExitCode;

    if (controller.signal.aborted) {
      await queueCommandActivity("stopped", {
        force: true,
        terminal: true,
      });
      markThreadStopped(db, threadId, THREAD_STOPPED_MESSAGE);
      setThreadRunStatus(threadId, {
        state: "stopped",
        startedAt,
        updatedAt: getNow(),
        error: THREAD_STOPPED_MESSAGE,
        hasUnreadError: false,
      });
      return;
    }

    if (exitCode === 0) {
      await queueCommandActivity("completed", {
        force: true,
        terminal: true,
      });
      markThreadRan(db, threadId);
      setThreadRunStatus(threadId, {
        state: "idle",
        startedAt,
        updatedAt: getNow(),
        error: null,
        hasUnreadError: false,
      });
      return;
    }

    if (!output.trim()) {
      output = `Command exited with code ${exitCode}.`;
    }
    await queueCommandActivity("failed", {
      force: true,
      terminal: true,
    });
    const errorMessage = `${command} failed with exit code ${exitCode}.`;
    markThreadFailed(db, threadId, errorMessage);
    setThreadRunStatus(threadId, {
      state: "failed",
      startedAt,
      updatedAt: getNow(),
      error: errorMessage,
      hasUnreadError: true,
    });
  } catch (error) {
    if (isAbortError(error) && controller.signal.aborted) {
      await queueCommandActivity("stopped", {
        force: true,
        terminal: true,
      });
      markThreadStopped(db, threadId, THREAD_STOPPED_MESSAGE);
      setThreadRunStatus(threadId, {
        state: "stopped",
        startedAt,
        updatedAt: getNow(),
        error: THREAD_STOPPED_MESSAGE,
        hasUnreadError: false,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (!output.trim()) {
      output = message;
    }
    await queueCommandActivity("failed", {
      force: true,
      terminal: true,
    });
    const errorMessage = `${command} failed: ${message}`;
    markThreadFailed(db, threadId, errorMessage);
    setThreadRunStatus(threadId, {
      state: "failed",
      startedAt,
      updatedAt: getNow(),
      error: errorMessage,
      hasUnreadError: true,
    });
    console.error(`Project task command failed for thread ${threadId}`, error);
  } finally {
    if (threadTurnAbortControllerMap.get(threadId) === controller) {
      threadTurnAbortControllerMap.delete(threadId);
    }
    threadTurnCompletionMap.delete(threadId);
  }
}

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

export async function runProjectTaskProcedure(
  params: AppRPCSchema["requests"]["runProjectTask"]["params"],
): Promise<RpcThreadDetail> {
  const project = projectByIdForPath(params.projectId);
  const worktreePath = normalizePath(params.worktreePath);
  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });

  let thread = params.threadId ? threadById(params.threadId) : null;
  const createdThread = thread === null;
  if (thread) {
    if (
      thread.projectId !== project.id ||
      normalizePath(thread.worktreePath) !== worktreePath
    ) {
      throw new Error("Selected task must run in the active worktree thread.");
    }
  } else {
    thread = await createThreadRecord(
      project,
      worktreePath,
      resolveCodexModel(params.model),
      resolveCodexReasoningEffort(params.reasoningEffort),
      resolveUnsafeMode(params.unsafeMode),
      {
        forceRefresh: true,
      },
    );
  }

  switch (params.task.kind) {
    case "script": {
      const detail = await queuePackageScriptTask(
        thread,
        resolvePackageJsonTask(worktreePath, params.task),
      );
      recordProjectTaskQueuedAuditEvent(db, {
        createdThread,
        params,
        thread,
      });
      return detail;
    }
    case "file": {
      const taskFilePath = resolveProjectTaskFilePath(
        worktreePath,
        params.task.path,
      );
      const taskContent = await Bun.file(taskFilePath).text();
      if (!taskContent.trim()) {
        throw new Error(`Task file is empty: ${params.task.path}`);
      }
      const detail = await queueThreadMessage(
        thread,
        formatTaskPrompt(taskTitleFromPath(params.task.path), taskContent),
      );
      recordProjectTaskQueuedAuditEvent(db, {
        createdThread,
        params,
        thread,
      });
      return detail;
    }
    default:
      throw new Error(`Unsupported project task kind: ${params.task.kind}`);
  }
}

export async function stopThreadTurnProcedure(
  params: AppRPCSchema["requests"]["stopThreadTurn"]["params"],
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId);
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

export async function renameThreadProcedure(
  params: AppRPCSchema["requests"]["renameThread"]["params"],
): Promise<RpcThread> {
  const thread = threadById(params.threadId);
  const title = params.title.trim();
  if (!title) {
    throw new Error("Thread title is required.");
  }

  const normalizedSummary =
    typeof params.summary === "undefined"
      ? undefined
      : params.summary?.trim() || null;
  renameThread(db, thread.id, title, normalizedSummary);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id);
}

export async function setThreadPinnedProcedure(
  params: AppRPCSchema["requests"]["setThreadPinned"]["params"],
): Promise<RpcThread> {
  const thread = threadById(params.threadId);
  setThreadPinned(db, thread.id, params.pinned);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id);
}

export async function updateThreadModelProcedure(
  params: AppRPCSchema["requests"]["updateThreadModel"]["params"],
): Promise<RpcThread> {
  const thread = threadById(params.threadId);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error("Thread model cannot change while Codex is processing.");
  }

  const model = resolveCodexModel(params.model);
  setThreadModel(db, thread.id, model);
  codexThreadMap.delete(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id);
}

export async function updateThreadReasoningEffortProcedure(
  params: AppRPCSchema["requests"]["updateThreadReasoningEffort"]["params"],
): Promise<RpcThread> {
  const thread = threadById(params.threadId);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error(
      "Thread reasoning effort cannot change while Codex is processing.",
    );
  }

  const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
  setThreadReasoningEffort(db, thread.id, reasoningEffort);
  codexThreadMap.delete(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id);
}

export async function updateThreadUnsafeModeProcedure(
  params: AppRPCSchema["requests"]["updateThreadUnsafeMode"]["params"],
): Promise<RpcThread> {
  const thread = threadById(params.threadId);
  if (currentThreadRunStatus(thread).state === "working") {
    throw new Error(
      "Thread unsafe mode cannot change while Codex is processing.",
    );
  }

  const unsafeMode = resolveUnsafeMode(params.unsafeMode);
  if ((thread.unsafeMode === 1) === unsafeMode) {
    return rpcThreadById(thread.id);
  }

  setThreadUnsafeMode(db, thread.id, unsafeMode);
  recordUnsafeModeAuditEvent(thread, unsafeMode, "toggle");
  codexThreadMap.delete(thread.id);
  invalidateThreadDetailCache(thread.id);
  return rpcThreadById(thread.id);
}

export async function deleteThreadProcedure(
  params: AppRPCSchema["requests"]["deleteThread"]["params"],
): Promise<AppRPCSchema["requests"]["deleteThread"]["response"]> {
  const thread = threadById(params.threadId);
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

export async function discardEmptyThreadProcedure(
  params: AppRPCSchema["requests"]["discardEmptyThread"]["params"],
): Promise<AppRPCSchema["requests"]["discardEmptyThread"]["response"]> {
  const thread = getThreadById(db, params.threadId);
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
    );
  });
}

async function openWorktreeWithGitOptions(
  params: AppRPCSchema["requests"]["openWorktree"]["params"],
  requestGitOptions?: GitCommandOptions,
  signal?: AbortSignal,
): Promise<RpcOpenWorktreeResult> {
  const project = projectByIdForPath(params.projectId);
  const state = ensureProjectPoller(project);
  const worktreePath = normalizePath(params.worktreePath);
  await ensureTrackedProjectWorktree(project, state, worktreePath, {
    ...requestGitOptions,
  });

  const worktreeState = ensureWorktreePollState(state, worktreePath);
  const tasks = worktreeState.tasks ?? [];
  if (shouldRefreshWorktreeTaskCache(worktreeState)) {
    queueBackgroundWorkWhenIdle(
      `task-cache-refresh:${project.id}:${worktreePath}`,
      () => {
        void refreshWorktreeTaskCache(state, worktreePath, {
          notify: true,
          startWatching: false,
        }).catch((error) => {
          logBackgroundTaskFailure(
            `Task cache warm failed for ${worktreePath}`,
            error,
          );
        });
      },
    );
  }
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
  startWorktreeTaskPolling(state, worktreePath);
  syncProjectWorktreeBackgroundPolling(state);
  queueBackgroundWorkWhenIdle(
    `git-history-warm:${project.id}:${worktreePath}`,
    () => {
      warmGitHistoryCache(worktreeState, worktreePath, logBackgroundGitFailure);
    },
  );

  return {
    tasks,
    project,
    worktree: snapshot,
    history,
  };
}

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

export async function getWorktreeSnapshotProcedure(
  params: AppRPCSchema["requests"]["getWorktreeSnapshot"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeSnapshot> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizePath(params.worktreePath);
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

export async function readWorktreeFileContentPageProcedure(
  params: AppRPCSchema["requests"]["readWorktreeFileContentPage"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeFileContentPage> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizePath(params.worktreePath);
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

export async function readWorktreeFileDiffProcedure(
  params: AppRPCSchema["requests"]["readWorktreeFileDiff"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeFileDiff> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    const state = ensureProjectPoller(project);
    const worktreePath = normalizePath(params.worktreePath);
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

export async function listWorktreeGitHistoryProcedure(
  params: AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeGitHistoryResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    const worktreePath = normalizePath(params.worktreePath);
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

export async function getWorktreeGitCommitDiffProcedure(
  params: AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
  context?: RpcRequestContext,
): Promise<RpcGitCommitDiffResult> {
  return withForegroundRead(async () => {
    const requestGitOptions = gitCommandOptionsFromRequest(context);
    const project = projectByIdForPath(params.projectId);
    const worktreePath = normalizePath(params.worktreePath);
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

export async function setActiveWorktreeProcedure(
  params: AppRPCSchema["requests"]["setActiveWorktree"]["params"],
): Promise<AppRPCSchema["requests"]["setActiveWorktree"]["response"]> {
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
    ? normalizePath(params.worktreePath ?? "")
    : null;
  let projectId: number | null = null;
  let worktreePath: string | null = null;
  if (requestedProjectId !== null) {
    const project = projectByIdForPath(requestedProjectId);
    if (project.isOpen === 1) {
      ensureProjectPoller(project);
      projectId = project.id;
      worktreePath = requestedWorktreePath;
    } else {
      stopProjectPoller(project.id);
    }
  }

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

export async function closeWorktreeProcedure(
  params: AppRPCSchema["requests"]["closeWorktree"]["params"],
): Promise<AppRPCSchema["requests"]["closeWorktree"]["response"]> {
  const state = projectPollMap.get(params.projectId);
  if (state) {
    const normalizedPath = normalizePath(params.worktreePath);
    if (state.activeWorktreePath === normalizedPath) {
      state.activeWorktreePath = null;
    }
    stopWorktreePolling(state, normalizedPath);
    syncProjectRefreshPolling(state);
  }

  return {
    success: true,
    projectId: params.projectId,
    worktreePath: normalizePath(params.worktreePath),
  };
}

export async function closeProjectProcedure(
  params: AppRPCSchema["requests"]["closeProject"]["params"],
): Promise<AppRPCSchema["requests"]["closeProject"]["response"]> {
  const project = projectByIdForPath(params.projectId);
  stopProjectPoller(project.id);
  setProjectClosed(db, project.id);
  return {
    success: true,
    projectId: project.id,
    message: `Closed project ${project.name}`,
  };
}

export async function deleteProjectProcedure(
  params: AppRPCSchema["requests"]["deleteProject"]["params"],
): Promise<AppRPCSchema["requests"]["deleteProject"]["response"]> {
  const project = projectByIdForPath(params.projectId);
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

export function setWorktreeTaskChangeListener(
  listener: ((projectId: number, worktreePath: string) => void) | null,
): void {
  worktreeTaskChangeListener = listener;
}

export function setWorktreeGitHistoryChangeListener(
  listener: ((projectId: number, worktreePath: string) => void) | null,
): void {
  worktreeGitHistoryChangeListener = listener;
}
