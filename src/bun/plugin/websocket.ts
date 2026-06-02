/**
 * @file src/bun/plugin/websocket.ts
 * @description Permissioned Plugin System v1 WebSocket client execution.
 */

import { isIP } from "node:net";

import {
  assertPrivateNetworkOutboundHttpUrl,
  assertSafeOutboundHttpUrl,
  type ResolveHostname,
} from "../outbound-url-security";
import type { RpcPluginManifestNetworkSummary } from "../rpc-schema/plugin";
import { PluginPermissionError } from "./context";
import {
  assertPluginNetworkUrlAllowed,
  compilePluginNetworkAllowlist,
  PluginNetworkAllowlistError,
} from "./network-allowlist";

export { PluginPermissionError };

const REQUIRED_NETWORK_WEBSOCKET_PERMISSION = "network:websocket";
export const DEFAULT_PLUGIN_WEBSOCKET_CONNECT_TIMEOUT_MS = 30_000;
export const DEFAULT_PLUGIN_WEBSOCKET_RECEIVE_TIMEOUT_MS = 30_000;
export const DEFAULT_PLUGIN_WEBSOCKET_MAX_CONNECTIONS = 4;
export const DEFAULT_PLUGIN_WEBSOCKET_MAX_MESSAGE_BYTES = 64 * 1024;
export const DEFAULT_PLUGIN_WEBSOCKET_MAX_QUEUED_MESSAGES = 32;
export const DEFAULT_PLUGIN_WEBSOCKET_SEND_BURST = 32;
export const DEFAULT_PLUGIN_WEBSOCKET_SEND_REFILL_PER_SECOND = 16;
// Send throttling is intentionally scoped to each WebSocket connection record.
// Plugins already need explicit network:websocket permission, an allowlisted URL,
// and are capped at DEFAULT_PLUGIN_WEBSOCKET_MAX_CONNECTIONS concurrent sockets;
// reconnecting may reset one connection's bucket, but it cannot exceed those
// connection and destination-policy boundaries. This keeps the limit focused on
// accidental interactive floods rather than acting as an aggregate egress quota.
const MAX_PLUGIN_WEBSOCKET_TIMEOUT_MS = 600_000;

const BLOCKED_PLUGIN_WEBSOCKET_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type PluginWebSocketConnectOptions = {
  headers?: Record<string, unknown>;
  protocols?: string | readonly string[];
  timeoutMs?: number;
};

export type PluginWebSocketEvent =
  | { text: string; type: "message" }
  | { code: number; reason: string; type: "close" }
  | { message: string; type: "error" };

export type PluginWebSocketConnectResult = {
  id: number;
  url: string;
};

export type PluginWebSocketState = "closed" | "closing" | "connecting" | "open";

export type PluginWebSocketLimits = {
  maxConnections?: unknown;
  maxMessageBytes?: unknown;
  maxQueuedMessages?: unknown;
};

export type PluginWebSocketContext = {
  limits?: PluginWebSocketLimits | null;
  network?: RpcPluginManifestNetworkSummary | null | undefined;
  permissions: readonly string[];
  resolveHostname?: ResolveHostname;
  unsafeAllowPrivateNetwork?: boolean;
};

export type PluginWebSocketOperation =
  | "websocket.close"
  | "websocket.connect"
  | "websocket.receive"
  | "websocket.send"
  | "websocket.state";

export type PluginWebSocketErrorCode =
  | "allowlist_denied"
  | "blocked_request_header"
  | "connection_limit_exceeded"
  | "invalid_connection_id"
  | "invalid_network_policy"
  | "invalid_request_options"
  | "message_rate_limited"
  | "message_too_large"
  | "network_websocket_failed"
  | "permission_denied"
  | "queue_overflow"
  | "receive_already_pending"
  | "timeout";

export class PluginWebSocketError extends Error {
  readonly code: PluginWebSocketErrorCode;

  constructor(input: {
    cause?: unknown;
    code: PluginWebSocketErrorCode;
    message: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginWebSocketError";
    this.code = input.code;
  }
}

type WebSocketRecord = {
  finalEvent: Extract<PluginWebSocketEvent, { type: "close" | "error" }> | null;
  id: number;
  queue: PluginWebSocketEvent[];
  receive: {
    reject: (error: Error) => void;
    resolve: (event: PluginWebSocketEvent) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null;
  sendRateLimit: {
    tokens: number;
    updatedAtMs: number;
  };
  socket: WebSocket;
  state: PluginWebSocketState;
  url: string;
};

function hasPermission(
  context: PluginWebSocketContext,
  permission: string,
): boolean {
  return context.permissions.includes(permission);
}

function assertPluginWebSocketPermission(
  context: PluginWebSocketContext,
): void {
  if (hasPermission(context, REQUIRED_NETWORK_WEBSOCKET_PERMISSION)) {
    return;
  }
  throw new PluginPermissionError(
    "Plugin WebSocket requires network:websocket permission.",
  );
}

function compiledAllowlistForContext(context: PluginWebSocketContext) {
  const network = context.network;
  const webSocketAllow = network?.webSocketAllow ?? [];
  if (!network || webSocketAllow.length === 0) {
    throw new PluginWebSocketError({
      code: "invalid_network_policy",
      message:
        "Plugin WebSocket requires a non-empty network.webSocketAllow list.",
    });
  }

  const compiled = compilePluginNetworkAllowlist({
    allowUnsafeAllDomains: context.permissions.includes("unsafe"),
    enforceHttps: network.enforceHttps ?? true,
    kind: "websocket",
    patterns: webSocketAllow,
  });
  if (compiled.issues.length > 0) {
    throw new PluginWebSocketError({
      code: "invalid_network_policy",
      message: compiled.issues.map((issue) => issue.message).join(" "),
    });
  }
  return compiled.patterns;
}

function assertPluginWebSocketUrlAllowed(
  allowlist: Parameters<typeof assertPluginNetworkUrlAllowed>[0],
  requestUrl: string | URL,
): URL {
  try {
    return assertPluginNetworkUrlAllowed(allowlist, requestUrl);
  } catch (error) {
    if (error instanceof PluginNetworkAllowlistError) {
      throw new PluginWebSocketError({
        cause: error,
        code: "allowlist_denied",
        message: error.message,
      });
    }
    throw error;
  }
}

function isIpLiteralHostname(hostname: string): boolean {
  const normalized =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return isIP(normalized) !== 0;
}

async function assertSafePluginWebSocketUrl(
  url: URL,
  context: PluginWebSocketContext,
): Promise<URL> {
  const urlOptions = {
    label: "Plugin WebSocket URL",
    ...(context.resolveHostname
      ? { resolveHostname: context.resolveHostname }
      : {}),
  };
  const httpUrl = new URL(url.toString());
  httpUrl.protocol = url.protocol === "wss:" ? "https:" : "http:";

  // Bun's WebSocket client accepts a hostname and owns the DNS lookup, unlike
  // safe outbound HTTP where the host can resolve and validate every address
  // before dialing. Until WebSocket dialing can pin a vetted resolved address,
  // plugins may only connect to IP-literal WebSocket URLs; unsafe private-network
  // access broadens which IP literals are allowed but does not re-enable DNS.
  if (context.unsafeAllowPrivateNetwork) {
    if (!isIpLiteralHostname(url.hostname)) {
      throw new PluginWebSocketError({
        code: "network_websocket_failed",
        message:
          "Plugin WebSocket DNS hostnames are denied until DNS-pinned WebSocket dialing is available.",
      });
    }
    await assertPrivateNetworkOutboundHttpUrl(httpUrl.toString(), urlOptions);
    return url;
  }
  if (!isIpLiteralHostname(url.hostname)) {
    throw new PluginWebSocketError({
      code: "network_websocket_failed",
      message:
        "Plugin WebSocket DNS hostnames require unsafe private-network access until DNS-pinned WebSocket dialing is available.",
    });
  }
  await assertSafeOutboundHttpUrl(httpUrl.toString(), urlOptions);
  return url;
}

function mapSafePluginWebSocketError(error: unknown): PluginWebSocketError {
  if (error instanceof PluginWebSocketError) {
    return error;
  }
  return new PluginWebSocketError({
    cause: error,
    code: "network_websocket_failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

function diagnosticPluginWebSocketUrl(url: string | URL): string {
  const parsedUrl = url instanceof URL ? new URL(url) : new URL(url);
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

function integerLimit(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function timeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(MAX_PLUGIN_WEBSOCKET_TIMEOUT_MS, value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeRequestHeaders(input: unknown): Record<string, string> {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new PluginWebSocketError({
      code: "invalid_request_options",
      message: "Plugin WebSocket headers must be an object.",
    });
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      const headerName = key.trim();
      const normalizedHeaderName = headerName.toLowerCase();
      if (BLOCKED_PLUGIN_WEBSOCKET_REQUEST_HEADERS.has(normalizedHeaderName)) {
        throw new PluginWebSocketError({
          code: "blocked_request_header",
          message: `Plugin WebSocket cannot set blocked request header "${headerName}".`,
        });
      }
      return [headerName, String(value)];
    }),
  );
}

function normalizeProtocols(input: unknown): string | string[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  if (
    Array.isArray(input) &&
    input.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    return input.slice();
  }
  throw new PluginWebSocketError({
    code: "invalid_request_options",
    message: "Plugin WebSocket protocols must be a string or string array.",
  });
}

type NormalizedPluginWebSocketConnectOptions = {
  headers: Record<string, string>;
  protocols: string | string[];
  timeoutMs: number;
};

function normalizeConnectOptions(
  input: unknown,
): NormalizedPluginWebSocketConnectOptions {
  if (input === undefined || input === null) {
    return {
      headers: {},
      protocols: [],
      timeoutMs: DEFAULT_PLUGIN_WEBSOCKET_CONNECT_TIMEOUT_MS,
    };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new PluginWebSocketError({
      code: "invalid_request_options",
      message:
        "Plugin WebSocket connect options must be an object when provided.",
    });
  }
  const record = input as Record<string, unknown>;
  return {
    headers: normalizeRequestHeaders(record.headers),
    protocols: normalizeProtocols(record.protocols) ?? [],
    timeoutMs: timeoutMs(
      record.timeoutMs,
      DEFAULT_PLUGIN_WEBSOCKET_CONNECT_TIMEOUT_MS,
    ),
  };
}

export function isPluginWebSocketOperation(
  operation: string,
): operation is PluginWebSocketOperation {
  return (
    operation === "websocket.close" ||
    operation === "websocket.connect" ||
    operation === "websocket.receive" ||
    operation === "websocket.send" ||
    operation === "websocket.state"
  );
}

export class PluginWebSocketRegistry {
  private readonly connections = new Map<number, WebSocketRecord>();
  private nextId = 1;

  constructor(private readonly context: PluginWebSocketContext) {}

  get maxConnections(): number {
    return integerLimit(
      this.context.limits?.maxConnections,
      DEFAULT_PLUGIN_WEBSOCKET_MAX_CONNECTIONS,
      1,
      32,
    );
  }

  get maxMessageBytes(): number {
    return integerLimit(
      this.context.limits?.maxMessageBytes,
      DEFAULT_PLUGIN_WEBSOCKET_MAX_MESSAGE_BYTES,
      1,
      1024 * 1024,
    );
  }

  get maxQueuedMessages(): number {
    return integerLimit(
      this.context.limits?.maxQueuedMessages,
      DEFAULT_PLUGIN_WEBSOCKET_MAX_QUEUED_MESSAGES,
      1,
      1024,
    );
  }

  async connect(input: {
    options?: unknown;
    url: string;
  }): Promise<PluginWebSocketConnectResult> {
    assertPluginWebSocketPermission(this.context);
    if (this.activeConnectionCount() >= this.maxConnections) {
      throw new PluginWebSocketError({
        code: "connection_limit_exceeded",
        message: `Plugin WebSocket connection limit of ${this.maxConnections} has been reached.`,
      });
    }
    const allowlist = compiledAllowlistForContext(this.context);
    const requestUrl = await assertSafePluginWebSocketUrl(
      assertPluginWebSocketUrlAllowed(allowlist, input.url),
      this.context,
    ).catch((error) => {
      throw mapSafePluginWebSocketError(error);
    });
    const options = normalizeConnectOptions(input.options);
    const id = this.nextId++;

    return await new Promise<PluginWebSocketConnectResult>(
      (resolve, reject) => {
        let settled = false;
        let record: WebSocketRecord | null = null;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          try {
            record?.socket.close();
          } catch {
            // Best-effort cleanup for connection timeouts.
          }
          reject(
            new PluginWebSocketError({
              code: "timeout",
              message: `Plugin WebSocket connect timed out after ${options.timeoutMs}ms for ${diagnosticPluginWebSocketUrl(requestUrl)}.`,
            }),
          );
        }, options.timeoutMs);

        const settleError = (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        };

        let socket: WebSocket;
        try {
          const protocols = options.protocols;
          const headers = options.headers;
          // Bun exposes both browser-style `(url, protocols)` and Bun-specific
          // `(url, options)` WebSocket overloads. Always use the Bun options
          // shape when plugin-supplied handshake metadata exists so custom
          // headers and subprotocols are applied together instead of relying on
          // runtime overload inference.
          const constructorOptions =
            Object.keys(headers).length > 0 ||
            (Array.isArray(protocols) && protocols.length > 0)
              ? { headers, protocols }
              : undefined;
          socket = new WebSocket(
            requestUrl.toString(),
            constructorOptions as unknown as ConstructorParameters<
              typeof WebSocket
            >[1],
          );
        } catch (error) {
          clearTimeout(timer);
          reject(
            new PluginWebSocketError({
              cause: error,
              code: "network_websocket_failed",
              message: `Plugin WebSocket failed for ${diagnosticPluginWebSocketUrl(requestUrl)}: ${error instanceof Error ? error.message : String(error)}`,
            }),
          );
          return;
        }

        record = {
          finalEvent: null,
          id,
          queue: [],
          receive: null,
          sendRateLimit: {
            tokens: DEFAULT_PLUGIN_WEBSOCKET_SEND_BURST,
            updatedAtMs: Date.now(),
          },
          socket,
          state: "connecting",
          url: requestUrl.toString(),
        };
        this.connections.set(id, record);

        const onOpen = () => {
          // WebSocket implementations may report open/error/close events close
          // together during failed handshakes. The settled guard makes the
          // connection attempt single-settle; later terminal events are queued
          // only after a successful open has already resolved to the plugin.
          if (settled || !record) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          record.state = "open";
          resolve({ id, url: record.url });
        };
        const onMessage = (event: MessageEvent) => {
          if (!record) {
            return;
          }
          try {
            this.enqueue(record, this.messageEventFromData(event.data));
          } catch (error) {
            const errorEvent = {
              message: error instanceof Error ? error.message : String(error),
              type: "error" as const,
            };
            record.finalEvent = errorEvent;
            this.enqueue(record, errorEvent);
            try {
              socket.close(1009, "plugin message too large");
            } catch {
              // Best-effort close after message limit failure.
            }
          }
        };
        const onClose = (event: CloseEvent) => {
          if (!record) {
            return;
          }
          record.state = "closed";
          const closeEvent = {
            code: event.code,
            reason: event.reason ?? "",
            type: "close" as const,
          };
          record.finalEvent = closeEvent;
          this.enqueue(record, closeEvent);
        };
        const onError = (event: Event) => {
          const message =
            "message" in event && typeof event.message === "string"
              ? event.message
              : `Plugin WebSocket failed for ${diagnosticPluginWebSocketUrl(requestUrl)}.`;
          if (!settled) {
            settleError(
              new PluginWebSocketError({
                code: "network_websocket_failed",
                message,
              }),
            );
            try {
              socket.close();
            } catch {
              // Best-effort cleanup after connection failure.
            }
            this.connections.delete(id);
            record = null;
            return;
          }
          if (record) {
            const errorEvent = { message, type: "error" as const };
            record.finalEvent = errorEvent;
            this.enqueue(record, errorEvent);
          }
        };

        socket.addEventListener("open", onOpen);
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", onClose);
        socket.addEventListener("error", onError);
      },
    );
  }

  async sendText(id: number, text: string): Promise<{ success: true }> {
    const record = this.requireConnection(id);
    if (record.state !== "open") {
      throw new PluginWebSocketError({
        code: "network_websocket_failed",
        message: `Plugin WebSocket ${id} is not open.`,
      });
    }
    this.assertSendRate(record);
    this.assertMessageSize(text);
    record.socket.send(text);
    return { success: true };
  }

  async receive(id: number, options?: unknown): Promise<PluginWebSocketEvent> {
    const record = this.requireConnection(id);
    if (record.queue.length > 0) {
      return this.consumeEvent(
        record,
        record.queue.shift() as PluginWebSocketEvent,
      );
    }
    if (record.finalEvent) {
      return this.consumeEvent(record, record.finalEvent);
    }
    if (record.receive) {
      throw new PluginWebSocketError({
        code: "receive_already_pending",
        message: `Plugin WebSocket ${id} already has a pending receive call.`,
      });
    }
    const timeout =
      options && typeof options === "object" && !Array.isArray(options)
        ? timeoutMs(
            (options as Record<string, unknown>).timeoutMs,
            DEFAULT_PLUGIN_WEBSOCKET_RECEIVE_TIMEOUT_MS,
          )
        : DEFAULT_PLUGIN_WEBSOCKET_RECEIVE_TIMEOUT_MS;
    return await new Promise<PluginWebSocketEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (record.receive) {
          record.receive = null;
        }
        reject(
          new PluginWebSocketError({
            code: "timeout",
            message: `Plugin WebSocket ${id} receive timed out after ${timeout}ms.`,
          }),
        );
      }, timeout);
      record.receive = { reject, resolve, timer };
    });
  }

  async close(
    id: number,
    input?: { code?: unknown; reason?: unknown },
  ): Promise<{ success: true }> {
    const record = this.requireConnection(id);
    const code =
      typeof input?.code === "number" && Number.isInteger(input.code)
        ? input.code
        : 1000;
    const reason = typeof input?.reason === "string" ? input.reason : "";
    record.state = record.state === "closed" ? "closed" : "closing";
    record.socket.close(code, reason);
    return { success: true };
  }

  async state(id: number): Promise<{ state: PluginWebSocketState }> {
    return { state: this.requireConnection(id).state };
  }

  closeAll(): void {
    // Plugin shutdown is a teardown boundary, not a graceful WebSocket close
    // handshake. The sidecar may be stopping or restarting, so close every
    // socket best-effort, reject any pending receive immediately, and drop
    // queued events instead of awaiting remote close/error delivery that could
    // prolong shutdown.
    for (const record of this.connections.values()) {
      if (record.receive) {
        clearTimeout(record.receive.timer);
        record.receive.reject(
          new PluginWebSocketError({
            code: "network_websocket_failed",
            message: "Plugin WebSocket closed during plugin shutdown.",
          }),
        );
        record.receive = null;
      }
      try {
        record.socket.close(1000, "plugin shutdown");
      } catch {
        // Best-effort shutdown cleanup.
      }
    }
    this.connections.clear();
  }

  private consumeEvent(
    record: WebSocketRecord,
    event: PluginWebSocketEvent,
  ): PluginWebSocketEvent {
    if (event.type === "close" || event.type === "error") {
      this.connections.delete(record.id);
    }
    return event;
  }

  private activeConnectionCount(): number {
    return [...this.connections.values()].filter(
      (record) => record.state !== "closed",
    ).length;
  }

  private requireConnection(id: number): WebSocketRecord {
    if (!Number.isInteger(id) || id <= 0) {
      throw new PluginWebSocketError({
        code: "invalid_connection_id",
        message: "Plugin WebSocket id must be a positive integer.",
      });
    }
    const record = this.connections.get(id);
    if (!record) {
      throw new PluginWebSocketError({
        code: "invalid_connection_id",
        message: `Plugin WebSocket ${id} is not open or does not exist.`,
      });
    }
    return record;
  }

  private messageEventFromData(data: unknown): PluginWebSocketEvent {
    const text = typeof data === "string" ? data : String(data ?? "");
    this.assertMessageSize(text);
    return { text, type: "message" };
  }

  private assertSendRate(record: WebSocketRecord): void {
    const nowMs = Date.now();
    const elapsedSeconds = Math.max(
      0,
      (nowMs - record.sendRateLimit.updatedAtMs) / 1000,
    );
    record.sendRateLimit.tokens = Math.min(
      DEFAULT_PLUGIN_WEBSOCKET_SEND_BURST,
      record.sendRateLimit.tokens +
        elapsedSeconds * DEFAULT_PLUGIN_WEBSOCKET_SEND_REFILL_PER_SECOND,
    );
    record.sendRateLimit.updatedAtMs = nowMs;
    if (record.sendRateLimit.tokens < 1) {
      throw new PluginWebSocketError({
        code: "message_rate_limited",
        message: "Plugin WebSocket send rate limit exceeded.",
      });
    }
    record.sendRateLimit.tokens -= 1;
  }

  private assertMessageSize(text: string): void {
    if (byteLength(text) > this.maxMessageBytes) {
      throw new PluginWebSocketError({
        code: "message_too_large",
        message: `Plugin WebSocket message exceeded ${this.maxMessageBytes} bytes.`,
      });
    }
  }

  private enqueue(record: WebSocketRecord, event: PluginWebSocketEvent): void {
    if (record.receive) {
      const receive = record.receive;
      record.receive = null;
      clearTimeout(receive.timer);
      receive.resolve(event);
      if (event.type === "close" || event.type === "error") {
        this.connections.delete(record.id);
      }
      return;
    }
    if (record.queue.length >= this.maxQueuedMessages) {
      const errorEvent = {
        message: `Plugin WebSocket ${record.id} exceeded queued message limit of ${this.maxQueuedMessages}.`,
        type: "error" as const,
      };
      record.finalEvent = errorEvent;
      record.queue.push(errorEvent);
      try {
        record.socket.close(1008, "plugin queue overflow");
      } catch {
        // Best-effort close on queue overflow.
      }
      return;
    }
    record.queue.push(event);
  }
}

export async function executePluginWebSocketOperation(input: {
  operation: PluginWebSocketOperation;
  params?: unknown;
  registry: PluginWebSocketRegistry;
}): Promise<unknown> {
  const params =
    input.params &&
    typeof input.params === "object" &&
    !Array.isArray(input.params)
      ? (input.params as Record<string, unknown>)
      : {};
  const id = typeof params.id === "number" ? params.id : 0;

  switch (input.operation) {
    case "websocket.connect":
      return await input.registry.connect({
        options: params.options,
        url: typeof params.url === "string" ? params.url : "",
      });
    case "websocket.send":
      return await input.registry.sendText(
        id,
        typeof params.text === "string"
          ? params.text
          : String(params.text ?? ""),
      );
    case "websocket.receive":
      return await input.registry.receive(id, params.options);
    case "websocket.close":
      return await input.registry.close(id, {
        code: params.code,
        reason: params.reason,
      });
    case "websocket.state":
      return await input.registry.state(id);
  }
}
