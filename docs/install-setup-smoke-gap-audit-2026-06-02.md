# Install/setup smoke test gap audit — 2026-06-02

This note completes the TODO to identify install and first-run smoke tests still missing before public release. It reviewed the current install-facing docs and known clean-clone validation evidence, then converted the remaining gaps into actionable `agent-todo.md` items.

## Reviewed sources

- `README.md` documentation links and repository overview.
- `INSTALLATION.md` clean-clone quick start, first-run smoke checklist, install reference, auth, provider, backup/restore, container, and reverse-proxy guidance.
- `docs/installation.md` and `docs/getting-started.md` compatibility entry points.
- `docs/troubleshooting.md` install/runtime/auth/provider failure guidance.
- `docs/clean-clone-verification-2026-06-02.md` existing clean-clone validation evidence for `bun install --frozen-lockfile` and `bun run validate`.
- `package.json` documented root scripts and required Bun version.

## Existing coverage

`docs/clean-clone-verification-2026-06-02.md` already records a disposable clean-clone run where:

- the clean clone had no local working-tree changes,
- `bun install --frozen-lockfile` completed,
- `bun run validate` initially exposed a missing generated WASM prerequisite,
- the validation path was fixed to build the xmloxide WASM bundle, and
- `bun run validate` then passed from the clean clone.

That evidence covers one important public-readiness path, but it does not prove the full install/first-run experience.

## Missing smoke-test gaps to track

The remaining gaps should be run in disposable checkouts, containers, VMs, or fresh machines with fake data and no private credentials committed to the repository.

1. **Documented startup commands from a clean clone**
   - Smoke `bun run dev` and `bun run start` after only documented setup.
   - Record OS, Bun version, commands, whether a local URL is printed, whether the process starts without private local state, and how it was stopped.

2. **First-run Local Auth path**
   - Verify first-run setup, login, logout, recovery-code handling, and reset guidance from `INSTALLATION.md` and `docs/troubleshooting.md`.
   - Record only safe metadata and avoid secrets, cookies, TOTP seeds, recovery codes, or screenshots containing private values.

3. **Provider-free and fake-provider first-run behavior**
   - Verify the UI remains usable before any model provider is configured.
   - If practical, verify a local/private or fake provider setup path without real external credentials.
   - Record the exact no-provider messages and setup prerequisites.

4. **Project, Worktree, first Thread, and Diff review tutorial path**
   - Verify the `INSTALLATION.md` tutorial steps for adding a Project, selecting a Worktree, sending a safe no-edit Thread, and reviewing any Diff state.
   - Use a disposable demo repository and fake/demo data only.

5. **Documented failure-path readability**
   - Smoke missing/wrong Bun version messaging where practical, missing `.env`/minimal `.env` behavior, unwritable `METIDOS_APP_DATA_DIR`, port conflict, and stale/missing Mainview asset recovery steps.
   - Record whether errors provide contributor-friendly next steps.

6. **Backup, restore, and auth reset procedure smoke tests**
   - Verify backup/restore and reset commands from the install guide and operator runbook using disposable App Data.
   - Confirm no private paths or secret values are required in docs.

7. **Container install path**
   - Smoke Docker and/or Podman guidance, including required mounts/env, first-run auth, provider configuration expectations, backup/restore notes, and teardown.
   - Record host OS, container engine/version, commands, pass/fail status, and any prerequisites.

8. **Reverse-proxy/Tailscale/TLS path** — desk-checked in `docs/remote-access-setup-desk-check-2026-06-02.md`.
   - `INSTALLATION.md`, `docs/troubleshooting.md`, `docs/security-model.md`, `docs/operator-runbook.md`, and `docs/security/threat-model.md` were reviewed for `METIDOS_PUBLIC_ORIGIN`, WebSocket origin settings, trusted proxy settings, `start:tls`, Tailscale DNS guidance, and troubleshooting coverage.
   - No live reverse proxy, Tailscale device, TLS certificate, or browser session was exercised in that slice; a future live smoke can still verify the path end to end.

9. **Installer skill path**
   - Run the plan-first `.pi/skills/metidos-installation/SKILL.md` workflow in a dry-run or approved disposable scenario.
   - Verify it asks the expected questions, emits a secret-safe `metidos-config.md`, and does not apply host changes before approval.

10. **Contributor-safe issue-reporting path** — verified in `docs/contributor-safe-issue-reporting-verification-2026-06-02.md`.
    - `SECURITY.md`, `SUPPORT.md`, `docs/security-model.md`, and `docs/troubleshooting.md` provide a consistent safe-reporting path for install/setup failures.
    - `.github/ISSUE_TEMPLATE/install_problem.yml` now requires an explicit redaction checklist, matching the existing bug report safety gate.

## Outcome

The active checklist now tracks these gaps directly as small smoke-test TODOs under install/first-run experience. Future runs should execute one bounded smoke path at a time and record exact outcomes in a dated doc.
