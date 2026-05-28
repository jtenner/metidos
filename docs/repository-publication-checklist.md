# Repository publication checklist

Use this checklist before making the repository public or changing public repository settings.

## Repository metadata

- [ ] Description is concise and aligned with the README tagline.
- [ ] Homepage URL points to the canonical docs or repository-hosted website.
- [ ] Topics use public discovery terms and avoid internal jargon.
- [ ] Social preview image uses safe, repo-owned assets and fake/demo data only.
- [ ] Default branch name is intentional and documented if needed.

## Public readiness

- [ ] License is present and detected by GitHub.
- [ ] README status, install, security, support, roadmap, and known-limitations sections are current.
- [ ] Required community files are present: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, and `PRIVACY.md`.
- [ ] Issue templates and pull request template render correctly.
- [ ] Label set is created from `.github/labels.md` or equivalent repository settings.

## Safety checks

- [ ] Working tree has been scanned for secrets and private data.
- [ ] Git history has been scanned for secrets and private data.
- [ ] `.wiki/`, `.pi/skills/`, docs, examples, screenshots, logs, and checked-in assets have been reviewed for public release.
- [ ] No App Data, local database files, generated caches, plugin `.data`, plugin `.logs`, telemetry sidecar DBs, private paths, or unsafe demo data are tracked.
- [ ] Screenshots and visual assets hide usernames, hostnames, tokens, internal repositories, local paths, private branches, and real customer/user data.

## GitHub settings

- [ ] Issue templates appear in the new issue flow.
- [ ] Pull request template appears for new pull requests.
- [ ] CI runs on pull requests and pushes without private secrets.
- [ ] Branch protection or rulesets are configured for the default branch.
- [ ] Required checks match actual CI workflow names.
- [ ] Discussions are enabled only if the project intends to support them.
- [ ] GitHub Wiki is disabled unless intentionally used.
- [ ] Private security reporting is configured if available.
- [ ] Fork settings, Actions permissions, and repository visibility are appropriate for a public project.
