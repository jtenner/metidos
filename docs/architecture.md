# Architecture

Metidos is a local, operator-owned IDE application that coordinates projects, Git worktrees, Pi-powered agent threads, diffs, cron jobs, plugins, providers, and local diagnostics.

## High-level components

```text
Browser Mainview
  | typed WebSocket RPC (/rpc) + HTTP assets
  v
Bun Backend
  |-- SQLite/App Data
  |-- Git/worktree services
  |-- Pi Runtime adapter
  |-- Cron scheduler and runner sidecars
  |-- Plugin System v1 discovery, review, approval, sidecars
  |-- Provider/auth adapters
  |-- Static share worker for thread-hosted web servers
```

## Backend

The Backend lives under `src/bun/` and is the authority for:

- HTTP startup and Mainview asset serving,
- `/rpc` WebSocket upgrade, auth ticket consumption, session revalidation, request handling, cancellation, and push fanout,
- project/worktree/thread lifecycle operations,
- SQLite persistence in App Data,
- Pi runtime session creation and resumption,
- plugin discovery, inventory, lifecycle, settings, approval, and sidecar dispatch,
- cron scheduling and run execution,
- auth, sessions, TOTP, recovery codes, and step-up checks,
- runtime diagnostics and optional telemetry sidecar storage.

`src/bun/index.ts` is the main server bootstrap. Focused modules own transport, project procedures, runtime stats, plugin seams, auth, cron, terminal, and Pi integration.

See [Backend](./backend.md).

## Mainview

Mainview lives under `src/mainview/` and is the browser-first React/Tailwind interface. It renders:

- project and worktree navigation,
- Thread transcripts and composer,
- model selection,
- diff review,
- cron workspace,
- calendar and notification surfaces,
- plugin administration,
- settings,
- terminal workspaces when unsafe terminal access is enabled.

The application layer is documented in `src/mainview/app/README.md`. UI work must follow `STYLE.md`.

See [Mainview](./mainview.md).

## Pi runtime and Threads

A Thread is a persisted Pi-powered agent execution session attached to a selected Project and Worktree. The Backend owns the mapping between Metidos thread records and Pi sessions under App Data.

Runtime flow:

1. The Local Operator selects a Project, Worktree, provider-qualified model, and Access Control set.
2. Mainview sends a typed RPC request to create or continue a Thread.
3. Backend validates auth, model availability, workspace path scope, and unsafe/plugin permissions.
4. The Pi runtime adapter opens or creates the corresponding Pi session.
5. Runtime tools are installed according to selected native permissions and plugin access groups.
6. Messages, status, tool results, diffs, and extension UI events are persisted and pushed back to Mainview.

Safe Threads keep scoped file/search/edit/write operations but do not get `bash` or unsafe child Thread/Cron escalation. Unsafe Mode is explicit and approval-aware.

## Persistence and App Data

App Data is the local installation state root. It contains SQLite databases, auth secrets, runtime state, plugin installations, plugin data/logs, settings, and optional telemetry sidecar output.

Default App Data paths are described in [Installation](./installation.md). Operators can override the path with `METIDOS_APP_DATA_DIR`.

Tracked source and App Data have different ownership:

- Repository source is canonical and version controlled.
- App Data is private runtime state and should not be committed.
- Derived caches and build outputs are ignored.

## Plugin System v1

Plugin System v1 is local and review-first:

1. A plugin folder appears under `APP_DATA/plugins/{plugin_id}/`.
2. Backend discovers it without executing code.
3. The Local Operator reviews the manifest, permissions, settings, network/file allowlists, and review hash.
4. Approval allows the current hash to run.
5. Approved code runs in a per-plugin sidecar.
6. Source changes invalidate approval until reviewed again.

Plugins can register tools, providers, notification outlets, crons, GC callbacks, ingress sources, and prompt-injection callbacks when the manifest declares the corresponding capabilities.

See [Plugin system](./plugin-system.md).

## Cron architecture

Cron jobs are recurring scheduled agent sessions tied to a Project and Worktree. The scheduler sidecar tracks registered schedules. The runner creates child Threads for due fires and records run status.

Operators can run jobs immediately, disable them, update schedules, or soft-delete them. Plugin-declared crons follow the plugin lifecycle and permission model.

See [Cron jobs](./cron.md).

## RPC data flow

Mainview and Backend communicate through typed WebSocket RPC:

1. Browser obtains an authenticated WebSocket ticket.
2. Browser connects to `/rpc` with an allowed origin.
3. Backend consumes the ticket and resolves the Session.
4. Each RPC message is parsed, rate-limited, revalidated, dispatched, and measured.
5. Backend sends response frames or push messages.
6. Cancels, timeouts, session closure, and backpressure clean up pending work.

See [RPC](./rpc.md) and [Backend RPC transport invariants](./backend-rpc-transport-invariants.md).

## Major data flows

### First project and Thread

```text
Mainview Add Project -> RPC -> Backend path/scope validation -> SQLite project row
Mainview Start Thread -> RPC -> model/provider validation -> Pi session -> messages/status pushes
```

### Diff review

```text
Mainview selects worktree -> RPC diff request -> Backend Git/worktree diff -> Mainview parser/worker -> diff workspace
```

### Plugin approval

```text
Plugin folder -> discovery -> inventory -> operator review -> review hash approval -> sidecar activation -> registered capabilities
```

### Scheduled job

```text
Cron definition -> scheduler registration -> due fire -> runner -> child Thread -> run status and messages
```

### Provider call

```text
Thread model selection -> provider-qualified model ID -> Pi provider registry -> Provider Auth -> outbound model request
```

## Trust boundaries

Important boundaries:

- Browser session and `/rpc` WebSocket ticket boundary.
- Workspace Path Scope around project and worktree filesystem access.
- Safe Mode versus Unsafe Mode tool policy.
- Plugin manifest permissions and review hash approval.
- Plugin sidecar boundary.
- Network allowlists and local/private provider endpoints.
- Reverse proxy/TLS origin boundary for remote access.

See [Security model](./security-model.md) and [Security threat model](./security/threat-model.md).
