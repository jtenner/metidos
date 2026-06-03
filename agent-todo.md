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
- [ ] Verify missing dependencies produce readable errors with next-step guidance. Current blocker discovered 2026-06-02 and re-confirmed 2026-06-03: local `bun --version` prints `1.3.13` while the working tree `package.json` declares `bun@1.3.14`, so install/failure-path smoke evidence should not be refreshed until the runtime matches the repository requirement. Existing smoke docs under `docs/install-failure-path-*-smoke-2026-06-02.md` were re-read on 2026-06-03 and still cover missing Bun, missing/minimal `.env`, unwritable App Data, main port conflict, and missing generated Mainview assets. `docs/install-failure-path-partial-state-audit-2026-06-03.md` concludes those existing failure-path smokes do not show confusing or unsafe partial state; refreshing smoke evidence remains blocked until the runtime matches the repository requirement. Re-checked during the 2026-06-03 recurring TODO run with `bun --version` -> `1.3.13` and `node -e "const p=require('./package.json'); console.log(p.packageManager)"` -> `bun@1.3.14`; mismatch remains. Follow-up check on 2026-06-03 at 02:00 EDT found no workspace-managed Bun selector or binary (`.tool-versions` absent, `.mise.toml` absent, no tracked `**/bun` binary outside `src/bun/`), so upgrading or selecting Bun remains an operator/environment action outside this repository slice. Follow-up check on 2026-06-03 at 02:09 EDT confirmed `bun --version` still prints `1.3.13`, `package.json` still declares `bun@1.3.14`, and the active binary is `/usr/local/bin/bun`; the recurring agent cannot replace that host-level runtime while operating only inside this workspace. Remaining 3-minute slices:
  - [ ] Operator action: install or select Bun `1.3.14` for this workspace/runtime without changing repository files.
  - [ ] After Bun is updated, re-run `bun --version` and `node -e "const p=require('./package.json'); console.log(p.packageManager)"` and record matching output before refreshing install/failure-path smoke evidence.
- [ ] Verify backup and restore paths are documented and tested. Context: `docs/backup-restore-auth-reset-smoke-plan-2026-06-03.md` now includes command-ready disposable App Data, backup, restore, and auth reset smoke steps plus evidence redaction constraints; runtime execution remains blocked until local Bun matches `packageManager`.

## 8. Visual Assets

- [ ] Add or polish logo files in appropriate source and export formats. Current blocker clarified 2026-06-03: repo already has generated source/export icon assets for the website (`website/favicon.svg`, `website/app-icon.svg`) and generated preview assets (`website/og.svg`, `website/og.png`, `docs/brand/github-social-preview.svg`), but no canonical app/product logo requirement is recorded beyond the pending bird/crown artwork provenance decisions. Remaining 3-minute slices:
  - [ ] Decide whether the canonical public logo should be the generated terminal-prompt mark, the bird mascot, the crown artwork, or a new asset; record the decision in the relevant visual/provenance docs.
  - [ ] If the generated terminal-prompt mark is canonical, document required source/export paths and mark this logo task complete after confirming `website/favicon.svg` and `website/app-icon.svg` are sufficient.
  - [ ] If the bird mascot or crown artwork is canonical, complete the corresponding artwork provenance task first, then add any missing source/export files.
  - [ ] If a new logo is required, add a repo-owned source file plus public exports, update the asset provenance audit, and wire only the approved exports into README/website/app metadata.
- [ ] Add or polish mascot/icon files if they are part of the project identity. Current blocker clarified 2026-06-03: this cannot be completed independently from the canonical-logo and artwork-provenance decisions above because the only mascot-like tracked asset is the pending bird asset (`bird.png` / `website/bird.png`) and the crown icon also has unresolved provenance. Remaining 3-minute slices:
  - [ ] After the public identity decision is made, document whether the bird mascot, crown icon, generated terminal-prompt mark, or a new repo-owned asset is the mascot/icon source of truth.
  - [ ] If the bird or crown is part of the public identity, complete its provenance approval first, then add or polish any missing source/export files.
  - [ ] If no mascot/icon will be used for launch beyond the generated terminal-prompt mark, record that decision in the relevant visual/provenance docs and remove this task.
- [ ] Replace any remaining placeholder canonical/OG URLs with the chosen public website URL after hosting is decided. Current blocker clarified 2026-06-03: no final public website URL is recorded yet. Known placeholders are in `website/index.html` (`og:url`, `og:image`, `twitter:image`) and `website/README.md` still lists the go-live reminder. Remaining 3-minute slices:
  - [ ] Choose or record the final public website URL (for example the deployed Pages/static-host URL) in the relevant GitHub/publication notes.
  - [ ] Replace `https://YOUR_DOMAIN_OR_PAGES_URL/` in `website/index.html` with the final URL, keeping `og.png` paths correct.
  - [ ] Update `website/README.md` to remove or narrow the placeholder-host go-live reminder after the real URL is checked in.
- [ ] Ensure all screenshots hide usernames, hostnames, tokens, internal repositories, local paths, private branches, and real customer/user data. Context: README screenshots are now covered by `docs/images/readme-hero-demo.svg` and `docs/images/readme-feature-tour.svg`, referenced from `README.md`; the project/worktree feature screenshot is covered by `docs/images/feature-project-worktree-demo.svg`; the agent-thread feature screenshot is covered by `docs/images/feature-agent-thread-demo.svg` and referenced from `README.md`; the plugin administration feature screenshot is covered by `docs/images/feature-plugin-admin-demo.svg` and referenced from `README.md`; the provider settings/setup feature screenshot is covered by `docs/images/feature-provider-settings-demo.svg` and referenced from `README.md`; the cron workspace feature screenshot is covered by `docs/images/feature-cron-workspace-demo.svg` and referenced from `README.md`; a 2026-06-03 text scan for common secret/private-path markers found only self-descriptive safety copy in those SVGs.

## 9. Product Hardening

- [ ] Verify project creation, opening, closing, and error handling work from a clean setup.
- [ ] Verify Git worktree listing, opening, switching, and failure states work with small and realistic repositories.
- [ ] Verify agent thread creation, monitoring, stopping, and resuming behavior.
- [ ] Verify diff review with small diffs, large diffs, binary files, deleted files, renamed files, and conflict-like scenarios.
- [ ] Verify cron job creation, editing, run-now, disabling, and deletion. Context: `docs/cron-workspace-lifecycle-smoke-plan-2026-06-03.md` now defines a disposable safe Cron workspace lifecycle smoke covering create, edit persistence, run-now child Thread/error behavior, enable/disable, deletion/inactive state, and sanitized evidence requirements. Remaining 3-minute slice:
  - [ ] Run the smoke plan against a disposable App Data/profile and fake/demo repository, then commit sanitized evidence with exact OS, Bun version, commands, pass/fail status, stop method, teardown, and any documentation/UI corrections.
- [ ] Verify plugin discovery, review, approval, disable, reset-data, and failure states.
- [ ] Verify local auth session behavior, including login, logout, expiration, refresh, and invalid session handling.
- [ ] Verify step-up authentication protects sensitive actions and fails safely.
- [ ] Verify unsafe-mode warnings are visible, specific, and tied to the relevant risky action.
- [ ] Verify unsafe-mode boundaries are documented and enforced where applicable.
- [ ] Verify the app remains usable during long-running agent work, large logs, slow providers, and background cron activity.
- [ ] Verify major error paths produce actionable messages with next steps.

## 10. Testing

- [ ] Add auth status privacy and multi-user/pending-user route tests. Context: `docs/auth-session-test-gap-audit-2026-06-02.md` recommends route-level tests proving unauthenticated or wrong-session status responses do not leak global user lists, authenticated responses expose only intended current-session identity metadata, pending-user states are handled, and missing/deleted/revoked sessions return deterministic contributor-friendly errors. Completed slices: `src/bun/auth/routes.test.ts` now covers authenticated status responses exposing only current-session identity metadata, stale and explicitly revoked session cookies returning deterministic unauthenticated status without username leakage, and setup-start pending usernames staying out of unauthenticated status reads. `docs/auth-session-test-gap-audit-2026-06-02.md` now confirms true wrong-session `/auth/status` coverage is blocked until auth sessions have per-session user ownership (today `auth_sessions` are resolved through the first configured auth user). Remaining 3-minute slices:
  - [ ] Add wrong-session `/auth/status` route tests after auth persistence stores session user ownership or exposes a test helper that can bind a session to a non-current user; assert the response does not leak global usernames and reports only the session owner metadata.
  - [ ] Revisit pending-user setup/login route tests only if pending users become HTTP-visible again. Current blocker/context: `createPendingUser` in `src/bun/auth/service-login.ts` is a disabled legacy provisioning entrypoint that throws `forbidden` for the single-local-operator model, and the HTTP auth routes expose setup-start/setup/login rather than pending-user provisioning. Future slice: if multi-user/pending-user HTTP endpoints are restored, add route-level tests for deterministic missing/pending/deleted user errors and privacy-safe status/login responses.
- [ ] Smoke `bun run start` from a clean clone after documented setup only. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining public-readiness gap; record exact OS, Bun version, commands, local URL output, pass/fail status, stop method, and any setup prerequisites.
- [ ] Verify first-run Local Auth from a disposable setup. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies setup/login/logout/recovery/reset guidance as a remaining gap; record safe metadata only and do not capture secrets, cookies, TOTP seeds, recovery codes, or private screenshots.
- [ ] Verify provider-free and fake-provider first-run behavior. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies no-provider UI behavior and fake/local provider setup as remaining gaps; record exact messages and prerequisites without real provider credentials.
- [ ] Verify the first Project, Worktree, safe Thread, and Diff review tutorial path with a disposable demo repository. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies this as a remaining gap; use fake/demo data only.
- [ ] Smoke backup, restore, and auth reset procedures with disposable App Data. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies these as remaining gaps; `docs/backup-restore-auth-reset-smoke-plan-2026-06-03.md` now defines the safe smoke scope, command-ready disposable App Data/backup/restore/auth-reset steps, constraints, sanitized commands, and evidence acceptance criteria. Remaining 3-minute slice:
  - [ ] After local Bun matches the repository `packageManager`, run the command-ready smoke plan with disposable App Data and fake/demo Local Auth values, then commit a sanitized evidence note with exact OS, Bun version, commands, pass/fail result, stop method, teardown, and any documentation corrections.
- [ ] Smoke Docker and/or Podman install guidance in a disposable container. Context: `docs/install-setup-smoke-gap-audit-2026-06-02.md` identifies container setup as a remaining gap; record host OS, engine/version, commands, pass/fail status, first-run auth outcome, provider expectations, backup/restore notes, and teardown.

## 11. GitHub Public Repository Setup Notes

- [ ] Apply the recommended public repository description from `docs/github-public-repository-description-review-2026-06-03.md` when updating GitHub settings for publication. Context: review on 2026-06-03 found the current private-repo description accurate but too long and less aligned with the README tagline.
- [ ] Apply the recommended homepage URL decision from `docs/github-homepage-url-review-2026-06-03.md` when updating GitHub settings for publication. Context: review on 2026-06-03 found the current private-repo homepage URL empty; leave it empty unless a final static website URL is chosen and deployed before publication.
- [ ] Apply the recommended public repository topics from `docs/github-public-repository-topics-review-2026-06-03.md` when updating GitHub settings for publication. Context: review on 2026-06-03 found the current private-repo topics partly accurate but incomplete for discovery; `personal-assistant` should be removed unless project positioning changes.
- [ ] Confirm the social preview image is uploaded and renders correctly. Context: `docs/github-social-preview-setting-review-2026-06-03.md` records a pre-public check where `gh repo view --json openGraphImageUrl` still returned the owner avatar URL (`https://avatars.githubusercontent.com/u/3761339?s=400&v=4`), so the custom preview is not confirmed as uploaded. Remaining 3-minute slices:
  - [ ] Upload `docs/brand/github-social-preview.svg` in GitHub repository settings, or export/commit a repo-owned PNG first if the settings UI requires raster upload.
  - [ ] Re-run `gh repo view --json openGraphImageUrl` after upload and confirm it no longer returns the owner avatar URL.
  - [ ] Visually check the resulting repository social preview/Open Graph render and record the final image URL plus pass/fail evidence.
- [ ] Confirm CI runs publicly on pull requests and pushes without private secrets. Context: `docs/github-public-ci-review-2026-06-03.md` documents a pre-public workflow review: checked-in `CI`, `CodeQL`, and `Dependency Review` workflows use public-ready triggers/permissions and do not reference `secrets.*`, but the repository is still private and `gh run list` returned no recent runs, so public execution remains unconfirmed. Remaining 3-minute slices:
  - [ ] After the repository is public, or after a public-like test pull request is available, confirm a pull request and a push to `master` create the expected public Actions runs and record pass/fail evidence.
  - [ ] If public runs fail, update the workflow or installation documentation with the exact failure mode and remediation.
- [ ] Confirm branch protection or rulesets are enabled for the default branch. Context: `docs/github-required-checks-review-2026-06-03.md` documents the checked-in workflow/job names and recommends selecting required checks from GitHub's presented check list once branch protection/rulesets are available; at minimum require the `CI` workflow's `Validate` job. `docs/github-branch-protection-ruleset-availability-review-2026-06-03.md` records that, while the repo is private under the current account/repository feature set, both the branch protection and repository rulesets APIs return HTTP 403 requiring GitHub Pro or a public repository. Remaining 3-minute slices:
  - [ ] After the repository is public, or after branch protection/rulesets become available for this private repository, re-run the branch protection and rulesets checks for `master`.
  - [ ] Enable either branch protection or a repository ruleset for `master`, requiring at least the `CI` workflow's `Validate` job from GitHub's presented check list.
  - [ ] Record the enabled setting, enforcement mode, required check names, and any pull-request review requirements in the GitHub setup notes.
- [ ] Confirm Discussions are enabled only if the project intends to support them. Context: `docs/github-discussions-setting-review-2026-06-03.md` records that `gh repo view --json nameWithOwner,hasDiscussionsEnabled,visibility` observed Discussions enabled on the private repo, and that `SUPPORT.md` is compatible with either Discussions or documentation issues. Blocker confirmed during the 2026-06-03 recurring TODO run: this is a maintainer/product-support decision, not a code-only change; do not change GitHub settings until the support policy is chosen. Remaining 3-minute slices:
  - [ ] Ask the maintainer: for public launch, should GitHub Discussions be actively monitored for usage questions, or should Discussions be disabled and usage questions routed to documentation issues only?
  - [ ] If Discussions will be monitored, record the owner/monitoring cadence in `docs/github-discussions-setting-review-2026-06-03.md` and keep or enable the GitHub setting.
  - [ ] If Discussions will not be monitored for launch, disable Discussions in GitHub settings and update `SUPPORT.md` only if the fallback-to-documentation-issues wording needs to be stronger.
- [ ] Confirm private security reporting is configured if available for the repository. Context: `docs/github-private-security-reporting-review-2026-06-03.md` documents an API/CLI check on 2026-06-03: the repo was still private, `security_and_analysis` returned `null`, and `gh api repos/jtenner/metidos/private-vulnerability-reporting` returned `404 Not Found`, so API evidence did not confirm the setting. Remaining 3-minute slices:
  - [ ] Check the repository's GitHub settings UI for private security reporting availability after publication settings are being finalized.
  - [ ] If available, enable private security reporting and record verification evidence.
  - [ ] If unavailable, record the GitHub/account/repository reason and confirm `SECURITY.md` is the intended public fallback disclosure path.
- [ ] Confirm repository visibility, fork settings, and Actions permissions are appropriate for a public project. Context: `docs/github-visibility-fork-actions-settings-review-2026-06-03.md` documents a pre-public settings review: current repo is private, canonical/non-fork, forking enabled, Actions enabled, workflow token default read-only, workflow PR approval disabled, and all Actions currently allowed. Remaining 3-minute slices:
  - [ ] After the final pre-public checklist is complete, change repository visibility to public and re-check visibility is `PUBLIC`.
  - [ ] After publication, confirm forking remains enabled and fork pull request contributor approval behavior is available and intentionally configured.
  - [ ] After publication, confirm Actions remain enabled, default workflow token permission remains read-only, and the `allowed_actions=all` policy is still accepted or tightened to a selected-actions allowlist.

## 12. Final Pre-Public Checklist

- [ ] CI passes on the default branch.
- [ ] Working-tree and Git-history secret scans are completed and findings are resolved.
- [ ] README is updated and accurate.
- [ ] Install docs are tested on a clean machine or container.
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

