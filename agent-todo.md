# Metidos Open Source Launch TODO

This file tracks active TODOs only. When a task is completed, remove it from this file instead of leaving a checked item behind.

This checklist is for repository improvements only before making Metidos public/open source. Do not treat this as a marketing or launch-promotion plan. Work through items in small, reviewable PRs or commits.

## 1. Repository Hygiene and Public Readiness

- [ ] Review checked-in assets for ownership, provenance, license compatibility, and permission to redistribute publicly.
- [ ] Verify the repository can be cloned into a clean directory without relying on ignored local state from the current developer machine.

## 3. Security and Secret Handling

- [ ] Run a full working-tree secret scan using at least one dedicated tool and review every finding.
- [ ] Run a full Git-history secret scan before publishing the repository and decide whether history rewrite is required.
- [ ] Rotate any exposed, suspicious, stale, or unverifiable credentials found during the audit, even if they appear unused.
- [ ] Add or improve tests around sensitive settings redaction.
- [ ] Add or improve tests around plugin permission enforcement.
- [ ] Add or improve tests around filesystem path validation, denied paths, symlink handling, and traversal attempts.
- [ ] Add or improve tests around network policy enforcement and allowlist/denylist behavior.
- [ ] Verify security-sensitive error messages are actionable without leaking secrets or sensitive local paths.

## 4. CI, Validation, and Release Automation

- [ ] Smoke-run documented package scripts from a clean setup and record exact outcomes. Context: `.wiki/package-script-reference-audit.md` verifies referenced script names exist as of 2026-06-01; remaining work is execution validation for documented root scripts and `src/mainview/getdown` scripts, excluding intentional long-running watch modes unless they are checked with a bounded timeout.
- [ ] Verify CI artifacts, logs, and test outputs do not expose secrets or machine-specific paths.

## 5. README Improvements

- [ ] Add a polished hero screenshot near the top of `README.md` using fake/demo data only.
- [ ] Add a screenshot gallery or visual feature section with safe demo data.
- [ ] Add badges only after the underlying CI, license, release, and status items are real.
- [ ] Verify all README commands work from a clean clone.
- [ ] Verify README terminology matches `UBIQUITOUS_LANGUAGE.md` after public terminology is finalized.

## 6. Plugin System Public Readiness

- [ ] Add a plugin tutorial that walks from empty folder to installed and approved plugin.

## 7. Install and First-Run Experience

- [ ] Test clean install on a fresh machine or disposable container and record the exact OS, Bun version, commands, and outcome.
- [ ] Verify `bun run dev` works from a clean clone after documented setup only.
- [ ] Verify `bun run start` works from a clean clone after documented setup only.
- [ ] Verify `bun run validate` passes from a clean clone.
- [ ] Verify local auth setup and reset flow are documented and work as described.
- [ ] Verify missing dependencies produce readable errors with next-step guidance.
- [ ] Verify setup docs do not require private knowledge, private package access, personal paths, or internal services.
- [ ] Verify backup and restore paths are documented and tested.
- [ ] Verify installation failure paths do not leave behind confusing or unsafe partial state.

## 8. Visual Assets and Repo-Hosted Website

- [ ] Add or polish logo files in appropriate source and export formats.
- [ ] Add or polish mascot/icon files if they are part of the project identity.
- [ ] Add a GitHub social preview image using safe, repo-owned assets.
- [ ] Add an Open Graph image for the website if the website lives in the repository.
- [ ] Add favicon and app icon files if the app or website uses them.
- [ ] Add README screenshots with fake/demo data only.
- [ ] Add feature screenshots for project/worktree view using fake/demo data only.
- [ ] Add feature screenshots for agent threads using fake/demo data only.
- [ ] Add feature screenshots for diff review using fake/demo data only.
- [ ] Add feature screenshots for cron workspace using fake/demo data only.
- [ ] Add feature screenshots for plugin administration using fake/demo data only.
- [ ] Add feature screenshots for settings/provider setup using fake/demo data only.
- [ ] Ensure all screenshots hide usernames, hostnames, tokens, internal repositories, local paths, private branches, and real customer/user data.
- [ ] Add an architecture diagram showing backend, mainview, agent runtime, persistence, plugins, providers, and external boundaries.
- [ ] Add a plugin lifecycle diagram showing discovery, review, approval, enabled use, disabled state, reset, and removal.
- [ ] Add an install flow diagram showing clean clone, dependencies, configuration, first auth, provider setup, and first project.
- [ ] Add a small brand asset folder if appropriate, with source files, exported images, and licensing/provenance notes.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a home page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a docs landing page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a getting started page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a plugin page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a security page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a roadmap page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for a changelog page.
- [ ] If a repo-hosted website exists or will be added, create TODOs for screenshot/demo sections that use safe data only.

## 9. Product Hardening

- [ ] Verify project creation, opening, closing, and error handling work from a clean setup.
- [ ] Verify Git worktree listing, opening, switching, and failure states work with small and realistic repositories.
- [ ] Verify agent thread creation, monitoring, stopping, and resuming behavior.
- [ ] Verify diff review with small diffs, large diffs, binary files, deleted files, renamed files, and conflict-like scenarios.
- [ ] Verify cron job creation, editing, run-now, disabling, and deletion.
- [ ] Verify plugin discovery, review, approval, disable, reset-data, and failure states.
- [ ] Verify local auth session behavior, including login, logout, expiration, refresh, and invalid session handling.
- [ ] Verify step-up authentication protects sensitive actions and fails safely.
- [ ] Verify unsafe-mode warnings are visible, specific, and tied to the relevant risky action.
- [ ] Verify unsafe-mode boundaries are documented and enforced where applicable.
- [ ] Verify the app remains usable during long-running agent work, large logs, slow providers, and background cron activity.
- [ ] Verify major error paths produce actionable messages with next steps.
- [ ] Add or improve diagnostics export with redaction if feasible.
- [ ] Verify diagnostics exports exclude secrets, recovery codes, session tokens, provider keys, and private file contents.
- [ ] Verify settings screens distinguish safe display values from secret or sensitive values.

## 10. Testing

- [ ] Identify critical backend tests missing before public release and file or add TODOs for each gap.
- [ ] Identify critical mainview tests missing before public release and file or add TODOs for each gap.
- [ ] Identify plugin permission tests missing before public release and file or add TODOs for each gap.
- [ ] Identify auth/session tests missing before public release and file or add TODOs for each gap.
- [ ] Identify cron tests missing before public release and file or add TODOs for each gap.
- [ ] Identify install/setup smoke tests missing before public release and file or add TODOs for each gap.
- [ ] Verify tests can run locally without private services or credentials.
- [ ] Verify tests use fixtures and fake data instead of real repositories, secrets, or personal paths.
- [ ] Verify failing tests produce enough context for outside contributors to debug.

## 11. GitHub Public Repository Setup Notes

- [ ] Confirm the repository description is accurate, concise, and aligned with the README tagline.
- [ ] Confirm the repository homepage URL points to the correct docs or repo-hosted website if one exists.
- [ ] Confirm repository topics include relevant public discovery terms and avoid internal jargon.
- [ ] Confirm the social preview image is uploaded and renders correctly.
- [ ] Confirm issue templates render correctly in GitHub’s new issue flow.
- [ ] Confirm license detection works after adding `LICENSE`.
- [ ] Confirm CI runs publicly on pull requests and pushes without private secrets.
- [ ] Confirm branch protection or rulesets are enabled for the default branch.
- [ ] Confirm required checks match the actual CI workflow names.
- [ ] Confirm Discussions are enabled only if the project intends to support them.
- [ ] Confirm GitHub Wiki is disabled unless intentionally used.
- [ ] Confirm private security reporting is configured if available for the repository.
- [ ] Confirm default branch naming is intentional and documented where needed.
- [ ] Confirm repository visibility, fork settings, and Actions permissions are appropriate for a public project.

## 12. Final Pre-Public Checklist

- [ ] All required community files exist.
- [ ] License exists and GitHub detects it correctly.
- [ ] CI passes on the default branch.
- [ ] `bun run validate` passes from a clean clone.
- [ ] Working-tree and Git-history secret scans are completed and findings are resolved.
- [ ] README is updated and accurate.
- [ ] Install docs are tested on a clean machine or container.
- [ ] Security docs are present and linked from README.
- [ ] Plugin docs are present and linked from README.
- [ ] Roadmap and project status are clear.
- [ ] Screenshots and visual assets are safe, owned, and license-compatible.
- [ ] First release draft is prepared.
- [ ] Known limitations are documented.
- [ ] Public repository settings have been reviewed.
- [ ] No external social media, launch-posting, newsletter, Discord, Product Hunt, Hacker News, Reddit, LinkedIn, YouTube promotion, or other off-repo marketing tasks are included in this checklist.

## 13. Frontend Review: Bugs, UI Races, and Style Violations

### Calendar bugs

- [ ] Fix day-grouping timezone inconsistency in `src/mainview/app/calendar-layout.ts`: choose one date-key strategy for all-day and timed events so same-date events do not land in different visible day columns for non-UTC viewers.

### Plugin administration, access, and terminal bugs


### Composer bugs


### Plugin administration UI races

- [ ] Serialize or generation-guard plugin settings auto-save in `src/mainview/app/use-plugin-administration-controller.ts` so inventory/settings reload cannot race with `savePluginSettings` and PATCH stale form values.
- [ ] Serialize ingress route draft access/model saves in `src/mainview/app/use-plugin-administration-controller.ts`; add in-flight guards and prevent stale state commits after navigation/close.
- [ ] Scope plugin admin/lifecycle disabled states in `src/mainview/app/plugin-administration-panel.tsx` and `src/mainview/app/plugin-lifecycle-action-state.ts` to the matching action key instead of globally disabling unrelated buttons.

### Async lifecycle and stale-write races

- [ ] Add mount/abort/request-id guards around blur-commit timeouts and settings loads in `src/mainview/app/settings-panel.tsx`.
- [ ] Add mount/abort/request-id guards around run/delete/describe flows and delayed `loadCronJobs` calls in `src/mainview/app/mainview-cron-workspace-controller.tsx`.
- [ ] Add mount/abort/request-id guards around terminal refresh and rename flows in `src/mainview/app/use-terminals-controller.ts`.
- [ ] Reduce thread-discovery churn in `src/mainview/app/use-thread-status-controller.ts` by depending on a stable derived thread key instead of the whole `options.threads` array, while preserving existing in-flight dedupe/equivalence safeguards.

### Focus, hover, and popover races

- [ ] Add a hover bridge or equivalent stable open behavior for the help tooltip in `src/mainview/controls/thread-access-control.tsx` so users can move from the “?” trigger to the tooltip without it closing.
- [ ] Fix blur-close versus keyboard navigation in `src/mainview/controls/codex-model-selector.tsx`, especially when moving into the reasoning submenu.
- [ ] Remove or coordinate double initial-focus behavior in `src/mainview/controls/codex-model-selector.tsx`.

### Style: shared primitives and one-off controls

- [ ] Refactor cron mode tabs and “New Cron” in `src/mainview/app/mainview-cron-workspace-controller.tsx` to use approved shared primitives such as `AppButton`, `IconButton`, `ListOptionButton`, or `TabButton`.
- [ ] Refactor terminal buttons in `src/mainview/app/terminal-workspace.tsx` to use approved shared button primitives.
- [ ] Refactor calendar event dialog inputs in `src/mainview/app/calendar-event-dialog.tsx` to avoid local one-off `focus:ring-accent/25` recipes and use shared input/focus styling.
- [ ] Refactor calendar edit dialog controls in `src/mainview/app/calendar-edit-dialog.tsx` to avoid local one-off focus/input/button styling.
- [ ] Refactor calendar ICS edit dialog controls in `src/mainview/app/calendar-ics-edit-dialog.tsx` to avoid local one-off focus/input/button styling.
- [ ] Refactor extension dialog primary/cancel/select controls in `src/mainview/app/thread-extension-ui-dialog.tsx` to use shared primitives.
- [ ] Refactor skills menu controls in `src/mainview/controls/chat-composer-control.tsx` to use shared primitives or approved shared recipes.
- [ ] Refactor choice dropdown options in `src/mainview/controls/choice-dropdown-control.tsx` to use shared primitives or approved shared recipes.
- [ ] Refactor Codex model selector controls in `src/mainview/controls/codex-model-selector.tsx` to use shared primitives or approved shared recipes.
- [ ] Refactor settings close/reset controls in `src/mainview/app/settings-panel.tsx` to use shared button primitives.

### Style: semantic backdrops, cards, blur, badges, and spacing

- [ ] Remove card-like/decorative styling from the inline folder suggestion list in `src/mainview/app/projects-panel.tsx`, including sidebar `shadow-overlay`/`backdrop-blur-xl` drift.
- [ ] Remove card-like bordered `bg-surface-1` treatment from the add-project form in `src/mainview/app/projects-panel.tsx` or align it with approved non-card primitives.
- [ ] Replace decorative icon tiles in `src/mainview/app/settings-panel.tsx` with approved icon/section styling.
- [ ] Replace decorative icon tiles in `src/mainview/app/cronjob-workspace.tsx` with approved icon/section styling.
- [ ] Replace boxed loading/empty/error panels in `src/mainview/app/cronjob-workspace.tsx` with approved empty/error/loading primitives or inline treatments.
- [ ] Replace off-grid spacing/tracking in `src/mainview/controls/thread-access-control.tsx` (`space-y-1.5`, `tracking-[0.12em]`) with approved spacing and type tokens.
- [ ] Replace off-grid spacing/tracking in `src/mainview/app/mainview-cron-workspace-controller.tsx` with approved spacing and type tokens.
- [ ] Bring mobile chat-bubble spacing in `src/mainview/app/chat-workspace.tsx` back onto the 4px grid instead of `px-[10px]`, `py-[10px]`, and `px-[2px]` recipes.
- [ ] Standardize small icon buttons to the 28px standard instead of 24px in `src/mainview/controls/chat-composer-control.tsx`.

## 14. Backend Audit Follow-up: `src/bun` Bugs, Security Findings, and Threat-Model Clarifications

For every item in this section: inspect the referenced code, decide whether the audit note is a real bug/security issue or an expected threat-model/design tradeoff, then either fix it with tests or add/adjust code comments and/or docs so future auditors understand why the behavior is safe. Mark an item complete only after the codebase itself contains the fix, regression test, or clarifying comment/docs.

### Auth and session follow-up

- [ ] A4: Review primary-factor-plus-TOTP lockout behavior in `src/bun/auth/service-session.ts` and `src/bun/auth/service-login.ts`. If a stolen primary factor enables too many TOTP guesses, tighten lockout/rate-limit policy; otherwise document the accepted risk and existing route-level throttles.
- [ ] A13: Review lockout audit ordering in `src/bun/auth/service-core.ts` (`recordInvalidAuthAttempt` and `incrementFailedAttempts`). If the triggering failed attempt is mislabeled, fix audit events; otherwise add tests/comments explaining lockout event semantics.
- [ ] A14: Review shared lockout counter for primary-factor, TOTP, and recovery-code failures in `src/bun/auth/service-core.ts` and `src/bun/auth/service-login.ts`. If it creates bad UX or security ambiguity, split counters; otherwise document that all auth proof failures intentionally share one lockout.

### Authorization and capability follow-up

- [ ] B1: Review `src/bun/rpc-websocket-auth.ts` (`revalidateRpcWebSocketSession`) and `src/bun/index.ts` websocket close behavior. If admin revocation errors are too opaque for the UI, improve error surfacing; otherwise document why socket close is the intended response.
- [ ] B3: Review session-scoped step-up in `src/bun/auth/service-session.ts`. If stolen-session exposure is too broad, shorten lifetime or bind step-up to stronger context; otherwise document the 10-minute accepted risk.
- [ ] B4: Review non-admin WebSocket connection behavior in `src/bun/index.ts` and `src/bun/rpc-transport.ts`. If non-admin sockets can consume excessive resources, add tighter limits; otherwise comment that admin-only checks are per-procedure.
- [ ] B5: Verify thread/project visibility checks in `src/bun/project-procedures.ts` for `getThreadProcedure` and related thread reads. Fix any IDOR; otherwise add tests/comments proving procedure-level authz covers raw RPC param validation.
- [ ] B7: Review all uses of `requireLocalOperatorCapability(context, "recent_step_up")`. Ensure sensitive procedures also require `manage_app` when intended; add comments/tests to prevent future refactors from relying on step-up alone.

### SQLite and persistence follow-up

- [ ] C3: Review `rebuildProjectsTableForOwnerless` in `src/bun/app-schema-migration.ts`. If `GROUP BY path` can drop important legacy project rows, fix migration behavior; otherwise document expected data-consolidation semantics.
- [ ] C4: Review `rebuildAppNotificationDeliveriesForLocalInbox` in `src/bun/app-schema-migration.ts`. If legacy multi-user notifications should not become local inbox entries, filter or migrate explicitly; otherwise comment the single-operator migration choice.
- [ ] C6: Review dedicated auth rate-limit SQLite connection contention in `src/bun/auth/rate-limit.ts`. If it can starve login/setup flows, add backoff/telemetry; otherwise document the busy-timeout design.
- [ ] C9: Review startup TOTP secret migration hook in `src/bun/index.ts` and `src/bun/auth/secret-migration.ts`. If missing coverage, add tests/comments around legacy v1-to-v2 ciphertext migration.
- [ ] C11: Review plugin SQLite read guards in `src/bun/plugin/sqlite.ts` (`assertReadStatement`, `containsSqlIdentifierFromSet`). Fix false positives/false negatives if real; otherwise add tests/comments explaining why mutating CTEs and dangerous identifiers are blocked.

### Plugin QuickJS sandbox follow-up

- [ ] D1: Review `MAX_ENTRYPOINT_EXPORT_REWRITE_SOURCE_BYTES` and source rewriting memory use in `src/bun/plugin/quickjs-runtime.ts`. If large plugin entrypoints can cause pressure, reduce the cap or stream/avoid duplicate copies; otherwise document accepted startup memory cost.
- [ ] D4: Review callback invocation token handling in `src/bun/plugin/quickjs-runtime.ts`. If plugin code can read or forge the token, fix isolation; otherwise add comments/tests proving token secrecy is within the QuickJS bootstrap boundary.
- [ ] D5: Review host global override risk in `src/bun/plugin/quickjs-runtime.ts` (`__metidosHostStructuredDataOperation` and related globals). If plugin self-shadowing breaks host API invariants, freeze or hide host bindings; otherwise document that a plugin can only sabotage itself.
- [ ] D6: Review QuickJS interrupt/timeout handling in `src/bun/plugin/quickjs-runtime.ts`. If guest code can catch/evade interrupts, add stronger cancellation or tests; otherwise document QuickJS deadline limitations.
- [ ] D7: Review `resolveQuickJsPromise` timeout behavior in `src/bun/plugin/quickjs-runtime.ts`. Add tests/comments for promise timeout, pending-job execution, and timer cleanup.
- [ ] D9: Review `pluginBytesHostPayload` in `src/bun/plugin/quickjs-runtime.ts`. Add tests/comments showing byte payloads are copied/base64 encoded safely.
- [ ] D10: Review per-plugin QuickJS memory limits in `src/bun/plugin/quickjs-runtime.ts` and sidecar manager. If multiple plugins can exhaust host memory, add a global cap/telemetry; otherwise document total-memory threat model.

### Plugin filesystem sandbox follow-up

- [ ] E6: Review `O_NOFOLLOW` and `lstat` behavior in `src/bun/plugin/fs-path.ts`. Add tests/comments for symlink leaf rejection on supported platforms and fail-closed behavior on Windows.
- [ ] E7: Review RPC param bounds in `src/bun/index.ts` (`MAX_RPC_RECORD_KEYS`, `MAX_RPC_RECORD_DEPTH`). If nested payloads can still cause CPU/memory pressure, tighten limits; otherwise document per-request bounds.

### Outbound network and SSRF follow-up

- [ ] F1: Review `src/bun/outbound-url-security.ts` `new Response(nodeResponse as unknown as BodyInit)`. If Bun/Node stream coercion is brittle or leaks sockets, wrap with a proper Web `ReadableStream`; otherwise comment runtime assumption and add a test.
- [ ] F12: Review plugin fetch response materialization in `src/bun/plugin/fetch.ts`. If 25MB binary responses plus base64 JSON can cause memory pressure, lower limits or introduce streaming/temp-file delivery; otherwise document accepted cap.
- [ ] F13: Review textual response detection in `src/bun/plugin/fetch.ts`. Add tests/comments for UTF-8 fatal decode and binary fallback.
- [ ] F17: Review Bun WebSocket constructor options in `src/bun/plugin/websocket.ts`. If header/protocol behavior is runtime-dependent, add compatibility tests or normalize options.
- [ ] F19: Review `closeAll` in `src/bun/plugin/websocket.ts`. If pending receives need reliable delivery of close/error events, await or drain; otherwise comment best-effort shutdown semantics.

### HTTP and RPC transport follow-up

- [ ] G1: Review `proxyWebServerShareRequest` in `src/bun/index.ts`. If main-server proxying can stream unbounded responses or leak resources, add response limits/backpressure; otherwise document that the share worker owns body limits and auth.
- [ ] G3: Review terminal WebSocket admin revalidation in `src/bun/index.ts`. Add comments/tests proving terminal sockets require admin on every message.
- [ ] G6: Review RPC rate-limit constants in `src/bun/index.ts` and `src/bun/rpc-transport.ts`. If 360 burst/180 per second is excessive, tune; otherwise document desktop-IDE traffic expectations.
- [ ] G7: Review per-message session revalidation DB reads in `src/bun/rpc-transport.ts` and `src/bun/auth/service-session.ts`. If expensive, add cache/telemetry; otherwise comment why row reads are acceptable and touches are throttled.
- [ ] G10: Review session index refresh in `src/bun/rpc-transport.ts`. Add tests for session id changes, null session ids, and stale socket cleanup.
- [ ] G12: Review RPC measurement start/failure paths in `src/bun/rpc-transport.ts`. Add tests/comments ensuring malformed frames do not leave open telemetry tokens.
- [ ] G13: Review decoded binary RPC payload limits in `src/bun/rpc-transport.ts`. Add tests for compressed/oversize rejection if missing.
- [ ] G15: Review large RPC response JSON fallback in `src/bun/rpc-transport.ts`. If it blocks the event loop, prefer compressed binary for responses too; otherwise document compatibility tradeoff.
- [ ] G16: Review cron timeout behavior in `src/bun/sidecar-cron-runner.ts`. If timed-out cron threads keep running, abort/stop the Pi session; otherwise comment known resource behavior and add telemetry.
- [ ] G18: Review dev-port fallback and allowed-origin rebuilding in `src/bun/index.ts`. Add tests/comments for fallback port and WebSocket origin allowlist consistency.
- [ ] G19: Review main/share port collision checks in `src/bun/index.ts`. Add comments/tests for dev fallback behavior and fixed share-worker port assumptions.
- [ ] G21: Review aggregate chat image payload limits in `src/bun/index.ts`. If 8 large images per message can pressure memory, lower limits or stream; otherwise document accepted desktop-app cap.
- [ ] G22: Review `safeOutboundFetchWithTimeout` watchdog behavior in `src/bun/safe-outbound-fetch.ts`. Add tests/comments for `unref`, abort reason propagation, and timeout mapping.

### Calendar and notification follow-up

- [ ] H4: Review public ICS unauthenticated rate limits in `src/bun/index.ts`. If scraping risk is too high, reduce limits or add optional auth; otherwise document public-calendar information disclosure expectations.
- [ ] H5: Review external ICS due-refresh time handling in `src/bun/calendar/ics.ts`. Add comments/tests if clock skew or timezone semantics are unclear.
- [ ] H6: Review external ICS background error logging in `src/bun/index.ts` and `src/bun/calendar/ics.ts`. If persistent failures cause log spam, add backoff; otherwise document polling/logging behavior.

### Terminal and PTY follow-up

- [ ] I3: Review `METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST` in `src/bun/terminal-manager.ts`. If warning on sensitive-looking keys is insufficient, block by default; otherwise document operator opt-in threat model.
- [ ] I5: Review terminal Node binary ownership/permission checks in `src/bun/terminal-manager.ts`. Add tests/comments for world/group-writable binary denial.
- [ ] I6: Review PTY bridge kill timing in `src/bun/terminal-manager.ts` (`TERMINAL_BRIDGE_FALLBACK_KILL_DELAY_MS`). If 100ms is too aggressive, tune or document potential abrupt termination.
- [ ] I7: Review terminal output trimming complexity in `src/bun/terminal-manager.ts`. If large output can cause CPU pressure, optimize; otherwise comment current bounded-buffer assumptions.
- [ ] I8: Review terminal socket ownership checks in `src/bun/terminal-manager.ts` (`socketCanAccessSession`). Add tests/comments proving terminal WebSockets cannot attach across sessions.
- [ ] I9: Review terminal socket message rate limits in `src/bun/terminal-manager.ts`. Tune if abuse is possible; otherwise document chosen interactive-terminal limits.
- [ ] I10: Review `assertTerminalNodeBinarySecurity` in `src/bun/terminal-manager.ts`. Add tests/comments for owner/root checks and group/world writable rejection.
- [ ] I11: Review `terminalOwnerSessionKeyForThread` ownership model in `src/bun/terminal-manager.ts`. Fix orphan/cross-session behavior if real; otherwise document thread-owned terminal semantics.
- [ ] I12: Review `src/bun/terminal-pty-bridge.cjs` spawn-config and env validation. Add tests/comments proving host-supplied config is bounded and trusted.
- [ ] I13: Review PTY bridge input buffer cap in `src/bun/terminal-pty-bridge.cjs`. Add tests/comments for overlong newline-free input.
- [ ] I14: Review PTY bridge exit behavior in `src/bun/terminal-pty-bridge.cjs`. Add comments/tests for bridge exit code and host EOF handling.
- [ ] I15: Review `pty.spawn` error handling in `src/bun/terminal-pty-bridge.cjs`. Add tests/comments for invalid file/args and fatal startup failure.

### Web-server share follow-up

- [ ] J2: Review public share route Origin/auth expectations in `src/bun/pi/web-server/share-thread.ts` and `src/bun/index.ts`. If cross-site access can expose private hosted content, tighten cookies/tokens; otherwise document public-share threat model.

### Miscellaneous backend hardening follow-up

- [ ] K1: Review in-process auth immediate-transaction queue in `src/bun/auth/service-login.ts`. Add comments/tests for per-Database scope and multi-connection behavior.
- [ ] K6: Review startup cache warmup deferral in `src/bun/index.ts`. If first request can race expensive warmup, fix scheduling; otherwise comment best-effort nature.
- [ ] K9: Review runtime-stats pending RPC snapshots in `src/bun/index.ts` and `src/bun/rpc-transport.ts`. Add comments/tests if getter semantics are unclear.
- [ ] K10: Review per-request versus per-connection RPC param bounds in `src/bun/index.ts`. If repeated large bounded requests can DoS, add aggregate limits; otherwise document per-request threat model.
- [ ] K12: Review `objectParams` validator casts in `src/bun/index.ts`. Add stricter typed validators for risky RPCs or comments/tests showing shape validation is sufficient.
- [ ] K14: Review one-shot warmup timer cleanup in `src/bun/index.ts`. Add comments/tests if shutdown during warmup can leave work running.
- [ ] K16: Audit `src/bun/message-activity-store.ts` separately for persistence, size limits, and authorization boundaries; add comments/fixes as appropriate.
- [ ] K17: Review SQL `LIMIT` and pagination use in `src/bun/message-activity-store.ts` and adjacent stores. Add tests/comments for bind parameters and bounded reads.
