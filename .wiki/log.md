# Wiki Log

## [2026-05-28] audit | Wiki public-readiness pass
- Sifted `.wiki/` and `.wiki/raw/` for obvious public-readiness concerns before open-source publication.
- Replaced benchmark examples that named a local Metidos worktree path with placeholder paths.
- Promoted durable auth, App Data, provider, and performance-validation guidance into public docs.
- Recorded the pass in `docs/wiki-public-readiness-audit-2026-05-28.md`.

## [2026-05-23] implementation | Auth secret parent directory warnings
- Updated `.wiki/local-auth-hardening.md` to record the auth secret parent-directory warning boundary for same-owner POSIX ancestors.
- Clarified that sticky shared directories and differently-owned directories are treated as trust boundaries rather than warning targets.

## [2026-05-23] implementation | Auth reset process containment
- Updated `.wiki/local-auth-hardening.md` to record that browser PIN/password reset now closes authenticated websockets, terminates affected terminal PTYs, and aborts active Pi thread turns.
- Clarified that Pi thread runtime ownership is currently per persisted local operator, so reset aborts active turns globally rather than by browser session.

## [2026-05-23] maintenance | Auth reset process boundary
- Updated `.wiki/local-auth-hardening.md` to document that browser PIN/password reset currently revokes auth sessions but does not terminate PTY processes or abort in-flight Pi runtime turns.
- Recorded the operational containment guidance and future Backend hook boundary for reset hardening.

## [2026-05-23] query | Plugin sidecar and ingress concurrency audit
- Reviewed `src/bun/plugin/sidecar-manager.ts` and `src/bun/plugin/ingress-batch-processor.ts` for security/concurrency boundaries.
- Recorded the existing sidecar in-flight, host-callback, timeout, cancellation, and ingress sequential-processing controls.
- Added `.wiki/plugin-sidecar-ingress-security-concurrency-audit.md` with bounded follow-up candidates rather than mixing audit results with speculative refactors.

## [2026-05-20] implementation | Plugin prompt injection access model
- Updated the thread access-control note to treat `metidos:prompt_inject` as a Plugin System v1 manifest permission, not a native thread tool-family permission.
- Documented that prompt injection runs from plugin access groups declaring `access[].injects[]`, with non-empty injection content prepended to the user's thread prompt.

## [2026-05-20] maintenance | Ubiquitous language refresh
- Refreshed `UBIQUITOUS_LANGUAGE.md` for the current Local Operator, Manage App Capability, Plugin Settings, Step-up Authentication, embedding/vector, Request Ingress, calendar/notification/terminal, diagnostics, and Mainview/Backend terms.
- Updated provider configuration wiki notes for OpenRouter, Build NVIDIA, Ollama, and Codex so they use the single-map Plugin Settings language instead of stale global/user/general setting scopes.
- Updated the Workspace path policy and Project procedures notes to use Local Operator and Manage App Capability terminology while preserving named legacy compatibility strings where they remain part of the code contract.

## [2026-05-14] query | App Data schema migration invariants
- Mapped the current `migrateDatabase` startup sequence, including schema-version skip checks, required tables/columns/indexes, and write-last version marker behavior.
- Documented risky legacy database shapes already covered by migration tests: singleton settings/auth moves, ownerless Project/notification/Web share rebuilds, tracked Worktrees, Calendar foreign-key repairs, Plugin ingress repairs, and legacy access-column cleanup.
- Clarified the future App Data schema seam boundary so schema planning and migration orchestration stay separate from domain CRUD helpers.

## [2026-05-14] implementation | Workspace path policy module
- Added `src/bun/project-procedures/workspace-path-policy.ts`, moving Workspace scope construction, path normalization, display formatting, nearest-existing-path checks, and allowed-path assertions behind a Backend-owned seam.
- Updated Project procedures to consume the seam for Project, Worktree, and directory suggestion path handling while preserving current admin/restricted Local Operator behavior.
- Added focused policy tests for restricted scopes, tilde handling, allowed/rejected paths, symlink escape rejection, and directory suggestion option projection.

## [2026-05-14] query | Workspace path policy invariants
- Mapped the current Backend Workspace path policy, including scope resolution, tilde semantics, restricted-root checks, nearest-existing-ancestor realpath validation, and stable error messages.
- Documented the Project, Worktree, directory suggestion, Thread/Cron, terminal, and Plugin ingress route callers that must share the future policy seam.
- Recorded Mainview folder selector mirror behavior and the existing/new tests that should move to the extracted policy boundary.

## [2026-05-13] maintenance | Provider model discovery fallback removal
- Updated the Build NVIDIA provider note and README provider table to record that discovery failures and empty upstream catalogs return no models instead of curated fallback entries.
- Updated Plugin System v1 model-provider guidance so disappearing plugin models are removed from the catalog instead of being synthesized as cached unavailable fallback rows.
- Updated the copyable Ollama model provider example guidance so discovery failures expose an empty model list, while static `models[]` are explicit only when discovery is disabled.

## [2026-05-11] test | Mainview transcript regression guardrails
- Added focused transcript pipeline/state coverage, including large assistant text routing/non-copying view models, markdown/code routing, large diff worker-threshold summaries, tool-call summaries, media row descriptors, and history backfill row stability.
- Updated `src/mainview/app/README.md` and the transcript pipeline seam note to name the seam as the primary regression surface for transcript rendering performance-sensitive decisions.

## [2026-05-10] implementation | Mainview transcript view-model consumption
- Added transcript view-model item projection in `src/mainview/app/transcript-pipeline.ts`, bundling classification, expansion state, assistant visibility, and copy-affordance policy for chat renderers.
- Updated desktop and mobile chat rows to consume view-model items while `message-ui.tsx` composes visual components from the prepared item contract.
- Refreshed the transcript pipeline seam note and focused tests for view-model projection and prepared item rendering.

## [2026-05-10] implementation | Mainview transcript state seam
- Moved visible transcript row projection, media payload extraction, compact row signatures, cache pruning/reuse, Thread history merging, busy state, and synthetic transcript rows behind `src/mainview/app/transcript-state.ts`.
- Kept `use-visible-messages.ts` as the React adapter for deferred selected-Thread updates while `chat-workspace.tsx` now consumes transcript-pipeline expansion-state resolution for command/tool/diff rows.
- Added `.wiki/mainview-transcript-pipeline-seam.md` and focused transcript-state/pipeline tests for history stability, media payload projection, busy rows, and expansion semantics.

## [2026-05-10] implementation | Mainview composition shell collapse
- Moved React shell-state ownership into `src/mainview/app/use-mainview-shell-controller.ts`, keeping selected Project/Worktree/Thread refs, primary-view navigation commands, sidebar persistence, mobile/completed Thread indicators, and debounced shell persistence behind one hook interface.
- Moved cron workspace refresh, invalidation, run/delete busy state, creator/editor state, and folder-selection orchestration into `src/mainview/app/mainview-cron-workspace-controller.tsx` so `App.tsx` composes the cron surface instead of carrying the lifecycle cluster inline.
- Updated `src/mainview/app/README.md` and `.wiki/mainview-shell-orchestration-seam.md` to document the shell controller interface and remaining composition role.

## [2026-05-10] implementation | Mainview Thread runtime reconciliation seam
- Moved Thread start-request queue updates, Thread status event store acceptance/upsert logic, selected-Thread detail refresh markers, and completed-Thread/mobile indicator transitions behind `src/mainview/app/mainview-shell-state.ts`.
- `App.tsx` now routes runtime Thread events and completed indicators through shell helpers while keeping RPC subscriptions and notification/unread behavior in their existing controller paths.
- Added focused shell-state tests for working, stopped, errored, and completed Thread transitions plus start-request de-duplication and Thread status event acceptance.

## [2026-05-10] implementation | Mainview Project Worktree hydration seam
- Moved loaded Worktree cache update construction, hidden Worktree menu hydration/open planning, optimistic Worktree pin planning/rollback, and selected-Thread active Worktree reconciliation decisions behind `src/mainview/app/mainview-shell-state.ts`.
- `App.tsx` no longer imports the raw loaded-Worktree cache builder and now routes visible Project/Worktree hydration details through shell helpers while preserving Project tree state and pin behavior.
- Added focused shell-state tests for loaded Project hydration, open Worktree preservation, hidden Worktree initial selection, pin optimistic/rollback behavior, and active Worktree missing-state reconciliation.

## [2026-05-10] implementation | Mainview navigation persistence seam
- Moved Mainview navigation commits and persisted-state write scheduling behind `src/mainview/app/mainview-shell-state.ts`.
- `App.tsx` now routes selected Project/Worktree/Thread, primary-view changes, and debounced Mainview-state writes through shell helpers while preserving storage compatibility.
- Added focused shell-state tests for navigation commit ref/setter alignment and debounced persistence flushing.

## [2026-05-10] implementation | Mainview shell state module
- Added the initial `src/mainview/app/mainview-shell-state.ts` seam and updated `.wiki/mainview-shell-orchestration-seam.md` with adoption status.
- The first implementation centralizes shell snapshots, selection transitions, Project selection fallback, and persisted state construction; write scheduling remains a follow-up.

## [2026-05-10] query | Mainview shell orchestration seam
- Mapped the current `src/mainview/App.tsx` shell state cells, existing controller seams, transition invariants, and validation surfaces.
- Added `.wiki/mainview-shell-orchestration-seam.md` as the durable note for the follow-up shell-state Module slice.
- Expanded Project/Worktree/Thread transition and startup-restore tests around Context Focus and Thread-owned startup selection preservation.

## [2026-05-09] maintenance | Ollama native discovery priority
- Updated the Ollama configuration note after changing the core plugin to query native `/api/tags` before `/v1/models`, matching local `ollama list` inventory.
- Recorded the Podman host-loopback allowlist, unsafe private-network runtime requirement, and removal of the misleading `llama3.2` fallback model.

## [2026-05-09] maintenance | Remaining documentation upgrades
- Refreshed core plugin guidance for OpenAI and Notion embedding/vector behavior and expanded host `.env.example` provider/plugin coverage.
- Split local Podman deployment details into `deploy/podman/LOCAL.md`, added `docs/operator-runbook.md`, and linked operator guidance from top-level docs.
- Reorganized `.wiki/index.md`, added `.wiki/mainview-accessibility-status.md`, refreshed project-procedures architecture notes, updated plugin-authoring references, and marked stale xAI task wording with an outcome.

## [2026-05-09] maintenance | Installation documentation verification
- Audited the canonical installation skill, README provider table, INSTALLATION pointer, Docker templates, and Podman deployment notes against current package scripts and deployment files.
- Updated Docker template copy steps, GitHub Copilot auth-file guidance, container env verification, utility plugin env names, plugin examples, and recovery-code reset commands.

## [2026-05-09] maintenance | Deep markdown documentation refresh
- Updated the thread runtime tool policy inventory for the landed `thread-tool-policy.ts` seam, native `metidos:lancedb` tools, and then-current hidden prompt-injection access.
- Refreshed backend, project-procedure, mainview, app, controls, and source-tree READMEs with current modules for LanceDB, terminal sessions, calendar/cron workspaces, persisted stores, plugin ingress, and provider auth bridging.
- Expanded `UBIQUITOUS_LANGUAGE.md` with embedding providers, LanceDB tools, plugin vector stores, and terminal tools.

## [2026-05-09] maintenance | Markdown documentation refresh
- Refreshed `UBIQUITOUS_LANGUAGE.md` with current terminology for owner-only app-data directory setup and the hidden Prompt Injection Capability.
- Updated thread access wiki pages to document the then-current internal native prompt-injection permission hidden from the normal access-control picker.
- Updated auth/backend/task guidance to remove stale status wording and record current owner-only app-data directory behavior.

## [2026-05-02] spike | Plugin Sidecar WebSocket Ownership
- Audited the plugin WebSocket path across JS/Python runtime bridges, sidecar host-operation routing, maincar session registry ownership, and `src/bun/plugin/websocket.ts` policy/cleanup semantics.
- Recorded the decision to keep WebSocket connections maincar-owned until measured host-operation traffic justifies sidecar ownership and shared policy/lifecycle control work.

## [2026-05-02] spike | Plugin Sidecar-Local SQLite
- Audited the plugin SQLite path across JS/Python runtimes, sidecar RPC/capability checks, and `src/bun/plugin/sqlite.ts` execution semantics.
- Recorded the decision to defer standalone sidecar-local SQLite because permission revocation, quota accounting, lifecycle locks, and storage GC need a shared sidecar-local storage authority first.

## [2026-04-19] ingest | Karpathy LLM Wiki
- Reviewed Andrej Karpathy's April 2026 LLM Wiki gist.
- Updated `RESEARCH.md` to adopt the repo-specific wiki workflow.
- Seeded `.wiki/index.md` and `.wiki/log.md`.

## [2026-04-19] ingest | Thread Tool Access Controls
- Ingested `docs/2026-04-07-thread-tool-access-controls.md` into `.wiki/thread-tool-access-controls.md`.
- Preserved the durable thread access model, the metadata-only `update_thread` rule, and the Pi-native maintenance boundaries.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-07-thread-tool-access-controls.md` source after ingestion.

## [2026-04-19] ingest | Codex via Pi Wiring
- Ingested `docs/2026-04-09-codex-via-pi-wiring.md` into `.wiki/codex-via-pi-wiring.md`.
- Preserved the one-runtime Pi-native design, provider-qualified `openai` versus `openai-codex` rules, Codex auth precedence, and fail-fast unavailable-provider behavior.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-09-codex-via-pi-wiring.md` source after ingestion.

## [2026-04-19] ingest | Pi Coding Agent Migration
- Ingested `docs/2026-04-09-pi-coding-agent-migration-research.md` into `.wiki/pi-coding-agent-migration.md`.
- Preserved the durable runtime boundary: Metidos remains the application shell while Pi owns provider/model/auth/session/tool runtime concerns.
- Recorded the key migration outcomes for Pi-native tool packs, transcript adaptation, safety policy, and final Codex/MCP runtime removal.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-09-pi-coding-agent-migration-research.md` source after ingestion.

## [2026-04-19] ingest | Ollama via Pi Configuration
- Ingested `docs/2026-04-10-ollama-via-pi-configuration.md` into `.wiki/ollama-via-pi-configuration.md`.
- Preserved the durable rule that Ollama is configured through Metidos's app-data-backed Pi `models.json`, not through a dedicated built-in endpoint environment variable.
- Recorded the relevant `METIDOS_APP_DATA_DIR`, `PI_CODING_AGENT_DIR`, placeholder `apiKey`, provider-shape, and model-refresh behavior.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-10-ollama-via-pi-configuration.md` source after ingestion.

## [2026-04-19] ingest | Runtime Stats Collector
- Ingested `docs/2026-04-11-opt01-1-runtime-stats-collector-proposal.md` into `.wiki/runtime-stats-collector.md`.
- Preserved the durable collector boundary: keep runtime stats process-local, resettable, low-cardinality, and wired into centralized RPC, websocket, SQLite retry, and selected git-cache paths.
- Recorded the explicit non-goals for `OPT01.1`, including no percentile reporting, memory snapshots, persistence, public diagnostics route, or UI scope in this first slice.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt01-1-runtime-stats-collector-proposal.md` source after ingestion.

## [2026-04-19] ingest | Starvation Harness Reporting
- Ingested `docs/2026-04-11-opt01-2-harness-percentile-memory-reporting.md` into `.wiki/starvation-harness-reporting.md`.
- Preserved the durable rule that percentile and memory reporting belong in the benchmark harness workflow while the always-on runtime collector stays low-cardinality.
- Recorded the loopback runtime-stats health endpoints, explicit reset/snapshot measurement windows, and dual human-readable versus `--json` report output.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt01-2-harness-percentile-memory-reporting.md` source after ingestion.

## [2026-04-19] ingest | OPT01 Baseline Benchmark
- Ingested `docs/2026-04-11-opt01-3-baseline-benchmark.md` into `.wiki/2026-04-11-opt01-baseline-benchmark.md`.
- Preserved the repeatable local benchmark workflow, representative startup and pressure measurements, and the durable interpretation that `openWorktree` was the dominant measured pressure path in this first baseline shape.
- Recorded the baseline's reuse guidance for later optimization slices, including the minimum comparison points for startup, pressure percentiles, runtime stats, git cache behavior, SQLite retries, and memory snapshots.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt01-3-baseline-benchmark.md` source after ingestion.

## [2026-04-19] ingest | SQLite WAL-Mode Tuning
- Ingested `docs/2026-04-11-opt02-1-wal-mode-tuning.md` into `.wiki/sqlite-wal-mode-tuning.md`.
- Preserved the durable rule that Metidos should use shared WAL plus `synchronous = NORMAL` pragmas for app and cron SQLite opens because the repository already has a multi-connection database architecture.
- Recorded the deliberate scope boundary for `OPT02.1`: prefer WAL as the justified low-risk concurrency default, but defer cache tuning, index work, and other speculative SQLite changes until later measured slices.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt02-1-wal-mode-tuning.md` source after ingestion.

## [2026-04-19] ingest | SQLite Query-Plan Audit and Indexes
- Ingested `docs/2026-04-11-opt02-2-query-plan-audit-indexes.md` into `.wiki/sqlite-query-plan-indexes.md`.
- Preserved the durable rule that SQLite query-plan work should add only the indexes justified by measured planner evidence, especially for hot project/thread listing sorts.
- Recorded the specific durable outcome: add `idx_projects_last_opened_at_name`, replace the old thread recency index with `idx_threads_listing_order`, align `listThreads()` with the expression index, and leave message indexes unchanged.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt02-2-query-plan-audit-indexes.md` source after ingestion.

## [2026-04-19] ingest | SQLite Retry Metrics
- Ingested `docs/2026-04-11-opt02-3-sqlite-retry-metrics.md` into `.wiki/sqlite-retry-metrics.md`.
- Preserved the durable rule that SQLite retry loops and exhaustion should be counted in `withSqliteRetry()` and surfaced through the shared runtime-stats pipeline rather than a separate diagnostics subsystem.
- Recorded the key closeout detail that `OPT02.3` was primarily a verification and documentation pass because the runtime behavior had already landed and was already informing SQLite scope decisions.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt02-3-sqlite-retry-metrics.md` source after ingestion.

## [2026-04-19] ingest | Mainview Thread-Status Controller
- Ingested `docs/2026-04-11-opt03-1-thread-status-controller.md` into `.wiki/mainview-thread-status-controller.md`.
- Preserved the durable rule that the hot thread-status polling and selected-thread refresh path should live behind a memoized null-render controller boundary rather than inline in `src/mainview/App.tsx`.
- Recorded the supporting pure-helper boundary in `src/mainview/thread-status-refresh.ts`, the documented ownership in `src/mainview/app/README.md`, and the slice's explicit non-goals around protocol, dedupe, and store redesign.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt03-1-thread-status-controller.md` source after ingestion.

## [2026-04-19] ingest | Mainview Project/Worktree and Git-History Controllers
- Ingested `docs/2026-04-11-opt03-2-project-worktree-git-history-controllers.md` into `.wiki/mainview-project-worktree-git-history-controllers.md`.
- Preserved the durable rule that project/worktree loading and git-history orchestration should live in dedicated controller hooks instead of inline in `src/mainview/App.tsx`.
- Recorded the controller ownership split across `src/mainview/app/use-project-worktree-controller.ts`, `src/mainview/app/use-git-history-controller.ts`, related pure helper exports/tests, and the slice's explicit non-goals around websocket, transport, and selection-model redesign.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt03-2-project-worktree-git-history-controllers.md` source after ingestion.

## [2026-04-19] ingest | Mainview Derived-State Memo Cleanup
- Ingested `docs/2026-04-11-opt03-3-derived-state-memo-cleanup.md` into `.wiki/mainview-derived-state-memo-cleanup.md`.
- Preserved the durable rule that mainview should extract hot pure selectors, defer only sidebar search work, and avoid re-sorting thread rows that the indexed store already keeps ordered.
- Recorded the selector-module boundary in `src/mainview/app/mainview-derived-selectors.ts`, the deferred-search memo boundary, the `partitionOrderedThreadsByPinnedState(...)` ordering rule, and the slice's explicit non-goals around broader state-management redesign.
- Updated `.wiki/index.md`, refreshed related wiki cross-links, and removed the original `docs/2026-04-11-opt03-3-derived-state-memo-cleanup.md` source after ingestion.

## [2026-04-19] ingest | Production Mainview Build Modes
- Ingested `docs/2026-04-11-opt04-1-production-mainview-build-modes.md` into `.wiki/production-mainview-build-modes.md`.
- Preserved the durable dev/prod build-mode policy: development stays debug-friendly, production is minified by default, and production sourcemaps are opt-in instead of always emitted.
- Recorded the runtime rule that `/index.js.map` is served only when the current build produced a sourcemap, plus the stale-sourcemap cleanup behavior in `.metidos-build/`.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt04-1-production-mainview-build-modes.md` source after ingestion.

## [2026-04-19] ingest | Mainview Cacheable Asset-Serving Path
- Ingested `docs/2026-04-11-opt04-2-cacheable-asset-serving-path.md` into `.wiki/mainview-cacheable-asset-serving-path.md`.
- Preserved the durable rule that `index.html` stays `no-store` while mainview JS, CSS, fonts, and optional sourcemaps are served from `/assets/mainview/<version>/...` with immutable cache headers.
- Recorded the allowlisted asset-resolution boundary in `src/bun/mainview-assets.ts`, the HTML `__METIDOS_ASSET_ROOT__` placeholder injection flow, the relative font-path rule, and the transitional `no-store` compatibility aliases.
- Updated `.wiki/index.md`, refreshed related wiki cross-links, and removed the original `docs/2026-04-11-opt04-2-cacheable-asset-serving-path.md` source after ingestion.

## [2026-04-19] ingest | RPC Payload Measurement
- Ingested `docs/2026-04-11-opt05-1-rpc-payload-measurement.md` into `.wiki/rpc-payload-measurement.md`.
- Preserved the durable rule that transport optimization should start from ranked runtime evidence by surfacing top response-byte RPC methods and top payload-byte websocket push types.
- Recorded the bounded top-N ranking shape in `src/bun/runtime-stats.ts`, the starvation-harness summary output changes, the representative worktree diff/history-heavy measurements, and the explicit non-goals around transport redesign.
- Updated `.wiki/index.md`, refreshed related wiki cross-links, and removed the original `docs/2026-04-11-opt05-1-rpc-payload-measurement.md` source after ingestion.

## [2026-04-19] ingest | Thread-Status Refresh Dedupe
- Ingested `docs/2026-04-11-opt05-2-thread-status-refresh-dedupe.md` into `.wiki/thread-status-refresh-dedupe.md`.
- Preserved the durable rule that the mainview thread-status controller should reuse in-flight status refreshes for identical working-thread sets and skip selected-detail reloads when the selected summary snapshot is unchanged.
- Recorded the helper/key boundary in `src/mainview/thread-status-refresh.ts`, the controller queueing behavior in `src/mainview/app/use-thread-status-controller.ts`, the selected-detail snapshot key owned from `src/mainview/App.tsx`, and the explicit non-goals around transport or polling-model redesign.
- Updated `.wiki/index.md`, refreshed related wiki cross-links, and removed the original `docs/2026-04-11-opt05-2-thread-status-refresh-dedupe.md` source after ingestion.

## [2026-04-19] ingest | Cron Concurrency Cap
- Ingested `docs/2026-04-11-opt06-1-cron-concurrency-cap.md` into `.wiki/cron-concurrency-cap.md`.
- Preserved the durable rule that scheduler-fired cron launches are bounded by a shared concurrency cap of `2` while manual `runCronJobById()` behavior stays direct.
- Recorded the limiter boundary in `src/bun/sidecar-cron-runner.ts`, the reuse of `createAsyncConcurrencyLimit(...)`, the per-job SQLite handle ownership, and the exported limiter stats for testing and later telemetry.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-11-opt06-1-cron-concurrency-cap.md` source after ingestion.

## [2026-04-19] ingest | Cron Duration and Saturation Telemetry
- Ingested `docs/2026-04-11-opt06-2-cron-duration-saturation-telemetry.md` into `.wiki/cron-duration-saturation-telemetry.md`.
- Preserved the durable rule that cron queue pressure, active/pending counts, timeout counts, and aggregate duration data belong on the shared low-cardinality runtime-stats path rather than a separate metrics subsystem.
- Recorded the runtime-stats helper boundary, the scheduler-limiter measurement model in `src/bun/sidecar-cron-runner.ts`, the starvation-harness reporting surface, and the optional sidecar persistence of cron snapshot totals.
- Updated `.wiki/index.md`, refreshed `.wiki/cron-concurrency-cap.md` cross-links, and removed the original `docs/2026-04-11-opt06-2-cron-duration-saturation-telemetry.md` source after ingestion.

## [2026-04-19] ingest | Optimization Execution Proposal
- Ingested `docs/2026-04-11-optimization-execution-proposal.md` into `.wiki/optimization-execution-proposal.md`.
- Preserved the durable planning rules: treat optimization as gap analysis against the current tree, organize the believable work into six measured tracks, preserve explicit non-goals, and phase execution around shared telemetry first.
- Linked the plan to the already-ingested OPT01-OPT06 outcome pages, updated `.wiki/index.md`, and removed the original `docs/2026-04-11-optimization-execution-proposal.md` source after ingestion.

## [2026-04-19] ingest | Track Telemetry Sidecar Database
- Ingested `docs/2026-04-11-track-telemetry-sidecar-db.md` into `.wiki/track-telemetry-sidecar-db.md`.
- Preserved the durable opt-in `--track-telemetry` path that snapshots process-local runtime diagnostics and persists low-cardinality checkpoints in a separate sidecar SQLite database with startup/shutdown-aware buffering.
- Updated `.wiki/index.md` and `.wiki/runtime-stats-collector.md` with the new optional persistence linkage.
- Removed the original `docs/2026-04-11-track-telemetry-sidecar-db.md` source after ingestion.

## [2026-04-19] ingest | Local Auth Hardening
- Ingested `docs/2026-04-12-auth-hardening-follow-up.md` into `.wiki/local-auth-hardening.md`.
- Preserved the durable local-auth hardening rules for stronger setup/reset factors, transaction-backed lockout counting, explicit `auth-secret.key` recovery failures, path-safe new usernames, loopback `/auth/*` throttling, and the current TOTP verification contract.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-12-auth-hardening-follow-up.md` source after ingestion.

## [2026-04-19] ingest | Execution Boundary Hardening
- Ingested `docs/2026-04-12-execution-boundary-hardening-follow-up.md` into `.wiki/execution-boundary-hardening.md`.
- Preserved the durable execution-boundary baseline: safe-by-default creation posture, no safe-thread escalation into unsafe children, closed concrete vm2 safe-thread escape hatches, and bounded measurable high-risk execution paths.
- Updated `.wiki/index.md`, refreshed `.wiki/thread-tool-access-controls.md` with a related-page link, and removed the original `docs/2026-04-12-execution-boundary-hardening-follow-up.md` source after ingestion.

## [2026-04-19] ingest | Metidos Tool Load Benchmark Baseline
- Ingested `docs/2026-04-12-metidos-tool-load-benchmark-baseline.md` into `.wiki/2026-04-12-metidos-tool-load-benchmark-baseline.md`.
- Preserved the deterministic local benchmark workflow for bounded thread, cron, and sandbox tool budgets, including the fixed absolute cron timestamps and the safe-versus-unsafe saturation expectations.
- Updated `.wiki/index.md`, refreshed `.wiki/execution-boundary-hardening.md` to point at the ingested benchmark page, and removed the original `docs/2026-04-12-metidos-tool-load-benchmark-baseline.md` source after ingestion.

## [2026-04-19] ingest | Performance Validation Workflow
- Ingested `docs/2026-04-12-performance-validation-workflow.md` into `.wiki/performance-validation-workflow.md`.
- Preserved the durable local validation workflow that pairs `bun run harness:starvation` with `bun run benchmark:metidos-tools --json`, uses telemetry sidecar capture when needed, and treats scheduler preemptions separately from unexpected failures.
- Updated `.wiki/index.md`, refreshed related harness and benchmark wiki cross-links, and removed the original `docs/2026-04-12-performance-validation-workflow.md` source after ingestion.

## [2026-04-19] ingest | 2026-04-12 Project Audit
- Ingested `docs/2026-04-12-project-audit-risks-bugs-problems.md` into `.wiki/2026-04-12-project-audit.md`.
- Preserved the whole-project audit snapshot, distinguishing closed 2026-04-12 remediation items from longer-lived maintenance concerns across mainview modularity, execution boundaries, auth, Pi coupling, and repo policy.
- Updated `.wiki/index.md`, linked the audit snapshot to the narrower durable follow-up pages, and removed the original `docs/2026-04-12-project-audit-risks-bugs-problems.md` source after ingestion.

## [2026-04-19] ingest | Run Untrusted JS Isolation
- Ingested `docs/2026-04-12-run-untrusted-js-isolation-audit.md` into `.wiki/run-untrusted-js-isolation.md`.
- Preserved the sandbox-specific durable knowledge: the old Node `fs` mock was not the whole boundary, the audit-proven escape paths were `Bun.file`, raw `Bun.SQLite`, and ambient `fetch`, and the landed closeout narrowed the safe sandbox to scoped `Bun.SQLite` plus a smaller helper subset.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-12-run-untrusted-js-isolation-audit.md` source after ingestion.

## [2026-04-19] ingest | WebView Page Extraction
- Ingested `docs/2026-04-12-webview-page-extraction-prototype.md` into `.wiki/webview-page-extraction.md`.
- Preserved the durable rule that Bun.WebView-backed rendered-page reading is a bounded fallback for JS-rendered or navigation-dependent pages, with `webview_get_markdown` as the normal readable-page path and `webview_eval`/`webview_cdp` reserved for unsafe runtimes.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-12-webview-page-extraction-prototype.md` source after ingestion.

## [2026-04-19] ingest | Git Access Toolset
- Ingested `docs/2026-04-13-git-access-toolset-game-plan.md` into `.wiki/git-access-toolset.md`.
- Preserved the durable `gitAccess` worktree-bound tool-family model, local Git CLI boundaries, phase-based rollout status, and telemetry-first validation posture.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-13-git-access-toolset-game-plan.md` source after ingestion.

## [2026-04-19] ingest | NVIDIA Build via Pi Configuration
- Ingested `docs/2026-04-14-nvidia-build-via-pi-configuration.md` into `.wiki/nvidia-build-via-pi-configuration.md`.
- Preserved the durable rule that NVIDIA Build models are best wired through Metidos-owned Pi `models.json` as provider `nvidia-build` using `openai-completions`, `max_tokens` compatibility, and existing provider-qualified model resolution (`nvidia-build:<model-id>`), without separate runtime path changes.
- Updated `.wiki/index.md`, refreshed related links (`ollama-via-pi-configuration`, `pi-coding-agent-migration`, `codex-via-pi-wiring`) where applicable, and removed the original `docs/2026-04-14-nvidia-build-via-pi-configuration.md` source after ingestion.

## [2026-04-19] ingest | Mainview Accessibility Audit (2026-04-16)
- Ingested `docs/2026-04-16-accessibility-audit.md` into `.wiki/2026-04-16-mainview-accessibility-audit.md`.
- Preserved the high-confidence findings around transcript/live-region absence, dialog/menu semantics gaps, label/tooltip correctness defects, and low-vision/motor interaction pressure.
- Updated `.wiki/index.md` and removed the original `docs/2026-04-16-accessibility-audit.md` source after ingestion.

## [2026-04-19] ingest | Mainview Accessibility Standards
- Ingested `docs/mainview-accessibility-standards.md` into `.wiki/mainview-accessibility-standards.md`.
- Preserved the durable maintainable standards for controls, floating surfaces, choosers, transcript semantics, and release-level QA.
- Added adjacent-page links from `[2026-04-16-mainview-accessibility-audit]` and updated `.wiki/index.md` with the maintained standard.
- Removed the original `docs/mainview-accessibility-standards.md` source after ingestion.

## [2026-04-19] ingest | Broad Optimization Proposals
- Ingested `docs/optimization-proposals.md` into `.wiki/2026-04-11-optimization-proposals.md` and archived the raw text at `.wiki/raw/optimization-proposals.md`.
- Preserved the durable context for the broad optimization inventory, including pre-split clusters for frontend, backend, DB, Git, scheduler, memory, and build concerns.
- Updated `.wiki/index.md` and refreshed adjacent optimization pages to keep source traceability.
- Removed the original `docs/optimization-proposals.md` source after ingestion.

## [2026-04-29] synthesis | Commit and research policy skills
- Moved the repository commit workflow from `COMMIT.md` to `.pi/skills/commit/SKILL.md`.
- Moved the research wiki schema from `RESEARCH.md` to `.pi/skills/research/SKILL.md`.
- Updated the Karpathy LLM Wiki pattern adaptation page to identify the research skill as the current schema location.

## [2026-04-29] lint | Documentation language and stale provider records
- Refreshed `UBIQUITOUS_LANGUAGE.md` with current Metidos terms for Plugin System v1, core plugins, model catalog/provider configuration, app data, auth sessions, calendar/notification access, WebView, web-server sharing, runtime stats, and telemetry.
- Updated provider wiki pages so OpenRouter is documented as a settings-only Pi built-in provider handoff, while Ollama and Build NVIDIA are documented as Plugin System v1 provider-registering core plugins.
- Refreshed Codex auth docs around the current `core_plugins/codex` `piAuth` handoff and `src/bun/pi/builtin-provider-settings.ts`.
- Marked the old vm2 / `run_untrusted_js` wiki path as retired and redirected current execution-boundary guidance to Pi runtime access controls, project-scoped SQLite, Plugin System v1 SQLite, and bounded unsafe child operations.
- Updated access-control and Git tool wiki pages for the current Web Search, WebView, WebServer, Git, SQLite, Calendar, Notifications, Threads, Crons, plugin access-group, and unsafe boundaries.
- Updated `.wiki/index.md` and adjacent markdown links to avoid pointing current guidance at removed `docs/2026-*` pages.

## [2026-05-01] query | Git Background Preemption Churn
- Reviewed the git scheduler, starvation harness preemption reporting, and existing performance-validation benchmark evidence.
- Added `.wiki/git-background-preemption-churn.md` documenting that current evidence shows observable scheduler backpressure with zero unexpected pressure-loop failures, not a production mitigation trigger.
- Updated `.wiki/index.md` with the new measurement note.

## [2026-05-01] query | Project Procedure responsibility map
- Mapped `src/bun/project-procedures.ts` exports, existing extracted helper modules, `src/bun/index.ts` RPC call sites, and related tests.
- Added `.wiki/project-procedures-responsibility-map.md` with responsibility groups, extraction seams, shared invariants, and a follow-up slice order.
- Closed task `tg-01k8z000000000000000000007` as completed research.

## [2026-05-01] query | Thread runtime tool policy inventory
- Mapped `src/bun/pi/thread-runtime.ts`, `src/bun/thread-permissions.ts`, Metidos-native tool modules, Plugin System v1 tool exposure, and existing runtime tests.
- Added `.wiki/thread-runtime-tool-policy-inventory.md` with the native permission matrix, unsafe-mode behavior, plugin naming path, runtime context rules, and identified test coverage.
- Updated `.wiki/index.md` with the new inventory page.

## [2026-05-01] query | Plugin capability gate inventory
- Mapped Plugin System v1 decision-ledger invariants from `docs/metidos-plugin-decisions.md` to implementation locations under `src/bun/plugin/**`, `src/bun/pi/plugin-tools.ts`, and related runtime/catalog modules.
- Added `.wiki/plugin-capability-gate-inventory.md` with duplicated checks, missing central rule surfaces, and a target `PluginCapabilityGate` interface shape.
- Updated `.wiki/index.md` with the new inventory page.

## [2026-05-01] synthesis | Windows auth secret ACL guidance
- Documented the Windows ACL requirement for the Metidos app data directory and `auth-secret.key` in `.wiki/local-auth-hardening.md`.
- Updated the backend README and runtime warning copy so Windows chmod limitations point operators to the durable guidance.
- Closed task `tg-01k8z00000000000000000000z` as completed documentation/security guidance.

## [2026-05-09] synthesis | OpenRouter embeddings plugin support
- Updated the OpenRouter provider note to cover the `openrouter_embeddings` provider, upstream embedding model discovery, and the `/embeddings` request path.
- Documented that chat provider ownership remains separate from embedding-provider capability so mixed provider plugins do not mark chat models as embedding-capable.
