/**
 * @file src/bun/rpc-transport.ts
 * @description WebSocket transport lifecycle for Mainview RPC requests and pushes.
 */

import type { ServerWebSocket } from "bun";
import {
  decodeRpcBinaryFrame,
  encodeRpcBinaryFrame,
  isRpcBinaryFrame,
} from "../shared/rpc-binary-codec";
import type { RpcCalendarReminderDelivery } from "./calendar/types";
import type { LogDescription } from "./logging";
import type {
  AppRPCSchema,
  RpcContextFocusChanged,
  RpcModelCatalog,
  RpcRequestContext,
  RpcRequestPriority,
  RpcTerminal,
  RpcThread,
  RpcThreadExtensionUiRequest,
  RpcThreadStartRequest,
  RpcThreadStartRequestResolved,
  RpcUserNotificationDelivery,
  RpcWorktreeGitHistoryChanged,
} from "./rpc-schema";
import type { RpcWebSocketSocketData } from "./rpc-websocket-auth";
import type { RpcMeasurementToken } from "./runtime-stats";

const SOCKET_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const RPC_WEBSOCKET_BACKPRESSURE_CLOSE_CODE = 1013;

export type RpcRequestMap = AppRPCSchema["requests"];
export type RpcMethodName = keyof RpcRequestMap;

export type RpcRequestMessage = {
  type: "request";
  id: number;
  method: RpcMethodName;
  params: RpcRequestMap[RpcMethodName]["params"];
  priority: RpcRequestPriority;
  timeoutMs?: number;
};

export type RpcCancelMessage = {
  type: "cancel";
  id: number;
};

export type RpcResponseMessage =
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

type RpcThreadStartRequestResolvedMessage = RpcThreadStartRequestResolved & {
  type: "thread-start-request-resolved";
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

export type RpcSocketMessage =
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

export type RpcClientMessage = RpcRequestMessage | RpcCancelMessage;

export type ParsedRpcClientMessage = {
  type?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  priority?: unknown;
  timeoutMs?: unknown;
};

export type RpcRequestHandlerMap = {
  [K in keyof RpcRequestMap]: (
    params: RpcRequestMap[K]["params"],
    context: RpcRequestContext,
  ) => Promise<RpcRequestMap[K]["response"]>;
};

type PendingRpcRequest = {
  clearTimeout: () => void;
  controller: AbortController;
  signal: AbortSignal;
  timeoutMs: number | null;
  canceledByClient: boolean;
};

class RpcCapacityError extends Error {
  readonly publicMessage = "RPC server is busy. Please retry shortly.";

  constructor(message: string) {
    super(message);
    this.name = "RpcCapacityError";
  }
}

function isRpcCapacityError(error: unknown): error is RpcCapacityError {
  return error instanceof RpcCapacityError;
}

type RpcRateLimitBucket = {
  tokens: number;
  updatedAtMs: number;
};

type RpcTransportLogger = {
  error: (description: Record<string, unknown>) => void;
  trace: (description: Record<string, unknown>) => void;
  warning: (description: Record<string, unknown>) => void;
};

export type RpcTransportHealthSnapshot = {
  clientCount: number;
  pendingRequests: {
    current: number;
    peak: number;
  };
};

export type RpcTransport = {
  getClientCount(): number;
  getHealthSnapshot(): RpcTransportHealthSnapshot;
  getPendingRequestCount(): number;
  getPeakPendingRequestCount(): number;
  open(client: ServerWebSocket<RpcWebSocketSocketData>): void;
  close(client: ServerWebSocket<RpcWebSocketSocketData>, reason: string): void;
  handleMessage(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    rawMessage: string | Buffer,
  ): void;
  drain(client: ServerWebSocket<RpcWebSocketSocketData>): void;
  closeSession(sessionId: string, reason: string): number;
  closeUser(userId: number, reason: string): number;
  hasClients(): boolean;
  hasPublishTargets(scope?: RpcPublishScope): boolean;
  publish(message: RpcSocketMessage, scope?: RpcPublishScope): Promise<number>;
  publishLazy(
    type: string,
    buildRaw: () => Promise<string | Uint8Array>,
    scope?: RpcPublishScope,
  ): Promise<number>;
};

export type RpcPublishScope =
  | { kind: "all" }
  | { kind: "clients"; clients: ServerWebSocket<RpcWebSocketSocketData>[] }
  | { kind: "session"; sessionId: string | null | undefined };

export type RpcTransportOptions = {
  consumePreParseBudget: (
    client: ServerWebSocket<RpcWebSocketSocketData>,
    messageByteLength: number,
  ) => { allowed: boolean };
  handlers: RpcRequestHandlerMap;
  logger: RpcTransportLogger;
  maxPayloadBytes: number;
  maxPendingRequests: number;
  maxPendingRequestsPerClient: number;
  maxUncompressedServerBinaryFrameBytes: number;
  normalizeErrorDescription: (error: unknown) => LogDescription;
  parseClientMessage: (parsed: ParsedRpcClientMessage) => RpcClientMessage;
  rateLimitBurst: number;
  rateLimitRefillPerSecond: number;
  recordRpcCanceled: (token: RpcMeasurementToken) => void;
  recordRpcFailed: (token: RpcMeasurementToken, responseBytes: number) => void;
  recordRpcStarted: (
    method: RpcMethodName,
    inboundBytes: number,
  ) => RpcMeasurementToken;
  recordRpcSucceeded: (
    token: RpcMeasurementToken,
    responseBytes: number,
  ) => void;
  recordRpcTimedOut: (
    token: RpcMeasurementToken,
    responseBytes: number,
  ) => void;
  recordWebSocketPush: (input: {
    deliveredClients: number;
    droppedClients: number;
    payloadBytes: number;
    type: string;
  }) => void;
  revalidateSession: (
    client: ServerWebSocket<RpcWebSocketSocketData>,
  ) => boolean;
  toErrorPayload: (
    error: unknown,
  ) => Pick<
    Extract<RpcResponseMessage, { ok: false }>,
    "error" | "errorCode" | "errorDetails"
  >;
};

export async function encodeRpcServerFrame(
  value: RpcSocketMessage,
  options: {
    avoidLargeJsonStringify?: boolean;
    maxUncompressedServerBinaryFrameBytes: number;
  },
): Promise<string | Uint8Array> {
  const binaryFrame = await encodeRpcBinaryFrame(value, { compress: false });
  if (binaryFrame.byteLength <= options.maxUncompressedServerBinaryFrameBytes) {
    return binaryFrame;
  }
  if (options.avoidLargeJsonStringify) {
    return encodeRpcBinaryFrame(value, { compress: true });
  }
  // Large request/response frames still fall back to plain JSON for compatibility
  // with existing response handling; server pushes opt into the compressed
  // binary path above so broadcast fanout does not synchronously stringify large
  // payloads on the main thread.
  return JSON.stringify(value);
}

export function isSafeRpcRequestId(value: unknown): value is number {
  // Request id 0 is valid client-supplied correlation state, not a server
  // sentinel. Transport-local parse failures use the private requestId = -1
  // marker so accepting 0 cannot collide with internal error handling.
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function createAbortError(reason: unknown, fallbackMessage: string): Error {
  // Keep this transport-local to avoid coupling the low-level websocket
  // transport to project-procedure modules; the similarly named helper in
  // project-procedures/shared.ts serves a different layer.
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function rawSocketMessageByteLength(rawMessage: string | Buffer): number {
  return typeof rawMessage === "string"
    ? Buffer.byteLength(rawMessage, "utf8")
    : rawMessage.byteLength;
}

function parseRawSocketMessage(rawMessage: string | Buffer): string {
  return typeof rawMessage === "string"
    ? rawMessage
    : SOCKET_TEXT_DECODER.decode(rawMessage);
}

function webSocketRawByteLength(raw: string | Uint8Array): number {
  return typeof raw === "string"
    ? Buffer.byteLength(raw, "utf8")
    : raw.byteLength;
}

export function classifyRpcWebSocketSendStatus(
  sendStatus: number,
): "backpressure" | "dropped" | "sent" {
  if (sendStatus === -1) {
    return "backpressure";
  }
  if (sendStatus === 0) {
    return "dropped";
  }
  return "sent";
}

function buildRequestSignal(timeoutMs: number | null): {
  clearTimeout: () => void;
  controller: AbortController;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  if (typeof timeoutMs !== "number") {
    return {
      clearTimeout: () => {},
      controller,
      signal: controller.signal,
    };
  }

  const timeoutTimer = setTimeout(() => {
    controller.abort(
      new DOMException(
        `RPC request timed out after ${timeoutMs}ms.`,
        "TimeoutError",
      ),
    );
  }, timeoutMs);
  return {
    clearTimeout: () => {
      clearTimeout(timeoutTimer);
    },
    controller,
    signal: controller.signal,
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

async function parseRpcClientPayload(
  raw: string | Buffer,
  options: Pick<
    RpcTransportOptions,
    "logger" | "maxPayloadBytes" | "normalizeErrorDescription"
  >,
): Promise<ParsedRpcClientMessage> {
  if (isRpcBinaryFrame(raw)) {
    try {
      return (await decodeRpcBinaryFrame(raw, {
        // Clients may send JSON text or uncompressed RPC binary frames only. The
        // server rejects compressed client frames because Bun already enforces
        // maxPayloadLength on the wire bytes; accepting compressed input would
        // make resource accounting depend on decompression ratio instead of the
        // existing per-message payload cap.
        allowCompressed: false,
        maxDecodedBodyBytes: options.maxPayloadBytes,
      })) as ParsedRpcClientMessage;
    } catch (error) {
      options.logger.warning({
        message: "Invalid RPC client binary frame",
        error: options.normalizeErrorDescription(error),
      });
      throw new Error("Invalid RPC binary request payload");
    }
  }

  let text: string;
  try {
    text = parseRawSocketMessage(raw);
  } catch (error) {
    options.logger.warning({
      message: "Invalid RPC client message UTF-8",
      error: options.normalizeErrorDescription(error),
    });
    throw new Error("Invalid RPC request payload");
  }
  try {
    return JSON.parse(text) as ParsedRpcClientMessage;
  } catch (error) {
    options.logger.warning({
      message: "Invalid RPC client message JSON",
      payloadPreview: text.slice(0, 200),
      error: options.normalizeErrorDescription(error),
    });
    throw new Error("Invalid RPC request payload");
  }
}

export function createRpcTransport(options: RpcTransportOptions): RpcTransport {
  const clients = new Set<ServerWebSocket<RpcWebSocketSocketData>>();
  const clientsBySessionId = new Map<
    string,
    Set<ServerWebSocket<RpcWebSocketSocketData>>
  >();
  const indexedClientSessionId = new WeakMap<
    ServerWebSocket<RpcWebSocketSocketData>,
    string
  >();
  const pendingRequestsByClient = new WeakMap<
    ServerWebSocket<RpcWebSocketSocketData>,
    Map<number, PendingRpcRequest>
  >();
  const clientMessageQueueTail = new WeakMap<
    ServerWebSocket<RpcWebSocketSocketData>,
    Promise<void>
  >();
  const rateLimitBuckets = new WeakMap<
    ServerWebSocket<RpcWebSocketSocketData>,
    RpcRateLimitBucket
  >();
  let pendingRequestCount = 0;
  let peakPendingRequestCount = 0;
  let allClientsMicrotaskSnapshot:
    | ServerWebSocket<RpcWebSocketSocketData>[]
    | null = null;
  let clearAllClientsMicrotaskSnapshotQueued = false;

  function getAllClientsMicrotaskSnapshot(): ServerWebSocket<RpcWebSocketSocketData>[] {
    if (allClientsMicrotaskSnapshot) {
      return allClientsMicrotaskSnapshot;
    }
    allClientsMicrotaskSnapshot = [...clients];
    if (!clearAllClientsMicrotaskSnapshotQueued) {
      clearAllClientsMicrotaskSnapshotQueued = true;
      queueMicrotask(() => {
        allClientsMicrotaskSnapshot = null;
        clearAllClientsMicrotaskSnapshotQueued = false;
      });
    }
    return allClientsMicrotaskSnapshot;
  }

  function incrementPendingRequestCount(): void {
    pendingRequestCount += 1;
    peakPendingRequestCount = Math.max(
      peakPendingRequestCount,
      pendingRequestCount,
    );
  }

  function decrementPendingRequestCount(count = 1): void {
    pendingRequestCount = Math.max(0, pendingRequestCount - count);
  }

  function getPendingRequests(
    client: ServerWebSocket<RpcWebSocketSocketData>,
  ): Map<number, PendingRpcRequest> {
    const existing = pendingRequestsByClient.get(client);
    if (existing) {
      return existing;
    }

    const created = new Map<number, PendingRpcRequest>();
    pendingRequestsByClient.set(client, created);
    return created;
  }

  function assertCapacity(
    pendingRequests: Map<number, PendingRpcRequest>,
    incomingRequests = 1,
  ): void {
    if (
      pendingRequests.size + incomingRequests >
      options.maxPendingRequestsPerClient
    ) {
      throw new RpcCapacityError(
        `Too many pending RPC requests for this connection (${pendingRequests.size}/${options.maxPendingRequestsPerClient}).`,
      );
    }
    if (pendingRequestCount + incomingRequests > options.maxPendingRequests) {
      throw new RpcCapacityError(
        `Server RPC backlog is full (${pendingRequestCount}/${options.maxPendingRequests}).`,
      );
    }
  }

  function assertRateLimit(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    method: RpcMethodName,
    nowMs: number,
  ): void {
    const existing = rateLimitBuckets.get(client);
    const elapsedSeconds = existing
      ? Math.max(0, (nowMs - existing.updatedAtMs) / 1000)
      : 0;
    const tokens = Math.min(
      options.rateLimitBurst,
      (existing?.tokens ?? options.rateLimitBurst) +
        elapsedSeconds * options.rateLimitRefillPerSecond,
    );
    if (tokens < 1) {
      rateLimitBuckets.set(client, {
        tokens,
        updatedAtMs: nowMs,
      });
      // Keep the canonical RPC method in this operator-facing rate-limit
      // error so slow/flooding client behavior can be tied back to a concrete
      // procedure. Arbitrary unvalidated method names are sanitized earlier in
      // request validation before they can reach this typed path.
      throw new Error(
        `RPC rate limit exceeded for this connection while handling ${String(method)}.`,
      );
    }
    rateLimitBuckets.set(client, {
      tokens: tokens - 1,
      updatedAtMs: nowMs,
    });
  }

  function addClientToSessionIndex(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    sessionId: string,
  ): void {
    let sessionClients = clientsBySessionId.get(sessionId);
    if (!sessionClients) {
      sessionClients = new Set();
      clientsBySessionId.set(sessionId, sessionClients);
    }
    sessionClients.add(client);
    indexedClientSessionId.set(client, sessionId);
  }

  function removeClientFromSessionIndex(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    sessionId: string,
  ): void {
    const sessionClients = clientsBySessionId.get(sessionId);
    if (!sessionClients) {
      return;
    }
    sessionClients.delete(client);
    if (sessionClients.size === 0) {
      clientsBySessionId.delete(sessionId);
    }
  }

  function refreshClientIndexes(
    client: ServerWebSocket<RpcWebSocketSocketData>,
  ): void {
    const nextSessionId =
      typeof client.data.sessionId === "string" ? client.data.sessionId : null;
    const previousSessionId = indexedClientSessionId.get(client);
    if (
      previousSessionId !== undefined &&
      previousSessionId !== nextSessionId
    ) {
      removeClientFromSessionIndex(client, previousSessionId);
      indexedClientSessionId.delete(client);
    }
    if (
      typeof nextSessionId === "string" &&
      previousSessionId !== nextSessionId
    ) {
      addClientToSessionIndex(client, nextSessionId);
    }
  }

  function removeClientIndexes(
    client: ServerWebSocket<RpcWebSocketSocketData>,
  ): void {
    const previousSessionId = indexedClientSessionId.get(client);
    if (previousSessionId !== undefined) {
      removeClientFromSessionIndex(client, previousSessionId);
      indexedClientSessionId.delete(client);
    }
  }

  function abortPendingRequest(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    requestId: number,
  ): void {
    const pendingRequests = pendingRequestsByClient.get(client);
    const pending = pendingRequests?.get(requestId);
    if (!pending) {
      options.logger.trace({
        message: "RPC request cancel ignored",
        requestId,
        sessionId: client.data.sessionId,
      });
      return;
    }

    pending.canceledByClient = true;
    options.logger.trace({
      message: "RPC request canceled by client",
      requestId,
      sessionId: client.data.sessionId,
    });
    pending.controller.abort(
      createAbortError(
        null,
        `RPC request ${requestId} was canceled by the client.`,
      ),
    );
  }

  function abortAllPendingRequests(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    reason: string,
  ): void {
    const pendingRequests = pendingRequestsByClient.get(client);
    if (!pendingRequests) {
      return;
    }

    options.logger.trace({
      message: "Aborting all pending RPC requests",
      requestCount: pendingRequests.size,
      reason,
      sessionId: client.data.sessionId,
    });
    for (const pending of pendingRequests.values()) {
      pending.canceledByClient = true;
      pending.clearTimeout();
      pending.controller.abort(createAbortError(null, reason));
    }
    // Clear the per-client map after subtracting the global count. Individual
    // request finally blocks check pendingRequests.get(id) before decrementing,
    // so aborting/closing a socket cannot double-subtract the same request.
    decrementPendingRequestCount(pendingRequests.size);
    pendingRequests.clear();
    pendingRequestsByClient.delete(client);
  }

  function open(client: ServerWebSocket<RpcWebSocketSocketData>): void {
    clients.add(client);
    clientMessageQueueTail.set(client, Promise.resolve());
    refreshClientIndexes(client);
  }

  function close(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    reason: string,
  ): void {
    clients.delete(client);
    clientMessageQueueTail.delete(client);
    removeClientIndexes(client);
    abortAllPendingRequests(client, reason);
  }

  function drain(client: ServerWebSocket<RpcWebSocketSocketData>): void {
    if (!clients.has(client)) {
      return;
    }
    refreshClientIndexes(client);
    options.logger.trace({
      message: "RPC websocket send buffer drained",
      sessionId: client.data.sessionId,
    });
  }

  function rejectOversizedMessage(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    messageByteLength: number,
  ): void {
    options.logger.warning({
      message: "WebSocket message rejected because it exceeds the size limit",
      limitBytes: options.maxPayloadBytes,
      messageByteLength,
      sessionId: client.data.sessionId,
    });
    close(client, "RPC websocket message exceeded size limit.");
    try {
      client.close(1009, "WebSocket message too large.");
    } catch {
      // The socket may already be closing; unregistering above handles server state.
    }
  }

  function rejectAbusiveMessage(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    messageByteLength: number,
  ): void {
    options.logger.warning({
      message: "WebSocket message rejected by pre-parse abuse control",
      messageByteLength,
      sessionId: client.data.sessionId,
    });
    close(client, "RPC websocket pre-parse message budget exceeded.");
    try {
      client.close(1008, "RPC websocket message rate exceeded.");
    } catch {
      // The socket may already be closing; unregistering above handles server state.
    }
  }

  function sendWebSocketMessage(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    raw: string | Uint8Array,
  ): boolean {
    try {
      const sendStatus = client.send(raw);
      const sendOutcome = classifyRpcWebSocketSendStatus(sendStatus);
      if (sendOutcome === "sent") {
        return true;
      }

      const reason =
        sendOutcome === "backpressure"
          ? "RPC websocket send backpressure."
          : "RPC websocket send dropped.";
      options.logger.warning({
        message: "RPC websocket send failed",
        reason,
        sendStatus,
        sessionId: client.data.sessionId,
      });
      // Policy: close on first backpressure/dropped send instead of queueing.
      // This keeps memory bounded and preserves message order; slow clients
      // reconnect and rehydrate state through normal bootstrap/list RPCs.
      close(client, reason);
      try {
        client.close(RPC_WEBSOCKET_BACKPRESSURE_CLOSE_CODE, reason);
      } catch {
        // The socket may already be closing; unregistering above handles server state.
      }
      return false;
    } catch {
      close(client, "RPC websocket send failed.");
      return false;
    }
  }

  async function publishLazy(
    type: string,
    buildRaw: () => Promise<string | Uint8Array>,
    scope: RpcPublishScope = { kind: "all" },
  ): Promise<number> {
    let deliveredClients = 0;
    let droppedClients = 0;
    let raw: string | Uint8Array | null = null;
    const targetClients = collectClients(scope);
    for (const client of targetClients) {
      if (!clients.has(client)) {
        continue;
      }
      raw ??= await buildRaw();
      if (sendWebSocketMessage(client, raw)) {
        deliveredClients += 1;
      } else {
        droppedClients += 1;
      }
    }
    options.recordWebSocketPush({
      deliveredClients,
      droppedClients,
      payloadBytes: raw === null ? 0 : webSocketRawByteLength(raw),
      type,
    });
    return deliveredClients;
  }

  function collectClients(
    scope: RpcPublishScope,
  ): Iterable<ServerWebSocket<RpcWebSocketSocketData>> {
    // Publish fanout deliberately snapshots internal socket sets. Sending can
    // synchronously close clients and mutate both indexes, so the small array
    // allocation avoids iterator invalidation and skipped recipients.
    switch (scope.kind) {
      case "all":
        return getAllClientsMicrotaskSnapshot();
      case "clients":
        return scope.clients;
      case "session":
        return typeof scope.sessionId === "string"
          ? [...(clientsBySessionId.get(scope.sessionId) ?? [])]
          : [];
    }
  }

  async function publish(
    message: RpcSocketMessage,
    scope?: RpcPublishScope,
  ): Promise<number> {
    return publishLazy(
      message.type,
      () =>
        encodeRpcServerFrame(message, {
          avoidLargeJsonStringify: true,
          maxUncompressedServerBinaryFrameBytes:
            options.maxUncompressedServerBinaryFrameBytes,
        }),
      scope,
    );
  }

  async function executeRegisteredRpcRequest(input: {
    client: ServerWebSocket<RpcWebSocketSocketData>;
    finalizeRpcMeasurement: (
      outcome: "canceled" | "failed" | "succeeded" | "timedOut",
      responseBytes?: number,
    ) => void;
    handler: (
      params: RpcRequestMap[RpcMethodName]["params"],
      context: RpcRequestContext,
    ) => Promise<RpcRequestMap[RpcMethodName]["response"]>;
    messageStartedAt: number;
    pending: PendingRpcRequest;
    pendingRequests: Map<number, PendingRpcRequest>;
    request: Extract<RpcClientMessage, { type: "request" }>;
  }): Promise<void> {
    const {
      client,
      finalizeRpcMeasurement,
      handler,
      messageStartedAt,
      pending,
      pendingRequests,
      request,
    } = input;
    const { signal } = pending;
    try {
      const result = await awaitRequestResult(
        handler(request.params, {
          auth: client.data,
          signal,
          priority: request.priority,
          timeoutMs: pending.timeoutMs,
        }),
        signal,
      );
      if (signal.aborted) {
        finalizeRpcMeasurement("canceled");
        return;
      }

      const response: RpcResponseMessage = {
        id: request.id,
        ok: true,
        result,
        type: "response",
      };
      const rawResponse = await encodeRpcServerFrame(response, {
        maxUncompressedServerBinaryFrameBytes:
          options.maxUncompressedServerBinaryFrameBytes,
      });
      const responseBytes = webSocketRawByteLength(rawResponse);
      if (!sendWebSocketMessage(client, rawResponse)) {
        finalizeRpcMeasurement("failed", responseBytes);
        return;
      }
      finalizeRpcMeasurement("succeeded", responseBytes);
      options.logger.trace({
        message: "RPC request completed",
        requestId: request.id,
        method: request.method,
        durationMs: Date.now() - messageStartedAt,
        sessionId: client.data.sessionId,
      });
    } catch (error) {
      if (pending.canceledByClient) {
        finalizeRpcMeasurement("canceled");
        return;
      }

      const isTimeout =
        isAbortError(error) &&
        pending.timeoutMs !== null &&
        isTimeoutAbort(pending.signal);
      const rpcError = isTimeout
        ? toRpcAbortMessage(request, pending, error)
        : options.normalizeErrorDescription(error);
      options.logger.warning({
        message: isTimeout ? "RPC request timed out" : "RPC request failed",
        requestId: request.id,
        method: request.method,
        durationMs: Date.now() - messageStartedAt,
        error: rpcError,
      });

      const response: RpcResponseMessage = {
        id: request.id,
        ok: false,
        ...(isAbortError(error) && signal.aborted
          ? {
              error: toRpcAbortMessage(request, pending, error),
            }
          : options.toErrorPayload(error)),
        type: "response",
      };
      const rawResponse = await encodeRpcServerFrame(response, {
        maxUncompressedServerBinaryFrameBytes:
          options.maxUncompressedServerBinaryFrameBytes,
      });
      finalizeRpcMeasurement(
        isTimeout ? "timedOut" : "failed",
        webSocketRawByteLength(rawResponse),
      );
      sendWebSocketMessage(client, rawResponse);
    } finally {
      pending.clearTimeout();
      if (pendingRequests.get(request.id) === pending) {
        pendingRequests.delete(request.id);
        decrementPendingRequestCount();
        options.logger.trace({
          message: "RPC request cleaned up",
          requestId: request.id,
          globalPending: pendingRequestCount,
          pendingForClient: pendingRequests.size,
        });
      }
    }
  }

  async function handleMessageAsync(
    client: ServerWebSocket<RpcWebSocketSocketData>,
    rawMessage: string | Buffer,
  ): Promise<void> {
    const messageStartedAt = Date.now();
    let requestId = -1;
    const messageByteLength = rawSocketMessageByteLength(rawMessage);
    let rpcMeasurement: RpcMeasurementToken | null = null;
    let rpcMeasurementFinished = false;
    const finalizeRpcMeasurement = (
      outcome: "canceled" | "failed" | "succeeded" | "timedOut",
      responseBytes = 0,
    ): void => {
      if (!rpcMeasurement || rpcMeasurementFinished) {
        return;
      }
      rpcMeasurementFinished = true;
      switch (outcome) {
        case "canceled":
          options.recordRpcCanceled(rpcMeasurement);
          return;
        case "failed":
          options.recordRpcFailed(rpcMeasurement, responseBytes);
          return;
        case "succeeded":
          options.recordRpcSucceeded(rpcMeasurement, responseBytes);
          return;
        case "timedOut":
          options.recordRpcTimedOut(rpcMeasurement, responseBytes);
          return;
      }
    };

    try {
      if (!options.revalidateSession(client)) {
        close(client, "RPC session is no longer authenticated.");
        return;
      }
      refreshClientIndexes(client);
      if (messageByteLength > options.maxPayloadBytes) {
        rejectOversizedMessage(client, messageByteLength);
        return;
      }
      if (!options.consumePreParseBudget(client, messageByteLength).allowed) {
        rejectAbusiveMessage(client, messageByteLength);
        return;
      }
      // Transport telemetry intentionally starts only after the payload parses
      // into a typed RPC request. Malformed frames are counted by websocket
      // abuse/size controls and logs, so there is no started RPC measurement to
      // leak when parseClientMessage rejects before request registration.
      const parsed = await parseRpcClientPayload(rawMessage, options);
      requestId = isSafeRpcRequestId(parsed.id) ? parsed.id : -1;
      const message = options.parseClientMessage(parsed);
      if (message.type === "cancel") {
        options.logger.trace({
          message: "RPC client cancel message",
          requestId: message.id,
          sessionId: client.data.sessionId,
        });
        abortPendingRequest(client, message.id);
        return;
      }

      const request = message;
      requestId = request.id;
      assertRateLimit(client, request.method, messageStartedAt);
      rpcMeasurement = options.recordRpcStarted(
        request.method,
        messageByteLength,
      );
      options.logger.trace({
        message: "RPC request processing started",
        requestId: request.id,
        method: request.method,
        priority: request.priority,
        timeoutMs: request.timeoutMs ?? null,
        sessionId: client.data.sessionId,
      });
      const pendingRequests = getPendingRequests(client);
      // Request ids are scoped to one authenticated WebSocket connection. The
      // transport rejects duplicate in-flight ids and auth/session cookies plus
      // one-time websocket tickets prevent cross-session replay; completed ids
      // are intentionally not retained forever because mutating RPC handlers
      // must be idempotent or application-level guarded where duplicate user
      // actions are unsafe.
      if (pendingRequests.has(request.id)) {
        options.logger.warning({
          message: "Duplicate RPC request received while pending",
          requestId: request.id,
          method: request.method,
          sessionId: client.data.sessionId,
        });
        throw new Error(`RPC request ${request.id} is already pending.`);
      }
      assertCapacity(pendingRequests);

      const { clearTimeout, controller, signal } = buildRequestSignal(
        request.timeoutMs ?? null,
      );
      const pending: PendingRpcRequest = {
        clearTimeout,
        controller,
        signal,
        timeoutMs: request.timeoutMs ?? null,
        canceledByClient: false,
      };
      pendingRequests.set(request.id, pending);
      incrementPendingRequestCount();
      options.logger.trace({
        message: "RPC request registered",
        requestId: request.id,
        pendingForClient: pendingRequests.size,
        globalPending: pendingRequestCount,
      });

      const registeredHandler = options.handlers[request.method];
      if (typeof registeredHandler !== "function") {
        throw new Error(`Unknown RPC method: ${String(request.method)}.`);
      }
      const handler = registeredHandler as (
        params: RpcRequestMap[RpcMethodName]["params"],
        context: RpcRequestContext,
      ) => Promise<RpcRequestMap[RpcMethodName]["response"]>;
      void executeRegisteredRpcRequest({
        client,
        finalizeRpcMeasurement,
        handler,
        messageStartedAt,
        pending,
        pendingRequests,
        request,
      }).catch((error: unknown) => {
        options.logger.error({
          message: "Unhandled RPC request execution failure",
          requestId: request.id,
          method: request.method,
          sessionId: client.data.sessionId,
          error: options.normalizeErrorDescription(error),
        });
      });
    } catch (error) {
      if (requestId < 0) {
        // No safe client correlation id was parsed. Do not synthesize or echo
        // the transport-local -1 sentinel; malformed frames are already logged
        // by parse/validation helpers and abuse controls.
        finalizeRpcMeasurement("failed", 0);
        return;
      }
      options.logger.warning({
        message: "RPC message handling failed",
        requestId,
        error: options.normalizeErrorDescription(error),
      });
      const response: RpcResponseMessage = {
        id: requestId,
        ok: false,
        ...(isRpcCapacityError(error)
          ? { error: error.publicMessage }
          : options.toErrorPayload(error)),
        type: "response",
      };
      const rawResponse = await encodeRpcServerFrame(response, {
        maxUncompressedServerBinaryFrameBytes:
          options.maxUncompressedServerBinaryFrameBytes,
      });
      finalizeRpcMeasurement("failed", webSocketRawByteLength(rawResponse));
      sendWebSocketMessage(client, rawResponse);
    }
  }

  return {
    getClientCount: () => clients.size,
    getHealthSnapshot: () => ({
      clientCount: clients.size,
      pendingRequests: {
        current: pendingRequestCount,
        peak: peakPendingRequestCount,
      },
    }),
    getPendingRequestCount: () => pendingRequestCount,
    getPeakPendingRequestCount: () => peakPendingRequestCount,
    open,
    close,
    drain,
    handleMessage(client, rawMessage) {
      const previous = clientMessageQueueTail.get(client) ?? Promise.resolve();
      const next = previous
        .then(() => handleMessageAsync(client, rawMessage))
        .catch((error: unknown) => {
          options.logger.error({
            message: "Unhandled RPC websocket message task failure",
            sessionId: client.data.sessionId,
            error: options.normalizeErrorDescription(error),
          });
          close(client, "Unhandled RPC websocket message task failure.");
          try {
            client.close(1011, "RPC websocket message handling failed.");
          } catch {
            // The socket may already be closing; unregistering above handles server state.
          }
        });
      clientMessageQueueTail.set(client, next);
    },
    closeSession(sessionId, reason) {
      let closedCount = 0;
      for (const client of [...(clientsBySessionId.get(sessionId) ?? [])]) {
        close(client, reason);
        closedCount += 1;
        try {
          client.close(1008, reason);
        } catch {
          // Ignore stale socket close failures.
        }
      }
      return closedCount;
    },
    closeUser(userId, reason) {
      let closedCount = 0;
      for (const client of [...clients]) {
        if (client.data.userId !== userId) {
          continue;
        }
        close(client, reason);
        closedCount += 1;
        try {
          client.close(1008, reason);
        } catch {
          // Ignore stale socket close failures.
        }
      }
      return closedCount;
    },
    hasClients: () => clients.size > 0,
    hasPublishTargets: (scope: RpcPublishScope = { kind: "all" }) =>
      [...collectClients(scope)].some((client) => clients.has(client)),
    publish,
    publishLazy,
  };
}
