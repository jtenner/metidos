# src/bun/project-procedures

This folder contains the Bun backend procedure layer that powers most RPC behavior exposed to the UI.
It is organized by concern so each module has a narrow responsibility for data models, git orchestration, and thread rendering.

## Purpose of each file

- `codex-catalog.ts`
  - Defines the Codex model catalog and reasoning effort options.
  - Validates and normalizes selected model/reasoning-effort values so invalid persisted data cannot break runtime behavior.
  - Provides context-window and compaction-trigger helpers used when estimating token budgets.

- `codex-session-telemetry.ts`
  - Reads the persisted Codex rollout JSONL files under `~/.codex/sessions` (or `CODEX_HOME/sessions`) for live token-count data.
  - Extracts the latest `token_count.last_token_usage` plus the real `model_context_window` so thread context meters can reflect the actual session budget instead of a static model guess.
  - Caches resolved session paths and parsed file snapshots by file stat to keep polling cheap while threads are active.

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
- Files here are intentionally separated to avoid a monolithic RPC implementation and to keep runtime responsibilities testable by boundary:
  - persistence mapping in `thread-detail.ts`
  - metadata normalization in `codex-catalog.ts`
  - async policy in `shared.ts`
  - external data producers in `directory-suggestions.ts` and `git-history.ts`.
