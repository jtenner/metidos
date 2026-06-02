# Metidos Open Source Launch TODO

This file tracks active TODOs only. When a task is completed, remove it from this file instead of leaving a checked item behind.

This checklist is for repository improvements only before making Metidos public/open source. Do not treat this as a marketing or launch-promotion plan. Work through items in small, reviewable PRs or commits.

## 1. Repository Hygiene and Public Readiness

- [ ] Finish checked-in artwork ownership review. Context: `docs/public-asset-provenance-audit-2026-06-02.md` inventories tracked PNG/font assets, confirms font license coverage, and documents `docs/uploadthing-test.png` as a repo-owned generated fixture; `website/README.md` now acknowledges the tracked `website/bird.png` asset. `docs/artwork-provenance-maintainer-request-2026-06-02.md` now contains the exact maintainer questions for the remaining unapproved artwork. Remaining 3-minute slices:
  - [ ] Send or answer the drafted maintainer request in `docs/artwork-provenance-maintainer-request-2026-06-02.md` for the shared bird mascot/favicon asset at `bird.png` and `website/bird.png`, then update `docs/public-asset-provenance-audit-2026-06-02.md` with creator/source, creation date if known, license/assignment/redistribution approval, and whether both copies should remain tracked.
  - [ ] Send or answer the drafted maintainer request in `docs/artwork-provenance-maintainer-request-2026-06-02.md` for `src/mainview/pixel-crown.png`, then update `docs/public-asset-provenance-audit-2026-06-02.md` with creator/source, creation date if known, and license/assignment/redistribution approval, or replace/remove the asset before publishing.
  - [ ] Re-run the tracked asset inventory after the remaining artwork decisions are documented.

## 5. README Improvements

- [ ] Add a polished hero screenshot near the top of `README.md` using fake/demo data only.
- [ ] Add a screenshot gallery or visual feature section with safe demo data.
- [ ] Add badges only after the underlying CI, license, release, and status items are real.
- [ ] Verify all README commands work from a clean clone.

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

- [ ] Add calendar notification and permission seam tests. Context: `docs/backend-test-gap-audit-2026-06-02.md` identified gaps around `src/bun/calendar/notifications.ts`, `src/bun/calendar/permissions.ts`, `src/bun/project-procedures/calendar-procedures.ts`, `src/bun/rpc-handlers/calendar.ts`, and `src/bun/pi/metidos/calendar.ts`; cover owned/userless events, due windows, duplicate suppression, disabled outlets, and missing user/project handling.
- [ ] Add Pi-native Metidos tool wrapper tests. Context: `docs/backend-test-gap-audit-2026-06-02.md` identified gaps around `src/bun/pi/metidos/thread.ts`, `cron.ts`, `notifications.ts`, `model-discovery.ts`, `permission-normalization.ts`, and `targeting.ts`; cover target resolution, permission normalization, safe-context unsafe escalation denial, local-operator-only mutations, provider selection, and secret redaction.
- [ ] Add persistence adapter boundary tests. Context: `docs/backend-test-gap-audit-2026-06-02.md` identified gaps around `src/bun/thread-store.ts`, `src/bun/message-activity-store.ts`, `src/bun/cron-store.ts`, `src/bun/thread-status-coalescer.ts`, and `src/bun/user-notifications.ts`; cover bound singleton database use, cron due filtering, active cron threads, disabled/deleted jobs, stale last-run values, and status transitions.
- [ ] Add mainview shell navigation and workspace composition tests. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `src/mainview/App.tsx`, `workspace-panel.tsx`, sidebar/thread panels, and desktop/mobile navigation; cover fake project/worktree/thread surface switching, selected/busy/error state, and empty states.
- [ ] Add cron workspace controller and mutation UI tests. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `src/mainview/app/mainview-cron-workspace-controller.tsx`, `cronjob-workspace.tsx`, and cron run/load helpers; cover refresh invalidation, create/edit/delete/disable/run-now busy states, failed mutations, and permission/workspace summaries using mocked RPC calls.
- [ ] Add terminal workspace safety and local-operator affordance tests. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `src/mainview/app/terminal-workspace.tsx` and `use-terminals-controller.ts`; cover loading/connected/disconnected/failed states, unsafe warnings, session refresh/selection, and safe output summaries with fake terminal payloads.
- [ ] Add thread composer/controller tests for permissions, attachments, skills, and turn lifecycle. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `use-thread-turn-controller.ts`, `use-thread-settings-controller.ts`, `thread-start-request-dialog.tsx`, `thread-access-control.tsx`, attachment/skill helpers, and `ContextUsageMeter.tsx`; cover permission display, fake image attachment states, skill states, send/stop/failure recovery, provider policy callouts, and context limit labels without real provider calls.
- [ ] Add settings and plugin administration composition tests. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `settings-panel.tsx`, `use-plugin-administration-controller.ts`, and composed plugin admin flows; cover settings section navigation, plugin refresh/lifecycle feedback, reset-data, ingress route edits, declared settings save/clear-secret behavior, and step-up retry with mocked plugin RPC calls.
- [ ] Add git history and diff modal UI flow tests. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `git-history-panel.tsx`, `git-history-diff-modal.tsx`, and `use-worktree-diff.ts`; cover history loading/pagination/empty/failure states, modal load/close/reopen, and fake small/large/binary/deleted/renamed diff payloads.
- [ ] Add auth HTTP route integration tests. Context: `docs/auth-session-test-gap-audit-2026-06-02.md` found strong service/helper coverage but missing request/response coverage for `/auth/status`, `/auth/csrf`, `/auth/setup/start`, `/auth/setup`, `/auth/login`, `/auth/recovery-login`, `/auth/step-up`, `/auth/reset-pin`, `/auth/reset-password`, `/auth/logout`, and `/auth/ws-ticket`; cover status codes, JSON error codes, cookie set/clear behavior, websocket-ticket clearing, stale/expired sessions, and logout `Clear-Site-Data`.
- [ ] Add auth route CSRF/origin/fetch-metadata regression tests. Context: `docs/auth-session-test-gap-audit-2026-06-02.md` recommends route-level coverage for missing/mismatched CSRF tokens, disallowed origins, hostile Fetch Metadata headers, CSRF-free `/auth/status` read security, and unauthenticated rate-limited `/auth/csrf` behavior.
- [ ] Add session revocation side-effect integration tests. Context: `docs/auth-session-test-gap-audit-2026-06-02.md` recommends fake/injected tests proving browser reset routes revoke sessions, clear session and websocket-ticket cookies, close websocket/terminal contexts, request thread-turn shutdown, and proving logout closes only the logged-out session while revoking its pending websocket tickets.
- [ ] Add auth status privacy and multi-user/pending-user route tests. Context: `docs/auth-session-test-gap-audit-2026-06-02.md` recommends route-level tests proving unauthenticated or wrong-session status responses do not leak global user lists, authenticated responses expose only intended current-session identity metadata, pending-user states are handled, and missing/deleted/revoked sessions return deterministic contributor-friendly errors.
- [ ] Add cron authorization and ownership boundary tests. Context: `docs/cron-test-gap-audit-2026-06-02.md` found missing route/procedure coverage proving regular users cannot list, update, delete, or manually run cron jobs outside visible project/worktree scope, including deleted/untracked contexts and local-operator/admin contrast cases.
- [ ] Add cron scheduler/runner failure and concurrency tests. Context: `docs/cron-test-gap-audit-2026-06-02.md` found missing coverage for scheduler/runner edge cases; `src/bun/sidecar-cron-scheduler.test.ts` now covers invalid schedules already stored during scheduler startup without blocking valid job registration. Remaining 3-minute slices:
  - [ ] Add scheduler sync coverage for an already-registered cron job later updated to an invalid schedule, proving the stale handle is stopped and no replacement handle remains active.
  - [ ] Add coverage for overlapping scheduled/manual cron triggers and expected stale-run suppression/status updates.
  - [ ] Add runner failure coverage before thread creation, during thread creation, and during runtime execution, including status and telemetry/counter updates.
- [ ] Add cron mainview composition tests. Context: `docs/cron-test-gap-audit-2026-06-02.md` found only helper-level mainview cron coverage; add mocked RPC tests for loading, refresh invalidation, create/edit/delete/disable/run-now busy states, mutation failures, permission/workspace summaries, and empty states.
- [ ] Smoke `bun run dev` from a clean clone after documented setup only. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining public-readiness gap; record exact OS, Bun version, commands, local URL output, pass/fail status, stop method, and any setup prerequisites.
- [ ] Smoke `bun run start` from a clean clone after documented setup only. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining public-readiness gap; record exact OS, Bun version, commands, local URL output, pass/fail status, stop method, and any setup prerequisites.
- [ ] Verify first-run Local Auth from a disposable setup. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies setup/login/logout/recovery/reset guidance as a remaining gap; record safe metadata only and do not capture secrets, cookies, TOTP seeds, recovery codes, or private screenshots.
- [ ] Verify provider-free and fake-provider first-run behavior. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies no-provider UI behavior and fake/local provider setup as remaining gaps; record exact messages and prerequisites without real provider credentials.
- [ ] Verify the first Project, Worktree, safe Thread, and Diff review tutorial path with a disposable demo repository. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining gap; use fake/demo data only.
- [ ] Smoke documented install/setup failure-path readability. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` lists wrong/missing Bun version, missing/minimal `.env`, unwritable `METIDOS_APP_DATA_DIR`, port conflict, and stale/missing Mainview asset recovery as remaining gaps; record whether errors include contributor-friendly next steps.
- [ ] Smoke backup, restore, and auth reset procedures with disposable App Data. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies these as remaining gaps; verify docs do not require private paths or secret values.
- [ ] Smoke Docker and/or Podman install guidance in a disposable container. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies container setup as a remaining gap; record host OS, engine/version, commands, pass/fail status, first-run auth outcome, provider expectations, backup/restore notes, and teardown.
- [ ] Smoke or desk-check reverse-proxy/Tailscale/TLS setup guidance. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies remote-access setup as a remaining gap; record which checks were executed versus only reviewed.
- [ ] Dry-run or execute the installer skill workflow in an approved disposable scenario. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies `.pi/skills/metidos-installation/SKILL.md` as a remaining gap; verify it asks expected questions, emits a secret-safe `metidos-config.md`, and does not apply host changes before approval.
- [ ] Fix clean disposable root `test` prerequisite/failures. Context: `.wiki/package-script-reference-audit.md` records `bun run test` failed because the clean checkout lacked the generated xmloxide WASM artifact; after `bun run build:xmloxide-wasm`, targeted XML-dependent plugin runtime tests passed. Make the clean-checkout test path build/provide this artifact, then rerun the full suite and investigate the remaining `src/bun/plugin/sidecar-manager.test.ts` crash-loop degraded-status failure.
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

## 14. Backend Audit Follow-up: `src/bun` Bugs, Security Findings, and Threat-Model Clarifications

For every item in this section: inspect the referenced code, decide whether the audit note is a real bug/security issue or an expected threat-model/design tradeoff, then either fix it with tests or add/adjust code comments and/or docs so future auditors understand why the behavior is safe. Mark an item complete only after the codebase itself contains the fix, regression test, or clarifying comment/docs.

### Auth and session follow-up

### Authorization and capability follow-up


### HTTP and RPC transport follow-up

### Miscellaneous backend hardening follow-up

