/**
 * @file src/bun/project-procedures.ts
 * @description Module for project procedures.
 */

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
  listThreadMessagesPage,
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
  readProjectTasksFromDisk,
  readTaskWatchTargets,
  resolveProjectTaskExecution,
  type TaskWatchTarget,
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
  RpcContextFocusChanged,
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
 * RPC procedure: list live status summaries for a targeted thread subset.
 */

export async function listThreadStatusesProcedure(
  params: AppRPCSchema["requests"]["listThreadStatuses"]["params"],
): Promise<RpcThread[]> {
  const requestedThreadIds = new Set(params.threadIds);
  if (requestedThreadIds.size === 0) {
    return [];
  }

  return listThreads(db)
    .filter((thread) => requestedThreadIds.has(thread.id))
    .map((thread) => toRpcThread(thread, currentThreadRunStatus(thread)));
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
 * @param thread - thread argument for thread.
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
/**
 * Should refresh worktree task cache.
 * @param state - Current state value.
 */

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
/**
 * Performs queueBackgroundWorkWhenIdle operation.
 * @param key - key argument for queueBackgroundWorkWhenIdle.
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
 * Runs task cache refresh limited.
 * @param callback - Callback to invoke.
 */

function runTaskCacheRefreshLimited<T>(callback: () => Promise<T>): Promise<T> {
  return taskCacheRefreshLimit.run(callback, {
    abortMessage: "Project task refresh was aborted.",
  });
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
 * @param abortMessage - abortMessage argument for runGitHistoryReadLimited.
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
 * @param abortMessage - abortMessage argument for runDiffLoadLimited.
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
 * Performs recordTaskCacheRefreshDuration operation.
 * @param durationMs - durationMs argument for recordTaskCacheRefreshDuration.
 */

function recordTaskCacheRefreshDuration(durationMs: number): void {
  lastTaskCacheRefreshDurationMs = durationMs;
  peakTaskCacheRefreshDurationMs = Math.max(
    peakTaskCacheRefreshDurationMs,
    durationMs,
  );
}
/**
 * Performs recordThreadActivityPersistenceDuration operation.
 * @param durationMs - durationMs argument for recordThreadActivityPersistenceDuration.
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

/**
 * Derives the HTTP origin that pairs with the configured RPC websocket URL.
 * @param rpcUrl - RPC websocket URL.
 */
function joltRpcHttpOrigin(rpcUrl: string): string {
  const url = new URL(rpcUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

/**
 * Builds the environment passed to the Codex MCP sidecar for a thread.
 * @param thread - thread argument for buildCodexSidecarEnv.
 * @param options - Optional overrides used by tests and callers.
 */
export function buildCodexSidecarEnv(
  thread: Pick<ThreadRecord, "id" | "projectId" | "worktreePath">,
  options?: {
    rpcHttpOrigin?: string | null;
    rpcUrl?: string | null;
    sessionId?: string | null;
  },
): Record<string, string> {
  const rpcUrl = options?.rpcUrl?.trim() || joltRpcUrl();
  const rpcHttpOrigin =
    options?.rpcHttpOrigin?.trim() || joltRpcHttpOrigin(rpcUrl);
  const sessionId = options?.sessionId?.trim() || null;

  return {
    JOLT_PROJECT_ID: String(thread.projectId),
    JOLT_RPC_HTTP_ORIGIN: rpcHttpOrigin,
    JOLT_RPC_URL: rpcUrl,
    JOLT_THREAD_ID: String(thread.id),
    JOLT_WORKTREE_PATH: thread.worktreePath,
    ...(sessionId
      ? {
          JOLT_SESSION_ID: sessionId,
        }
      : {}),
  };
}
/**
 * Creates codex client.
 * @param thread - thread argument for createCodexClient.
 */

function createCodexClient(
  thread: Pick<ThreadRecord, "id" | "projectId" | "worktreePath">,
  options?: {
    sessionId?: string | null;
  },
): Codex {
  return new Codex({
    config: {
      mcp_servers: {
        [JOLT_MCP_SERVER_NAME]: {
          command: process.execPath,
          args: [JOLT_SIDECAR_SERVER_PATH],
          env: buildCodexSidecarEnv(thread, {
            sessionId: options?.sessionId ?? null,
          }),
        },
      },
    },
  });
}
/**
 * Performs gitPriorityFromRpcRequest operation.
 * @param priority - priority argument for gitPriorityFromRpcRequest.
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
  codexThreadMap.delete(threadId);
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
 * @param status - status argument for setThreadRunStatus.
 */

function setThreadRunStatus(
  threadId: number,
  status: RpcThreadRunStatus,
): void {
  threadRunStatusMap.set(threadId, status);
  invalidateThreadDetailCache(threadId);
}
/**
 * Performs currentThreadRunStatus operation.
 * @param thread - thread argument for currentThreadRunStatus.
 */

function currentThreadRunStatus(thread: ThreadRecord): RpcThreadRunStatus {
  return threadRunStatusFromRecord(thread, threadRunStatusMap.get(thread.id));
}
/**
 * Resolves unsafe mode.
 * @param unsafeMode - unsafeMode argument for resolveUnsafeMode.
 */

function resolveUnsafeMode(unsafeMode: boolean | null | undefined): boolean {
  return unsafeMode === true;
}
/**
 * Performs codexThreadOptions operation.
 * @param worktreePath - Worktree path.
 * @param model - model argument for codexThreadOptions.
 * @param reasoningEffort - reasoningEffort argument for codexThreadOptions.
 * @param unsafeMode - unsafeMode argument for codexThreadOptions.
 */

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
/**
 * Creates managed codex thread.
 * @param thread - thread argument for createManagedCodexThread.
 */

function createManagedCodexThread(
  thread: ThreadRecord,
  sessionId: string | null,
): CodexThread {
  const client = createCodexClient(thread, {
    sessionId,
  });
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
/**
 * Performs ensureCodexThread operation.
 * @param thread - thread argument for ensureCodexThread.
 */

async function ensureCodexThread(
  thread: ThreadRecord,
  sessionId: string | null,
): Promise<CodexThread> {
  const active = codexThreadMap.get(thread.id);
  if (active) {
    return active;
  }

  const next = createManagedCodexThread(thread, sessionId);
  codexThreadMap.set(thread.id, next);
  return next;
}
/**
 * Performs threadById operation.
 * @param threadId - Thread identifier.
 */

function threadById(threadId: number): ThreadRecord {
  const thread = getThreadById(db, threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  return thread;
}
/**
 * Performs rpcThreadById operation.
 * @param threadId - Thread identifier.
 */

function rpcThreadById(threadId: number): RpcThread {
  const thread = threadById(threadId);
  return toRpcThread(thread, currentThreadRunStatus(thread));
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
 * Reads thread detail cached.
 * @param threadId - Thread identifier.
 */

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
 * @param startedAt - startedAt argument for settleCanceledThreadTurn.
 * @param lastAssistantItemId - lastAssistantItemId identifier.
 * @param lastAssistantText - lastAssistantText argument for settleCanceledThreadTurn.
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
/**
 * Builds thread turn activity id.
 * @param startedAt - startedAt argument for buildThreadTurnActivityId.
 * @param itemId - itemId identifier.
 */

function buildThreadTurnActivityId(startedAt: string, itemId: string): string {
  return `${startedAt}:${itemId}`;
}
/**
 * Runs thread message in background.
 * @param threadId - Thread identifier.
 * @param input - input argument for runThreadMessageInBackground.
 * @param startedAt - startedAt argument for runThreadMessageInBackground.
 * @param controller - controller argument for runThreadMessageInBackground.
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
  let terminalError: string | null = null;
  let usage: RpcThreadUsage | null = null;
  const bufferedActivityWriter = createBufferedThreadActivityWriter();

  try {
    const thread = threadById(threadId);
    const codexThread = await ensureCodexThread(thread, sessionId);
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
/**
 * Performs worktreePathFromName operation.
 * @param projectPath - projectPath path used by worktreePathFromName.
 * @param worktreeName - worktreeName argument for worktreePathFromName.
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
/**
 * Lists directory suggestions procedure.
 * @param params - Parameters object.
 */

export async function listDirectorySuggestionsProcedure(
  params: AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
): Promise<AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]> {
  return {
    directories: listDirectorySuggestions(params.query),
  };
}
/**
 * Performs assertProjectDirectory operation.
 * @param projectPath - projectPath path used by assertProjectDirectory.
 */

function assertProjectDirectory(projectPath: string): void {
  if (!existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (!safeIsDirectory(projectPath)) {
    throw new Error(`Project path must be a directory: ${projectPath}`);
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
/**
 * Stringifies activity value.
 * @param value - Input value.
 */

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
/**
 * Performs extractToolCallTextContent operation.
 * @param content - content argument for extractToolCallTextContent.
 */

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
/**
 * Formats tool call output.
 * @param item - item argument for formatToolCallOutput.
 */

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

  /**
   * Performs flushEntries operation.
   * @param force - force argument for flushEntries.
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
   * @param force - force argument for enqueueFlush.
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
 * @param inputs - inputs argument for persistThreadActivityInputs.
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
/**
 * Builds reasoning activity input.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param item - item argument for buildReasoningActivityInput.
 * @param state - Current state value.
 */

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
 * Builds command activity input payload.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param payload - payload argument for buildCommandActivityInputPayload.
 */

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
/**
 * Builds command activity input.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param item - item argument for buildCommandActivityInput.
 */

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
/**
 * Builds file change activity inputs.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param worktreePath - Worktree path.
 * @param item - item argument for buildFileChangeActivityInputs.
 */

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
/**
 * Builds tool call activity input.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param item - item argument for buildToolCallActivityInput.
 */

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
/**
 * Builds web search activity input.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param item - item argument for buildWebSearchActivityInput.
 * @param state - Current state value.
 */

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
/**
 * Builds error activity input.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 * @param item - item argument for buildErrorActivityInput.
 * @param state - Current state value.
 */

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
/**
 * Merges project worktree pins.
 * @param projectId - Project identifier.
 * @param worktrees - worktrees argument for mergeProjectWorktreePins.
 */

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
/**
 * Lists fresh project worktrees.
 * @param projectPath - projectPath path used by listFreshProjectWorktrees.
 * @param projectId - Project identifier.
 * @param options - Configuration options used by this operation.
 */

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
 * @param project - project argument for ensureProjectPoller.
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
  closeTaskWatchers(active);
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
 * Closes task watchers.
 * @param worktreeState - worktreeState argument for closeTaskWatchers.
 */

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
/**
 * Performs areTaskWatchTargetsEqual operation.
 * @param left - left argument for areTaskWatchTargetsEqual.
 * @param right - right argument for areTaskWatchTargetsEqual.
 */

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
/**
 * Performs areProjectTasksEqual operation.
 * @param left - left argument for areProjectTasksEqual.
 * @param right - right argument for areProjectTasksEqual.
 */

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
/**
 * Performs logBackgroundTaskFailure operation.
 * @param message - Message payload.
 * @param error - Error value to process.
 */

function logBackgroundTaskFailure(message: string, error: unknown): void {
  if (isAbortError(error)) {
    return;
  }

  console.error(message, error);
}
/**
 * Performs refreshWorktreeTaskCache operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 * @param options - Configuration options used by this operation.
 */

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
/**
 * Performs stopWorktreeBackgroundPolling operation.
 * @param worktreeState - worktreeState argument for stopWorktreeBackgroundPolling.
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
 * Performs startWorktreeTaskPolling operation.
 * @param state - Current state value.
 * @param worktreePath - Worktree path.
 */

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

    /**
     * Performs unregisterWatcher operation.
     * @param watcherToRemove - watcherToRemove argument for unregisterWatcher.
     */

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
    /**
     * Handles the watch error event.
     * @param error - Error value to process.
     */

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

function projectByIdForPath(projectId: number): ProjectRecord {
  const project = getProjectById(db, projectId);
  if (!project) {
    throw new Error(`Project not currently tracked: ${projectId}`);
  }
  return project;
}
/**
 * Finds project worktree.
 * @param project - project argument for findProjectWorktree.
 * @param worktreePath - Worktree path.
 * @param options - Configuration options used by this operation.
 */

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
/**
 * Performs assertProjectWorktree operation.
 * @param project - project argument for assertProjectWorktree.
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
    throw new Error(
      `Worktree not found for project ${project.path}: ${worktreePath}`,
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
 * @param project - project argument for ensureTrackedProjectWorktree.
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

  throw new Error(
    `Worktree not found for project ${project.path}: ${worktreePath}`,
  );
}
/**
 * Creates thread record.
 * @param project - project argument for createThreadRecord.
 * @param worktreePath - Worktree path.
 * @param model - model argument for createThreadRecord.
 * @param reasoningEffort - reasoningEffort argument for createThreadRecord.
 * @param unsafeMode - unsafeMode argument for createThreadRecord.
 * @param options - Configuration options used by this operation.
 */

async function createThreadRecord(
  project: ProjectRecord,
  worktreePath: string,
  model: string,
  reasoningEffort: RpcCodexReasoningEffort,
  unsafeMode: boolean,
  options?: CreateThreadRecordOptions,
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
    const codexThread = createManagedCodexThread(
      thread,
      options?.sessionId ?? null,
    );
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
/**
 * Performs recordUnsafeModeAuditEvent operation.
 * @param thread - thread argument for recordUnsafeModeAuditEvent.
 * @param unsafeMode - unsafeMode argument for recordUnsafeModeAuditEvent.
 * @param source - source argument for recordUnsafeModeAuditEvent.
 */

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
      openProjectWithGitOptions(params, requestGitOptions),
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
 * @param requestGitOptions - requestGitOptions argument for openProjectWithGitOptions.
 */

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
/**
 * Lists project tasks procedure.
 * @param params - Parameters object.
 * @param context - Execution context.
 */

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
/**
 * Creates worktree procedure.
 * @param params - Parameters object.
 */

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
/**
 * Sets worktree pinned procedure.
 * @param params - Parameters object.
 */

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
/**
 * Creates thread procedure.
 * @param params - Parameters object.
 */

export async function createThreadProcedure(
  params: AppRPCSchema["requests"]["createThread"]["params"],
  context?: RpcRequestContext,
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
/**
 * Gets thread procedure.
 * @param params - Parameters object.
 */

export async function getThreadProcedure(
  params: AppRPCSchema["requests"]["getThread"]["params"],
): Promise<RpcThreadDetail> {
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
/**
 * Sends thread message procedure.
 * @param params - Parameters object.
 */

export async function sendThreadMessageProcedure(
  params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const thread = threadById(params.threadId);
  const input = params.input.trim();
  if (!input) {
    throw new Error("Thread input is required.");
  }

  return queueThreadMessage(thread, input, context?.auth.sessionId ?? null);
}
/**
 * Performs queueThreadMessage operation.
 * @param thread - thread argument for queueThreadMessage.
 * @param input - input argument for queueThreadMessage.
 */

async function queueThreadMessage(
  thread: ThreadRecord,
  input: string,
  sessionId: string | null,
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
    sessionId,
  );
  threadTurnCompletionMap.set(thread.id, completion);
  void completion;

  return readThreadDetailCached(thread.id);
}
/**
 * Performs packageScriptDisplayCommand operation.
 * @param task - task argument for packageScriptDisplayCommand.
 */

function packageScriptDisplayCommand(task: {
  packageDirectory: string;
  scriptName: string;
}): string {
  return task.packageDirectory === "."
    ? `bun run ${task.scriptName}`
    : `cd ${task.packageDirectory} && bun run ${task.scriptName}`;
}
/**
 * Reads process output stream.
 * @param stream - stream argument for readProcessOutputStream.
 * @param onChunk - onChunk argument for readProcessOutputStream.
 * @param signal - Abort signal for cancellation.
 */

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
/**
 * Performs queuePackageScriptTask operation.
 * @param thread - thread argument for queuePackageScriptTask.
 * @param task - task argument for queuePackageScriptTask.
 */

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
/**
 * Runs package script task in background.
 * @param threadId - Thread identifier.
 * @param worktreePath - Worktree path.
 * @param task - task argument for runPackageScriptTaskInBackground.
 * @param startedAt - startedAt argument for runPackageScriptTaskInBackground.
 * @param controller - controller argument for runPackageScriptTaskInBackground.
 */

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

  /**
   * Performs queueCommandActivity operation.
   * @param state - Current state value.
   * @param options - Configuration options used by this operation.
   */

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

    /**
     * Performs appendOutput operation.
     * @param chunk - chunk argument for appendOutput.
     */

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
 * Runs project task procedure.
 * @param params - Parameters object.
 */

export async function runProjectTaskProcedure(
  params: AppRPCSchema["requests"]["runProjectTask"]["params"],
  context?: RpcRequestContext,
): Promise<RpcThreadDetail> {
  const project = projectByIdForPath(params.projectId);
  const worktreePath = normalizePath(params.worktreePath);
  await assertProjectWorktree(project, worktreePath, {
    forceRefresh: true,
  });
  const resolvedTask = await resolveProjectTaskExecution(
    worktreePath,
    params.task,
  );

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
        sessionId: context?.auth.sessionId ?? null,
      },
    );
  }

  try {
    switch (resolvedTask.kind) {
      case "script": {
        const detail = await queuePackageScriptTask(thread, resolvedTask.task);
        recordProjectTaskQueuedAuditEvent(db, {
          createdThread,
          params,
          thread,
        });
        return detail;
      }
      case "file": {
        const detail = await queueThreadMessage(
          thread,
          resolvedTask.prompt,
          context?.auth.sessionId ?? null,
        );
        recordProjectTaskQueuedAuditEvent(db, {
          createdThread,
          params,
          thread,
        });
        return detail;
      }
    }
  } catch (error) {
    if (createdThread) {
      await discardEmptyThreadProcedure({
        threadId: thread.id,
      });
    }
    throw error;
  }
}
/**
 * Performs stopThreadTurnProcedure operation.
 * @param params - Parameters object.
 */

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
/**
 * Performs renameThreadProcedure operation.
 * @param params - Parameters object.
 */

export async function renameThreadProcedure(
  params: AppRPCSchema["requests"]["renameThread"]["params"],
): Promise<RpcThread> {
  return updateThreadMetadataProcedure({
    threadId: params.threadId,
    title: params.title,
    ...(typeof params.summary === "undefined"
      ? {}
      : { summary: params.summary }),
  });
}
/**
 * Updates thread metadata procedure.
 * @param params - Parameters object.
 */

export async function updateThreadMetadataProcedure(
  params: AppRPCSchema["requests"]["updateThreadMetadata"]["params"],
): Promise<RpcThread> {
  const thread = threadById(params.threadId);
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
  return rpcThreadById(thread.id);
}
/**
 * Sets thread pinned procedure.
 * @param params - Parameters object.
 */

export async function setThreadPinnedProcedure(
  params: AppRPCSchema["requests"]["setThreadPinned"]["params"],
): Promise<RpcThread> {
  return updateThreadMetadataProcedure(params);
}
/**
 * Updates thread model procedure.
 * @param params - Parameters object.
 */

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
/**
 * Updates thread reasoning effort procedure.
 * @param params - Parameters object.
 */

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
/**
 * Updates thread unsafe mode procedure.
 * @param params - Parameters object.
 */

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
/**
 * Deletes thread procedure.
 * @param params - Parameters object.
 */

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
/**
 * Performs discardEmptyThreadProcedure operation.
 * @param params - Parameters object.
 */

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
    );
  });
}
/**
 * Opens worktree with git options.
 * @param params - Parameters object.
 * @param requestGitOptions - requestGitOptions argument for openWorktreeWithGitOptions.
 * @param signal - Abort signal for cancellation.
 */

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
  const shouldRefreshTasks = shouldRefreshWorktreeTaskCache(worktreeState);
  const tasksPromise =
    worktreeState.tasks === null && shouldRefreshTasks
      ? awaitAbortableResult(
          refreshWorktreeTaskCache(state, worktreePath, {
            startWatching: true,
          }),
          signal ?? null,
          "Worktree open was aborted.",
        )
      : Promise.resolve(worktreeState.tasks ?? []);
  if (worktreeState.tasks !== null && shouldRefreshTasks) {
    queueBackgroundWorkWhenIdle(
      `task-cache-refresh:${project.id}:${worktreePath}`,
      () => {
        void refreshWorktreeTaskCache(state, worktreePath, {
          notify: true,
          startWatching: true,
        }).catch((error) => {
          logBackgroundTaskFailure(
            `Task cache warm failed for ${worktreePath}`,
            error,
          );
        });
      },
    );
  }
  const [[{ history, summary, signature }, snapshot], tasks] =
    await Promise.all([
      runWorktreeOpenLimited(
        () =>
          Promise.all([
            readGitHistoryFirstPage(
              project.id,
              worktreePath,
              DEFAULT_GIT_HISTORY_PAGE_SIZE,
              requestGitOptions,
            ),
            readAndStoreWorktreeSnapshot(
              state,
              worktreePath,
              requestGitOptions,
            ),
          ]),
        signal,
      ),
      tasksPromise,
    ]);
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
    ? normalizePath(params.worktreePath ?? "")
    : null;
  throwIfAborted(context?.signal, "Active worktree update was aborted.");
  let projectId: number | null = null;
  let worktreePath: string | null = null;
  if (requestedProjectId !== null) {
    const project = projectByIdForPath(requestedProjectId);
    if (project.isOpen === 1) {
      ensureProjectPoller(project);
      projectId = project.id;
      // Validate against a fresh worktree listing so stale UI selections do not
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
        if (isAbortError(error)) {
          throw error;
        }
        worktreePath = null;
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
    const project = projectByIdForPath(params.projectId);
    const openedProject = await awaitAbortableResult(
      openProjectWithGitOptions(
        {
          projectPath: project.path,
          name: project.name,
        },
        requestGitOptions,
      ),
      context?.signal,
      "Context focus was aborted.",
    );
    throwIfAborted(context?.signal, "Context focus was aborted.");

    const normalizedWorktreePath = normalizePath(params.worktreePath);
    const openedWorktree = await awaitAbortableResult(
      openWorktreeWithGitOptions(
        {
          projectId: openedProject.project.id,
          worktreePath: normalizedWorktreePath,
        },
        requestGitOptions,
        context?.signal,
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
      const thread = threadById(params.threadId);
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
/**
 * Closes worktree procedure.
 * @param params - Parameters object.
 */

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
/**
 * Closes project procedure.
 * @param params - Parameters object.
 */

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
/**
 * Deletes project procedure.
 * @param params - Parameters object.
 */

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
 * Sets worktree task change listener.
 * @param listener - Event listener callback.
 */

export function setWorktreeTaskChangeListener(
  listener: ((projectId: number, worktreePath: string) => void) | null,
): void {
  worktreeTaskChangeListener = listener;
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
