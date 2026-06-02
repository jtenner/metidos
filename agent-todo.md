# Metidos Open Source Launch TODO

This file tracks active TODOs only. When a task is completed, remove it from this file instead of leaving a checked item behind.

This checklist is for repository improvements only before making Metidos public/open source. Do not treat this as a marketing or launch-promotion plan. Work through items in small, reviewable PRs or commits.

## 1. Repository Hygiene and Public Readiness

- [ ] Finish checked-in artwork ownership review. Context: `docs/public-asset-provenance-audit-2026-06-02.md` inventories tracked PNG/font assets, confirms font license coverage, and documents `docs/uploadthing-test.png` as a repo-owned generated fixture; `website/README.md` now acknowledges the tracked `website/bird.png` asset. Remaining 3-minute slices:
  - [ ] Ask the maintainer to confirm creator/source, creation date if known, license/assignment/redistribution approval for the shared bird mascot/favicon asset at `bird.png` and `website/bird.png`, or replace/remove both before publishing. Context: `docs/public-asset-provenance-audit-2026-06-02.md` now documents byte identity, lack of PNG text metadata, Git history only tracing to the initial snapshot, current root/website usage, and why both copies may remain tracked if approved.
  - [ ] Resolve `src/mainview/crown.png` provenance blocker. Context: audit inspection found no textual PNG metadata and Git history only traces to the 2026-05-27 initial open-source snapshot; ask the maintainer to confirm creator/source, creation date if known, and license/assignment/redistribution approval, or replace/remove the asset before publishing.
  - [ ] Resolve `src/mainview/logo.png` provenance blocker. Context: audit inspection found no textual PNG metadata and Git history only traces to the 2026-05-27 initial open-source snapshot; ask the maintainer to confirm creator/source, creation date if known, and license/assignment/redistribution approval, or replace/remove the asset before publishing.
  - [ ] Resolve `src/mainview/pixel-crown.png` provenance blocker. Context: audit inspection found no textual PNG metadata and Git history only traces to the 2026-05-27 initial open-source snapshot; ask the maintainer to confirm creator/source, creation date if known, and license/assignment/redistribution approval, or replace/remove the asset before publishing.
  - [ ] Re-run the tracked asset inventory after the remaining artwork decisions are documented.

## 3. Security and Secret Handling

- [ ] Add or improve tests around plugin permission enforcement.
- [ ] Add or improve tests around filesystem path validation, denied paths, symlink handling, and traversal attempts.
- [ ] Add or improve tests around network policy enforcement and allowlist/denylist behavior.
- [ ] Verify security-sensitive error messages are actionable without leaking secrets or sensitive local paths.

## 4. CI, Validation, and Release Automation

- [ ] Smoke-run documented package scripts from a clean setup and record exact outcomes. Context: `.wiki/package-script-reference-audit.md` verifies referenced script names exist as of 2026-06-01 and records a 2026-06-02 current-checkout preflight smoke run where `tailwind:build`, `website:build`, `sync:core-plugins`, `toml:check`, `style:check`, `a11y:check`, `typecheck`, and `test` pass after two strict test typing fixes. Remaining 3-minute slices:
  - [ ] In a clean clone or disposable checkout, run the representative root build/check/test scripts and record exact OS, Bun version, command list, pass/fail status, and any setup prerequisites.
  - [ ] In a clean clone or disposable checkout, run the documented `src/mainview/getdown` scripts (`test`, `typecheck`, and bounded performance baseline commands if practical) and record exact outcomes.
  - [ ] Decide how to document intentionally long-running watch/start scripts (`dev`, `start`, TLS variants, `tailwind:watch`, `website:watch`): either bounded smoke checks with timeouts or an explicit rationale for excluding them from clean-clone execution validation.
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

### Focus, hover, and popover races

- [ ] Fix blur-close versus keyboard navigation in `src/mainview/controls/codex-model-selector.tsx`, especially when moving into the reasoning submenu.
- [ ] Remove or coordinate double initial-focus behavior in `src/mainview/controls/codex-model-selector.tsx`.

### Style: shared primitives and one-off controls

- [ ] Refactor cron mode tabs and “New Cron” in `src/mainview/app/mainview-cron-workspace-controller.tsx` to use approved shared primitives such as `AppButton`, `IconButton`, `ListOptionButton`, or `TabButton`.
- [ ] Refactor calendar event dialog inputs in `src/mainview/app/calendar-event-dialog.tsx` to avoid local one-off `focus:ring-accent/25` recipes and use shared input/focus styling.
- [ ] Refactor calendar edit dialog controls in `src/mainview/app/calendar-edit-dialog.tsx` to avoid local one-off focus/input/button styling.
- [ ] Refactor calendar ICS edit dialog controls in `src/mainview/app/calendar-ics-edit-dialog.tsx` to avoid local one-off focus/input/button styling.
- [ ] Refactor extension dialog primary/cancel/select controls in `src/mainview/app/thread-extension-ui-dialog.tsx` to use shared primitives.
- [ ] Refactor skills menu controls in `src/mainview/controls/chat-composer-control.tsx` to use shared primitives or approved shared recipes.
- [ ] Refactor choice dropdown options in `src/mainview/controls/choice-dropdown-control.tsx` to use shared primitives or approved shared recipes.
- [ ] Refactor Codex model selector controls in `src/mainview/controls/codex-model-selector.tsx` to use shared primitives or approved shared recipes.

### Style: semantic backdrops, cards, blur, badges, and spacing

- [ ] Remove card-like/decorative styling from the inline folder suggestion list in `src/mainview/app/projects-panel.tsx`, including sidebar `shadow-overlay`/`backdrop-blur-xl` drift.
- [ ] Remove card-like bordered `bg-surface-1` treatment from the add-project form in `src/mainview/app/projects-panel.tsx` or align it with approved non-card primitives.
- [ ] Replace decorative icon tiles in `src/mainview/app/settings-panel.tsx` with approved icon/section styling.
- [ ] Replace decorative icon tiles in `src/mainview/app/cronjob-workspace.tsx` with approved icon/section styling.
- [ ] Replace boxed loading/empty/error panels in `src/mainview/app/cronjob-workspace.tsx` with approved empty/error/loading primitives or inline treatments.
- [ ] Replace off-grid spacing/tracking in `src/mainview/app/mainview-cron-workspace-controller.tsx` with approved spacing and type tokens.

## 14. Backend Audit Follow-up: `src/bun` Bugs, Security Findings, and Threat-Model Clarifications

For every item in this section: inspect the referenced code, decide whether the audit note is a real bug/security issue or an expected threat-model/design tradeoff, then either fix it with tests or add/adjust code comments and/or docs so future auditors understand why the behavior is safe. Mark an item complete only after the codebase itself contains the fix, regression test, or clarifying comment/docs.

### Auth and session follow-up

- [ ] A4: Review primary-factor-plus-TOTP lockout behavior in `src/bun/auth/service-session.ts` and `src/bun/auth/service-login.ts`. If a stolen primary factor enables too many TOTP guesses, tighten lockout/rate-limit policy; otherwise document the accepted risk and existing route-level throttles.

### Authorization and capability follow-up


### Plugin QuickJS sandbox follow-up

- [ ] D10: Review per-plugin QuickJS memory limits in `src/bun/plugin/quickjs-runtime.ts` and sidecar manager. If multiple plugins can exhaust host memory, add a global cap/telemetry; otherwise document total-memory threat model.

### HTTP and RPC transport follow-up

- [ ] G1: Review `proxyWebServerShareRequest` in `src/bun/index.ts`. If main-server proxying can stream unbounded responses or leak resources, add response limits/backpressure; otherwise document that the share worker owns body limits and auth.
- [ ] G21: Review aggregate chat image payload limits in `src/bun/index.ts`. If 8 large images per message can pressure memory, lower limits or stream; otherwise document accepted desktop-app cap.

### Web-server share follow-up

- [ ] J2: Review public share route Origin/auth expectations in `src/bun/pi/web-server/share-thread.ts` and `src/bun/index.ts`. If cross-site access can expose private hosted content, tighten cookies/tokens; otherwise document public-share threat model.

### Miscellaneous backend hardening follow-up

