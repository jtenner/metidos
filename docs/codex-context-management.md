# Codex SDK Context Management Research

## Summary

The Codex SDK manages context primarily through persistent `Thread` objects backed by the local `codex` CLI session store, not through an exposed token-window or transcript-pruning API in the SDK itself. In practice, you keep context by reusing the same thread or by resuming a saved thread ID from `~/.codex/sessions`. For longer-running API-native workflows, OpenAI's newer Responses API adds separate context-management primitives such as `previous_response_id`, durable `conversation` objects, and compaction. That compaction layer is documented at the Responses API level, not as a first-class Codex SDK API surface.

## Problem This Solves

When embedding Codex in an app, you need continuity across turns, process restarts, and long-running coding tasks without manually replaying every prior message yourself.

The Codex SDK solves the local continuity problem by:

- treating a conversation as a resumable `Thread`
- persisting thread state in the local Codex session store
- allowing repeated `run()` / `runStreamed()` calls on the same thread
- allowing reconstruction via `resumeThread(threadId)`

The newer Responses API solves the API-side long-context problem by:

- chaining state with `previous_response_id`
- persisting state durably with the Conversations API
- reducing context size with server-side or standalone compaction

## Current State In This Repo

This app already uses the SDK in the thread-oriented way the official docs describe:

- [`src/bun/project-procedures.ts`](../src/bun/project-procedures.ts) creates a singleton `Codex` client.
- [`src/bun/project-procedures.ts`](../src/bun/project-procedures.ts) uses `codex.startThread(...)` for new conversations.
- [`src/bun/project-procedures.ts`](../src/bun/project-procedures.ts) uses `codex.resumeThread(...)` when a stored `codexThreadId` exists.
- [`src/bun/project-procedures.ts`](../src/bun/project-procedures.ts) persists the emitted `thread_id` when the SDK reports `thread.started`.

That means the app is already relying on the SDK's built-in thread/session continuity rather than manually rebuilding context on every turn.

The app now also keeps app-level telemetry about context growth:

- latest-turn token usage from `turn.completed`
- max observed input tokens per thread
- an estimated compaction trigger
- inferred compaction events when a near-limit turn is followed by a sharp token drop

This does not mean the SDK is emitting a first-class compaction event. It means Jolt is now inferring compaction pressure from the usage data that the SDK already exposes.

## How The SDK Handles Context

### 1. Context unit: thread, not message array

The Codex SDK exposes a `Thread` abstraction:

- `codex.startThread()` creates a fresh context
- `thread.run(...)` continues within that context
- `thread.runStreamed(...)` does the same with incremental events
- `codex.resumeThread(threadId)` restores a prior context

Official docs describe this as "Call `run()` again to continue on the same thread, or resume a past thread by providing a thread ID." The SDK README also states that threads are persisted in `~/.codex/sessions`.

### 2. Persistence lives in the local CLI session store

The SDK is a wrapper around the `codex` CLI and communicates with it over JSONL on stdin/stdout. The important consequence is that context persistence is delegated to the local Codex runtime, not maintained purely in the TypeScript object graph.

Practical implications:

- losing the in-memory `Thread` object does not lose the conversation
- process restarts are recoverable if you keep the thread ID
- the durable boundary is the CLI session store on disk

### 3. Context continuation is implicit per turn

Once you hold a `Thread`, you do not pass prior conversation history back into `run()` yourself. The thread identity carries the state forward.

That is materially different from a raw Responses API integration where you might:

- pass `previous_response_id`
- pass a `conversation` ID
- or replay/compact input items manually

### 4. Streaming does not change the context model

`runStreamed()` changes how you observe progress, not how context is stored. The context still belongs to the thread; streaming only exposes intermediate items such as:

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`

### 5. Working directory is part of practical context

For Codex, "context" is not only prior chat turns. The thread also runs with execution settings such as:

- `workingDirectory`
- `sandboxMode`
- `networkAccessEnabled`
- `approvalPolicy`
- `model`

These settings shape what the agent can inspect and do on later turns, so they are effectively part of the operational context of a thread.

## What The SDK Does Not Publicly Expose

Based on the current SDK docs and README, the public Codex SDK surface does not document:

- manual token counting APIs
- manual transcript-pruning APIs
- direct access to compaction controls
- direct access to `previous_response_id` / Conversations API semantics

Instead, the SDK gives you a higher-level local agent thread abstraction.

## Relationship To Responses API Context Management

OpenAI's current API docs describe a second layer of context management in the Responses API.

### Responses API state options

- `previous_response_id` chains one response to the next
- `conversation` stores durable state as a first-class API object
- manual item replay is still possible when you want explicit control

### Compaction options

- server-side compaction via `context_management` with `compact_threshold`
- standalone compaction via `POST /responses/compact`

Compaction returns an opaque encrypted `compaction` item that carries forward key prior state and reasoning using fewer tokens.

### Why this matters for Codex SDK users

This is the important distinction:

- Codex SDK context continuity is thread/session based
- Responses API long-window optimization is item/response based

Inference: the Codex product stack likely benefits from the same model/runtime improvements around long-horizon context and compaction, but the documented SDK contract you code against is still `Thread` continuity, not explicit compaction management.

## Mental Model

```text
Codex SDK app
  -> Thread object
    -> codex CLI session
      -> persisted session state (~/.codex/sessions)
        -> model/runtime context continuation

Responses API app
  -> input items / previous_response_id / conversation
    -> optional compaction
      -> reduced next context window
```

## Recommended Integration Guidance

For this repo's architecture, the right default is:

1. Treat the SDK thread ID as the source of truth for conversation continuity.
2. Persist the thread ID immediately after `thread.started`.
3. Resume existing threads instead of replaying assistant/user history manually.
4. Do not design app state around reconstructing the full prompt transcript unless you need a separate audit/UI record.
5. If you later need explicit token-window control or ZDR-friendly stateless chaining, that is a sign to evaluate a direct Responses API integration path in addition to, or instead of, the SDK.

## Implications For Jolt

The current implementation is aligned with the SDK's intended model:

- it stores `codexThreadId`
- it reuses a thread per project thread record
- it relies on streaming events for UI updates
- it now surfaces estimated compaction pressure in the UI using thread-level telemetry

The remaining limitation is that the app still does not receive an authoritative compaction signal from the SDK. Its compaction indicator is therefore a heuristic plus post-hoc inference, not a guaranteed runtime event. If product requirements later include:

- token-aware thread health
- guaranteed stateless replay
- exportable compacted windows
- deterministic server-side conversation retention policies

then the SDK alone may be too high-level, and a lower-level Responses API integration would offer more explicit control.

## Sources

- OpenAI Codex SDK docs: https://developers.openai.com/codex/sdk
- OpenAI Codex SDK README in `openai/codex`: https://github.com/openai/codex/tree/main/sdk/typescript
- OpenAI Conversation state guide: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI Responses migration guide: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI Compaction guide: https://developers.openai.com/api/docs/guides/compaction
- OpenAI Responses compact reference: https://developers.openai.com/api/reference/resources/responses/methods/compact
- OpenAI GPT-5.4 guide: https://developers.openai.com/api/docs/guides/latest-model
