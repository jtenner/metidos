# Codex SDK Capabilities (for Bun + Browser Integration)

See also: [`docs/codex-context-management.md`](./codex-context-management.md) for a focused note on how the SDK handles context, thread persistence, and where Responses API compaction fits.

## What this SDK is

The `@openai/codex-sdk` is a TypeScript wrapper around the `codex` CLI (`@openai/codex`).
It spawns the CLI process and exchanges JSONL events over stdin/stdout.

In the SDK, **session = `Thread`**.
A thread is a conversation history that can be resumed across process lifecycles.

---

## Core classes and methods

### `new Codex(options?)`
Creates a client for the local CLI process.

#### `Codex` options

- `apiKey` — API key to use for the CLI.
- `baseUrl` — override API base URL.
- `codexPathOverride` — custom CLI path.
- `env` — full environment object passed to CLI process.
- `config` — object converted to repeated `--config key=value` CLI flags.

### Jolt sidecar MCP

In this repo, each `Codex` client attaches the local `jolt` MCP sidecar through `config.mcp_servers`.
The backend passes the current authenticated session id as `JOLT_SESSION_ID` into that sidecar. The sidecar calls `POST /auth/ws-ticket` on `JOLT_RPC_HTTP_ORIGIN` with `jolt_session=<session id>` to get a short-lived ticket, then opens `/rpc?ticket=...` with both the ticket and `Cookie: jolt_session=...`.

If no session id is available, the sidecar falls back to a direct websocket connection to `JOLT_RPC_URL` without ticketed auth.

The sidecar exposes these Jolt control tools:

- `modify_thread`
- `new_thread`
- `run_untrusted_js`
  - Executes untrusted JavaScript or TypeScript in a vm2 NodeVM sandbox.
  - Redirects console output into the MCP result, exposes a frozen Bun sandbox, and limits fs writes to the current worktree.
  - Accepts a `timeoutMs` override in milliseconds and defaults to 60 seconds when omitted.

Guidance:

- treat `modify_thread` as a safe metadata update
- use `new_thread` sparingly
- use `new_thread.autoStart` to ask the UI for permission before creating a separate thread; when `unsafeMode` is true, the thread starts immediately instead of waiting for the popup
- let `modify_thread` run liberally whenever a better title, a short summary, or pinning and unpinning would improve scanability
- use the optional `summary` field on `modify_thread` for a short desktop hover description when it adds useful context
- use the optional `pinned` field on `modify_thread` to pin important threads and unpin them when that organization no longer helps
- pass `threadId` explicitly for thread-scoped tools; the bound thread id is exposed in tool metadata
- attach the sidecar at client construction so every thread from that `Codex` instance can reach it

### `codex.startThread(options?)`
Starts a new thread object for a fresh conversation.

### `codex.resumeThread(id, options?)`
Restores an existing thread from a previously persisted ID (`~/.codex/sessions`).

### `thread.run(input, turnOptions?)`
- Sends input and waits until the turn completes.
- Returns `{ items, finalResponse, usage }`.
- Good for simple request/response flows.

### `thread.runStreamed(input, turnOptions?)`
- Sends input and returns `{ events }`, where `events` is an async generator.
- Emits intermediate progress and can update UI in real time.

---

## Thread/session model

- A **thread persists conversation state**.
- On first event from a run/stream, a `thread.started` event includes `thread_id`.
- `thread.id` becomes available after first turn starts.
- You can persist `thread.id` and resume later via `resumeThread(savedId)`.
- Threads are serialized on disk by the underlying CLI (`~/.codex/sessions`).

Think of it like:
- Browser action → Bun receives user turn → thread run → stream events → UI updates.
- On restart: restore stored `thread_id` and call `resumeThread(savedId)`.

---

## Input types

`run`/`runStreamed` accept:

- `string` input (plain text prompt)
- `UserInput[]` array with:
  - `{ type: "text", text }`
  - `{ type: "local_image", path }`

---

## Turn/result output

`run()` returns a `Turn`:

- `finalResponse` — final assistant text response.
- `items` — completed thread items for that turn.
- `usage` — token usage (or `null`).

`runStreamed()` returns:

- `{ events }` async generator of `ThreadEvent`.
- You can render streaming progress and still get final status from `turn.completed`.

---

## Streaming events you can handle

### Stream-level/top-level events

- `thread.started` 
- `turn.started`
- `item.started`
- `item.updated`
- `item.completed`
- `turn.completed`
- `turn.failed`
- `error`

### Item types in item events

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`
- `web_search`
- `todo_list`
- `error`

### `file_change` item details

- `changes`: list with `{ path, kind }` where `kind` is `add | delete | update`.
- `status`: `completed | failed`.

### `command_execution` item details

- `command`, `aggregated_output`, `exit_code?`, `status`.
- Status is `in_progress | completed | failed`.

---

## Error/cancel behavior

- `turn.failed` indicates turn failure with an error payload.
- `error` event is a fatal stream error.
- `turnOptions.signal` can be passed as `AbortSignal` to cancel work in flight.

---

## Structured output

Per turn, pass `turnOptions.outputSchema` to force JSON output matching your schema.
Common use:
- object schema for UI contracts
- strict response parsing with deterministic downstream handling

---

## Thread options

When creating/resuming a thread, you can set:

- `model`
- `sandboxMode` (`read-only` 
  `| workspace-write` 
  `| danger-full-access`)
- `workingDirectory`
- `skipGitRepoCheck` (useful for non-git roots)
- `modelReasoningEffort` (`minimal` `| low` `| medium` `| high` `| xhigh`)
- `networkAccessEnabled`
- `webSearchMode` (`disabled` `| cached` `| live`)
- `webSearchEnabled`
- `approvalPolicy` (`never` `| on-request` `| on-failure` `| untrusted`)
- `additionalDirectories`

---

## Bun layer design pattern for Browser↔Window sessions

### 1) One thread per user session

- On app start, load persisted `threadId` if available.
- If missing: `codex.startThread({ ...threadOptions })`.
- If present: `codex.resumeThread(threadId, { ...threadOptions })`.

### 2) Route browser events into Bun

- Browser sends:
  - `session.create`
  - `session.resume`
  - `turn.send` (input payload)
  - `turn.cancel`
- Bun maps each `turn.send` to `runStreamed(...)` for incremental output.

### 3) Stream events to the window

- As events arrive from `runStreamed`, forward each through IPC/websocket:
  - emit `thread.started`, `turn.started`, `item.*`, `turn.completed`, `error`.
- For non-stream use, keep parity by sending a synthetic event after `run()` returns.

### 4) State persistence

- When `thread.started` arrives, store `thread_id`:
  - local DB / secure store / app state.
- On resume, send that ID back to Bun and reconstruct with `resumeThread`.

### 5) Cleanup and trust boundaries

- Keep one active streaming turn per session.
- Use abort signal on user cancel or navigation.
- Decide approval model and sandbox policy based on your app trust level.

---

## Practical rules for implementation

- For simple tasks, use `run()`.
- For live UI (progress, files changed, command output), use `runStreamed()`.
- Always persist `thread.id` once available.
- Resume with `resumeThread(id)` whenever continuity matters.
- Keep CLI auth/config/env in Bun only, not in browser payloads.

---

## Minimal reference example

```ts
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({
  env: {
    PATH: "/usr/local/bin",
  },
  config: {
    show_raw_agent_reasoning: true,
    sandbox_workspace_write: { network_access: true },
  },
});

const thread = codex.startThread({
  workingDirectory: process.cwd(),
  sandboxMode: "workspace-write",
});

async function sendTurn(input: string) {
  const { events } = await thread.runStreamed(input, {
    outputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
  });

  for await (const event of events) {
    // forward event to browser window
    console.log(event);
  }
}
```

---

## Bottom line

The SDK gives you:
- persistent conversations (`thread`)
- immediate, typed streaming progress (`runStreamed` events)
- structured output control
- cancellation
- resumeability across sessions
- configuration for environment, sandboxing, model, and permissions

That is enough to build a reliable browser-managed assistant workflow in Bun with resumable sessions and real-time feedback.
