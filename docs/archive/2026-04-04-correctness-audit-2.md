# Correctness Audit Follow-up, 2026-04-04

## Summary

This is a fresh full-codebase correctness pass over the current repository state. The older docs in `docs/` were treated as historical context only; this review re-read the current UI, backend, and sidecar code instead of assuming earlier findings still applied.

Baseline verification for the current tree:

- `bun test` passed.
- `bun run typecheck` passed.
- `bun run build:dev` passed.

The remaining issues are behavioral and sequencing bugs rather than build or type failures. The highest-signal current gaps are:

1. project lifecycle transitions are not serialized, so stale open results can overwrite a newer close
2. `runProjectTask(...)` can leak empty threads when task definitions change underneath the UI
3. the security audit panel can stay stuck on stale scope data after a filter/selection change during load
4. post-login RPC bootstrap still fails on the first transient transport error
5. sidecar thread-metadata writes can diverge from the live app when the best-effort refresh path drops

## Verification

Commands run during this audit:

- `bun test`
- `bun run typecheck`
- `bun run build:dev`

## Findings At A Glance

| Severity | Area | Finding |
| --- | --- | --- |
| High | Project lifecycle UI | Project open/close transitions are not serialized |
| High | Task execution | `runProjectTask(...)` leaks empty threads on stale task definitions |
| Medium | Security audit UI | Scope changes can leave the panel on stale results |
| Medium | Auth bootstrap | Fresh login/recovery flows still fail on the first transient RPC connect error |
| Medium | Sidecar/app sync | Sidecar metadata writes can diverge from live app state |

## Detailed Findings

### 1. High: Project lifecycle transitions are not serialized

Relevant code:

- `src/mainview/App.tsx:1434-1455`
- `src/mainview/App.tsx:3890-3965`

What is happening:

- Expanding a project with cached worktrees starts a fire-and-forget `openProject(...)` call and applies its result unconditionally when it resolves.
- Closing the same project does not invalidate or guard that in-flight open request.
- Separate in-flight `listProjectWorktrees(...)` refreshes also write `worktrees` and clear errors without checking whether a newer collapse/close transition already won.

Why this is a correctness problem:

- A project the user just collapsed can pop back open when the earlier expand request resolves late.
- Late refresh results can repopulate worktrees and clear error state after the UI already committed the project to a closed state.
- The worktree toggle paths have request-identity guards, but the project open/close path does not, so lifecycle state is still race-prone at the project level.

Recommended fix:

- Add a per-project transition/request token for expand, close, and worktree-list refreshes.
- Ignore or cancel late `openProject(...)` / `listProjectWorktrees(...)` results once a newer project transition starts.
- Add a regression test for expand-then-immediate-close ordering.

### 2. High: `runProjectTask(...)` leaks empty threads on stale task definitions

Relevant code:

- `src/bun/project-procedures.ts:3024-3089`
- `src/bun/project-procedures/project-tasks.ts:534-627`
- `src/mainview/App.tsx:3780-3837`

What is happening:

- When the user runs a task without an already-selected thread, the backend creates a brand-new thread before validating the selected task payload against the current filesystem.
- The script-task path validates `package.json` and script existence after thread creation.
- The file-task path validates task-file existence and contents after thread creation.
- If those validations fail because `.tasks` or `package.json` changed since the UI loaded the task list, the RPC throws and the frontend only surfaces an error banner.

Why this is a correctness problem:

- The newly created thread is never queued, never selected, and never rolled back.
- Because the failure path in the UI does not reload the thread list, the orphan thread can remain hidden until a later refresh or reload.
- Repeated stale task clicks can silently accumulate empty threads and pollute restore order, pinned ordering, and thread catalogs.

Recommended fix:

- Fully validate/resolve the task target before creating a new thread.
- If a new thread must be created first, roll it back on every validation or queueing failure before returning the error.
- Add coverage for stale `.tasks` files and stale `package.json` scripts between list and run.

### 3. Medium: Security audit scope changes can leave the panel on stale results

Relevant code:

- `src/mainview/App.tsx:573-619`
- `src/mainview/app/security-audit-panel.tsx:125-149`

What is happening:

- The panel tracks `lastRefreshKeyRef` and updates it before each scoped refresh attempt.
- `refreshSecurityAuditEvents(...)` returns immediately when another audit load is already in flight.
- If the user changes from `All` to `Project` or `Thread` while the previous request is still loading, the panel records the new refresh key but the actual request is skipped.
- Once the old request finishes, the effect sees the already-recorded key and does not issue the missing scoped reload.

Why this is a correctness problem:

- The panel can keep showing the previous scope's events even though the scope controls and selection context now indicate something else.
- The stale state persists until the 15-second timer fires or the user manually refreshes.

Recommended fix:

- Treat refresh requests as supersedable rather than drop-on-busy.
- Queue the latest requested scope while a request is in flight, or let newer scope changes cancel and replace the older request.
- Add a regression test for switching scope during the first load.

### 4. Medium: Fresh login and recovery flows still fail on the first transient RPC connect error

Relevant code:

- `src/mainview/auth-shell.tsx:260-282`
- `src/mainview/auth-shell.tsx:408-484`
- `src/mainview/auth-shell-connect.ts:29-87`

What is happening:

- The authenticated boot path correctly uses `connectRpcTransportWithRetry(...)`.
- The fresh login, recovery-code login, and post-setup recovery-continue paths still call `connectRpcTransport()` directly.
- If auth succeeds but the first websocket-ticket or socket connect attempt fails transiently, the catch block treats that transport failure like a login failure.

Why this is a correctness problem:

- The user can already be authenticated server-side while the UI remains on the login/recovery screen with an error message.
- This is more fragile than the ordinary authenticated-boot path and creates inconsistent behavior depending on how the session was established.
- There is no automatic retry on the most common "just logged in" transition.

Recommended fix:

- Reuse `connectRpcTransportWithRetry(...)` for every successful auth transition, not just existing-session boot.
- Alternatively, route all successful auth completions back through `loadGateState(...)` so there is one bootstrap path.
- Add regression coverage for a transient connect failure after successful login and recovery-code login.

### 5. Medium: Sidecar thread-metadata writes can diverge from the live app

Relevant code:

- `src/bun/codex-sidecar-mcp.ts:500-571`
- `src/bun/project-procedures.ts:680-695`
- `src/mainview/App.tsx:3608-3643`

What is happening:

- `modify_thread` writes thread title/summary/pin state directly into SQLite from the sidecar process and immediately returns success.
- The sidecar then tries to refresh the live app by firing background `renameThread(...)` / `setThreadPinned(...)` RPC calls with a 1.5 second timeout.
- Those refresh RPC failures are swallowed silently.
- The main app only polls thread state continuously while there are working threads, and backend thread-detail cache invalidation is normally driven by the RPC mutation path.

Why this is a correctness problem:

- If the RPC refresh times out during reconnect, load, or websocket churn, the database mutation succeeds but the live app can keep stale titles, summaries, or pin state.
- Selected-thread detail and list ordering can remain wrong until some unrelated activity invalidates caches or the app reloads.
- The sidecar reports success even when the visible app never catches up.

Recommended fix:

- Make RPC the authoritative mutation path for sidecar metadata changes, with direct DB writes only as a fallback that is surfaced explicitly.
- If local-first writes remain, add a reliable cache-invalidation/event path and surface refresh failures instead of swallowing them.
- Add a regression test for sidecar metadata updates while RPC refresh is temporarily unavailable.

Update on 2026-04-04:

- `modify_thread` now routes through a shared `updateThreadMetadata(...)` RPC mutation instead of writing SQLite first.
- Timeout and connection failures now fail the tool call instead of returning local-only success.
- Regression coverage now exercises both the sidecar helper failure path and the backend metadata procedure.

## Recommended Fix Order

1. Serialize project lifecycle transitions so stale open results cannot overwrite newer close state.
2. Stop leaking empty threads from `runProjectTask(...)` when task definitions go stale.
3. Make fresh login/recovery connect paths use the same retry bootstrap as existing authenticated sessions.
4. Fix security-audit scope refresh supersession.
5. Rework sidecar metadata mutation synchronization so success means the live app actually updates.

## Notes

- This document is the current correctness snapshot from the additional April 4 pass.
- All five findings in this follow-up snapshot were addressed in code on 2026-04-04; use `agent-todo.md` for any newer active slices after this pass.
- The earlier docs remain useful historical context, but they should not be treated as an authoritative list of what is still broken now.
