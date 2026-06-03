# Plugin Lifecycle Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Plugin System v1 discovery, review, approval, disable, reset-data, and failure states.

## Scope

Verify that Plugin Administration supports the basic lifecycle for a safe, disposable Plugin and presents actionable diagnostics without leaking sensitive local data.

In scope:

- discover a Plugin from a disposable App Data plugin folder or synced first-party fixture,
- review the Manifest, declared capabilities, settings, and Review Hash,
- approve the current Review Hash after Step-up Authentication,
- confirm Activation and Plugin Inventory status,
- disable the Plugin and confirm sidecar/runtime state changes are visible,
- reset Plugin Data and confirm seed/data behavior is understandable,
- introduce one controlled failure and confirm the Failed/Degraded diagnostics include next steps,
- confirm evidence is safe to summarize in public readiness notes.

Out of scope for this smoke:

- validating every first-party Plugin,
- testing real third-party credentials or OAuth providers,
- exercising real notification, Gmail, calendar, or external network integrations,
- approving unknown code from outside this repository,
- using private worktrees, private App Data, or real provider account metadata.

## Preconditions

- Use a disposable Metidos App Data directory or a clean local test profile.
- Use a disposable Project and Worktree containing only fake/demo data if the Plugin exposes project-scoped tools.
- Use a repo-owned Plugin fixture or a tiny disposable Plugin whose code, Manifest, seed data, and AGENTS.md are safe to publish.
- Keep provider credentials, OAuth tokens, cookies, TOTP seeds, Recovery Codes, and private paths out of screenshots and transcripts.
- If Step-up Authentication is required, use fake/demo Local Auth values and record only that step-up passed or failed; never record secrets.
- If local Bun does not match `package.json` `packageManager`, record the mismatch and do not treat runtime failures as final product evidence until the environment is corrected.

## Test fixture

Suggested disposable Plugin shape under the disposable App Data plugin directory:

```text
plugins/demo-lifecycle-smoke/
  metidos-plugin.json
  AGENTS.md
  index.js
  seed/readme.txt
```

Suggested fixture behavior:

- Manifest id: `demo-lifecycle-smoke`
- Display name: `Demo lifecycle smoke`
- Permissions: the minimum host permissions required for the fixture, preferably none beyond a simple tool registration if supported.
- Access groups: one clearly named demo group, if the fixture exposes a Thread-visible tool.
- Settings: one harmless string setting such as `demoMessage` with a non-secret default.
- Seed Data: `seed/readme.txt` containing fake text only.
- Entrypoint behavior: register a harmless diagnostic/tool or startup log that proves Activation without network, file-system, or credential access.

If a stable first-party test Plugin already exists, use it instead of creating a new fixture and record the exact source path and reason it is safe.

## Smoke steps

1. Start Metidos with disposable App Data and the disposable Plugin fixture installed or synced.
2. Open Plugin Administration and confirm the Plugin appears in Plugin Inventory with the expected display name, Manifest metadata, status, settings, permissions, access groups, and Review Hash.
3. Open the review details and confirm the UI makes the Manifest, source/hash basis, capability declarations, and approval implications understandable before approval.
4. Attempt approval without fresh Step-up Authentication, if the UI exposes that path, and confirm the denial is clear and safe.
5. Complete Step-up Authentication with fake/demo Local Auth values and approve the current Review Hash.
6. Reload or navigate away and back, then confirm the Plugin remains approved for the same Review Hash and shows Active or an expected non-active status with actionable diagnostics.
7. If the Plugin exposes a harmless tool/access group, create or inspect a safe Thread configuration and confirm the Plugin access group is visible only where expected.
8. Disable the Plugin through Plugin Administration.
9. Reload or navigate away and back, then confirm disabled state persists and the Plugin's tools, provider registrations, ingress routes, or sidecar effects are no longer active.
10. Re-enable or re-approve the Plugin if required, then run Reset Plugin Data.
11. Confirm Plugin Data is reset according to the Manifest/seed expectations and that the UI distinguishes data reset from approval/review state.
12. Introduce one controlled failure, such as a temporary invalid Manifest field or broken entrypoint in the disposable Plugin fixture.
13. Reload or restart the app and confirm the Plugin enters Failed/Degraded, Needs Review, or another accurate status with diagnostics that identify the next step without dumping secrets or private local paths.
14. Restore the fixture, reload, and confirm the Plugin can return to a healthy state or be safely disabled/deleted.
15. Tear down the disposable App Data/profile and demo repository.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- Plugin fixture source path or generated fixture contents summary,
- exact start/stop commands with usernames, hostnames, and private paths redacted,
- pass/fail status for each smoke step,
- observed Plugin Lifecycle Status values,
- Review Hash behavior after approval, disable, data reset, and controlled failure,
- whether Step-up Authentication blocked sensitive actions until fresh proof was provided,
- teardown steps,
- any documentation or UI corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Plugin lifecycle only after sanitized evidence shows:

- discovery and review details are complete enough for a Local Operator to understand what is being approved,
- approval requires the expected Step-up Authentication for sensitive actions,
- Approval is tied to the current Review Hash and persists only as intended,
- Activation, disable, reset-data, and controlled failure states are visible and accurate after reload/restart,
- Plugin tools/capabilities are not available after disable or failed activation,
- diagnostics include actionable next steps,
- no captured evidence contains secrets, private machine identifiers, private paths, real customer/user data, or real provider credentials.
