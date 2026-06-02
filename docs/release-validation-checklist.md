# Release validation checklist

Use this checklist before tagging a public or pre-public Metidos release. Record the exact commit, environment, commands, and pass/fail results in the release notes or release candidate issue.

## Release candidate metadata

- Candidate version/tag:
- Git commit SHA:
- Validation date:
- Validator:
- OS and version:
- Bun version (`bun --version`):
- Node version if relevant (`node --version`):
- Browser and version used for manual UI checks:
- Notes about local configuration, reverse proxy, TLS, or container runtime:

## Clean setup commands

Run from a fresh clone or disposable checkout that does not depend on ignored local state.

```bash
git status --short
bun --version
bun install --frozen-lockfile
bun run validate
bun run build:prod
```

If validating runtime startup, use a bounded manual window and stop the process after the startup behavior is confirmed:

```bash
bun run start
bun run dev
```

Record whether each command passed, failed, timed out, or required local setup that is not documented.

## Documentation checks

- README commands match the actual scripts in `package.json`.
- `docs/getting-started.md`, `docs/installation.md`, and `docs/troubleshooting.md` describe all required setup steps for a clean clone.
- `docs/release-process.md` matches the current release workflow and links to this checklist.
- Plugin docs describe provider setup, plugin approval, permission expectations, and unsafe-mode implications.
- Security docs describe supported secret handling, local auth, backups, and responsible disclosure/private reporting expectations.
- Public-facing terminology matches `UBIQUITOUS_LANGUAGE.md` and avoids internal-only jargon where possible.
- Known limitations, alpha/pre-release status, and rollback expectations are documented.

## Manual product checks

Use fake/demo data only.

- First-run auth setup works and recovery/reset guidance is understandable.
- Provider configuration can be added, edited, and removed without exposing secret values in the UI.
- Project creation, opening, closing, and error states work for a small local test repository.
- Worktree listing, opening, and switching work for the test repository.
- A safe agent Thread can be created, monitored, stopped, and resumed.
- Diff review works for a small text change, a renamed file, a deleted file, and a binary file.
- Cron job creation, edit, run-now, disable, and delete flows work.
- Plugin discovery, review, approval, disable, reset-data, and failure states work with safe example plugins.
- Settings screens distinguish display values from secret or sensitive values.
- Major error states provide actionable next steps without leaking private paths or secrets.

## Security checks

- Run a working-tree secret scan with a dedicated tool and review every finding.
- Run a Git-history secret scan before public publication and decide whether history rewrite is required.
- Confirm `.env.example` and sample plugin configuration values contain placeholders only.
- Confirm logs, test outputs, screenshots, and generated artifacts do not include secrets, provider keys, recovery codes, session tokens, private paths, hostnames, or private repository names.
- Confirm security-sensitive errors are useful without exposing secrets or sensitive local paths.
- Confirm plugin permission enforcement and filesystem/network policy expectations are covered by tests or documented manual checks.
- Rotate any exposed, suspicious, stale, or unverifiable credential found during validation.

## Artifact checks

Do not publish artifacts that include local runtime state. Before publishing release artifacts or screenshots, verify they exclude:

- `.env` files or secret-manager exports,
- App Data and local auth/session files,
- SQLite databases and telemetry sidecar databases,
- plugin `.data`, `.logs`, reset backups, and local plugin secrets,
- raw agent logs containing prompts, local paths, or provider responses,
- screenshots with usernames, hostnames, tokens, internal repositories, private branches, or real user/customer data.

## CI and repository checks

- Pull request CI passes without private secrets.
- Required checks in branch protection match the actual CI workflow names.
- CI artifacts and logs do not expose secrets or machine-specific paths.
- License detection, issue templates, security reporting, repository topics, homepage URL, and social preview are configured as intended before public release.

## Completion record

For each release candidate, save a short validation summary with:

- commands run and exact outcomes,
- manual checks completed and skipped,
- security scans run and disposition of findings,
- artifacts reviewed,
- known limitations and follow-up issues,
- final release decision: ship, re-spin, or block.
