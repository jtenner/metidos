# First-run Local Auth smoke plan (2026-06-03)

This plan defines the remaining public-readiness smoke for the install/setup TODO: verify first-run Local Auth from a disposable setup. It does not record completed smoke evidence yet; it narrows the task into command-ready, secret-safe steps for a future run with the repository-required Bun version.

## Scope

Verify that a new local operator can follow the documented install path from first browser launch through Local Auth setup, logout/login, recovery-code handling, and documented reset guidance using only disposable data.

In scope:

- first-run Local Auth setup from a clean disposable App Data directory,
- primary factor setup with fake/demo values,
- TOTP enrollment prompts when presented,
- recovery-code presentation and private-save guidance,
- logout and login with the created fake/demo credentials,
- documented auth reset command discoverability from `INSTALLATION.md` and `docs/operator-runbook.md`,
- sanitized evidence that avoids secrets, cookies, TOTP seeds, recovery codes, private paths, and screenshots.

Out of scope:

- real operator credentials or recovery codes,
- real provider setup,
- private repositories or private Projects,
- long-duration Session expiration behavior, which is covered by `docs/local-auth-session-smoke-plan-2026-06-03.md`,
- backup/restore correctness, which is covered by `docs/backup-restore-auth-reset-smoke-plan-2026-06-03.md`.

## Documentation references

- `INSTALLATION.md` documents the clean-clone quick start, `METIDOS_APP_DATA_DIR`, first-run Local Auth, private recovery-code handling, and reset guidance.
- `docs/operator-runbook.md` documents `bun run auth:reset regenerate-recovery-codes` and `bun run auth:reset reset-primary-factor` command shapes.
- `docs/troubleshooting.md` provides install/runtime/auth issue-reporting guidance.
- `docs/local-auth-session-smoke-plan-2026-06-03.md` covers broader Session lifecycle behavior after first-run setup.

## Preconditions and safety constraints

- Use a disposable App Data directory under `/tmp` or another throwaway location.
- Use a disposable browser profile that can be deleted after the smoke.
- Use fake/demo Local Auth identity values only.
- Do not configure real model providers or import private Projects.
- Do not commit screenshots, App Data files, cookies, WebSocket tickets, TOTP seeds, QR-code contents, recovery-code values, primary factors, private paths, usernames, hostnames, or provider account metadata.
- Record the local Bun version and compare it with `package.json` `packageManager`. If they differ, record the mismatch as a blocker and do not use the run as release evidence.

## Command-ready outline

Run these checks before starting the smoke:

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
uname -a
```

Start Metidos with disposable state and a non-default port if needed:

```bash
appdata="$(mktemp -d /tmp/metidos-first-run-auth-smoke-XXXXXX)"
profile="$(mktemp -d /tmp/metidos-first-run-auth-browser-XXXXXX)"
port="7598"
METIDOS_APP_DATA_DIR="$appdata" METIDOS_PORT="$port" bun run start
```

Open the printed local URL in the disposable browser profile. The exact browser command is intentionally environment-specific; record the browser name/version and sanitize profile paths in evidence.

## Smoke steps

1. Confirm the app starts from the documented `bun run start` path and prints a local URL.
2. Open the local URL in the disposable browser profile.
3. Confirm first-run Local Auth setup is presented before protected app content.
4. Create the fake/demo local operator using a disposable primary factor that is not recorded.
5. Complete TOTP enrollment when prompted, without recording QR-code contents, seeds, or generated codes.
6. Confirm recovery codes are shown and the UI/docs tell the operator to save them privately; record only that this occurred.
7. Confirm the authenticated app shell loads after setup.
8. Log out through the UI.
9. Confirm protected app routes return to login and do not briefly expose protected content after logout/reload.
10. Log back in with the fake/demo primary factor and TOTP code.
11. Confirm `INSTALLATION.md` points to reset guidance and `docs/operator-runbook.md` contains the documented reset command shapes.
12. Stop the app with `Ctrl-C` unless another stop method is required.
13. Delete the disposable App Data directory and browser profile without printing their contents.

## Evidence to record

Commit a separate sanitized evidence note after execution with:

- date and timezone,
- OS/container image and shell,
- browser and version,
- Bun version and `package.json` `packageManager`,
- exact sanitized command shapes,
- local URL shape without private hostnames if applicable,
- pass/fail status for each smoke step,
- confirmation that recovery-code handling was presented but values were not captured,
- logout/login outcome,
- reset-guidance documentation outcome,
- stop method and teardown confirmation,
- any install documentation, Local Auth UI, or troubleshooting corrections made in the same commit.

## Acceptance criteria

The install/setup Local Auth TODO can be marked complete only after sanitized evidence shows:

- first-run setup is reachable from a clean disposable App Data directory using documented startup steps,
- setup, logout, and login work with fake/demo values,
- recovery codes are presented with private-save guidance and no code values are captured,
- reset guidance is discoverable from install documentation and command shapes are documented in the operator runbook,
- protected content is not exposed after logout or unauthenticated reload,
- disposable App Data and browser profile teardown completed,
- no evidence contains secrets, cookies, TOTP seeds, recovery codes, private paths, screenshots, or real user/provider data.
