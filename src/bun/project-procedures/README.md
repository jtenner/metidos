# src/bun/project-procedures

This folder contains the Bun backend procedure layer that powers most RPC behavior exposed to the UI.
It is organized by concern so each module has a narrow responsibility for data models, git orchestration, task discovery, and thread rendering.

## Purpose of each file

- `codex-catalog.ts`
  - Defines the Codex model catalog and reasoning effort options.
  - Validates and normalizes selected model/reasoning-effort values so invalid persisted data cannot break runtime behavior.
  - Provides context-window and compaction-trigger helpers used when estimating token budgets.

- `directory-suggestions.ts`
  - Implements directory autocomplete support used by project and worktree selectors.
  - Maintains an in-memory cache of directory entries keyed by path with TTL + LRU behavior.
  - Parses input queries (including `~` expansion patterns), normalizes path resolution, and refreshes hot entries on a timer.

- `git-history.ts`
  - Encapsulates worktree commit-history caching and pagination mechanics.
  - Stores cached history entries/signatures and ensures callers only read requested windows.
  - Supports background prefetch and foreground escalation, with abortable fills to avoid blocking UI-critical paths.
  - Coalesces in-flight commit-diff reads so duplicate requests share work.

- `project-tasks.ts`
  - Discovers runnable project work tasks from `.tasks` directories and `package.json` scripts.
  - Traverses candidate directories safely (symlink/real-path and ignore-list aware) to avoid loops and huge scans.
  - Normalizes task IDs, task titles, and prompt payloads (`formatTaskPrompt`, `formatPackageScriptTaskPrompt`) so worker execution is deterministic.
  - Also resolves stale task selections into validated runnable payloads before a new thread is created, so missing `.tasks` files or removed package scripts fail cleanly without leaking empty threads.

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
  - external data producers in `directory-suggestions.ts`, `git-history.ts`, and `project-tasks.ts`.
