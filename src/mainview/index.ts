/**
 * @file src/mainview/index.ts
 * @description Module for index.
 */

import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RpcCalendarReminderDelivery } from "../bun/calendar/types";
import type {
  AppRPCSchema,
  ProjectProcedures,
  RpcContextFocusChanged,
  RpcModelCatalog,
  RpcProcedureCallOptions,
  RpcRequestPriority,
  RpcTerminal,
  RpcThread,
  RpcThreadExtensionUiRequest,
  RpcThreadStartRequest,
  RpcUserNotificationDelivery,
  RpcWorktreeGitHistoryChanged,
} from "../bun/rpc-schema";
import {
  decodeRpcBinaryFrame,
  encodeRpcBinaryFrame,
  isRpcBinaryFrame,
} from "../shared/rpc-binary-codec";
import {
  type InjectedRuntimeConfig,
  RUNTIME_CONFIG_ELEMENT_ID,
} from "../shared/runtime-config";
import {
  MainviewCrashFallback,
  MainviewErrorBoundary,
} from "./app/error-boundary";
import {
  publishCronJobsChanged,
  publishWorktreeGitHistoryChanged,
} from "./app/invalidation-events";
import { loadRichMarkdownModule } from "./app/message-markdown-loader";
import { assertClientWebSocketSendSucceeded } from "./rpc-websocket-send";
import { publishModelCatalogChanged } from "./app/model-catalog-events";
import {
  CONTEXT_FOCUS_CHANGED_EVENT_NAME,
  THREAD_EXTENSION_UI_EVENT_NAME,
  THREAD_STATUS_CHANGED_EVENT_NAME,
} from "./app/thread-ui-state";
import {
  dispatchAuthRequired,
  isAuthRequiredError,
  issueWebSocketTicket,
} from "./auth-client";
import AuthShell from "./auth-shell";
import { configureClientLogger, logClientError } from "./client-logging";
import { installBrandFavicon } from "./controls/brand-logo";
import { devLog } from "./dev-log";
import {
  isAuthRequiredRpcError,
  normalizeRpcErrorDetails,
  RpcError,
} from "./rpc-errors";
import { RpcRequestQueue } from "./rpc-request-queue";

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

type RpcGitHistoryChangedMessage = RpcWorktreeGitHistoryChanged & {
  type: "git-history-changed";
};

type RpcCronJobsChangedMessage = {
  type: "cron-jobs-changed";
};

type RpcContextFocusChangedMessage = RpcContextFocusChanged & {
  type: "context-focus-changed";
};

type RpcThreadStartRequestCreatedMessage = RpcThreadStartRequest & {
  type: "thread-start-request-created";
};

type RpcThreadStartRequestResolvedMessage = {
  type: "thread-start-request-resolved";
  requestId: string;
};

type RpcThreadExtensionUiMessage = {
  type: "thread-extension-ui";
  event: RpcThreadExtensionUiRequest;
};

type RpcThreadStatusChangedMessage = {
  type: "thread-status-changed";
  thread: RpcThread;
};

type RpcTerminalChangedMessage = {
  type: "terminal-changed";
  terminal: RpcTerminal;
};

type RpcCalendarChangedMessage = {
  type: "calendar-changed";
};

type RpcCalendarNotificationsDueMessage = {
  type: "calendar-notifications-due";
  deliveries: RpcCalendarReminderDelivery[];
};

type RpcUserNotificationSentMessage = {
  type: "user-notification-sent";
  delivery: RpcUserNotificationDelivery;
};

type RpcModelCatalogChangedMessage = {
  type: "model-catalog-changed";
  modelCatalog: RpcModelCatalog;
};

type RpcSocketMessage =
  | RpcResponseMessage
  | RpcReloadMessage
  | RpcGitHistoryChangedMessage
  | RpcCronJobsChangedMessage
  | RpcContextFocusChangedMessage
  | RpcThreadStartRequestCreatedMessage
  | RpcThreadStartRequestResolvedMessage
  | RpcThreadExtensionUiMessage
  | RpcThreadStatusChangedMessage
  | RpcTerminalChangedMessage
  | RpcCalendarChangedMessage
  | RpcCalendarNotificationsDueMessage
  | RpcUserNotificationSentMessage
  | RpcModelCatalogChangedMessage;

type RpcClientMessage = RpcRequestMessage | RpcCancelMessage;

type RuntimeConfig = InjectedRuntimeConfig;

const THREAD_START_REQUEST_CREATED_EVENT_NAME =
  "metidos:thread-start-request-created";
const THREAD_START_REQUEST_RESOLVED_EVENT_NAME =
  "metidos:thread-start-request-resolved";
const TERMINAL_CHANGED_EVENT_NAME = "metidos:terminal-changed";
const CALENDAR_CHANGED_EVENT_NAME = "metidos:calendar-changed";
const CALENDAR_NOTIFICATIONS_DUE_EVENT_NAME =
  "metidos:calendar-notifications-due";
const USER_NOTIFICATION_SENT_EVENT_NAME = "metidos:user-notification-sent";
const RPC_RECONNECT_BASE_DELAY_MS = 250;
const RPC_RECONNECT_MAX_DELAY_MS = 2_000;
const DEFAULT_RPC_REQUEST_TIMEOUT_MS = 120_000;
const MAX_IN_FLIGHT_RPC_REQUESTS = 48;

declare global {
  interface WindowEventMap {
    "metidos:thread-start-request-created": CustomEvent<RpcThreadStartRequest>;
    "metidos:thread-start-request-resolved": CustomEvent<{
      requestId: string;
    }>;
    "metidos:thread-status-changed": CustomEvent<RpcThread>;
    "metidos:terminal-changed": CustomEvent<RpcTerminal>;
    "metidos:calendar-changed": CustomEvent<void>;
    "metidos:calendar-notifications-due": CustomEvent<
      RpcCalendarReminderDelivery[]
    >;
    "metidos:user-notification-sent": CustomEvent<RpcUserNotificationDelivery>;
    "metidos:model-catalog-changed": CustomEvent<RpcModelCatalog>;
    "metidos:thread-extension-ui": CustomEvent<RpcThreadExtensionUiRequest>;
  }

  interface Window {
    metidosProcedures: ProjectProcedures;
    __metidosAppMountedAt?: number;
    __metidosRuntime?: RuntimeConfig;
  }
}
/**
 * Is record.
 * @param value - Input value.
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
        ...(typeof parsed === "object" &&
        parsed !== null &&
        "styleNonce" in parsed &&
        typeof parsed.styleNonce === "string"
          ? {
              styleNonce: parsed.styleNonce,
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
      ...(typeof parsed.styleNonce === "string"
        ? {
            styleNonce: parsed.styleNonce,
          }
        : {}),
    };
  } catch (error) {
    console.error("Failed to parse injected runtime config", error);
    return null;
  }
}

const runtimeConfig: RuntimeConfig = readInjectedRuntimeConfig() ??
  window.__metidosRuntime ?? {
    devServer: false,
  };
window.__metidosRuntime = runtimeConfig;

installSafePerformanceMeasure();
installBrandFavicon();

const socketProtocol =
  runtimeConfig.preferTls || window.location.protocol === "https:"
    ? "wss:"
    : "ws:";
const socketBaseUrl =
  runtimeConfig.rpcWebSocketUrl ??
  `${socketProtocol}//${window.location.host}/rpc`;
const healthUrl = runtimeConfig.healthUrl ?? "/health";
const pendingRequests = new Map<number, PendingRequest>();
const rpcRequestQueue = new RpcRequestQueue(MAX_IN_FLIGHT_RPC_REQUESTS);
let socket: WebSocket | null = null;
let nextRequestId = 1;
let resolveConnection = () => {};
/**
 * Rejects connection.
 * @param _reason - _reason value.
 */
let rejectConnection = (_reason?: unknown) => {};
let connectionReadyResolved = false;
let isPageUnloading = false;
let devRecoveryScheduled = false;
let devRecoveryTimer: number | null = null;
let rpcReconnectTimer: number | null = null;
let rpcReconnectAttempt = 0;
let activeSocketGeneration = 0;
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
 * Reloads the app window in dev mode after backend recovery.
 * @param reason - Human-readable reason for the reload.
 */

function reloadWindow(reason: string): void {
  // In dev mode only, reload after backend reports readiness.
  if (!runtimeConfig.devServer || isPageUnloading) {
    return;
  }

  console.info(`[metidos] reloading dev client (${reason})`);
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
 * Schedules a delayed dev recovery check and reload flow.
 * @param reason - Human-readable reason for waiting for recovery.
 */

function scheduleDevRecovery(reason: string): void {
  // Avoid launching parallel recovery checks when one is already scheduled.
  if (!runtimeConfig.devServer || isPageUnloading || devRecoveryScheduled) {
    return;
  }

  devRecoveryScheduled = true;
  console.info(`[metidos] waiting for dev server restart (${reason})`);
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
 * Rejects pending requests.
 * @param reason - Reason for this operation.
 */

function rejectPendingRequests(reason: unknown): void {
  // Fail and clear every in-flight request when transport is dropped.
  for (const pending of pendingRequests.values()) {
    pending.reject(reason);
  }
  pendingRequests.clear();
}
/**
 * Schedules websocket reconnect with exponential backoff.
 * @param reason - Human-readable reason for reconnection scheduling.
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
  console.info(`[metidos] reconnecting RPC socket in ${delay}ms (${reason})`);
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
  activeSocketGeneration += 1;
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
 * Handles rpc auth failure.
 * @param error - Error value to process.
 */

function handleRpcAuthFailure(error: { message: string }): void {
  rejectConnection(error);
  disableRpcTransport();
  dispatchAuthRequired(error.message);
}
/**
 * Connects rpc socket.
 *
 * Browser RPC upgrades authenticate via the same-origin session cookie plus a
 * fresh single-use websocket ticket cookie.
 * @param reason - Reason for this operation.
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
    let nextSocket: WebSocket;
    try {
      await issueWebSocketTicket();
      nextSocket = new WebSocket(socketBaseUrl);
      nextSocket.binaryType = "arraybuffer";
    } catch (error) {
      if (isAuthRequiredError(error)) {
        handleRpcAuthFailure(
          error instanceof Error
            ? error
            : new Error("A valid authenticated session is required."),
        );
        return;
      }
      if (reason === "initial") {
        rejectConnection(error);
      } else {
        logClientError("Failed to open replacement RPC socket", error, {
          context: "rpc-reconnect",
        });
        scheduleRpcReconnect("socket-open");
      }
      return;
    }

    const socketGeneration = activeSocketGeneration + 1;
    activeSocketGeneration = socketGeneration;
    socket = nextSocket;
    if (reason === "reconnect") {
      console.info("[metidos] opening replacement RPC socket");
    }

    nextSocket.addEventListener("open", () => {
      if (
        socketGeneration !== activeSocketGeneration ||
        socket !== nextSocket ||
        !rpcTransportEnabled
      ) {
        return;
      }

      rpcReconnectAttempt = 0;
      resolveConnection();
    });

    nextSocket.addEventListener("message", (event) => {
      void (async () => {
        // Messages are either control notifications or RPC request responses.
        if (
          socketGeneration !== activeSocketGeneration ||
          socket !== nextSocket
        ) {
          return;
        }

        const payload = isRpcBinaryFrame(event.data)
          ? ((await decodeRpcBinaryFrame(event.data)) as RpcSocketMessage)
          : (JSON.parse(String(event.data)) as RpcSocketMessage);
        if (payload.type === "reload") {
          reloadWindow(payload.reason);
          return;
        }
        if (payload.type === "git-history-changed") {
          publishWorktreeGitHistoryChanged({
            projectId: payload.projectId,
            worktreePath: payload.worktreePath,
          });
          return;
        }
        if (payload.type === "cron-jobs-changed") {
          publishCronJobsChanged();
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
        if (payload.type === "thread-start-request-resolved") {
          window.dispatchEvent(
            new CustomEvent<{ requestId: string }>(
              THREAD_START_REQUEST_RESOLVED_EVENT_NAME,
              {
                detail: {
                  requestId: payload.requestId,
                },
              },
            ),
          );
          return;
        }
        if (payload.type === "thread-extension-ui") {
          window.dispatchEvent(
            new CustomEvent<RpcThreadExtensionUiRequest>(
              THREAD_EXTENSION_UI_EVENT_NAME,
              {
                detail: payload.event,
              },
            ),
          );
          return;
        }
        if (payload.type === "thread-status-changed") {
          window.dispatchEvent(
            new CustomEvent<RpcThread>(THREAD_STATUS_CHANGED_EVENT_NAME, {
              detail: payload.thread,
            }),
          );
          return;
        }
        if (payload.type === "terminal-changed") {
          window.dispatchEvent(
            new CustomEvent<RpcTerminal>(TERMINAL_CHANGED_EVENT_NAME, {
              detail: payload.terminal,
            }),
          );
          return;
        }
        if (payload.type === "calendar-changed") {
          window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT_NAME));
          return;
        }
        if (payload.type === "calendar-notifications-due") {
          window.dispatchEvent(
            new CustomEvent<RpcCalendarReminderDelivery[]>(
              CALENDAR_NOTIFICATIONS_DUE_EVENT_NAME,
              {
                detail: payload.deliveries,
              },
            ),
          );
          return;
        }
        if (payload.type === "user-notification-sent") {
          window.dispatchEvent(
            new CustomEvent<RpcUserNotificationDelivery>(
              USER_NOTIFICATION_SENT_EVENT_NAME,
              {
                detail: payload.delivery,
              },
            ),
          );
          return;
        }
        if (payload.type === "model-catalog-changed") {
          publishModelCatalogChanged(payload.modelCatalog);
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
      })().catch((error) => {
        logClientError("Failed to decode RPC websocket message", error);
      });
    });

    nextSocket.addEventListener("close", () => {
      // On close, clear active socket state and recover per environment policy.
      if (
        socketGeneration !== activeSocketGeneration ||
        socket !== nextSocket
      ) {
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
      if (
        socketGeneration !== activeSocketGeneration ||
        socket !== nextSocket
      ) {
        return;
      }
      console.error("Metidos RPC socket encountered an error");
    });
  })().finally(() => {
    rpcSocketConnectPromise = null;
  });
}
/**
 * Creates a normalized abort error for cancellation and timeout paths.
 * @param reason - Reason value supplied by the caller.
 * @param fallbackMessage - Error message fallback.
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
 * Normalizes an optional timeout to a minimum positive integer, or null.
 * @param timeoutMs - Raw timeout in milliseconds.
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

function resolveRequestTimeoutMs(
  options?: RpcProcedureCallOptions,
): number | null {
  if (options && "timeoutMs" in options) {
    return normalizeTimeoutMs(options.timeoutMs);
  }
  return DEFAULT_RPC_REQUEST_TIMEOUT_MS;
}
/**
 * Builds a combined abort signal from caller options.
 * @param options - Request options that may include abort and timeout.
 */

function buildRequestSignal(
  options?: RpcProcedureCallOptions,
): AbortSignal | null {
  const signals: AbortSignal[] = [];
  if (options?.signal) {
    signals.push(options.signal);
  }

  const timeoutMs = resolveRequestTimeoutMs(options);
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
 * Waits for websocket transport readiness, honoring abort signals.
 * @param signal - Optional abort signal for cancellation.
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

  let removeAbortListener = () => {};
  try {
    await Promise.race([
      connectionReady,
      new Promise<never>((_, reject) => {
        const handleAbort = () => {
          removeAbortListener();
          reject(createAbortError(signal.reason, "RPC request aborted."));
        };
        signal.addEventListener("abort", handleAbort, {
          once: true,
        });
        removeAbortListener = () => {
          signal.removeEventListener("abort", handleAbort);
        };
      }),
    ]);
  } finally {
    removeAbortListener();
  }
}
/**
 * Waits for an OPEN websocket before returning the socket.
 * @param signal - Optional abort signal for cancellation.
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
 * Sends a typed payload over the active websocket connection.
 * @param targetSocket - Target websocket.
 * @param message - Serialized payload to send.
 */

function rpcClientMessageContext(message: RpcClientMessage): string {
  if (message.type === "request") {
    return `rpc-send:${String(message.method)}:${message.id}`;
  }
  return `rpc-send:${message.type}:${message.id}`;
}

async function sendSocketMessage(
  targetSocket: WebSocket,
  message: RpcClientMessage,
): Promise<void> {
  // Send compact typed binary structs instead of JSON text frames.
  // Browser-side gzip crosses the compression threshold around 10 KiB image
  // attachments and can prevent the frame from reaching the server in some
  // runtimes, so keep client requests uncompressed. The server's websocket
  // payload budget is already sized for the uncompressed chat-image envelope.
  const frame = await encodeRpcBinaryFrame(message, { compress: false });
  if (message.type === "request" && message.method === "sendThreadMessage") {
    const imageCount = Array.isArray(
      (message.params as { images?: unknown }).images,
    )
      ? (message.params as { images: unknown[] }).images.length
      : 0;
    if (imageCount > 0) {
      console.info("[metidos chat images] Sending RPC websocket frame", {
        frameBytes: frame.byteLength,
        imageCount,
        method: message.method,
      });
    }
  }
  try {
    assertClientWebSocketSendSucceeded(
      targetSocket.send(frame as BufferSource),
    );
  } catch (error) {
    logClientError(
      "Failed to send RPC websocket frame",
      {
        error,
        frameBytes: frame.byteLength,
        messageType: message.type,
        ...(message.type === "request"
          ? { method: String(message.method) }
          : {}),
      },
      { context: rpcClientMessageContext(message) },
    );
    throw error;
  }
}
/**
 * Sends an RPC request and returns a typed response promise.
 * @param method - RPC method key.
 * @param params - Request parameters.
 * @param options - Request options including signal and timeout.
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
  const timeoutMs = resolveRequestTimeoutMs(options);
  const priority = options?.priority ?? "default";
  const permit = await rpcRequestQueue.acquire(priority, signal);
  if (signal?.aborted) {
    permit.release();
    throw createAbortError(
      signal.reason,
      `RPC request "${String(method)}" aborted.`,
    );
  }

  const response = new Promise<RpcRequestMap[K]["response"]>(
    (resolve, reject) => {
      let settled = false;
      let removeAbortListener = () => {};
      /**
       * Finalizes request handling.
       * @param callback - Callback to invoke.
       */
      const finalize = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        pendingRequests.delete(id);
        permit.release();
        removeAbortListener();
        callback();
      };

      if (signal) {
        // On caller abort, cancel server side request and reject the local promise.
        const handleAbort = () => {
          finalize(() => {
            if (requestSocket.readyState === WebSocket.OPEN) {
              void sendSocketMessage(requestSocket, {
                type: "cancel",
                id,
              }).catch(() => {
                // sendSocketMessage already logs send failures; avoid creating
                // an unhandled rejection while the local request is aborting.
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
      void sendSocketMessage(requestSocket, {
        type: "request",
        id,
        method,
        params,
        priority,
        ...(timeoutMs !== null ? { timeoutMs } : {}),
      }).catch((error) => {
        finalize(() => {
          reject(error);
        });
      });
    },
  );

  return response;
}
/**
 * Binds an RPC method to a callable procedure.
 * @param method - RPC request method name.
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
  getModelCatalog: createProcedure("getModelCatalog"),
  getPluginInventory: createProcedure("getPluginInventory"),
  getPluginSettings: createProcedure("getPluginSettings"),
  createPluginIngressLinkCode: createProcedure("createPluginIngressLinkCode"),
  listPluginIngressSources: createProcedure("listPluginIngressSources"),
  listPluginIngressExternalBindings: createProcedure(
    "listPluginIngressExternalBindings",
  ),
  listPluginIngressRouteConfigs: createProcedure(
    "listPluginIngressRouteConfigs",
  ),
  upsertPluginIngressRouteConfig: createProcedure(
    "upsertPluginIngressRouteConfig",
  ),
  setPluginIngressExternalBindingEnabled: createProcedure(
    "setPluginIngressExternalBindingEnabled",
  ),
  deletePluginIngressExternalBinding: createProcedure(
    "deletePluginIngressExternalBinding",
  ),
  listPluginAccessGroups: createProcedure("listPluginAccessGroups"),
  updatePluginSettings: createProcedure("updatePluginSettings"),
  getPluginSidecarDiagnostics: createProcedure("getPluginSidecarDiagnostics"),
  getPluginSecurityDiagnostics: createProcedure("getPluginSecurityDiagnostics"),
  logClientEvent: createProcedure("logClientEvent"),
  runPluginLifecycleAction: createProcedure("runPluginLifecycleAction"),
  runPluginAdminAction: createProcedure("runPluginAdminAction"),
  getAppBootstrap: createProcedure("getAppBootstrap"),
  listProjects: createProcedure("listProjects"),
  listProjectFavicons: createProcedure("listProjectFavicons"),
  listThreads: createProcedure("listThreads"),
  listThreadStatuses: createProcedure("listThreadStatuses"),
  openProject: createProcedure("openProject"),
  openProjectsBatch: createProcedure("openProjectsBatch"),
  closeProject: createProcedure("closeProject"),
  deleteProject: createProcedure("deleteProject"),
  listProjectWorktrees: createProcedure("listProjectWorktrees"),
  createWorktree: createProcedure("createWorktree"),
  openWorktreesBatch: createProcedure("openWorktreesBatch"),
  createThread: createProcedure("createThread"),
  requestThreadStart: createProcedure("requestThreadStart"),
  approveThreadStartRequest: createProcedure("approveThreadStartRequest"),
  getThread: createProcedure("getThread"),
  getThreadMessageContent: createProcedure("getThreadMessageContent"),
  markThreadErrorSeen: createProcedure("markThreadErrorSeen"),
  sendThreadMessage: createProcedure("sendThreadMessage"),
  stopThreadTurn: createProcedure("stopThreadTurn"),
  newCron: createProcedure("newCron"),
  updateCron: createProcedure("updateCron"),
  listCrons: createProcedure("listCrons"),
  runCronNow: createProcedure("runCronNow"),
  getCalendarBootstrap: createProcedure("getCalendarBootstrap"),
  listCalendarOccurrences: createProcedure("listCalendarOccurrences"),
  createCalendar: createProcedure("createCalendar"),
  updateCalendar: createProcedure("updateCalendar"),
  deleteCalendar: createProcedure("deleteCalendar"),
  leaveSharedCalendar: createProcedure("leaveSharedCalendar"),
  updateCalendarPreference: createProcedure("updateCalendarPreference"),
  setCalendarShare: createProcedure("setCalendarShare"),
  createCalendarEvent: createProcedure("createCalendarEvent"),
  updateCalendarEvent: createProcedure("updateCalendarEvent"),
  deleteCalendarEvent: createProcedure("deleteCalendarEvent"),
  createExternalIcsCalendar: createProcedure("createExternalIcsCalendar"),
  updateExternalIcsCalendar: createProcedure("updateExternalIcsCalendar"),
  refreshExternalIcsCalendar: createProcedure("refreshExternalIcsCalendar"),
  deleteExternalIcsCalendar: createProcedure("deleteExternalIcsCalendar"),
  updateCalendarNotificationSettings: createProcedure(
    "updateCalendarNotificationSettings",
  ),
  listCalendarNotifications: createProcedure("listCalendarNotifications"),
  listUserNotifications: createProcedure("listUserNotifications"),
  dismissUserNotification: createProcedure("dismissUserNotification"),
  dismissCalendarNotification: createProcedure("dismissCalendarNotification"),
  snoozeCalendarNotification: createProcedure("snoozeCalendarNotification"),
  updateThreadMetadata: createProcedure("updateThreadMetadata"),
  updateThreadAccess: createProcedure("updateThreadAccess"),
  renameThread: createProcedure("renameThread"),
  setThreadPinned: createProcedure("setThreadPinned"),
  updateThreadModel: createProcedure("updateThreadModel"),
  updateThreadReasoningEffort: createProcedure("updateThreadReasoningEffort"),
  deleteThread: createProcedure("deleteThread"),
  discardEmptyThread: createProcedure("discardEmptyThread"),
  openWorktree: createProcedure("openWorktree"),
  getWorktreeSnapshot: createProcedure("getWorktreeSnapshot"),
  listProjectSkills: createProcedure("listProjectSkills"),
  readWorktreeFileContentPage: createProcedure("readWorktreeFileContentPage"),
  readWorktreeFileDiff: createProcedure("readWorktreeFileDiff"),
  setActiveWorktree: createProcedure("setActiveWorktree"),
  focusContext: createProcedure("focusContext"),
  respondThreadExtensionUi: createProcedure("respondThreadExtensionUi"),
  updateThreadExtensionEditor: createProcedure("updateThreadExtensionEditor"),
  listWorktreeGitHistory: createProcedure("listWorktreeGitHistory"),
  getWorktreeGitCommitDiff: createProcedure("getWorktreeGitCommitDiff"),
  closeWorktree: createProcedure("closeWorktree"),
  setWorktreePinned: createProcedure("setWorktreePinned"),
  listTerminals: createProcedure("listTerminals"),
  createTerminal: createProcedure("createTerminal"),
  renameTerminal: createProcedure("renameTerminal"),
  closeTerminal: createProcedure("closeTerminal"),
  getTerminalSettings: createProcedure("getTerminalSettings"),
  getTimezoneSettings: createProcedure("getTimezoneSettings"),
  getUserRuntimeSettings: createProcedure("getUserRuntimeSettings"),
  updateTimezoneSettings: createProcedure("updateTimezoneSettings"),
  updateTerminalSettings: createProcedure("updateTerminalSettings"),
  updateUserRuntimeSettings: createProcedure("updateUserRuntimeSettings"),
};

configureClientLogger(procedures);

function installGlobalClientErrorLogging(): void {
  window.addEventListener("error", (event) => {
    logClientError(
      "Uncaught window error",
      event.error ?? {
        column: event.colno,
        filename: event.filename,
        line: event.lineno,
        message: event.message,
      },
      { context: "window.onerror" },
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    logClientError("Unhandled promise rejection", event.reason, {
      context: "window.unhandledrejection",
    });
  });
}

installGlobalClientErrorLogging();

window.metidosProcedures = procedures;

const appRoot = document.getElementById("app");
function renderBootError(container: HTMLElement, message: string): void {
  container.replaceChildren();
  const main = document.createElement("main");
  main.className =
    "min-h-screen bg-bg-app p-6 font-sans text-sm text-text-primary";
  main.style.backgroundColor = "rgb(10 10 10)";
  main.style.color = "rgb(245 245 245)";
  main.style.fontFamily =
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  main.style.fontSize = "14px";
  main.style.padding = "24px";
  main.textContent = message;
  container.append(main);
}

if (!appRoot) {
  // Safety fallback if HTML entrypoint wiring is missing.
  console.error("Mainview root not found");
  renderBootError(document.body, 'Mainview root missing (id="app").');
} else {
  // Mount app with injected RPC procedures.
  devLog("React version", React.version);
  devLog("Mounting React app", "AuthShell");
  const root = createRoot(appRoot);
  try {
    root.render(
      createElement(
        MainviewErrorBoundary,
        {
          context: "mainview-root",
          fallback: ({ error, reset }) =>
            createElement(MainviewCrashFallback, { error, reset }),
        },
        createElement(AuthShell, {
          connectRpcTransport: enableRpcTransport,
          disconnectRpcTransport: disableRpcTransport,
          procedures,
        }),
      ),
    );
    window.__metidosAppMountedAt = Date.now();
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(
        () => {
          void loadRichMarkdownModule();
        },
        { timeout: 300 },
      );
    } else {
      window.setTimeout(() => {
        void loadRichMarkdownModule();
      }, 0);
    }
  } catch (error) {
    console.error("Failed to mount auth shell", error);
    window.__metidosAppMountedAt = Number.NaN;
    renderBootError(
      appRoot,
      "Failed to initialize App UI. Check console for details.",
    );
  }
}
