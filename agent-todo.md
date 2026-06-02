# Metidos Open Source Launch TODO

This file tracks active TODOs only. When a task is completed, remove it from this file instead of leaving a checked item behind.

This checklist is for repository improvements only before making Metidos public/open source. Do not treat this as a marketing or launch-promotion plan. Work through items in small, reviewable PRs or commits.

## 1. Repository Hygiene and Public Readiness

- [ ] Audit `.pi/skills/` and decide which skills are appropriate to ship publicly, which need redaction, and which should be excluded.
- [ ] Review dependency declarations and lockfiles for private packages, unpublished packages, local path dependencies, private registry URLs, or non-public references.
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

- [ ] Add `.github/workflows/ci.yml` for pull requests and pushes to the default branch.
- [ ] Ensure CI runs `bun install --frozen-lockfile` from a clean checkout.
- [ ] Ensure CI runs `bun run validate`.
- [ ] Ensure CI runs backend tests, mainview tests, typecheck, style checks, TOML validation, and formatting checks.
- [ ] Add a dependency review workflow if appropriate for the repository and license/security posture.
- [ ] Add CodeQL or an equivalent code scanning workflow if appropriate for the stack.
- [ ] Add Dependabot configuration for npm/Bun dependencies and GitHub Actions.
- [ ] Add release-note configuration under `.github/release.yml`.
- [ ] Verify every package script referenced in README, docs, workflows, and templates still exists and works.
- [ ] Verify CI does not require private secrets for normal pull request validation.
- [ ] Verify CI artifacts, logs, and test outputs do not expose secrets or machine-specific paths.

## 5. README Improvements

- [ ] Add a polished hero screenshot near the top of `README.md` using fake/demo data only.
- [ ] Add a screenshot gallery or visual feature section with safe demo data.
- [ ] Add a concise security model summary covering local auth, plugins, filesystem/network boundaries, and unsafe mode.
- [ ] Add badges only after the underlying CI, license, release, and status items are real.
- [ ] Verify all README commands work from a clean clone.
- [ ] Verify README terminology matches `UBIQUITOUS_LANGUAGE.md` after public terminology is finalized.

## 6. Plugin System Public Readiness

- [ ] Document the plugin manifest format with required fields, optional fields, examples, validation rules, and common errors.
- [ ] Document plugin permissions, including each permission name, capability granted, risk level, and user-facing explanation.
- [ ] Document plugin settings and secret fields, including how secret values are stored, displayed, redacted, reset, and reported in diagnostics.
- [ ] Document notification provider behavior for plugins, including registration, user configuration, permissions, and failure states.
- [ ] Document model provider registration behavior for plugins, including provider metadata, credentials, request flow, and user approval expectations.
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
- [ ] Add a documented manual QA checklist covering install, auth, provider setup, project creation, threads, diffs, cron, plugins, settings, and diagnostics.
- [ ] Add a documented release validation checklist with commands, manual checks, docs checks, security checks, and artifact checks.
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

- [ ] Fix recurrence data loss on edit in `src/mainview/app/calendar-event-form-helpers.ts`: add a read-only/custom repeat option, avoid substring-only RRULE classification, and preserve unsupported or rich recurrence rules unless the user explicitly selects a supported preset.
- [ ] Fix day-grouping timezone inconsistency in `src/mainview/app/calendar-layout.ts`: choose one date-key strategy for all-day and timed events so same-date events do not land in different visible day columns for non-UTC viewers.
- [ ] Fix month focus highlight desync in `src/mainview/app/calendar-workspace.tsx`: update `focusedCalendarDateValue` when Prev, Next, Today, or the date input changes the visible month/date.

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

### Style: type scale, focus, and tab semantics

- [ ] Complete the ARIA tab pattern for interaction-mode tabs in `src/mainview/app/chat-workspace.tsx`: roving `tabIndex`, arrow-key handling, and `aria-controls`.

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
- [ ] Remove `backdrop-blur-sm` from the tooltip in `src/mainview/controls/codex-model-selector.tsx` unless it is converted to an approved overlay recipe.
- [ ] Introduce or use a shared badge primitive for the “Unread” badge in `src/mainview/app/thread-list-row.tsx`.
- [ ] Introduce or use a shared badge primitive for the secret badge in `src/mainview/app/plugin-administration-panel.tsx`.
- [ ] Replace off-grid spacing in `src/mainview/controls/codex-model-selector.tsx` (`py-px`, `ml-[10px]`, `pl-[10px]`, `mt-[1px]`) with 4px-grid-compliant spacing.
- [ ] Replace off-grid spacing/tracking in `src/mainview/controls/thread-access-control.tsx` (`space-y-1.5`, `tracking-[0.12em]`) with approved spacing and type tokens.
- [ ] Replace off-grid spacing/tracking in `src/mainview/app/mainview-cron-workspace-controller.tsx` with approved spacing and type tokens.
- [ ] Replace `mt-1.5` in `src/mainview/app/settings-panel.tsx` with 4px-grid-compliant spacing.
- [ ] Bring mobile chat-bubble spacing in `src/mainview/app/chat-workspace.tsx` back onto the 4px grid instead of `px-[10px]`, `py-[10px]`, and `px-[2px]` recipes.
- [ ] Standardize small icon buttons to the 28px standard instead of 24px in `src/mainview/controls/chat-composer-control.tsx`.
- [ ] Standardize small icon buttons to the 28px standard instead of 24px in `src/mainview/app/calendar-workspace.tsx`.
- [ ] Standardize small icon buttons to the 28px standard instead of 24px in `src/mainview/controls/list-row.tsx`.
- [ ] Fix invalid notification tray markup in `src/mainview/App.tsx` by avoiding block-level `<div>` nesting inside an unstyled `AppButton`/`<button>`.

## 14. Backend Audit Follow-up: `src/bun` Bugs, Security Findings, and Threat-Model Clarifications

For every item in this section: inspect the referenced code, decide whether the audit note is a real bug/security issue or an expected threat-model/design tradeoff, then either fix it with tests or add/adjust code comments and/or docs so future auditors understand why the behavior is safe. Mark an item complete only after the codebase itself contains the fix, regression test, or clarifying comment/docs.

### Auth and session follow-up

- [ ] A1: Review recovery-code consumption in `src/bun/auth/service-login.ts` (`verifyPrimaryFactorAndRecoveryCode`). If any caller can authenticate without atomically consuming the code, fix it; otherwise add a comment/test proving the single-use SQL update is mandatory and race-safe.
- [ ] A2: Review recovery-code matching/mark-used timing in `src/bun/auth/service-login.ts` (`findMatchingUnusedRecoveryCodeHash` and `markAuthRecoveryCodeUsed`). If there is a practical race or timing leak, fix it; otherwise add a threat-model comment/test explaining why fixed-size Argon2 fan-out plus conditional SQL consumption is acceptable.
- [ ] A3: Review concurrent recovery-code reuse behavior in `src/bun/auth/service-login.ts`. Add a regression test showing a second concurrent mark attempt fails generically, or fix the flow if that is not currently guaranteed.
- [ ] A4: Review primary-factor-plus-TOTP lockout behavior in `src/bun/auth/service-session.ts` and `src/bun/auth/service-login.ts`. If a stolen primary factor enables too many TOTP guesses, tighten lockout/rate-limit policy; otherwise document the accepted risk and existing route-level throttles.
- [ ] A6: Review `src/bun/db.ts` (`setAuthFailureState`) for implicit bootstrap-user creation through `resolveRequiredAuthUserId`. If unexpected writes are possible, fix; otherwise add a comment explaining the singleton-local-operator compatibility shim.
- [ ] A7: Review synthetic local-operator handling in `src/bun/db.ts` (`LOCAL_SETTINGS_COMPAT_USER_ID`, `buildSyntheticLocalOperatorUser`, `readSyntheticLocalOperatorUser`). Fix any real possibility of shadowing a real user id or add comments/tests proving legacy-only scope.
- [ ] A8: Review `src/bun/db.ts` (`getAuthSettings`) and `getFirstConfiguredAuthUserId` for accidental rebinding to the first user row. Fix if user identity can drift; otherwise comment the singleton auth invariant.
- [ ] A9: Deduplicate or clarify `rethrowAuthSecretError` behavior across `src/bun/auth/service-login.ts`, `src/bun/auth/service-session.ts`, and `src/bun/auth/reset.ts`. If unknown auth-secret failures produce confusing 500s, map them to stable auth errors.
- [ ] A10: Review fallback auth/CSRF cookie parsing in `src/bun/auth/service-cookies.ts` (`readPreferredCookieValue`). If the legacy fallback weakens secure-cookie behavior, fix; otherwise comment migration threat model.
- [ ] A11: Review cookie parsing in `src/bun/auth/service-cookies.ts` for name/value handling. Add tests or comments showing duplicated, empty, and `=`-containing values are handled intentionally.
- [ ] A12: Review CSRF token size and digest comparison in `src/bun/auth/service-cookies.ts` and `src/bun/auth/http-security.ts`. Add a short comment/test for the 256-byte cap and hash-then-compare behavior if not already clear.
- [ ] A13: Review lockout audit ordering in `src/bun/auth/service-core.ts` (`recordInvalidAuthAttempt` and `incrementFailedAttempts`). If the triggering failed attempt is mislabeled, fix audit events; otherwise add tests/comments explaining lockout event semantics.
- [ ] A14: Review shared lockout counter for primary-factor, TOTP, and recovery-code failures in `src/bun/auth/service-core.ts` and `src/bun/auth/service-login.ts`. If it creates bad UX or security ambiguity, split counters; otherwise document that all auth proof failures intentionally share one lockout.
- [ ] A15: Review TOTP replay-window and last-used-counter comments in `src/bun/auth/index.ts` and `src/bun/db.ts`. Add or update comments/tests proving replay rejection is compare-and-swap safe.

### Authorization and capability follow-up

- [ ] B1: Review `src/bun/rpc-websocket-auth.ts` (`revalidateRpcWebSocketSession`) and `src/bun/index.ts` websocket close behavior. If admin revocation errors are too opaque for the UI, improve error surfacing; otherwise document why socket close is the intended response.
- [ ] B2: Clarify the local-operator/admin threat model in `src/bun/project-procedures/local-operator.ts`: add comments or docs explaining why `isAdmin` is the sole app-management gate in the single-operator model.
- [ ] B3: Review session-scoped step-up in `src/bun/auth/service-session.ts`. If stolen-session exposure is too broad, shorten lifetime or bind step-up to stronger context; otherwise document the 10-minute accepted risk.
- [ ] B4: Review non-admin WebSocket connection behavior in `src/bun/index.ts` and `src/bun/rpc-transport.ts`. If non-admin sockets can consume excessive resources, add tighter limits; otherwise comment that admin-only checks are per-procedure.
- [ ] B5: Verify thread/project visibility checks in `src/bun/project-procedures.ts` for `getThreadProcedure` and related thread reads. Fix any IDOR; otherwise add tests/comments proving procedure-level authz covers raw RPC param validation.
- [ ] B6: Review manual cron run path (`runCronNowProcedure`) versus scheduled-run concurrency limits in `src/bun/sidecar-cron-runner.ts`. If manual runs can bypass intended caps, add a limiter; otherwise document the deliberate operator-controlled bypass.
- [ ] B7: Review all uses of `requireLocalOperatorCapability(context, "recent_step_up")`. Ensure sensitive procedures also require `manage_app` when intended; add comments/tests to prevent future refactors from relying on step-up alone.

### SQLite and persistence follow-up

- [ ] C2: Review `assertSafeSqliteColumnDefinition` in `src/bun/app-schema-migration.ts`. If its name overstates validation, rename or add a comment saying it is only for repository-authored migration DDL, not user input.
- [ ] C3: Review `rebuildProjectsTableForOwnerless` in `src/bun/app-schema-migration.ts`. If `GROUP BY path` can drop important legacy project rows, fix migration behavior; otherwise document expected data-consolidation semantics.
- [ ] C4: Review `rebuildAppNotificationDeliveriesForLocalInbox` in `src/bun/app-schema-migration.ts`. If legacy multi-user notifications should not become local inbox entries, filter or migrate explicitly; otherwise comment the single-operator migration choice.
- [ ] C5: Review swallowed journal-mode errors in `src/bun/auth/rate-limit.ts`. If degraded SQLite mode hides real startup problems, log or surface diagnostics; otherwise comment why brute-force protection should stay available.
- [ ] C6: Review dedicated auth rate-limit SQLite connection contention in `src/bun/auth/rate-limit.ts`. If it can starve login/setup flows, add backoff/telemetry; otherwise document the busy-timeout design.
- [ ] C7: Review `getFirstConfiguredAuthUserId` and singleton auth ownership in `src/bun/db.ts`. Fix if first-user lookup can misattribute auth state; otherwise add invariants/tests.
- [ ] C8: Review `tryAdvanceTotpLastUsedCounter` in `src/bun/db.ts`. Add a comment/test showing it intentionally rejects equal or older counters and is an atomic replay guard.
- [ ] C9: Review startup TOTP secret migration hook in `src/bun/index.ts` and `src/bun/auth/secret-migration.ts`. If missing coverage, add tests/comments around legacy v1-to-v2 ciphertext migration.
- [ ] C11: Review plugin SQLite read guards in `src/bun/plugin/sqlite.ts` (`assertReadStatement`, `containsSqlIdentifierFromSet`). Fix false positives/false negatives if real; otherwise add tests/comments explaining why mutating CTEs and dangerous identifiers are blocked.
- [ ] C12: Review `sqlite.run` policy in `src/bun/plugin/sqlite.ts` for `CREATE TRIGGER`, `CREATE VIRTUAL TABLE`, `DROP`, and similar statements. If these should be disallowed, enforce it; otherwise document that plugins may fully control only their own `~/` SQLite DB.
- [ ] C13: Review `load_extension()` detection in `src/bun/plugin/sqlite.ts`. Add tests for quoted identifiers, comments, and whitespace to prove the guard cannot be bypassed in executable function calls.

### Plugin QuickJS sandbox follow-up

- [ ] D1: Review `MAX_ENTRYPOINT_EXPORT_REWRITE_SOURCE_BYTES` and source rewriting memory use in `src/bun/plugin/quickjs-runtime.ts`. If large plugin entrypoints can cause pressure, reduce the cap or stream/avoid duplicate copies; otherwise document accepted startup memory cost.
- [ ] D2: Review `rewriteEntrypointExports` regexes in `src/bun/plugin/quickjs-runtime.ts`. Fix if valid plugin export syntax is mishandled; otherwise add tests/comments stating supported export syntax.
- [ ] D3: Review unsupported export styles in `src/bun/plugin/quickjs-runtime.ts`. Add a clearer plugin startup error or docs for unsupported CommonJS/TypeScript export forms.
- [ ] D4: Review callback invocation token handling in `src/bun/plugin/quickjs-runtime.ts`. If plugin code can read or forge the token, fix isolation; otherwise add comments/tests proving token secrecy is within the QuickJS bootstrap boundary.
- [ ] D5: Review host global override risk in `src/bun/plugin/quickjs-runtime.ts` (`__metidosHostStructuredDataOperation` and related globals). If plugin self-shadowing breaks host API invariants, freeze or hide host bindings; otherwise document that a plugin can only sabotage itself.
- [ ] D6: Review QuickJS interrupt/timeout handling in `src/bun/plugin/quickjs-runtime.ts`. If guest code can catch/evade interrupts, add stronger cancellation or tests; otherwise document QuickJS deadline limitations.
- [ ] D7: Review `resolveQuickJsPromise` timeout behavior in `src/bun/plugin/quickjs-runtime.ts`. Add tests/comments for promise timeout, pending-job execution, and timer cleanup.
- [ ] D8: Review dispose cleanup in `src/bun/plugin/quickjs-runtime.ts`. If swallowed cleanup errors can hide leaks, log diagnostics; otherwise comment why best-effort cleanup is acceptable.
- [ ] D9: Review `pluginBytesHostPayload` in `src/bun/plugin/quickjs-runtime.ts`. Add tests/comments showing byte payloads are copied/base64 encoded safely.
- [ ] D10: Review per-plugin QuickJS memory limits in `src/bun/plugin/quickjs-runtime.ts` and sidecar manager. If multiple plugins can exhaust host memory, add a global cap/telemetry; otherwise document total-memory threat model.

### Plugin filesystem sandbox follow-up

- [ ] E1: Review `nearestExistingPathWithinRoot` in `src/bun/plugin/fs-path.ts`. Add tests/comments for deleted roots and missing ancestors.
- [ ] E2: Review `realpathExistingPath` fallback behavior in `src/bun/plugin/fs-path.ts`. If non-Windows broken symlink/unreadable ancestor handling is too strict or confusing, improve diagnostics; otherwise comment fail-closed behavior.
- [ ] E3: Review `assertOutsidePluginSource` in `src/bun/plugin/fs-path.ts`. Add a comment/test proving plugin-data paths are intentionally exempt while `./` project roots cannot read plugin source.
- [ ] E4: Review `pluginFsPathOpenUnavailableError` in `src/bun/plugin/fs-path.ts`. If diagnostics need causes, preserve `cause`; otherwise comment why host paths/errors are intentionally hidden from plugins.
- [ ] E5: Review recursive directory creation in `src/bun/plugin/fs-path.ts` (`mkdirValidatedPluginFsPathSync`). Add tests/comments proving recursive mkdir cannot escape the validated root.
- [ ] E6: Review `O_NOFOLLOW` and `lstat` behavior in `src/bun/plugin/fs-path.ts`. Add tests/comments for symlink leaf rejection on supported platforms and fail-closed behavior on Windows.
- [ ] E7: Review RPC param bounds in `src/bun/index.ts` (`MAX_RPC_RECORD_KEYS`, `MAX_RPC_RECORD_DEPTH`). If nested payloads can still cause CPU/memory pressure, tighten limits; otherwise document per-request bounds.

### Outbound network and SSRF follow-up

- [ ] F1: Review `src/bun/outbound-url-security.ts` `new Response(nodeResponse as unknown as BodyInit)`. If Bun/Node stream coercion is brittle or leaks sockets, wrap with a proper Web `ReadableStream`; otherwise comment runtime assumption and add a test.
- [ ] F2: Review custom DNS `lookup` callback shape in `src/bun/outbound-url-security.ts`. Add tests/comments for `lookupOptions.all` and single-address callbacks.
- [ ] F3: Review IPv4/IPv6 blocklists in `src/bun/outbound-url-security.ts`. If missing ranges matter, update; otherwise comment the intentionally blocked private/reserved ranges.
- [ ] F4: Review IPv4-mapped IPv6 handling in `src/bun/outbound-url-security.ts`. Add tests for `::ffff:127.0.0.1`, malformed suffixes, and fail-closed behavior.
- [ ] F5: Review `isIP` behavior for IPv4-in-IPv6 forms in `src/bun/outbound-url-security.ts`. Add tests/comments if not already covered.
- [ ] F6: Review redirect URL handling in `src/bun/outbound-url-security.ts` (`resolveSafeRedirectUrl`). Add tests/comments for scheme-relative redirects and per-hop revalidation.
- [ ] F7: Review mixed A/AAAA DNS result rejection in `src/bun/outbound-url-security.ts`. Add comments/tests clarifying that any blocked resolved address rejects the hostname.
- [ ] F8: Review DNS error handling in `src/bun/outbound-url-security.ts`. If transient DNS errors should be distinguishable from policy denials, improve error codes; otherwise comment current generic behavior.
- [ ] F9: Review unsafe private-network mode in `src/bun/outbound-url-security.ts`. Add comments/docs explaining that localhost/RFC1918 are allowed only with unsafe private-network permission while metadata hosts remain blocked.
- [ ] F10: Review cloud metadata IPv6 checks in `src/bun/outbound-url-security.ts`. Add tests for known metadata hosts/addresses.
- [ ] F11: Review handling for `0.0.0.0` and reserved IPv4 ranges in `src/bun/outbound-url-security.ts`. Add tests/comments as needed.
- [ ] F12: Review plugin fetch response materialization in `src/bun/plugin/fetch.ts`. If 25MB binary responses plus base64 JSON can cause memory pressure, lower limits or introduce streaming/temp-file delivery; otherwise document accepted cap.
- [ ] F13: Review textual response detection in `src/bun/plugin/fetch.ts`. Add tests/comments for UTF-8 fatal decode and binary fallback.
- [ ] F15: Review blocked WebSocket request headers in `src/bun/plugin/websocket.ts`. Add tests/comments for Origin and Sec-WebSocket header denial.
- [ ] F16: Review plugin WebSocket DNS-hostname denial in `src/bun/plugin/websocket.ts`. If this is intentional until DNS-pinned dialing exists, add docs/comment; otherwise implement safe DNS pinning.
- [ ] F17: Review Bun WebSocket constructor options in `src/bun/plugin/websocket.ts`. If header/protocol behavior is runtime-dependent, add compatibility tests or normalize options.
- [ ] F18: Review WebSocket send-rate bucket reset on reconnect in `src/bun/plugin/websocket.ts`. If reconnect can bypass intended aggregate limits, add plugin-level rate limiting; otherwise document per-connection scope.
- [ ] F19: Review `closeAll` in `src/bun/plugin/websocket.ts`. If pending receives need reliable delivery of close/error events, await or drain; otherwise comment best-effort shutdown semantics.

### HTTP and RPC transport follow-up

- [ ] G1: Review `proxyWebServerShareRequest` in `src/bun/index.ts`. If main-server proxying can stream unbounded responses or leak resources, add response limits/backpressure; otherwise document that the share worker owns body limits and auth.
- [ ] G2: Review `safeDecodeRouteComponent` use in `src/bun/index.ts`. Add comments/tests confirming downstream path policies, not decoding, perform traversal checks.
- [ ] G3: Review terminal WebSocket admin revalidation in `src/bun/index.ts`. Add comments/tests proving terminal sockets require admin on every message.
- [ ] G4: Review mainview static asset cache/security headers in `src/bun/server/static-assets.ts` and `src/bun/index.ts`. Add comments/tests if auditors may confuse immutable asset caching with HTML/bootstrap caching.
- [ ] G5: Review `MAX_RPC_WEBSOCKET_MESSAGE_BYTES` in `src/bun/index.ts`. If chat image payloads allow too much memory pressure, lower limits or stream images; otherwise document why current cap is acceptable.
- [ ] G6: Review RPC rate-limit constants in `src/bun/index.ts` and `src/bun/rpc-transport.ts`. If 360 burst/180 per second is excessive, tune; otherwise document desktop-IDE traffic expectations.
- [ ] G7: Review per-message session revalidation DB reads in `src/bun/rpc-transport.ts` and `src/bun/auth/service-session.ts`. If expensive, add cache/telemetry; otherwise comment why row reads are acceptable and touches are throttled.
- [ ] G8: Review RPC `closeSession` order in `src/bun/rpc-transport.ts`. Add a regression test/comment proving state is cleaned up before socket close without leaks.
- [ ] G9: Review `publishLazy` snapshot/send behavior in `src/bun/rpc-transport.ts`. Add comments/tests for mutation-safe client iteration.
- [ ] G10: Review session index refresh in `src/bun/rpc-transport.ts`. Add tests for session id changes, null session ids, and stale socket cleanup.
- [ ] G11: Review `clientsBySessionId` cleanup in `src/bun/rpc-transport.ts`. Add leak tests or comments explaining regular Map cleanup on `close`.
- [ ] G12: Review RPC measurement start/failure paths in `src/bun/rpc-transport.ts`. Add tests/comments ensuring malformed frames do not leave open telemetry tokens.
- [ ] G13: Review decoded binary RPC payload limits in `src/bun/rpc-transport.ts`. Add tests for compressed/oversize rejection if missing.
- [ ] G14: Review client compressed binary frame rejection in `src/bun/rpc-transport.ts`. Add a comment/test explaining why clients cannot send compressed frames.
- [ ] G15: Review large RPC response JSON fallback in `src/bun/rpc-transport.ts`. If it blocks the event loop, prefer compressed binary for responses too; otherwise document compatibility tradeoff.
- [ ] G16: Review cron timeout behavior in `src/bun/sidecar-cron-runner.ts`. If timed-out cron threads keep running, abort/stop the Pi session; otherwise comment known resource behavior and add telemetry.
- [ ] G17: Review scheduled cron pending-count bookkeeping in `src/bun/sidecar-cron-runner.ts`. Add tests/comments to prevent mismatch with the actual concurrency limiter.
- [ ] G18: Review dev-port fallback and allowed-origin rebuilding in `src/bun/index.ts`. Add tests/comments for fallback port and WebSocket origin allowlist consistency.
- [ ] G19: Review main/share port collision checks in `src/bun/index.ts`. Add comments/tests for dev fallback behavior and fixed share-worker port assumptions.
- [ ] G20: Review base64 chat-image byte math in `src/bun/index.ts`. Add comments/tests to avoid future off-by-one cap changes.
- [ ] G21: Review aggregate chat image payload limits in `src/bun/index.ts`. If 8 large images per message can pressure memory, lower limits or stream; otherwise document accepted desktop-app cap.
- [ ] G22: Review `safeOutboundFetchWithTimeout` watchdog behavior in `src/bun/safe-outbound-fetch.ts`. Add tests/comments for `unref`, abort reason propagation, and timeout mapping.

### Calendar and notification follow-up

- [ ] H1: Review ICS text escaping in `src/bun/calendar/export.ts` with `ICAL.Component.addPropertyWithValue`. If newlines/control text can inject ICS properties, sanitize; otherwise add tests/comments proving `ical.js` escapes values safely.
- [ ] H2: Review date parsing strictness in `src/bun/calendar/export.ts` (`parseUtcIso`). Add comments/tests for invalid and lenient date inputs.
- [ ] H3: Review all-day date validation in `src/bun/calendar/export.ts`. Add tests/comments for invalid calendar dates and strict `YYYY-MM-DD` input.
- [ ] H4: Review public ICS unauthenticated rate limits in `src/bun/index.ts`. If scraping risk is too high, reduce limits or add optional auth; otherwise document public-calendar information disclosure expectations.
- [ ] H5: Review external ICS due-refresh time handling in `src/bun/calendar/ics.ts`. Add comments/tests if clock skew or timezone semantics are unclear.
- [ ] H6: Review external ICS background error logging in `src/bun/index.ts` and `src/bun/calendar/ics.ts`. If persistent failures cause log spam, add backoff; otherwise document polling/logging behavior.

### Terminal and PTY follow-up

- [ ] I1: Review shell executable realpath behavior in `src/bun/terminal-manager.ts`. Add tests/comments for symlinked shells and resolved paths.
- [ ] I2: Review terminal environment allowlist in `src/bun/terminal-manager.ts`. Add comments/tests proving sensitive dynamic-linker/env variables are excluded.
- [ ] I3: Review `METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST` in `src/bun/terminal-manager.ts`. If warning on sensitive-looking keys is insufficient, block by default; otherwise document operator opt-in threat model.
- [ ] I4: Review env-var name validation in `src/bun/terminal-manager.ts`. Add tests for unsafe names and valid names.
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

- [ ] J1: Review unauthenticated main-server forwarding of `/share/open` and `/s/` in `src/bun/index.ts`. If the share worker does not fully enforce claim/session policy, fix; otherwise add a comment at the proxy boundary naming the share worker as the auth authority.
- [ ] J2: Review public share route Origin/auth expectations in `src/bun/pi/web-server/share-thread.ts` and `src/bun/index.ts`. If cross-site access can expose private hosted content, tighten cookies/tokens; otherwise document public-share threat model.

### Miscellaneous backend hardening follow-up

- [ ] K1: Review in-process auth immediate-transaction queue in `src/bun/auth/service-login.ts`. Add comments/tests for per-Database scope and multi-connection behavior.
- [ ] K2: Review `releaseQueue` promise choreography in `src/bun/auth/service-login.ts`. Add a short comment/test proving depth accounting and queue release cannot deadlock.
- [ ] K3: Replace or justify direct `console.warn` calls in backend security-sensitive paths. Prefer structured subsystem logging where runtime logger is available; otherwise comment early-startup/CLI constraints.
- [ ] K4: Review TTY-only destructive CLI checks in `src/bun/index.ts` and `src/bun/auth/reset.ts`. Add tests/comments for non-TTY refusal.
- [ ] K5: Review dev-mode HTML reread/caching in `src/bun/index.ts`. Add comments/tests clarifying production cache versus dev template reload behavior.
- [ ] K6: Review startup cache warmup deferral in `src/bun/index.ts`. If first request can race expensive warmup, fix scheduling; otherwise comment best-effort nature.
- [ ] K7: Review overload monitoring in `src/bun/index.ts`. If lag should trigger backpressure instead of only logs, add behavior; otherwise document observability-only intent.
- [ ] K8: Review `getGitSchedulerStats` use in the overload monitor. If many worktrees make the monitor expensive, add sampling/telemetry; otherwise comment expected cheapness.
- [ ] K9: Review runtime-stats pending RPC snapshots in `src/bun/index.ts` and `src/bun/rpc-transport.ts`. Add comments/tests if getter semantics are unclear.
- [ ] K10: Review per-request versus per-connection RPC param bounds in `src/bun/index.ts`. If repeated large bounded requests can DoS, add aggregate limits; otherwise document per-request threat model.
- [ ] K11: Review `Buffer.byteLength`-based string limits in `src/bun/index.ts`. Add tests/comments for multibyte UTF-8 rejection.
- [ ] K12: Review `objectParams` validator casts in `src/bun/index.ts`. Add stricter typed validators for risky RPCs or comments/tests showing shape validation is sufficient.
- [ ] K13: Review chat-image path-specific string cap in `src/bun/index.ts` (`rpcStringLimitForChatImagePath`). Add tests/comments to prevent accidental cap bypass.
- [ ] K14: Review one-shot warmup timer cleanup in `src/bun/index.ts`. Add comments/tests if shutdown during warmup can leave work running.
- [ ] K16: Audit `src/bun/message-activity-store.ts` separately for persistence, size limits, and authorization boundaries; add comments/fixes as appropriate.
- [ ] K17: Review SQL `LIMIT` and pagination use in `src/bun/message-activity-store.ts` and adjacent stores. Add tests/comments for bind parameters and bounded reads.

### Audit coverage notes from the previous pass

- [ ] L2: Inspect `src/bun/auth/secret-migration.ts` directly. Add comments/tests for legacy ciphertext migration threat model and failure behavior, or fix any discovered migration issue.
