# First release draft: `v0.1.0-alpha.1`

Prepared on 2026-06-03 for the pre-public Metidos checklist. This is a draft, not a release decision or tag.

## Draft status

- **Proposed tag:** `v0.1.0-alpha.1`
- **Package version in `package.json`:** `0.0.1`
- **Required package manager:** `bun@1.3.14`
- **Release channel:** alpha / pre-public
- **Release decision:** block until the validation gates below are complete

## One-paragraph summary

Metidos is a local-first, Pi-powered coding-agent workspace for managing Projects, Worktrees, Threads, Diffs, Cron jobs, local auth, and Plugin System v1 workflows from a Bun backend and React/Tailwind Mainview. The first alpha release should emphasize that the project is pre-stability software, APIs and local data formats may change, and operators should use fake/demo data for early validation before trusting real workloads.

## Draft GitHub release notes

### Added

- Local Bun backend and Mainview workspace for Projects, Worktrees, Threads, Diffs, Cron jobs, and Plugin System v1 operations.
- Local Auth setup/reset flows and security-model documentation for local operator use.
- Public-readiness documentation for installation, troubleshooting, release validation, repository settings, asset provenance, and known limitations.
- Repo-hosted website assets, changelog handoff page, and generated social-preview fallback assets.

### Changed

- Public release preparation now uses the root `CHANGELOG.md` as the hand-maintained changelog source until automated changelog generation exists.
- Release validation is tracked in `docs/release-validation-checklist.md` and this draft should be updated with exact validation evidence before tagging.

### Security

- Plugin approvals, unsafe-mode warnings, local auth, secret handling, and artifact/log hygiene are documented as release-critical validation areas.
- Before publication, run a dedicated working-tree and Git-history secret scanner and resolve or document every finding safely.

### Known limitations

- The project is alpha/pre-public software; plugin contracts, RPC internals, and local App Data formats may change before stability.
- Public repository settings, branch protection, custom social preview upload, and public CI evidence are still pending external GitHub configuration.
- Clean install and manual smoke evidence must be refreshed only after the local runtime matches the declared `bun@1.3.14` requirement.
- Remaining artwork provenance decisions for the bird mascot/favicon asset and pixel crown must be resolved before claiming all visual assets are publication-safe.

## Install/update instructions to confirm before release

From a clean checkout after documented setup:

```bash
bun --version
bun install --frozen-lockfile
bun run validate
bun run build:prod
bun run start
```

Expected pre-release checks:

1. `bun --version` reports `1.3.14`.
2. `bun install --frozen-lockfile` succeeds without undocumented prerequisites.
3. `bun run validate` passes on the release commit.
4. `bun run start` works from documented setup only and prints a usable local URL.
5. First-run Local Auth setup, login, logout, reset guidance, and provider-free/fake-provider behavior are validated with fake/demo values only.

## Validation gates before tagging

- CI passes on the default branch.
- Clean install and first-run smoke evidence is recorded with exact OS, Bun version, commands, pass/fail status, stop method, and teardown notes.
- Product hardening smoke plans in `docs/*smoke-plan-2026-06-03.md` are either executed with sanitized evidence or explicitly deferred with release-impact notes.
- A dedicated secret scanner covers the working tree and Git history.
- README visual assets and external/public rendering are verified after artwork and hosting decisions are complete.
- GitHub public repository settings are configured or deliberately deferred in the GitHub setup notes.
- `CHANGELOG.md` `Unreleased` entries are moved into a versioned section for the selected tag.

## Rollback guidance

Before upgrading or testing a release candidate:

1. Stop Metidos.
2. Back up App Data and private environment/secret-manager configuration.
3. Record the current checkout/tag and Bun version.
4. Upgrade to the release candidate and run validation.

If rollback is needed:

1. Stop Metidos.
2. Restore the previous checkout/tag.
3. Restore the matching App Data backup if migrations or local state changes occurred.
4. Start Metidos and re-check plugin approvals, Local Auth, provider configuration, Projects, and Worktrees.

## Release blocker summary

Do not tag or publish this draft as-is. It is prepared so the final pre-public checklist has a concrete release-note starting point, but it still needs validation evidence, final changelog entries, repository setting confirmations, clean install evidence, secret-scanner evidence, and asset provenance decisions.
