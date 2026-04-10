# Controls

This folder contains shared UI controls used by the main view interface for composer workflow, sidebar tools, and Pi-backed model configuration.  
Each file is designed to be imported by `src/mainview/app/*` screens and keeps interaction behavior, styling, and accessibility concerns close to the control surface.

## Files

- `chat-composer-control.tsx`
  - Provides the chat message composer used by both desktop and mobile views.
  - Owns shared draft state through a tiny external store so typing state survives remounts and state transitions.
  - Handles resizing, placeholder text, Enter/Cmd+Enter send behavior, and disabled/loading affordances.
- `codex-model-selector.tsx`
  - Implements the model picker UI (desktop + mobile variants) for provider-aware Pi model selection.
  - Walks selection through `Provider -> Model -> Thinking level`, keeping `OpenAI API` and `OpenAI Codex` distinct even when they expose the same GPT ids.
  - Supports search filtering at the provider and model steps, surfaces provider billing/policy scope for `OpenAI API` versus `OpenAI Codex`, marks unauthenticated Codex providers as unavailable, explains when Codex CLI is already signed in but Jolt still lacks reusable credentials, and only shows the thinking-level step when the chosen model supports it.
- `codex-utils.ts`
  - Helper utilities for model/thinking UI wiring.
  - Groups model options by provider, preserves provider availability metadata, filters stepped selector lists, formats provider-aware labels (including deprecation marking), exposes provider-scope guidance, derives active-model scope callouts for composer/cron surfaces, and resolves selected IDs to model/effort records.
- `dropdown.tsx`
  - Provides a reusable render-prop dropdown primitive used across control UIs.
  - Manages open/close state, outside-click and Escape-key dismissal, and open-state callbacks for parent integrations.
- `icons.tsx`
  - Houses the project’s icon contract with a typed `AppIconName` union.
  - Maps each icon name to a material-style SVG glyph and exposes `materialSymbol` for consistent icon rendering.
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
  - Exposes GitHub, Agents, Jolt, and Unsafe toggles with the same defaults used by thread and cron state.
  - The GitHub toggle now maps to the Pi-era current-repository GitHub tool pack instead of being placeholder copy.
  - The Agents toggle now maps to Pi-era plan updates plus one-shot delegated helper tasks instead of the removed Codex-era multi-agent surface.
