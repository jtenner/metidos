# Wiki Index

This is the content index for the repository research wiki.

## Maintained operating and architecture guidance

- [mainview-accessibility-standards](./mainview-accessibility-standards.md) — Maintained implementation and QA standards for accessible mainview interactions, including controls, dialogs, choosers, transcript semantics, and release checks.
- [mainview-accessibility-status](./mainview-accessibility-status.md) — Current accessibility documentation status, source-of-truth links, review posture, and the remaining audit-mapping gap.
- [performance-validation-workflow](./performance-validation-workflow.md) — Durable operator workflow for validating Metidos performance with the starvation harness, telemetry sidecar, and bounded Metidos-tool benchmark.
- [karpathy-llm-wiki-pattern](./karpathy-llm-wiki-pattern.md) — Notes on the Karpathy LLM Wiki pattern and how this repository adapts it.

## Runtime, security, and provider design

- [local-auth-hardening](./local-auth-hardening.md) — Durable security record for the stricter local-auth setup/reset policy, transaction-backed lockout counting, explicit `auth-secret.key` recovery behavior, reset process-containment boundary, Windows ACL expectations, loopback `/auth/*` throttling, and the current TOTP contract.
- [execution-boundary-hardening](./execution-boundary-hardening.md) — Durable security record for safe-by-default thread/cron creation, retired `run_untrusted_js` escape classes, and bounded, measurable unsafe child-thread/cron paths.
- [thread-runtime-tool-policy-inventory](./thread-runtime-tool-policy-inventory.md) — Updated 2026-05-09 matrix of thread permissions, Pi runtime tool families, unsafe-mode behavior, LanceDB/prompt-injection access, plugin tool naming, and current test coverage for tool exposure.
- [thread-tool-access-controls](./thread-tool-access-controls.md) — Historical design note for thread-level tool access boundaries and the durable rule that runtime tool visibility must match per-thread access flags.
- [run-untrusted-js-isolation](./run-untrusted-js-isolation.md) — Historical record of the retired `run_untrusted_js` / vm2 audit, the concrete Bun/global escape paths it proved, and the current verification surfaces that carry those lessons forward.
- [pi-coding-agent-migration](./pi-coding-agent-migration.md) — Durable architecture record for replacing Codex SDK with Pi while keeping Metidos as the application shell and rebuilding product-specific tool/access semantics on Pi-native surfaces.
- [codex-via-pi-wiring](./codex-via-pi-wiring.md) — Durable design record for exposing ChatGPT-plan-backed Codex through Pi's `openai-codex` provider without restoring a second runtime.
- [ollama-via-pi-configuration](./ollama-via-pi-configuration.md) — Durable configuration record for the first-party Ollama core plugin, localhost model discovery, and Plugin System v1 provider registration.
- [nvidia-build-via-pi-configuration](./nvidia-build-via-pi-configuration.md) — Durable configuration record for the Build NVIDIA core plugin, live model discovery without synthesized fallback models, and Plugin System v1 provider registration.
- [openrouter-via-pi-configuration](./openrouter-via-pi-configuration.md) — Durable configuration record for the OpenRouter core plugin chat/embedding provider registrations, upstream catalog refresh, embedding API routing, and Pi chat transport/auth handoff.
- [webview-page-extraction](./webview-page-extraction.md) — Durable design record for Bun.WebView-backed rendered-page reading, the stateful `webview_*` tool surface, and the rule that browser-backed DOM extraction is a bounded fallback path.
- [git-access-toolset](./git-access-toolset.md) — Durable design record for the local Git CLI tool family, the `gitAccess` thread toggle, worktree-bound execution rules, and phase-based rollout behavior.

## Plugin System v1 research

- [plugin-capability-gate-inventory](./plugin-capability-gate-inventory.md) — Observed Plugin System v1 decision-ledger invariant map, duplicated capability checks, and proposed Plugin Capability Gate interface shape.
- [plugin-sidecar-local-sqlite-spike](./plugin-sidecar-local-sqlite-spike.md) — Spike decision to defer sidecar-local plugin SQLite until shared sidecar-local storage authority, quota accounting, lifecycle locks, and revocation semantics exist.
- [plugin-sidecar-websocket-ownership-spike](./plugin-sidecar-websocket-ownership-spike.md) — Spike decision to keep plugin WebSocket connections maincar-owned until measurement justifies sidecar ownership and shared policy/lifecycle control work.
- [plugin-sidecar-ingress-security-concurrency-audit](./plugin-sidecar-ingress-security-concurrency-audit.md) — Focused 2026-05-23 audit of Plugin System v1 sidecar-manager and ingress-batch processor concurrency, cleanup, and remaining follow-up boundaries.

## Backend and mainview architecture notes

- [project-procedures-responsibility-map](./project-procedures-responsibility-map.md) — Architecture map of `src/bun/project-procedures.ts` responsibilities, extraction seams, invariants, and validation surfaces for future refactoring slices.
- [workspace-path-policy-invariants](./workspace-path-policy-invariants.md) — Current Workspace path policy caller map, invariants, stable errors, Mainview mirror behavior, and test-seam guidance for the Backend extraction slice.
- [app-data-schema-migration-invariants](./app-data-schema-migration-invariants.md) — App Data schema startup migration map covering required tables, skip-check invariants, legacy repair shapes, migration ordering, and the future schema seam boundary.
- [mainview-shell-orchestration-seam](./mainview-shell-orchestration-seam.md) — Architecture map of the Mainview shell selection, startup restore, runtime-event reconciliation, persistence, and follow-up shell-state Module seam.
- [mainview-thread-status-controller](./mainview-thread-status-controller.md) — Durable design record for extracting mainview thread-status polling and selected-thread refresh into a memoized controller boundary instead of leaving that hot path inline in `App.tsx`.
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md) — Durable design record for extracting mainview project/worktree loading and git-history orchestration into dedicated controller hooks instead of leaving those async coordination paths inline in `App.tsx`.
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md) — Durable design record for extracting hot pure mainview selectors, deferring only sidebar search work, and removing redundant thread re-sorting from the derived-state path.
- [mainview-transcript-pipeline-seam](./mainview-transcript-pipeline-seam.md) — Durable design record for the Mainview transcript pipeline/state seams covering row projection, media payloads, expansion metadata, markdown/tool/diff routing, and validation surfaces.
- [production-mainview-build-modes](./production-mainview-build-modes.md) — Durable design record for the explicit dev/prod mainview build policy, including production minification by default and opt-in sourcemaps.
- [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md) — Durable design record for moving mainview bootstrap assets onto a versioned `/assets/mainview/<version>/...` path with immutable caching while keeping HTML and compatibility aliases fresh.

## Performance and telemetry records

- [runtime-stats-collector](./runtime-stats-collector.md) — Durable design record for the resettable backend runtime stats collector used to aggregate RPC, websocket, SQLite retry, and selected git-cache metrics.
- [track-telemetry-sidecar-db](./track-telemetry-sidecar-db.md) — Durable design record for the optional `--track-telemetry` runtime sink that snapshots low-cardinality diagnostics into a separate SQLite sidecar database.
- [rpc-payload-measurement](./rpc-payload-measurement.md) — Durable design record for ranking top response-byte RPC methods and top payload-byte websocket push types in runtime diagnostics and starvation-harness output.
- [mainview-rpc-payload-summary](./mainview-rpc-payload-summary.md) — Mainview-facing summary/detail payload guidance for keeping startup and list RPCs compact.
- [thread-status-refresh-dedupe](./thread-status-refresh-dedupe.md) — Durable design record for reusing in-flight thread-status refreshes and skipping redundant selected-thread detail reloads when the selected summary snapshot is unchanged.
- [starvation-harness-reporting](./starvation-harness-reporting.md) — Durable design record for wiring the starvation harness to runtime diagnostics, percentile summaries, memory observations, structured JSON benchmark output.
- [sqlite-query-plan-indexes](./sqlite-query-plan-indexes.md) — Durable design record for the measured SQLite query-plan audit that adds only the project/thread indexes needed to remove hot temp-sort work while preserving message-index restraint.
- [sqlite-retry-metrics](./sqlite-retry-metrics.md) — Durable design record for the SQLite retry-metrics slice that documents the already-landed runtime-stats-backed counters, health-surface exposure, and verification-only closeout.
- [sqlite-wal-mode-tuning](./sqlite-wal-mode-tuning.md) — Durable design record for the conservative SQLite runtime change that standardizes WAL plus `synchronous = NORMAL` across app and cron database opens while deferring speculative tuning.
- [git-background-preemption-churn](./git-background-preemption-churn.md) — Measurement note concluding that current git-scheduler preemptions are observable backpressure, not yet a production mitigation trigger.
- [cron-concurrency-cap](./cron-concurrency-cap.md) — Durable design record for the scheduler-fired cron launch cap that bounds concurrent child-thread launches while keeping manual run-now behavior direct.
- [cron-duration-saturation-telemetry](./cron-duration-saturation-telemetry.md) — Durable design record for the cron runtime-stats telemetry that measures active and pending runs, queue saturation, timeout counts, and aggregate durations across diagnostics, harness output, and optional sidecar persistence.

## Time-bound audit snapshots and baselines

- [2026-04-12-project-audit](./2026-04-12-project-audit.md) — Time-bound whole-project audit snapshot capturing what the 2026-04-12 review surfaced, which risks were later closed the same day, and which concerns remain ordinary maintenance work.
- [2026-04-16-mainview-accessibility-audit](./2026-04-16-mainview-accessibility-audit.md) — Time-bound accessibility audit of the mainview shell covering transcript semantics, floating-surface patterns, labels, and low-vision/motor interaction risks.
- [2026-04-12-metidos-tool-load-benchmark-baseline](./2026-04-12-metidos-tool-load-benchmark-baseline.md) — Time-bound benchmark snapshot for the first deterministic local regression run covering bounded thread and cron tool budgets after the 2026-04-12 audit-remediation work.
- [2026-04-11-opt01-baseline-benchmark](./2026-04-11-opt01-baseline-benchmark.md) — Time-bound baseline benchmark snapshot recording the first repeatable local starvation-harness run after the runtime-stats and reporting slices landed.
- [2026-04-11-optimization-proposals](./2026-04-11-optimization-proposals.md) — Time-bound archival snapshot of the full pre-execution optimization brainstorming across frontend, backend, DB, Git, scheduler, and build surfaces.
- [optimization-execution-proposal](./optimization-execution-proposal.md) — Durable planning record that narrows the broad optimization ideas into six measured execution tracks, explicit non-goals, and a phased rollout order.
