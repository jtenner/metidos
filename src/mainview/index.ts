import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type {
  AppRPCSchema,
  ProjectProcedures,
  RpcProcedureCallOptions,
  RpcRequestPriority,
  RpcThreadStartRequest,
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";
import App from "./App";

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type PendingRequest = {
  method: RpcMethodName;
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
};

type RpcRequestMessage<K extends RpcMethodName = RpcMethodName> = {
  type: "request";
  id: number;
  method: K;
  params: RpcRequestMap[K]["params"];
  priority: RpcRequestPriority;
  timeoutMs?: number;
};

type RpcCancelMessage = {
  type: "cancel";
  id: number;
};

type RpcResponseMessage = {
  type: "response";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
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

type RuntimeConfig = {
  devServer: boolean;
  healthUrl?: string;
  rpcWebSocketUrl?: string;
};

const WORKTREE_TASKS_CHANGED_EVENT_NAME = "jolt:worktree-tasks-changed";
const WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME =
  "jolt:worktree-git-history-changed";
const THREAD_START_REQUEST_CREATED_EVENT_NAME =
  "jolt:thread-start-request-created";
const RPC_RECONNECT_BASE_DELAY_MS = 250;
const RPC_RECONNECT_MAX_DELAY_MS = 2_000;

declare global {
  interface WindowEventMap {
    "jolt:worktree-tasks-changed": CustomEvent<RpcWorktreeTasksChanged>;
    "jolt:worktree-git-history-changed": CustomEvent<RpcWorktreeGitHistoryChanged>;
    "jolt:thread-start-request-created": CustomEvent<RpcThreadStartRequest>;
  }

  interface Window {
    joltProcedures: ProjectProcedures;
    __joltAppMountedAt?: number;
    __joltRuntime?: RuntimeConfig;
  }
}

const runtimeConfig: RuntimeConfig = window.__joltRuntime ?? {
  devServer: false,
};

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socketUrl =
  runtimeConfig.rpcWebSocketUrl ??
  `${socketProtocol}//${window.location.host}/rpc`;
const healthUrl = runtimeConfig.healthUrl ?? "/health";
const pendingRequests = new Map<number, PendingRequest>();
let socket: WebSocket | null = null;
let nextRequestId = 1;
let resolveConnection = () => {};
let rejectConnection = (_reason?: unknown) => {};
let connectionReadyResolved = false;
let isPageUnloading = false;
let devRecoveryScheduled = false;
let devRecoveryTimer: number | null = null;
let rpcReconnectTimer: number | null = null;
let rpcReconnectAttempt = 0;
let connectionReady!: Promise<void>;

function resetConnectionReady(): void {
  connectionReadyResolved = false;
  connectionReady = new Promise<void>((resolve, reject) => {
    resolveConnection = () => {
      connectionReadyResolved = true;
      resolve();
    };
    rejectConnection = (reason?: unknown) => {
      reject(reason);
    };
  });
}

resetConnectionReady();

function clearDevRecoveryTimer(): void {
  if (devRecoveryTimer !== null) {
    window.clearTimeout(devRecoveryTimer);
    devRecoveryTimer = null;
  }
}

function clearRpcReconnectTimer(): void {
  if (rpcReconnectTimer !== null) {
    window.clearTimeout(rpcReconnectTimer);
    rpcReconnectTimer = null;
  }
}

function reloadWindow(reason: string): void {
  if (!runtimeConfig.devServer || isPageUnloading) {
    return;
  }

  console.info(`[jolt] reloading dev client (${reason})`);
  isPageUnloading = true;
  clearDevRecoveryTimer();
  window.location.reload();
}

async function waitForDevServer(): Promise<void> {
  if (!runtimeConfig.devServer || isPageUnloading) {
    return;
  }

  try {
    const response = await fetch(healthUrl, {
      // Use the configured health endpoint so split static/RPC deployments
      // can still reuse the existing dev recovery flow.
      cache: "no-store",
    });
    if (response.ok) {
      reloadWindow("server-ready");
      return;
    }
  } catch {
    // Ignore transient failures while the watch process restarts.
  }

  devRecoveryTimer = window.setTimeout(() => {
    void waitForDevServer();
  }, 250);
}

function scheduleDevRecovery(reason: string): void {
  if (!runtimeConfig.devServer || isPageUnloading || devRecoveryScheduled) {
    return;
  }

  devRecoveryScheduled = true;
  console.info(`[jolt] waiting for dev server restart (${reason})`);
  clearDevRecoveryTimer();
  devRecoveryTimer = window.setTimeout(() => {
    void waitForDevServer();
  }, 120);
}

window.addEventListener("beforeunload", () => {
  isPageUnloading = true;
  clearDevRecoveryTimer();
  clearRpcReconnectTimer();
});

function rejectPendingRequests(reason: unknown): void {
  for (const pending of pendingRequests.values()) {
    pending.reject(reason);
  }
  pendingRequests.clear();
}

function scheduleRpcReconnect(reason: string): void {
  if (
    runtimeConfig.devServer ||
    isPageUnloading ||
    rpcReconnectTimer !== null
  ) {
    return;
  }

  const delay = Math.min(
    RPC_RECONNECT_BASE_DELAY_MS * 2 ** rpcReconnectAttempt,
    RPC_RECONNECT_MAX_DELAY_MS,
  );
  rpcReconnectAttempt += 1;
  console.info(`[jolt] reconnecting RPC socket in ${delay}ms (${reason})`);
  rpcReconnectTimer = window.setTimeout(() => {
    rpcReconnectTimer = null;
    connectRpcSocket("reconnect");
  }, delay);
}

function connectRpcSocket(reason: "initial" | "reconnect"): void {
  if (isPageUnloading) {
    return;
  }
  if (
    socket &&
    (socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  clearRpcReconnectTimer();
  const nextSocket = new WebSocket(socketUrl);
  socket = nextSocket;
  if (reason === "reconnect") {
    console.info("[jolt] opening replacement RPC socket");
  }

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) {
      return;
    }

    rpcReconnectAttempt = 0;
    resolveConnection();
  });

  nextSocket.addEventListener("message", (event) => {
    if (socket !== nextSocket) {
      return;
    }

    const payload = JSON.parse(String(event.data)) as RpcSocketMessage;
    if (payload.type === "reload") {
      reloadWindow(payload.reason);
      return;
    }
    if (payload.type === "tasks-changed") {
      window.dispatchEvent(
        new CustomEvent<RpcWorktreeTasksChanged>(
          WORKTREE_TASKS_CHANGED_EVENT_NAME,
          {
            detail: {
              projectId: payload.projectId,
              worktreePath: payload.worktreePath,
            },
          },
        ),
      );
      return;
    }
    if (payload.type === "git-history-changed") {
      window.dispatchEvent(
        new CustomEvent<RpcWorktreeGitHistoryChanged>(
          WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
          {
            detail: {
              projectId: payload.projectId,
              worktreePath: payload.worktreePath,
            },
          },
        ),
      );
      return;
    }
    if (payload.type === "thread-start-request-created") {
      window.dispatchEvent(
        new CustomEvent<RpcThreadStartRequest>(
          THREAD_START_REQUEST_CREATED_EVENT_NAME,
          {
            detail: payload,
          },
        ),
      );
      return;
    }

    const pending = pendingRequests.get(payload.id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(payload.id);
    if (payload.ok) {
      pending.resolve(payload.result);
      return;
    }
    pending.reject(new Error(payload.error || "RPC request failed"));
  });

  nextSocket.addEventListener("close", () => {
    if (socket !== nextSocket) {
      return;
    }

    socket = null;
    const error = new Error("RPC connection closed");
    rejectPendingRequests(error);

    if (runtimeConfig.devServer) {
      rejectConnection(error);
      scheduleDevRecovery("rpc-close");
      return;
    }

    if (connectionReadyResolved) {
      resetConnectionReady();
    }
    scheduleRpcReconnect("rpc-close");
  });

  nextSocket.addEventListener("error", () => {
    if (socket !== nextSocket) {
      return;
    }
    console.error("Jolt RPC socket encountered an error");
  });
}

connectRpcSocket("initial");

function createAbortError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const message =
    typeof reason === "string" && reason.trim() ? reason : fallbackMessage;
  const error = new Error(message, {
    cause: reason,
  });
  if (reason instanceof DOMException && reason.name) {
    error.name = reason.name;
  }
  return error;
}

function normalizeTimeoutMs(timeoutMs?: number): number | null {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }
  return Math.max(1, Math.floor(timeoutMs));
}

function buildRequestSignal(
  options?: RpcProcedureCallOptions,
): AbortSignal | null {
  const signals: AbortSignal[] = [];
  if (options?.signal) {
    signals.push(options.signal);
  }

  const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
  if (timeoutMs !== null) {
    signals.push(AbortSignal.timeout(timeoutMs));
  }

  if (signals.length === 0) {
    return null;
  }
  if (signals.length === 1) {
    return signals[0] ?? null;
  }
  return AbortSignal.any(signals);
}

async function waitForConnection(signal: AbortSignal | null): Promise<void> {
  if (!signal) {
    await connectionReady;
    return;
  }
  if (signal.aborted) {
    throw createAbortError(signal.reason, "RPC request aborted.");
  }

  await Promise.race([
    connectionReady,
    new Promise<never>((_, reject) => {
      const handleAbort = () => {
        signal.removeEventListener("abort", handleAbort);
        reject(createAbortError(signal.reason, "RPC request aborted."));
      };
      signal.addEventListener("abort", handleAbort, {
        once: true,
      });
    }),
  ]);
}

async function waitForOpenSocket(
  signal: AbortSignal | null,
): Promise<WebSocket> {
  while (true) {
    await waitForConnection(signal);
    const activeSocket = socket;
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      return activeSocket;
    }
  }
}

function sendSocketMessage(
  targetSocket: WebSocket,
  message: RpcClientMessage,
): void {
  targetSocket.send(JSON.stringify(message));
}

async function sendRequest<K extends RpcMethodName>(
  method: K,
  params: RpcRequestMap[K]["params"],
  options?: RpcProcedureCallOptions,
): Promise<RpcRequestMap[K]["response"]> {
  const signal = buildRequestSignal(options);
  const requestSocket = await waitForOpenSocket(signal);
  if (signal?.aborted) {
    throw createAbortError(
      signal.reason,
      `RPC request "${String(method)}" aborted.`,
    );
  }

  const id = nextRequestId++;
  const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
  const priority = options?.priority ?? "default";

  const response = new Promise<RpcRequestMap[K]["response"]>(
    (resolve, reject) => {
      let settled = false;
      let removeAbortListener = () => {};
      const finalize = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        pendingRequests.delete(id);
        removeAbortListener();
        callback();
      };

      if (signal) {
        const handleAbort = () => {
          finalize(() => {
            if (requestSocket.readyState === WebSocket.OPEN) {
              sendSocketMessage(requestSocket, {
                type: "cancel",
                id,
              });
            }
            reject(
              createAbortError(
                signal.reason,
                `RPC request "${String(method)}" aborted.`,
              ),
            );
          });
        };
        if (signal.aborted) {
          handleAbort();
          return;
        }
        signal.addEventListener("abort", handleAbort, {
          once: true,
        });
        removeAbortListener = () => {
          signal.removeEventListener("abort", handleAbort);
        };
      }

      pendingRequests.set(id, {
        method,
        reject: (reason) =>
          finalize(() => {
            reject(reason);
          }),
        resolve: (value) =>
          finalize(() => {
            resolve(value as RpcRequestMap[K]["response"]);
          }),
      });
      try {
        sendSocketMessage(requestSocket, {
          type: "request",
          id,
          method,
          params,
          priority,
          ...(timeoutMs !== null ? { timeoutMs } : {}),
        });
      } catch (error) {
        finalize(() => {
          reject(error);
        });
      }
    },
  );

  return response;
}

function createProcedure<K extends RpcMethodName>(
  method: K,
): ProjectProcedures[K] {
  return ((
    params?: RpcRequestMap[K]["params"],
    options?: RpcProcedureCallOptions,
  ) =>
    sendRequest(
      method,
      params as RpcRequestMap[K]["params"],
      options,
    )) as ProjectProcedures[K];
}

const procedures: ProjectProcedures = {
  getHomeDirectory: createProcedure("getHomeDirectory"),
  listDirectorySuggestions: createProcedure("listDirectorySuggestions"),
  getCodexModelCatalog: createProcedure("getCodexModelCatalog"),
  getAppBootstrap: createProcedure("getAppBootstrap"),
  listProjects: createProcedure("listProjects"),
  listThreads: createProcedure("listThreads"),
  openProject: createProcedure("openProject"),
  openProjectsBatch: createProcedure("openProjectsBatch"),
  closeProject: createProcedure("closeProject"),
  deleteProject: createProcedure("deleteProject"),
  listProjectWorktrees: createProcedure("listProjectWorktrees"),
  listProjectTasks: createProcedure("listProjectTasks"),
  createWorktree: createProcedure("createWorktree"),
  openWorktreesBatch: createProcedure("openWorktreesBatch"),
  createThread: createProcedure("createThread"),
  requestThreadStart: createProcedure("requestThreadStart"),
  getThread: createProcedure("getThread"),
  markThreadErrorSeen: createProcedure("markThreadErrorSeen"),
  sendThreadMessage: createProcedure("sendThreadMessage"),
  stopThreadTurn: createProcedure("stopThreadTurn"),
  runProjectTask: createProcedure("runProjectTask"),
  renameThread: createProcedure("renameThread"),
  setThreadPinned: createProcedure("setThreadPinned"),
  updateThreadModel: createProcedure("updateThreadModel"),
  updateThreadReasoningEffort: createProcedure("updateThreadReasoningEffort"),
  updateThreadUnsafeMode: createProcedure("updateThreadUnsafeMode"),
  deleteThread: createProcedure("deleteThread"),
  discardEmptyThread: createProcedure("discardEmptyThread"),
  openWorktree: createProcedure("openWorktree"),
  getWorktreeSnapshot: createProcedure("getWorktreeSnapshot"),
  readWorktreeFileContentPage: createProcedure("readWorktreeFileContentPage"),
  readWorktreeFileDiff: createProcedure("readWorktreeFileDiff"),
  setActiveWorktree: createProcedure("setActiveWorktree"),
  listWorktreeGitHistory: createProcedure("listWorktreeGitHistory"),
  getWorktreeGitCommitDiff: createProcedure("getWorktreeGitCommitDiff"),
  closeWorktree: createProcedure("closeWorktree"),
  setWorktreePinned: createProcedure("setWorktreePinned"),
};

window.joltProcedures = procedures;

const appRoot = document.getElementById("app");
if (!appRoot) {
  console.error("Mainview root not found");
  document.body.innerHTML =
    '<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Mainview root missing (id="app").</main>';
} else {
  console.log("React version:", React.version);
  console.log("Mounting React app (App.tsx)");
  const root = createRoot(appRoot);
  try {
    root.render(createElement(App, { procedures }));
    window.__joltAppMountedAt = Date.now();
  } catch (error) {
    console.error("Failed to mount App.tsx", error);
    window.__joltAppMountedAt = Number.NaN;
    appRoot.innerHTML =
      '<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Failed to initialize App UI. Check console for details.</main>';
  }
}
