# Actionable Error Paths Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify major error paths produce actionable messages with next steps.

## Scope

Verify that representative high-impact failure paths tell an operator what failed, why it likely failed, and what concrete next step to try, without exposing secrets or unrelated local data.

In scope:

- startup configuration errors,
- local auth setup/login/session errors,
- provider/model unavailability errors,
- Project and Worktree path/Git errors,
- Thread run failures,
- Cron Job run-now or scheduler setup failures,
- Plugin discovery/approval/activation failures,
- WebSocket/RPC connection errors,
- Diff review failures for deleted, binary, or oversized inputs where practical.

Out of scope for this smoke:

- exhaustive validation of every exception branch,
- real provider credentials, private repositories, customer data, or production App Data,
- unsafe-mode escalation tests beyond confirming unsafe-specific copy when a safe disposable setup intentionally enables it,
- fixing every discovered error in the same evidence slice unless the fix is small and clearly related.

## Preconditions

- Use a disposable Metidos App Data directory or a clean local test profile.
- Use a disposable Project pointed at a fake/demo Git repository with no secrets, private remotes, private branch names, or customer data.
- Prefer fake/local provider fixtures. If no provider is configured, record expected provider-unavailable behavior rather than adding real credentials.
- Keep screenshots and copied logs sanitized. Do not capture tokens, cookies, TOTP seeds, recovery codes, provider account metadata, private paths, usernames, hostnames, or full `.env` values.
- Record the exact OS/container image, Bun version, `package.json` `packageManager`, commands, and stop/teardown method.

## Test fixture

Suggested disposable repository contents:

```text
README.md
notes/demo-input.txt
large/demo-large.txt
binary/demo.bin
```

Suggested safe setup variations:

- missing or minimal `.env`,
- intentionally invalid provider/model configuration,
- intentionally missing Project path,
- intentionally corrupted or changed Plugin manifest in a generated demo Plugin,
- intentionally stopped/restarted app to observe stale session or WebSocket recovery copy.

## Smoke steps

1. Start Metidos with a disposable App Data directory and the documented setup command for the selected mode.
2. Trigger one startup/configuration failure, such as missing required setup values, a port conflict, or an unwritable App Data directory.
   - Confirm the message names the failed condition.
   - Confirm the message gives a concrete next step, such as setting an environment variable, changing the port, or choosing a writable directory.
3. Complete first-run Local Auth with fake/demo values, then trigger one safe auth/session failure, such as a wrong code, logout followed by protected navigation, or a stale/tampered cookie.
   - Confirm the user-facing message distinguishes retryable login problems from setup/reset problems.
   - Confirm it does not expose recovery codes, TOTP seeds, cookies, or user lists.
4. Create or open the disposable Project, then trigger one Project/Worktree failure, such as a missing path, non-Git directory, deleted worktree, or inaccessible branch.
   - Confirm the message identifies the affected Project/Worktree and suggests a repair action.
5. Trigger one provider/model failure from Thread creation or run-now, using no provider or an intentionally invalid fake provider.
   - Confirm the UI points to provider/model setup and does not imply the Thread will silently recover.
6. Trigger one Cron run-now failure with a disabled disposable Cron Job that has no valid provider/model.
   - Confirm the Cron Job, latest-run status, or child Thread makes the failure discoverable and actionable.
7. Trigger one Plugin failure with a generated demo Plugin, such as a manifest mismatch, missing declared file, approval hash change, or controlled activation error.
   - Confirm review/approval state is clear and the next action is explicit.
8. Trigger one WebSocket/RPC interruption by restarting the app or using a stale browser tab.
   - Confirm the UI tells the user to sign in, reconnect, refresh, or check origin/proxy settings as appropriate.
9. Trigger one Diff review edge case, such as binary, deleted, renamed, or oversized file handling in the disposable repository.
   - Confirm the UI either renders the case or explains the limitation with a useful next step.
10. For each failure, note whether the copy is actionable, overly vague, misleading, hidden behind hover-only UI, or leaking sensitive data.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- fake/local/absent provider status,
- demo repository path pattern without username/hostname details,
- commands used to start/stop the app,
- pass/fail status for each smoke step,
- exact user-visible error summaries with secrets and private paths redacted,
- whether each message included a concrete next step,
- any corrections made to docs, UI copy, or error handling.

## Acceptance criteria

The product-hardening TODO can be marked complete for major error paths only after sanitized evidence shows:

- each in-scope failure area was tested or explicitly deferred with a reason,
- user-visible messages identify the failed condition and a next step,
- provider, Plugin, Cron, Thread, Worktree, auth, and startup failures are discoverable from the UI or terminal where the user encounters them,
- no captured evidence contains secrets, private machine identifiers, private paths, real customer/user data, or real provider credentials,
- any severe vague, misleading, or secret-leaking messages have follow-up issues or small fixes recorded.
