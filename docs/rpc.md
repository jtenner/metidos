# RPC

Metidos uses a typed WebSocket RPC layer between Mainview and Backend. The RPC contract is internal to the application but is treated as a carefully maintained boundary because it carries auth, project/worktree state, Thread messages, plugin administration, cron mutations, and runtime status.

## Source of truth

- `src/bun/rpc-schema.ts` is the compatibility barrel for shared request and response types.
- Focused schema modules live under `src/bun/rpc-schema/`.
- Transport behavior lives in `src/bun/rpc-transport.ts`.
- Procedure implementations are registered from Backend modules such as `project-procedures.ts` and focused RPC handler modules.

When changing an RPC payload, update Backend handlers, Mainview callers, tests, and docs together.

## Connection lifecycle

1. Browser signs in through Local Auth.
2. Browser obtains a short-lived WebSocket Ticket from the auth flow.
3. Browser opens `/rpc` from an allowed origin.
4. Backend rejects unsupported WebSocket subprotocols and disallowed origins.
5. Backend consumes the ticket and resolves the authenticated Session.
6. Each non-terminal RPC message revalidates the socket Session before handler execution.
7. Backend sends response frames and push messages over the same socket.
8. Logout, session revocation, invalid tickets, backpressure, oversized frames, and policy failures close the socket and abort pending work.

Terminal sockets share Bun websocket callbacks but follow a separate terminal-auth path and should not be folded into ordinary Mainview RPC behavior.

## Request expectations

RPC requests should be:

- typed by the shared schema,
- bounded in payload size,
- associated with a request id,
- optionally tagged with priority,
- optionally cancelable or timed out,
- validated by the Backend before touching durable state,
- authorized using the current Session and, where needed, step-up state.

Backend handlers receive an auth context plus an `AbortSignal`. Long-running work should observe cancellation when practical.

## Response expectations

Responses should be:

- shaped by shared TypeScript types,
- free of raw secrets,
- actionable when returning errors,
- safe to show in Mainview without leaking sensitive local paths,
- stable enough that Mainview can handle loading, error, stale, and retry states.

Large server responses may use the transport's binary frame encoding or fallback JSON path according to current transport thresholds. Callers should not rely on a specific frame encoding.

## Push messages

Backend pushes update Mainview after server-side events such as:

- thread message/status changes,
- project/worktree invalidations,
- cron list changes,
- plugin inventory or lifecycle changes,
- notifications,
- Pi extension UI prompts and status events,
- terminal state changes.

Push producers should publish the smallest useful invalidation or state update. Mainview should refresh the affected slice rather than reloading unrelated workspaces.

## Auth and authorization

Authentication proves the browser has a valid Local Auth Session. Authorization is still checked per operation.

Examples:

- Project and Worktree operations must respect Workspace Path Scope.
- Plugin approvals require Local Operator authority and recent step-up authentication.
- Unsafe Mode mutations require explicit unsafe permission flow.
- Cron and child-thread creation must respect selected Access Control.
- Plugin access groups affect visible plugin tools but do not grant manifest host permissions.

## Error handling

Errors should distinguish:

- unauthenticated or expired sessions,
- authorization failures,
- validation failures,
- missing project/worktree/thread/provider/plugin resources,
- unavailable provider-qualified models,
- plugin lifecycle or approval failures,
- timeout/cancel behavior,
- server overload or backpressure.

Error text should include next steps when possible, for example "reopen the worktree", "review plugin changes", "configure a provider", or "sign in again". Do not include API keys, recovery codes, session ids, WebSocket tickets, unredacted `.env` values, or sensitive host paths.

## Cancellation and timeouts

The transport accepts explicit cancel packets and also creates timeout aborts for requests with timeout options. Canceled client work should not emit a stale response to the client. Timeouts should surface as normalized timeout responses and record timeout diagnostics separately from ordinary failures.

## Backpressure and abuse controls

The transport enforces:

- per-client pending request caps,
- global pending request caps,
- duplicate request id rejection,
- message size limits,
- pre-parse budget controls,
- rate limiting,
- backpressure cleanup.

These controls protect the local runtime from runaway browser loops or malformed clients.

## Compatibility guidance

- Preserve exported type names unless performing a coordinated migration.
- Keep the `src/bun/rpc-schema.ts` barrel stable while imports remain widespread.
- Add narrow tests around behavior before refactoring transport or schema ownership.
- Prefer adding focused schema modules over growing aggregate files.
- Avoid public documentation that encourages third-party clients to depend on internal RPC shapes until the API is explicitly stabilized.

See also [Backend RPC transport invariants](./backend-rpc-transport-invariants.md) and [RPC schema migration map](./rpc-schema-migration-map.md).
