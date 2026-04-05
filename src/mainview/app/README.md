# mainview/app

This folder contains the primary feature modules that render the interactive main interface for the Codex application. It is where project/thread/chat/workspace state is transformed into visible UI and where UI state transitions are coordinated between desktop and mobile layouts.

The modules below are grouped into action panels, data derivation/state, workspace composition, and reusable hooks.

## Core workspace and navigation modules

`action-menus.tsx`
Provides contextual action menus (`ProjectActionMenu`, `ThreadActionMenu`) used throughout sidebar and thread rows to surface project/thread lifecycle operations.

`auth-step-up-dialog.tsx`
Renders the step-up confirmation dialog used when a privileged action requires a fresh primary-factor plus TOTP re-check.

`desktop-sidebar.tsx`
Implements the desktop sidebar shell and its integration points with project/thread/task workspaces.

`sidebar-content.tsx`
Composes reusable sidebar sections (projects, threads, tasks) and controls their layout composition.

`projects-panel.tsx`
Renders project listings and project-focused interactions, including selection and project status actions.

`security-audit-panel.tsx`
Displays the local security audit log in a dedicated sidebar section with refresh controls, `All`/`Project`/`Thread` filters, event metadata, and thresholded row virtualization for large histories.

`threads-panel.tsx`
Renders thread lists and thread row interactions as the canonical thread-navigation surface.

`thread-list-row.tsx`
Defines the thread row component (`ThreadList`) and shared thread-listing prop shape.

`workspace-panel.tsx`
Hosts the active workspace panel shell and swaps between available workspace modes.

`chat-workspace.tsx`
Implements chat rendering and input flows with separate `DesktopChatView` and `MobileChatView` entry points for adaptive behavior, including grouped transcript virtualization and cached row-height reuse for unchanged rows.

`diff-workspace.tsx`
Builds and renders the diff tree/panel view, including helpers like `emptyDiffFilePatchState` and `buildDiffFileTree`.

`git-history-panel.tsx`
Displays commit/history data for active workspace context in a memoized panel view.

`invalidation-events.ts`
Provides coalesced subscription channels for websocket-driven worktree invalidations so task and git-history refreshes can batch repeated same-worktree signals on one tick.

`tasks-workspace.tsx`
Renders the tasks-specific workspace and task-related controls.

## Message rendering modules

`message-ui.tsx`
Contains every major message renderer used in the chat stream, including the lightweight/plain-text message path, processing/error/notice states, tool/web search output, command output, reasoning traces, and file-change summaries. Also includes modal/popover helpers such as `GitHistoryDiffModal`, `ErrorPreviewPopover`, and `ThreadSummaryPopover`.

`message-markdown.tsx`
Contains the rich markdown renderer and syntax-highlighting path, isolated behind a lazy import so heavy transcript dependencies stay out of the initial UI bundle.

`message-markdown-loader.ts`
Exports the shared lazy loader used by the main message UI and startup warmup path to fetch the rich markdown renderer on demand.

`message-markdown-routing.ts`
Defines the lightweight heuristics and bare-link splitting used to keep ordinary chat messages on the plain-text path until richer markdown features are present.

`sidebar-panels-state.ts`
Owns persisted open/closed state for sidebar panels and exposes toggle/read hooks for each section.

## Derived state and hooks

`state.ts`
Central shared types/constants for mainview logic. Includes domain types for threads/projects/worktrees, persisted state schemas, cache constants, formatting helpers, error/preview helpers, and utility operations for sorting/upserting state and persisting UI settings.

`use-mainview-derived-state.ts`
Combines backend and runtime state into memoized derived props used by workspace and sidebar components.

`use-thread-previews.ts`
Builds compact thread-preview data for list rendering and summary widgets.

`use-worktree-diff.ts`
Fetches and transforms worktree diff data for diff and chat history contexts.

`use-add-project-form.ts`
Provides form state, validation, and submission behavior for adding a new project.

## Why this folder exists

`src/mainview/app` exists to keep the user-facing application feature logic in one layer that is:

1. View-centric and composed from memoized React components.
2. Shared between desktop and mobile entry points via dedicated hooks and state derivations.
3. Isolated from backend/runtime bootstrap code in `src/bun` and low-level reusable UI controls in `src/mainview/controls`.
