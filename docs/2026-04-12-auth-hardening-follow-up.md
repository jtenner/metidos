# 2026-04-12 Auth Hardening Follow-up

This note records the concrete auth-hardening changes that landed after the 2026-04-12 audit so future work does not have to rediscover the intended behavior from scattered tests.

## Landed changes

1. Primary-factor policy is stricter for new setup and reset flows.
   Existing configured users can still sign in with their current credentials, but new or rotated credentials now require:
   - PIN: at least 8 digits, and not an obvious repeated or ascending/descending pattern
   - password/passphrase: at least 12 characters

2. Primary-factor lockout counting is now transaction-backed.
   Failed primary-factor attempts are now counted from the latest `user_auth_settings` row inside an immediate SQLite transaction. This closes the undercounting race where several concurrent bad logins could all read the same pre-increment failure count and fail to trigger the 3-attempt lockout.

3. `auth-secret.key` loss is now surfaced instead of hidden.
   Decrypt paths no longer auto-create a replacement key when the persisted key file is missing. That old behavior silently replaced the key during login or step-up, which made the actual recovery problem harder to diagnose. Login, step-up, and CLI verification now fail loudly with a clear recovery message instead.

4. New usernames must be safe for per-user workspace homes.
   New first-run usernames and admin-created pending users now reuse the same path-safe username policy that regular-user workspace scoping depends on. Existing historical usernames are still allowed to log in and finish setup so local upgrades do not strand previously created users.

5. Local HTTP auth routes now have network-level backoff.
   `/auth/setup`, `/auth/login`, `/auth/recovery-login`, and `/auth/step-up` now apply an in-memory peer plus peer+subject rate limit. Repeated failures return `429` plus a `Retry-After` header instead of leaving the loopback auth surface completely unthrottled.

6. The custom TOTP behavior is now explicit and test-backed.
   The current implementation remains SHA-1/HMAC with 6 digits, 30-second periods, and a `+/-1` step verification window. That keeps ordinary clock skew tolerant while still rejecting larger drift. If codes start failing consistently, the expected operator response is to fix local clock health or use a recovery code, not to assume the secret silently rotated.

## Auth-secret lifecycle expectations

- `auth-secret.key` is paired with the encrypted TOTP secrets stored in SQLite.
- Restoring the database without restoring the matching `auth-secret.key` is not a supported recovery path.
- If the key file is lost or replaced, persisted TOTP secrets are no longer decryptable.
- The supported operational recovery is:
  - restore the original `auth-secret.key` from backup, or
  - perform a full local auth reset and re-enroll TOTP secrets

For development environments, `METIDOS_DEV_RESET=1` remains the fastest full local reset path because it removes both the SQLite auth data and `auth-secret.key` together.

## Dev-only bypass policy

- `METIDOS_DEV_BYPASS=1` and `METIDOS_DEV_RESET=1` are still development-only flags.
- Startup now rejects those flags unless the app is running in dev mode, so auth bypass cannot be enabled accidentally in regular runs.
- The browser auth shell also keeps warning that bypass mode is not a valid substitute for testing the real setup/login flow.

## Remaining scope

This slice still does not migrate away from SHA-1 TOTP or introduce automatic key rotation. Those are longer-term auth-design choices rather than unresolved operational hardening gaps in the current local auth surface.
