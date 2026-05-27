# Local Auth Hardening

This page records the durable local-auth hardening behavior that landed after the 2026-04-12 auth audit. **Observed:** Metidos now enforces stricter setup/reset primary-factor requirements, counts lockouts inside an immediate transaction, fails loudly when `auth-secret.key` is missing, rejects unsafe local-operator usernames for workspace-home paths, rate-limits the loopback `/auth/*` routes, and explicitly documents the current TOTP parameters. **Recommended durable rule:** treat these behaviors as the baseline security contract for Metidos's local auth surface unless a later auth redesign replaces them deliberately.

## Summary

- New setup and reset flows now require stronger primary factors:
  - PIN: at least 8 digits and not an obvious repeated or ascending/descending pattern.
  - Password or passphrase: at least 12 characters.
- Failed primary-factor attempts are counted from the latest `user_auth_settings` row inside an immediate SQLite transaction so concurrent failures cannot undercount toward the 3-attempt lockout.
- `auth-secret.key` is no longer silently recreated during decrypt paths. Missing or mismatched keys now fail with an explicit recovery message.
- Auth secret startup/encryption paths enforce owner-only permissions on the app-data leaf directory and warn once when same-owner parent directories are group/other-accessible.
- New first-run local-operator usernames must satisfy the same path-safe username rules required by workspace-home scoping.
- `/auth/setup`, `/auth/login`, `/auth/recovery-login`, and `/auth/step-up` now apply in-memory peer and peer-plus-subject rate limits and return `429` with `Retry-After` on repeated failures.
- Browser PIN/password reset revokes auth sessions, closes authenticated websockets, terminates affected terminal PTYs, and aborts active Pi thread turns.
- The current TOTP contract is explicit and test-backed: SHA-1 HMAC, 6 digits, 30-second period, and a `+/-1` verification window.

## Problem

The 2026-04-12 auth audit found several operational hardening gaps in the local auth surface:

- new credentials could be weaker than desired,
- concurrent login failures could race and miss the lockout threshold,
- losing `auth-secret.key` could be masked by silent key recreation,
- unsafe usernames could break the filesystem assumptions behind workspace-home paths,
- loopback auth routes had no network-level throttling,
- and TOTP expectations were not documented clearly enough for operators.

Without a durable wiki record, future work would need to rediscover those expectations from implementation details and scattered tests.

## Current state

### Primary-factor policy for setup and reset

**Observed:** existing local installs can still sign in with their current credentials, but new or rotated credentials must satisfy the stricter setup/reset rules.

Durable policy:

- PINs must be at least 8 digits.
- PINs must not be obvious repeated or ascending/descending patterns.
- Passwords and passphrases must be at least 12 characters.

This hardens new enrollment and reset flows without stranding existing local installs that were created under older rules.

Browser reset policy:

- `/auth/reset-pin` and `/auth/reset-password` intentionally require a live authenticated browser session plus TOTP, but not the current PIN/password.
- This differs from the CLI reset path, which verifies the current primary factor because it runs outside an already authenticated browser session.
- Keep the browser routes available for signed-in local operators who forgot the current PIN/password but still control the active session and TOTP factor.
- Continue revoking authenticated sessions after a successful browser reset so the rotated primary factor takes effect immediately.

Security boundary: a stolen browser session plus access to the operator's current TOTP factor can rotate the primary factor. That tradeoff is accepted for the local browser flow; higher-risk deployments should rely on session protection, TOTP custody, and session revocation rather than assuming browser resets re-check the old primary factor.

### Reset session revocation and process boundary

**Observed:** successful browser PIN/password reset deletes auth sessions, clears the auth session touch cache, closes authenticated RPC/terminal websockets for the affected user, terminates PTY sessions associated with those terminal sockets, and aborts active Pi thread turns.

Durable boundary:

- reset is now an authentication/session revocation event and a best-effort process-containment boundary,
- existing browser websocket sessions are expected to lose auth and reconnect through login,
- terminal sessions associated with closed user sockets enter the normal graceful PTY close path, including the forced-kill cleanup timer if graceful exit stalls,
- Pi thread runtimes are owned by the single persisted local operator rather than individual browser sessions, so reset aborts all active thread turns instead of trying to map them to a revoked browser session,
- and operators who need a hard post-compromise guarantee beyond best-effort abort/PTY termination should restart the backend after resetting credentials.

Relevant repo surface:

- `src/bun/auth/reset.ts`
- `src/bun/terminal-manager.ts`
- `src/bun/project-procedures/thread-runtime-lifecycle.ts`

### Lockout counting is transaction-backed

**Observed:** failed primary-factor attempts are counted from the latest `user_auth_settings` row inside an immediate SQLite transaction.

Durable implication:

- concurrent bad-login attempts should no longer all read the same pre-increment failure count,
- and the 3-attempt lockout threshold should trigger reliably even under parallel failures.

Relevant repo surface:

- `src/bun/db.ts` (`user_auth_settings` storage and auth-state persistence)

### `auth-secret.key` loss is explicit

**Observed:** decrypt paths no longer auto-create a replacement `auth-secret.key` when the persisted key is missing.

Durable policy:

- login, step-up, and CLI verification should fail loudly when the stored TOTP ciphertext cannot be decrypted with the current key,
- operators should see a recovery-oriented error instead of a silent secret rotation,
- and loss of the key file is treated as a real recovery event, not a transparent repair.

Relevant repo surface:

- `src/bun/auth/secrets.ts`
- `src/bun/auth/secrets.test.ts`
- `src/bun/README.md`

### Path-safe usernames are required for the local operator

**Observed:** new first-run local-operator usernames must satisfy the same path-safe username policy that workspace-home scoping depends on.

Durable policy:

- new usernames must be safe to use in workspace-home paths,
- but historical usernames remain allowed to log in and finish setup so local upgrades do not strand existing installs.

This preserves compatibility while aligning auth enrollment with filesystem scoping assumptions.

### Loopback auth routes are rate-limited

**Observed:** the local HTTP auth surface now applies network-level backoff on repeated failures.

Covered routes:

- `/auth/setup`
- `/auth/login`
- `/auth/recovery-login`
- `/auth/step-up`

Durable behavior:

- limits are tracked in memory,
- enforcement combines peer and peer-plus-subject windows,
- repeated failures return `429 Too Many Requests`,
- and responses include `Retry-After` so clients can present explicit backoff guidance.

Relevant repo surface:

- `src/bun/auth/rate-limit.ts`
- `src/bun/auth/rate-limit.test.ts`
- `src/bun/index.ts`
- `src/mainview/auth-client.ts`

### TOTP behavior is explicit

**Observed:** the current TOTP implementation remains:

- SHA-1 HMAC
- 6 digits
- 30-second periods
- verification window of `+/-1` time step

Durable operator guidance:

- small local clock skew is tolerated,
- larger drift should be treated as a clock-health problem,
- and recovery-code login is the supported fallback if the local operator cannot satisfy TOTP verification.

This page does **not** recommend that SHA-1 remain forever; it records the current supported contract so behavior is explicit until a later redesign changes it.

Relevant repo surface:

- `src/mainview/auth-shell.tsx`
- `src/mainview/app/auth-step-up-dialog.tsx`
- `src/mainview/app/use-step-up-controller.ts`

## Auth-secret lifecycle expectations

**Observed:** `auth-secret.key` is paired with the encrypted TOTP secrets stored in SQLite.

Durable recovery contract:

- restoring the database without restoring the matching `auth-secret.key` is not a supported recovery path,
- if the key file is lost or replaced, persisted TOTP secrets are no longer decryptable,
- the supported recovery options are either restoring the original key from backup or performing a full local auth reset and re-enrolling TOTP secrets.

For development environments, `METIDOS_DEV_RESET=1` remains the fast full-reset path because it removes both SQLite auth data and `auth-secret.key` together.

### Windows ACL expectation for auth secrets

**Observed:** app-data setup now applies owner-only POSIX modes to every directory created by recursive app-data initialization, including intermediate parent directories, and `auth/secrets.ts` applies `0600` to `auth-secret.key`. On Windows, Node/Bun `chmod` cannot prove the same owner-only ACL invariant, so the runtime emits a non-blocking warning that points back to this guidance.

Durable operator requirement:

- the Metidos app data directory must be readable and writable only by the Windows account that runs Metidos and by trusted local system operators,
- `auth-secret.key` must inherit or receive an equivalent restrictive ACL because it protects persisted TOTP secrets at rest,
- shared Windows hosts should not place `METIDOS_APP_DATA_DIR` under a broadly readable profile, synced folder, network share, or service directory,
- backups must preserve `auth-secret.key` with the encrypted auth database and must not relax the restored ACLs,
- and the Windows runtime warning is diagnostic only; it does not mean Metidos verified the ACLs or that single-user local setup is blocked.

Recommended verification for operators is to inspect the app data directory and `auth-secret.key` in Windows file security settings, or with administrative tooling such as `icacls`, and ensure untrusted local users are absent from the access list.

### Auth secret parent directory permissions

**Observed:** the auth secret helper creates and chmods app-data directories with owner-only POSIX permissions where supported, and it also warns when an existing same-owner parent directory above the auth secret leaf is group/other-accessible. Sticky shared directories such as `/tmp` and directories owned by another user are treated as trust boundaries and are not warned through.

Durable operator requirement:

- keep `auth-secret.key` and its app-data directory owner-only,
- avoid placing app data under a broadly readable same-owner parent when other local users can traverse that parent,
- and treat the parent-directory warning as a prompt to move app data or tighten permissions, not as a startup blocker.

## Dev-only reset policy

**Observed:** `METIDOS_DEV_RESET=1` remains the only development-only auth-state shortcut.

Durable policy:

- startup rejects the reset flag unless the app is running in dev mode,
- no login-skipping status or RPC context exists in the backend/browser auth contract,
- and the browser auth shell always requires the real setup/login/recovery flow.

Relevant repo surface:

- `src/bun/dev-flows.ts`
- `src/bun/index.ts`
- `src/mainview/auth-shell.tsx`

## Non-goals and remaining scope

**Observed:** this hardening slice did **not** migrate away from SHA-1 TOTP and did **not** introduce automatic key rotation.

Those remain longer-term auth-design questions rather than unresolved operational gaps in the current local auth surface.

## Related pages

- [pi-coding-agent-migration](./pi-coding-agent-migration.md) — records the higher-level split where Metidos still owns local auth and security policy while Pi owns provider/session tooling.
- [codex-via-pi-wiring](./codex-via-pi-wiring.md) — records the Codex/OpenAI provider-auth handoff through Pi and core-plugin `piAuth`, which is separate from this page's local browser-auth surface.

## Source

- Source note ingested from `docs/2026-04-12-auth-hardening-follow-up.md` on 2026-04-19.
