# Metidos Open Source Launch TODO

This checklist is for repository improvements only before making Metidos public/open source. Do not treat this as a marketing or launch-promotion plan. Work through items in small, reviewable PRs or commits.

## 1. Repository Hygiene and Public Readiness

- [ ] Audit all currently tracked files for private data, local filesystem paths, secrets, credentials, tokens, internal URLs, personal notes, and unsafe demo data.
- [ ] Audit `.wiki/` and decide which research notes, durable project knowledge, logs, or internal context should remain public, be rewritten, or be removed before launch.
- [ ] Audit `.pi/skills/` and decide which skills are appropriate to ship publicly, which need redaction, and which should be excluded.
- [ ] Audit generated files, caches, build artifacts, logs, local database files, plugin runtime output, screenshots, temporary files, and derived outputs for accidental check-in.
- [ ] Update `.gitignore` to exclude unsafe local files, generated files, caches, logs, local databases, plugin runtime output, temporary screenshots, and other non-source artifacts.
- [ ] Review dependency declarations and lockfiles for private packages, unpublished packages, local path dependencies, private registry URLs, or non-public references.
- [ ] Review checked-in assets for ownership, provenance, license compatibility, and permission to redistribute publicly.
- [ ] Add a repository metadata checklist covering GitHub description, topics, social preview image, homepage URL, and default branch naming.
- [ ] Verify the repository can be cloned into a clean directory without relying on ignored local state from the current developer machine.

## 2. License, Governance, and Community Files

- [ ] Choose an open source license and add a root-level `LICENSE` file.
- [ ] Add `CONTRIBUTING.md` with development setup, branch/PR expectations, validation commands, documentation expectations, and contribution boundaries.
- [ ] Add `CODE_OF_CONDUCT.md` with a standard community conduct policy and reporting contact.
- [ ] Add `SECURITY.md` with supported versions, private vulnerability reporting instructions, expected response process, and what not to disclose publicly.
- [ ] Add `SUPPORT.md` explaining where users should ask usage questions, file install problems, and report bugs.
- [ ] Add `ROADMAP.md` describing current status, near-term priorities, deferred work, and non-goals.
- [ ] Add `PRIVACY.md` if telemetry, model-provider behavior, agent execution, logs, or local data handling need to be explained for users.
- [ ] Add `.github/PULL_REQUEST_TEMPLATE.md` with checklist items for tests, docs, security impact, screenshots when UI changes, and validation commands.
- [ ] Add `.github/ISSUE_TEMPLATE/bug_report.yml` with fields for version, environment, reproduction steps, expected behavior, actual behavior, logs with redaction guidance, and screenshots if safe.
- [ ] Add `.github/ISSUE_TEMPLATE/feature_request.yml` with fields for problem statement, proposed behavior, alternatives, and affected areas.
- [ ] Add `.github/ISSUE_TEMPLATE/install_problem.yml` with fields for OS, Bun version, install command, logs, environment variables used as placeholders, and clean-clone status.
- [ ] Add `.github/ISSUE_TEMPLATE/plugin_issue.yml` with fields for plugin name, manifest details, permissions requested, lifecycle state, logs, and whether unsafe mode was involved.
- [ ] Add `.github/CODEOWNERS` covering backend, mainview, docs, plugin system, security-sensitive code, and release files.
- [ ] Add or document GitHub labels for `bug`, `install`, `docs`, `backend`, `mainview`, `plugin-system`, `cron`, `security-hardening`, `good-first-issue`, `help-wanted`, and `needs-repro`.
- [ ] Ensure all community files use current project terminology and link to the correct docs once those docs exist.

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
- [ ] Add a clear one-sentence project tagline.
- [ ] Add an alpha/beta/stability status section that sets expectations for production use, API stability, and data safety.
- [ ] Add a short “What Metidos is” section explaining the local Bun backend, Pi-powered agent runtime, and React/Tailwind mainview.
- [ ] Add a short “What Metidos is not” section clarifying non-goals and boundaries.
- [ ] Add a quick-start install path that gets a new user from clean clone to first useful screen.
- [ ] Add links to installation, architecture, plugin, security, roadmap, and contributing docs.
- [ ] Add a screenshot gallery or visual feature section with safe demo data.
- [ ] Add a concise security model summary covering local auth, plugins, filesystem/network boundaries, and unsafe mode.
- [ ] Add a “Core concepts” section covering projects, worktrees, threads, diffs, cron jobs, plugins, and providers.
- [ ] Add badges only after the underlying CI, license, release, and status items are real.
- [ ] Add a license section that matches the root `LICENSE` file.
- [ ] Add a “Known limitations” or “Alpha status” section with specific constraints and expected rough edges.
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
