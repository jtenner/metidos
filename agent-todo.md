# Agent TODO

Source audit:

- [frontend performance inventory](/home/jtenner/Projects/jt-ide/docs/2026-04-04-frontend-performance-inventory.md)
- [frontend feedback inventory](/home/jtenner/Projects/jt-ide/docs/2026-04-04-frontend-feedback-inventory.md)

Goal

Prioritize visual responsiveness and performance across the main UI. The bias is:

1. Make the UI feel faster immediately.
2. Reduce main-thread work and GC churn.
3. Reduce unnecessary network and invalidation churn.
4. Only then take on deeper architectural changes.

Status legend

- `todo`: not started
- `active`: currently being worked
- `blocked`: needs a design or backend decision
- `done`: landed

## Priority 0: Easy Wins With Low Regression Risk

### Slice P0.1: Fix weak memoization in model selector

Status: `done`

Problem:
- `groupCodexModels(models)` is recomputed every render, which weakens downstream memoization and keeps filtered model groups hot even when nothing meaningful changed.

Primary files:
- `src/mainview/controls/codex-model-selector.tsx`
- `src/mainview/controls/codex-utils.ts`

Scope:
- Memoize grouped model data.
- Consider memoizing `modelById` and reasoning-effort lookup maps.
- Verify open dropdown behavior still resets search/expanded state correctly.

Done when:
- Model grouping/filtering no longer recomputes on unrelated parent rerenders.

### Slice P0.2: Memoize diff stats and parsed diff lines

Status: `done`

Problem:
- Diff stats and unified-diff line parsing are recalculated on every render for the same `diffText`.

Primary files:
- `src/mainview/app/diff-workspace.tsx`
- `src/mainview/app/message-ui.tsx`

Scope:
- Wrap diff stat computation in `useMemo`.
- Memoize parsed diff lines by `diffText`.
- Avoid changing current visual behavior.

Done when:
- Reopening or rerendering the same diff does not reparse or resummarize it unless `diffText` changed.

### Slice P0.3: Remove or throttle thread preview `onMouseMove` churn

Status: `done`

Problem:
- Thread summary previews do layout reads and state updates on every mouse move.

Primary files:
- `src/mainview/app/use-thread-previews.ts`

Scope:
- Prefer `mouseenter`/`focus` only, or throttle mouse-move repositioning to one update per animation frame.
- Preserve keyboard accessibility and current desktop-only behavior.

Done when:
- Hovering thread rows no longer causes repeated React state churn per pointer move.

### Slice P0.4: Make security-audit payload formatting lazy

Status: `done`

Problem:
- The security panel stringifies payload JSON during row render even when details remain collapsed.

Primary files:
- `src/mainview/app/security-audit-panel.tsx`

Scope:
- Only stringify payloads after the row is expanded.
- Keep event-summary rendering unchanged.

Done when:
- Closed audit rows do not eagerly stringify payload JSON.

### Slice P0.5: Reuse shared `Intl.DateTimeFormat` instances

Status: `todo`

Problem:
- Date formatting happens in hot render paths and currently constructs formatting logic repeatedly through `toLocaleString()` or `Intl.DateTimeFormat` in multiple places.

Primary files:
- `src/mainview/app/state.ts`
- `src/mainview/app/security-audit-panel.tsx`
- `src/mainview/auth-shell.tsx`

Scope:
- Introduce reusable formatters for git history, auth timestamps, and audit timestamps.
- Keep output identical or intentionally equivalent.

Done when:
- Hot-path date formatting uses stable formatter instances instead of ad hoc locale formatting calls.

### Slice P0.6: Debounce persisted UI-state writes

Status: `todo`

Problem:
- Persisted mainview state writes happen eagerly as selection/open-worktree state changes.

Primary files:
- `src/mainview/App.tsx`
- `src/mainview/app/state.ts`

Scope:
- Debounce `writePersistedMainviewState(...)`.
- Keep unload safety acceptable.
- Avoid breaking restore correctness.

Done when:
- Rapid selection changes do not spam local storage writes.

## Priority 1: High-Impact Rendering And Data-Structure Work

### Slice P1.1: Build shared lookup maps for projects, threads, and worktrees

Status: `todo`

Problem:
- Render paths repeatedly use `find` and `some` for metadata lookups.

Primary files:
- `src/mainview/app/use-mainview-derived-state.ts`
- `src/mainview/app/thread-list-row.tsx`
- `src/mainview/app/projects-panel.tsx`

Scope:
- Build `projectById`.
- Build `threadById`.
- Build `worktreeByProjectAndPath`.
- Thread these through row renderers instead of raw arrays where useful.

Done when:
- Thread and worktree rows no longer do repeated array scans for stable metadata.

### Slice P1.2: Stop full re-sort churn on every thread mutation

Status: `todo`

Problem:
- `upsertThreadList()` filters, pushes, and re-sorts the whole thread list for many mutations.

Primary files:
- `src/mainview/app/state.ts`
- `src/mainview/App.tsx`

Scope:
- Replace thread-array update strategy with something more incremental.
- Options:
- Maintain `Map<number, RpcThread>` plus sorted ids.
- Keep array storage but use targeted index replacement/reinsertion.
- Skip resort when sort keys have not changed.

Done when:
- Common thread mutations do not require rebuilding and resorting the entire thread collection.

### Slice P1.3: Reduce repeated project-worktree ordering/filtering in projects panel

Status: `todo`

Problem:
- Project rows and pinned sections repeatedly sort and refilter the same worktree data.

Primary files:
- `src/mainview/app/projects-panel.tsx`
- `src/mainview/app/state.ts`

Scope:
- Precompute ordered worktrees once per project.
- Partition pinned and unpinned worktrees once.
- Cache search/display tokens for worktrees.

Done when:
- A single render pass computes per-project worktree ordering/filtering once.

### Slice P1.4: Precompute sidebar search tokens

Status: `todo`

Problem:
- Sidebar filtering repeatedly formats paths and scans worktrees for every keystroke and rerender.

Primary files:
- `src/mainview/app/use-mainview-derived-state.ts`
- `src/mainview/app/projects-panel.tsx`
- `src/mainview/controls/search-utils.ts`

Scope:
- Precompute normalized searchable strings for projects and worktrees.
- Reuse those strings during filtering.

Done when:
- Sidebar search avoids repeated path formatting and redundant normalization inside filter loops.

### Slice P1.5: Sort workspace threads once, then partition

Status: `todo`

Problem:
- Pinned and recent workspace thread sections each sort independently.

Primary files:
- `src/mainview/app/use-mainview-derived-state.ts`

Scope:
- Sort once.
- Partition pinned vs unpinned from the sorted result.

Done when:
- Workspace-thread derivation does one sort pass instead of two.

## Priority 2: Transcript, Chat, And Diff Pipeline Optimization

### Slice P2.1: Cache visible-message view models

Status: `todo`

Problem:
- `threadMessages` are remapped into fresh `VisibleMessage` objects on each relevant render.

Primary files:
- `src/mainview/App.tsx`

Scope:
- Add a stable view-model cache keyed by message id and message state.
- Preserve the special synthetic rows for loading, processing, errors, and notices.

Done when:
- Unchanged transcript messages keep stable object identity across unrelated rerenders.

### Slice P2.2: Add append-only fast path to thread message merging

Status: `todo`

Problem:
- `mergeThreadMessageHistory()` rebuilds a `Map` and sorts the whole message set even when incoming messages are strictly newer.

Primary files:
- `src/mainview/App.tsx`

Scope:
- Detect monotonic append cases.
- Fall back to full merge only when ids overlap or arrive out of order.

Done when:
- Normal streamed/append transcript updates avoid full-history merge work.

### Slice P2.3: Make transcript grouping incremental

Status: `todo`

Problem:
- Grouping visible messages into assistant/user blocks still walks the whole message list before virtualization.

Primary files:
- `src/mainview/app/chat-workspace.tsx`

Scope:
- Keep immutable grouped prefix and mutable tail, or otherwise cache grouping by thread id and last message id.
- Preserve current grouping semantics exactly.

Done when:
- Adding a new message to a long thread does not regroup the entire transcript from scratch.

### Slice P2.4: Memoize markdown rendering per message

Status: `todo`

Problem:
- Visible markdown/code-heavy assistant messages can still be expensive to rerender.

Primary files:
- `src/mainview/app/message-ui.tsx`
- `src/mainview/app/chat-workspace.tsx`

Scope:
- Memoize markdown renderers at the message component level.
- Ensure unchanged message text does not rerender markdown trees unnecessarily.

Done when:
- Scroll or nearby UI state changes do not rerender markdown for unchanged visible messages.

### Slice P2.5: Defer or gate syntax highlighting

Status: `todo`

Problem:
- Prism highlighting is expensive for large code blocks and is loaded/rendered eagerly for visible code fences.

Primary files:
- `src/mainview/app/message-ui.tsx`

Scope:
- Options:
- Lazy-load syntax highlighting.
- Only highlight expanded code blocks.
- Add a size threshold where huge blocks fall back to plain text.

Done when:
- Large code-heavy responses no longer produce obvious main-thread stalls during initial render.

### Slice P2.6: Virtualize large diff content

Status: `todo`

Problem:
- `DiffViewer` still renders all parsed diff lines once the diff is opened.

Primary files:
- `src/mainview/app/message-ui.tsx`

Scope:
- Add line virtualization for large diffs.
- Keep small diffs on the simpler render path.

Done when:
- Very large file diffs and commit diffs remain responsive while scrolling.

### Slice P2.7: Avoid unnecessary diff-file patch reloads on background snapshot refresh

Status: `todo`

Problem:
- Background snapshot refresh can cascade into focused-file patch reloads more often than necessary.

Primary files:
- `src/mainview/app/use-worktree-diff.ts`

Scope:
- Only reload selected patch when selected file content or change metadata actually changed.
- Prefer hash/version checks when available.

Done when:
- Background diff polling does not churn the focused patch pane when the selected file is unchanged.

## Priority 3: Polling, Network, And Invalidation Strategy

### Slice P3.1: Narrow thread-status polling

Status: `todo`

Problem:
- Current thread polling refreshes the whole thread list, then may fetch selected-thread detail too.

Primary files:
- `src/mainview/App.tsx`
- `src/bun/project-procedures.ts`
- `src/bun/rpc-schema.ts`

Scope:
- Add a smaller status-oriented endpoint for working threads or changed threads.
- Keep full detail refresh only for the selected active thread when needed.

Done when:
- Thread polling no longer requires whole-list summary refresh in the common case.

### Slice P3.2: Push thread-run state updates over websocket

Status: `blocked`

Problem:
- Thread run-state changes are still primarily poll-driven.

Primary files:
- `src/mainview/index.ts`
- `src/mainview/App.tsx`
- `src/bun/index.ts`
- `src/bun/project-procedures.ts`
- `src/bun/rpc-schema.ts`

Scope:
- Emit targeted thread status/change notifications from the backend.
- Apply them incrementally on the frontend.

Done when:
- The frontend can react to thread status changes without polling whole thread lists on an interval.

### Slice P3.3: Push diff invalidation instead of polling snapshots

Status: `blocked`

Problem:
- Diff view still polls worktree snapshots every 2.5 seconds while visible.

Primary files:
- `src/mainview/app/use-worktree-diff.ts`
- `src/mainview/index.ts`
- `src/bun/project-procedures.ts`
- `src/bun/index.ts`

Scope:
- Emit worktree-dirty or diff-invalidated events from the backend.
- Refresh only when the selected worktree actually changed.

Done when:
- Visible diff state refreshes because the backend reported a change, not because the frontend polls constantly.

### Slice P3.4: Coalesce websocket invalidation fan-out

Status: `todo`

Problem:
- Websocket messages are parsed and then immediately re-emitted as DOM `CustomEvent`s.

Primary files:
- `src/mainview/index.ts`
- `src/mainview/App.tsx`

Scope:
- Consider an internal subscription layer instead of DOM event fan-out.
- Batch repeated same-worktree invalidations on the same tick.

Done when:
- Bursty backend invalidations do not cause repeated immediate event dispatch and redundant refresh work.

### Slice P3.5: Revisit project action menu background refresh policy

Status: `todo`

Problem:
- Opening the project action menu triggers a background worktree refresh even when data may already be fresh enough.

Primary files:
- `src/mainview/App.tsx`

Scope:
- Add freshness timestamps or other heuristics.
- Skip refresh when the cached worktree list is recent and complete.

Done when:
- Reopening project menus does not cause unnecessary background worktree fetches.

## Priority 4: Startup, Bundle, And Main-Thread Smoothness

### Slice P4.1: Lazy-load heavy transcript rendering dependencies

Status: `todo`

Problem:
- `react-markdown`, Prism highlighter, and related code are part of the upfront UI cost.

Primary files:
- `src/mainview/app/message-ui.tsx`
- `src/mainview/index.ts`

Scope:
- Split heavy markdown/highlighting paths.
- Keep simple text/chat states fast on first load.

Done when:
- Initial UI load does not eagerly pay for the heaviest transcript-rendering dependencies.

### Slice P4.2: Revisit transcript measurement churn

Status: `todo`

Problem:
- Transcript virtualization still depends on variable-height measurement for markdown/code-heavy rows.

Primary files:
- `src/mainview/app/chat-workspace.tsx`

Scope:
- Profile `measureElement` churn.
- Consider caching measured heights by message key and invalidating only when content changes.

Done when:
- Long chat transcripts with code blocks do not show repeated measurement-heavy layout work during ordinary rerenders.

### Slice P4.3: Virtualize security-audit rows if the list grows

Status: `todo`

Problem:
- Security audit currently renders the full visible list into one scroll container.

Primary files:
- `src/mainview/app/security-audit-panel.tsx`

Scope:
- Add row virtualization if audit history size grows beyond current expectations.
- Preserve current row UX and details expansion behavior.

Done when:
- Large audit histories remain responsive to scroll and filter changes.

### Slice P4.4: Cache path-display formatting for hot UI surfaces

Status: `todo`

Problem:
- `formatPathForDisplay()` is called often in thread rows, project rows, git history, tasks, and workspace chrome.

Primary files:
- `src/mainview/app/state.ts`
- `src/mainview/app/projects-panel.tsx`
- `src/mainview/app/thread-list-row.tsx`

Scope:
- Add memoized formatting or preformatted display strings where repeated path rendering is hot.

Done when:
- The same path/home-directory pairs are not reformatted repeatedly in hot list renders.

## Priority 5: Profile-First Or Architectural Work

### Slice P5.1: Workerize large diff parsing

Status: `todo`

Problem:
- Large commit diffs or file diffs can still be expensive even after memoization.

Primary files:
- `src/mainview/app/message-ui.tsx`
- `src/mainview/app/diff-workspace.tsx`

Scope:
- Move large-diff parsing and summarization to a web worker if profiling shows meaningful main-thread stalls.

Done when:
- Large diffs no longer monopolize the main thread during parse/prepare.

### Slice P5.2: Workerize markdown/code preprocessing for huge assistant responses

Status: `todo`

Problem:
- Markdown and code-heavy assistant output can still be expensive for the main thread.

Primary files:
- `src/mainview/app/message-ui.tsx`
- `src/mainview/app/chat-workspace.tsx`

Scope:
- Only pursue after profiling.
- Consider preprocessing tokens/AST fragments off-thread for very large messages.

Done when:
- Extremely large assistant responses no longer cause visible interaction stalls.

### Slice P5.3: Rework frontend state shape around indexed stores

Status: `blocked`

Problem:
- The app still uses array-of-records structures in many places where indexed stores would cut lookup and update churn.

Primary files:
- `src/mainview/App.tsx`
- `src/mainview/app/use-mainview-derived-state.ts`
- `src/mainview/app/state.ts`

Scope:
- Replace broad array scanning with indexed state primitives for threads/projects/worktrees.
- Only do this after smaller structural wins have landed and profiling justifies the migration.

Done when:
- Core collections can update incrementally without repeated full-array scans and resorts.

## Cross-Cutting Guardrails

Every slice above should preserve:

- feedback correctness from [frontend feedback inventory](/home/jtenner/Projects/jt-ide/docs/2026-04-04-frontend-feedback-inventory.md)
- cancellation and stale-request safety
- keyboard accessibility
- current mobile/desktop behavior unless the change is intentional

Every performance change should measure at least one of:

- reduced rerender count
- reduced sort/filter/parse count
- reduced allocations
- reduced layout measurement count
- reduced background requests/polls
- improved time-to-visible-update for the user

## Suggested Execution Order

### Phase 1: Immediate responsiveness wins

1. Slice P0.1
2. Slice P0.2
3. Slice P0.3
4. Slice P0.4
5. Slice P0.5
6. Slice P0.6

### Phase 2: Highest-payoff render/data fixes

1. Slice P1.1
2. Slice P1.2
3. Slice P1.3
4. Slice P1.4
5. Slice P1.5

### Phase 3: Transcript and diff heavy-path work

1. Slice P2.1
2. Slice P2.2
3. Slice P2.3
4. Slice P2.4
5. Slice P2.5
6. Slice P2.6
7. Slice P2.7

### Phase 4: Network and invalidation strategy

1. Slice P3.1
2. Slice P3.4
3. Slice P3.5
4. Slice P3.2
5. Slice P3.3

### Phase 5: Larger structural bets

1. Slice P4.1
2. Slice P4.2
3. Slice P4.3
4. Slice P4.4
5. Slice P5.1
6. Slice P5.2
7. Slice P5.3

## First Five Recommended Implementation Targets

If work starts now, the best first five slices are:

1. Slice P0.1
2. Slice P0.3
3. Slice P0.2
4. Slice P1.1
5. Slice P1.2

Reasoning:

- They improve responsiveness quickly.
- They are local enough to land safely.
- They unlock cleaner follow-up work in transcript, sidebar, and thread update paths.
