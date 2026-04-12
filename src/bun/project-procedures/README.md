# src/bun/project-procedures

This folder contains the Bun backend procedure layer that powers most RPC behavior exposed to the UI.
It is organized by concern so each module has a narrow responsibility for data models, git orchestration, and thread rendering.

## Purpose of each file

- `model-catalog.ts`
  - Defines the Pi-backed model catalog and reasoning effort options across the supported providers.
  - Curates the built-in provider list to recent-release models instead of surfacing the full historical Pi registry by default.
  - Keeps current Chinese-model families visible in that curated set by exposing direct `Kimi Coding`, `MiniMax`, and `Z.AI` providers and a few current `Qwen` models through `OpenRouter`.
  - Validates and normalizes selected model/reasoning-effort values so invalid persisted data cannot break runtime behavior.
  - Tracks provider metadata such as xAI routing, current provider availability, and which model ids accept reasoning-effort overrides.
  - Resolves provider availability from the backend environment and Metidos-owned Pi auth store so missing setup is visible before a run starts.
  - Provides context-window and compaction-trigger helpers used when estimating token budgets.

- `provider-auth.ts`
  - Implements the backend-managed `openai-codex` auth state machine used by the Bun RPC layer.
  - Tracks in-flight browser-login attempts, device-auth attempts, manual-code completion, refresh, and logout behavior while respecting `~/.codex/auth.json` override precedence.
  - Surfaces the operator-facing missing-versus-unusable Codex-file diagnostics plus the detected Codex credential-storage mode, Codex CLI login state, and device-auth session metadata that drive the browser recovery copy.
  - Keeps provider-auth status shaping isolated so the browser settings work can consume a stable status/result contract later.

- `pi-session-telemetry.ts`
  - Projects active Pi session telemetry into Metidos thread payloads without scraping external files.
  - Uses Pi `getContextUsage()` for live context-window hydration, session-branch `compaction` entries for observed compaction history, and runtime queue/streaming state for richer thread status overlays.
  - Keeps the Pi-to-Metidos telemetry mapping isolated so later UI work can consume new runtime fields without touching the persistence/rendering helpers.

- `command-normalization.ts`
  - Removes shell-wrapper noise from recorded command activity before it is persisted or shown in the UI.
  - Decodes wrapper-specific quoting for POSIX, `cmd.exe`, and PowerShell payloads so command cards display the original executable text instead of transport escaping.
  - Includes special handling for POSIX single-quote splice patterns used when shell commands embed literal single quotes.

- `directory-suggestions.ts`
  - Implements directory autocomplete support used by project and worktree selectors.
  - Maintains an in-memory cache of directory entries keyed by path with TTL + LRU behavior.
  - Parses input queries (including `~` expansion patterns), normalizes path resolution, and refreshes hot entries on a timer.

- `git-history.ts`
  - Encapsulates worktree commit-history caching and pagination mechanics.
  - Stores cached history entries/signatures and ensures callers only read requested windows.
  - Supports background prefetch and foreground escalation, with abortable fills to avoid blocking UI-critical paths.
  - Coalesces in-flight commit-diff reads so duplicate requests share work.

- `task-graph-filesystem.ts`
  - Shared filesystem reader and canonical writer for the git-native task graph under `.metidos/tasks/`.
  - Loads repo config, optional tag/type registries, and per-task `task.toml` plus `body.md` files into a spec-aligned model with file-path metadata.
  - Emits canonical `task.toml`, `config.toml`, `tags.toml`, and `types.toml` text so later init/validate/normalize tooling can share one formatting layer.
  - Now also scaffolds the minimal `.metidos/tasks/` layout for `init_task_graph`, including default config creation, optional empty registry seeding, and created-versus-existing status reporting without clobbering existing canonical files.

- `task-graph-validation.ts`
  - Structured validator for canonical `.metidos/tasks/` repositories.
  - Reuses the shared task-graph parsers to report machine-readable error and warning findings with task ids, file paths, and field context.
  - Supports validating either the whole graph or a requested task-id subset while still resolving links against the full repository graph.

- `task-graph-normalization.ts`
  - Canonical normalizer for `.metidos/tasks/` files that rewrites only files whose canonical output actually changed.
  - Sorts and de-duplicates known task arrays, normalizes body text line endings, and supports task-id subset runs for targeted cleanup.
  - Preserves unknown-but-valid TOML keys and tables while reordering the known task-graph fields into canonical sections.

- `pi-event-projection.ts`
  - Projects Pi `AgentSessionEvent` updates into Metidos thread-activity writes without assuming Codex item types.
  - Tracks assistant thinking/text state, tool-call arguments, pre-write file snapshots, and final usage snapshots across a streamed run.
  - Synthesizes Metidos `file_change` rows for successful Pi `edit` and `write` calls so transcript diff cards stay useful after the Codex removal.
  - Keeps the Pi-to-Metidos transcript mapping explicit so later slices can extend remaining tool or custom-extension semantics cleanly.

- `shared.ts`
  - Shared infrastructure for cache, concurrency, and cancellation primitives used by multiple procedure modules.
  - Exposes LRU helpers, abort normalization, abort-aware Promise awaiting, and bounded concurrency limiting.
  - Includes safe filesystem/path helpers (`safeIsDirectory`, `safeIsFile`, `normalizePath`, `shortName`) used across procedures.

- `thread-detail.ts`
  - Transforms raw DB thread/message records into the RPC shapes consumed by the frontend.
  - Computes thread run-state (`idle`, `working`, `failed`, etc.), unread-error flags, and compaction telemetry.
  - Converts persisted messages by kind (`chat`, `reasoning`, `command`, `file_change`, `tool_call`, `web_search`, `error`) into stable UI types.

## Notes

- This module family is the operational core behind `src/bun/project-procedures.ts`.
- Provider availability is enforced in the procedure layer before thread creation, queued runs, and cron mutations so missing provider env/login setup fails fast with actionable errors instead of reaching the runtime.
- Files here are intentionally separated to avoid a monolithic RPC implementation and to keep runtime responsibilities testable by boundary:
  - persistence mapping in `thread-detail.ts`
  - metadata normalization in `model-catalog.ts`
  - async policy in `shared.ts`
  - external data producers in `directory-suggestions.ts` and `git-history.ts`.
