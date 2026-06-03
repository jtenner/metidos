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

2. Start Metidos with disposable App Data and minimal documented configuration.
3. Complete first-run Local Auth with fake/demo values.
4. Stop Metidos cleanly.
5. Copy the disposable App Data directory to a second disposable backup path without printing file contents.
6. Restore by pointing `METIDOS_APP_DATA_DIR` at the copied path.
7. Start Metidos and confirm sign-in reaches the expected post-auth state.
8. Exercise documented auth reset commands from `docs/operator-runbook.md` using fake/demo identity values only.
9. Confirm old sessions are invalidated as documented, without recording cookie values.
10. Tear down all disposable App Data and backup paths.

## Acceptance criteria for future evidence

A future smoke result should be committed as a separate evidence note and include:

- host OS and shell,
- Bun version and repository `packageManager`,
- exact sanitized commands,
- pass/fail result for backup, restore, and auth reset,
- any documentation corrections made in the same commit,
- confirmation that no private paths, secrets, cookies, TOTP seeds, recovery codes, screenshots, or App Data files were committed.
