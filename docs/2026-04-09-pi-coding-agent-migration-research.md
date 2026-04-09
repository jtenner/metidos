# Research: Replacing Codex SDK with Pi Coding Agent

Date: 2026-04-09  
Repository: `jt-ide`  
External target researched: `badlogic/pi-mono`, package `packages/coding-agent`, npm package `@mariozechner/pi-coding-agent` version `0.66.1`

## Goal

Evaluate whether `jt-ide` can replace `@openai/codex-sdk` with Pi while preserving the current product shape:

- browser-based Jolt UI
- Bun backend and RPC layer
- project/worktree/thread model
- per-thread access controls
- cron jobs
- local auth and security auditing
- eventual support for multiple providers/endpoints behind one consistent agent interface

This document is intentionally detailed. It is meant to function as both:

- a research summary of how Pi works
- a migration requirements/spec document for moving Jolt off Codex SDK

## Bottom Line

Pi is a strong fit for the part of Jolt that is currently hardest to own directly:

- multi-provider model abstraction
- auth storage and provider login/API key management
- session persistence
- event streaming
- built-in code tools
- compaction and branch summaries
- skills, prompt templates, extensions, and runtime customization

Pi is **not** a drop-in replacement for Codex SDK in this repository.

The largest mismatches are structural:

- Pi explicitly has **no built-in MCP** support.
- Pi explicitly has **no built-in GitHub connector/tool surface** comparable to Codex app tools.
- Pi explicitly has **no built-in sub-agents**.
- Pi explicitly has **no built-in plan mode**.
- Pi explicitly has **no built-in permission popup or Codex-style sandbox mode abstraction**.
- Jolt currently assumes Codex-specific streamed item types such as `reasoning`, `file_change`, `web_search`, and `mcp_tool_call`.

Conclusion:

- If the goal is “one harness that can talk to many endpoints with the same interface”, Pi is a very good candidate.
- If the goal is “swap one SDK import and keep all current semantics”, Pi is not a trivial swap.
- The correct migration shape is: **keep Jolt’s application shell, replace the agent runtime with Pi, and port Jolt-specific tools/integrations into Pi extensions or SDK custom tools**.

## What Was Researched

### Pi sources

Primary external sources read directly from `pi-mono`:

- [`packages/coding-agent/package.json`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/package.json)
- [`packages/coding-agent/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [`packages/coding-agent/docs/sdk.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [`packages/coding-agent/docs/rpc.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [`packages/coding-agent/docs/providers.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md)
- [`packages/coding-agent/docs/models.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [`packages/coding-agent/docs/custom-provider.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)
- [`packages/coding-agent/docs/session.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)
- [`packages/coding-agent/docs/settings.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)
- [`packages/coding-agent/docs/extensions.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [`packages/coding-agent/docs/skills.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [`packages/coding-agent/docs/prompt-templates.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)
- [`packages/coding-agent/docs/compaction.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)
- [`packages/coding-agent/docs/json.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/json.md)
- [`packages/coding-agent/docs/packages.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [`packages/coding-agent/src/core/sdk.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/sdk.ts)
- [`packages/coding-agent/src/core/agent-session.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts)
- [`packages/coding-agent/src/core/agent-session-runtime.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session-runtime.ts)
- [`packages/coding-agent/src/core/model-registry.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/model-registry.ts)
- [`packages/coding-agent/src/core/auth-storage.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/auth-storage.ts)
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)
- [`packages/coding-agent/src/core/tools/index.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/index.ts)
- [`packages/coding-agent/src/core/tools/edit.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/edit.ts)
- [`packages/coding-agent/src/core/tools/write.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/write.ts)
- [`packages/coding-agent/src/core/tools/bash.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/bash.ts)
- [`packages/coding-agent/src/core/resource-loader.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/resource-loader.ts)
- example extensions and SDK examples under:
  - [`packages/coding-agent/examples/sdk/`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/sdk)
  - [`packages/coding-agent/examples/extensions/`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)

### Local Jolt sources

Primary local files inspected:

- [package.json](../package.json)
- [src/bun/README.md](../src/bun/README.md)
- [src/bun/project-procedures/README.md](../src/bun/project-procedures/README.md)
- [src/mainview/README.md](../src/mainview/README.md)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/project-procedures/codex-constructor.ts](../src/bun/project-procedures/codex-constructor.ts)
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures/codex-session-telemetry.ts](../src/bun/project-procedures/codex-session-telemetry.ts)
- [src/bun/project-procedures/thread-detail.ts](../src/bun/project-procedures/thread-detail.ts)
- [src/bun/codex-sidecar-mcp.ts](../src/bun/codex-sidecar-mcp.ts)
- [src/bun/db.ts](../src/bun/db.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/mainview/App.tsx](../src/mainview/App.tsx)
- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/reasoning-effort-selector.tsx](../src/mainview/controls/reasoning-effort-selector.tsx)
- [src/mainview/controls/thread-access-control.tsx](../src/mainview/controls/thread-access-control.tsx)
- [docs/2026-04-07-thread-tool-access-controls.md](./2026-04-07-thread-tool-access-controls.md)

## Pi Capability Summary

### 1. Pi is an embeddable agent runtime, not just a terminal app

Pi exposes:

- `createAgentSession()` for a single session
- `createAgentSessionRuntime()` and `AgentSessionRuntime` for replacing the active session across new/resume/fork/import flows
- SDK-first embedding for Node/TypeScript applications
- RPC mode over JSONL stdin/stdout for subprocess-based integrations
- JSON event stream mode for simpler machine consumption

This matters because Jolt does **not** need Pi’s TUI to benefit from Pi. Jolt can embed Pi and keep its own React frontend.

### 2. Pi already solves the “multiple endpoints, same interface” problem better than current Jolt

Pi’s model layer already supports:

- built-in providers
- OAuth-backed subscription providers
- API-key-backed providers
- custom providers via `models.json`
- runtime provider registration via `pi.registerProvider(...)`
- overriding built-in providers with different base URLs/headers
- OpenAI-compatible, Anthropic-compatible, Google-compatible, OpenAI Responses, Bedrock, and other supported APIs

Relevant built-in/provider docs explicitly cover:

- OpenAI
- Azure OpenAI
- Anthropic
- Google Gemini
- Google Vertex
- Amazon Bedrock
- Mistral
- Groq
- Cerebras
- xAI
- OpenRouter
- Vercel AI Gateway
- GitHub Copilot
- Hugging Face
- local/proxy/OpenAI-compatible endpoints through `models.json`

Current Jolt does not have a general provider abstraction. It hardcodes:

- OpenAI/Codex
- xAI through a custom Codex constructor path

That hardcoding lives primarily in:

- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures/codex-constructor.ts](../src/bun/project-procedures/codex-constructor.ts)

### 3. Pi already has a full session system

Pi provides:

- persisted JSONL sessions
- in-place tree navigation
- forking
- compaction
- branch summaries
- message queueing
- model/thinking change tracking
- usage and cost tracking
- session runtime replacement APIs

Current Jolt has its own separate thread/session model in SQLite:

- Jolt “threads” are app-level domain entities, not Pi sessions
- each thread stores `codexThreadId`
- Jolt stores transformed thread messages for UI rendering
- Jolt separately infers compaction behavior from Codex token history

Relevant local files:

- [src/bun/db.ts](../src/bun/db.ts)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/project-procedures/thread-detail.ts](../src/bun/project-procedures/thread-detail.ts)
- [src/bun/project-procedures/codex-session-telemetry.ts](../src/bun/project-procedures/codex-session-telemetry.ts)

### 4. Pi already has built-in coding tools and a strong extension surface

Built-in tool surface:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

Extension/customization surface:

- register custom tools
- override built-in tools by name
- intercept tool calls/results
- intercept provider payloads
- transform LLM context before requests
- attach UI interactions (`confirm`, `select`, `input`, `editor`, notifications, status, widgets, title, editor prefill)
- register commands and shortcuts
- register custom providers
- persist extension state in session data

This is very relevant because Jolt’s current Codex-sidecar MCP tools should not stay as MCP if the goal is to move to Pi completely. They should become:

- Pi custom tools
- Pi extension commands
- or Pi tool overrides

### 5. Pi already loads AGENTS, skills, prompt templates, and packages

Pi automatically discovers:

- `AGENTS.md` or `CLAUDE.md` from current directory, ancestors, and global config
- skills
- prompt templates
- themes
- extension packages from npm/git/local paths

This means current repo-level instruction files remain useful. Pi already has the same general project-instructions concept Jolt currently relies on.

### 6. Pi already has compaction and context usage concepts

Pi has:

- proactive compaction thresholds
- overflow recovery
- manual compaction
- compaction summaries
- branch summaries
- context usage tracking
- retry behavior

This is cleaner than Jolt’s current Codex-specific telemetry scraping from `~/.codex/sessions`.

## Pi Non-Goals That Matter for Jolt

Pi’s README is unusually explicit about what it does **not** include in the core:

- no MCP
- no built-in sub-agents
- no built-in permission popups
- no built-in plan mode
- no built-in to-do system
- no built-in background bash

For Jolt, the most important non-goals are:

### No MCP

Current Jolt agent tooling is implemented as a Codex MCP sidecar:

- [src/bun/codex-sidecar-mcp.ts](../src/bun/codex-sidecar-mcp.ts)

Pi’s philosophy is the opposite:

- use built-in tools
- use custom tools
- use skills
- add extensions if you need more behavior

This means a Pi migration should **remove** the Jolt MCP bridge as a runtime dependency for Jolt’s own agent. It should port that behavior into Pi-native tools/extensions instead.

### No built-in GitHub connector

Current Jolt relies on Codex’s GitHub app/tool surface and threads can toggle that surface on/off:

- current toggle semantics are documented in [docs/2026-04-07-thread-tool-access-controls.md](./2026-04-07-thread-tool-access-controls.md)
- backend config wires `apps.github.enabled` in [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)

Pi does not provide that connector surface.

If Jolt still wants GitHub-specific agent tools after the migration, it must build them itself or adopt a Pi package/extension that does so.

### No built-in sub-agents or plan mode

Current Jolt has an `Agents` thread access toggle because Codex can expose:

- `spawn_agent`
- `send_input`
- `wait_agent`
- `update_plan`
- related tools

Pi does not ship equivalents in core. Pi does provide examples for:

- `examples/extensions/subagent/`
- `examples/extensions/plan-mode/`

That means parity is possible, but not free and not identical.

### No built-in Codex-style sandbox policy

Current Jolt relies on Codex thread options:

- `sandboxMode: "workspace-write"` or `"danger-full-access"`
- `networkAccessEnabled`
- approval policy

See [src/bun/project-procedures.ts](../src/bun/project-procedures.ts), `buildCodexThreadOptions(...)`.

Pi’s built-in tools run on the host environment. Pi expects you to:

- run in a container
- use an extension
- override tools
- or otherwise own your safety model

This is the single biggest security/semantics gap in the migration.

## Current Codex-Specific Surface In Jolt

The current repository is not merely “using Codex for completions”. It is structurally built around Codex runtime behavior.

### Backend coupling

Codex is directly instantiated and managed in:

- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)

That file currently owns:

- `new Codex(...)`
- `startThread(...)`
- `resumeThread(...)`
- `runStreamed(...)`
- mapping streamed Codex events into Jolt thread messages
- per-thread Codex config
- per-thread app/tool gating
- sidecar/MCP injection
- thread abort behavior
- usage persistence

### Persisted schema coupling

Current thread rows include Codex-specific persistence:

- `codexThreadId`
- model and reasoning effort validated against a Codex-specific static catalog
- compaction inference derived from Codex usage patterns

See:

- [src/bun/db.ts](../src/bun/db.ts)
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)

### Event-shape coupling

Jolt’s UI and transformed DB messages depend on Codex item types:

- `agent_message`
- `reasoning`
- `command_execution`
- `mcp_tool_call`
- `web_search`
- `error`
- `file_change`

See:

- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/project-procedures/thread-detail.ts](../src/bun/project-procedures/thread-detail.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)

### Access-control coupling

Current access-control semantics are implemented against Codex configuration surface:

- GitHub toggle -> `apps.github.enabled`
- Agents toggle -> Codex feature flags
- Jolt toggle -> whether the Jolt MCP sidecar is attached
- Unsafe toggle -> Codex sandbox/network mode

See:

- [docs/2026-04-07-thread-tool-access-controls.md](./2026-04-07-thread-tool-access-controls.md)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/mainview/controls/thread-access-control.tsx](../src/mainview/controls/thread-access-control.tsx)

### Telemetry coupling

Current context window / usage telemetry is read from Codex’s on-disk session JSONL files:

- [src/bun/project-procedures/codex-session-telemetry.ts](../src/bun/project-procedures/codex-session-telemetry.ts)

That entire subsystem becomes obsolete once Codex SDK is removed.

## Migration Requirement Matrix

The table below answers the practical question:

“If Jolt switches to Pi, what comes for free from Pi, and what still must be implemented by hand?”

| Requirement | Current Jolt implementation | Pi status | Custom work still required on top of Pi |
|---|---|---|---|
| Multiple providers/endpoints behind one interface | Static Codex/xAI catalog in [model-catalog.ts](../src/bun/project-procedures/model-catalog.ts) and constructor overrides in [codex-constructor.ts](../src/bun/project-procedures/codex-constructor.ts) | Native strength | Replace static Jolt catalog with Pi `ModelRegistry`-driven catalog and update UI to show provider/model identity dynamically |
| Provider auth storage and login | Mostly delegated to Codex/OpenAI ecosystem; xAI env special-cased | Native strength | Wire Pi `AuthStorage` into Jolt settings/auth UX; decide whether Jolt exposes Pi provider login flows in web UI |
| Embeddable agent runtime | Codex thread objects managed in [project-procedures.ts](../src/bun/project-procedures.ts) | Native strength | Replace Codex thread lifecycle with Pi `AgentSession` or `AgentSessionRuntime`; confirm Bun compatibility or use Node sidecar |
| Per-thread model selection | Supported today via Jolt DB + Codex thread options | Supported, but model object shape differs | Store provider + model id, not just raw model id; migrate current DB schema or normalize Pi model identity into Jolt-friendly fields |
| Per-thread reasoning control | Current UI uses Codex-style `reasoningEffort` | Similar but not identical | Map Jolt “reasoning effort” to Pi “thinking level”; rename UI/DB if needed; handle models without reasoning support |
| Session persistence and resume | Jolt SQLite thread rows + Codex thread id | Native Pi sessions | Decide whether Jolt stores Pi session file path/id in DB or whether Pi sessions stay entirely internal; likely add `piSessionId`/`piSessionFile` fields |
| Branch/fork/tree navigation | Jolt has separate app threads; no Pi-style in-thread tree UI | Native Pi feature | Decide whether to expose Pi tree navigation in Jolt UI or ignore it initially; if ignored, still preserve it in session files |
| Compaction | Current Jolt infers compaction from Codex token drops | Native Pi feature | Replace Codex telemetry scraper with Pi compaction events and context usage; decide how much current “compaction telemetry” UI survives |
| Streaming events | Current Codex events mapped to Jolt message records | Native Pi event stream | Build a new adapter from Pi `AgentSessionEvent` to Jolt message rows and run-status updates |
| Abort/stop current turn | Current abort controller around Codex run | Native Pi feature | Call `session.abort()` and map abort semantics to current Jolt stopped-state behavior |
| Built-in coding tools | Codex built-ins and shell/file behavior | Native Pi feature | Decide which Pi built-ins are enabled by default; adapt transcript rendering to Pi tool result shapes |
| Jolt project/worktree/thread helper tools | Currently exported through Jolt MCP sidecar | Not native | Rebuild as Pi custom tools/extensions; this replaces [codex-sidecar-mcp.ts](../src/bun/codex-sidecar-mcp.ts) for the Pi path |
| GitHub agent tools | Currently from Codex app/plugin surface | Not native | Build or adopt a GitHub Pi extension/package, probably using `gh`, REST, or GraphQL; redefine `githubAccess` semantics |
| Sub-agents | Currently available through Codex when `agentsAccess` is enabled | Example-level only, not core | Port/adapt Pi example subagent extension or write a Jolt-specific multi-agent extension; redefine UX and access control semantics |
| Plan mode | Currently exposed by Codex tool surface | Example-level only, not core | Port/adapt Pi plan-mode extension or drop parity; update toggle wording/semantics if not preserved |
| Thread access controls | Current backend maps toggles directly into Codex config | Possible, but custom | Re-implement access gating by controlling Pi active tools/extensions/provider integrations; current toggle names can stay only if semantics are rebuilt |
| Unsafe mode / sandbox / network policy | Current Codex thread options support real sandbox/network modes | Major gap | Build a safety model: disable tools, override bash/write/edit, run in container, or adopt sandbox extension; current `unsafeMode` cannot be preserved by a simple flag |
| Reasoning transcript rows | Current UI stores dedicated `reasoning` rows | Partially supported | Convert Pi `thinking_delta` / assistant thinking blocks into Jolt reasoning rows if that UI is still desired |
| Command transcript rows | Current UI stores dedicated command rows | Supported via Pi `bash` tool | Adapt `tool_execution_*` and bash details into current Jolt command message schema |
| File-change transcript rows and inline diffs | Current Codex emits `file_change` items | Partial | Pi `edit` returns diff details, but `write` does not; if parity matters, synthesize file-change records from tool results and/or git diffs |
| Web-search transcript rows | Current Codex may emit `web_search` items | Not native | Add web-search as a custom Pi tool/skill or drop this transcript kind |
| Tool-call transcript rows | Current UI stores `tool_call` rows, excluding Jolt MCP calls | Supported generically | Map Pi tool execution lifecycle into Jolt tool-call rows; redesign if current schema is too Codex-specific |
| Usage/context window telemetry | Current Jolt scrapes Codex session JSONL | Native Pi concepts | Read usage/context from Pi session stats/events instead of scraping external files |
| Cron jobs that spawn agent work | Current cron scheduler creates Jolt thread + Codex run | App-owned today | Keep current cron scheduler, but change execution target from Codex thread to Pi session/thread runtime |
| Local app auth, step-up auth, websocket auth | Jolt-owned auth stack in [auth-service.ts](../src/bun/auth-service.ts) and related files | Unrelated to Pi | Keep as-is; Pi provider auth is separate from Jolt local app auth |
| Project/worktree model, snapshots, git history, diffs | Jolt-owned RPC domain | Unrelated to Pi | Keep as-is; Pi becomes only the agent runtime inside that shell |
| React frontend | Jolt-owned mainview app | Unrelated to Pi | Keep UI, but change data models for sessions/models/messages where necessary |
| Extension/user interaction in custom web UI | Current Jolt controls its own modals and widgets | Supported conceptually by Pi | Implement `session.bindExtensions(...)` UI bindings to React dialogs/widgets/status lines if Pi extensions are used in the browser-hosted flow |
| AGENTS/skills/prompt templates/packages | Jolt has AGENTS repo instructions today, Codex skill usage in operator environment | Native Pi feature | Decide resource loading strategy, package policy, and whether to reuse existing `.codex/skills` directories via Pi settings |
| Replace Codex-specific code completely | Many backend/frontend files reference Codex concepts | Not automatic | Migrate DB fields, rename UI labels, remove Codex telemetry/config/sidecar code, and update tests |

## Detailed Workstreams

### 1. Runtime Integration

### Recommended target

Use Pi SDK as the primary target:

- embed `createAgentSession()` or `createAgentSessionRuntime()` behind Jolt’s Bun RPC layer
- keep Jolt’s current browser UI, SQLite, auth, project/worktree model, and websocket architecture

### Validation status in `jt-ide`

The initial runtime-host spike is now complete inside this repository.

Validated on 2026-04-09 with:

- [src/bun/pi-runtime-probe.ts](../src/bun/pi-runtime-probe.ts)
- [src/bun/pi-runtime-probe.test.ts](../src/bun/pi-runtime-probe.test.ts)
- [src/bun/pi-rpc-probe-extension.ts](../src/bun/pi-rpc-probe-extension.ts)

What passed:

- direct Bun SDK embedding with Pi
- provider auth resolution through Pi auth/model plumbing
- streamed text events from a custom provider
- abort behavior during an active prompt
- persistent session reopen/resume through Pi `SessionManager`
- a Node subprocess fallback using Pi RPC mode plus a local extension-registered provider

Current decision:

- use direct Bun SDK embedding as the primary integration target
- keep the Node Pi RPC sidecar as the fallback path if a provider-specific Bun incompatibility appears later

### RT02 implementation status in `jt-ide`

The first real backend replacement slice is now complete in this repository.

Implemented on 2026-04-09 with:

- [src/bun/pi-thread-runtime.ts](../src/bun/pi-thread-runtime.ts)
- [src/bun/pi-thread-runtime.test.ts](../src/bun/pi-thread-runtime.test.ts)
- [src/bun/pi-thread-runtime-integration.test.ts](../src/bun/pi-thread-runtime-integration.test.ts)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)

What the current implementation now does:

- creates and resumes Pi sessions behind the existing Jolt thread lifecycle
- stores Pi sessions under Jolt app data at `.../pi-agent/thread-sessions/thread-<threadId>/`
- treats the Pi session id as the temporary compatibility value in Jolt’s existing `codexThreadId` field
- maps Pi assistant text into Jolt `chat` rows
- maps Pi thinking deltas into Jolt `reasoning` rows
- maps Pi `bash` executions into Jolt `command` rows
- maps Pi built-in file/search tool executions into Jolt `tool_call` rows
- preserves Jolt’s existing start/stop/background-run and websocket status flow

What the current implementation intentionally does not do yet:

- it does not port Jolt MCP tools into Pi
- it does not port GitHub tools into Pi
- it does not expose agents/plan-mode parity
- it does not restore exact `file_change` or `web_search` parity
- it does not add first-class Pi session columns to SQLite yet

Current temporary runtime policy:

- `unsafeMode=false` enables Pi built-ins `read`, `ls`, `find`, `grep`, `edit`, and `write`
- `unsafeMode=false` disables `bash`
- all enabled path-based Pi tools are restricted to the bound thread worktree through a Pi tool-call policy hook
- `unsafeMode=true` enables the same tool surface plus `bash`

This closes the runtime-host unknowns and gives Jolt a real Pi-backed execution path, but it leaves transcript parity, custom tool parity, UI parity, and schema cleanup to later slices.

### Why SDK first

Benefits:

- direct event subscription
- no subprocess protocol to maintain
- easier mapping to Jolt run status and DB writes
- easier access to extension/runtime APIs
- easier to keep Jolt request cancellation semantics

### Bun compatibility risk

Important caveat:

- Pi documents Node/TypeScript embedding and its package declares `node >= 20.6.0`
- Jolt backend is Bun

That does **not** mean Pi cannot run under Bun, but it does mean compatibility must be proven before committing to in-process embedding.

Recommended spike:

1. In a disposable branch, import `createAgentSession` from Pi into a tiny Bun script.
2. Start an in-memory session with a local model and the `read` tool only.
3. Verify streaming events, abort behavior, and provider auth resolution.
4. If Bun integration is unstable, switch to a Node child-process sidecar using Pi RPC mode.

### Fallback target

If Bun embedding is problematic:

- run `pi --mode rpc` as a managed subprocess
- bridge JSONL RPC/events into the existing Bun websocket/RPC layer

This is less elegant than the SDK route, but still far cleaner than staying on Codex SDK if the main requirement is provider consistency.

### 2. Persistence and Thread Identity

Current Jolt persistence stores:

- app thread id
- thread metadata
- transformed messages
- `codexThreadId`

Pi persistence wants:

- session id
- optional session file
- session tree entries

### Recommended first migration shape

Keep Jolt threads as the application-level concept and add Pi session identity to them.

Suggested DB additions:

- `piSessionId TEXT NULL`
- `piSessionFile TEXT NULL`
- possibly `piLeafEntryId TEXT NULL` if Jolt later wants to expose Pi tree navigation exactly

### Recommended first migration strategy

Let Pi own session files initially.

Reasons:

- Pi’s `SessionManager` is a concrete class, not a clean storage interface
- `createAgentSession` takes a `SessionManager` instance, not a generic session-store interface
- replacing Pi’s storage with SQLite would likely mean forking Pi or upstreaming an abstraction

The pragmatic path is:

- Jolt DB owns app-level thread records
- Pi owns session JSONL files
- Jolt stores references to those Pi sessions

This is now partially implemented in `jt-ide` as:

- Pi-owned session directories under Jolt app data
- SQLite still acting as the app-level source of truth for threads/messages/status
- temporary reuse of `codexThreadId` as the compatibility slot for the active Pi session id until the dedicated DB slice lands

Later, if file-backed session storage becomes a problem, revisit deeper customization.

### 3. Provider/Model UI Migration

Current Jolt model UI assumes:

- a static list returned by backend bootstrap
- one model id string
- one `reasoningEffort` value

Pi’s actual model identity is richer:

- provider id
- model id
- reasoning capability
- context window
- input modality
- cost metadata
- auth availability

### Requirement

Jolt should stop treating “model” as a flat string catalog owned by local source code.

### Recommended changes

- replace static model catalog generation with a Pi-backed catalog derived from `ModelRegistry.getAll()` or `getAvailable()`
- include provider id in the UI and persistence model
- group models by provider and family
- map Jolt “reasoning effort” control to Pi “thinking level”
- decide whether to expose only authenticated models or all known models with availability indicators

### Existing UI files affected

- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/reasoning-effort-selector.tsx](../src/mainview/controls/reasoning-effort-selector.tsx)
- [src/mainview/App.tsx](../src/mainview/App.tsx)

### 4. Porting Jolt Tools Out of MCP and Into Pi

Current Jolt MCP tools include:

- `update_thread`
- `list_threads`
- `run_untrusted_js`
- `set_context`
- `list_crons`
- `new_cron`
- `update_cron`
- `new_thread`

They are registered in:

- [src/bun/codex-sidecar-mcp.ts](../src/bun/codex-sidecar-mcp.ts)

### Recommended migration

Recreate these as Pi custom tools or extension-owned tools.

Likely split:

- `jolt-threads` extension
  - `new_thread`
  - `update_thread`
  - `list_threads`
  - `set_context`
- `jolt-cron` extension
  - `list_crons`
  - `new_cron`
  - `update_cron`
- `jolt-vm2` extension
  - `run_untrusted_js`

### Why this is better than keeping MCP

- Pi’s own philosophy is extension/tool-first, not MCP-first
- Jolt no longer needs a second protocol bridge to talk to itself
- thread access control can be implemented by deciding which Pi tools/extensions are active, instead of by injecting an MCP server conditionally

### 5. Transcript/Event Mapping

Current Jolt UI is optimized around Codex-specific rich transcript categories:

- chat
- reasoning
- command
- file_change
- tool_call
- web_search
- error

Pi gives different raw materials:

- assistant `text_delta`
- assistant `thinking_delta`
- generic tool execution lifecycle
- tool-specific result details
- bash execution messages
- compaction/queue/retry events

### Recommendation

Do not try to force Pi into Codex item types 1:1.

Instead, build an adapter layer with these goals:

- preserve as much of the current UI as is reasonably cheap
- accept that some message kinds will become Pi-native rather than Codex-native

### Suggested mapping

| Current Jolt kind | Pi source | Notes |
|---|---|---|
| `chat` | assistant text updates/completion | straightforward |
| `reasoning` | assistant thinking deltas/blocks | provider-dependent |
| `command` | `bash` tool executions | straightforward |
| `tool_call` | any non-bash tool execution | straightforward |
| `file_change` | `edit` diff details and optionally synthesized write diffs | partial, custom |
| `web_search` | custom Pi web-search tool if added | not built in |
| `error` | tool errors, assistant errors, retry/compaction failures | straightforward |

### Important mismatch

Codex emits first-class `file_change` items. Pi does not.

Pi `edit` does provide unified diff details. Pi `write` does not. Therefore Jolt must choose one of:

- accept less rich file-change transcript behavior
- synthesize diffs for `write`
- synthesize all file change cards by comparing pre/post filesystem state or git diff snapshots

If maintaining the current diff-centric transcript UX matters, this is a real implementation task.

### 6. Access Controls and Unsafe Mode

This is the hardest behavioral parity area.

### Current semantics

Current Jolt thread toggles mean:

- `GitHub`: Codex GitHub connector tools available or unavailable
- `Agents`: Codex multi-agent/planning tools available or unavailable
- `Jolt`: Jolt MCP tools available or unavailable
- `Unsafe`: Codex sandbox/network policy

### Pi-compatible reinterpretation

On Pi, these toggles would need to become:

- `GitHub`: whether Jolt enables a GitHub extension/tool pack
- `Agents`: whether Jolt enables a subagent/plan-mode extension pack
- `Jolt`: whether Jolt enables Jolt-specific tools
- `Unsafe`: whether Jolt enables a broader host-execution/sandbox-bypass tool policy

### Critical warning about `unsafeMode`

Today `unsafeMode` has a real runtime meaning through Codex sandboxing.

On Pi, that meaning does not exist automatically.

If Jolt migrates to Pi and leaves tool behavior unchanged, then:

- `unsafeMode=false` would be misleading
- because Pi’s default tools still operate on the host environment

### Required decision

Before shipping a Pi migration, define what “safe” means in Jolt without Codex:

Option A:

- safe mode disables `bash`, `write`, and `edit`
- unsafe mode enables them

Option B:

- safe mode uses wrapped/filtered tools and allowlisted bash
- unsafe mode enables unrestricted versions

Option C:

- safe mode runs the agent in a real container/sandbox
- unsafe mode runs on host

Option D:

- keep the label but change the UX copy to reflect a softer permission/safety policy rather than a true sandbox guarantee

Option C is the closest semantic match. Option B is the most likely short-term compromise.

Pi examples that are relevant here:

- `permission-gate.ts`
- `protected-paths.ts`
- `sandbox/`
- `tool-override.ts`

### 7. GitHub Integration

Current Jolt’s GitHub behavior is not implemented in this repo. It is inherited from Codex runtime/plugin support and then gated by Jolt thread config.

That means the Pi migration must decide what GitHub means in the post-Codex world.

### Options

Option A: `gh`-based extension

- easiest to build
- good for authenticated developer machines
- weaker for structured schema guarantees

Option B: direct REST/GraphQL extension

- more work
- best parity if Jolt wants structured PR/issue workflows

Option C: hybrid

- use GitHub REST/GraphQL for structured reads/writes
- use `gh` as fallback for workflows like Actions logs

### Recommendation

If GitHub tools are important to the product, treat this as a first-class workstream, not an afterthought. Without it, the current `GitHub` access toggle loses meaning.

### 8. Agents and Plan Mode

Pi core does not give Jolt the same multi-agent surface Codex gave it.

### Recommended product decision

Decide whether Jolt actually needs full parity here, or whether “consistency across providers” is more important than preserving the exact old tool names.

### Practical recommendation

For a first migration:

- do not attempt exact parity with Codex `spawn_agent` and `update_plan`
- instead, port or adapt Pi’s example extensions:
  - `examples/extensions/subagent/`
  - `examples/extensions/plan-mode/`

Then reinterpret `agentsAccess` as:

- whether those extension-provided capabilities are active for the thread

This is much cheaper than trying to recreate Codex’s exact agent tool contract.

### 9. Cron Integration

Jolt cron jobs are already app-owned. That is good news.

Current cron behavior:

- Jolt stores cron jobs in SQLite
- Jolt scheduler starts or requests new threads
- each cron run thread inherits model/access settings

### Migration implication

Cron should remain largely a Jolt concern.

Only the execution target changes:

- before: create/resume Codex thread and run it
- after: create/resume Pi-backed thread/session and run it

The larger work is therefore:

- reuse existing cron scheduler
- change thread runtime implementation
- ensure cron-created threads receive the correct Pi model/provider/tools/extensions/thinking level/safety policy

### 10. Telemetry, Usage, and Compaction UI

Current Jolt does extra work because Codex SDK does not expose the exact live telemetry Jolt wants during runs. That is why Jolt reads Codex JSONL files from disk.

With Pi:

- session stats are part of the runtime model
- context usage is a first-class concept
- compaction is a first-class concept
- queue state is first-class

### What can be deleted after migration

Assuming Pi provides sufficient runtime data for Jolt’s UI:

- [src/bun/project-procedures/codex-session-telemetry.ts](../src/bun/project-procedures/codex-session-telemetry.ts)
- Codex-specific compaction inference heuristics that only exist because of Codex telemetry gaps

### What still needs custom work

If Jolt wants to preserve its current exact compaction telemetry fields, an adapter may still be required because Pi’s model is not identical.

### 11. Local Auth and Security Auditing

Current Jolt local auth is completely app-owned:

- setup/login/logout
- session cookies
- websocket tickets
- step-up auth
- audit logging

This subsystem should stay Jolt-owned.

Pi provider auth is separate and should not replace it.

### Net result

A Pi migration does **not** reduce much work in:

- [src/bun/auth-service.ts](../src/bun/auth-service.ts)
- [src/bun/auth.ts](../src/bun/auth.ts)
- [src/bun/rpc-websocket-auth.ts](../src/bun/rpc-websocket-auth.ts)
- [src/bun/project-security-audit.ts](../src/bun/project-security-audit.ts)
- [src/bun/security-audit.ts](../src/bun/security-audit.ts)

It only changes how privileged agent actions are executed once the request is authorized.

### 12. Browser UI Bindings for Pi Extensions

If Jolt uses Pi extensions seriously, it should also plan for Pi extension UI callbacks.

Pi extensions can ask for:

- confirm
- select
- input
- editor
- notifications
- status lines
- widgets
- title changes
- editor prefill

This is a strong fit for Jolt’s browser UI, but it is not automatic.

### Requirement

Implement a React-backed UI binding for `session.bindExtensions(...)` so Pi extension UI requests can appear in the existing Jolt frontend.

Without this layer:

- extension UI-heavy capabilities will be degraded
- plan mode or approval flows will be harder to port cleanly

## What Pi Saves Us From Building Ourselves

If Jolt adopts Pi, the team does **not** need to hand-build these foundational pieces:

- generalized provider/model registry
- OAuth and API-key-backed provider auth store
- custom-provider registration path
- session JSONL format and session lifecycle engine
- context compaction and branch summaries
- built-in code tools with mature prompt snippets/guidelines
- tool lifecycle events
- extension loading and hot-reload model
- skills/prompt templates/packages system
- AGENTS/CLAUDE context-file loading
- basic usage/cost/context tracking

Those are significant wins.

## What Jolt Still Must Build By Hand Even If It Uses Pi

These remain Jolt-owned or require explicit custom implementation:

- browser UI integration
- project/worktree/thread domain model
- SQLite persistence of app-level objects
- mapping Pi sessions to Jolt threads
- GitHub tool surface
- Jolt-specific tools formerly exposed through MCP
- per-thread access-control semantics
- unsafe/sandbox/network policy semantics
- cron integration
- local auth / step-up auth / websocket auth
- security audit flows
- exact transcript/event adaptation for current UI

This is the critical realism check for the migration.

Pi solves the agent harness problem very well. It does **not** solve Jolt’s product-specific application shell.

## Recommended Migration Architecture

### Recommended target architecture

1. Keep Jolt as the application shell.
2. Replace the Codex runtime with Pi.
3. Let Pi own provider/model/auth/session/tool/extension concerns.
4. Let Jolt continue to own:
   - projects
   - worktrees
   - threads
   - cron
   - local auth
   - security policy
   - browser UI
5. Port Jolt-specific MCP tools into Pi-native tools/extensions.

### Architecture sketch

- Jolt Bun backend
  - keeps websocket RPC and app DB
  - creates/loads Pi sessions per Jolt thread
  - subscribes to Pi events
  - persists Jolt-friendly message projections for UI
- Pi runtime
  - owns provider/model/auth selection
  - owns actual agent loop
  - owns built-in tools
  - hosts Jolt tools through extensions/custom tools
- Jolt React frontend
  - keeps project/worktree/thread UI
  - consumes Pi-backed thread state through the same Jolt RPC transport

## Recommended Phased Plan

### Phase 0: Feasibility spike

- prove Pi SDK under Bun
- if unstable, prove Pi RPC sidecar under Bun
- test one local provider and one hosted provider
- verify abort and streaming behavior

### Phase 1: Minimal Pi-backed thread

- add a hidden experimental path for one thread using Pi
- use Pi built-ins only: `read`, `bash`, `edit`, `write`
- do not port GitHub, Jolt tools, or agents yet
- map chat/command/tool messages only

Current status in `jt-ide`:

- substantially complete
- the live backend now runs threads through Pi by default
- the current tool surface is slightly broader than the original phase wording because it also enables `ls`, `find`, and `grep`
- exact transcript parity and custom-tool parity still remain in later slices

Success criteria:

- create thread
- send message
- stream output
- abort turn
- resume thread
- show usage

### Phase 2: Provider/model migration

- replace static local model catalog with Pi-backed catalog
- persist provider + model identity
- replace reasoning-effort semantics with Pi thinking-level mapping

### Phase 3: Persistence and telemetry cleanup

- store Pi session id/file on thread rows
- delete Codex session telemetry scraping
- switch context usage UI to Pi-backed data

### Phase 4: Jolt tools migration

- port `new_thread`, `update_thread`, `list_threads`, `set_context`, cron tools, and vm2 runner into Pi extensions/custom tools
- remove Codex MCP sidecar dependency from the Pi path

### Phase 5: Access control and safety policy

- redefine or port `GitHub`, `Agents`, `Jolt`, and `Unsafe`
- implement safe vs unsafe tool policy explicitly
- decide GitHub tool strategy

### Phase 6: Advanced parity

- optional subagent extension
- optional plan mode extension
- optional browser UI bindings for extension prompts/widgets
- optional exposure of Pi tree navigation/forking in Jolt UI

### Phase 7: Remove Codex code

Only after the Pi path reaches acceptable parity:

- remove `@openai/codex-sdk` dependency
- remove `codexThreadId` and Codex-specific migrations where safe
- remove Codex-sidecar MCP path if no longer used
- rename Codex-specific UI labels and docs

## Open Questions That Must Be Answered Before Full Migration

1. Is Bun embedding of Pi SDK reliable enough, or should Jolt standardize on a Node sidecar using Pi RPC?
2. Does Jolt want exact parity for `Agents`, or is a Pi-native “subagent extension when enabled” model acceptable?
3. Does Jolt want exact parity for `GitHub`, or is a smaller `gh`-backed tool surface acceptable initially?
4. What does `unsafeMode=false` mean in a post-Codex world?
5. Should Jolt expose Pi session branching/tree features, or keep the simpler current thread mental model?
6. Is it acceptable for Pi to own session files on disk, with Jolt merely storing references?
7. Does the current transcript UI need exact `file_change` cards, or can Pi-native tool rows replace some of that?

## Recommendation

Pursue the migration, but treat it as a **real replatforming of the agent runtime**, not a dependency swap.

Pi is very well matched to the stated strategic goal:

- multiple endpoints
- one interface
- minimal but extensible harness
- consistency across providers

Pi is poorly matched to the idea of preserving every existing Codex-era runtime semantic for free.

The migration is worth doing if the team accepts these truths up front:

- Jolt keeps owning the product shell
- Pi replaces the agent harness
- GitHub, Jolt tools, agents, and unsafe-mode semantics must be explicitly rebuilt
- the clean migration path is Pi-native tools/extensions, not “Pi plus old MCP plus old Codex assumptions”

## Source Index

### Local code references

- [package.json](../package.json)
- [src/bun/project-procedures.ts](../src/bun/project-procedures.ts)
- [src/bun/project-procedures/model-catalog.ts](../src/bun/project-procedures/model-catalog.ts)
- [src/bun/project-procedures/codex-constructor.ts](../src/bun/project-procedures/codex-constructor.ts)
- [src/bun/project-procedures/codex-session-telemetry.ts](../src/bun/project-procedures/codex-session-telemetry.ts)
- [src/bun/project-procedures/thread-detail.ts](../src/bun/project-procedures/thread-detail.ts)
- [src/bun/codex-sidecar-mcp.ts](../src/bun/codex-sidecar-mcp.ts)
- [src/bun/db.ts](../src/bun/db.ts)
- [src/bun/rpc-schema.ts](../src/bun/rpc-schema.ts)
- [src/mainview/App.tsx](../src/mainview/App.tsx)
- [src/mainview/controls/codex-model-selector.tsx](../src/mainview/controls/codex-model-selector.tsx)
- [src/mainview/controls/reasoning-effort-selector.tsx](../src/mainview/controls/reasoning-effort-selector.tsx)
- [src/mainview/controls/thread-access-control.tsx](../src/mainview/controls/thread-access-control.tsx)
- [docs/2026-04-07-thread-tool-access-controls.md](./2026-04-07-thread-tool-access-controls.md)

### External Pi references

- [`packages/coding-agent/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [`packages/coding-agent/docs/sdk.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [`packages/coding-agent/docs/rpc.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [`packages/coding-agent/docs/providers.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md)
- [`packages/coding-agent/docs/models.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [`packages/coding-agent/docs/custom-provider.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)
- [`packages/coding-agent/docs/session.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)
- [`packages/coding-agent/docs/settings.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)
- [`packages/coding-agent/docs/extensions.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [`packages/coding-agent/docs/skills.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [`packages/coding-agent/docs/compaction.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)
- [`packages/coding-agent/src/core/sdk.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/sdk.ts)
- [`packages/coding-agent/src/core/agent-session.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts)
- [`packages/coding-agent/src/core/model-registry.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/model-registry.ts)
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)
- [`packages/coding-agent/examples/extensions/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/README.md)
- [`packages/coding-agent/examples/extensions/subagent/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/subagent/README.md)
- [`packages/coding-agent/examples/extensions/plan-mode/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/plan-mode/README.md)
