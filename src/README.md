# src

Source code for both halves of this repository:
- Bun backend/runtime process, Plugin System v1 sidecars, cron workers, share workers, and auth/calendar services under `src/bun`
- Browser/React mainview UI under `src/mainview`

## `src/bun`

Holds backend orchestration and server entry logic that powers local project, worktree, thread, plugin, calendar, notification, cron, and share workflows.

- `build-mainview.ts`
  - Build script/entry used to produce the mainview application bundle or runtime artifacts.
- `db.ts`
  - Persistence helpers for projects, worktrees, threads, messages, auth/session state, calendars, web-server shares, and local metadata.
- `git.ts`
  - Git-facing utilities used for worktree listing, history, and diff operations.
- `index.ts`
  - Bun-side entrypoint that wires RPC and process-level handlers.
  - Default local server entrypoint used by `bun start`, `bun start:tls`, and `bun run src/bun/index.ts`.
  - Also exposes the `--wipe-user-data` maintenance flag for a confirmed local database wipe before server startup.
- `plugin/`
  - Plugin System v1 discovery, inventory, lifecycle, QuickJS sidecar runtime, settings, storage, filesystem, network, notification, provider, calendar/event, terminal, SQLite, logging, and tool-access host APIs.
- `pi/thread-tool-policy.ts`
  - Shared safe/unsafe built-in Pi tool policy used by thread runtime setup and tests.
- `pi/thread-runtime.ts`
  - Metidos-owned Pi runtime adapter for provider-qualified model resolution, persisted Pi sessions, tool installation, safe/unsafe policy, extension UI, child delegation, and project-local skills.
- `pi/lancedb-tools.ts`
  - Project-scoped LanceDB-style vector tools gated by `metidos:lancedb`.
- `pi/metidos/tools.ts`
  - Pi-native Metidos tool pack used for thread metadata, thread listing/creation, cron management, notifications, calendar tools, and terminal helpers.
- `pi/web-server/tools.ts`
  - Pi-native project-scoped web-server tools with direct loopback hosting plus stable share/open URLs.
- `sidecar-cron-scheduler.ts`
  - Launches and controls the cron worker process that keeps Bun.cron registrations in sync.
- `sidecar-cron-thread.ts`
  - Worker-side cron scheduler loop for loading active jobs and handling command messages.
- `sidecar-cron-runner.ts`
  - Cron execution callback invoked by scheduled Bun.cron registrations.
- `sidecar-cron-scheduler.ts` + `sidecar-cron-thread.ts`
  - New cron and updated cron changes are propagated via targeted sync updates (no full scheduler restart).
- `tls-config.ts`
  - Shared reverse-proxy TLS policy helper used by the Bun entrypoints.
- `project-procedures.ts`
  - High-level project orchestration: open/close workflows, background refresh, model catalog validation, and thread command lifecycle.
- `rpc-websocket-auth.ts`
  - Shared websocket-upgrade auth gate used to verify session/ticket requirements before `/rpc` upgrades.
- `rpc-schema.ts`
  - Shared RPC typings/contracts used across Bun/browser boundaries.
- `starvation-harness.ts`
  - Guard/utility for starvation/retry scenarios in background loops or polling.
- `terminal-manager.ts`
  - Managed terminal session lifecycle used by unsafe Metidos terminal tools.

### `src/bun/project-procedures/`

Specialized procedure modules with smaller responsibilities for project metadata, history, and thread operations.

- `model-catalog.ts`
  - Builds the Pi-backed model catalog from built-in providers plus active Plugin System v1 provider registrations.
- `directory-suggestions.ts`
  - Project root and directory suggestion helpers.
- `git-history.ts`
  - Git history retrieval and transformation logic.
- `shared.ts`
  - Shared utility helpers used by multiple procedure modules.
- `plugin-procedures.ts`, `plugin-ingress-procedures.ts`
  - Plugin administration and request-ingress RPC procedure helpers.
- `calendar-procedures.ts`
  - Calendar and calendar-event RPC procedure helpers.
- `thread-detail.ts`
  - Thread/session detail persistence and metadata helpers used by thread workflows.
- `thread-turn-runner.ts`, `thread-runtime-lifecycle.ts`
  - Shared thread-turn lifecycle and runtime acquisition helpers.

## `src/mainview`

Browser-facing React UI application.

- `App.tsx`
  - Root React shell for the IDE/workspace experience.
- `index.ts`
  - Mainview bootstrap and app mount wiring.
- `index.html`
  - HTML host page for the browser UI.
- `index.css`
  - Global style entry and shared tokens/base styling.
- `input.css`
  - Additional styling source for input and interaction surfaces.

### `src/mainview/controls/`

- Shared UI control components (inputs, dropdowns, selectors, icons) and reusable control primitives.
- See `src/mainview/controls/README.md` for per-file details.

### `src/mainview/app/`

- Main application feature views, calendar/cron/terminal workspaces, layout panels, state derivation hooks, persisted UI stores, and workspace composition used by `App.tsx`.
- See `src/mainview/app/*` for the specific screen-level behavior and feature modules.
