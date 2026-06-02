# Backend Test Gap Audit — 2026-06-02

Scope: `src/bun/**` backend TypeScript files. This pass identifies public-readiness test gaps only; it does not claim every listed module is untested, because some are covered indirectly through higher-level procedure, RPC, plugin, or integration tests.

## Method

- Listed existing backend tests with `find src/bun -name '*test*'`.
- Compared non-test `src/bun/**/*.ts` files with directly paired `*.test.ts` files.
- Sampled high-risk unpaired files and adjacent test coverage to prioritize gaps that matter before publishing.

Snapshot from this pass:

- Non-test backend TypeScript files: 237.
- Directly unpaired non-test backend TypeScript files: 92.
- Existing backend test coverage is broad for auth, plugin runtime/capabilities, RPC transport/authz/validation, project procedures, cron scheduling/runners, git tools, terminal transport, security audit helpers, and core database behavior.

## Critical gaps to file or fill

### 1. Backend bootstrap and maintenance flags

Files: `src/bun/index.ts`, `src/bun/start.ts`, `src/bun/tls-config.ts`, `src/bun/dev-flows.ts`.

Why it matters: these paths are the first code new public users exercise. They parse flags/env, select TLS/WebSocket origin behavior, start runtime services, and handle destructive maintenance flows such as `--wipe-user-data`.

Suggested test slices:

- Add bootstrap tests for `--tls`, `METIDOS_TLS`, `METIDOS_PUBLIC_ORIGIN`, and `METIDOS_ALLOWED_WS_ORIGINS` normalization.
- Add a non-destructive `--wipe-user-data` confirmation test that proves cancellation leaves app-data files intact and confirmation targets only documented Metidos data paths.
- Add startup tests that verify `start.ts` clears display env vars by default but preserves them when `METIDOS_BACKEND_NATIVE_CLIPBOARD=1`.

### 2. Terminal and local-operator RPC handler coverage

Files: `src/bun/rpc-handlers/terminal.ts`, `src/bun/pi/metidos/terminal.ts`, `src/bun/terminal-manager.ts`, `src/bun/terminal-pty-bridge.cjs`.

Why it matters: terminal access is high-risk because it bridges browser RPC state to local process execution. Existing terminal manager, PTY bridge, and websocket auth tests are useful, but the RPC-handler/metidos-tool seams should explicitly prove authorization, workspace scoping, and safe error text.

Suggested test slices:

- Add handler-level tests for terminal creation/list/stop flows with unauthorized, non-local-operator, and deleted worktree contexts.
- Add tests that terminal tool calls reject paths outside the selected workspace and redact host-only implementation details from failures.

### 3. Calendar notification and permission seams

Files: `src/bun/calendar/notifications.ts`, `src/bun/calendar/permissions.ts`, `src/bun/project-procedures/calendar-procedures.ts`, `src/bun/rpc-handlers/calendar.ts`, `src/bun/pi/metidos/calendar.ts`.

Why it matters: recurrence/store/export coverage exists, but reminder delivery and permission decisions are user-visible and sensitive. Public users need confidence that calendar data is scoped and notification side effects are predictable.

Suggested test slices:

- Add permission tests for user-owned versus userless calendar events and RPC contexts.
- Add notification tests for due-window selection, duplicate suppression, disabled notification outlets, and safe handling of missing users/projects.
- Add RPC handler tests proving calendar methods delegate through the same auth/permission gates as project procedures.

### 4. Pi-native Metidos tool wrappers

Files: `src/bun/pi/metidos/thread.ts`, `src/bun/pi/metidos/cron.ts`, `src/bun/pi/metidos/notifications.ts`, `src/bun/pi/metidos/model-discovery.ts`, `src/bun/pi/metidos/permission-normalization.ts`, `src/bun/pi/metidos/targeting.ts`.

Why it matters: these wrappers expose Metidos actions to agents and cron runs. `src/bun/pi/metidos/tools.test.ts` covers shared registration shape, but the individual wrappers should lock down target resolution, permission normalization, unsafe escalation requests, and local-operator-only mutations.

Suggested test slices:

- Add unit tests for permission normalization and targeting edge cases, including quoted IDs, missing projects/worktrees, and disabled cron targets.
- Add tool-wrapper tests for child thread/cron creation permission checks, unsafe-mode escalation denial in safe contexts, and deterministic error messages.
- Add notification tool tests for provider selection, missing provider settings, and redaction of secret values.

### 5. Persistence adapter boundary tests

Files: `src/bun/thread-store.ts`, `src/bun/message-activity-store.ts`, `src/bun/cron-store.ts`, `src/bun/thread-status-coalescer.ts`, `src/bun/user-notifications.ts`.

Why it matters: several adapters are intentionally thin wrappers over `db.ts`, but they define domain boundaries used by RPC procedures, cron runners, and runtime resume. Tests should prevent accidental scope, transaction, or status-regression changes while refactoring.

Suggested test slices:

- Add direct store tests proving bound stores use the supplied singleton database handle and preserve expected transaction behavior.
- Add cron-store tests for `listDueScheduledJobIds` around in-progress runs, active cron threads, disabled/deleted jobs, and stale `last_run_date` values.
- Add thread status coalescer tests for failed/stopped/in-progress transitions and error-seen behavior.

## Agent TODO updates

The broad TODO item “Identify critical backend tests missing before public release” is complete for this pass. Follow-up work should use the concrete test slices above instead of repeating another broad inventory.
