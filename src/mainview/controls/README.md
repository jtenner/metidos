# Controls

This folder contains shared UI controls used by the main view interface for composer workflow, sidebar tools, and codex model configuration.  
Each file is designed to be imported by `src/mainview/app/*` screens and keeps interaction behavior, styling, and accessibility concerns close to the control surface.

## Files

- `chat-composer-control.tsx`
  - Provides the chat message composer used by both desktop and mobile views.
  - Owns shared draft state through a tiny external store so typing state survives remounts and state transitions.
  - Handles resizing, placeholder text, Enter/Cmd+Enter send behavior, and disabled/loading affordances.
- `codex-model-selector.tsx`
  - Implements the model picker UI (desktop + mobile variants) for Codex model selection.
  - Groups models by category for readable browsing, supports search filtering, and can include reasoning-effort controls in mobile contexts.
  - Keeps selection and submenu positioning state in sync while models/reasoning metadata load asynchronously.
- `codex-utils.ts`
  - Helper utilities for Codex model/reasoning UI wiring.
  - Groups model options, formats user-facing labels (including deprecation marking), and resolves selected IDs to model/effort records.
- `dropdown.tsx`
  - Provides a reusable render-prop dropdown primitive used across control UIs.
  - Manages open/close state, outside-click and Escape-key dismissal, and open-state callbacks for parent integrations.
- `icons.tsx`
  - Houses the project’s icon contract with a typed `AppIconName` union.
  - Maps each icon name to a material-style SVG glyph and exposes `materialSymbol` for consistent icon rendering.
- `project-task-selector.tsx`
  - Dropdown selector for per-project task choices.
  - Handles empty/loading/no-op states, accessible disabled hints, and emits selected `RpcProjectTask` payloads.
- `reasoning-effort-selector.tsx`
  - Compact selector for Codex reasoning effort values (for example low/medium/high).
  - Integrates with `DropdownControl` and shows loading/fallback labels when options are unavailable.
- `search-utils.ts`
  - Utility for query preprocessing and matching behavior used by selector search UIs.
  - Normalizes text and performs case-insensitive “contains” checks against multiple candidate fields.
- `sidebar-search-control.tsx`
  - Renders the reusable search box used by sidebar sections.
  - Handles query change, clear action, and minimal keyboard-friendly layout for lists.
- `sidebar-section-header.tsx`
  - Reusable collapsible section header component for sidebar regions.
  - Renders title text, expand/collapse icon state, and optional action slots.
