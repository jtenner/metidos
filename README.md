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

```text
┌────────────────────┐
│  Browser (mainview)│
│  React + TS + CSS  │
│  WebSocket client   │
└──────────┬─────────┘
           │
           │  RPC over WebSocket
           │
┌──────────▼──────────┐
│     Bun backend      │
│  src/bun/index.ts    │
│  HTTP + WS + static  │
└──────────┬───────────┘
           │
           ├── Project procedures (`src/bun/project-procedures/*`)
           ├── Database/state persistence (`src/bun/db.ts`)
           ├── Git helpers (`src/bun/git.ts`)
           ├── Codex sidecar (`src/bun/codex-sidecar-mcp.ts`, `@openai/codex-sdk`)
           └── Build artifacts (`src/bun/build-mainview.ts`)
```

## Runtime flow (how it works day-to-day)

1. **Startup**
   - `bun run src/bun/index.ts` (or `bun run start:monolith`) boots the server.
   - The server builds/serves the mainview bundle and exposes:
     - HTTP static handlers for app assets (`index.html`, css, fonts)
     - `ws://.../rpc` for bidirectional UI/backend calls
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

## End-to-end component diagram

```mermaid
flowchart LR
  subgraph Client["Browser client (src/mainview)"]
    A["index.ts (RPC transport + event bridge)"]
    B["App.tsx (composition + state orchestration)"]
    C["Derived hooks & panels (mainview/app/*)"]
    D["Controls (mainview/controls/*)"]
    A --> B --> C
    C --> D
  end

  subgraph Transport["WebSocket transport boundary"]
    W["WebSocket /rpc"]
  end

  subgraph Server["Bun backend (src/bun)"]
    E["index.ts HTTP + WebSocket host"]
    F["rpcHandlers + rpc schema registry"]
    G["project-procedures.ts"]
    H["shared services"]
    I["project-procedures/codex-catalog.ts"]
    J["project-procedures/git-history.ts"]
    K["project-procedures/project-tasks.ts"]
    L["project-procedures/directory-suggestions.ts"]
    M["project-procedures/thread-detail.ts"]
    N["db.ts (SQLite persistence)"]
    O["git.ts (git command + priority queue)"]
    P["codex-sidecar-mcp.ts (codex mcp process bridge)"]
    Q["build-mainview.ts"]
    R["static-server.ts / isolated-server.ts"]
    E --> F --> G
    G --> H
    H --> I
    H --> J
    H --> K
    H --> L
    H --> M
    G --> N
    G --> O
    G --> P
    E --> Q
    E --> R
  end

  subgraph External["External services"]
    X["OpenAI Codex SDK"]
    Y["Git CLI"]
    Z["SQLite DB file"]
    F1["File system / worktrees"]
    F2["Node/Bun runtime"]
  end

  A <--> |typed request/response| W
  W <--> E
  G --> |persist/read| N
  N --> |stores| Z
  G --> |status/events| P
  P --> |thread lifecycle/streams| X
  O --> |commands| Y
  O --> |read/write| F1
  E --> |serves assets| R
  F2 --> E
```

```mermaid
sequenceDiagram
  autonumber
  participant U as User action
  participant MV as mainview index.ts
  participant WS as ws://.../rpc
  participant API as bun index.ts
  participant PR as project-procedures
  participant DB as db.ts
  participant SIDE as codex-sidecar-mcp
  participant CH as Codex SDK

  U->>MV: click "start thread / run task / diff"
  MV->>WS: RPC request {id, method, params, priority}
  WS->>API: dispatch by method name
  API->>PR: invoke procedure
  PR->>DB: load/save projects/worktrees/threads/messages
  PR->>SIDE: start/manage Codex thread or tool execution
  SIDE->>CH: stream events / tool calls
  PR-->>API: normalized result or streamed event envelope
  API-->>WS: response or push notification (tasks/history/thread-start)
  WS-->>MV: resolve pending promise or emit window event
  MV-->>U: UI updates derived state + rendered diff/thread/message panels
```
