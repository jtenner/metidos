# src/bun

This directory hosts the Bun-side runtime for Metidos: process entrypoints, RPC server implementation, git/worktree operations, persistence, Pi runtime wiring, cron workers, Plugin System v1 sidecars, and share workers.

## Purpose of each file

- `index.ts`
  - Bootstraps the unified Bun backend (`Bun.serve`) and owns most long-lived server behavior.
  - Parses runtime flags/env (`--port`, `--dev`, `--backend-only`, `--track-telemetry`) and builds the shared runtime configuration.
  - Also handles the `--wipe-user-data` maintenance flag, which confirms before deleting the local SQLite database files plus the optional telemetry sidecar database and exiting before server bootstrap.
  - Exposes loopback HTTP routes for mainview assets, serving versioned frontend assets under `/assets/mainview/<version>/...` with immutable cache headers while keeping HTML bootstrap responses `no-store`, plus compatibility root asset aliases and websocket RPC at `/rpc`.
  - Also boots the dedicated fixed-port web-server share worker so stable `/share/open/<token>` and `/s/<thread>/<server>/...` URLs stay off the busy main HTTP request path.
  - Merges `METIDOS_ALLOWED_WS_ORIGINS` with `METIDOS_PUBLIC_ORIGIN` so reverse-proxy TLS deployments can keep one canonical browser-facing origin in `.env` while still satisfying websocket origin checks.
  - Registers all RPC handlers from `project-procedures.ts` and delegates Mainview RPC socket lifecycle, request execution, cancellation, push fanout, backpressure handling, and drain events to `rpc-transport.ts`.
  - Tracks overload telemetry and startup/shutdown behavior around those runtime services.

- `start.ts`
  - Package-script bootstrap for the default `bun run start`, `bun run start:telemetry`, `bun run start:tls`, and `bun run start:tls:telemetry` scripts.
  - Clears display environment variables before dynamically importing `index.ts`, unless `METIDOS_BACKEND_NATIVE_CLIPBOARD=1` is set, so the backend does not load Pi's optional native clipboard addon just from root Pi imports.

- `tls-config.ts`
  - Resolves the reverse-proxy TLS policy shared across the Bun entrypoints.
  - Supports `--tls` / `METIDOS_TLS=1` for deployments where nginx or another reverse proxy terminates TLS and the browser transport should be treated as HTTPS/WSS.

- `build-mainview.ts`
  - Centralized Bun bundling entry for the React frontend.
  - Invokes `Bun.build` with the React compiler plugin and writes output to `.metidos-build/index.js`.
  - Resolves explicit development-versus-production build behavior: development keeps sourcemaps on and skips minification, while production minifies by default and emits sourcemaps only when `METIDOS_MAINVIEW_SOURCEMAP=1` or `--sourcemap` is supplied.
  - Provides deterministic bundling and surfaceable build errors used by dev/runtime flows.

- `mainview-assets.ts`
  - Shared helper layer for versioned mainview asset routing.
  - Builds the current `/assets/mainview/<version>/...` snapshot from the live bundle/CSS/font files, replaces the HTML asset-root placeholder, and resolves only the allowlisted asset paths used by the browser bootstrap.

- `dev-mainview-watcher.ts`
  - Owns dev-only mainview source watching, debounced rebuild/reload decisions, and the polling fallback used when recursive `fs.watch` is unavailable.

- `logging.ts`
  - Centralizes Bun-side subsystem logging and the worker-backed stderr dispatch used by runtime components.
  - Suppresses `TRACE` output by default; set `METIDOS_TRACE_LOGS=1` when you need verbose transport diagnostics.

- `logging-thread.ts`
  - Worker thread that serializes structured log entries onto stderr without blocking the main runtime loop.

- `rpc-transport.ts`
  - Owns Mainview RPC WebSocket client indexing, per-socket and global pending request caps, request cancellation/timeouts, binary/JSON frame parsing and encoding, send backpressure cleanup, drain-event tracing, session/user socket closure, and push fanout while accepting product RPC handlers from `index.ts`.

- `runtime-stats.ts`
  - Process-local runtime statistics collector for backend timing, coarse payload sizes, websocket push fanout, SQLite retry loops, cron duration and queue-pressure counters, selected cache hit/miss counters, and low-cardinality Metidos tool telemetry.
  - Summarizes the heaviest RPC response methods and websocket push types by serialized bytes so transport follow-up work can target measured hot paths instead of guessing.
  - Also tracks per-tool Metidos invocation counts plus explicit unsafe-mode requests and shared budget/queue saturation counters for child thread/cron mutations.
  - Keeps optimization telemetry cheap, resettable, and numeric so later benchmark and diagnostics work can build on one shared source of truth.
  - Also exports the shared runtime-diagnostics snapshot builder used by the health endpoint, the starvation harness, and the optional sidecar sink.

- `runtime-stats-sidecar.ts`
  - Optional `--track-telemetry` sink that periodically snapshots the in-memory runtime diagnostics and flushes them in batches into a separate SQLite sidecar database.
  - Stores coarse snapshot totals plus per-RPC-method, per-websocket-push-type, and cron queue/duration counters without adding writes to the hot request path or the main app database.
  - Applies owner-only POSIX permissions to newly created sidecar app-data directory trees where supported.
  - Also exposes maintenance helpers for finding and deleting the sidecar DB files when a local reset or wipe is requested.

- `plugin/discovery.ts`
  - Discovers immediate child folders under `APP_DATA/plugins/` without building, importing, evaluating, or otherwise executing plugin code.
  - Performs only startup-safe structural checks for uninitialized plugin display: required readable `metidos-plugin.json`, `AGENTS.md`, and `index.ts`, plus forbidden root `node_modules/`.
  - Provides a watch-backed discovery service that tolerates an absent plugins directory and refreshes candidate inventory when root plugin folders are added, removed, or changed.

- `plugin/inventory.ts`
  - Builds the local-operator-facing plugin inventory RPC payload from side-effect-free discovery snapshots.
  - Groups candidates into the v1 status labels (`Uninitialized`, `Needs Review`, `Active`, `Failed/Degraded`, `Disabled/Restart Required`, and `Missing/Unavailable`) and safely reads manifest summary fields plus `.data` byte/file usage for settings-list rows and activation review details without executing plugin code.

- `plugin/data.ts`
  - Maps plugin `~/` storage to `.data`, handles first-activation seed/reset flows, and provides quota-checked storage write, copy, move, and mkdir helpers with controlled plugin-visible quota errors.

- `plugin/log.ts`
  - Implements Plugin System v1 `metidos.log(level, message)` writes with `log:write` permission checks, local-operator-disabled no-op behavior, and `.logs/log-YYYY-MM-DD.log` line formatting.

- `plugin/settings.ts`
  - Persists Plugin System v1 general setting values in app data, validates edits against manifest declarations, and redacts secret values from reads while still allowing tools to write those secrets.

- `plugin/fs-path.ts`
  - Resolves Plugin System v1 `metidos.fs` virtual paths, mapping `~/` to plugin `.data` and `./` to the current thread/project root when available.
  - Realpaths roots and target ancestors, rejects traversal and symlink escapes, hard-denies `.git`/`.ssh`, blocks plugin source/manifest access through `./`, and returns sanitized plugin-visible path errors.

- `plugin/fs-read.ts`
  - Implements Plugin System v1 `metidos.fs` read operations (`ls`, `glob`, `stat`, `exists`, `read`, and `readText`) on top of the virtual path resolver.
  - Requires `storage:read`, limits `./` reads to thread tool contexts with `files:read`, matching `files.allow.read` coverage, and no matching `files.deny.read` pattern; filters glob/list results to virtual paths; and rechecks symlink real targets against project policy.

- `plugin/sqlite.ts`
  - Implements Plugin System v1 `metidos.sqlite(path)` host execution for SQLite databases inside plugin-owned `~/` data only.
  - Requires both `sqlite` and `storage:write`, reuses the plugin virtual path resolver for traversal/symlink containment, returns plugin-visible results without host filesystem paths, and blocks cross-database/open-file escape statements such as `ATTACH`, `DETACH`, `VACUUM INTO`, and `load_extension()`.

- `plugin/fetch.ts`
  - Implements Plugin System v1 `metidos.fetch` execution with `network:fetch` permission checks, manifest `network.allow` matching, HTTPS policy enforcement, redirect-hop validation, blocked dangerous request headers, 30 second default timeouts, and 25 MB response-body limits before sidecar network requests complete.

- `plugin/websocket.ts`
  - Implements Plugin System v1 `metidos.websocket` client execution with `network:websocket` permission checks, manifest `network.webSocketAllow` matching, WSS-first policy enforcement, blocked handshake/ambient-auth headers, bounded connection/message/queue limits, pull-based `receive`, async-iterator `events`, and shutdown cleanup.

- `plugin/lifecycle.ts`
  - Persists local-operator-only plugin installation, review, approval, lifecycle, quota, log, notification, restart, crash-loop, and runtime activation state in app data, computes the current v1 review hash without executing plugin code, and backs Enable, Review Plugin Changes, Re-approve Plugin, Disable, and Retry Plugin RPC actions.
  - Requires plugin manifest ids to match their `APP_DATA/plugins/{plugin_id}` folder before lifecycle persistence or approval, surfaces approval metadata through the inventory RPC, marks changed approved plugin files as `Needs Review`, records disable as restart-required instead of hot-unregistering runtime capabilities, and keeps missing or unreadable persisted plugin records visible as `Missing/Unavailable` instead of silently dropping them from inventory.
  - Plugin procedure authorization requires recent step-up only for actions that approve or invoke plugin code: Enable, Re-approve Plugin, Retry Plugin, and Run Plugin GC. Disable, Review Plugin Changes, Open `.data`, Open `.logs`, and Reset Plugin Data remain local-operator-only, with Reset Plugin Data protected by explicit destructive confirmation rather than step-up.

- `plugin/sidecar-rpc.ts`
  - Defines the host-owned JSON-over-stdio envelopes shared by plugin sidecar startup, requests, cancellation, shutdown, responses, errors, and events.
  - Enforces typed payload validation and the v1 1 MB frame limit before dispatching protocol data.

- `plugin/sidecar-manager.ts`
  - Starts one approved active sidecar per plugin and tracks ready sessions without exposing plugin-defined backend routes.
  - Validates setup-time sidecar registrations before marking a plugin ready, so duplicate or undeclared tools/providers/notification providers, invalid plugin-declared crons, or invalid GC handlers fail startup instead of partially registering.
  - Routes host requests through correlated in-flight operations, bounded callback timeouts, best-effort cancellation frames, and controlled tool-call failure text when a plugin errors or exits.
  - Coordinates session lifecycle, startup diagnostics, crash-loop accounting, retained stderr, plugin logs, and host-request routing while delegating capability decisions to focused seams.
  - Delegates sidecar process/worker launch primitives through `plugin/sidecar-runtime.ts`, agent-tool/Cron/GC planning through the execution capability seam, prompt-injection planning through `plugin/prompt-injection-capability.ts`, model-provider/OAuth/Pi Auth assembly through the model-provider capability seam, ingress routing through the ingress capability seam, and notification-provider plus embedding execution through focused capability seams.

- `plugin/sidecar-runtime.ts`
  - Owns Plugin System v1 sidecar runtime primitives for process command construction, worker-thread wrapping, environment shaping, JSON-frame writes, bounded line reads, and default memory-limit constants shared by the manager and runtime-focused tests.

- `plugin/notification-capability.ts`
  - Owns Plugin System v1 notification-provider delivery decisions for provider sidecar request planning, Plugin Settings injection and missing-setting failures, provider receipt normalization, and retryable provider failure receipts shared by sidecar dispatch and notification outlet delivery.

- `plugin/embedding-capability.ts`
  - Owns Plugin System v1 embedding execution decisions for authenticated context checks, user embedding-model selection parsing, embedding-capable provider/model matching, provider invocation planning, and embedding vector/result normalization shared by sidecar host APIs and Pi vector tooling.

- `plugin/execution-capability.ts`
  - Owns Plugin System v1 agent-tool, Cron, and GC capability decisions for thread-visible tool listing, sidecar request planning, unavailable/unregistered callback errors, callback timeout and cancellation diagnostics, local-setting injection for thread tools and plugin crons, and GC failure mapping shared by the sidecar manager and Pi plugin tool wrapper.

- `plugin/prompt-injection-capability.ts`
  - Owns Plugin System v1 prompt-injection capability decisions for thread-visible registration listing, sidecar request planning, and callback result normalization shared by the sidecar manager and prompt assembly paths.

- `plugin/model-provider-capability.ts`
  - Owns Plugin System v1 model-provider capability decisions for refresh state, refreshed configuration normalization, catalog registration listing, OAuth provider registration helpers, and Pi Auth/API-key binding resolution shared by the sidecar manager and Pi model catalog.

- `plugin/ingress-capability.ts`
  - Owns Plugin System v1 ingress sidecar request planning, poll-source registration and cursor hydration, batch routing through `PluginIngressBatchProcessor`, link confirmation source replies, active reply-to-source contexts, and poll-failure classification shared by the sidecar manager and reply tool.

- `plugin/sidecar-capability-seams.ts`
  - Describes internal Plugin System v1 sidecar capability boundaries for lifecycle, diagnostics, tools, Cron, GC, ingress, model providers, embedding providers, notification providers, OAuth, Pi Auth bindings, and prompt injections without changing manifest or RPC schema.
  - Centralizes sidecar operation dispatch classification, required-settings gating, static-provider cache eligibility, and bounded diagnostic retention helpers consumed by `plugin/sidecar-manager.ts`.

- `plugin/model-providers.ts`
  - Converts active Plugin System v1 provider configurations into Pi model-registry provider registrations keyed as `plugin_id/provider_id/configuration_id/model_id`.
  - Supplies provider labels and `No models` placeholder status rows for plugin configurations that are active but currently expose no model entries.

- `plugin/startup-registrations.ts`
  - Normalizes and validates the typed startup registration payload returned by a plugin sidecar after QuickJS setup.
  - Enforces manifest membership, duplicate checks, per-capability registration limits, and callback timeout bounds for setup-declared capabilities.

- `plugin/tool-access.ts`
  - Normalizes thread-scoped plugin access group keys, lists thread-selectable groups from active approved plugins, and filters registered plugin tools so access groups affect tool visibility without granting host API permissions.

- `plugin/quickjs-runtime.ts`
  - Loads built plugin entrypoints into a restricted QuickJS runtime, injects the v1 `@metidos/plugin-api` shim, supports async setup/top-level-await-style startup, and withholds raw Bun/Node/fetch/timer globals.
  - Collects initialization-only agent tool, global cron, and notification provider registrations, enforcing cron/provider permissions, registration limits, callback timeouts, and provider receipt result shape before exposing handles to the host.
  - Keeps the approved runtime alive after startup so registered callback handles can be invoked with per-call deadlines, then disposes the QuickJS context during sidecar shutdown.

- `plugin/sidecar-main.ts`
  - Sidecar process entrypoint that accepts host protocol frames over stdin, builds approved plugin entrypoints, executes startup in QuickJS, reports setup registrations through `sidecar.ready`, invokes `tool.call` validate/action callbacks, and observes shutdown/cancellation frames.

- `pi/plugin-tools.ts`
  - Wraps sidecar-registered Plugin System v1 agent tools as Pi custom tools named `plugin_id_tool_name`, passing thread/project/user context into sidecar execution and converting text, markdown, image URL, and permission-checked image file results into controlled Pi tool content.

- `project-procedures.ts`
  - Exposes all RPC procedure implementations consumed by the frontend.
  - Translates authorization/RPC inputs into project, worktree, thread, file content, and git-history operations while shared lifecycle ordering lives under `project-procedures/work-context-lifecycle.ts`.
  - Centralizes authoritative thread metadata mutations so the UI and sidecar invalidate caches through the same backend path.
  - Maintains in-memory caches/polling state, manages worktree background refresh loops, and publishes change events to connected clients through lifecycle event dispatch.
  - Rejects unavailable provider-qualified model selections before thread creation, thread-start requests, queued runs, and cron mutations so missing plugin/Pi provider setup fails fast instead of silently failing later in the runtime.
  - Also owns runtime recovery (interrupted turns), startup cache warmup, and runtime stats consumed by overload logging.

- `project-procedures/work-context-lifecycle.ts`
  - Owns shared Project/Worktree/Thread lifecycle decisions used by RPC, Pi-native tools, Cron, and Plugin ingress callers.
  - Coordinates worktree visibility/root fallback hydration, create/open/polling sequencing, thread detail/cache policy, caller-owned create-or-reuse plus first-message queueing, stop/recovery decisions, and explicit cache-invalidation/listener-publication events.

- `pi/thread-tool-policy.ts`
  - Centralizes the safe-versus-unsafe built-in Pi tool policy for thread runtimes, including active file/bash tool names, runtime prompt copy, and unsafe child-escalation allowance.

- `pi/thread-runtime.ts`
  - Metidos-owned Pi runtime adapter for per-thread execution.
  - Resolves the Pi model, constructs the bounded Pi tool surface, applies worktree path policy, and creates/resumes deterministic Pi sessions under Metidos app data.
  - Also wires per-thread web-server hosts into the stable share-layer bookkeeping so hosted sites mint durable share/open URLs while preserving thread-local ownership and teardown semantics.
  - Treats provider-qualified model ids as authoritative at runtime so plugin and Pi provider identities remain stable.
  - Defines the current Pi-era safe-vs-unsafe policy: safe threads keep worktree-scoped file/search/edit/write tools but lose `bash`, while unsafe threads also gain `bash` and may request unsafe child threads or cron jobs.
  - New interactive threads and cron definitions now default to that safe posture unless the `metidos:unsafe` permission is requested through an local-operator-authorized path.
  - Installs Pi-native tool packs from the thread's canonical `permissions` array, using native `metidos:*` ids such as `metidos:git`, `metidos:github`, `metidos:agents`, `metidos:threads`, and `metidos:crons`.
  - Normalizes accidental outer shell-style quotes on Git path arguments before worktree resolution so model-generated tool calls recover from quoted inputs without weakening escape checks.
  - Installs thread-selected Plugin System v1 tools from active sidecars using plugin permission ids shaped as `[plugin_id]:[access_id]`, which affect visibility but do not grant host API permissions.
  - Enables Pi skill discovery for project-local skills that live inside the current workspace, such as repo-owned `.pi/skills/**/SKILL.md`, while excluding unrelated global host skills from thread context.
  - Browser control and screenshot capture are provided by Plugin System browser plugins such as `chrome_browser`; the Metidos runtime no longer installs built-in `webview_*` tools.
  - Binds the shared browser-facing Pi extension UI bridge when the Bun runtime provides one, allowing session extension prompts and status/widget updates to escape the headless session layer.
  - Runs delegated helper tasks as isolated in-process Pi child sessions that inherit the parent thread’s workspace/model/tool policy while excluding recursive agent tools.
  - Reopens the explicitly persisted Pi session file when a thread already has one instead of relying only on “most recent session” behavior.
  - Serves as the primary bridge between Metidos thread records and Pi `AgentSession` instances.

- `pi/thread-runtime.test.ts`
  - Focused unit coverage for deterministic Pi session directories, explicit session reopen behavior, and safe-vs-unsafe tool gating without asserting model-generated output.

- `pi/sqlite-tools.ts`
  - Pi-native project-scoped SQLite access for database files inside the current worktree.

- `pi/lancedb-store.ts`
  - Lightweight LanceDB-style vector store helpers that keep workspace/plugin vector records in bounded local files and enforce query/upsert/delete limits.

- `pi/lancedb-tools.ts`
  - Pi-native project-scoped vector tools (`lancedb_upsert`, `lancedb_query`, `lancedb_delete`) gated by `metidos:lancedb`, with text queries embedded through the configured Metidos embedding provider.

- `pi/web-server/tools.ts`
  - Pi-native per-thread `web_server_host`, `web_server_stop`, and `web_server_list` tools for project-scoped static hosting.
  - Keeps direct thread-owned static servers on dynamic ports while also minting stable share/open URLs plus clean `/s/<thread>/<server>/...` routes backed by persisted share state.

- `pi/web-server/thread.ts`
  - Worker thread that owns one direct per-thread static HTTP server on an auto-selected dynamic port.
  - Serves the actual hosted file or directory while the separate share worker proxies bytes to it over loopback.

- `pi/web-server/share.ts`
  - Shared stable-share helpers for opaque token hashing, cookie serialization, fixed-port origin resolution, and clean-route URL construction.

- `pi/web-server/share-thread.ts`
  - Dedicated fixed-port share/proxy worker that validates opaque claim URLs, mints cookie-backed share sessions, and proxies `/s/<thread>/<server>/...` traffic to the current loopback dynamic port.

- `pi/web-server/share-worker.ts`
  - Main-process bootstrap wrapper for the dedicated share worker.
  - Starts and stops the fixed-port share listener independently from the main Bun HTTP server so large static responses do not bottleneck the main request loop.

- `pi/extension-ui.ts`
  - Shared Bun-side bridge that turns Pi `ExtensionUIContext` calls into Metidos websocket/RPC traffic.
  - Tracks thread-scoped editor text, handles interactive prompt responses, and emits browser-facing events for notifications, status lines, widgets, title changes, working-message overrides, and hidden-thinking labels.

- `pi/extension-ui.test.ts`
  - Focused coverage for Pi extension dialog fallbacks, round-trip browser responses, and editor/status/widget event emission.

- `pi/agents-tools.ts`
  - Pi-native agents/plan tool pack that gives the `Agents` toggle a real meaning in the Pi runtime.
  - Exposes `update_plan` for explicit ordered plan tracking plus `delegate_task` for one-shot isolated helper execution.
  - Intentionally stops short of Codex-style persistent child-agent lifecycle semantics so the browser/UI migration can remain incremental.

- `pi/agents-tools.test.ts`
  - Focused coverage for plan validation/state updates plus bounded delegated-task host integration and streamed partial results.

- `pi/metidos/tools.ts`
  - Pi-native Metidos custom tool-pack entrypoint for thread metadata/listing/creation and cron management.
  - Now composes smaller domain files under `pi/metidos/` so scope checks, schemas, and host wiring no longer live in one monolith.
  - Reuses the existing backend scope rules and authoritative procedure layer so the Pi path no longer needs a Metidos MCP bridge for those operations.
  - Enforces the current unsafe escalation rule so safe threads cannot create unsafe child threads or cron jobs even though they still retain worktree-scoped edit and write tools, and omitted `metidos:unsafe` permissions stay on the safe path by default.
  - Wraps each Metidos tool with runtime-stats instrumentation plus shared bounded budgets so per-tool calls, explicit unsafe-mode requests, and saturation events are all visible through the shared diagnostics snapshot.

- `pi/metidos/tools.test.ts`
  - Focused coverage for the Pi Metidos-tool port, including metadata updates, scoped thread listing, cron creation/update, the auto-start versus immediate-start thread flow, and the shared tool telemetry and saturation-budget counters.

- `pi/github-tools.ts`
  - Pi-native GitHub custom tool pack backed by the local GitHub CLI.
  - Exposes current-repository GitHub inspection tools for repository metadata, issues, pull requests, CI checks, and pull-request diffs.
  - Uses `gh api` for structured GitHub reads while keeping repository scope bound to the thread worktree.

- `pi/github-tools.test.ts`
  - Focused coverage for the Pi GitHub-tool pack, including repository inspection, issue and pull-request reads, CI checks, and diff truncation behavior.

- `pi/builtin-provider-settings.ts`
  - Bridges plugin settings and selected environment fallbacks into Pi built-in provider auth storage, including API-key bindings, Codex auth-file import, and OAuth-file import.

- `pi/ingress-reply-tool.ts`
  - Exposes the scoped reply-to-source tool for plugin request ingress threads, binding replies to the current thread's response target instead of arbitrary external destinations.

- `app-schema-plan.ts`
  - Owns the App Data SQLite schema seam used by `db.ts`, including schema-version readiness checks, skip-path detection for current databases, DDL creation, incremental column repair, and legacy rebuild ordering for auth, calendar, plugin ingress, permissions, worktrees, and web-server shares.

- `db.ts`
  - Defines the local SQLite persistence entrypoint and domain operations on top of the App Data schema seam.
  - Stores projects, worktrees, threads, messages, auth state, session rows, websocket tickets, security audit events, thread usage telemetry, and the stable web-server share/session rows used by the fixed-port share worker.
  - Thread rows now persist first-class Pi session references (`piSessionId`, `piSessionFile`, `piLeafEntryId`) as the authoritative runtime identity for active agent sessions.
  - Applies the shared SQLite runtime pragmas used by the main app and cron-sidecar connections, including WAL-mode journaling and the standard busy-timeout setting.
  - Keeps the hottest project/thread listing reads aligned with explicit SQLite indexes so project ordering no longer needs a temp sort and thread ordering can use an expression index that matches the pinned-first recency order.
  - Reuses the existing thread-message indexes for paged message reads and activity-item lookups instead of adding speculative extra message indexes.
  - Handles typed record types, owner-only file permissions, owner-only permissions for newly created app-data directory trees where supported, and path selection for the controlled local-installation app data location.
  - Exposes destructive maintenance helpers for clearing the local database files when a full reset is requested.

- `git.ts`
  - Encapsulates all git command execution and parsing used by procedures.
  - Resolves `git` binary, schedules commands with foreground/background priority, and enforces abort/cancel behavior.
  - Implements worktree snapshots, status/diff scanning, file content paging, history/log parsing, and commit diff retrieval.

- `project-procedures/model-catalog.ts`
  - Houses the Pi-backed model catalog used by model pickers, validation, and provider resolution.
  - Builds a normalized multi-provider catalog from Pi `ModelRegistry` plus Plugin System v1 model-provider registrations, emits canonical provider-qualified keys, and preserves legacy raw-id fallback for older thread rows.
  - Keeps provider setup and discovery plugin-owned; Metidos no longer exposes bespoke provider-auth or provider-configuration RPCs.
  - Tracks provider/model metadata such as reasoning support, context-window size, and whether a provider is currently runnable.
  - Provides token-context utilities used for compaction/size logic.

- `project-procedures/pi/session-telemetry.ts`
  - Maps live Pi `AgentSession` telemetry onto Metidos thread payloads.
  - Hydrates thread usage from Pi context-usage estimates, derives compaction history from Pi session entries, and surfaces live streaming/compaction phase plus queued-message counts on thread status payloads.

- `project-procedures/directory-suggestions.ts`
  - Maintains cached directory suggestions for path-like user input.
  - Supports suggestion query parsing (`~`, prefixes), fast reads, periodic refresh, and LRU-style expiry.
  - Helps UI/project-creation workflows avoid repeated filesystem scans.

- `project-procedures/workspace-path-policy.ts`
  - Owns Backend Workspace path normalization for Project, Worktree, directory suggestion, and Request Ingress route callers.
  - Centralizes local-operator restricted workspace homes, allowed-path checks, nearest-existing-ancestor symlink validation, and `~` display formatting so Mainview folder prompts and Backend route validation share one policy seam.

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
  - Stays the aggregate compatibility entrypoint for shared RPC payload imports while focused domain modules under `rpc-schema/` own localized contract groups.
  - Keep `AppRPCSchema` and `ProjectProcedures` here, place new domain-owned payload shapes in `rpc-schema/<domain>.ts`, re-export them here, and update `rpc-schema.contract.test.ts` so typecheck catches aggregate/domain drift.

- `rpc-schema/`
  - Houses domain-owned RPC payload modules for large contract groups such as Plugin System v1, project/worktree, thread/message, terminal, cron, model catalog, notification, settings, and Mainview bootstrap payloads.
  - Documents the contract ownership and aggregate re-export rule in `rpc-schema/README.md`.

- `rpc-authz.ts`
  - Centralizes small backend RPC authorization helpers.
  - Encapsulates cross-workspace thread-target detection so audit rules stay unit-testable without prompting for elevated authentication.

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
  - Provides the scope-enforcement helpers shared by Metidos-owned Pi tool packs.
  - Canonicalizes worktree paths and blocks bound thread/project/worktree escapes.

- `terminal-manager.ts`
  - Owns managed terminal session lifecycle, PTY bridge startup, output buffering, and kill/view/grep operations used by unsafe Metidos terminal tools.

- `terminal-pty-bridge.cjs`
  - CommonJS node-pty bridge process used to keep terminal IO integration isolated from the main Bun runtime boundary.

- `sidecar-thread-metadata.ts`
  - Shared helper for sidecar thread metadata mutations.
  - Normalizes optional summary/title inputs and routes updates through `updateThreadMetadata(...)`.
  - Surfaces timeout and connection failures instead of silently falling back to local-only writes.

- `sidecar-cron-runner.ts`
  - Executes cron rows by creating Metidos child threads and sending the cron prompt through the same Pi-backed thread runtime used for interactive work.
  - Applies a bounded scheduler-fired launch cap so bursts of due cron jobs do not spawn unlimited child-thread starts at once, while leaving manual `runCronJobById()` behavior direct and predictable.
  - Tags cron-spawned threads with their source cron id and refuses to launch a second run for the same cron while the earlier run is still active.
  - Publishes a context-focus event for scheduler-fired child threads so connected shells can select the newly running cron thread immediately instead of waiting for thread-list polling.
  - Records cron run history, updates last-run metadata, and waits for the spawned thread to settle before marking completion, stop, or error state.
  - Emits runtime telemetry for cron active-run counts, pending scheduled launches, saturation events, timeouts, and run-duration totals so later scheduler work stays measurement-led.
  - Opens its SQLite handle with the same WAL-mode runtime pragmas as the main app so cron reads and writes participate in the same concurrency expectations.
  - Also exposes a small execution-host seam plus limiter stats helper so runtime integration and queue-pressure behavior can be tested without changing the production scheduler path.

- `sidecar-cron-runner.test.ts`
  - Integration coverage for immediate and scheduled cron execution through the Pi-backed thread path.
  - Verifies that cron-created threads persist Pi session identity and source-cron provenance, that overlapping launches for the same cron are blocked, that stale in-progress cron state is only cleared when a user manually restarts the cron, and that the scheduled-launch limiter plus cron runtime telemetry expose active versus pending queue pressure under bursty schedule fires.

- `sidecar-cron-scheduler.ts`
  - Owns the current in-process `Bun.cron` registration set for enabled cron jobs.
  - Starts or stops registrations, syncs cron handles after DB changes, monitors timezone offset changes, and hands due fires to `sidecar-cron-runner.ts` so cron-created threads use the same runtime ownership, stop path, and live-update behavior as frontend-created threads.

- `sidecar-cron-thread.ts`
  - Legacy worker-thread prototype retained only for focused historical tests while runtime cron scheduling uses `sidecar-cron-scheduler.ts` directly.
  - Do not wire new production behavior through this module unless the scheduler is intentionally moved back out of process.

- `auth/index.ts`
  - Provides the core auth primitives used by setup/login/logout and password/TOTP setup flows.
  - Handles Argon2id hashing, TOTP secret/URI generation and verification, recovery-code generation, and opaque token creation for sessions and websocket tickets.
  - Enforces the current primary-factor policy: PINs must be at least 6 digits and avoid obvious sequential/repeated patterns, while passwords/passphrases must be at least 12 characters.
  - Keeps the current custom TOTP policy explicit and test-backed: SHA-1 HMAC, 6 digits, 30-second periods, and a `+/-1` verification window for modest clock skew.

- `auth/secrets.ts`
  - Manages the local encryption key used to protect persisted TOTP secrets at rest.
  - Encrypts and decrypts stored auth secrets with a locally generated AES-GCM key.
  - Decrypt paths now fail loudly when `auth-secret.key` is missing or mismatched instead of silently minting a replacement key during login flows.
  - Enforces owner-only POSIX permissions for `auth-secret.key` and newly created app-data directory trees where supported; on Windows it emits non-blocking ACL guidance because operators must restrict the app data directory and `auth-secret.key` with Windows ACLs.

- `auth/usernames.ts`
  - Shared local-operator name normalization and workspace-home safety checks used by auth provisioning.
  - New first-run local-operator names have to stay path-safe, while existing historical names remain login-compatible.

- `auth/rate-limit.ts`
  - In-memory backoff for the local HTTP auth surface.
  - Applies peer and peer+subject failure windows to `/auth/setup`, `/auth/login`, `/auth/recovery-login`, and `/auth/step-up`, returning `429` plus `Retry-After` when repeated failures hit the local auth endpoints.

- `auth/service.ts`
  - Stable public entrypoint for the backend auth flow used by setup/login/logout and session checks.
  - Re-exports the focused auth-service modules so existing imports stay stable while setup/login, session/ticket, cookie, and low-level helper logic evolve independently.

- `auth/service-core.ts`
  - Shared auth-service types, stable error codes, and low-level helpers for timing, lockout state, configured-user resolution, session creation, and audit events.
  - Keeps the reusable auth state transitions out of the public entrypoint so later hardening work can touch smaller files.
  - Applies lockout failure counting inside an immediate SQLite transaction so concurrent bad logins cannot undercount toward the 3-attempt lockout window.

- `auth/service-login.ts`
  - Implements setup, auth-status reads, TOTP login, and recovery-code login on top of the DB/auth/auth-secret helpers.
  - Owns the setup/login-side audit events, new-username validation, and lockout/error handling for the primary sign-in paths.

- `auth/service-session.ts`
  - Implements session resolution/touch, logout, optional step-up timestamp updates, and websocket ticket issuance/consumption.
  - Owns the live-session-side auth checks used by websocket upgrades.

- `auth/service-cookies.ts`
  - Parses and serializes the session and websocket-ticket cookies used by the HTTP and RPC auth surfaces.
  - Keeps cookie-header details isolated from the login/session lifecycle logic.

- `auth/reset.ts`
  - Implements the command-line recovery and primary-factor reset flow for single-user local installs.
  - Verifies the configured primary factor plus TOTP before regenerating recovery codes or replacing the PIN/password.
  - Records security audit events for authenticated primary-factor resets and recovery-code regeneration.
  - Depends on the existing `auth-secret.key`; if that key is lost, the documented recovery path is a full local auth reset followed by TOTP re-enrollment.

- `dev-flows.ts`
  - Parses the explicit development-only reset flag (`METIDOS_DEV_RESET=1`).
  - Rejects the reset flag outside dev mode and provides the local-state reset helper that wipes the SQLite/auth-secret files plus the optional telemetry sidecar database.

- `server-security.ts`
  - Centralizes local transport hardening helpers shared by the Bun entrypoints.
  - Defines loopback bind defaults, minimal liveness payloads, browser `Origin` allowlist parsing/validation for websocket upgrades, and the shared response security headers/CSP policy.

- `starvation-harness.ts`
  - Optional benchmarking harness to exercise startup, HTTP, and RPC behavior under worker concurrency.
  - Produces timing summaries, latency percentiles, runtime-stats snapshots, memory snapshots, and top-byte transport rankings to help validate race/pressure behavior in development and CI-like scenarios.
  - Separates expected git-scheduler preemptions from true pressure-loop failures so queue backpressure stays visible without polluting the failure count.

- `metidos-tool-load-benchmark.ts`
  - Repeatable synthetic benchmark for the bounded Metidos tool paths that the audit called out as likely to regress under agent-heavy pressure.
  - Exercises safe versus unsafe child-thread and cron mutations, and reports latency plus per-budget runtime-stats counters so future budget changes can be compared against a stable local baseline.
  - Use together with the starvation harness via [performance-validation-workflow](../../.wiki/performance-validation-workflow.md) when validating the current performance/load story.

## Notes

- This folder is runtime-critical: changes here impact startup, RPC contracts, persistence, and thread execution behavior.
- Bun listeners stay on loopback HTTP/WS. Use `--tls` or `METIDOS_TLS=1` only when an upstream reverse proxy is terminating TLS for browser traffic.
- Default reverse-proxy loopback origins on `http://localhost`, `https://localhost`, `http://127.0.0.1`, and `https://127.0.0.1` are accepted automatically; set `METIDOS_PUBLIC_ORIGIN` for the primary browser-facing host and `METIDOS_ALLOWED_WS_ORIGINS` only when you need extra origins or ports. Public TLS mode requires browser websocket requests to send an allowlisted `Origin` and a fresh `/auth/ws-ticket` cookie.
- In public TLS mode, `/health/runtime-stats` and `/health/runtime-stats/reset` require either a valid local-operator admin session cookie or `METIDOS_RUNTIME_STATS_SECRET` via `X-Metidos-Runtime-Stats-Secret`/Bearer auth. Header and bearer candidates are trimmed before the timing-safe digest comparison, while the configured secret remains exact.
- Bun auto-loads `.env` for the repo-local start scripts; copy `.env.example` to `.env` and set `METIDOS_PUBLIC_ORIGIN=https://metidos.example.com` when you want the TLS scripts to accept that host by default.
