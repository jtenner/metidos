import { type FSWatcher, existsSync, watch } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
  Codex,
  type Thread as CodexThread,
  type ThreadItem,
} from "@openai/codex-sdk";

import type { ProjectRecord, ThreadRecord } from "./db";
import {
  createThread,
  createThreadMessage,
  deleteProject,
  deleteThread,
  getProject,
  getProjectById,
  getThreadById,
  initAppDatabase,
  listProjectWorktreePins,
  listProjects,
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
  setThreadUsage,
  stopInProgressThreadMessages,
  updateThreadCodexId,
  upsertProject,
  upsertThreadActivity,
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
  type PendingGitCommitDiffRequest,
  type PendingGitHistoryPrefetch,
  abortGitHistoryPrefetch,
  buildGitHistoryResultFromCache,
  fillGitHistoryCache,
  getCachedGitCommitDiffResult,
  warmGitHistoryCache,
} from "./project-procedures/git-history";
import {
  type TaskWatchTarget,
  formatPackageScriptTaskPrompt,
  formatTaskPrompt,
  readProjectTasksFromDisk,
  readTaskWatchTargets,
  resolvePackageJsonTask,
  resolveProjectTaskFilePath,
  taskTitleFromPath,
} from "./project-procedures/project-tasks";
import {
  awaitAbortableResult,
  createAbortError,
  isAbortError,
  normalizePath,
  readLruValue,
  safeIsDirectory,
  shortName,
  throwIfAborted,
  writeLruValue,
} from "./project-procedures/shared";
import {
  THREAD_INTERRUPTED_MESSAGE,
  THREAD_STOPPED_MESSAGE,
  buildNextCompactionTelemetry,
  buildThreadTitle,
  isStoppedThreadMessage,
  threadRunStatusFromRecord,
  toRpcThread,
  toRpcThreadMessages,
} from "./project-procedures/thread-detail";
import type {
  AppRPCSchema,
  RpcCodexModelCatalog,
  RpcCodexReasoningEffort,
  RpcCreateWorktreeResult,
  RpcGitCommitDiffResult,
  RpcGitHistoryEntry,
  RpcOpenWorktreeResult,
  RpcProject,
  RpcProjectTask,
  RpcProjectWorktreesResult,
  RpcRequestContext,
  RpcRequestPriority,
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
  RpcThreadUsage,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeFileContentPage,
  RpcWorktreeFileDiff,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeSnapshot,
} from "./rpc-schema";

const db = initAppDatabase();
const JOLT_DEFAULT_RPC_URL = "ws://127.0.0.1:7599/rpc";
const JOLT_MCP_SERVER_NAME = "jolt";
const JOLT_SIDECAR_SERVER_PATH = resolve(
  process.cwd(),
  "src/bun/codex-sidecar-mcp.ts",
);

export async function listProjectsProcedure(
  _params?: AppRPCSchema["requests"]["listProjects"]["params"],
): Promise<RpcProject[]> {
  return listProjects(db);
}

export async function listThreadsProcedure(
  _params?: AppRPCSchema["requests"]["listThreads"]["params"],
): Promise<RpcThread[]> {
  return listThreads(db).map((thread) =>
    toRpcThread(thread, currentThreadRunStatus(thread)),
  );
}

export function startProcedureCacheMaintenance(): void {
  startDirectorySuggestionCacheMaintenance();
}

export function warmProcedureStartupCaches(): void {
  warmDirectorySuggestionCache();

  const mostRecentThread = listThreads(db)[0] ?? null;
  if (mostRecentThread) {
    warmThreadDetailCache(mostRecentThread.id);
  }
}

function latestSettledThreadTimestamp(thread: ThreadRecord): string | null {
  if (thread.lastRunAt && thread.lastErrorAt) {
    return thread.lastRunAt >= thread.lastErrorAt
      ? thread.lastRunAt
      : thread.lastErrorAt;
  }

  return thread.lastRunAt ?? thread.lastErrorAt ?? null;
}

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

export async function getCodexModelCatalogProcedure(
  _params?: AppRPCSchema["requests"]["getCodexModelCatalog"]["params"],
): Promise<RpcCodexModelCatalog> {
  return buildCodexModelCatalog();
}

const PROJECT_POLL_INTERVAL_MS = 4_000;
const PROJECT_WORKTREE_CACHE_STALE_MS = 12_000;
const GIT_HISTORY_POLL_INTERVAL_MS = 2_000;
const THREAD_DETAIL_CACHE_MAX_ENTRIES = 32;
const GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES = 64;

type ProjectWorktreeReadOptions = GitCommandOptions & {
  forceRefresh?: boolean;
};

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
  taskWatchers: FSWatcher[];
  lastUpdatedAt: string;
};

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
let worktreeTaskChangeListener:
  | ((projectId: number, worktreePath: string) => void)
  | null = null;
let worktreeGitHistoryChangeListener:
  | ((projectId: number, worktreePath: string) => void)
  | null = null;

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

function codexThreadOptions(
  worktreePath: string,
  model: string,
  reasoningEffort: RpcCodexReasoningEffort,
) {
  return {
    approvalPolicy: "never" as const,
    model,
    modelReasoningEffort: reasoningEffort,
    networkAccessEnabled: true,
    sandboxMode: "workspace-write" as const,
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
        ),
      )
    : client.startThread(
        codexThreadOptions(
          thread.worktreePath,
          model,
          normalizedReasoningEffort,
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
          await upsertAssistantChatActivity(
            threadId,
            activityItemId,
            nextAssistantText,
            event.type === "item.completed" ? "completed" : "in_progress",
          );
        }
        continue;
      }

      if (item.type === "reasoning") {
        await upsertReasoningActivity(
          threadId,
          buildThreadTurnActivityId(startedAt, item.id),
          item,
          event.type === "item.completed" ? "completed" : "in_progress",
        );
        continue;
      }

      if (item.type === "command_execution") {
        await upsertCommandActivity(
          threadId,
          buildThreadTurnActivityId(startedAt, item.id),
          item,
        );
        continue;
      }

      if (item.type === "mcp_tool_call") {
        if (item.server === JOLT_MCP_SERVER_NAME) {
          continue;
        }
        await upsertToolCallActivity(
          threadId,
          buildThreadTurnActivityId(startedAt, item.id),
          item,
        );
        continue;
      }

      if (item.type === "file_change") {
        await upsertFileChangeActivity(
          threadId,
          buildThreadTurnActivityId(startedAt, item.id),
          thread.worktreePath,
          item,
        );
      }
    }

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

async function upsertReasoningActivity(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "reasoning" }>,
  state: "in_progress" | "completed" | "stopped",
): Promise<void> {
  upsertThreadActivity(db, {
    threadId,
    itemId,
    kind: "reasoning",
    text: item.text.trim() || "Reasoning",
    state,
  });
  invalidateThreadDetailCache(threadId);
}

async function upsertAssistantChatActivity(
  threadId: number,
  itemId: string,
  text: string,
  state: "in_progress" | "completed" | "failed" | "stopped",
): Promise<void> {
  upsertThreadActivity(db, {
    threadId,
    itemId,
    kind: "chat",
    role: "assistant",
    text,
    state,
  });
  invalidateThreadDetailCache(threadId);
}

async function upsertCommandActivity(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "command_execution" }>,
): Promise<void> {
  upsertThreadActivity(db, {
    threadId,
    itemId,
    kind: "command",
    text: item.command,
    state: item.status,
    payloadJson: JSON.stringify({
      command: item.command,
      output: item.aggregated_output,
      exitCode: item.exit_code ?? null,
    } satisfies CommandActivityPayload),
  });
  invalidateThreadDetailCache(threadId);
}

async function upsertFileChangeActivity(
  threadId: number,
  itemId: string,
  worktreePath: string,
  item: Extract<ThreadItem, { type: "file_change" }>,
): Promise<void> {
  await Promise.all(
    item.changes.map(async (change) => {
      const diffText =
        item.status === "completed"
          ? await readFileChangeDiff(worktreePath, change.path, change.kind)
          : "";
      const gitPath = normalizeGitPath(worktreePath, change.path);
      upsertThreadActivity(db, {
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
      });
    }),
  );
  invalidateThreadDetailCache(threadId);
}

async function upsertToolCallActivity(
  threadId: number,
  itemId: string,
  item: Extract<ThreadItem, { type: "mcp_tool_call" }>,
): Promise<void> {
  upsertThreadActivity(db, {
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
  });
  invalidateThreadDetailCache(threadId);
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
    taskWatchers: [],
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
    if (
      worktreeState.tasks === null &&
      worktreeState.taskWatchTargets.length === 0
    ) {
      return;
    }

    closeTaskWatchers(worktreeState);
    worktreeState.taskWatchTargets = [];
    worktreeState.tasks = null;
    worktreeState.lastUpdatedAt = getNow();
    worktreeTaskChangeListener?.(state.id, worktreePath);
  };

  for (const target of worktreeState.taskWatchTargets) {
    if (!safeIsDirectory(target.path)) {
      continue;
    }

    try {
      const watcher = watch(target.path, (eventType, filename) => {
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
      watcher.on("error", (error) => {
        console.error(`Task watcher failed for ${target.path}`, error);
        invalidateTaskState();
      });
      worktreeState.taskWatchers.push(watcher);
    } catch (error) {
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

  await refreshProjectPoll(project.id, options);
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
    codexThreadId: null,
  });
  try {
    const codexThread = createManagedCodexThread(thread);
    codexThreadMap.set(thread.id, codexThread);
    return thread;
  } catch (error) {
    clearThreadRuntimeState(thread.id);
    deleteThread(db, thread.id);
    throw error;
  }
}

export async function openProjectProcedure(
  params: AppRPCSchema["requests"]["openProject"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
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
  throwIfAborted(context?.signal, "Project open was aborted.");

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

export async function listProjectWorktreesProcedure(
  params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const project = projectByIdForPath(params.projectId);
  ensureProjectPoller(project);
  const worktrees = await readProjectWorktrees(
    project.path,
    project.id,
    requestGitOptions,
  );

  return {
    project,
    worktrees,
  };
}

export async function listProjectTasksProcedure(
  params: AppRPCSchema["requests"]["listProjectTasks"]["params"],
  context?: RpcRequestContext,
): Promise<RpcProjectTask[]> {
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
  if (worktreeState.tasks !== null) {
    startWorktreeTaskPolling(projectState, worktreePath);
    return worktreeState.tasks;
  }

  throwIfAborted(context?.signal, "Project task read was aborted.");
  const taskWatchTargets = readTaskWatchTargets(worktreePath);
  throwIfAborted(context?.signal, "Project task read was aborted.");
  const tasks = readProjectTasksFromDisk(worktreePath);
  worktreeState.taskWatchTargets = taskWatchTargets;
  worktreeState.tasks = tasks;
  worktreeState.lastUpdatedAt = getNow();
  startWorktreeTaskPolling(projectState, worktreePath);
  return tasks;
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
  const thread = await createThreadRecord(
    project,
    worktreePath,
    model,
    reasoningEffort,
    {
      forceRefresh: true,
    },
  );
  return readThreadDetailCached(thread.id);
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

  let taskPrompt: string;
  switch (params.task.kind) {
    case "script":
      taskPrompt = formatPackageScriptTaskPrompt(
        resolvePackageJsonTask(worktreePath, params.task),
      );
      break;
    case "file": {
      const taskFilePath = resolveProjectTaskFilePath(
        worktreePath,
        params.task.path,
      );
      const taskContent = await Bun.file(taskFilePath).text();
      if (!taskContent.trim()) {
        throw new Error(`Task file is empty: ${params.task.path}`);
      }
      taskPrompt = formatTaskPrompt(
        taskTitleFromPath(params.task.path),
        taskContent,
      );
      break;
    }
    default:
      throw new Error(`Unsupported project task kind: ${params.task.kind}`);
  }

  let thread = params.threadId ? threadById(params.threadId) : null;
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
      {
        forceRefresh: true,
      },
    );
  }

  return queueThreadMessage(thread, taskPrompt);
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
    controller.abort(
      createAbortError(null, "Codex turn was stopped by the user."),
    );
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
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const project = projectByIdForPath(params.projectId);
  const state = ensureProjectPoller(project);
  const worktreePath = normalizePath(params.worktreePath);
  await ensureTrackedProjectWorktree(project, state, worktreePath, {
    ...requestGitOptions,
    forceRefresh: true,
  });

  const worktreeState = ensureWorktreePollState(state, worktreePath);
  const historyPromise = readGitHistoryFirstPage(
    project.id,
    worktreePath,
    DEFAULT_GIT_HISTORY_PAGE_SIZE,
    requestGitOptions,
  );
  const snapshotPromise = readAndStoreWorktreeSnapshot(
    state,
    worktreePath,
    requestGitOptions,
  );
  const [{ history, summary, signature }, snapshot] = await Promise.all([
    historyPromise,
    snapshotPromise,
  ]);
  worktreeState.history = summary;
  worktreeState.historyEntries = history.entries;
  worktreeState.historyNextOffset = history.nextOffset;
  worktreeState.historySignature = signature;
  syncProjectWorktreeBackgroundPolling(state);
  warmGitHistoryCache(worktreeState, worktreePath, logBackgroundGitFailure);

  return {
    project,
    worktree: snapshot,
    history,
  };
}

export async function getWorktreeSnapshotProcedure(
  params: AppRPCSchema["requests"]["getWorktreeSnapshot"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeSnapshot> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const project = projectByIdForPath(params.projectId);
  const state = ensureProjectPoller(project);
  const worktreePath = normalizePath(params.worktreePath);
  await ensureTrackedProjectWorktree(project, state, worktreePath, {
    ...requestGitOptions,
    forceRefresh: true,
  });

  return readAndStoreWorktreeSnapshot(state, worktreePath, requestGitOptions);
}

export async function readWorktreeFileContentPageProcedure(
  params: AppRPCSchema["requests"]["readWorktreeFileContentPage"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeFileContentPage> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const project = projectByIdForPath(params.projectId);
  const state = ensureProjectPoller(project);
  const worktreePath = normalizePath(params.worktreePath);
  await ensureTrackedProjectWorktree(project, state, worktreePath, {
    ...requestGitOptions,
    forceRefresh: true,
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
}

export async function readWorktreeFileDiffProcedure(
  params: AppRPCSchema["requests"]["readWorktreeFileDiff"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeFileDiff> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const project = projectByIdForPath(params.projectId);
  const state = ensureProjectPoller(project);
  const worktreePath = normalizePath(params.worktreePath);
  await ensureTrackedProjectWorktree(project, state, worktreePath, {
    ...requestGitOptions,
    forceRefresh: true,
  });

  const diffText = await readWorktreeChangeDiff(
    worktreePath,
    params.change,
    requestGitOptions,
  );

  return {
    projectId: project.id,
    worktreePath,
    path: normalizeGitPath(worktreePath, params.change.path),
    diffText,
  };
}

export async function listWorktreeGitHistoryProcedure(
  params: AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
  context?: RpcRequestContext,
): Promise<RpcWorktreeGitHistoryResult> {
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

    await fillGitHistoryCache(state, worktreePath, 0, limit, requestGitOptions);
    syncProjectWorktreeBackgroundPolling(projectState);
    warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
    return buildGitHistoryResultFromCache(state, limit, 0);
  }

  if (offset === 0) {
    const { history, summary, signature } = await readGitHistoryFirstPage(
      project.id,
      worktreePath,
      limit,
      requestGitOptions,
    );
    state.history = summary;
    state.historyEntries = history.entries;
    state.historyNextOffset = history.nextOffset;
    state.historySignature = signature;
    state.lastUpdatedAt = summary.lastUpdatedAt;
    syncProjectWorktreeBackgroundPolling(projectState);
    warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
    return history;
  }

  let summary = state.history;
  let signature = state.historySignature;
  if (signature === null) {
    const loadedSummary = await readGitHistorySummary(
      project.id,
      worktreePath,
      requestGitOptions,
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

  await fillGitHistoryCache(
    state,
    worktreePath,
    offset,
    limit,
    requestGitOptions,
  );
  syncProjectWorktreeBackgroundPolling(projectState);
  warmGitHistoryCache(state, worktreePath, logBackgroundGitFailure);
  return buildGitHistoryResultFromCache(state, limit, offset);
}

export async function getWorktreeGitCommitDiffProcedure(
  params: AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
  context?: RpcRequestContext,
): Promise<RpcGitCommitDiffResult> {
  const requestGitOptions = gitCommandOptionsFromRequest(context);
  const project = projectByIdForPath(params.projectId);
  const worktreePath = normalizePath(params.worktreePath);
  if (!findKnownProjectWorktree(project.id, worktreePath)) {
    await assertProjectWorktree(project, worktreePath, requestGitOptions);
  }

  return getCachedGitCommitDiffResult(
    project.id,
    worktreePath,
    params.commitHash,
    {
      gitCommitDiffCache,
      gitCommitDiffRequestCache,
      maxEntries: GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES,
      requestOptions: requestGitOptions,
    },
  );
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
