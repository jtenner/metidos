# Backup, restore, and auth reset smoke plan (2026-06-03)

## Scope

This is a public-readiness smoke-test plan for the active TODO item: verify backup, restore, and auth reset procedures with disposable App Data. It does not verify the procedures yet; it narrows the remaining work into safe, repeatable steps that avoid private paths, real provider credentials, cookies, TOTP seeds, recovery codes, and screenshots.

## Current documentation references

- `INSTALLATION.md` documents backup inputs, restore order, reset options, and links to the operator runbook.
- `docs/operator-runbook.md` documents Local Auth reset commands and operational reminders about data that must not be committed.
- `docs/security-model.md` documents that backups are sensitive and that `auth-secret.key` must stay with the matching auth database.
- `docs/install-setup-smoke-gap-audit-2026-06-02.md` records backup, restore, and auth reset smoke testing as an unclosed setup gap.

## Constraints for the smoke

- Use a disposable `METIDOS_APP_DATA_DIR` created under `/tmp` or another throwaway location.
- Use fake/demo Local Auth identity values only.
- Do not capture or commit secrets, cookies, TOTP seeds, recovery codes, App Data contents, private file paths, or screenshots.
- Record exact OS, Bun version, commands, pass/fail status, stop method, and teardown.
- If the repository-declared Bun version does not match the runtime, record the mismatch and defer execution instead of refreshing evidence with the wrong runtime.

## Proposed smoke steps

1. Confirm runtime version:

   ```bash
   bun --version
   node -e "const p=require('./package.json'); console.log(p.packageManager)"
   ```

2. Create disposable App Data and backup paths under `/tmp` or another throwaway location.
3. Start Metidos with disposable App Data and minimal documented configuration.
4. Complete first-run Local Auth with fake/demo values.
5. Stop Metidos cleanly.
6. Copy the disposable App Data directory to the disposable backup path without printing file contents.
7. Restore by pointing `METIDOS_APP_DATA_DIR` at the copied path.
8. Start Metidos and confirm sign-in reaches the expected post-auth state.
9. Exercise documented auth reset commands from `docs/operator-runbook.md` using fake/demo identity values only.
10. Confirm old sessions are invalidated as documented, without recording cookie values.
11. Tear down all disposable App Data and backup paths.

## Command-ready smoke outline

Use this outline when Bun matches the repository `packageManager`. Replace the fake username with the same fake/demo local operator identity used during first-run setup. Do not paste real prompts, TOTP codes, recovery codes, cookies, or App Data contents into the evidence note.

```bash
set -euo pipefail

bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
uname -a

appdata="$(mktemp -d /tmp/metidos-backup-smoke-appdata-XXXXXX)"
backup="$(mktemp -d /tmp/metidos-backup-smoke-backup-XXXXXX)"
restore="$(mktemp -d /tmp/metidos-backup-smoke-restore-XXXXXX)"
port="7599"

METIDOS_APP_DATA_DIR="$appdata" METIDOS_PORT="$port" bun run start
```

In a browser, complete first-run Local Auth with fake/demo values, then stop the process with `Ctrl-C` and record that stop method.

```bash
rsync -a --delete "$appdata/" "$backup/"
rsync -a --delete "$backup/" "$restore/"
METIDOS_APP_DATA_DIR="$restore" METIDOS_PORT="$port" bun run start
```

In a browser, confirm sign-in reaches the expected post-auth state, then stop the process with `Ctrl-C`.

Run the documented CLI reset commands only against the disposable restored App Data directory:

```bash
METIDOS_APP_DATA_DIR="$restore" bun run auth:reset regenerate-recovery-codes --username FAKE_DEMO_USERNAME
METIDOS_APP_DATA_DIR="$restore" bun run auth:reset reset-primary-factor --username FAKE_DEMO_USERNAME --new-type pin
```

When the smoke is complete, remove disposable paths without printing their contents:

```bash
rm -rf "$appdata" "$backup" "$restore"
```

If any step fails, keep the evidence sanitized: record the exact command, exit status, and user-facing message summary only. Do not commit temporary App Data, copied backup directories, screenshots, cookies, TOTP seeds, recovery codes, or private paths.

## Acceptance criteria for future evidence

A future smoke result should be committed as a separate evidence note and include:

- host OS and shell,
- Bun version and repository `packageManager`,
- exact sanitized commands,
- pass/fail result for backup, restore, and auth reset,
- any documentation corrections made in the same commit,
- confirmation that no private paths, secrets, cookies, TOTP seeds, recovery codes, screenshots, or App Data files were committed.
