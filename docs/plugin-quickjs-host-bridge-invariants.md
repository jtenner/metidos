# Plugin QuickJS host bridge invariants

This note characterizes the shared QuickJS host bridge in `src/bun/plugin/quickjs-host-bridge.ts` and the capability installers that consume it from `src/bun/plugin/quickjs-runtime.ts`. It describes what the shared seam preserves, where maintainers should add bridge-level regression coverage, and which behaviours remain capability-specific.

## Shared bridge mechanics

Most asynchronous host functions now route through `installQuickJsHostOperation(...)`, which centralizes this bridge pattern:

1. Install a QuickJS global with `context.newFunction(...)`, expose it with `context.setProp(context.global, name, handle)`, then dispose the installer handle.
2. Dump QuickJS handles into host JavaScript values with `context.dump(...)` before invoking backend-owned capability logic.
3. Create a QuickJS promise with `context.newPromise()` and return `promise.handle` to guest code.
4. Run the host operation through `Promise.resolve().then(...)` so synchronous throws and rejected host promises are normalized through the same error-payload path.
5. Serialize successful host results as JSON, usually `{ ok: true, result }`.
6. Serialize failures with `pluginHostErrorPayload(...)`, preserving a string `error.code` when present and preserving `error.name` when the thrown value is an `Error`.
7. Resolve the QuickJS promise with `context.newString(payload)`, then dispose the temporary string handle immediately after `promise.resolve(handle)`.
8. Attach `promise.settled.then(() => drainHostPendingJobs(input))` so resolved host promises advance queued QuickJS jobs before the outer callback promise waits on `resolveQuickJsPromise(...)`.

These mechanics are covered by focused bridge tests in `src/bun/plugin/quickjs-host-bridge.test.ts` for successful resolution, thrown errors, rejected promises, structured error-code propagation, unavailable host-operation errors, capability-specific success serializers, pending-job drain behavior, and temporary handle disposal. Capability installers should only describe the QuickJS global name, argument decoding, host operation, success result shape, error fallback name, and any capability-specific transforms.

## Error payload invariants

`pluginHostErrorPayload(...)` returns:

```json
{
  "ok": false,
  "error": {
    "code": "only when the thrown value has a string code",
    "message": "Error.message or String(error)",
    "name": "Error.name or the capability fallback name"
  }
}
```

Guest-side wrappers in `plugin-api-runtime.ts` convert that payload into an `Error` with `name`, `message`, and `code`. Extraction must preserve these names because existing plugin code can branch on them.

Current fallback names:

| Host global | Success payload | Fallback error name | Notes |
| --- | --- | --- | --- |
| `__metidosHostStructuredDataOperation` | `{ result }` | `PluginStructuredDataError` | Synchronous outlier; no `ok` field and no pending-job drain. |
| `__metidosHostFetch` | `{ ok: true, response }` | `PluginFetchError` | Uses `pluginFetchHostPayload(...)`, currently an alias for shared error payloads. |
| `__metidosHostWebSocketOperation` | `{ ok: true, result }` | `PluginWebSocketError` | No second fallback catch after payload resolution. |
| `__metidosHostFsOperation` | `{ ok: true, result }` | `PluginFsError` | Wraps binary host results before JSON serialization. |
| `__metidosHostCalendarEventsOperation` | `{ ok: true, result }` | `PluginCalendarEventsError` | Validates operation and permissions before calling the host API. |
| `__metidosHostTerminalOperation` | `{ ok: true, result }` | `PluginTerminalError` | Validates operation and permissions before calling the host API. |
| `__metidosHostSqliteOperation` | `{ ok: true, result }` | `PluginSqliteError` | Allows only `sqlite.all`, `sqlite.get`, and `sqlite.run`. |
| `__metidosHostLanceDbOperation` | `{ ok: true, result }` | `PluginLanceDbError` | Casts operation to the LanceDB operation type; no installer-level allow-list today. |
| `__metidosHostEmbeddingsOperation` | `{ ok: true, result }` | `PluginEmbeddingsError` | Request has no operation argument. |
| `__metidosHostLog` | `{ ok: true, result }` | `PluginLogError` | Guest wrapper discards successful result. |
| `__metidosHostNotificationSend` | `{ ok: true, result }` | `PluginNotificationError` | Validates permission and normalizes request before calling the sender. |

Some installers (`fetch`, `calendar/events`, `terminal`, `sqlite`, `log`, and `notifications`) include a second `.catch(...)` after QuickJS string creation and promise resolution. Others (`websocket`, `fs`, `lancedb`, and `embeddings`) do not. That difference should be treated as accidental bridge drift unless a follow-up decision proves the extra fallback catch is needed. The extraction task should either standardize it or add tests that justify preserving the difference.

## Host metadata invariants

Callback-scoped host APIs ignore the guest-provided metadata argument and use `currentPluginQuickJsHostMetadata(input)` from the runtime instead. This prevents plugins from forging callback context, owner, project, thread, worktree, or deadline metadata through direct calls to globals such as `__metidosHostFsOperation(...)`.

Host functions using trusted runtime metadata today:

- WebSocket
- filesystem
- calendar/events
- terminal
- SQLite
- LanceDB
- embeddings
- log
- notifications

Fetch and structured data do not use callback metadata. Fetch is governed by network policy in `executePluginFetch(...)`; structured data is a synchronous pure helper.

## Byte payload invariants

Binary payload handling is intentionally asymmetric:

- Guest-to-host fetch and embedding inputs are wrapped by `plugin-api-runtime.ts` as `{ __metidosBytesBase64 }` before crossing into the host bridge.
- Host-to-guest filesystem results are wrapped by `pluginBytesHostPayload(...)` when the host returns `Uint8Array` or `ArrayBuffer`.
- Guest wrappers decode `{ __metidosBytesBase64 }` back into `Uint8Array` through `__metidosMaybeBytes(...)`.

The next bridge seam should keep binary wrapping explicit per capability. Do not apply blanket byte wrapping to all capability results without checking guest wrapper expectations.

## Capability-specific behaviour to keep out of the shared seam

The shared host-operation Module should not absorb capability policy. These behaviours belong near capability semantics:

- Fetch network allow-list, HTTPS, and private-network checks are inside `executePluginFetch(...)`.
- Calendar/events operation validation and permission checks use `isPluginCalendarEventsOperation(...)` and `assertPluginCalendarEventsPermission(...)`.
- Terminal operation validation and permission checks use `isPluginTerminalOperation(...)` and `assertPluginTerminalPermission(...)`.
- SQLite currently performs a local allow-list for `sqlite.all`, `sqlite.get`, and `sqlite.run`.
- Notification sending checks `notification:send` and normalizes requests with `normalizePluginNotificationRequest(...)`.
- Structured data dispatches TOML, YAML, and XML operations synchronously and has a different guest payload contract.

## Bridge seam shape

`installQuickJsHostOperation(...)` lets each installer declare:

- global function name
- argument decoding from `QuickJSHandle[]`
- host operation callback, including optional trusted metadata inclusion
- success-payload serializer (`result` by default, or fetch's `response` shape)
- error fallback name
- optional result transform, such as filesystem byte wrapping

The synchronous structured-data contract intentionally remains outside the async bridge because its guest payload does not use the `{ ok: true }` envelope and it does not drain pending jobs. New shared QuickJS host-call mechanics should be tested in `quickjs-host-bridge.test.ts`; capability suites should stay focused on capability policy, request normalization, permissions, and public Plugin System v1 behavior.
