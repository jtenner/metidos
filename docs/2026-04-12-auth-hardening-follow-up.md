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

## Auth-secret lifecycle expectations

- `auth-secret.key` is paired with the encrypted TOTP secrets stored in SQLite.
- Restoring the database without restoring the matching `auth-secret.key` is not a supported recovery path.
- If the key file is lost or replaced, persisted TOTP secrets are no longer decryptable.
- The supported operational recovery is:
  - restore the original `auth-secret.key` from backup, or
  - perform a full local auth reset and re-enroll TOTP secrets

For development environments, `METIDOS_DEV_RESET=1` remains the fastest full local reset path because it removes both the SQLite auth data and `auth-secret.key` together.

## Remaining scope

This slice does not change the custom TOTP algorithm, add network rate limiting, or rotate existing stored credentials automatically. Those remain broader auth-surface concerns rather than setup/login transactionality issues.
