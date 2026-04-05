/**
 * @file src/mainview/index.ts
 * @description Module for index.
 */

import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type {
  AppRPCSchema,
  ProjectProcedures,
  RpcContextFocusChanged,
  RpcProcedureCallOptions,
  RpcRequestPriority,
  RpcThreadStartRequest,
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";
import {
  type InjectedRuntimeConfig,
  RUNTIME_CONFIG_ELEMENT_ID,
} from "../bun/server-security";
import {
  publishWorktreeGitHistoryChanged,
  publishWorktreeTasksChanged,
} from "./app/invalidation-events";
import { loadRichMarkdownModule } from "./app/message-markdown-loader";
import { CONTEXT_FOCUS_CHANGED_EVENT_NAME } from "./app/state";
import {
  AuthApiError,
  dispatchAuthRequired,
  isAuthRequiredError,
  issueWebSocketTicket,
} from "./auth-client";
import AuthShell from "./auth-shell";
import {
  isAuthRequiredRpcError,
  normalizeRpcErrorDetails,
  RpcError,
} from "./rpc-errors";

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

/** Tracked pending call awaiting a response on the shared websocket channel. */
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
  errorCode?: string;
  errorDetails?: Record<string, string | null> | null;
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

type RpcContextFocusChangedMessage = RpcContextFocusChanged & {
  type: "context-focus-changed";
};

type RpcThreadStartRequestCreatedMessage = RpcThreadStartRequest & {
  type: "thread-start-request-created";
};

type RpcSocketMessage =
  | RpcResponseMessage
  | RpcReloadMessage
  | RpcTasksChangedMessage
  | RpcGitHistoryChangedMessage
  | RpcContextFocusChangedMessage
  | RpcThreadStartRequestCreatedMessage;

type RpcClientMessage = RpcRequestMessage | RpcCancelMessage;

type RuntimeConfig = InjectedRuntimeConfig;

const THREAD_START_REQUEST_CREATED_EVENT_NAME =
  "jolt:thread-start-request-created";
const RPC_RECONNECT_BASE_DELAY_MS = 250;
const RPC_RECONNECT_MAX_DELAY_MS = 2_000;
const RICH_MARKDOWN_WARMUP_DELAY_MS = 1_500;

declare global {
  interface WindowEventMap {
    "jolt:thread-start-request-created": CustomEvent<RpcThreadStartRequest>;
  }

  interface Window {
    joltProcedures: ProjectProcedures;
    __joltAppMountedAt?: number;
    __joltRuntime?: RuntimeConfig;
  }
}
/**
 * Function of isRecord.
 * @param value - The value of `value`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installSafePerformanceMeasure(): void {
  if (
    typeof performance === "undefined" ||
    typeof performance.measure !== "function"
  ) {
    return;
  }

  const originalMeasure = performance.measure.bind(performance);

  performance.measure = ((...args: Parameters<typeof performance.measure>) => {
    try {
      return originalMeasure(...args);
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== "DataCloneError" ||
        args.length < 2 ||
        typeof args[1] !== "object" ||
        args[1] === null ||
        Array.isArray(args[1]) ||
        !("detail" in args[1])
      ) {
        throw error;
      }

      const { detail: _detail, ...cloneSafeOptions } = args[1];
      return originalMeasure(args[0], cloneSafeOptions);
    }
  }) as typeof performance.measure;
}

function readInjectedRuntimeConfig(): RuntimeConfig | null {
  const element = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID);
  const raw = element?.textContent?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.devServer !== true) {
      return {
        devServer: false,
        ...(typeof parsed === "object" &&
        parsed !== null &&
        "healthUrl" in parsed &&
        typeof parsed.healthUrl === "string"
          ? {
              healthUrl: parsed.healthUrl,
            }
          : {}),
        ...(typeof parsed === "object" &&
        parsed !== null &&
        "preferTls" in parsed &&
        typeof parsed.preferTls === "boolean"
          ? {
              preferTls: parsed.preferTls,
            }
          : {}),
        ...(typeof parsed === "object" &&
        parsed !== null &&
        "rpcWebSocketUrl" in parsed &&
        typeof parsed.rpcWebSocketUrl === "string"
          ? {
              rpcWebSocketUrl: parsed.rpcWebSocketUrl,
            }
          : {}),
      };
    }

    return {
      devServer: true,
      ...(typeof parsed.healthUrl === "string"
        ? {
            healthUrl: parsed.healthUrl,
          }
        : {}),
      ...(typeof parsed.preferTls === "boolean"
        ? {
            preferTls: parsed.preferTls,
          }
        : {}),
      ...(typeof parsed.rpcWebSocketUrl === "string"
        ? {
            rpcWebSocketUrl: parsed.rpcWebSocketUrl,
          }
        : {}),
    };
  } catch (error) {
    console.error("Failed to parse injected runtime config", error);
    return null;
  }
}

const runtimeConfig: RuntimeConfig = readInjectedRuntimeConfig() ??
  window.__joltRuntime ?? {
    devServer: false,
  };

installSafePerformanceMeasure();

const socketProtocol =
  runtimeConfig.preferTls || window.location.protocol === "https:"
    ? "wss:"
    : "ws:";
const socketBaseUrl =
  runtimeConfig.rpcWebSocketUrl ??
  `${socketProtocol}//${window.location.host}/rpc`;
const healthUrl = runtimeConfig.healthUrl ?? "/health";
const pendingRequests = new Map<number, PendingRequest>();
let socket: WebSocket | null = null;
let nextRequestId = 1;
let resolveConnection = () => {};
/**
 * Function of rejectConnection.
 * @param _reason - The value of `_reason`.
 */
let rejectConnection = (_reason?: unknown) => {};
let connectionReadyResolved = false;
let isPageUnloading = false;
let devRecoveryScheduled = false;
let devRecoveryTimer: number | null = null;
let rpcReconnectTimer: number | null = null;
let rpcReconnectAttempt = 0;
let rpcTransportEnabled = false;
let rpcSocketConnectPromise: Promise<void> | null = null;
let connectionReady!: Promise<void>;

function resetConnectionReady(): void {
  // Recreate this promise whenever the socket closes so new requests await reconnection.
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
/**
 * Function of buildSocketUrlWithTicket.
 * @param ticket - The value of `ticket`.
 */

function buildSocketUrlWithTicket(ticket: string): string {
  const url = new URL(socketBaseUrl, window.location.href);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
/**
 * Function of reloadWindow.
 * @param reason - The value of `reason`.
 */

function reloadWindow(reason: string): void {
  // In dev mode only, reload after backend reports readiness.
  if (!runtimeConfig.devServer || isPageUnloading) {
    return;
  }

  console.info(`[jolt] reloading dev client (${reason})`);
  isPageUnloading = true;
  clearDevRecoveryTimer();
  window.location.reload();
}

async function waitForDevServer(): Promise<void> {
  // Poll the health endpoint until the dev server accepts traffic again.
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
/**
 * Function of scheduleDevRecovery.
 * @param reason - The value of `reason`.
 */

function scheduleDevRecovery(reason: string): void {
  // Avoid launching parallel recovery checks when one is already scheduled.
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
  // Stop background reconnect/recovery timers on page unload.
  isPageUnloading = true;
  clearDevRecoveryTimer();
  clearRpcReconnectTimer();
});
/**
 * Function of rejectPendingRequests.
 * @param reason - The value of `reason`.
 */

function rejectPendingRequests(reason: unknown): void {
  // Fail and clear every in-flight request when transport is dropped.
  for (const pending of pendingRequests.values()) {
    pending.reject(reason);
  }
  pendingRequests.clear();
}
/**
 * Function of scheduleRpcReconnect.
 * @param reason - The value of `reason`.
 */

function scheduleRpcReconnect(reason: string): void {
  // Exponential backoff reconnect for non-dev environments.
  if (
    runtimeConfig.devServer ||
    !rpcTransportEnabled ||
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

function disableRpcTransport(): void {
  rpcTransportEnabled = false;
  rpcReconnectAttempt = 0;
  clearRpcReconnectTimer();
  rejectPendingRequests(new Error("RPC transport is unavailable."));
  if (socket) {
    const activeSocket = socket;
    socket = null;
    activeSocket.close();
  }
  rpcSocketConnectPromise = null;
  resetConnectionReady();
}

async function enableRpcTransport(): Promise<void> {
  rpcTransportEnabled = true;
  if (
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  ) {
    await connectionReady;
    return;
  }
  if (!rpcSocketConnectPromise) {
    resetConnectionReady();
  }
  connectRpcSocket("initial");
  await connectionReady;
}
/**
 * Function of handleRpcAuthFailure.
 * @param error - The value of `error`.
 */

function handleRpcAuthFailure(error: { message: string }): void {
  rejectConnection(error);
  disableRpcTransport();
  dispatchAuthRequired(error.message);
}
/**
 * Function of connectRpcSocket.
 * @param reason - The value of `reason`.
 */

function connectRpcSocket(reason: "initial" | "reconnect"): void {
  if (isPageUnloading || !rpcTransportEnabled || rpcSocketConnectPromise) {
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
  rpcSocketConnectPromise = (async () => {
    let nextSocketUrl: string;
    try {
      const ticket = await issueWebSocketTicket();
      nextSocketUrl = buildSocketUrlWithTicket(ticket.ticket);
    } catch (error) {
      if (error instanceof AuthApiError && isAuthRequiredError(error)) {
        handleRpcAuthFailure(error);
        return;
      }

      if (reason === "initial") {
        rejectConnection(error);
      } else {
        console.error("Failed to acquire websocket auth ticket", error);
        scheduleRpcReconnect("ws-ticket");
      }
      return;
    }
    if (isPageUnloading || !rpcTransportEnabled) {
      return;
    }

    let nextSocket: WebSocket;
    try {
      nextSocket = new WebSocket(nextSocketUrl);
    } catch (error) {
      if (reason === "initial") {
        rejectConnection(error);
      } else {
        console.error("Failed to open replacement RPC socket", error);
        scheduleRpcReconnect("socket-open");
      }
      return;
    }

    socket = nextSocket;
    if (reason === "reconnect") {
      console.info("[jolt] opening replacement RPC socket");
    }

    nextSocket.addEventListener("open", () => {
      if (socket !== nextSocket || !rpcTransportEnabled) {
        return;
      }

      rpcReconnectAttempt = 0;
      resolveConnection();
    });

    nextSocket.addEventListener("message", (event) => {
      // Messages are either control notifications or RPC request responses.
      if (socket !== nextSocket) {
        return;
      }

      const payload = JSON.parse(String(event.data)) as RpcSocketMessage;
      if (payload.type === "reload") {
        reloadWindow(payload.reason);
        return;
      }
      if (payload.type === "tasks-changed") {
        publishWorktreeTasksChanged({
          projectId: payload.projectId,
          worktreePath: payload.worktreePath,
        });
        return;
      }
      if (payload.type === "git-history-changed") {
        publishWorktreeGitHistoryChanged({
          projectId: payload.projectId,
          worktreePath: payload.worktreePath,
        });
        return;
      }
      if (payload.type === "context-focus-changed") {
        window.dispatchEvent(
          new CustomEvent<RpcContextFocusChanged>(
            CONTEXT_FOCUS_CHANGED_EVENT_NAME,
            {
              detail: payload,
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
      const error = new RpcError(
        payload.error || "RPC request failed",
        payload.errorCode ?? "rpc_error",
        normalizeRpcErrorDetails(payload.errorDetails),
      );
      if (isAuthRequiredRpcError(error)) {
        pending.reject(error);
        handleRpcAuthFailure(error);
        return;
      }
      pending.reject(error);
    });

    nextSocket.addEventListener("close", () => {
      // On close, clear active socket state and recover per environment policy.
      if (socket !== nextSocket) {
        return;
      }

      socket = null;
      const error = new Error("RPC connection closed");
      rejectPendingRequests(error);

      if (!rpcTransportEnabled) {
        return;
      }

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
  })().finally(() => {
    rpcSocketConnectPromise = null;
  });
}
/**
 * Function of createAbortError.
 * @param reason - The value of `reason`.
 * @param fallbackMessage - The value of `fallbackMessage`.
 */

function createAbortError(reason: unknown, fallbackMessage: string): Error {
  // Normalize arbitrary abort signals into a reusable Error with cause metadata.
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
/**
 * Function of normalizeTimeoutMs.
 * @param timeoutMs - The value of `timeoutMs`.
 */

function normalizeTimeoutMs(timeoutMs?: number): number | null {
  // Guard against invalid timeouts before forwarding as transport-level constraints.
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }
  return Math.max(1, Math.floor(timeoutMs));
}
/**
 * Function of buildRequestSignal.
 * @param options - The value of `options`.
 */

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
/**
 * Function of waitForConnection.
 * @param signal - The value of `signal`.
 */

async function waitForConnection(signal: AbortSignal | null): Promise<void> {
  // Block until the websocket handshake is ready unless caller aborts first.
  if (!rpcTransportEnabled) {
    throw new Error("RPC transport is not enabled.");
  }
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
/**
 * Function of waitForOpenSocket.
 * @param signal - The value of `signal`.
 */

async function waitForOpenSocket(
  signal: AbortSignal | null,
): Promise<WebSocket> {
  // Keep retrying until an OPEN socket is available after connection readiness.
  while (true) {
    await waitForConnection(signal);
    const activeSocket = socket;
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      return activeSocket;
    }
  }
}
/**
 * Function of sendSocketMessage.
 * @param targetSocket - The value of `targetSocket`.
 * @param message - The value of `message`.
 */

function sendSocketMessage(
  targetSocket: WebSocket,
  message: RpcClientMessage,
): void {
  // Send typed payload to the active websocket.
  targetSocket.send(JSON.stringify(message));
}
/**
 * Function of sendRequest.
 * @param method - The value of `method`.
 * @param params - The value of `params`.
 * @param options - The value of `options`.
 */

async function sendRequest<K extends RpcMethodName>(
  method: K,
  params: RpcRequestMap[K]["params"],
  options?: RpcProcedureCallOptions,
): Promise<RpcRequestMap[K]["response"]> {
  // Compose abortable request signaling and wait for an open socket before dispatch.
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
      /**
       * Function of finalize.
       * @param callback - The value of `callback`.
       */
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
        // On caller abort, cancel server side request and reject the local promise.
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
/**
 * Function of createProcedure.
 * @param method - The value of `method`.
 */

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

/** RPC procedure map bound to each generated schema method and used by the React app. */
const procedures: ProjectProcedures = {
  getHomeDirectory: createProcedure("getHomeDirectory"),
  listDirectorySuggestions: createProcedure("listDirectorySuggestions"),
  getCodexModelCatalog: createProcedure("getCodexModelCatalog"),
  getAppBootstrap: createProcedure("getAppBootstrap"),
  listProjects: createProcedure("listProjects"),
  listThreads: createProcedure("listThreads"),
  listThreadStatuses: createProcedure("listThreadStatuses"),
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
  updateThreadMetadata: createProcedure("updateThreadMetadata"),
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
  focusContext: createProcedure("focusContext"),
  listWorktreeGitHistory: createProcedure("listWorktreeGitHistory"),
  getWorktreeGitCommitDiff: createProcedure("getWorktreeGitCommitDiff"),
  closeWorktree: createProcedure("closeWorktree"),
  setWorktreePinned: createProcedure("setWorktreePinned"),
};

window.joltProcedures = procedures;

const appRoot = document.getElementById("app");
if (!appRoot) {
  // Safety fallback if HTML entrypoint wiring is missing.
  console.error("Mainview root not found");
  document.body.innerHTML =
    '<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Mainview root missing (id="app").</main>';
} else {
  // Mount app with injected RPC procedures.
  console.log("React version:", React.version);
  console.log("Mounting React app (AuthShell)");
  const root = createRoot(appRoot);
  try {
    root.render(
      createElement(AuthShell, {
        connectRpcTransport: enableRpcTransport,
        disconnectRpcTransport: disableRpcTransport,
        procedures,
      }),
    );
    window.__joltAppMountedAt = Date.now();
    window.setTimeout(() => {
      void loadRichMarkdownModule();
    }, RICH_MARKDOWN_WARMUP_DELAY_MS);
  } catch (error) {
    console.error("Failed to mount auth shell", error);
    window.__joltAppMountedAt = Number.NaN;
    appRoot.innerHTML =
      '<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Failed to initialize App UI. Check console for details.</main>';
  }
}
