# Contributor-safe issue-reporting verification — 2026-06-02

This note completes the install/setup public-readiness slice to verify that contributors can report install and setup failures without leaking private local data.

## Sources checked

- `SECURITY.md`
- `SUPPORT.md`
- `docs/security-model.md`
- `docs/troubleshooting.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/install_problem.yml`

## Findings

The documentation already gives contributors a clear safe-reporting path:

- `SECURITY.md` directs suspected vulnerabilities to private disclosure and lists secrets, local databases, plugin runtime data, private repository URLs, and unsafe screenshots that must not be shared publicly.
- `SUPPORT.md` routes installation problems to the install problem template and repeats the redaction reminder for secrets, provider credentials, recovery codes, cookies, `.env`, databases, plugin data/logs, and private repository URLs.
- `docs/security-model.md` has a dedicated Safe issue reporting section with safe metadata to include and sensitive material to exclude.
- `docs/troubleshooting.md` includes a Safe issue report checklist for install/runtime failures, including clean-clone status, sanitized `.env` variable names without values, and sanitized logs/screenshots.
- The bug report issue template requires a redaction checkbox before submission.

## Change made

The install problem issue template already asked for placeholders and sanitized logs, but it did not require an explicit redaction acknowledgement. This slice added a required redaction checklist to `.github/ISSUE_TEMPLATE/install_problem.yml` so install/setup reports now match the bug report template's safety gate.

## Outcome

The contributor-safe issue-reporting path is acceptable for public-readiness purposes after this template hardening. Future install/setup smoke-test notes should continue to record only safe metadata: OS, Bun version, Metidos commit, commands, pass/fail status, and sanitized error text. Do not record `.env` values, App Data contents, provider keys, cookies, WebSocket tickets, TOTP seeds, recovery codes, personal paths, private repository names, or screenshots containing private data.
