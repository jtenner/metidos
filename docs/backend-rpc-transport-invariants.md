# Backend RPC transport invariants

This note maps the current Mainview RPC WebSocket transport in `src/bun/index.ts` before extracting a dedicated transport module. The goal is to keep server bootstrap responsible for HTTP routing and procedure wiring while moving request lifecycle, client registries, frame encoding, cancellation, and push publication behind a focused seam.

## Current lifecycle

1. `fetch()` handles `/rpc` before ordinary HTTP routes.
2. The upgrade path rejects unsupported WebSocket subprotocol headers and requires an allowed browser origin.
3. `authorizeRpcWebSocketUpgrade()` validates and consumes the WebSocket ticket. The server then resolves the authenticated session with `touch: true` and stores only `RpcWebSocketSocketData` on the socket.
4. `websocket.open()` distinguishes terminal sockets from RPC sockets and registers RPC sockets in the global client set plus the session index.
5. `websocket.message()` revalidates the socket session before doing any transport work. Failed revalidation closes the socket with policy code `1008`, unregisters it, and aborts in-flight work.
6. Each accepted message is parsed as exactly one RPC request or one cancel packet. Request handlers receive `{ auth, signal, priority, timeoutMs }`.
7. Successful, failed, timed-out, and uncaught handler outcomes are encoded as response frames and sent back on the same socket.
8. `websocket.close()`, explicit session/user close helpers, oversized payload rejection, abuse-control rejection, send backpressure, and unhandled message task failures all unregister the socket and abort all pending requests for that socket.

## Invariants to preserve

- **Upgrade/auth boundary:** HTTP route code owns origin checks, subprotocol rejection, ticket consumption, and initial session resolution. The transport seam should receive an already-authenticated socket data object, not raw cookies.
- **Session revalidation:** every non-terminal RPC message revalidates the current socket session before payload parsing, request registration, rate limiting, or handler execution. Revalidation may refresh `ws.data`; session-index maintenance must follow any session ID change.
- **Client registries:** the global `rpcClients` set supports all-client broadcasts and health snapshots; the session index supports session-scoped pushes. The index must be refreshed when `ws.data.sessionId` changes and removed before pending work is aborted.
- **Pending budgets:** per-client pending requests are capped by `MAX_PENDING_RPC_REQUESTS_PER_CLIENT`; global pending requests are capped by `MAX_PENDING_RPC_REQUESTS`. Capacity is checked before a request is inserted, and the global count is incremented only after insertion.
- **Duplicate request IDs:** a second in-flight request with the same ID on one socket is rejected before creating a new abort controller.
- **Rate limiting:** the per-socket token bucket runs after request parsing and before runtime measurement starts. Cancel packets do not consume handler capacity or runtime measurements.
- **Cancellation:** cancel packets mark the pending request as client-canceled and abort its controller. Client-canceled work does not emit an RPC response. Socket-level cleanup aborts every pending request, clears timers, decrements the global pending count by the map size, clears the map, and deletes the weak-map entry.
- **Timeouts:** optional request timeouts create a `TimeoutError` DOMException on the request signal. Timeout responses use the normalized timeout message and are recorded separately from ordinary failures.
- **Frame encoding:** server responses and pushes use `encodeRpcBinaryFrame(..., { compress: false })` when the encoded frame is at most `MAX_UNCOMPRESSED_SERVER_BINARY_FRAME_BYTES`; larger server frames fall back to JSON to avoid compression overhead. Client binary frames are decoded without compressed-frame support and with `MAX_RPC_WEBSOCKET_MESSAGE_BYTES` as the decoded body cap.
- **Payload and abuse gates:** Bun's `maxPayloadLength`, the explicit `rawSocketMessageByteLength()` check, and `consumeRpcWebSocketPreParseBudget()` all remain active. Oversized messages close with `1009`; pre-parse budget abuse closes with `1008`.
- **Backpressure:** `client.send()` status `-1` is backpressure and `0` is dropped. Both unregister the client; backpressure/dropped sends close with `1013` when possible. Send failures on responses and pushes are not ignored because unregistering is the cleanup path.
- **Push publication:** push helpers build each raw frame lazily once per publish call, deliver only to currently registered clients, and record `recordWebSocketPush()` with delivered count, dropped count, payload bytes, and message type. Session-scoped pushes use the session index rather than filtering the global set repeatedly.
- **Runtime stats:** request measurements are started after rate-limit acceptance and record inbound bytes. Successful responses, handler failures, timeouts, and client cancellations must continue to flow through `recordRpcStarted()`, `recordRpcSucceeded()`, `recordRpcFailed()`, `recordRpcTimedOut()`, and `recordRpcCanceled()`. Push metrics must continue through `recordWebSocketPush()`.
- **Health hooks:** overload monitoring depends on `pendingRpcRequestCount`, `peakPendingRpcRequestCount`, `rpcClients.size`, `getProcedureRuntimeStats()`, `getRuntimeStatsSummary()`, and push/request stats. Any extraction must expose these values without making bootstrap reach into transport internals.

## Proposed transport seam

Keep bootstrap-owned responsibilities explicit:

- `/rpc` route filtering, origin checks, auth ticket consumption, initial `resolveSession()`, and `server.upgrade()` remain in `index.ts`.
- Procedure registration remains a handler map in bootstrap or a procedure module. The transport calls handlers through a typed map and does not know individual method semantics.
- Domain event producers call a small publisher API rather than individual global broadcast helpers.

A narrow interface is enough for the extraction:

```ts
type RpcTransport = {
  open(socket: RpcSocket): void;
  close(socket: RpcSocket, reason: string): void;
  handleMessage(socket: RpcSocket, rawMessage: string | Buffer): void;
  closeSession(sessionId: string, reason: string): void;
  closeUser(userId: number, reason: string): void;
  publish(message: RpcSocketMessage, options?: { sessionId?: string | null }): void;
  publishLazy(type: string, buildRaw: () => Promise<string | Uint8Array>, scope?: RpcPublishScope): Promise<number>;
  getHealthSnapshot(): {
    clientCount: number;
    pendingRequests: { current: number; peak: number };
  };
};
```

Constructor dependencies should be dependency-injected so the module stays testable:

- handler map: `RpcRequestHandlerMap`
- session revalidator: `(socketData, options) => RevalidationResult`
- logger and clock
- binary frame codec and payload constants
- runtime stats callbacks
- overload/pending counter reader

This keeps auth/session data, request handling, and push publication explicit while allowing tests to exercise cancellation, backpressure, session-close cleanup, frame encoding, and stats recording without starting `Bun.serve()`.

## Extraction guardrails

- Extract tests around the current helpers before moving behavior when a behavior is not already covered (`classifyRpcWebSocketSendStatus`, request cleanup, cancellation/no-response, session-index refresh, push metrics).
- Keep close/unregister idempotent: all close paths must tolerate sockets that are already unregistered or closing.
- Preserve terminal WebSocket handling as a separate path; it shares the Bun `websocket` callbacks but should not be folded into the Mainview RPC transport seam.
