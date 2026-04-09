# src/bun

This directory hosts the Bun-side runtime for Jolt: process entrypoints, RPC server implementation, git/workspace operations, persistence, and tooling used by the sidecar integration.

## Purpose of each file

- `index.ts`
  - Bootstraps the unified Bun backend (`Bun.serve`) and owns most long-lived server behavior.
  - Parses runtime flags/env (`--port`, `--dev`, `--backend-only`) and builds the shared runtime configuration.
  - Also handles the `--wipe-user-data` maintenance flag, which confirms before deleting the local SQLite database files and exiting before server bootstrap.
  - Exposes loopback HTTP routes for mainview assets and websocket RPC at `/rpc`.
  - Registers all RPC handlers from `project-procedures.ts`.
  - Tracks websocket lifecycle, pending request cancellation, overload telemetry, and startup/shutdown behavior.
  - Backing entrypoint for the default `bun start` and `bun start:tls` scripts.

- `tls-config.ts`
  - Resolves the reverse-proxy TLS policy shared across the Bun entrypoints.
  - Supports `--tls` / `JOLT_TLS=1` for deployments where nginx or another reverse proxy terminates TLS and the browser transport should be treated as HTTPS/WSS.

- `build-mainview.ts`
  - Centralized Bun bundling entry for the React frontend.
  - Invokes `Bun.build` with the React compiler plugin and writes output to `.jolt-build/index.js`.
  - Provides deterministic bundling and surfaceable build errors used by dev/runtime flows.

- `logging.ts`
  - Centralizes Bun-side subsystem logging and the worker-backed stderr dispatch used by runtime components.
  - Suppresses `TRACE` output by default; set `JOLT_TRACE_LOGS=1` when you need verbose transport diagnostics.

- `logging-thread.ts`
  - Worker thread that serializes structured log entries onto stderr without blocking the main runtime loop.

- `project-procedures.ts`
  - Exposes all RPC procedure implementations consumed by the frontend.
  - Coordinates projects, worktrees, threads, file content reads/diffs, git history, and thread lifecycle operations.
  - Centralizes authoritative thread metadata mutations so the UI and sidecar invalidate caches through the same backend path.
  - Maintains in-memory caches/polling state, manages worktree background refresh loops, and publishes change events to connected clients.
  - Also owns runtime recovery (interrupted turns), startup cache warmup, and runtime stats consumed by overload logging.

- `db.ts`
  - Defines and initializes the local SQLite schema + all persistence operations.
  - Stores projects, worktrees, threads, messages, auth state, session rows, websocket tickets, security audit events, and usage telemetry.
  - Handles migrations/defaults, typed record types, owner-only file permissions, and path selection for the controlled per-user app data location.
  - Exposes destructive maintenance helpers for clearing the local database files when a full reset is requested.

- `git.ts`
  - Encapsulates all git command execution and parsing used by procedures.
  - Resolves `git` binary, schedules commands with foreground/background priority, and enforces abort/cancel behavior.
  - Implements worktree snapshots, status/diff scanning, file content paging, history/log parsing, and commit diff retrieval.

- `project-procedures/codex-catalog.ts`
  - Houses Codex model/effort catalog data used by model pickers and validation.
  - Normalizes and validates configured model and reasoning effort values.
  - Provides token-context utilities used for compaction/size logic.

- `project-procedures/codex-session-telemetry.ts`
  - Reads the persisted Codex rollout JSONL files to recover live token-count snapshots and the real model context window.
  - Lets the backend surface accurate context-usage telemetry even though the installed SDK stream types only expose final turn usage.

- `project-procedures/directory-suggestions.ts`
  - Maintains cached directory suggestions for path-like user input.
  - Supports suggestion query parsing (`~`, prefixes), fast reads, periodic refresh, and LRU-style expiry.
  - Helps UI/project-creation workflows avoid repeated filesystem scans.

- `project-procedures/git-history.ts`
  - Encapsulates git history caches/prefetching for worktrees.
  - Includes LRU-style cache envelopes for paginated history and commit-diff coalescing.
  - Coordinates with foreground/background scheduling to keep paging smooth under load.

- `project-procedures/thread-detail.ts`
  - Converts persisted thread/message DB records into frontend RPC thread/message shapes.
  - Builds run-state, run-status, usage, compaction telemetry, and message formatting per kind.
  - Contains user-facing message/state normalization used by stream and history views.

- `project-procedures/shared.ts`
  - Shared utility layer for cancellable async helpers, LRU helpers, and concurrency limiting.
  - Provides reusable normalization/error helpers used across directory and history caching.

- `rpc-schema.ts`
  - Defines typed request/response contracts for all backend RPC methods.
  - Provides compile-time guarantees between client and server message envelopes.
  - Describes thread/project/worktree/domain payload shapes consumed across the UI and sidecar.

- `rpc-authz.ts`
  - Centralizes the backend RPC authorization helpers for privileged browser actions.
  - Encapsulates cross-workspace thread step-up detection and auth-bypass-aware step-up enforcement so these rules stay unit-testable.

- `project-security-audit.ts`
  - Centralizes the persistent security audit helpers for privileged project/workspace actions.
  - Records cross-workspace thread creation and project deletion events with stable payloads that are easy to test.

- `security-audit.ts`
  - Provides the shared local security audit log read helpers used by the CLI and tests.
  - Normalizes audit payload JSON into typed flat objects and enforces bounded list limits plus project/thread scoping for offline consumers.

- `security-audit-cli.ts`
  - Implements the read-only CLI for inspecting recent security audit events outside the main IDE UI.
  - Supports text or JSON output plus the same project/thread scoping and limit flags exposed by the shared audit query path.

- `rpc-websocket-auth.ts`
  - Centralizes websocket-upgrade authorization before `/rpc` is allowed to connect.
  - Encapsulates the authenticated-session requirement plus optional websocket-ticket compatibility checks so those rules stay regression-tested independently from the full server bootstrap.

- `codex-sidecar-mcp.ts`
  - Implements the MCP sidecar process that bridges Codex SDK tool execution with Jolt RPC.
  - Adapts environment/project/thread/worktree context into RPC calls and exposes them as MCP tools.
  - Routes thread metadata and access-control writes through authoritative RPC updates so tool success matches visible app state.
  - Exposes thread and cron access flags for GitHub, Agents, Jolt, and Unsafe mode, and only registers the related tools when the matching access is enabled.
  - Reuses the active authenticated session id (`JOLT_SESSION_ID`) to fetch a fresh websocket ticket, then opens `/rpc` with both the ticket and the `jolt_session` cookie header.
  - Reads `JOLT_RPC_URL` plus derived `JOLT_RPC_HTTP_ORIGIN` from the thread environment so the sidecar can locate `/auth/ws-ticket`.
  - Exposes `run_untrusted_js`, which executes untrusted JS/TS through the vm2 runner with redirected console output and worktree-limited writes.
  - Handles websocket protocol, request correlation, and resilient startup/path resolution.

- `codex-sidecar-scope.ts`
  - Provides the scope-enforcement helpers used by the MCP sidecar.
  - Canonicalizes worktree paths and blocks bound thread/project/worktree escapes.

- `vm2-runner.ts`
  - Shared vm2-backed sandbox helpers for the sidecar's untrusted JS tool.
  - Builds the frozen Bun sandbox, the worktree-restricted fs mock, and the MCP-facing execution report formatter.
  - Spawns the worker-backed runner used to enforce the external timeout and collect console events.

- `vm2-runner-worker.ts`
  - Worker entrypoint for the vm2 sandbox.
  - Constructs the NodeVM, wires redirected console events, and executes the untrusted script with the requested timeout.

- `vm2-runner-*.test.ts`
  - Coverage for redirected console output, exposed Bun APIs, worktree write enforcement, and timeout behavior.

- `vm2-runner-test-utils.ts`
  - Shared temp-directory helper for the vm2 runner tests.

- `sidecar-thread-metadata.ts`
  - Shared helper for sidecar thread metadata mutations.
  - Normalizes optional summary/title inputs and routes updates through `updateThreadMetadata(...)`.
  - Surfaces timeout and connection failures instead of silently falling back to local-only writes.

- `auth.ts`
  - Provides the core auth primitives used by setup/login/logout and password/TOTP setup flows.
  - Handles Argon2id hashing, TOTP secret/URI generation and verification, recovery-code generation, and opaque token creation for sessions and websocket tickets.

- `auth-secrets.ts`
  - Manages the local encryption key used to protect persisted TOTP secrets at rest.
  - Encrypts and decrypts stored auth secrets with a locally generated AES-GCM key.

- `auth-service.ts`
  - Implements the backend auth flow used by setup/login/logout, step-up verification, and RPC gating.
  - Coordinates setup, TOTP login, recovery-code login, lockout handling, session cookies, logout, and websocket ticket issuance/consumption on top of the DB/auth helpers.
  - Persists security audit events for successful auth setup, login, step-up, recovery-code usage, logout transitions, and invalid-credential lockout events.
  - Also manages the 24-hour idle session timeout plus the short-lived step-up freshness window used to protect high-risk RPC actions such as project deletion.
  - Also reports auth status to the UI, including the explicit dev-bypass state used by local development flows.

- `auth-reset.ts`
  - Implements the command-line recovery and primary-factor reset flow for single-user local installs.
  - Verifies the configured primary factor plus TOTP before regenerating recovery codes or replacing the PIN/password.
  - Records security audit events for authenticated primary-factor resets and recovery-code regeneration.

- `dev-flows.ts`
  - Parses the explicit development-only security flags (`JOLT_DEV_BYPASS=1` and `JOLT_DEV_RESET=1`).
  - Provides the local-state reset helper that wipes the SQLite/auth-secret files and the synthetic websocket-ticket path used when auth bypass is intentionally enabled in dev mode.

- `server-security.ts`
  - Centralizes local transport hardening helpers shared by the Bun entrypoints.
  - Defines loopback bind defaults, minimal liveness payloads, browser `Origin` allowlist parsing/validation for websocket upgrades, and the shared response security headers/CSP policy.

- `starvation-harness.ts`
  - Optional benchmarking harness to exercise startup, HTTP, and RPC behavior under worker concurrency.
  - Produces timing summaries and can help validate race/pressure behavior in development and CI-like scenarios.

## Notes

- This folder is runtime-critical: changes here impact startup, RPC contracts, persistence, and thread execution behavior.
- Bun listeners stay on loopback HTTP/WS. Use `--tls` or `JOLT_TLS=1` only when an upstream reverse proxy is terminating TLS for browser traffic.
- Default reverse-proxy loopback origins on `http://localhost`, `https://localhost`, `http://127.0.0.1`, and `https://127.0.0.1` are accepted automatically; set `JOLT_ALLOWED_WS_ORIGINS` to add any non-default browser-facing origin or port.
