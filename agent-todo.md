# Agent Todo

Source: `docs/2026-03-31-correctness-issues-2.md`

- [x] Fix `openOrCloseWorktree(...)` so async open/close results do not apply against stale captured state.
- [x] Add request ordering or cancellation for worktree open/close actions so slower responses cannot overwrite newer user selections.
- [x] Preserve explicit cancellation semantics for stopped Codex turns instead of persisting them as clean completions.
- [x] Harden task discovery and task watch target collection against symlink recursion and directory cycles.
- [x] Prevent closed projects from recreating backend pollers through active worktree sync.
- [x] Refresh cached git history for selected unopened worktrees so the UI cannot stay stale indefinitely.
- [x] Make commit diff loading abortable end to end, including hover preloads and shared pending diff requests.
- [x] Fix the dev mainview watcher so nested `src/mainview/**` files trigger rebuild and reload behavior.

Source: server request starvation follow-up

- [x] Task discovery cache: Replace synchronous on-demand `.tasks` and `package.json` scans with a cached snapshot plus watcher-driven invalidation so startup and worktree selection do not block the Bun server.
- [x] Activity persistence batching: Move thread/task activity writes behind a batched persistence queue or transaction-based flusher so streaming output does not compete with HTTP responses.
- [x] Foreground read protection: Stop starting unrelated background polling or cache warming from foreground read paths, and suspend background work while startup or worktree-open reads are in flight.
- [x] Git work preemption: Tighten the git scheduler so foreground startup and worktree reads can cancel or overtake background git work instead of waiting behind it.
- [x] Expensive request concurrency caps: Add explicit concurrency limits for worktree restore, git history refresh, task cache rebuilds, and diff loading so one client cannot saturate the shared process.
- Static server isolation: Split static asset and page serving from RPC/task execution so active tasks cannot starve `/`, `/index.js`, or other startup requests.
- [x] Overload telemetry: Add event-loop lag, pending RPC count, queued git work, task rebuild duration, and persistence latency metrics to `/health` and server logs.
- Starvation regression harness: Add a repeatable test or script that starts active tasks and verifies a second client can still load the app and complete core startup requests within a latency budget.
