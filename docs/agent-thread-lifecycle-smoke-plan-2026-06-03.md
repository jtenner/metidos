# Agent Thread Lifecycle Smoke Plan (2026-06-03)

This plan defines a disposable manual smoke for the public-readiness task: verify Agent Thread creation, monitoring, stopping, and resuming behavior.

## Scope

Verify that a safe, disposable Thread can be created from a Project/Worktree, monitored while running, stopped, and resumed or continued without losing context or presenting misleading state.

In scope:

- create a safe Thread from a disposable Project and Worktree,
- confirm selected model, permissions, Worktree, and prompt are visible before start,
- monitor status changes, transcript updates, tool-call/log visibility, and error messages,
- stop or cancel a running Thread,
- resume, continue, or otherwise recover from the stopped state using the UI flow the product exposes,
- reload/navigate during the lifecycle to confirm durable status and transcript state,
- confirm evidence can be summarized without exposing local secrets or private paths.

Out of scope for this smoke:

- exhaustive provider/model compatibility,
- unsafe-mode Thread execution,
- real private repositories or customer data,
- full Plugin tool coverage,
- Cron-created child Threads, which are covered by the Cron workspace lifecycle smoke plan.

## Preconditions

- Use a disposable Metidos App Data directory or clean local test profile.
- Use a disposable Project pointing at a fake/demo repository with no secrets, private branch names, customer data, or private paths in committed files.
- Use a safe local/fake provider if available. If no provider is configured, record the no-provider Thread creation/start failure instead of adding real credentials for this smoke.
- Keep Unsafe Mode off and grant only the minimum safe permissions needed for the selected prompt.
- Do not capture screenshots containing usernames, hostnames, tokens, cookies, TOTP seeds, recovery codes, private paths, provider account metadata, or private model/API keys.

## Test fixture

Suggested demo repository contents:

```text
README.md
notes/demo-thread-input.txt
```

Suggested `notes/demo-thread-input.txt` content:

```text
This is a disposable public-readiness smoke fixture. It contains no secrets.
```

Suggested first Thread prompt:

```text
Read notes/demo-thread-input.txt and summarize it in one sentence. Then wait for a follow-up instruction if the UI supports continuing this Thread. Do not edit files, do not commit, and stop if anything looks private or ambiguous.
```

Suggested resume/continue prompt:

```text
Continue from the previous context and state whether the fixture was safe to summarize. Do not edit files or commit.
```

If a deliberately long-running state is needed to test stop/cancel, use a harmless prompt that asks the agent to pause and report progress in small intervals, or use the runtime's safest available fake/slow provider mode.

## Smoke steps

1. Start Metidos with the disposable App Data/profile and open the disposable Project/Worktree.
2. Open the Thread creation flow and enter the first prompt.
3. Confirm the selected Project/Worktree, model/provider, permissions, Plugin access, and Unsafe Mode state are visible and match the intended safe fixture before starting.
4. Start the Thread.
   - If a provider/fake provider is configured, confirm a new Thread appears with a clear running/in-progress state.
   - If no provider is configured, confirm the UI shows an actionable provider/model setup error and does not create a misleading runnable state.
5. While the Thread is active, monitor the Thread list and transcript.
   - Confirm status, streamed content, tool-call/log disclosure, and any permission prompts remain understandable.
   - Navigate away and back, then confirm status and transcript context are still discoverable.
6. Use the stop/cancel control while a safe Thread is running or while it is waiting for provider output.
   - Confirm the UI acknowledges the stop request and settles into a stopped, canceled, failed, or completed state that is specific and understandable.
   - Confirm no duplicate active Thread is left behind.
7. Reload the app or restart it if practical, then reopen the Thread.
   - Confirm final status, transcript, prompt, selected Worktree, and any error/stop reason persist.
8. Use the available resume/continue/follow-up flow for the stopped or completed Thread.
   - If resume is supported, send the resume prompt and confirm the new run appends to or links from the prior context clearly.
   - If resume is not supported for the observed state, confirm the UI says so clearly or offers a safe new-Thread alternative.
9. Stop or complete the resumed/continued run and confirm the final state is visible after navigation/reload.
10. Tear down the disposable App Data/profile and demo repository.

## Evidence to record

Record a sanitized evidence note with:

- date and timezone,
- OS/container image,
- Bun version and `package.json` `packageManager`,
- App Data setup method,
- whether the provider was fake/local, real-but-redacted, or absent,
- demo repository path pattern without username/hostname details,
- commands used to start and stop the app,
- Thread title/id pattern or sanitized identifier,
- pass/fail status for creation, monitoring, stop/cancel, reload persistence, and resume/continue,
- sanitized provider/model error summary if execution could not start,
- whether any transcript/tool-call/log content exposed secrets or private local details,
- any documentation, UI, or Backend corrections needed.

## Acceptance criteria

The product-hardening TODO can be marked complete for Agent Thread lifecycle only after sanitized evidence shows:

- Thread creation either starts a safe run or reports a clear provider/model/setup error,
- active status and transcript updates are discoverable during monitoring,
- stop/cancel produces a durable, understandable terminal or interrupted state,
- resume/continue is either functional and context-preserving or clearly unavailable for the observed state,
- navigation/reload does not lose or misrepresent Thread state,
- no captured evidence contains secrets, private machine identifiers, private paths, real customer/user data, cookies, recovery credentials, or real provider credentials.
