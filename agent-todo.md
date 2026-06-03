# Metidos Open Source Launch TODO

This file tracks active TODOs only. When a task is completed, remove it from this file instead of leaving a checked item behind.

This checklist is for repository improvements only before making Metidos public/open source. Do not treat this as a marketing or launch-promotion plan. Work through items in small, reviewable PRs or commits.

## 1. Repository Hygiene and Public Readiness

- [ ] Finish checked-in artwork ownership review. Context: `docs/public-asset-provenance-audit-2026-06-02.md` inventories tracked PNG/font assets, confirms font license coverage, and documents `docs/uploadthing-test.png` as a repo-owned generated fixture; `website/README.md` now acknowledges the tracked `website/bird.png` asset. `docs/artwork-provenance-maintainer-request-2026-06-02.md` now contains the exact maintainer questions for the remaining unapproved artwork. Remaining 3-minute slices:
  - [ ] Send or answer the drafted maintainer request in `docs/artwork-provenance-maintainer-request-2026-06-02.md` for the shared bird mascot/favicon asset at `bird.png` and `website/bird.png`, then update `docs/public-asset-provenance-audit-2026-06-02.md` with creator/source, creation date if known, license/assignment/redistribution approval, and whether both copies should remain tracked.
  - [ ] Send or answer the drafted maintainer request in `docs/artwork-provenance-maintainer-request-2026-06-02.md` for `src/mainview/pixel-crown.png`, then update `docs/public-asset-provenance-audit-2026-06-02.md` with creator/source, creation date if known, and license/assignment/redistribution approval, or replace/remove the asset before publishing.
  - [ ] After the remaining artwork decisions are documented, re-run the tracked asset inventory one final time. Context: an interim `git ls-files '*png' '*jpg' '*jpeg' '*svg' '*ico' '*webp' '*gif' '*woff2' '*ttf' '*otf' | sort` check on 2026-06-03 matched the current audit inventory and found no tracked asset list changes.

## 7. Install and First-Run Experience

- [ ] Test clean install on a fresh machine or disposable container and record the exact OS, Bun version, commands, and outcome.
- [ ] Verify `bun run start` works from a clean clone after documented setup only.
- [ ] Verify local auth setup and reset flow are documented and work as described.
- [ ] Verify missing dependencies produce readable errors with next-step guidance. Current blocker discovered 2026-06-02 and re-confirmed 2026-06-03: local `bun --version` prints `1.3.13` while the working tree `package.json` declares `bun@1.3.14`, so install/failure-path smoke evidence should not be refreshed until the runtime matches the repository requirement. Existing smoke docs under `docs/install-failure-path-*-smoke-2026-06-02.md` were re-read on 2026-06-03 and still cover missing Bun, missing/minimal `.env`, unwritable App Data, main port conflict, and missing generated Mainview assets. Re-checked during the 2026-06-03 recurring TODO run with `bun --version` -> `1.3.13` and `node -e "const p=require('./package.json'); console.log(p.packageManager)"` -> `bun@1.3.14`; mismatch remains. Remaining 3-minute slices:
  - [ ] Install or select Bun `1.3.14` for this workspace/runtime without changing repository files.
  - [ ] After Bun is updated, re-run `bun --version` and `node -e "const p=require('./package.json'); console.log(p.packageManager)"` and record matching output before refreshing install/failure-path smoke evidence.
- [ ] Verify backup and restore paths are documented and tested.
- [ ] Verify installation failure paths do not leave behind confusing or unsafe partial state.

## 8. Visual Assets

- [ ] Add or polish logo files in appropriate source and export formats.
- [ ] Add or polish mascot/icon files if they are part of the project identity.
- [ ] Add a GitHub social preview image using safe, repo-owned assets.
- [ ] Add an Open Graph image for the website using safe, repo-owned assets.
- [ ] Replace any remaining placeholder canonical/OG URLs with the chosen public website URL after hosting is decided.
- [ ] Add README screenshots with fake/demo data only.
- [ ] Add feature screenshots for project/worktree view using fake/demo data only.
- [ ] Add feature screenshots for agent threads using fake/demo data only.
- [ ] Add feature screenshots for diff review using fake/demo data only.
- [ ] Add feature screenshots for cron workspace using fake/demo data only.
- [ ] Add feature screenshots for plugin administration using fake/demo data only.
- [ ] Add feature screenshots for settings/provider setup using fake/demo data only.
- [ ] Ensure all screenshots hide usernames, hostnames, tokens, internal repositories, local paths, private branches, and real customer/user data.

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

- [ ] Add thread composer/controller tests for permissions, attachments, skills, and turn lifecycle. Context: `docs/mainview-test-gap-audit-2026-06-02.md` identified gaps around `use-thread-turn-controller.ts`, `use-thread-settings-controller.ts`, `thread-start-request-dialog.tsx`, `thread-access-control.tsx`, and attachment/skill helpers; cover permission display, fake image attachment states, skill states, send/stop/failure recovery, and provider policy callouts without real provider calls. Completed slices: `src/mainview/controls/ContextUsageMeter.test.tsx` now covers accessible context-limit labels and clamping for invalid/oversized token counts; `src/mainview/controls/chat-composer-control.test.ts` now covers draft-scoped fake image loading state plus stale and case-insensitive `/skills:` suggestion matching; `src/mainview/controls/thread-access-control.test.tsx` now covers access-control trigger dialog semantics, disabled trigger state, supplied description title, and desktop/mobile description popover placement; `src/mainview/app/thread-start-request-dialog.test.tsx` now covers closed rendering, accessible dialog labelling/description wiring, requested workspace/prompt/access/error/queue details, and busy disabled controls; `src/mainview/app/use-thread-settings-controller.test.tsx` now covers draft model updates before selection, successful reasoning-effort RPC upserts, stale-selection model failure recovery, and stale access-permission sanitization; `src/mainview/app/use-thread-turn-controller.test.tsx` now covers successful optimistic stop/merge behavior, stop RPC rollback, ignored stop requests for non-working Threads, and in-flight send discard protection.
- [ ] Add auth status privacy and multi-user/pending-user route tests. Context: `docs/auth-session-test-gap-audit-2026-06-02.md` recommends route-level tests proving unauthenticated or wrong-session status responses do not leak global user lists, authenticated responses expose only intended current-session identity metadata, pending-user states are handled, and missing/deleted/revoked sessions return deterministic contributor-friendly errors. Completed slices: `src/bun/auth/routes.test.ts` now covers authenticated status responses exposing only current-session identity metadata, stale and explicitly revoked session cookies returning deterministic unauthenticated status without username leakage, and setup-start pending usernames staying out of unauthenticated status reads. `docs/auth-session-test-gap-audit-2026-06-02.md` now confirms true wrong-session `/auth/status` coverage is blocked until auth sessions have per-session user ownership (today `auth_sessions` are resolved through the first configured auth user). Remaining 3-minute slices:
  - [ ] Add wrong-session `/auth/status` route tests after auth persistence stores session user ownership or exposes a test helper that can bind a session to a non-current user; assert the response does not leak global usernames and reports only the session owner metadata.
  - [ ] Revisit pending-user setup/login route tests only if pending users become HTTP-visible again. Current blocker/context: `createPendingUser` in `src/bun/auth/service-login.ts` is a disabled legacy provisioning entrypoint that throws `forbidden` for the single-local-operator model, and the HTTP auth routes expose setup-start/setup/login rather than pending-user provisioning. Future slice: if multi-user/pending-user HTTP endpoints are restored, add route-level tests for deterministic missing/pending/deleted user errors and privacy-safe status/login responses.
- [ ] Smoke `bun run start` from a clean clone after documented setup only. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining public-readiness gap; record exact OS, Bun version, commands, local URL output, pass/fail status, stop method, and any setup prerequisites.
- [ ] Verify first-run Local Auth from a disposable setup. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies setup/login/logout/recovery/reset guidance as a remaining gap; record safe metadata only and do not capture secrets, cookies, TOTP seeds, recovery codes, or private screenshots.
- [ ] Verify provider-free and fake-provider first-run behavior. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies no-provider UI behavior and fake/local provider setup as remaining gaps; record exact messages and prerequisites without real provider credentials.
- [ ] Verify the first Project, Worktree, safe Thread, and Diff review tutorial path with a disposable demo repository. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining gap; use fake/demo data only.
- [ ] Smoke backup, restore, and auth reset procedures with disposable App Data. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies these as remaining gaps; `docs/backup-restore-auth-reset-smoke-plan-2026-06-03.md` now defines the safe smoke scope, constraints, sanitized steps, and evidence acceptance criteria. Remaining 3-minute slice:
  - [ ] After local Bun matches the repository `packageManager`, run the smoke plan with disposable App Data and fake/demo Local Auth values, then commit a sanitized evidence note with exact OS, Bun version, commands, pass/fail result, stop method, teardown, and any documentation corrections.
- [ ] Smoke Docker and/or Podman install guidance in a disposable container. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies container setup as a remaining gap; record host OS, engine/version, commands, pass/fail status, first-run auth outcome, provider expectations, backup/restore notes, and teardown.

## 11. GitHub Public Repository Setup Notes

- [ ] Apply the recommended public repository description from `docs/github-public-repository-description-review-2026-06-03.md` when updating GitHub settings for publication. Context: review on 2026-06-03 found the current private-repo description accurate but too long and less aligned with the README tagline.
- [ ] Confirm the repository homepage URL points to the correct docs or repo-hosted website if one exists.
- [ ] Apply the recommended public repository topics from `docs/github-public-repository-topics-review-2026-06-03.md` when updating GitHub settings for publication. Context: review on 2026-06-03 found the current private-repo topics partly accurate but incomplete for discovery; `personal-assistant` should be removed unless project positioning changes.
- [ ] Confirm the social preview image is uploaded and renders correctly.
- [ ] Confirm CI runs publicly on pull requests and pushes without private secrets.
- [ ] Confirm branch protection or rulesets are enabled for the default branch.
- [ ] Confirm required checks match the actual CI workflow names.
- [ ] Confirm Discussions are enabled only if the project intends to support them.
- [ ] Confirm GitHub Wiki is disabled unless intentionally used.
- [ ] Confirm private security reporting is configured if available for the repository.
- [ ] Confirm default branch naming is intentional and documented where needed.
- [ ] Confirm repository visibility, fork settings, and Actions permissions are appropriate for a public project.

## 12. Final Pre-Public Checklist

- [ ] CI passes on the default branch.
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

