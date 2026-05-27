# mainview/app

This folder contains the primary feature modules that render the interactive main interface for the Pi-backed Metidos application. It is where project/thread/chat/workspace state is transformed into visible UI and where UI state transitions are coordinated between desktop and mobile layouts.

The modules below are grouped into action panels, data derivation/state, workspace composition, and reusable hooks.

## Core workspace and navigation modules

`action-menus.tsx`
Provides contextual action menus (`ProjectActionMenu`, `ThreadActionMenu`) used throughout sidebar and thread rows to surface project/thread lifecycle operations.

`auth-step-up-dialog.tsx`
Renders the compact primary-factor + TOTP step-up prompt used before retrying sensitive actions such as plugin approval.

`thread-extension-ui-dialog.tsx`
Renders the shared browser prompt dialog used for Pi extension `confirm`, `select`, `input`, and `editor` requests.

`settings-panel.tsx`
Renders the top-right settings trigger and modal shell for app, local, notification, terminal, and Plugin settings, composing the unified Plugin administration surface from focused modules.
Model provider setup is intentionally absent from this surface; provider configuration is owned by plugins.

`plugin-administration-panel.tsx`
Renders the unified Plugin administration panel and dialogs composed by the settings panel, including plugin inventory rows, lifecycle review dialog, declared Plugin Settings controls, admin data actions, ingress source/binding controls, and ingress route configuration.

`desktop-sidebar.tsx`
Implements the desktop sidebar shell and its integration points with project/thread workspace surfaces.

`desktop-sidebar-content.tsx`
Composes the desktop-only navigation sidebar content: pinned threads, project/worktree navigation, and git history.

`desktop-thread-switcher.tsx`
Renders the explicit desktop worktree-thread switcher popover and exposes the pure filtering/partitioning helper used by tests.

`sidebar-content.tsx`
Composes the shared mobile/sidebar-drawer sections, including project search, thread lists, and git history.

`projects-panel.tsx`
Renders project listings and project-focused interactions, including selection, a single virtualized worktree list ordered by pinned state and worktree name, and the active-worktree thread-switcher trigger.

`pinned-threads-panel.tsx`
Renders the desktop thread section with pinned shortcuts plus the five most recent unpinned threads.

`pinned-folders-panel.tsx`
Renders pinned folder shortcuts as a compact navigation surface.

`threads-panel.tsx`
Renders thread lists and thread row interactions as the canonical thread-navigation surface.

`thread-list-row.tsx`
Defines the thread row component (`ThreadList`) and shared thread-listing prop shape.

`workspace-panel.tsx`
Hosts the active workspace panel shell and swaps between available workspace modes.

`calendar-workspace.tsx`, `calendar-*-dialog.tsx`, `calendar-state.ts`, `calendar-layout.ts`, and `calendar-notifications.ts`
Implement calendar and calendar-event listing, detail/edit dialogs, ICS editing, permission editing, layout helpers, and notification UI state.

`mainview-cron-workspace-controller.tsx`
Owns Mainview cron workspace lifecycle state outside `App.tsx`: cron listing refresh and invalidation subscriptions, run-now/delete busy state, cron creator/editor state, folder selection, and the modal command surface that composes `cronjob-workspace.tsx`.

`cronjob-workspace.tsx`
Renders the cron workspace list and scheduler/run status presentation from controller-supplied state and commands.

`terminal-workspace.tsx`
Renders managed terminal sessions and terminal output controls for unsafe terminal access.

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

`git-history-state.ts`
Owns Git history pagination/window constants, commit-diff cache key shapes, modal cache payload types, and scroll-threshold helper logic.

`path-display-state.ts`
Owns cross-platform path separator detection plus directory input and display-path formatting helpers used by sidebar and project/worktree surfaces.

`plugin-inventory-state.ts`
Owns Plugin inventory display state used by settings, including inventory row naming, status labels, attention fingerprints, data-usage summaries, deduplicated plugin listing, and declared-settings filtering.

`plugin-lifecycle-action-state.ts`
Owns Plugin lifecycle action view state used by settings, including lifecycle/admin action keys, status-aware labels, activation-blocking errors, busy/disabled decisions, feedback presence normalization, and action-key clearing.

`plugin-settings-form-state.ts`
Owns Plugin settings form state used by settings, including snapshot-to-form hydration, control value normalization, stored-secret clear/placeholder decisions, and Plugin Settings patch generation.

`plugin-ingress-route-state.ts`
Owns Plugin ingress route and binding view state used by settings, including ingress source summaries, link-code expiry text, binding grouping, route draft hydration/reconciliation, access-permission sanitization, and displayed folder paths.

`invalidation-events.ts`
Provides coalesced subscription channels for websocket-driven worktree invalidations and cron-list refresh signals so repeated same-worktree git-history refreshes and bursty cron mutations can batch cleanly.

## Message rendering modules

`message-ui.tsx`
Contains every major message renderer used in the chat stream, including the lightweight/plain-text message path, processing/error/notice states, tool/web search output, command output, reasoning traces, and file-change summaries. Chat layouts now pass prepared transcript view-model items into the renderer, so tool-call headers/output labels, expansion/deferred-content state, and transcript diff parse/summary decisions come from the transcript pipeline before visual components are selected. Diff rendering consumes the shared parsed-diff cache/worker path for large diffs. Also includes modal/popover helpers such as `GitHistoryDiffModal`, `ErrorPreviewPopover`, and `ThreadSummaryPopover`.

`transcript-pipeline.ts`
Defines the transcript pipeline seam: visible-message item classification, deferred content and expansion metadata, media payload descriptors, grouped virtual-row identity, transcript item view-model projection, expansion-state resolution, markdown/plain/preprocessed text routing, tool-call presentation decisions, and transcript diff parsing/summary decisions used by chat surfaces before renderer-specific components are selected. Focused transcript tests treat this seam as the primary regression surface for large-message routing, diff worker thresholds, tool-call summaries, media row metadata, and history/backfill stability.

`transcript-state.ts`
Owns pure transcript row-state projection for selected Thread details: history merging, compact row signatures, stable visible-row cache pruning/reuse, media payload extraction for chat images and screenshots, transcript busy/working row derivation, and synthetic loading/empty/error/notice rows consumed by `use-visible-messages.ts`.

`tool-call-rendering.ts`
Builds compact Pi tool-call header previews, output labels, and home-relative path formatting so core tools such as `read`, `ls`, `find`, `grep`, `bash`, `edit`, `write`, and `lancedb_*` render with message-style collapsed headers instead of generic raw argument summaries.

`message-markdown.tsx`
Contains the rich markdown renderer and Metidos-specific link, code, image, and table overrides, isolated behind a lazy import so markdown-heavy transcript dependencies stay out of the initial UI bundle.

`message-markdown-loader.ts`
Exports the shared lazy loader used by the main message UI and startup warmup path to fetch the rich markdown renderer on demand, including the prepared-block renderer used for worker-preprocessed huge assistant responses.

`message-markdown-routing.ts`
Defines the lightweight heuristics and bare-link splitting used to keep ordinary chat messages on the plain-text path until richer markdown features are present.

`message-preprocessing.ts`
Defines the worker-threshold heuristic and shared preprocessing plan for huge assistant responses, including markdown/code block segmentation and legacy code-highlight skip decisions.

`message-preprocessing-client.ts`
Provides the cached worker-backed request manager and React hook that preprocess very large markdown-heavy messages off the main thread.

`message-preprocessing-worker.ts`
Implements the browser worker entrypoint that prepares large markdown/code-heavy assistant responses away from the UI thread.

`sidebar-panels-state.ts`
Owns persisted open/closed state for sidebar panels and exposes toggle/read hooks for each section.

## Derived state and hooks

`state.ts`
Central shared types/constants for mainview logic. Includes domain types for threads/projects/worktrees, persisted state schemas, indexed project/thread stores plus indexed per-project worktree helpers, cache constants, formatting helpers, error/preview helpers, and utility operations for sorting/upserting state and persisting UI settings.

`project-store.ts`, `thread-store.ts`, `project-worktree-state.ts`, `thread-ui-state.ts`, `persisted-mainview-state.ts`, and `persisted-thread-state.ts`
Keep hot collection updates, worktree ordering, per-thread UI state, and persisted shell/thread preferences in focused helpers with dedicated tests.

`mainview-derived-selectors.ts`
Hosts the extracted pure selectors behind `use-mainview-derived-state.ts`, especially the hot sidebar-search and ordered-thread partition helpers. This keeps the expensive project/worktree search indexes testable outside React and makes the memo boundaries explicit: materialize project worktrees once, build display-path maps once, build search text indexes only while a deferred sidebar search is active, and partition already-ordered thread-store rows without re-sorting them.

`use-mainview-derived-state.ts`
Combines backend and runtime state into memoized derived props used by workspace and sidebar components, including ordered projections over the indexed project/worktree store shape, deferred sidebar-search filtering, and preformatted worktree display paths reused across hot sidebar renders.

`use-mainview-shell-controller.ts`
Owns the React-facing Mainview shell seam: initial persisted shell-state loading, selected Project/Worktree/Thread refs, primary-view navigation transitions, mobile/completed Thread indicators, sidebar collapsed state, and debounced persisted shell writes. Its interface exposes shell state, refs, setters, and navigation commands so `App.tsx` composes surfaces without owning those lifecycle details.

`use-mainview-startup-controller.ts`
Owns the persisted startup restore path for the shell: bootstrap loading, project/worktree reopen reconciliation, initial thread reopening, model-catalog hydration, and home-directory prefetch seeding so `App.tsx` no longer inlines that restore sequence.

`use-thread-status-controller.ts`
Hosts the memoized thread-status polling and selected-thread refresh controller extracted from `App.tsx`. It owns the working-thread poll loop, visibility-triggered refreshes, shared in-flight `listThreadStatuses(...)` refresh reuse, and selected-thread detail refresh decisions so unrelated shell state changes do not keep rerunning that controller path when its narrow prop set is unchanged.

`use-project-worktree-controller.ts`
Owns project/worktree listing refresh, project open/close rollback-safe transitions, worktree-open orchestration, and selected-thread workspace hydration when the selected thread points at a project/worktree that is not yet opened in the shell.

`use-thread-workspace-selection-controller.ts`
Owns thread opening, cross-workspace thread creation approval, selected-worktree thread syncing, context-focus routing, and project/worktree click handling so the shell-level workspace-selection flow is isolated from the rest of `App.tsx`.

`use-git-history-controller.ts`
Owns git-history refresh, cached first-page reuse, pagination, invalidation-triggered reloads, and commit-diff modal loading so that history orchestration no longer lives inline inside `App.tsx`.

`use-step-up-controller.ts`
Retired elevated-authentication controller module kept as an empty compatibility stub.

`use-access-permissions.ts` and `thread-access-defaults.ts`
Normalize native and plugin thread permission selections, including default-on native permissions, unsafe approval state, and hidden internal permissions.

`use-project-skills.ts`
Loads project-local skill descriptors for the composer/runtime affordances.

`use-terminals-controller.ts`
Coordinates terminal workspace state, terminal list refreshes, and active terminal selection.

`use-thread-extension-ui-controller.ts`
Owns Pi thread-extension UI state, dialog responses, notification lifetimes, editor-sync writes, and document-title overrides so the extension/event surface stays isolated from unrelated shell concerns.

`use-desktop-thread-switcher.ts`
Owns the desktop worktree-thread switcher state, open/close guards, filtered sections, pinned-thread projection, and worktree labeling now shared by the popover trigger and switcher surface.

`use-visible-messages.ts`
Provides the React adapter around `transcript-state.ts`, deferring hot Thread message updates while delegating visible row mapping, media payload extraction, cached row reuse, and history helpers to the transcript state seam.

`use-thread-previews.ts`
Owns the shared hover/focus preview behavior for thread rows, including summary/error popover state, positioning, and stale-hide protection when pointer movement crosses rows quickly.

`use-worktree-diff.ts`
Fetches and transforms worktree diff data for diff and chat history contexts.

`use-add-project-form.ts`
Provides form state, validation, missing-folder confirmation, and submission behavior for adding a new project.

## Why this folder exists

`src/mainview/app` exists to keep the user-facing application feature logic in one layer that is:

1. View-centric and composed from memoized React components.
2. Shared between desktop and mobile entry points via dedicated hooks and state derivations.
3. Isolated from backend/runtime bootstrap code in `src/bun` and low-level reusable UI controls in `src/mainview/controls`.
