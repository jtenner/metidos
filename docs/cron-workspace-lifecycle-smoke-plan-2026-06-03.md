# Cron Workspace Lifecycle Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Cron Job creation, editing, run-now, disabling, and deletion.

## Scope

Verify that the Cron workspace supports the basic lifecycle for a safe, disposable Cron Job and presents actionable errors without leaking sensitive local data.

In scope:

- create a disabled Cron Job,
- edit and persist its metadata,
- run it on demand,
- enable and disable it,
- delete it or mark it inactive,
- inspect run status, child Thread linkage, and error messages,
- confirm visible transcript/log content is safe to summarize in public readiness notes.

Out of scope for this smoke:

- validating every provider model,
- unattended long-running schedules,
- plugin-owned global Cron callbacks,
- unsafe-mode Cron Jobs,
- real credentials, real repositories, or private worktrees.

## Preconditions

- Use a disposable Metidos App Data directory or a clean local test profile.
- Use a disposable Project pointing at a fake/demo repository with no secrets, private paths in committed files, customer data, or real branch names that should remain private.
- Use either a known-safe local/fake provider configuration or record that run-now is expected to fail because no provider is configured.
- Keep Unsafe Mode off for the test Cron Job.
- Do not capture screenshots containing usernames, hostnames, tokens, cookies, TOTP seeds, recovery codes, private paths, or real provider account metadata.

## Test fixture

Suggested demo repository contents:

```text
README.md
notes/demo-cron-input.txt
```

Suggested Cron Job values:

- Title: `Demo cron lifecycle smoke`
- Description: `Disposable public-readiness smoke job; safe to delete.`
- Schedule: a conservative future schedule such as `0 9 * * *`
- Prompt:

```text
Inspect notes/demo-cron-input.txt in this disposable demo repository and summarize it in one sentence. Do not edit files, do not commit, and stop if anything looks private or ambiguous.
```

- Permissions: minimum safe permissions needed for a read-only thread in the selected runtime.
- Plugin access: none.
- Unsafe Mode: off.
- Initial enabled state: disabled.

## Smoke steps

1. Open the Cron workspace from the disposable setup.
2. Create the disabled test Cron Job with the fixture values above.
3. Reload or navigate away and back, then confirm the job appears with the expected title, disabled state, schedule, worktree, model, permissions, and prompt summary.
4. Edit the title, description, schedule, and prompt with small harmless changes.
5. Reload or navigate away and back, then confirm the edited values persist and no duplicate job was created.
6. Use Run now.
   - If a provider/fake provider is configured, confirm a child Thread is created and the Cron Job latest-run status links to that Thread or makes it easy to find.
   - If no provider is configured, confirm the UI reports a clear, actionable error and does not imply that the schedule will silently recover without setup.
7. Inspect the child Thread or error details and confirm the transcript/log does not expose secrets, unrelated private paths, provider keys, cookies, or recovery credentials.
8. Enable the Cron Job and confirm the active/enabled state is visible after reload.
9. Disable the Cron Job again and confirm it no longer appears as active/scheduled while retaining configuration/history expected for a disabled job.
10. Delete the Cron Job or mark it inactive through the UI.
11. Reload and confirm it no longer appears in active lists. If an archived/deleted view exists, confirm the deleted state is clear and the scheduler will not run it.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- whether the provider was fake/local, real-but-redacted, or absent,
- exact demo repository path pattern without username/hostname details,
- commands used to start/stop the app,
- pass/fail status for each smoke step,
- run-now child Thread id or sanitized failure summary,
- whether enable/disable/delete persisted after reload,
- any documentation or UI corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Cron lifecycle only after sanitized evidence shows:

- create, edit, enable, disable, and delete/inactive flows behave as expected after reload,
- run-now either creates a child Thread or shows a clear provider/setup error,
- visible errors include next-step guidance,
- active lists do not show deleted/inactive jobs as runnable,
- no captured evidence contains secrets, private machine identifiers, private paths, real customer/user data, or real provider credentials.
