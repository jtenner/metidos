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
  - Also exposes the Bun-side provider-auth RPC surface for `openai-codex`, returning live auth status plus refreshed model-catalog payloads after login, refresh, and logout transitions.
  - Also owns runtime recovery (interrupted turns), startup cache warmup, and runtime stats consumed by overload logging.

- `pi-runtime-probe.ts`
  - Lightweight integration probe for Pi runtime adoption.
  - Verifies direct Bun SDK embedding plus a Node RPC fallback with a local mock provider, including streaming, abort, provider auth, and session-resume behavior.

- `pi-runtime-probe.test.ts`
  - Focused tests that keep the Pi runtime probe honest and regression-test the Bun SDK and Node RPC probe paths.

- `pi-rpc-probe-extension.ts`
  - Minimal Pi extension used only by the Node RPC probe fallback.
  - Registers the mock provider contract consumed by `pi-runtime-probe.ts` without pulling in the probe CLI entrypoint itself.

- `pi-thread-runtime.ts`
  - Jolt-owned Pi runtime adapter for per-thread execution.
  - Resolves the Pi model, constructs the bounded Pi tool surface, applies worktree path policy, and creates/resumes deterministic Pi sessions under Jolt app data.
  - Treats provider-qualified model ids as authoritative at runtime so `openai-codex` stays distinct from plain `openai` for overlapping GPT model ids.
  - Defines the current Pi-era safe-vs-unsafe policy: safe threads keep worktree-scoped file/search/edit/write tools but lose `bash`, while unsafe threads also gain `bash` and may request unsafe child threads or cron jobs.
  - Installs the Pi-native GitHub tool pack when `githubAccess` is enabled for the thread, binding those tools to the GitHub repository that owns the current worktree.
  - Installs the Pi-native agents pack when `agentsAccess` is enabled, exposing `update_plan` plus a bounded `delegate_task` helper instead of Codex’s full child-agent lifecycle.
  - Installs the Pi-native Jolt custom tool pack when `joltAccess` is enabled for the thread.
  - Binds the shared browser-facing Pi extension UI bridge when the Bun runtime provides one, allowing session extension prompts and status/widget updates to escape the headless session layer.
  - Runs delegated helper tasks as isolated in-process Pi child sessions that inherit the parent thread’s workspace/model/tool policy while excluding recursive agent tools.
  - Reopens the explicitly persisted Pi session file when a thread already has one instead of relying only on “most recent session” behavior.
  - Serves as the primary bridge between Jolt thread records and Pi `AgentSession` instances.

- `pi-thread-runtime.test.ts`
  - Focused unit coverage for deterministic Pi session directories, session resume behavior, safe-vs-unsafe tool gating, and delegated child-session execution.

- `pi-codex-auth.ts`
  - Shared auth-bridge helper for Codex-via-Pi support.
  - Imports `~/.codex/auth.json` into Jolt's Pi `auth.json`, treats the Codex file as authoritative for `openai-codex` when present, and falls back to Pi-managed OAuth state only when the Codex file is absent or unusable.
  - Also mirrors backend-managed Codex login and refresh results back into both stores so Jolt's explicit auth flows do not get overridden by stale Codex-file state on the next runtime or catalog read.

- `pi-codex-auth.test.ts`
  - Focused coverage for Codex auth translation, Codex-file override precedence, fallback to existing Pi-managed Codex OAuth state, and the missing-versus-unusable diagnostics used by the operator UX.

- `project-procedures/provider-auth.ts`
  - Backend-managed provider-auth state machine for Codex-via-Pi support.
  - Implements `openai-codex` auth status reads plus login start/finish, refresh, and logout orchestration on top of the shared auth-file bridge.
  - Keeps in-flight login prompts and completion state process-local so the later browser UI can layer on top of a stable RPC contract.

- `project-procedures/provider-auth.test.ts`
  - Focused coverage for the backend `openai-codex` auth procedures, including missing/unusable auth-file diagnostics, login start/finish, mirrored persistence into both auth stores, refresh, and logout.

- `pi-extension-ui.ts`
  - Shared Bun-side bridge that turns Pi `ExtensionUIContext` calls into Jolt websocket/RPC traffic.
  - Tracks thread-scoped editor text, handles interactive prompt responses, and emits browser-facing events for notifications, status lines, widgets, title changes, working-message overrides, and hidden-thinking labels.

- `pi-extension-ui.test.ts`
  - Focused coverage for Pi extension dialog fallbacks, round-trip browser responses, and editor/status/widget event emission.

- `pi-agents-tools.ts`
  - Pi-native agents/plan tool pack that gives the `Agents` toggle a real meaning in the Pi runtime.
  - Exposes `update_plan` for explicit ordered plan tracking plus `delegate_task` for one-shot isolated helper execution.
  - Intentionally stops short of Codex-style persistent child-agent lifecycle semantics so the browser/UI migration can remain incremental.

- `pi-agents-tools.test.ts`
  - Focused coverage for plan validation/state updates plus bounded delegated-task host integration and streamed partial results.

- `pi-thread-runtime-integration.test.ts`
  - Backend smoke test proving that `project-procedures.ts` can now execute a real thread lifecycle through the Pi adapter and persist the resulting assistant reply.

- `pi-jolt-tools.ts`
  - Pi-native Jolt custom tool pack for thread metadata, thread listing/creation, cron management, UI context focus, and the vm2-backed untrusted JS runner.
  - Reuses the existing backend scope rules and authoritative procedure layer so the Pi path no longer needs a Jolt MCP bridge for those operations.
  - Enforces the current unsafe-mode escalation rule so safe threads cannot create unsafe child threads or cron jobs even though they still retain worktree-scoped edit and write tools.

- `pi-jolt-tools.test.ts`
  - Focused coverage for the Pi Jolt-tool port, including metadata updates, scoped thread listing, context focusing, cron creation/update, and the auto-start versus immediate-start thread flow.

- `pi-github-tools.ts`
  - Pi-native GitHub custom tool pack backed by the local GitHub CLI.
  - Exposes current-repository GitHub inspection tools for repository metadata, issues, pull requests, CI checks, and pull-request diffs.
  - Uses `gh api` for structured GitHub reads while keeping repository scope bound to the thread worktree.

- `pi-github-tools.test.ts`
  - Focused coverage for the Pi GitHub-tool pack, including repository inspection, issue and pull-request reads, CI checks, and diff truncation behavior.

- `db.ts`
  - Defines and initializes the local SQLite schema + all persistence operations.
  - Stores projects, worktrees, threads, messages, auth state, session rows, websocket tickets, security audit events, and usage telemetry.
  - Thread rows now persist first-class Pi session references (`piSessionId`, `piSessionFile`, `piLeafEntryId`) as the authoritative runtime identity for active agent sessions.
  - Handles migrations/defaults, typed record types, owner-only file permissions, and path selection for the controlled per-user app data location.
  - Exposes destructive maintenance helpers for clearing the local database files when a full reset is requested.

- `git.ts`
  - Encapsulates all git command execution and parsing used by procedures.
  - Resolves `git` binary, schedules commands with foreground/background priority, and enforces abort/cancel behavior.
  - Implements worktree snapshots, status/diff scanning, file content paging, history/log parsing, and commit diff retrieval.

- `project-procedures/model-catalog.ts`
  - Houses the Pi-backed model catalog used by model pickers, validation, and provider resolution.
  - Builds a normalized multi-provider catalog from Pi `ModelRegistry`, emits canonical `provider:modelId` keys, and preserves legacy raw-id fallback for older thread rows.
  - Exposes `openai-codex` as a first-class provider, distinguishes it from `OpenAI API`, and prefers Codex-backed raw GPT defaults only when Codex auth is actually available.
  - Tracks provider/model metadata such as reasoning support and context-window size.
  - Provides token-context utilities used for compaction/size logic.

- `project-procedures/pi-session-telemetry.ts`
  - Maps live Pi `AgentSession` telemetry onto Jolt thread payloads.
  - Hydrates thread usage from Pi context-usage estimates, derives compaction history from Pi session entries, and surfaces live streaming/compaction phase plus queued-message counts on thread status payloads.

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

- `thread-tool-scope.ts`
  - Provides the scope-enforcement helpers shared by Jolt-owned Pi tool packs.
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

- `sidecar-cron-runner.ts`
  - Executes cron rows by creating Jolt child threads and sending the cron prompt through the same Pi-backed thread runtime used for interactive work.
  - Records cron run history, updates last-run metadata, and waits for the spawned thread to settle before marking completion, stop, or error state.
  - Also exposes a small execution-host seam so runtime integration can be tested without changing the production scheduler path.

- `sidecar-cron-runner.test.ts`
  - Integration coverage for immediate and scheduled cron execution through the Pi-backed thread path.
  - Verifies that cron-created threads persist Pi session identity and that cron rows record completed runs.

- `sidecar-cron-scheduler.ts`
  - Main-process wrapper around the cron worker thread.
  - Starts or stops the worker, syncs cron registrations after DB changes, and exposes the on-demand “run now” entrypoint used by RPC.

- `sidecar-cron-thread.ts`
  - Worker module that registers active cron jobs with `Bun.cron`.
  - Reconciles enabled cron rows into active registrations and forwards due fires to the cron runner.

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
