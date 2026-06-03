# Step-up Authentication Sensitive Actions Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Step-up Authentication protects sensitive actions and fails safely.

## Scope

Verify that actions which approve or execute local plugin code require recent Step-up Authentication, while lower-risk maintenance actions remain available with the expected local-operator protections and destructive confirmations.

In scope:

- plugin Enable after review approval,
- Re-approve Plugin after a Review Hash change,
- Retry Plugin for a failed or disabled approved plugin when exposed by the UI,
- Run Plugin GC when exposed by the UI,
- rejection behavior before fresh Step-up Authentication,
- successful retry after completing Step-up Authentication with fake/demo Local Auth values,
- expiry or stale-step-up behavior when practical,
- comparison with actions that should not require step-up, such as Disable, Review Plugin Changes, Open `.data`, Open `.logs`, and Reset Plugin Data with typed confirmation,
- evidence review for secrets, cookies, TOTP seeds, recovery codes, private paths, host identifiers, and provider data.

Out of scope for this smoke:

- real operator credentials,
- real provider configuration,
- approving untrusted third-party plugin code,
- exhaustive Local Auth session lifecycle checks already covered by the Local Auth session smoke plan,
- long-duration step-up expiry waiting if the configured timeout is not practical for a short manual smoke.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use a disposable browser profile.
- Use fake/demo Local Auth identity values only.
- Use a repo-owned or generated demo Plugin fixture that has no real provider secrets and no private data access.
- Do not configure real providers or import private Projects.
- Do not capture screenshots or logs containing passwords, PINs, TOTP seeds, recovery codes, cookies, WebSocket tickets, private paths, usernames, hostnames, provider account metadata, or plugin-owned private data.
- Record the local Bun version and compare it with `package.json` `packageManager`; if they differ, record the mismatch as a blocker before using the result as release evidence.

## Suggested setup

Use a disposable App Data directory outside the repository checkout. Example command shape, with paths sanitized in committed evidence:

```bash
METIDOS_APP_DATA_DIR=/tmp/metidos-step-up-smoke-XXXX bun run start
```

Use demo-only Local Auth values, such as:

- display name: `Demo Operator`,
- password/passphrase: generated disposable value that is not recorded,
- TOTP app/seed: disposable test enrollment only,
- recovery codes: generated disposable values that are not recorded.

Use only a demo Plugin fixture whose manifest, permissions, and callbacks are safe to approve in a disposable profile. Stop the app with `Ctrl-C` unless another stop method is required, and delete the disposable App Data directory and browser profile after evidence is recorded.

## Smoke steps

1. Start Metidos with the disposable App Data directory.
2. Open the printed local URL in the disposable browser profile.
3. Complete first-run Local Auth setup with fake/demo values.
4. Add or expose the demo Plugin fixture so it appears in Settings -> Plugins.
5. Open the plugin review details and record only safe metadata: plugin folder/name, requested permission categories, and Review Hash presence; do not record private paths if they reveal host details.
6. Attempt Enable or initial approval without fresh Step-up Authentication, if the UI exposes that path, and confirm the action is denied or routed to the Step-up Authentication dialog before code is approved or activated.
7. Complete Step-up Authentication with fake/demo Local Auth values and approve or enable the plugin.
8. Confirm the plugin reaches the expected approved/enabled/active state, or record the safe failure diagnostic if the fixture intentionally fails.
9. Modify the demo Plugin fixture in a harmless way that changes the Review Hash, then return to Settings -> Plugins.
10. Confirm Re-approve Plugin requires fresh Step-up Authentication before the changed hash can be approved.
11. If Retry Plugin is available for the fixture state, attempt retry without fresh step-up and confirm it is blocked or routed to Step-up Authentication; then complete step-up and confirm retry proceeds or fails with an actionable safe diagnostic.
12. If Run Plugin GC is available, attempt it without fresh step-up and confirm it is blocked or routed to Step-up Authentication; then complete step-up and confirm GC proceeds or fails with an actionable safe diagnostic.
13. Confirm Disable does not require recent step-up and clearly communicates any restart requirement or runtime-state limitation.
14. Confirm Review Plugin Changes and Open `.data` / Open `.logs`, when available, require only the authenticated local-operator session and do not request Step-up Authentication.
15. Confirm Reset Plugin Data does not require Step-up Authentication but does require explicit destructive confirmation by typing the plugin folder name.
16. If practical, wait until the step-up window expires or clear the relevant session/profile state, then retry a sensitive action and confirm fresh Step-up Authentication is required again. If not practical, record the configured timeout source and mark direct expiry observation as deferred.
17. Stop the app and delete the disposable App Data directory, browser profile, and any generated demo Plugin fixture if it was not committed as an intentional test fixture.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- browser and version,
- Bun version and `package.json` `packageManager`,
- exact start/stop command shape with private paths replaced by placeholders,
- App Data setup method and teardown confirmation,
- demo Plugin fixture source and whether it was repo-owned or generated,
- pass/fail status for each sensitive action tested: Enable, Re-approve Plugin, Retry Plugin, and Run Plugin GC,
- pass/fail status for each non-step-up comparison action tested: Disable, Review Plugin Changes, Open `.data`, Open `.logs`, and Reset Plugin Data,
- whether sensitive actions were blocked before fresh step-up,
- whether sensitive actions proceeded after successful step-up,
- whether stale or expired step-up was directly observed or deferred with a reason,
- summaries of any error messages, without secrets or private data,
- any documentation or UI corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Step-up Authentication only after sanitized evidence shows:

- Enable, Re-approve Plugin, Retry Plugin, and Run Plugin GC require recent Step-up Authentication before approving or executing plugin code,
- denial before step-up is clear, safe, and does not partially approve or activate the sensitive action,
- successful step-up allows the pending sensitive action to continue without requiring a full login loop,
- expired or stale step-up requires fresh proof, or the timeout source and deferred observation are documented,
- Disable, Review Plugin Changes, Open `.data`, Open `.logs`, and Reset Plugin Data follow the documented lower-risk behavior and do not unexpectedly require recent step-up,
- Reset Plugin Data still requires explicit destructive confirmation,
- no captured evidence contains secrets, cookies, TOTP seeds, recovery codes, private machine identifiers, private paths, real provider credentials, or real user/customer data.
