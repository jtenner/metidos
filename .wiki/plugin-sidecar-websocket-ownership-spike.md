# Plugin Sidecar WebSocket Ownership Spike

Sidecar-owned plugin WebSocket connections are feasible but should not be the next implementation slice. The current maincar-owned registry already centralizes permission checks, network allowlist enforcement, private-network safeguards, connection/message/queue limits, receive timeout behavior, and lifecycle cleanup. Moving the registry into the sidecar would remove one host-operation round trip from each connect/send/receive/state/close call, but it would also duplicate or relocate security-sensitive network policy code and make maincar-driven teardown more indirect.

## Current State

Observed WebSocket flow:

1. JavaScript plugin code calls the runtime client in `src/bun/plugin/plugin-api-runtime.ts`, which forwards operations through `globalThis.__metidosHostWebSocketOperation`.
2. `src/bun/plugin/quickjs-runtime.ts` and `src/bun/plugin/python-runtime.ts` expose the WebSocket bridge through their runtime APIs.
3. `src/bun/plugin/sidecar-main.ts` maps `webSocket` runtime calls to `requestHostOperation({ operation, params })` without passing startup permissions because the maincar registry owns authorization.
4. `src/bun/plugin/sidecar-manager.ts` receives host-operation frames and calls `executePluginWebSocketOperation()` with the session's `PluginWebSocketRegistry`.
5. `src/bun/plugin/websocket.ts` owns the registry, connection records, pending receives, queues, limits, policy checks, and `closeAll()` cleanup.

## Security Constraints To Preserve

Observed constraints in `src/bun/plugin/websocket.ts`:

- `network:websocket` permission is required before connecting.
- `network.webSocketAllow` must be non-empty and compiles through `compilePluginNetworkAllowlist()` with WebSocket-specific defaults.
- `network.enforceHttps` remains effective through allowlist compilation.
- Private-network protection is enforced through `assertSafeOutboundHttpUrl()` unless the sidecar session was started with unsafe private-network allowance.
- Blocked request headers cannot be set by plugins.
- Connection, message-byte, queued-message, connect-timeout, and receive-timeout limits are bounded.
- Diagnostic URLs are sanitized before errors include them.

A sidecar-owned implementation would need the same manifest network summary, permissions, limits, private-network unsafe flag, and hostname resolver behavior available inside the sidecar before any socket opens.

## Lifecycle Hooks To Preserve

Observed maincar lifecycle cleanup paths call `session.webSockets.closeAll()` when:

- a session stops normally;
- a session is removed during reset/disable-style cleanup;
- the sidecar process exits while the manager still owns the session;
- startup fails after a session has been installed.

`closeAll()` currently closes sockets best-effort, rejects pending receives with a shutdown error, and clears the registry. If the registry moves into the sidecar, these hooks need an explicit shutdown/control message and a bounded fallback when the sidecar is unresponsive. Sidecar crash cleanup would become operating-system process cleanup rather than maincar registry cleanup, which is probably acceptable for socket handles but weaker for diagnostics and pending receive error shape.

## Options

### Option A: Keep maincar-owned registry

Recommended for now. It preserves one authoritative policy and cleanup surface. The cost is a host-operation round trip for every WebSocket operation.

### Option B: Move the whole registry into sidecar

Feasible after extracting reusable WebSocket policy code and giving sidecar startup a complete immutable policy snapshot. This reduces per-operation RPC traffic but increases security review scope and requires new control-plane shutdown semantics.

### Option C: Hybrid ownership

Keep connection authorization and initial connect in maincar, then transfer a sidecar-local handle for send/receive. This is not attractive in the current architecture because JavaScript `WebSocket` handles are process-local and cannot be transferred cleanly across the maincar/sidecar boundary. It would create two ownership models without removing enough complexity.

## Recommendation

Keep WebSocket connections maincar-owned until measurement shows WebSocket host-operation traffic is a significant bottleneck. If later measurements justify the work, implement Option B only after extracting shared policy helpers and adding sidecar lifecycle control messages.

## Diagnostics Plan If Revisited

- Count WebSocket host-operation volume and latency by operation before changing ownership.
- Preserve existing `PluginWebSocketError` codes and sanitized messages.
- Add sidecar shutdown-ack diagnostics if close control messages are introduced.
- Record socket cleanup outcomes when the maincar requests plugin disable/reset/shutdown.

## Estimated Benefit

Expected performance benefit is moderate and workload-dependent. Chatty receive/send loops would avoid repeated maincar RPC frames, but connection setup and low-frequency WebSocket usage would see little improvement. The security and lifecycle cost is higher than the likely benefit without current measurements proving this path hot.

## Decision

Do not start sidecar-owned WebSocket implementation now. Leave this as a measured follow-up candidate behind instrumentation or a future task that first extracts and shares WebSocket policy enforcement between maincar and sidecar runtimes.
