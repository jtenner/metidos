# Manual QA Checklist

Use this checklist before a public release, after large workflow changes, or when automated tests do not cover an end-to-end path. Use fake/demo data only. Do not paste real secrets, private repository names, customer data, or local-only paths into screenshots, logs, issues, or release notes.

## Run metadata

Record these details with each QA pass:

- Date and tester:
- Git commit or branch:
- OS and version:
- Bun version:
- Browser and version:
- Install mode: source / Docker / Podman / other
- Runtime mode: safe / unsafe, local / remote access
- Notes about skipped checks and why:

## 1. Install and startup

- [ ] Clone the repository into a clean directory or start from a clean disposable container.
- [ ] Follow the documented setup path without using private knowledge, ignored local state, or unpublished packages.
- [ ] Install dependencies with the documented command.
- [ ] Start the app with the documented development or production command for the tested mode.
- [ ] Confirm startup logs identify the main URL and do not expose secrets or sensitive local paths.
- [ ] Confirm missing optional dependencies produce readable guidance rather than crashes.

## 2. Authentication and session behavior

- [ ] Complete first-run local auth setup using demo credentials only.
- [ ] Log in successfully after setup.
- [ ] Log out and confirm protected app routes require a new login.
- [ ] Refresh the browser and confirm the expected session state is preserved or rejected.
- [ ] Try an invalid password and confirm the error is actionable without revealing sensitive details.
- [ ] If step-up authentication is enabled for the flow under test, trigger a sensitive action and confirm step-up is required and expires as expected.
- [ ] If reset or recovery is part of the tested setup, verify the documented reset flow works and records clear operator guidance.

## 3. Provider setup

- [ ] Open settings and add or update a model provider using fake/demo or disposable credentials.
- [ ] Confirm secret fields are masked after save and are not echoed into logs or diagnostics.
- [ ] Confirm invalid provider configuration reports the failing field or next step clearly.
- [ ] Confirm provider removal or reset leaves the UI in a consistent state.
- [ ] If local/private providers are tested, confirm network and unsafe-mode warnings match the selected capability.

## 4. Project and worktree workflows

- [ ] Add a small demo project from a clean path.
- [ ] Open the project and confirm the expected worktree appears.
- [ ] Switch between at least two available worktrees, or confirm the single-worktree empty state is clear.
- [ ] Try adding a missing or invalid project path and confirm the error explains how to recover.
- [ ] Close or remove the project from the app and confirm it can be reopened without stale state.
- [ ] Confirm no UI labels, logs, or exported diagnostics expose unrelated personal paths.

## 5. Agent threads

- [ ] Create a new agent thread with a simple prompt against a demo project.
- [ ] Confirm streamed status, messages, tool activity, and completion state update without manual refresh.
- [ ] Stop a running thread and confirm the UI reports the stopped state.
- [ ] Resume or continue a prior thread if supported by the selected provider/runtime.
- [ ] Open an older thread and confirm transcript, status, and related project context load correctly.
- [ ] Confirm failures from missing providers, denied permissions, or runtime errors include next-step guidance.

## 6. Diff review

- [ ] Create or use a small text-file change and confirm the diff view displays additions and deletions correctly.
- [ ] Review a larger generated/demo diff and confirm the UI remains responsive.
- [ ] Check binary, renamed, deleted, and conflict-like files when available.
- [ ] Confirm staging/review actions, if used, affect only the intended files.
- [ ] Confirm diff errors do not expose secrets, private paths, or provider credentials.

## 7. Cron jobs

- [ ] Create a disabled cron job with a simple demo prompt and schedule.
- [ ] Edit the schedule, title, prompt, model, or permissions and confirm saved values persist after reload.
- [ ] Use run-now if available and confirm a run thread is created or a clear error is shown.
- [ ] Enable and then disable the cron job, confirming no stale run status remains.
- [ ] Delete the cron job or mark it inactive, then confirm it no longer appears in active lists.
- [ ] Confirm cron logs and run transcripts do not expose secrets or unrelated machine paths.

## 8. Plugins

- [ ] Discover an installed demo plugin or install one from a safe local fixture.
- [ ] Review the plugin manifest, permissions, settings, and warnings before approval.
- [ ] Approve the plugin and confirm only the granted capabilities are active.
- [ ] Change plugin settings and confirm saved values persist after navigating away and back.
- [ ] Disable the plugin and confirm related tools, commands, or providers become unavailable.
- [ ] Reset plugin data if supported and confirm the UI explains what was removed.
- [ ] Exercise a plugin failure path and confirm errors are contained to the plugin with clear recovery guidance.

## 9. Settings and diagnostics

- [ ] Open every settings section relevant to the tested mode.
- [ ] Confirm secret or sensitive fields distinguish masked display values from editable replacement values.
- [ ] Export diagnostics if supported and inspect the archive/output for provider keys, recovery codes, session tokens, private file contents, and unrelated local paths.
- [ ] Confirm unsafe-mode warnings are visible, specific to the risky action, and not hidden behind hover-only UI.
- [ ] Confirm changes made in settings survive reload when they should, and revert/clear when reset is selected.

## 10. Accessibility and responsive smoke checks

- [ ] Navigate primary workflows with the keyboard only.
- [ ] Confirm visible focus is present on interactive controls.
- [ ] Confirm dialogs, menus, and popovers can be opened and dismissed by keyboard.
- [ ] Check the main workflows at a narrow viewport and at normal desktop width.
- [ ] Confirm important status changes are available as text, not color alone.

## 11. Wrap-up

- [ ] Record all failures with exact steps to reproduce, expected result, actual result, screenshots with safe demo data, and logs with secrets redacted.
- [ ] Re-run any failed check after a fix and record the verifying commit.
- [ ] Confirm no temporary demo cron jobs, projects, providers, plugins, screenshots, or diagnostics remain in the release workspace unless intentionally kept as fixtures.
