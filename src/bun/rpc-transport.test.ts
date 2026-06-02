import { describe, expect, test } from "bun:test";
import {
  decodeRpcBinaryFrame,
  isRpcBinaryFrame,
} from "../shared/rpc-binary-codec";
import {
  createRpcTransport,
  isSafeRpcRequestId,
  type ParsedRpcClientMessage,
  type RpcClientMessage,
  type RpcRequestMessage,
  type RpcTransportOptions,
} from "./rpc-transport";
import type { RpcRequestContext } from "./rpc-schema";
import type { RpcWebSocketSocketData } from "./rpc-websocket-auth";
import type { RpcMeasurementToken } from "./runtime-stats";

type FakeSocket = {
  closed: Array<{ code: number | undefined; reason: string | undefined }>;
  data: RpcWebSocketSocketData;
  onClose?: (code: number | undefined, reason: string | undefined) => void;
  sendResults: number[];
  sent: Array<string | Uint8Array>;
  close(code?: number, reason?: string): void;
  send(raw: string | Uint8Array): number;
};

type TransportHarness = {
  canceled: RpcMeasurementToken[];
  failed: Array<{ responseBytes: number; token: RpcMeasurementToken }>;
  logger: {
    errors: Record<string, unknown>[];
    traces: Record<string, unknown>[];
    warnings: Record<string, unknown>[];
  };
  options: RpcTransportOptions;
  pushes: Array<{
    deliveredClients: number;
    droppedClients: number;
    payloadBytes: number;
    type: string;
  }>;
  started: Array<{ inboundBytes: number; method: string }>;
  succeeded: Array<{ responseBytes: number; token: RpcMeasurementToken }>;
  timedOut: Array<{ responseBytes: number; token: RpcMeasurementToken }>;
};

const encoder = new TextEncoder();

function createFakeSocket(
  overrides: Partial<RpcWebSocketSocketData> = {},
): FakeSocket {
  return {
    closed: [],
    data: {
      isAdmin: false,
      sessionId: "session-a",
      stepUpValidUntil: null,
      userId: 1,
      username: "user-a",
      ...overrides,
    },
    sendResults: [],
    sent: [],
    close(code?: number, reason?: string) {
      this.onClose?.(code, reason);
      this.closed.push({ code, reason });
    },
    send(raw: string | Uint8Array) {
      this.sent.push(raw);
      return this.sendResults.shift() ?? 1;
    },
  };
}

function decodeJsonSend(raw: string | Uint8Array): unknown {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  return JSON.parse(text);
}

function sentAt(socket: FakeSocket, index: number): string | Uint8Array {
  const raw = socket.sent[index];
  if (raw === undefined) {
    throw new Error(`Expected socket send at index ${index}.`);
  }
  return raw;
}

function request(
  id: number,
  method = "listProjects",
  params: Record<string, unknown> = {},
  extra: Partial<RpcRequestMessage> = {},
): string {
  return JSON.stringify({
    id,
    method,
    params,
    type: "request",
    ...extra,
  });
}

function cancel(id: number): string {
  return JSON.stringify({ id, type: "cancel" });
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(5);
    }
  }
  throw lastError;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(
  handlers: Record<
    string,
    (params: unknown, context: RpcRequestContext) => Promise<unknown>
  > = {
    listProjects: async () => [],
  },
  overrides: Partial<RpcTransportOptions> = {},
): TransportHarness {
  const logger = {
    errors: [] as Record<string, unknown>[],
    traces: [] as Record<string, unknown>[],
    warnings: [] as Record<string, unknown>[],
  };
  const started: Array<{ inboundBytes: number; method: string }> = [];
  const canceled: RpcMeasurementToken[] = [];
  const failed: Array<{ responseBytes: number; token: RpcMeasurementToken }> =
    [];
  const succeeded: Array<{
    responseBytes: number;
    token: RpcMeasurementToken;
  }> = [];
  const timedOut: Array<{ responseBytes: number; token: RpcMeasurementToken }> =
    [];
  const pushes: TransportHarness["pushes"] = [];
  let tokenCounter = 0;

  const options: RpcTransportOptions = {
    consumePreParseBudget: () => ({ allowed: true }),
    handlers: handlers as unknown as RpcTransportOptions["handlers"],
    logger: {
      error: (description) => logger.errors.push(description),
      trace: (description) => logger.traces.push(description),
      warning: (description) => logger.warnings.push(description),
    },
    maxPayloadBytes: 1024 * 1024,
    maxPendingRequests: 4,
    maxPendingRequestsPerClient: 4,
    maxUncompressedServerBinaryFrameBytes: 0,
    normalizeErrorDescription: (error) =>
      error instanceof Error ? error.message : String(error),
    parseClientMessage: (parsed: ParsedRpcClientMessage): RpcClientMessage => {
      if (parsed.type === "cancel" && isSafeRpcRequestId(parsed.id)) {
        return { id: parsed.id, type: "cancel" };
      }
      if (parsed.type !== "request" || !isSafeRpcRequestId(parsed.id)) {
        throw new Error("Invalid RPC request payload");
      }
      if (typeof parsed.method !== "string" || !(parsed.method in handlers)) {
        throw new Error("Unknown RPC method");
      }
      return {
        id: parsed.id,
        method: parsed.method as RpcRequestMessage["method"],
        params: parsed.params,
        priority:
          parsed.priority === "background" || parsed.priority === "foreground"
            ? parsed.priority
            : "default",
        timeoutMs:
          typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
        type: "request",
      } as RpcRequestMessage;
    },
    rateLimitBurst: 100,
    rateLimitRefillPerSecond: 100,
    recordRpcCanceled: (token) => canceled.push(token),
    recordRpcFailed: (token, responseBytes) =>
      failed.push({ responseBytes, token }),
    recordRpcStarted: (method, inboundBytes) => {
      started.push({ inboundBytes, method: String(method) });
      tokenCounter += 1;
      return {
        method: String(method),
        tokenCounter,
      } as unknown as RpcMeasurementToken;
    },
    recordRpcSucceeded: (token, responseBytes) =>
      succeeded.push({ responseBytes, token }),
    recordRpcTimedOut: (token, responseBytes) =>
      timedOut.push({ responseBytes, token }),
    recordWebSocketPush: (input) => pushes.push(input),
    revalidateSession: () => true,
    toErrorPayload: (error) => ({
      error: error instanceof Error ? error.message : String(error),
    }),
    ...overrides,
  };

  return {
    canceled,
    failed,
    logger,
    options,
    pushes,
    started,
    succeeded,
    timedOut,
  };
}

describe("RPC transport", () => {
  test("handles request success and failure without server bootstrap", async () => {
    const harness = createHarness({
      listProjects: async () => [{ id: 1, name: "Demo" }],
      openProject: async () => {
        throw new Error("boom");
      },
    });
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    transport.open(socket as never);

    transport.handleMessage(socket as never, request(1, "listProjects"));
    await waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(decodeJsonSend(sentAt(socket, 0))).toMatchObject({
      id: 1,
      ok: true,
      result: [{ id: 1, name: "Demo" }],
      type: "response",
    });
    expect(harness.succeeded).toHaveLength(1);

    transport.handleMessage(socket as never, request(2, "openProject"));
    await waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(decodeJsonSend(sentAt(socket, 1))).toMatchObject({
      error: "boom",
      id: 2,
      ok: false,
      type: "response",
    });
    expect(harness.failed).toHaveLength(1);
  });

  test("responds to unknown methods and drops invalid frames before dispatch", async () => {
    const harness = createHarness();
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    transport.open(socket as never);

    transport.handleMessage(socket as never, request(3, "missingMethod"));
    await waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(decodeJsonSend(sentAt(socket, 0))).toMatchObject({
      error: "Unknown RPC method",
      id: 3,
      ok: false,
      type: "response",
    });
    expect(harness.started).toHaveLength(0);
    expect(harness.failed).toHaveLength(0);

    transport.handleMessage(
      socket as never,
      Buffer.from(encoder.encode("not json")) as never,
    );
    await Bun.sleep(15);
    expect(socket.sent).toHaveLength(1);
    expect(harness.logger.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Invalid RPC client message JSON" }),
      ]),
    );
    expect(harness.started).toHaveLength(0);
    expect(harness.failed).toHaveLength(0);
    expect(harness.canceled).toHaveLength(0);
    expect(harness.succeeded).toHaveLength(0);
    expect(harness.timedOut).toHaveLength(0);
  });

  test("closes clients on pre-parse budget failure", async () => {
    const harness = createHarness(undefined, {
      consumePreParseBudget: () => ({ allowed: false }),
    });
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    transport.open(socket as never);

    transport.handleMessage(socket as never, request(4));
    await waitFor(() => expect(socket.closed).toHaveLength(1));
    expect(socket.closed[0]).toEqual({
      code: 1008,
      reason: "RPC websocket message rate exceeded.",
    });
    expect(transport.hasClients()).toBeFalse();
    expect(socket.sent).toHaveLength(0);
  });

  test("enforces pending request caps and cleans up completed requests", async () => {
    const deferred = createDeferred<unknown>();
    const harness = createHarness(
      {
        listProjects: async () => deferred.promise,
      },
      {
        maxPendingRequests: 1,
        maxPendingRequestsPerClient: 1,
      },
    );
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    transport.open(socket as never);

    transport.handleMessage(socket as never, request(5));
    await waitFor(() => expect(transport.getPendingRequestCount()).toBe(1));
    const backlogSnapshot = transport.getHealthSnapshot();
    expect(backlogSnapshot).toEqual({
      clientCount: 1,
      pendingRequests: { current: 1, peak: 1 },
    });

    transport.handleMessage(socket as never, request(6));
    await waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(decodeJsonSend(sentAt(socket, 0))).toMatchObject({
      error: "RPC server is busy. Please retry shortly.",
      id: 6,
      ok: false,
      type: "response",
    });
    expect(harness.logger.warnings.at(-1)).toMatchObject({
      error: "Too many pending RPC requests for this connection (1/1).",
      requestId: 6,
    });

    deferred.resolve([]);
    await waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(transport.getPendingRequestCount()).toBe(0);
    expect(transport.getPeakPendingRequestCount()).toBe(1);
    expect(transport.getHealthSnapshot()).toEqual({
      clientCount: 1,
      pendingRequests: { current: 0, peak: 1 },
    });
    expect(backlogSnapshot.pendingRequests.current).toBe(1);
  });

  test("cancels pending requests without sending stale responses", async () => {
    const harness = createHarness({
      listProjects: async (_params: unknown, context: RpcRequestContext) => {
        await new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason),
            { once: true },
          );
        });
        return [];
      },
    });
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    transport.open(socket as never);

    transport.handleMessage(socket as never, request(7));
    await waitFor(() => expect(transport.getPendingRequestCount()).toBe(1));
    transport.handleMessage(socket as never, cancel(7));
    await waitFor(() => expect(transport.getPendingRequestCount()).toBe(0));

    expect(socket.sent).toHaveLength(0);
    expect(harness.canceled).toHaveLength(1);
  });

  test("closes sockets when response send reports backpressure", async () => {
    const harness = createHarness();
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    socket.sendResults.push(-1);
    transport.open(socket as never);

    transport.handleMessage(socket as never, request(8));
    await waitFor(() => expect(socket.closed).toHaveLength(1));
    expect(socket.closed[0]).toEqual({
      code: 1013,
      reason: "RPC websocket send backpressure.",
    });
    expect(transport.hasClients()).toBeFalse();
    expect(harness.failed).toHaveLength(1);
  });

  test("encodes large server pushes without JSON stringifying", async () => {
    const harness = createHarness(undefined, {
      maxUncompressedServerBinaryFrameBytes: 32,
    });
    const transport = createRpcTransport(harness.options);
    const socket = createFakeSocket();
    transport.open(socket as never);

    const message = { reason: "x".repeat(64 * 1024), type: "reload" } as const;
    const delivered = await transport.publish(message);

    expect(delivered).toBe(1);
    const raw = sentAt(socket, 0);
    expect(typeof raw).toBe("object");
    expect(isRpcBinaryFrame(raw)).toBeTrue();
    await expect(decodeRpcBinaryFrame(raw as Uint8Array)).resolves.toEqual(
      message,
    );
  });

  test("targets session push fanout and closes session clients", async () => {
    const harness = createHarness();
    const transport = createRpcTransport(harness.options);
    const sessionAOne = createFakeSocket({ sessionId: "session-a", userId: 1 });
    const sessionATwo = createFakeSocket({ sessionId: "session-a", userId: 2 });
    const sessionB = createFakeSocket({ sessionId: "session-b", userId: 1 });
    transport.open(sessionAOne as never);
    transport.open(sessionATwo as never);
    transport.open(sessionB as never);

    expect(
      transport.hasPublishTargets({ kind: "session", sessionId: "session-a" }),
    ).toBeTrue();
    const delivered = await transport.publish(
      { reason: "test", type: "reload" },
      { kind: "session", sessionId: "session-a" },
    );

    expect(delivered).toBe(2);
    expect(sessionAOne.sent).toHaveLength(1);
    expect(sessionATwo.sent).toHaveLength(1);
    expect(sessionB.sent).toHaveLength(0);
    expect(harness.pushes.at(-1)).toMatchObject({
      deliveredClients: 2,
      droppedClients: 0,
      type: "reload",
    });

    expect(transport.closeSession("session-a", "signed out")).toBe(2);
    expect(sessionAOne.closed).toEqual([{ code: 1008, reason: "signed out" }]);
    expect(sessionATwo.closed).toEqual([{ code: 1008, reason: "signed out" }]);
    expect(sessionB.closed).toHaveLength(0);
    expect(
      transport.hasPublishTargets({ kind: "session", sessionId: "session-a" }),
    ).toBeFalse();
    expect(transport.getClientCount()).toBe(1);
  });

  test("cleans up session state and pending requests before closing sockets", async () => {
    const harness = createHarness({
      listProjects: async (_params: unknown, context: RpcRequestContext) => {
        await new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason),
            { once: true },
          );
        });
        return [];
      },
    });
    const transport = createRpcTransport(harness.options);
    const sessionSocket = createFakeSocket({ sessionId: "session-close" });
    const closeSnapshots: Array<{
      clientCount: number;
      hasSessionTargets: boolean;
      pendingRequestCount: number;
    }> = [];
    sessionSocket.onClose = () => {
      closeSnapshots.push({
        clientCount: transport.getClientCount(),
        hasSessionTargets: transport.hasPublishTargets({
          kind: "session",
          sessionId: "session-close",
        }),
        pendingRequestCount: transport.getPendingRequestCount(),
      });
    };
    transport.open(sessionSocket as never);
    transport.handleMessage(sessionSocket as never, request(9));
    await waitFor(() => expect(transport.getPendingRequestCount()).toBe(1));

    expect(transport.closeSession("session-close", "session revoked")).toBe(1);

    expect(closeSnapshots).toEqual([
      {
        clientCount: 0,
        hasSessionTargets: false,
        pendingRequestCount: 0,
      },
    ]);
    expect(sessionSocket.closed).toEqual([
      { code: 1008, reason: "session revoked" },
    ]);
    await waitFor(() => expect(harness.canceled).toHaveLength(1));
  });
});
