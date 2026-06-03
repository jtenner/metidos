# Known limitations

Metidos is pre-1.0 local developer tooling. This page collects limitations that are important for operators, contributors, and release reviewers to understand before using or publishing the project.

## Product scope

- Metidos is designed for a single Local Operator running a local installation. It is not a hosted multi-tenant service.
- Local Auth protects browser access to the local Backend, but it is not a substitute for host security, disk encryption, safe network exposure, or careful reverse-proxy configuration.
- Safe Mode reduces routine risk for Threads and Cron Jobs, but Metidos is not a sandbox for arbitrary untrusted code. Unsafe Mode, shell-capable tools, approved Plugins, and provider integrations can still affect local files and systems.
- Plugins are local, review-first extensions rather than a stable public marketplace. Review manifests, permissions, access groups, file/network allowlists, `AGENTS.md` guidance, and source changes before approval.
- Provider behavior depends on the configured model provider or plugin-backed provider. Keep provider credentials private and expect model availability, latency, pricing, and output quality to vary outside this repository's control.

## Public-launch readiness

- The repository is still in public-readiness review. Some manual smoke evidence, especially clean install, backup/restore, Local Auth first-run, provider-free/fake-provider flows, Cron lifecycle, Plugin lifecycle, and product-hardening paths, must be refreshed or completed before treating a release as fully validated.
- Public visual identity decisions are not fully final until the artwork provenance and canonical logo/mascot decisions are recorded. Do not reuse pending artwork outside the repository until ownership and redistribution approval are confirmed.
- GitHub publication settings such as branch protection/rulesets, Actions behavior on public pull requests, private security reporting availability, social preview upload, final homepage URL, and repository visibility are operator-controlled settings that require final verification in GitHub.
- The website URL and Open Graph canonical URLs should remain placeholders until a final public host is chosen and checked in.

## Data and operations

- App Data is local operator data and may contain private paths, project metadata, provider configuration, plugin settings, diagnostics, logs, and Thread/Cron history. Back it up before risky changes and redact it from public issues.
- Backups, restore, and auth reset flows are documented, but operators should test them with disposable App Data before relying on them for important work.
- Long-running agent work, large logs, slow providers, background Cron activity, and large Diffs are expected use cases, but they still need ongoing hardening and manual validation as the project approaches public release.
- Generated demo screenshots and docs examples are intended to avoid private data. New public media should continue using fake projects, fake paths, fake provider state, and generated data only.

## How to report gaps

If you find a limitation that is not listed here, open a documentation or bug issue with sanitized reproduction details. Do not include secrets, cookies, recovery codes, TOTP seeds, provider tokens, private file paths, customer/user data, or full App Data archives.
