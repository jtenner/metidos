# Agent Todo

Source: `docs/2026-03-31-correctness-issues-2.md`

- [ ] Fix `openOrCloseWorktree(...)` so async open/close results do not apply against stale captured state.
- [ ] Add request ordering or cancellation for worktree open/close actions so slower responses cannot overwrite newer user selections.
- [ ] Preserve explicit cancellation semantics for stopped Codex turns instead of persisting them as clean completions.
- [x] Harden task discovery and task watch target collection against symlink recursion and directory cycles.
- [ ] Prevent closed projects from recreating backend pollers through active worktree sync.
- [ ] Refresh cached git history for selected unopened worktrees so the UI cannot stay stale indefinitely.
- [ ] Make commit diff loading abortable end to end, including hover preloads and shared pending diff requests.
- [x] Fix the dev mainview watcher so nested `src/mainview/**` files trigger rebuild and reload behavior.
