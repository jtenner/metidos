# README product and security claims audit — 2026-06-03

Scope: bounded slice of the final pre-public checklist item “README is updated and accurate.” This audit checked the README’s product positioning and security/scope claims against the current public-readiness docs. It did not re-check local links/assets, screenshots, install behavior, external badge URLs, or public rendering.

## Compared sources

- `README.md`
- `docs/security-model.md`
- `docs/known-limitations.md`
- `docs/readme-public-readiness-link-audit-2026-06-03.md`

## Result

No README text changes were needed in this slice.

The README remains consistent with the current docs on these launch-critical claims:

- Metidos is pre-1.0 local developer tooling, not hosted multi-tenant software.
- The intended deployment model is a single Local Operator controlling one local installation.
- Local Auth protects browser access but is not a replacement for host security, careful network exposure, or safe reverse-proxy setup.
- The Bun Backend is the security authority for sessions, provider credentials, Plugin Settings, Project/Worktree path scope, and Safe Mode/Unsafe Mode capability decisions.
- Plugins are local, review-first extensions that require operator approval, declared permissions, access-group review, settings validation, and re-review after source changes.
- Safe Mode is the default for Threads and Cron Jobs, while Unsafe Mode can broaden local runtime capabilities and should only be enabled for narrow, trusted work.
- App Data, diagnostics, plugin-authored logs, provider credentials, local paths, and backups are sensitive local data that should be redacted from public reports.

## Remaining README readiness gaps

The broader README checklist item is still not fully complete because these follow-up slices remain outside this audit:

- Validate README screenshot and visual-asset references after the pending artwork provenance and canonical logo/mascot decisions are complete.
- Validate external README badge/workflow URLs and public rendering after the repository is public or public-like CI evidence is available.
