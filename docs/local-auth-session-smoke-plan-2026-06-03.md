# Local Auth Session Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Local Auth session behavior, including login, logout, expiration, refresh, and invalid session handling.

## Scope

Verify that Local Auth protects browser access consistently across normal session lifecycle transitions and presents actionable, privacy-safe errors.

In scope:

- first-run Local Auth setup with fake/demo values,
- successful login after setup,
- logout and protected-route re-entry behavior,
- browser refresh with an active session,
- missing, stale, expired, or tampered session cookie handling,
- invalid password/PIN and TOTP handling,
- WebSocket/RPC revalidation behavior after session loss when practical,
- evidence review for secrets, cookies, recovery codes, local paths, and host identifiers.

Out of scope for this smoke:

- real operator credentials,
- real provider configuration,
- private repositories or private project names,
- exhaustive rate-limit tuning,
- multi-user or wrong-session ownership semantics that are currently blocked by the single-local-operator model,
- browser-specific compatibility beyond the tested browser/version.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use fake/demo Local Auth identity values only.
- Do not configure real providers or import private Projects.
- Use a browser profile that can be cleared or deleted after the smoke.
- Do not capture screenshots or logs containing passwords, PINs, TOTP seeds, recovery codes, cookies, WebSocket tickets, private paths, usernames, hostnames, or provider account metadata.
- Record the local Bun version and compare it with `package.json` `packageManager`; if they differ, record the mismatch as a blocker before using the result as release evidence.

## Suggested setup

Use a disposable App Data directory outside the repository checkout. Example command shape, with paths sanitized in committed evidence:

```bash
METIDOS_APP_DATA_DIR=/tmp/metidos-local-auth-smoke-XXXX bun run start
```

Use demo-only values, such as:

- display name: `Demo Operator`,
- password/passphrase: generated disposable value that is not recorded,
- TOTP app/seed: disposable test enrollment only,
- recovery codes: generated disposable values that are not recorded.

Stop the app with `Ctrl-C` unless another stop method is required, and delete the disposable App Data directory and browser profile after evidence is recorded.

## Smoke steps

1. Start Metidos with the disposable App Data directory.
2. Open the printed local URL in the disposable browser profile.
3. Complete first-run Local Auth setup with fake/demo values.
4. Record only that TOTP enrollment and recovery-code presentation occurred; do not record secrets, seeds, QR contents, or recovery code values.
5. Confirm the authenticated app shell loads after setup.
6. Refresh the browser and confirm the authenticated state is preserved for the active Session.
7. Log out through the UI.
8. Confirm protected app routes require a fresh login after logout and do not briefly show protected data.
9. Log in again with the valid fake/demo credentials and TOTP code.
10. Attempt login with an invalid password/PIN and confirm the error is clear, does not reveal whether any unrelated user exists, and includes safe next-step guidance.
11. Attempt login with an invalid TOTP code and confirm the error is clear, rate-limit aware if applicable, and does not reveal TOTP secrets or recovery-code details.
12. Clear or tamper with the session cookie, then refresh a protected route and confirm the app returns to login or a deterministic unauthenticated state.
13. If practical, keep one authenticated tab open, invalidate the Session by logout/reset from another tab or browser profile, and confirm active RPC/WebSocket UI work either stops, reconnects to login, or shows a clear unauthenticated/session-expired message.
14. Leave the app idle long enough to observe configured expiration only if the timeout is short enough for manual smoke; otherwise record the configured expiration source and mark the long-wait observation as deferred.
15. Stop the app and delete the disposable App Data directory and browser profile.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- browser and version,
- Bun version and `package.json` `packageManager`,
- exact start/stop command shape with private paths replaced by placeholders,
- App Data setup method and teardown confirmation,
- pass/fail status for each smoke step,
- whether refresh preserved a valid Session,
- whether logout and tampered/missing cookies returned to login or deterministic unauthenticated state,
- invalid password/PIN and invalid TOTP error summaries, without entered values,
- whether active RPC/WebSocket state responded safely to session loss,
- whether expiration was directly observed or deferred with a reason,
- any documentation or UI corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Local Auth session behavior only after sanitized evidence shows:

- first-run setup and login work with fake/demo values,
- refresh preserves only a valid active Session,
- logout blocks protected app access after reload/navigation,
- missing, stale, tampered, or expired Session state produces deterministic unauthenticated behavior,
- invalid primary-factor and TOTP attempts produce actionable privacy-safe errors,
- active RPC/WebSocket UI state responds safely to Session loss when tested,
- no captured evidence contains secrets, cookies, TOTP seeds, recovery codes, private machine identifiers, private paths, real provider credentials, or real user/customer data.
