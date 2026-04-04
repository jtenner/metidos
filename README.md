# jt-ide

`jt-ide` is a Bun + React TypeScript application that runs an opinionated local IDE workflow for Codex-backed coding sessions.
It combines:

- a Bun server/process layer (RPC handlers, persistence, polling, Git/Codex sidecar orchestration)
- a browser-first UI (`src/mainview`) for workspaces, threads, tasks, and diffs
- a typed RPC contract that keeps both sides in sync

The goal is to keep coding sessions, project state, and tool outputs tightly coupled while still exposing clean composable UI primitives.

## Why this exists

- Manage multiple Git worktrees and projects from one local interface.
- Start, monitor, and stop Codex threads tied to files/worktrees.
- Run and track project-defined tasks.
- View and diff worktree file content without leaving the app.
- Preserve responsive interactions with cancellation, background updates, and resilient reconnects.

## Big-picture architecture

```mermaid
flowchart TD
  %% Frontend layer
  subgraph Client["Browser client (mainview)"]
    UI["mainview index.ts\n- boots WS transport\n- pending request map + reconnect + type map"]
    APP["App.tsx\n- shell + route-like workspace composition\n- orchestrates selected project/worktree/thread state"]
    DER["app/* hooks + derived state\n- maps RPC data into panels\n- memoized selectors + thread/workspace views"]
    CTRL["controls/* UI controls\n- composer, menus, selectors, search\n- model/effort toggles and actions"]
    ROUT["window event bridge\n- custom events for async server pushes"]
  end

  %% transport boundary
  subgraph Transport["UI <-> backend transport"]
    WS["ws(s)://.../rpc\n- bidirectional request/response\n- timeout + cancellation + backoff"]
  end

  %% Backend process host
  subgraph Server["Bun backend process (src/bun)"]
    HOST["index.ts\n- HTTP routes for assets and fonts\n- WS upgrade + heartbeat + request envelope handling"]
    DISPATCH["RPC dispatch in index.ts\n- validates request name\n- executes procedure\n- serializes ok/error replies"]
    SCHEMA["rpc-schema.ts\n- shared TypeScript contract for UI/backend"]
    ORCH["project-procedures.ts\n- orchestrates project/worktree/thread/task ops\n- cache warmup + background maintenance"]
    DB["db.ts\n- sqlite persistence\n- projects/worktrees/threads/messages/usage"]
    GIT["git.ts\n- git command execution\n- diffs, snapshots, history pages"]
    SIDE["codex-sidecar-mcp.ts\n- MCP stdio process endpoint\n- tools for thread metadata + create/start flow"]
    TASKS["project-procedures/project-tasks.ts\n- discover .tasks files & package scripts\n- build execution prompts"]
    DIR["project-procedures/directory-suggestions.ts\n- directory autocomplete cache (LRU + TTL)\n- home/tilded path parsing"]
    HISTRY["project-procedures/git-history.ts\n- paged history cache + prefetch + diff request dedupe"]
    SHARED["project-procedures/shared.ts\n- LRU, abort-aware promises, concurrency limiter\n- safe path and fs helpers"]
    DETAIL["project-procedures/thread-detail.ts\n- maps DB rows to RpcThread/RpcThreadMessage\n- run state + compaction signals"]
    CATALOG["project-procedures/codex-catalog.ts\n- model + reasoning catalog\n- validation and normalization"]
    BUILD["build-mainview.ts\n- bundles mainview entry to .jolt-build/index.js\n- production/dev artifact prep"]
    WATCH["isolated-server.ts / static-server.ts\n- dev helper mode and static-only mode variants"]
  end

  %% external services
  subgraph External["External/operating layers"]
    OPENAI["OpenAI Codex SDK"]
    SQLITE["SQLite file store"]
    FS["Filesystem + git repo worktrees"]
    PROC["Bun process spawns (package scripts / child tasks)"]
  end

  UI --> APP
  APP --> DER
  APP --> CTRL
  APP --> ROUT
  ROUT --> UI
  APP -->|RPC requests| WS
  WS <--> DISPATCH
  DISPATCH --> SCHEMA
  DISPATCH --> ORCH
  ORCH --> DB
  ORCH --> GIT
  ORCH --> SIDE
  ORCH --> TASKS
  ORCH --> DIR
  ORCH --> HISTRY
  ORCH --> SHARED
  ORCH --> DETAIL
  ORCH --> CATALOG
  HOST --> BUILD
  HOST --> WATCH
  ORCH -->|streams/updates| ROUT
  ORCH -->|thread lifecycle events| ROUT
  DB --> SQLITE
  GIT --> FS
  GIT --> PROC
  SIDE -->|MCP IPC over stdio| OPENAI
  CATALOG --> OPENAI
  TASKS --> FS
  DIR --> FS
```

## Runtime flow (how it works day-to-day)

1. **Startup**
   - `bun run src/bun/index.ts` (or `bun run start:monolith`) boots the server.
   - `bun run start:tls` starts the isolated server in reverse-proxy TLS mode so browser-facing transport is treated as HTTPS/WSS when nginx or another proxy terminates TLS upstream.
   - The server builds/serves the mainview bundle and exposes:
     - HTTP static handlers for app assets (`index.html`, css, fonts)
     - `ws://.../rpc` on loopback, with `wss://.../rpc` expected only through a TLS-terminating reverse proxy
     - event-driven push updates for tasks/history changes
   - Runtime config is injected so the frontend connects back to the correct RPC endpoint.

2. **Frontend boot**
   - `src/mainview/index.ts` creates a WebSocket transport and pending request map.
   - A typed request envelope (`type`, `id`, `method`, `params`, `priority`) is sent per RPC.
   - Pending calls can be canceled/retried; reconnect uses exponential backoff in production and reload logic in dev.

3. **Request handling**
   - Backend maps incoming request names to handlers in `src/bun/index.ts`.
   - Handlers are imported from `src/bun/project-procedures.ts` and fan out to lower-level modules.
   - Results are normalized into WebSocket responses (`ok`, `result` / `error`).

4. **UI updates**
   - Backend procedures emit change events (e.g., task lists, git history changes).
   - Frontend bridges those messages into custom window events and updates React state.
   - The app keeps controls responsive by centralizing state sync and avoiding full refreshes.

5. **Shutdown/reload**
   - Connection lifecycle handles page unload and server restarts.
   - Invalidation logic clears in-flight requests and reconnect state.
   - Backend has configurable monitoring/maintenance hooks to recover stale polling and procedure caches.

## Project/Worktree model

The main data model is centered on three layers:

- **Projects**: high-level entry points for codebases.
- **Worktrees**: per-checkout work contexts that can be opened, closed, and switched.
- **Threads**: Codex execution sessions attached to selected worktree context.

Threads and worktrees are coordinated through procedures in `src/bun/project-procedures.ts` and related modules:

- `createWorktreeProcedure`, `openWorktreeProcedure`, `closeWorktreeProcedure`
- `createThreadProcedure`, `requestThreadStartProcedure`, `sendThreadMessageProcedure`
- `stopThreadTurnProcedure`, `shutdownActiveThreadTurns`
- `runProjectTaskProcedure`, `renameThreadProcedure`, etc.

## UI structure and how files are organized

- `src/mainview` is the browser app layer.
  - `App.tsx` is the app shell and composition root.
  - `index.ts` owns transport initialization and RPC client wiring.
  - `index.html` and `index.css` are the app entry and style container.
  - `src/mainview/app/*` contains screen sections, panels, hooks, and message rendering.
  - `src/mainview/controls/*` contains reusable controls (selects, composer, icons, search, dropdown primitives).
- `src/bun` is the server/process layer.
  - `index.ts` is the main WebSocket + HTTP host and RPC dispatcher.
  - `project-procedures.ts` is the orchestration layer for everything that mutates user-visible state.
  - `project-procedures/*` splits logic by domain (catalog, tasks, history, Git diff, and thread detail).
  - `db.ts`, `git.ts`, `rpc-schema.ts`, and `build-mainview.ts` provide persistence, VCS actions, API contracts, and build-time support.

## Developer commands

Useful scripts from `package.json`:

```bash
bun run start                 # build CSS + run isolated server
bun run start:tls             # build CSS + run isolated server in reverse-proxy TLS mode
bun run start:monolith        # build CSS + run full monolith backend
bun run dev                   # build CSS + run main dev server with CSS watch
bun run build:dev             # install + build mainview bundle
bun run validate              # biome format check + typecheck
bun run format                # auto-format with biome
bun run typecheck             # TypeScript check
bun run harness:starvation    # run starvation harness utility
```

## Environment and startup flags

- `--port` / `-p` or `JOLT_PORT` for custom server port selection.
- `--backend-only` or `JOLT_BACKEND_ONLY=1` to restrict backend mode.
- `--dev` or `JOLT_DEV=1` for development reconnect behavior and refresh hooks.
- `--tls` or `JOLT_TLS=1` when browser-facing traffic is behind a TLS-terminating reverse proxy.

## Data and performance characteristics

- Requests are tagged with priorities and can be canceled, which helps avoid stale UI updates.
- Polling and watchers are managed centrally to reduce duplicate background work.
- Git/history/thread mutations are routed through procedures so callers do not manipulate backend state directly.
- Server side supports reload-safe state with cache warming and maintenance routines (`warmProcedureStartupCaches`, `shutdownProcedureCacheMaintenance`, etc.).

## Top-level file purpose index

- `.tasks/`
  - Local process docs for commits and research.
- `.gitignore`
  - Generated/build/runtime exclusions.
- `AGENTS.md`
  - Repository instructions and canonical tree snapshot.
- `agent-todo.md`
  - Task tracking for documentation/housekeeping workflows.
- `biome.json`
  - Linting/formatting rules.
- `bun-plugin-react-compiler.ts`
  - Bun plugin entry used with React compiler integration.
- `bun.lock`, `package.json`, `tsconfig.json`, `bunfig.toml`
  - Tooling + dependency + compiler + Bun execution config.
- `docs/`
  - Repository design notes, audits, and migration references.
- `src/`
  - Source of truth for backend and frontend architecture.
- `stitch.zip`
  - Repository artifact currently included as a static file.

## Contributing notes

- Keep frontend and backend RPC contracts aligned in `src/bun/rpc-schema.ts`.
- Prefer clear comments for edge-case behavior (cancellations, open/close sequencing, stale-response handling).
- Run docs + format/style checks according to `bun run validate` before non-doc code changes.
- Use `agent-todo.md` for new documentation or process work so the repo task list stays accurate.
