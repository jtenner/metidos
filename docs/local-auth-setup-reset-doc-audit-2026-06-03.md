# Local Auth setup/reset documentation audit (2026-06-03)

## Scope

This bounded public-readiness slice audited whether the checked-in documentation points a new local operator from first-run Local Auth setup to reset/recovery guidance. It did not execute the browser setup/reset smoke because the current recurring-agent runtime still reports `bun --version` as `1.3.13` while `package.json` declares `bun@1.3.14`.

## Commands run

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
```

Observed output:

```text
1.3.13
bun@1.3.14
```

Documentation search/read checks used targeted grep/read passes over:

- `INSTALLATION.md`
- `docs/operator-runbook.md`
- `docs/security-model.md`
- `docs/first-run-local-auth-smoke-plan-2026-06-03.md`
- `docs/backup-restore-auth-reset-smoke-plan-2026-06-03.md`

## Findings

- `INSTALLATION.md` documents the clean-clone first-run path, including `METIDOS_APP_DATA_DIR`, `bun run dev` / `bun run start`, the localhost URL, first-run Local Auth setup, primary factor setup, optional TOTP enrollment, recovery codes, and private handling of auth material.
- `INSTALLATION.md` also has a backup/restore/reset section that tells operators to back up App Data and private configuration, restore App Data before signing in, and use Local Auth reset commands for Local Auth recovery.
- `docs/operator-runbook.md` documents the `bun run auth:reset regenerate-recovery-codes --username USERNAME` and `bun run auth:reset reset-primary-factor --username USERNAME --new-type pin|password` command shapes.
- `docs/security-model.md` documents Local Auth coverage, current hardening expectations, secret-handling boundaries, and the backup requirement that `auth-secret.key` must stay with the matching auth database.
- `docs/first-run-local-auth-smoke-plan-2026-06-03.md` and `docs/backup-restore-auth-reset-smoke-plan-2026-06-03.md` are command-ready plans for runtime verification and evidence capture once the Bun version blocker is removed.

## Result

Documentation discoverability for Local Auth setup and reset is ready for the runtime smoke. The remaining unfinished work is execution evidence from a disposable App Data directory and browser profile with Bun `1.3.14`, using fake/demo Local Auth values only.

## Follow-up acceptance criteria

A future evidence note should mark the broader TODO complete only after it records:

- exact OS/browser/shell details,
- `bun --version` matching `package.json` `packageManager`,
- sanitized `METIDOS_APP_DATA_DIR` and start/reset command shapes,
- pass/fail status for first-run setup, logout, login, recovery-code presentation, reset-command behavior, and teardown,
- confirmation that no primary factors, TOTP seeds, recovery codes, cookies, WebSocket tickets, App Data files, screenshots, or private paths were captured or committed.
