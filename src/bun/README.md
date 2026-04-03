# src/bun

This directory hosts the Bun-side runtime for Jolt: process entrypoints, RPC server implementation, git/workspace operations, persistence, and tooling used by the sidecar integration.

## Purpose of each file

- `index.ts`
  - Bootstraps the unified Bun backend (`Bun.serve`) and owns most long-lived server behavior.
  - Parses runtime flags/env (`--port`, `--dev`, `--backend-only`) and builds the shared runtime configuration.
  - Exposes HTTP routes for mainview assets and websocket RPC at `/rpc`.
  - Registers all RPC handlers from `project-procedures.ts`.
  - Tracks websocket lifecycle, pending request cancellation, overload telemetry, and startup/shutdown behavior.

- `static-server.ts`
  - Runs the static/public HTTP server for the frontend app when not using the unified mode.
  - Serves bundled frontend assets (`index.html`, `index.js`, `index.css`, fonts) and injects runtime config via `window.__joltRuntime`.
  - Proxies `/auth/*` requests to the backend so browser auth flows stay same-origin even when the UI and RPC server are split across ports.
  - Includes a minimal `/health` endpoint that reports only liveness and proxies backend readiness without exposing backend internals.
  - Resolves and validates CLI args/env values for public and RPC ports.

- `isolated-server.ts`
  - Launches two child processes (backend and static server) as separate roles with isolated env and ports.
  - Handles cross-process lifecycle and coordinated shutdown when either child exits unexpectedly.
  - Useful for local developer workflows where frontend and backend separation is desired.

- `build-mainview.ts`
  - Centralized Bun bundling entry for the React frontend.
  - Invokes `Bun.build` with the React compiler plugin and writes output to `.jolt-build/index.js`.
  - Provides deterministic bundling and surfaceable build errors used by dev/runtime flows.

- `project-procedures.ts`
  - Exposes all RPC procedure implementations consumed by the frontend.
  - Coordinates projects, worktrees, threads, tasks, file content reads/diffs, git history, and thread lifecycle operations.
  - Maintains in-memory caches/polling state, manages worktree/task background refresh loops, and publishes change events to connected clients.
  - Also owns runtime recovery (interrupted turns), startup cache warmup, and runtime stats consumed by overload logging.

- `db.ts`
  - Defines and initializes the local SQLite schema + all persistence operations.
  - Stores projects, worktrees, threads, messages, auth state, session rows, websocket tickets, usage telemetry, and thread/task state.
  - Handles migrations/defaults, typed record types, and path selection for app data location.

- `git.ts`
  - Encapsulates all git command execution and parsing used by procedures.
  - Resolves `git` binary, schedules commands with foreground/background priority, and enforces abort/cancel behavior.
  - Implements worktree snapshots, status/diff scanning, file content paging, history/log parsing, and commit diff retrieval.

- `project-procedures/codex-catalog.ts`
  - Houses Codex model/effort catalog data used by model pickers and validation.
  - Normalizes and validates configured model and reasoning effort values.
  - Provides token-context utilities used for compaction/size logic.

- `project-procedures/directory-suggestions.ts`
  - Maintains cached directory suggestions for path-like user input.
  - Supports suggestion query parsing (`~`, prefixes), fast reads, periodic refresh, and LRU-style expiry.
  - Helps UI/project-creation workflows avoid repeated filesystem scans.

- `project-procedures/git-history.ts`
  - Encapsulates git history caches/prefetching for worktrees.
  - Includes LRU-style cache envelopes for paginated history and commit-diff coalescing.
  - Coordinates with foreground/background scheduling to keep paging smooth under load.

- `project-procedures/project-tasks.ts`
  - Discovers available `.tasks` and `package.json` script tasks within a project/worktree.
  - Normalizes task identity/pathing and builds task prompts for worker execution.
  - Includes filesystem traversal guards, symlink/loop prevention, and safe filtering.

- `project-procedures/thread-detail.ts`
  - Converts persisted thread/message DB records into frontend RPC thread/task shapes.
  - Builds run-state, run-status, usage, compaction telemetry, and message formatting per kind.
  - Contains user-facing message/state normalization used by stream and history views.

- `project-procedures/shared.ts`
  - Shared utility layer for cancellable async helpers, LRU helpers, and concurrency limiting.
  - Provides reusable normalization/error helpers used across directory, history, and task caching.

- `rpc-schema.ts`
  - Defines typed request/response contracts for all backend RPC methods.
  - Provides compile-time guarantees between client and server message envelopes.
  - Describes thread/project/worktree/domain payload shapes consumed across the UI and sidecar.

- `codex-sidecar-mcp.ts`
  - Implements the MCP sidecar process that bridges Codex SDK tool execution with Jolt RPC.
  - Adapts environment/project/thread/worktree context into RPC calls and exposes them as MCP tools.
  - Handles websocket protocol, request correlation, and resilient startup/path resolution.

- `auth.ts`
  - Provides the first-pass auth primitives used by future setup/login flows.
  - Handles Argon2id hashing, TOTP secret/URI generation and verification, recovery-code generation, and opaque token creation for sessions and websocket tickets.

- `auth-secrets.ts`
  - Manages the local encryption key used to protect persisted TOTP secrets at rest.
  - Encrypts and decrypts stored auth secrets with a locally generated AES-GCM key.

- `auth-service.ts`
  - Implements the backend auth flow used by upcoming HTTP routes and RPC gating.
  - Coordinates setup, login, lockout handling, session cookies, logout, and websocket ticket issuance/consumption on top of the DB/auth helpers.

- `auth-reset.ts`
  - Implements the command-line recovery and primary-factor reset flow for single-user local installs.
  - Verifies the configured primary factor plus TOTP before regenerating recovery codes or replacing the PIN/password.

- `server-security.ts`
  - Centralizes local transport hardening helpers shared by the Bun entrypoints.
  - Defines loopback bind defaults, minimal liveness payloads, and browser `Origin` allowlist parsing/validation for websocket upgrades.

- `starvation-harness.ts`
  - Optional benchmarking harness to exercise startup, HTTP, and RPC behavior under worker concurrency.
  - Produces timing summaries and can help validate race/pressure behavior in development and CI-like scenarios.

## Notes

- `src/bun/project-procedures` still has a separate README task in `agent-todo.md` so nested procedures can be documented in more depth later.
- This folder is runtime-critical: changes here impact startup, RPC contracts, persistence, and thread execution behavior.
