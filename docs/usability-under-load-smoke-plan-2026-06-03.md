# Usability Under Load Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify the app remains usable during long-running agent work, large logs, slow providers, and background Cron activity.

## Scope

Verify that the Mainview and Backend stay responsive enough for an operator to understand system state, navigate away, stop work, and recover while representative background activity is in progress.

In scope:

- one long-running safe Thread,
- one Thread or Cron run producing a large but safe transcript/log,
- one slow or unavailable provider/model path,
- one background Cron Job run or scheduler wake-up,
- navigation between Projects, Threads, Cron Jobs, Diffs, and settings while activity continues,
- stop/cancel controls and status updates,
- actionable messages for delayed, failed, or interrupted work.

Out of scope for this smoke:

- production workspaces, private repositories, real credentials, or real provider account metadata,
- exhaustive load testing or benchmarking; use `docs/performance-validation.md` for quantitative harness checks,
- unsafe-mode workload escalation,
- fixing every discovered issue in the same evidence slice unless the fix is small and directly related.

## Preconditions

- Use a disposable Metidos App Data directory or a clean local test profile.
- Use a disposable Project pointed at a fake/demo Git repository with no secrets, private remotes, private branch names, customer data, or real user content.
- Prefer a fake/local/low-cost provider configuration that can be slowed or made unavailable intentionally. If no provider is configured, record the expected provider-unavailable behavior instead of adding real credentials.
- Keep Unsafe Mode off unless a separate unsafe-mode smoke explicitly requires it.
- Keep screenshots and copied logs sanitized. Do not capture tokens, cookies, TOTP seeds, recovery codes, provider account metadata, private paths, usernames, hostnames, or full `.env` values.
- Record exact OS/container image, Bun version, `package.json` `packageManager`, commands, and stop/teardown method.

## Test fixture

Suggested disposable repository contents:

```text
README.md
notes/demo-long-running-input.txt
notes/demo-large-log-input.txt
src/demo-file-001.txt ... src/demo-file-100.txt
```

Suggested safe prompts:

Long-running Thread prompt:

```text
Inspect this disposable demo repository slowly. Summarize each file under src/ in one short bullet. Pause between batches if the runtime supports it. Do not edit files, do not commit, and stop if anything looks private or ambiguous.
```

Large-log Thread or Cron prompt:

```text
Read notes/demo-large-log-input.txt and produce a verbose but safe progress log with numbered checkpoints. Do not include host paths, usernames, environment variables, secrets, or unrelated local data. Do not edit files and do not commit.
```

Slow-provider variation:

- configure a fake provider endpoint that delays responses, or
- select an intentionally unavailable fake/local model, or
- temporarily disconnect the fake provider process, if doing so is safe in the disposable setup.

Background Cron variation:

- Title: `Demo background load smoke`
- Schedule: a conservative future schedule such as `0 9 * * *`
- Initial enabled state: disabled until ready to run manually
- Prompt: use the large-log prompt above with safe demo files only.

## Smoke steps

1. Start Metidos with the disposable App Data directory and documented setup command for the selected mode.
2. Complete first-run Local Auth with fake/demo values if required.
3. Open the disposable Project and start the long-running safe Thread.
   - Confirm the Thread list and transcript show a running/in-progress state.
   - Confirm the UI remains navigable while output is streaming or pending.
4. While the Thread is running, navigate to Cron Jobs, Projects/Worktrees, Diff review, and back to the Thread.
   - Confirm navigation controls remain usable.
   - Confirm the running Thread status is not lost or misleading after navigation.
5. Start the large-log Thread or run the disposable Cron Job manually.
   - Confirm transcript/log rendering remains scrollable.
   - Confirm recent output is discoverable without freezing the whole app.
   - Confirm large output does not reveal private local data in visible summaries.
6. Trigger or observe a slow/unavailable provider path.
   - Confirm pending, retrying, failed, or unavailable states are visible.
   - Confirm messages explain the likely provider/model setup issue or delay and suggest a concrete next step.
7. With at least one background activity active or recently failed, open the Cron workspace and run the disposable Cron Job manually.
   - Confirm latest-run status, child Thread linkage, or failure state is visible.
   - Confirm existing Thread navigation still works.
8. Use available stop/cancel controls on the long-running Thread or child Thread.
   - Confirm the stop action is visible, works, and results in a clear stopped/canceled/final state.
   - Confirm stopped work does not continue to append unbounded output after the UI reports it stopped.
9. Reload the browser tab or restart the app while the disposable workload is stopped or failed.
   - Confirm prior Thread/Cron state remains understandable after reload.
   - Confirm stale in-progress indicators are not shown as active unless work is actually still running.
10. Tear down the disposable App Data directory, browser profile, fake provider process, and demo repository.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- fake/local/absent provider status,
- demo repository path pattern without username/hostname details,
- commands used to start/stop the app and any fake provider,
- pass/fail status for each smoke step,
- observed UI responsiveness issues, if any,
- exact user-visible status/error summaries with secrets and private paths redacted,
- whether stop/cancel controls were visible and effective,
- whether reload/restart preserved understandable final state,
- any documentation, UI, or Backend corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for under-load usability only after sanitized evidence shows:

- the app remained navigable during at least one long-running Thread,
- large safe transcript/log output stayed scrollable or failed with an actionable limitation,
- slow/unavailable provider states were visible and actionable,
- background Cron activity exposed latest-run status or child Thread linkage,
- stop/cancel controls were visible and led to a clear final state,
- reload/restart did not leave misleading active states for stopped or failed disposable work,
- no captured evidence contains secrets, private machine identifiers, private paths, real customer/user data, or real provider credentials.
