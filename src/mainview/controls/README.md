# Controls

This folder contains shared UI controls used by the main view interface for composer workflow, sidebar tools, and Pi-backed model configuration.  
Each file is designed to be imported by `src/mainview/app/*` screens and keeps interaction behavior, styling, and accessibility concerns close to the control surface.

## Files

- `button.tsx`
  - Shared button primitive aligned with the mainview style contract.
- `chat-composer-control.tsx`
  - Provides the chat message composer used by both desktop and mobile views.
  - Owns shared draft state through a tiny external store so typing state survives remounts and state transitions.
  - Handles resizing, placeholder text, Enter/Cmd+Enter send behavior, image attachments, project-skill insertion, and disabled/loading affordances.
- `chat-composer-autosize.ts`, `chat-composer-draft-store.ts`, `chat-composer-image-attachments.ts`, `chat-composer-skills.ts`
  - Focused helpers for composer sizing, draft persistence, image payload preparation, and skill mention/search behavior.
- `codex-model-selector.tsx`
  - Implements the model picker UI (desktop + mobile variants) for provider-aware Pi model selection.
  - Walks selection through `Provider -> Model -> Thinking level`, preserving provider identities and availability metadata supplied by Pi and plugins.
  - Supports search filtering at the provider and model steps, shows unavailable-provider diagnostics in a lightweight popover, and only shows the thinking-level step when the chosen model supports it.
- `codex-utils.ts`
  - Helper utilities for model/thinking UI wiring.
  - Groups model options by provider, preserves provider availability metadata, filters stepped selector lists, formats provider-aware labels (including deprecation marking), and resolves selected IDs to model/effort records.
- `choice-dropdown-control.tsx`
  - Generic choice dropdown used where callers need a compact labeled picker without duplicating selector chrome.
- `confirm-dialog.tsx`
  - Shared confirmation dialog primitive for destructive or approval-like UI flows.
- `dropdown.tsx`
  - Provides a reusable render-prop dropdown primitive used across control UIs.
  - Manages open/close state, outside-click and Escape-key dismissal, and shared floating-surface placement for selector and menu panels.
- `ContextUsageMeter.tsx`
  - Renders compact context-window usage indicators for thread/runtime surfaces.
- `icons.tsx`
  - Houses the project’s icon contract with a typed `AppIconName` union.
  - Maps each icon name to a material-style SVG glyph and exposes `materialSymbol` for consistent icon rendering.
- `list-row.tsx` and `tinted-checkbox-row.tsx`
  - Shared row primitives for selectable settings/access lists.
- `popover.tsx`
  - Hosts the shared floating-surface primitive used by hover tooltips, context menus, and dropdown/dropup panels.
  - Uses Floating UI for portal mounting, viewport-aware flip/shift behavior, virtual point anchors for context menus, and hide-state detection when an anchor becomes clipped or detached.
- `reasoning-effort-selector.tsx`
  - Compact selector for Pi-style thinking-level values (for example low/medium/high).
  - Remains available as a standalone fallback control when a surface wants thinking-level tuning without the full stepped model picker.
- `search-utils.ts`
  - Utility for query preprocessing and matching behavior used by selector search UIs.
  - Normalizes text and performs case-insensitive “contains” checks against multiple candidate fields.
- `sidebar-search-control.tsx`
  - Renders the reusable search box used by sidebar sections.
  - Handles query change, clear action, and minimal keyboard-friendly layout for lists.
- `sidebar-section-header.tsx`
  - Reusable collapsible section header component for sidebar regions.
  - Renders title text, expand/collapse icon state, and optional action slots.
- `thread-access-control.tsx`
  - Reusable upward-opening dropdown for thread and cron access flags.
  - Exposes native web, browser, Git/GitHub, SQLite, LanceDB, calendar, notifications, coordination, plugin access-group, and Unsafe toggles with the same defaults used by thread and cron state.
  - Hides any internal-only permission ids from the normal picker while leaving runtime/discovery policy intact.
  - The GitHub toggle maps to the Pi-era current-repository GitHub tool pack, and the Agents toggle maps to Pi-era plan updates plus one-shot delegated helper tasks.
