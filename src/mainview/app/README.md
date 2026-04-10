# mainview/app

This folder contains the primary feature modules that render the interactive main interface for the Pi-backed Jolt application. It is where project/thread/chat/workspace state is transformed into visible UI and where UI state transitions are coordinated between desktop and mobile layouts.

The modules below are grouped into action panels, data derivation/state, workspace composition, and reusable hooks.

## Core workspace and navigation modules

`action-menus.tsx`
Provides contextual action menus (`ProjectActionMenu`, `ThreadActionMenu`) used throughout sidebar and thread rows to surface project/thread lifecycle operations.

`auth-step-up-dialog.tsx`
Renders the step-up confirmation dialog used when a privileged action requires a fresh primary-factor plus TOTP re-check.

`thread-extension-ui-dialog.tsx`
Renders the shared browser prompt dialog used for Pi extension `confirm`, `select`, `input`, and `editor` requests.

`settings-panel.tsx`
Renders the top-right settings trigger and the current provider-auth settings surface.
It now shows OpenAI Codex auth status, source, detected Codex credential-storage mode, detected Codex CLI login state, browser-login and device-auth login progress, the one-time device code when headless login is active, manual-code completion, refresh, logout, the browser copy that distinguishes ChatGPT-plan Codex from API-billed OpenAI, and recovery guidance for missing, unusable, keyring-only, or headless Codex setups. Keyring-only Codex auth is documented there as unsupported for direct import today.

`desktop-sidebar.tsx`
Implements the desktop sidebar shell and its integration points with project/thread workspace surfaces.

`desktop-sidebar-content.tsx`
Composes the desktop-only navigation sidebar content: pinned threads, project/worktree navigation, and git history.

`desktop-thread-switcher.tsx`
Renders the explicit desktop worktree-thread switcher popover and exposes the pure filtering/partitioning helper used by tests.

`sidebar-content.tsx`
Composes the shared mobile/sidebar-drawer sections, including project search, thread lists, and git history.

`projects-panel.tsx`
Renders project listings and project-focused interactions, including selection, a single virtualized worktree list ordered by pinned state and workspace name, and the active-worktree thread-switcher trigger.

`pinned-threads-panel.tsx`
Renders the global pinned-thread shortcuts used in the desktop navigation rail.

`threads-panel.tsx`
Renders thread lists and thread row interactions as the canonical thread-navigation surface.

`thread-list-row.tsx`
Defines the thread row component (`ThreadList`) and shared thread-listing prop shape.

`workspace-panel.tsx`
Hosts the active workspace panel shell and swaps between available workspace modes.

`chat-workspace.tsx`
Implements chat rendering and input flows with separate `DesktopChatView` and `MobileChatView` entry points for adaptive behavior, including grouped transcript virtualization, cached row-height reuse for unchanged rows, browser-visible Pi extension status/widget surfaces around the composer, and the active provider billing/policy callout shown immediately before send.

`diff-workspace.tsx`
Builds and renders the diff tree/panel view, including helpers like `emptyDiffFilePatchState` and `buildDiffFileTree`, and now reuses shared parsed-diff state so large patches can prepare off the main thread.

`diff-parsing.ts`
Defines the shared one-pass diff parser, line classification, summary counts, and the threshold heuristic that decides when a diff is large enough to hand off to the worker path.

`diff-parsing-client.ts`
Provides the shared request manager and React hook that cache parsed diff results, offload large diff parsing to a web worker, and fall back to synchronous parsing when a worker is unavailable.

`diff-parsing-worker.ts`
Implements the browser worker entrypoint used to parse and summarize large diffs without monopolizing the UI thread.

`git-history-panel.tsx`
Displays commit/history data for active workspace context in a memoized panel view.

`invalidation-events.ts`
Provides coalesced subscription channels for websocket-driven worktree invalidations so repeated same-worktree git-history refreshes can batch on one tick.

## Message rendering modules

`message-ui.tsx`
Contains every major message renderer used in the chat stream, including the lightweight/plain-text message path, processing/error/notice states, tool/web search output, command output, reasoning traces, and file-change summaries. Diff rendering now consumes the shared parsed-diff cache/worker path for large diffs. Also includes modal/popover helpers such as `GitHistoryDiffModal`, `ErrorPreviewPopover`, and `ThreadSummaryPopover`.

`message-markdown.tsx`
Contains the rich markdown renderer and syntax-highlighting path, isolated behind a lazy import so heavy transcript dependencies stay out of the initial UI bundle.

`message-markdown-loader.ts`
Exports the shared lazy loader used by the main message UI and startup warmup path to fetch the rich markdown renderer on demand, including the prepared-block renderer used for worker-preprocessed huge assistant responses.

`message-markdown-routing.ts`
Defines the lightweight heuristics and bare-link splitting used to keep ordinary chat messages on the plain-text path until richer markdown features are present.

`message-preprocessing.ts`
Defines the worker-threshold heuristic and shared preprocessing plan for huge assistant responses, including markdown/code block segmentation and code-highlight skip decisions.

`message-preprocessing-client.ts`
Provides the cached worker-backed request manager and React hook that preprocess very large markdown-heavy messages off the main thread.

`message-preprocessing-worker.ts`
Implements the browser worker entrypoint that prepares large markdown/code-heavy assistant responses away from the UI thread.

`sidebar-panels-state.ts`
Owns persisted open/closed state for sidebar panels and exposes toggle/read hooks for each section.

## Derived state and hooks

`state.ts`
Central shared types/constants for mainview logic. Includes domain types for threads/projects/worktrees, persisted state schemas, indexed project/thread stores plus indexed per-project worktree helpers, cache constants, formatting helpers, error/preview helpers, and utility operations for sorting/upserting state and persisting UI settings.

`use-mainview-derived-state.ts`
Combines backend and runtime state into memoized derived props used by workspace and sidebar components, including ordered projections over the indexed project/worktree store shape and preformatted worktree display paths reused across hot sidebar renders.

`use-thread-previews.ts`
Owns the shared hover/focus preview behavior for thread rows, including summary/error popover state, positioning, and stale-hide protection when pointer movement crosses rows quickly.

`use-worktree-diff.ts`
Fetches and transforms worktree diff data for diff and chat history contexts.

`use-add-project-form.ts`
Provides form state, validation, and submission behavior for adding a new project.

## Why this folder exists

`src/mainview/app` exists to keep the user-facing application feature logic in one layer that is:

1. View-centric and composed from memoized React components.
2. Shared between desktop and mobile entry points via dedicated hooks and state derivations.
3. Isolated from backend/runtime bootstrap code in `src/bun` and low-level reusable UI controls in `src/mainview/controls`.
