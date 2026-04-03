# src

Source code for both halves of this repository:
- Bun backend/runtime process and sidecar services under `src/bun`
- Browser/react application UI under `src/mainview`

## `src/bun`

Holds backend orchestration and server entry logic that powers local project/task/thread workflows.

- `codex-sidecar-mcp.ts`
  - Sidecar MCP configuration used by Codex tooling.
- `build-mainview.ts`
  - Build script/entry used to produce the mainview application bundle or runtime artifacts.
- `db.ts`
  - Persistence helpers for project/thread state and local metadata.
- `git.ts`
  - Git-facing utilities used for worktree listing, history, and diff operations.
- `index.ts`
  - Bun-side entrypoint that wires RPC and process-level handlers.
- `isolated-server.ts`
  - Isolated execution/server runner for sidecar workflows.
- `tls-bootstrap.ts`
  - Guided loopback certificate bootstrap script for production HTTPS/WSS setup.
- `tls-config.ts`
  - Shared TLS path/runtime policy helper used by the Bun entrypoints.
- `project-procedures.ts`
  - High-level project orchestration: open/close workflows, background tasks, and thread command lifecycle.
- `rpc-websocket-auth.ts`
  - Shared websocket-upgrade auth gate used to verify session/ticket requirements before `/rpc` upgrades.
- `rpc-schema.ts`
  - Shared RPC typings/contracts used across Bun/browser boundaries.
- `static-server.ts`
  - Static asset serving layer for mainview/browser UI resources.
- `starvation-harness.ts`
  - Guard/utility for starvation/retry scenarios in background loops or polling.

### `src/bun/project-procedures/`

Specialized procedure modules with smaller responsibilities for project-level tasks and metadata operations.

- `codex-catalog.ts`
  - Loads/manages Codex model catalog data and metadata.
- `directory-suggestions.ts`
  - Project root and directory suggestion helpers.
- `git-history.ts`
  - Git history retrieval and transformation logic.
- `project-tasks.ts`
  - Discovery and handling of project-level task scripts/work items.
- `shared.ts`
  - Shared utility helpers used by multiple procedure modules.
- `thread-detail.ts`
  - Thread/session detail persistence and metadata helpers used by thread workflows.

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

- Main application feature views, layout panels, state derivation hooks, and workspace composition used by `App.tsx`.
- See `src/mainview/app/*` for the specific screen-level behavior and feature modules.
