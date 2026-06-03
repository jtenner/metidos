# CI artifact, log, and test-output secret audit (2026-06-02)

Scope: repository-owned GitHub workflow configuration, release-note configuration, and representative validation/test-output surfaces that can run in public CI.

## Commands inspected

- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/dependency-review.yml`
- `.github/release.yml`
- Root `package.json` scripts reachable from CI, especially `ci:install` and `validate`
- Existing issue and pull-request templates for log-redaction guidance
- Source/test references to common sensitive-output patterns using targeted searches for artifacts, logs, secrets, tokens, environment access, and local-path fixtures

## Findings

- The root CI workflow checks out the repository, installs dependencies with `bun install --frozen-lockfile`, and runs `bun run validate` on `ubuntu-latest` with Bun `1.3.14`.
- No repository-owned GitHub workflow currently uploads artifacts, downloads artifacts, writes custom job summaries, enables dependency caches, or publishes coverage/JUnit/test-output files.
- The CodeQL workflow uses the GitHub CodeQL action and writes only security events through the standard `security-events: write` permission.
- The dependency-review workflow can post dependency summaries on pull requests, but it is limited to dependency manifests and lockfiles and does not run repository scripts.
- The validation script chains local build/check/test commands. Test fixtures found during this audit use synthetic paths such as `/tmp/...` and `/home/metidos/...`; no real maintainer home path is intentionally embedded as an expected test output.
- Public contribution templates already instruct reporters and reviewers to redact secrets, local databases, plugin `.data`, plugin `.logs`, screenshots, private URLs, provider keys, OAuth tokens, recovery codes, and session cookies before posting logs or diagnostics.

## Result

No CI artifact, workflow-log, or checked-in test-output exposure was found in the current public workflow configuration. If future workflows add artifact upload, coverage publishing, diagnostics export, screenshots, or long-lived logs, those additions should include an explicit redaction review before being enabled for public pull requests.
