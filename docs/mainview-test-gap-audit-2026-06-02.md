# Mainview Test Gap Audit — 2026-06-02

## Scope

This audit identifies critical `src/mainview` regression-test gaps that should be closed before a public repository launch. It is intentionally limited to actionable test follow-ups; it does not assert that unlisted modules are fully covered.

Inspection performed on the current checkout:

- Reviewed the existing `src/mainview/app`, `src/mainview/controls`, and root-level mainview test files.
- Compared focused helper/controller test coverage against high-risk user flows described in `src/mainview/app/README.md`.
- Prioritized gaps that could expose private data, break first-run usability, or make critical operator workflows difficult for outside contributors to validate.

Existing coverage is strongest around pure state helpers, transcript/message processing, plugin settings state, diff parsing, project/worktree ordering, auth client behavior, startup restore, thread sending, and selected hook/controller seams.

## Critical gaps to close

### 1. Mainview shell navigation and workspace composition

Relevant modules include `src/mainview/App.tsx`, `src/mainview/app/workspace-panel.tsx`, `src/mainview/app/sidebar-content.tsx`, `src/mainview/app/desktop-sidebar.tsx`, `src/mainview/app/desktop-sidebar-content.tsx`, `src/mainview/app/threads-panel.tsx`, `src/mainview/app/thread-list-row.tsx`, and `src/mainview/app/pinned-threads-panel.tsx`.

Add integration-style tests with fake projects, worktrees, threads, and status rows covering:

- Switching between project, worktree, thread, diff, git history, cron, calendar, plugin, terminal, and settings surfaces without losing selected context.
- Pinned and recent-thread sidebar rows preserving readable labels, selected state, and busy/error indicators.
- Mobile/sidebar drawer and desktop sidebar variants exposing the same critical navigation affordances.
- Empty states for no projects, no worktrees, no threads, and unavailable workspace context.

Acceptance criteria: tests use fake data only, do not depend on a real filesystem repository, and assert user-visible labels/states rather than private implementation details where practical.

### 2. Cron workspace controller and mutation UI

Relevant modules include `src/mainview/app/mainview-cron-workspace-controller.tsx`, `src/mainview/app/cronjob-workspace.tsx`, and supporting cron run/load state helpers in `src/mainview/cronjob-load-state.ts` and `src/mainview/cronjob-run-state.ts`.

Add tests covering:

- Refresh/list invalidation after cron create, edit, delete, disable, and run-now actions.
- Busy-state isolation so one cron mutation does not disable unrelated rows unnecessarily.
- Safe handling of failed mutations, including actionable error text and retry-ready state.
- Permission/workspace summaries rendered from fake thread access data.

Acceptance criteria: tests mock RPC calls and websocket invalidation events, assert no real cron jobs are created, and verify both successful and failed mutation paths.

### 3. Terminal workspace safety and local-operator affordances — closed 2026-06-03

Relevant modules include `src/mainview/app/terminal-workspace.tsx` and `src/mainview/app/use-terminals-controller.ts`.

This gap is covered by `src/mainview/app/terminal-workspace.test.tsx` and `src/mainview/app/use-terminals-controller.test.tsx`. The completed coverage uses fake terminal session payloads and verifies:

- No-worktree and enabled empty states, including disabled/enabled create affordances.
- Renderer loading and failed states through a static seam that does not load `ghostty-web`.
- Starting, running, closing, exited, and error status summaries for terminal rows.
- Unsafe/local-operator warnings next to terminal actions.
- Terminal selection fallback/clearing and mode refresh behavior when sessions remain or disappear.
- Output summaries do not expose mocked command/output data.
- Non-admin users cannot list or build create requests for terminals, while admin requests are constructed from fake payloads.

Acceptance criteria status: closed; future terminal test work should be filed as a specific regression or feature gap rather than as this broad audit item.

### 4. Thread composer/controller flows around permissions, attachments, and turn lifecycle

Relevant modules include `src/mainview/app/use-thread-turn-controller.ts`, `src/mainview/app/use-thread-settings-controller.ts`, `src/mainview/app/thread-start-request-dialog.tsx`, `src/mainview/controls/thread-access-control.tsx`, `src/mainview/controls/chat-composer-image-attachments.ts`, `src/mainview/controls/chat-composer-skills.ts`, and `src/mainview/controls/ContextUsageMeter.tsx`.

Add tests covering:

- Permission selection display and hidden/internal permission handling in the composer dialog.
- Image attachment add/remove/reject states using fake image metadata only.
- Skill selection display and disabled/unavailable skill states.
- Thread turn submission, cancellation/stopping, provider policy callout visibility, and failure recovery.
- Context usage meter boundary labels for low, near-limit, and over-limit states.

Acceptance criteria: tests avoid real provider calls and real user files, and assert that secrets/tokens are never rendered from mocked permission or attachment payloads.

### 5. Settings and plugin administration composition

Relevant modules include `src/mainview/app/settings-panel.tsx`, `src/mainview/app/use-plugin-administration-controller.ts`, and `src/mainview/app/plugin-administration-panel.tsx`.

There are focused tests for plugin administration rendering and state helpers, but the composed settings/controller flow still needs coverage for:

- Opening settings sections and preserving section selection across refreshes.
- Plugin inventory refresh, lifecycle action feedback, admin reset-data flow, ingress binding/route edits, and declared Plugin Settings save/clear-secret behavior when wired through the controller.
- Step-up authentication retry behavior for sensitive plugin actions.

Acceptance criteria: tests mock plugin RPC calls, use fake plugin manifests/settings, and verify sensitive stored-secret placeholders are not confused with real secret values.

### 6. Git history and diff modal end-to-end UI flow

Relevant modules include `src/mainview/app/git-history-panel.tsx`, `src/mainview/app/git-history-diff-modal.tsx`, and `src/mainview/app/use-worktree-diff.ts`.

Add tests covering:

- History loading, pagination, refresh, empty state, and failed fetch state.
- Opening a commit diff modal, loading diff details, closing the modal, and reopening without stale data.
- Worktree diff loading for small diffs, large diffs, binary files, deleted files, and renamed files using fake diff fixtures.

Acceptance criteria: tests use synthetic git history and diff payloads and validate that large/binary/private-looking paths render safely.

## Lower-priority follow-ups

These are useful but less release-critical than the gaps above:

- Add focused tests for `path-display-state.ts`, `directory-suggestion-state.ts`, `safe-external-url.ts`, `date-format.ts`, `sidebar-panels-state.ts`, and `visible-message-state.ts` if they start carrying more edge-case logic.
- Add simple smoke tests for presentational primitives in `src/mainview/controls` only when they encode behavior beyond styling.
- Consider a small mainview fixture builder to reduce duplicated fake project/worktree/thread/plugin payload setup across future tests.

## Suggested validation command

After adding any of the test slices above, run at least:

```sh
bun test src/mainview
```

For code changes that affect behavior outside test files, follow the repository commit skill: run `bun format` before `bun validate`.
