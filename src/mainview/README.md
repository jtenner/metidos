# mainview

This folder contains the browser-facing React UI layer for Codex’ main application view, including the workspace screen composition, routing-free panel orchestration, and all chat/thread/project interaction surfaces used by the desktop and mobile experiences.

Files in this folder are split by responsibility: app bootstrap, global UI styling, and stateful workspace components.

## Top-level entry files

`App.tsx` mounts the full multi-panel application shell and wires application-level providers, feature panels, and command dispatch boundaries.

`auth-shell.tsx` gates the workspace behind setup/login/recovery screens, including the lost-device recovery-code login path, and now surfaces the explicit dev-bypass state when `JOLT_DEV_BYPASS=1` is active.

`auth-client.ts` wraps the backend `/auth/*` HTTP endpoints used by setup, TOTP login, recovery-code login, logout, status polling, and websocket ticket acquisition.

`auth-shell-connect.ts` isolates the bounded retry logic used when the UI boots into an already-authenticated session and the first RPC transport connect needs transient recovery.

`project-close.ts` isolates the rollback-safe project-collapse sequencing so the UI only commits local close state after the backend confirms the project has closed.

`startup-project-restore.ts` isolates startup restore reconciliation for project reopen state so the UI keeps projects closed until batch restore confirms them and can roll back failed restore targets cleanly.

`startup-worktree-restore.ts` isolates startup worktree-restore filtering and selection fallback so stale persisted worktree paths are pruned before the rest of the UI starts reading git history, tasks, or active-worktree state from them.

`rpc-errors.ts` defines the typed RPC error surface used by the frontend to react to privileged-action failures such as `step_up_required`.

`index.ts` is the JS entry point that wires runtime initialization and React mounting, including reading the server-injected JSON runtime bootstrap used for auth, health, and websocket endpoint discovery.

`index.html` provides the host document, mount point, static stylesheet/script tags, and static metadata required by the frontend bundle.

`index.css` contains shared component and layout styles used across the top-level views.

`input.css` contains base/reset style inputs used by the chat and control surfaces.

## `app/` subfolder

This contains the workspace feature modules that implement every visible workspace state, list, and panel in the main UI.

`app/action-menus.tsx` defines context/action menus for project and thread operations.

`app/chat-workspace.tsx` implements the chat screen composition for desktop and mobile and coordinates composer + message flow.

`app/desktop-sidebar.tsx` defines the desktop layout shell and sidebar affordances for wide screens.

`app/diff-workspace.tsx` renders file patches and supports diff tree construction and state for patch inspection.

`app/git-history-panel.tsx` displays per-thread and project git history in a dedicated sidebar panel.

`app/message-ui.tsx` hosts all message display components and modal/preview helpers for tool calls, processing states, errors, and notices.

`app/projects-panel.tsx` renders project cards/lists and project-level workspace selection behavior.

`app/security-audit-panel.tsx` displays the local security audit log in a dedicated sidebar panel and supports refresh-on-open plus current-project/current-thread filtering behavior.

`app/sidebar-content.tsx` composes shared sidebar sections and controls how project, thread, and task data are organized.

`app/sidebar-panels-state.ts` owns persisted sidebar panel open/closed state and cross-panel toggle synchronization.

`app/state.ts` defines shared mainview state shapes, formatting helpers, and state-caching utilities used across panels and hooks.

`app/tasks-workspace.tsx` renders the tasks workspace, including task list state and filtering behavior.

`app/thread-list-row.tsx` renders a single thread row and handles row-level status/actions behavior.

`app/threads-panel.tsx` assembles the thread list, preview previews, and selection wiring.

`app/use-add-project-form.ts` encapsulates project creation form validation and submission orchestration.

`app/use-mainview-derived-state.ts` derives stable derived state from raw RPC/project data before it reaches presentation components.

`app/use-thread-previews.ts` prepares compact thread preview data for sidebar/message rendering.

`app/use-worktree-diff.ts` pulls and transforms worktree diff data for diff viewers and history tooling.

`app/workspace-panel.tsx` contains the workspace-level shell for switching among chat/diff/task content panes.

## `controls/` subfolder

`controls/` contains reusable, reusable UI controls and selectors consumed by app-level components. It already has its own `README.md` with component-level details.

`controls/README.md` documents control component contracts and usage patterns.

`controls/chat-composer-control.tsx` renders the message composer and send/compose interactions.

`controls/codex-model-selector.tsx` controls model-selection and selection state for chat routing.

`controls/codex-utils.ts` provides shared utility helpers used by codex-oriented controls.

`controls/dropdown.tsx` is the shared dropdown primitive used by action and selection controls.

`controls/icons.tsx` centralizes icon exports used by controls and panels.

`controls/project-task-selector.tsx` renders project/task picker controls in the workspace.

`controls/reasoning-effort-selector.tsx` provides model reasoning effort selection for request tuning.

`controls/search-utils.ts` contains search/filter helpers used by sidebar and workspace find surfaces.

`controls/sidebar-search-control.tsx` renders and manages sidebar search/filter input behavior.

`controls/sidebar-section-header.tsx` draws consistent section headers and controls in sidebar cards.

## Why this folder exists

`src/mainview` is the boundary between data/services and user-facing UI logic for Codex’ primary screen. The folder ensures:

1. All main UI panels are discoverable and co-located.
2. Feature modules stay decoupled from backend bootstrap (`src/bun`) and from styling/asset-only docs.
3. Shared state and hook-based view-models are available for both desktop and mobile layouts without duplicating logic.
