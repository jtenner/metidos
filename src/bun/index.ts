import { readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ServerWebSocket } from "bun";

import { buildMainviewBundle, MAINVIEW_BUILD_DIR } from "./build-mainview";
import { initAppDatabase } from "./db";
import { getGitSchedulerStats } from "./git";
import {
  closeProjectProcedure,
  closeWorktreeProcedure,
  createThreadProcedure,
  createWorktreeProcedure,
  deleteProjectProcedure,
  deleteThreadProcedure,
  discardEmptyThreadProcedure,
  getAppBootstrapProcedure,
  getCodexModelCatalogProcedure,
  getHomeDirectoryProcedure,
  getProcedureRuntimeStats,
  getThreadProcedure,
  getWorktreeGitCommitDiffProcedure,
  getWorktreeSnapshotProcedure,
  listDirectorySuggestionsProcedure,
  listProjectsProcedure,
  listProjectTasksProcedure,
  listProjectWorktreesProcedure,
  listThreadsProcedure,
  listWorktreeGitHistoryProcedure,
  markThreadErrorSeenProcedure,
  openProjectProcedure,
  openProjectsBatchProcedure,
  openWorktreeProcedure,
  readWorktreeFileContentPageProcedure,
  readWorktreeFileDiffProcedure,
  recoverInterruptedThreadTurnsOnStartup,
  renameThreadProcedure,
  requestThreadStartProcedure,
  runProjectTaskProcedure,
  sendThreadMessageProcedure,
  setActiveWorktreeProcedure,
  setThreadPinnedProcedure,
  setWorktreeGitHistoryChangeListener,
  setWorktreePinnedProcedure,
  setWorktreeTaskChangeListener,
  shutdownActiveThreadTurns,
  shutdownProcedureCacheMaintenance,
  shutdownProjectPolling,
  startProcedureCacheMaintenance,
  stopThreadTurnProcedure,
  suspendActiveWorktreePolling,
  updateThreadModelProcedure,
  updateThreadReasoningEffortProcedure,
  updateThreadUnsafeModeProcedure,
  warmProcedureStartupCaches,
} from "./project-procedures";
import type {
  AppRPCSchema,
  RpcRequestContext,
  RpcRequestPriority,
  RpcThreadStartRequest,
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeTasksChanged,
} from "./rpc-schema";

const DEFAULT_SERVER_PORT = "7599";
const MAINVIEW_SOURCE_DIR = resolve(process.cwd(), "src/mainview");
const MAINVIEW_HTML_PATH = resolve(process.cwd(), "src/mainview/index.html");
const MAINVIEW_CSS_PATH = resolve(process.cwd(), "src/mainview/index.css");
const FIRA_CODE_VARIABLE_FONT_PATH = resolve(
  process.cwd(),
  "node_modules/firacode/distr/woff2/FiraCode-VF.woff2",
);
const INTER_VARIABLE_FONT_LATIN_PATH = resolve(
  process.cwd(),
  "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
);
const INTER_VARIABLE_FONT_LATIN_EXT_PATH = resolve(
  process.cwd(),
  "node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
);
const MAINVIEW_RELOAD_DEBOUNCE_MS = 90;
const MAINVIEW_WATCH_INTERVAL_MS = 250;
const SERVER_IDLE_TIMEOUT_SECONDS = 30;
const SERVER_MONITOR_INTERVAL_MS = 1_000;
const SERVER_OVERLOAD_LOG_INTERVAL_MS = 10_000;
const EVENT_LOOP_LAG_WARN_MS = 150;
const PENDING_RPC_WARN_COUNT = 8;

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type RpcRequestMessage = {
  type: "request";
  id: number;
  method: RpcMethodName;
  params: RpcRequestMap[RpcMethodName]["params"];
  priority: RpcRequestPriority;
  timeoutMs?: number;
};

type RpcCancelMessage = {
  type: "cancel";
  id: number;
};

type RpcResponseMessage =
  | {
      type: "response";
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: "response";
      id: number;
      ok: false;
      error: string;
    };

type RpcReloadMessage = {
  type: "reload";
  reason: string;
};

type RpcTasksChangedMessage = RpcWorktreeTasksChanged & {
  type: "tasks-changed";
};

type RpcGitHistoryChangedMessage = RpcWorktreeGitHistoryChanged & {
  type: "git-history-changed";
};

type RpcThreadStartRequestCreatedMessage = RpcThreadStartRequest & {
  type: "thread-start-request-created";
};

type RpcSocketMessage =
  | RpcResponseMessage
  | RpcReloadMessage
  | RpcTasksChangedMessage
  | RpcGitHistoryChangedMessage
  | RpcThreadStartRequestCreatedMessage;

type RpcClientMessage = RpcRequestMessage | RpcCancelMessage;

type RpcRequestHandlerMap = {
  [K in keyof RpcRequestMap]: (
    params: RpcRequestMap[K]["params"],
    context: RpcRequestContext,
  ) => Promise<RpcRequestMap[K]["response"]>;
};

type PendingRpcRequest = {
  controller: AbortController;
  signal: AbortSignal;
  timeoutMs: number | null;
  canceledByClient: boolean;
};

function isStringInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function readCliPort(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error(`Missing value for ${arg}`);
      }
      return nextArg;
    }
    if (arg.startsWith("--port=")) {
      return arg.slice("--port=".length);
    }
    if (arg.startsWith("-p=")) {
      return arg.slice("-p=".length);
    }
  }

  return null;
}

function resolveServerPort(args: string[], envPort?: string): number {
  const configuredPort = readCliPort(args) ?? envPort ?? DEFAULT_SERVER_PORT;
  if (!isStringInteger(configuredPort)) {
    throw new Error(
      `Invalid port "${configuredPort}". Expected an integer string from --port, -p, or JOLT_PORT.`,
    );
  }

  const parsedPort = Number.parseInt(configuredPort, 10);
  if (parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(
      `Invalid port "${configuredPort}". Expected an integer string between 1 and 65535.`,
    );
  }

  return parsedPort;
}

const SERVER_ARGS = Bun.argv.slice(2);
const CONFIGURED_SERVER_PORT =
  readCliPort(SERVER_ARGS) ?? process.env.JOLT_PORT;
const SERVER_PORT = resolveServerPort(SERVER_ARGS, process.env.JOLT_PORT);
const SERVER_PORT_IS_EXPLICIT = CONFIGURED_SERVER_PORT !== undefined;
const BACKEND_ONLY =
  SERVER_ARGS.includes("--backend-only") ||
  process.env.JOLT_BACKEND_ONLY === "1";
const IS_DEV_SERVER =
  SERVER_ARGS.includes("--dev") || process.env.JOLT_DEV === "1";

process.env.JOLT_PORT = String(SERVER_PORT);
process.env.JOLT_RPC_URL = `ws://127.0.0.1:${SERVER_PORT}/rpc`;

const rpcHandlers: RpcRequestHandlerMap = {
  getHomeDirectory: () => getHomeDirectoryProcedure(),
  listDirectorySuggestions: (params) =>
    listDirectorySuggestionsProcedure(params),
  getCodexModelCatalog: (params) => getCodexModelCatalogProcedure(params),
  getAppBootstrap: () => getAppBootstrapProcedure(),
  listProjects: (params) => listProjectsProcedure(params),
  listThreads: (params) => listThreadsProcedure(params),
  openProject: (params, context) => openProjectProcedure(params, context),
  openProjectsBatch: (params, context) =>
    openProjectsBatchProcedure(params, context),
  closeProject: (params) => closeProjectProcedure(params),
  deleteProject: (params) => deleteProjectProcedure(params),
  listProjectWorktrees: (params, context) =>
    listProjectWorktreesProcedure(params, context),
  listProjectTasks: (params, context) =>
    listProjectTasksProcedure(params, context),
  createWorktree: (params) => createWorktreeProcedure(params),
  createThread: (params) => createThreadProcedure(params),
  requestThreadStart: async (params) => {
    const request = await requestThreadStartProcedure(params);
    broadcastThreadStartRequestCreated(request);
    return request;
  },
  getThread: (params) => getThreadProcedure(params),
  markThreadErrorSeen: (params) => markThreadErrorSeenProcedure(params),
  sendThreadMessage: (params) => sendThreadMessageProcedure(params),
  stopThreadTurn: (params) => stopThreadTurnProcedure(params),
  runProjectTask: (params) => runProjectTaskProcedure(params),
  renameThread: (params) => renameThreadProcedure(params),
  setThreadPinned: (params) => setThreadPinnedProcedure(params),
  updateThreadModel: (params) => updateThreadModelProcedure(params),
  updateThreadReasoningEffort: (params) =>
    updateThreadReasoningEffortProcedure(params),
  updateThreadUnsafeMode: (params) => updateThreadUnsafeModeProcedure(params),
  deleteThread: (params) => deleteThreadProcedure(params),
  discardEmptyThread: (params) => discardEmptyThreadProcedure(params),
  openWorktree: (params, context) => openWorktreeProcedure(params, context),
  getWorktreeSnapshot: (params, context) =>
    getWorktreeSnapshotProcedure(params, context),
  readWorktreeFileContentPage: (params, context) =>
    readWorktreeFileContentPageProcedure(params, context),
  readWorktreeFileDiff: (params, context) =>
    readWorktreeFileDiffProcedure(params, context),
  setActiveWorktree: (params) => setActiveWorktreeProcedure(params),
  listWorktreeGitHistory: (params, context) =>
    listWorktreeGitHistoryProcedure(params, context),
  getWorktreeGitCommitDiff: (params, context) =>
    getWorktreeGitCommitDiffProcedure(params, context),
  closeWorktree: (params) => closeWorktreeProcedure(params),
  setWorktreePinned: (params) => setWorktreePinnedProcedure(params),
};

const rpcClients = new Set<ServerWebSocket<unknown>>();
const pendingRpcRequestsByClient = new WeakMap<
  ServerWebSocket<unknown>,
  Map<number, PendingRpcRequest>
>();
const pendingMainviewChanges = new Set<string>();

let mainviewBundlePath = resolve(MAINVIEW_BUILD_DIR, "index.js");
let mainviewBuildPromise: Promise<string> | null = null;
let mainviewRebuildQueued = false;
let devMainviewPollTimer: ReturnType<typeof setInterval> | null = null;
let pendingMainviewReloadTimer: ReturnType<typeof setTimeout> | null = null;
let mainviewFileStamps = new Map<string, number>();
let overloadMonitorTimer: ReturnType<typeof setInterval> | null = null;
let pendingRpcRequestCount = 0;
let peakPendingRpcRequestCount = 0;
let lastEventLoopLagMs = 0;
let peakEventLoopLagMs = 0;
let lastOverloadLogAt = 0;

function stringResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

function fileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

function incrementPendingRpcRequestCount(): void {
  pendingRpcRequestCount += 1;
  peakPendingRpcRequestCount = Math.max(
    peakPendingRpcRequestCount,
    pendingRpcRequestCount,
  );
}

function decrementPendingRpcRequestCount(count = 1): void {
  pendingRpcRequestCount = Math.max(0, pendingRpcRequestCount - count);
}

function buildServerHealthSnapshot(activeServerPort: number): {
  backendOnly: boolean;
  devServer: boolean;
  eventLoopLagMs: {
    current: number;
    peak: number;
  };
  git: ReturnType<typeof getGitSchedulerStats>;
  ok: true;
  pendingRpcRequests: {
    current: number;
    peak: number;
  };
  port: number;
  procedures: ReturnType<typeof getProcedureRuntimeStats>;
  rpcClientCount: number;
  rpcWebSocketUrl: string;
} {
  return {
    backendOnly: BACKEND_ONLY,
    devServer: IS_DEV_SERVER,
    eventLoopLagMs: {
      current: lastEventLoopLagMs,
      peak: peakEventLoopLagMs,
    },
    git: getGitSchedulerStats(),
    ok: true,
    pendingRpcRequests: {
      current: pendingRpcRequestCount,
      peak: peakPendingRpcRequestCount,
    },
    port: activeServerPort,
    procedures: getProcedureRuntimeStats(),
    rpcClientCount: rpcClients.size,
    rpcWebSocketUrl:
      process.env.JOLT_RPC_URL ?? `ws://127.0.0.1:${activeServerPort}/rpc`,
  };
}

function startOverloadMonitoring(activeServerPort: () => number): void {
  if (overloadMonitorTimer) {
    return;
  }

  let expectedAt = performance.now() + SERVER_MONITOR_INTERVAL_MS;
  overloadMonitorTimer = setInterval(() => {
    const now = performance.now();
    lastEventLoopLagMs = Math.max(0, now - expectedAt);
    peakEventLoopLagMs = Math.max(peakEventLoopLagMs, lastEventLoopLagMs);
    expectedAt = now + SERVER_MONITOR_INTERVAL_MS;

    const health = buildServerHealthSnapshot(activeServerPort());
    const hasPressure =
      health.eventLoopLagMs.current >= EVENT_LOOP_LAG_WARN_MS ||
      health.pendingRpcRequests.current >= PENDING_RPC_WARN_COUNT ||
      health.git.queuedBackgroundCount > 0 ||
      health.git.queuedForegroundCount > 0 ||
      health.procedures.foregroundReadCount > 0 ||
      health.procedures.taskCacheRefreshLimit.pendingCount > 0 ||
      health.procedures.gitHistoryReadLimit.pendingCount > 0 ||
      health.procedures.diffLoadLimit.pendingCount > 0;

    if (!hasPressure) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs - lastOverloadLogAt < SERVER_OVERLOAD_LOG_INTERVAL_MS) {
      return;
    }
    lastOverloadLogAt = nowMs;
    console.warn("Server overload pressure", JSON.stringify(health));
  }, SERVER_MONITOR_INTERVAL_MS);
}

function isAddressInUseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EADDRINUSE"
  );
}

async function htmlResponse(): Promise<Response> {
  const cssFile = Bun.file(MAINVIEW_CSS_PATH);
  const inlineCss = (await cssFile.exists())
    ? `<style>${(await cssFile.text()).replaceAll("</style", "<\\/style")}</style>`
    : "";
  const runtimeScript = `<script>window.__joltRuntime=${JSON.stringify({
    devServer: IS_DEV_SERVER,
  })};</script>`;
  const template = await Bun.file(MAINVIEW_HTML_PATH).text();
  const html = template.includes("</head>")
    ? template.replace(
        "</head>",
        `${inlineCss ? `${inlineCss}\n\t\t` : ""}${runtimeScript}\n\t</head>`,
      )
    : `${inlineCss}${runtimeScript}\n${template}`;

  return stringResponse(html, "text/html; charset=utf-8");
}

function parseRpcRequestMessage(raw: string): RpcRequestMessage {
  const parsed = JSON.parse(raw) as Partial<RpcRequestMessage>;
  if (
    parsed.type !== "request" ||
    typeof parsed.id !== "number" ||
    typeof parsed.method !== "string" ||
    !(parsed.method in rpcHandlers)
  ) {
    throw new Error("Invalid RPC request payload");
  }

  const timeoutMs = normalizeTimeoutMs(parsed.timeoutMs);
  return {
    ...parsed,
    type: "request",
    id: parsed.id,
    method: parsed.method as RpcMethodName,
    params: parsed.params as RpcRequestMap[RpcMethodName]["params"],
    priority: normalizeRpcRequestPriority(parsed.priority),
    ...(timeoutMs !== null ? { timeoutMs } : {}),
  };
}

function parseRpcClientMessage(raw: string): RpcClientMessage {
  const parsed = JSON.parse(raw) as Partial<RpcClientMessage>;
  if (parsed.type === "cancel" && typeof parsed.id === "number") {
    return {
      type: "cancel",
      id: parsed.id,
    };
  }
  return parseRpcRequestMessage(raw);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createAbortError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" && reason.trim() ? reason : fallbackMessage,
    {
      cause: reason,
    },
  );
  if (reason instanceof DOMException && reason.name) {
    error.name = reason.name;
  } else {
    error.name = "AbortError";
  }
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function normalizeTimeoutMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeRpcRequestPriority(value: unknown): RpcRequestPriority {
  if (value === "background" || value === "default" || value === "foreground") {
    return value;
  }
  return "default";
}

function getPendingRpcRequests(
  client: ServerWebSocket<unknown>,
): Map<number, PendingRpcRequest> {
  const existing = pendingRpcRequestsByClient.get(client);
  if (existing) {
    return existing;
  }

  const created = new Map<number, PendingRpcRequest>();
  pendingRpcRequestsByClient.set(client, created);
  return created;
}

function abortPendingRpcRequest(
  client: ServerWebSocket<unknown>,
  requestId: number,
): void {
  const pendingRequests = pendingRpcRequestsByClient.get(client);
  const pending = pendingRequests?.get(requestId);
  if (!pending) {
    return;
  }

  pending.canceledByClient = true;
  pending.controller.abort(
    createAbortError(
      null,
      `RPC request ${requestId} was canceled by the client.`,
    ),
  );
}

function abortAllPendingRpcRequests(
  client: ServerWebSocket<unknown>,
  reason: string,
): void {
  const pendingRequests = pendingRpcRequestsByClient.get(client);
  if (!pendingRequests) {
    return;
  }

  for (const pending of pendingRequests.values()) {
    pending.canceledByClient = true;
    pending.controller.abort(createAbortError(null, reason));
  }
  decrementPendingRpcRequestCount(pendingRequests.size);
  pendingRequests.clear();
  pendingRpcRequestsByClient.delete(client);
}

async function awaitRequestResult<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw createAbortError(signal.reason, "RPC request aborted.");
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(createAbortError(signal.reason, "RPC request aborted."));
    };
    signal.addEventListener("abort", handleAbort, {
      once: true,
    });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function parseRawSocketMessage(rawMessage: string | Buffer): string {
  return typeof rawMessage === "string"
    ? rawMessage
    : Buffer.from(rawMessage).toString("utf8");
}

function buildRequestSignal(timeoutMs: number | null): {
  controller: AbortController;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  if (typeof timeoutMs !== "number") {
    return {
      controller,
      signal: controller.signal,
    };
  }

  return {
    controller,
    signal: AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
    ]),
  };
}

function isTimeoutAbort(signal: AbortSignal): boolean {
  return (
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
  );
}

function toRpcAbortMessage(
  request: RpcRequestMessage,
  pending: PendingRpcRequest,
  error: unknown,
): string {
  if (pending.timeoutMs !== null && isTimeoutAbort(pending.signal)) {
    return `RPC request "${String(request.method)}" timed out after ${pending.timeoutMs}ms.`;
  }
  return toErrorMessage(error);
}

function queueMainviewBundleBuild(): Promise<string> {
  if (mainviewBuildPromise) {
    mainviewRebuildQueued = true;
    return mainviewBuildPromise;
  }

  mainviewBuildPromise = (async () => {
    try {
      do {
        mainviewRebuildQueued = false;
        mainviewBundlePath = await buildMainviewBundle();
      } while (mainviewRebuildQueued);

      return mainviewBundlePath;
    } finally {
      mainviewBuildPromise = null;
    }
  })();

  return mainviewBuildPromise;
}

function broadcastReload(reason: string): void {
  if (!IS_DEV_SERVER || rpcClients.size === 0) {
    return;
  }

  const payload: RpcReloadMessage = {
    type: "reload",
    reason,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

function broadcastTasksChanged(projectId: number, worktreePath: string): void {
  if (rpcClients.size === 0) {
    return;
  }

  const payload: RpcTasksChangedMessage = {
    type: "tasks-changed",
    projectId,
    worktreePath,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

function broadcastGitHistoryChanged(
  projectId: number,
  worktreePath: string,
): void {
  if (rpcClients.size === 0) {
    return;
  }

  const payload: RpcGitHistoryChangedMessage = {
    type: "git-history-changed",
    projectId,
    worktreePath,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

function broadcastThreadStartRequestCreated(
  request: RpcThreadStartRequest,
): void {
  if (rpcClients.size === 0) {
    return;
  }

  const payload: RpcThreadStartRequestCreatedMessage = {
    type: "thread-start-request-created",
    ...request,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

function normalizeWatchFilename(filename?: string | Buffer | null): string {
  if (typeof filename === "string") {
    return filename.trim();
  }
  if (filename) {
    return filename.toString("utf8").trim();
  }
  return "";
}

function flushPendingMainviewReloads(): void {
  pendingMainviewReloadTimer = null;
  const changedFiles = [...pendingMainviewChanges].map((entry) =>
    entry.toLowerCase(),
  );
  pendingMainviewChanges.clear();

  const requiresBuild = changedFiles.some(
    (entry) => !entry || entry.endsWith(".ts") || entry.endsWith(".tsx"),
  );
  const requiresReload =
    requiresBuild ||
    changedFiles.some(
      (entry) => !entry || entry === "index.css" || entry === "index.html",
    );
  if (!requiresReload) {
    return;
  }

  void (async () => {
    if (requiresBuild) {
      try {
        await queueMainviewBundleBuild();
      } catch (error) {
        console.error(
          "Failed to rebuild the mainview bundle after a source change",
          error,
        );
        return;
      }
    }

    broadcastReload(requiresBuild ? "mainview-source" : "mainview-asset");
  })();
}

function enqueueMainviewReload(filename?: string | Buffer | null): void {
  const normalizedFilename = normalizeWatchFilename(filename);
  pendingMainviewChanges.add(normalizedFilename);

  if (pendingMainviewReloadTimer) {
    clearTimeout(pendingMainviewReloadTimer);
  }
  pendingMainviewReloadTimer = setTimeout(
    flushPendingMainviewReloads,
    MAINVIEW_RELOAD_DEBOUNCE_MS,
  );
}

function readMainviewFileStamps(): Map<string, number> {
  const nextStamps = new Map<string, number>();
  const visitedRealPaths = new Set<string>();

  const readDirectory = (directoryPath: string) => {
    let realPath: string;
    try {
      realPath = realpathSync(directoryPath);
    } catch {
      return;
    }

    if (visitedRealPaths.has(realPath)) {
      return;
    }
    visitedRealPaths.add(realPath);

    let entries: string[];
    try {
      entries = readdirSync(directoryPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = resolve(directoryPath, entry);
      const stats = statSync(entryPath, {
        throwIfNoEntry: false,
      });
      if (!stats) {
        continue;
      }
      if (stats.isDirectory()) {
        readDirectory(entryPath);
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }

      nextStamps.set(
        relative(MAINVIEW_SOURCE_DIR, entryPath).replace(/\\/g, "/"),
        stats.mtimeMs,
      );
    }
  };

  readDirectory(MAINVIEW_SOURCE_DIR);

  return nextStamps;
}

function startDevMainviewWatcher(): void {
  if (!IS_DEV_SERVER || devMainviewPollTimer) {
    return;
  }

  mainviewFileStamps = readMainviewFileStamps();
  devMainviewPollTimer = setInterval(() => {
    const nextStamps = readMainviewFileStamps();
    for (const [entry, mtimeMs] of nextStamps) {
      const previousMtimeMs = mainviewFileStamps.get(entry);
      if (previousMtimeMs !== mtimeMs) {
        enqueueMainviewReload(entry);
      }
    }
    for (const entry of mainviewFileStamps.keys()) {
      if (!nextStamps.has(entry)) {
        enqueueMainviewReload(entry);
      }
    }
    mainviewFileStamps = nextStamps;
  }, MAINVIEW_WATCH_INTERVAL_MS);
}

function shutdownDevWatchers(): void {
  if (devMainviewPollTimer) {
    clearInterval(devMainviewPollTimer);
    devMainviewPollTimer = null;
  }
  mainviewFileStamps.clear();

  if (pendingMainviewReloadTimer) {
    clearTimeout(pendingMainviewReloadTimer);
    pendingMainviewReloadTimer = null;
  }
  pendingMainviewChanges.clear();
}

async function bootstrap(): Promise<void> {
  initAppDatabase();
  recoverInterruptedThreadTurnsOnStartup();
  if (!BACKEND_ONLY) {
    await queueMainviewBundleBuild();
    startDevMainviewWatcher();
  }
  startProcedureCacheMaintenance();
  setWorktreeTaskChangeListener((projectId, worktreePath) => {
    broadcastTasksChanged(projectId, worktreePath);
  });
  setWorktreeGitHistoryChangeListener((projectId, worktreePath) => {
    broadcastGitHistoryChanged(projectId, worktreePath);
  });

  let activeServerPort = SERVER_PORT;
  startOverloadMonitoring(() => activeServerPort);
  const serverOptions = {
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
    async fetch(request, serverInstance) {
      const { pathname } = new URL(request.url);

      if (pathname === "/rpc") {
        if (serverInstance.upgrade(request)) {
          return;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (!BACKEND_ONLY && (pathname === "/" || pathname === "/index.html")) {
        return htmlResponse();
      }

      if (!BACKEND_ONLY && pathname === "/index.css") {
        return fileResponse(MAINVIEW_CSS_PATH, "text/css; charset=utf-8");
      }

      if (!BACKEND_ONLY && pathname === "/index.js") {
        return fileResponse(
          mainviewBundlePath,
          "application/javascript; charset=utf-8",
        );
      }

      if (!BACKEND_ONLY && pathname === "/fonts/fira-code-vf.woff2") {
        return fileResponse(FIRA_CODE_VARIABLE_FONT_PATH, "font/woff2");
      }

      if (
        !BACKEND_ONLY &&
        pathname === "/fonts/inter-latin-wght-normal.woff2"
      ) {
        return fileResponse(INTER_VARIABLE_FONT_LATIN_PATH, "font/woff2");
      }

      if (
        !BACKEND_ONLY &&
        pathname === "/fonts/inter-latin-ext-wght-normal.woff2"
      ) {
        return fileResponse(INTER_VARIABLE_FONT_LATIN_EXT_PATH, "font/woff2");
      }

      if (pathname === "/health") {
        return stringResponse(
          JSON.stringify(buildServerHealthSnapshot(activeServerPort)),
          "application/json; charset=utf-8",
        );
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        rpcClients.add(ws);
        getPendingRpcRequests(ws);
      },
      close(ws) {
        rpcClients.delete(ws);
        abortAllPendingRpcRequests(ws, "RPC connection closed.");
        if (rpcClients.size === 0) {
          suspendActiveWorktreePolling();
        }
      },
      message(ws, rawMessage) {
        void (async () => {
          const payload = parseRawSocketMessage(rawMessage);
          let requestId = -1;
          try {
            const message = parseRpcClientMessage(payload);
            if (message.type === "cancel") {
              abortPendingRpcRequest(ws, message.id);
              return;
            }

            const request = message;
            requestId = request.id;
            const pendingRequests = getPendingRpcRequests(ws);
            if (pendingRequests.has(request.id)) {
              throw new Error(`RPC request ${request.id} is already pending.`);
            }

            const { controller, signal } = buildRequestSignal(
              request.timeoutMs ?? null,
            );
            const pending: PendingRpcRequest = {
              controller,
              signal,
              timeoutMs: request.timeoutMs ?? null,
              canceledByClient: false,
            };
            pendingRequests.set(request.id, pending);
            incrementPendingRpcRequestCount();

            const handler = rpcHandlers[request.method] as (
              params: RpcRequestMap[RpcMethodName]["params"],
              context: RpcRequestContext,
            ) => Promise<RpcRequestMap[RpcMethodName]["response"]>;
            try {
              const result = await awaitRequestResult(
                handler(request.params, {
                  signal,
                  priority: request.priority,
                  timeoutMs: pending.timeoutMs,
                }),
                signal,
              );
              if (pending.canceledByClient || signal.aborted) {
                return;
              }

              const response: RpcResponseMessage = {
                id: request.id,
                ok: true,
                result,
                type: "response",
              };
              ws.send(JSON.stringify(response satisfies RpcSocketMessage));
            } catch (error) {
              if (pending.canceledByClient) {
                return;
              }

              const response: RpcResponseMessage = {
                id: request.id,
                ok: false,
                error:
                  isAbortError(error) && signal.aborted
                    ? toRpcAbortMessage(request, pending, error)
                    : toErrorMessage(error),
                type: "response",
              };
              ws.send(JSON.stringify(response satisfies RpcSocketMessage));
            } finally {
              if (pendingRequests.get(request.id) === pending) {
                pendingRequests.delete(request.id);
                decrementPendingRpcRequestCount();
              }
            }
          } catch (error) {
            if (requestId < 0) {
              try {
                const parsed = JSON.parse(payload) as { id?: number };
                requestId = typeof parsed.id === "number" ? parsed.id : -1;
              } catch {
                requestId = -1;
              }
            }
            if (requestId < 0) {
              return;
            }
            const response: RpcResponseMessage = {
              id: requestId,
              ok: false,
              error: toErrorMessage(error),
              type: "response",
            };
            ws.send(JSON.stringify(response satisfies RpcSocketMessage));
          }
        })();
      },
    },
  } satisfies Bun.Serve.Options<undefined>;

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      ...serverOptions,
      port: SERVER_PORT,
    });
  } catch (error) {
    if (
      !IS_DEV_SERVER ||
      SERVER_PORT_IS_EXPLICIT ||
      !isAddressInUseError(error)
    ) {
      throw error;
    }

    server = Bun.serve({
      ...serverOptions,
      port: 0,
    });
    activeServerPort = server.port ?? activeServerPort;
    console.warn(
      `Port ${SERVER_PORT} is already in use; Jolt dev server fell back to http://localhost:${server.port ?? activeServerPort}.`,
    );
  }
  activeServerPort = server.port ?? activeServerPort;

  console.log(
    BACKEND_ONLY
      ? `Jolt RPC backend listening on http://localhost:${server.port}`
      : `Jolt web app listening on http://localhost:${server.port}${IS_DEV_SERVER ? " (live reload enabled)" : ""}`,
  );

  setTimeout(() => {
    warmProcedureStartupCaches();
  }, 0);
}

let shutdownPromise: Promise<void> | null = null;

async function shutdownAndExit(exitCode: number): Promise<void> {
  if (shutdownPromise) {
    process.exit(exitCode);
  }

  shutdownPromise = (async () => {
    shutdownDevWatchers();
    if (overloadMonitorTimer) {
      clearInterval(overloadMonitorTimer);
      overloadMonitorTimer = null;
    }
    setWorktreeGitHistoryChangeListener(null);
    setWorktreeTaskChangeListener(null);
    shutdownProcedureCacheMaintenance();
    shutdownProjectPolling();
    await shutdownActiveThreadTurns();
  })()
    .catch((error) => {
      console.error("Failed to cleanly shut down Jolt", error);
    })
    .finally(() => {
      process.exit(exitCode);
    });

  await shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdownAndExit(0);
});

process.on("SIGTERM", () => {
  void shutdownAndExit(0);
});

process.on("uncaughtException", (error) => {
  console.error(error);
  void shutdownAndExit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(reason);
  void shutdownAndExit(1);
});

await bootstrap();
