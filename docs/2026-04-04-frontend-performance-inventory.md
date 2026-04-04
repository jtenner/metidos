# Frontend Performance Inventory

Summary

The frontend already has some good performance structure: transcript virtualization, request deduping for several RPCs, scoped caches for tasks/git history/commit diffs, and aggressive request cancellation. The main remaining cost centers are repeated list scans in render paths, repeated sort/copy work on thread mutations, expensive transcript/diff remapping, hover-driven layout reads, and a few places where memoization is accidentally neutralized.

The highest-leverage opportunities are:

- precompute lookup maps for projects, worktrees, and threads instead of repeated `find`/`some` scans
- reduce thread-list sort/copy churn on every thread mutation and poll
- cache or offload diff/transcript parsing work that currently reallocates on every render
- replace polling-heavy thread refresh with narrower or push-based status updates

## Scope

This inventory focuses on:

- `src/mainview/*`
- adjacent runtime glue in `src/mainview/index.ts`

It does not try to profile Bun server internals in depth, except where frontend latency is directly affected.

## Prioritized Opportunities

| Priority | Area | Why it matters |
| --- | --- | --- |
| High | Thread/project/worktree lookup indexing | Current row renderers repeatedly scan arrays for metadata they use every render |
| High | Thread sort/copy churn | Many thread mutations rebuild and resort the full thread list |
| High | Transcript and diff remapping | Large threads/diffs create avoidable allocation and CPU churn |
| Medium | Polling and invalidation model | Thread status still refreshes by polling whole thread lists |
| Medium | Hover/layout churn | Some preview UI does layout reads on every pointer movement |
| Medium | Search/filter precomputation | Sidebar search repeatedly formats paths and scans worktrees |
| Low-Medium | Lazy formatting and event-bridge churn | A few panels stringify/dispatch eagerly when the data may never be opened |

## 1. Repeated Lookup Work In Render Paths

### 1.1 Thread rows repeatedly scan project and worktree arrays

Evidence:

- [thread-list-row.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/thread-list-row.tsx#L249)
- [thread-list-row.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/thread-list-row.tsx#L253)

Current behavior:

- Every rendered thread row does `projects.find(...)`
- Then it does `getProjectState(...).worktrees.find(...)`
- This happens in both the workspace thread list and the threads panel

Cost shape:

- `O(rendered_threads * (projects + worktrees_per_project))`
- Repeats on every sidebar rerender, even when the metadata set is unchanged

Likely improvements:

- Build `projectById` once with `useMemo`
- Build `worktreeByProjectAndPath` once with `useMemo`
- Pass compact metadata to `ThreadListRow` instead of the full `projects` array plus `getProjectState`

Expected impact:

- High in sidebars with many threads/worktrees
- Also reduces object graph traversal and React render cost

### 1.2 Project panel repeatedly sorts and filters worktrees during render

Evidence:

- [projects-panel.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/projects-panel.tsx#L295)
- [projects-panel.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/projects-panel.tsx#L525)

Current behavior:

- Pinned worktrees are built with `flatMap` + `orderProjectWorktrees` + `filter` + `map` + final `sort`
- Then each project row repeats `orderProjectWorktrees(...)`
- Then each ordered list is filtered again into pinned and unpinned buckets

Cost shape:

- Re-sorts the same per-project worktree arrays multiple times per render
- Re-runs path formatting and search matching repeatedly

Likely improvements:

- Precompute one `orderedWorktreesByProjectId`
- Partition pinned vs unpinned once per project
- Cache display/search tokens per worktree

Expected impact:

- Medium to high when many projects and worktrees are open

### 1.3 Sidebar project filtering recomputes formatted paths and scans every worktree

Evidence:

- [use-mainview-derived-state.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-mainview-derived-state.ts#L495)

Current behavior:

- Sidebar search calls `formatPathForDisplay(...)` repeatedly inside `projects.filter(...)`
- It also does `projectState.worktrees.some(...)` for every project on each query change and rerender

Likely improvements:

- Precompute normalized searchable strings for projects and worktrees
- Keep a lightweight search index per project/worktree
- Avoid repeated path formatting inside hot filter loops

Expected impact:

- Medium, especially while typing in the sidebar search box

## 2. Thread Mutation Churn

### 2.1 `upsertThreadList()` always filters, pushes, and re-sorts the entire thread list

Evidence:

- [state.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/state.ts#L1134)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L3116)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L3148)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L3922)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L3960)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L3995)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L4042)

Current behavior:

- Each thread update allocates a new filtered array
- Pushes the updated thread
- Sorts the entire result again

Why this matters:

- Thread updates happen often: polling, send completions, rename, pin/unpin, model changes, reasoning changes, unsafe-mode changes, task runs

Likely improvements:

- Maintain a `Map<number, RpcThread>` plus a separate sorted id list
- Use binary insertion or position repair instead of full re-sort
- At minimum, skip sorting if the updated thread’s sort keys did not change

Expected impact:

- High, because this path is reused across many interactions

### 2.2 Thread polling refreshes the whole thread list, then may fetch selected thread detail too

Evidence:

- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L2258)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L2261)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L2292)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L3863)

Current behavior:

- Every poll does `listThreads()`
- Then sorts the whole list
- Then scans for the selected thread
- Then may fetch `getThread()` for the selected thread anyway

Likely improvements:

- Add a narrower RPC for working-thread statuses only
- Push thread run-state changes over websocket instead of polling summaries
- Keep full `getThread()` refresh only for the selected working thread

Expected impact:

- High in long-running sessions or workspaces with many threads
- Also reduces network, CPU, and state churn

## 3. Transcript And Message Pipeline Costs

### 3.1 Visible transcript messages are remapped into new UI objects on every relevant render

Evidence:

- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L4484)
- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L4525)

Current behavior:

- `threadMessages` are converted into a fresh `VisibleMessage[]`
- Extra working/error/notice rows are appended
- This creates new objects for the whole visible transcript

Likely improvements:

- Cache per-message view models by message id and state hash
- Append-only fast path for streaming updates
- Keep static messages referentially stable when only the tail changes

Expected impact:

- High for long conversations
- Reduces GC churn and downstream rerender pressure

### 3.2 Grouping the transcript still walks the whole message list every time `messages` changes

Evidence:

- [chat-workspace.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/chat-workspace.tsx#L354)

Current behavior:

- `groupVisibleMessages(messages)` traverses the whole transcript before virtualization kicks in

Why this matters:

- Virtualization helps DOM cost, but not message-to-group transformation cost

Likely improvements:

- Incremental grouping keyed by thread id and last message id
- Separate immutable transcript prefix from mutable streaming tail

Expected impact:

- Medium to high on very long threads

### 3.3 Markdown and syntax highlighting remain expensive for visible transcript rows

Evidence:

- [message-ui.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/message-ui.tsx#L2)
- [message-ui.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/message-ui.tsx#L60)
- [chat-workspace.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/chat-workspace.tsx#L361)

Current behavior:

- Visible assistant text uses `react-markdown`
- Fenced code blocks use Prism syntax highlighting
- Any rerender of visible transcript rows re-runs that render path

Likely improvements:

- Memoize rendered markdown blocks per message id
- Skip syntax highlighting until a code block is expanded or visible
- Consider server-side or worker-side pretokenization for very large blocks

Expected impact:

- Medium, but spikes hard on code-heavy transcripts

### 3.4 Merging thread message history rebuilds a `Map` and resorts the whole message set

Evidence:

- [App.tsx](/home/jtenner/Projects/jt-ide/src/mainview/App.tsx#L126)

Current behavior:

- `mergeThreadMessageHistory()` allocates a `Map`
- Inserts both current and incoming messages
- Materializes and sorts the full result

Likely improvements:

- Use an append fast path when incoming ids are strictly newer
- Only fall back to the full merge path on out-of-order or replayed messages

Expected impact:

- Medium, especially during streamed or incremental thread updates

## 4. Diff Rendering And Snapshot Refresh Costs

### 4.1 Diff parsing is redone on every `DiffViewer` render

Evidence:

- [message-ui.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/message-ui.tsx#L202)
- [message-ui.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/message-ui.tsx#L297)

Current behavior:

- `parseUnifiedDiff(diffText)` splits the full diff and allocates one object per line every render

Likely improvements:

- Memoize parsed lines by `diffText`
- For large diffs, virtualize lines instead of rendering them all
- Consider worker-side parsing when commit diffs or file diffs get large

Expected impact:

- High for large diffs

### 4.2 Diff stats rescan the full patch every render

Evidence:

- [diff-workspace.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/diff-workspace.tsx#L117)
- [diff-workspace.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/diff-workspace.tsx#L262)

Current behavior:

- `summarizeDiffText()` rescans the entire diff text whenever `DiffWorkspace` renders

Likely improvements:

- Wrap `summarizeDiffText(diffText)` in `useMemo`
- Or compute stats together with parsed diff lines and cache both

Expected impact:

- Easy win, low complexity

### 4.3 Diff snapshot polling may do more foreground work than necessary

Evidence:

- [use-worktree-diff.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-worktree-diff.ts#L228)
- [use-worktree-diff.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-worktree-diff.ts#L276)

Current behavior:

- The diff view polls `getWorktreeSnapshot()`
- Background refresh can also trigger focused-file patch refreshes

Likely improvements:

- Push dirty-path invalidations from backend instead of polling snapshots
- Only refresh the selected file patch when the selected path actually changed
- Add stable hash/version checks so unchanged snapshots skip downstream updates

Expected impact:

- Medium, mostly noticeable in active diff sessions

## 5. Hover And Layout Churn

### 5.1 Thread summary preview does layout reads and state writes on every mouse move

Evidence:

- [use-thread-previews.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-thread-previews.ts#L128)
- [use-thread-previews.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-thread-previews.ts#L229)

Current behavior:

- `onMouseMove` calls `showThreadSummaryPreview(...)`
- That calls `getBoundingClientRect()` and then updates React state

Likely improvements:

- Remove `onMouseMove` entirely if `onMouseEnter` is good enough
- Or throttle it to `requestAnimationFrame`
- Or position via CSS anchor-like behavior instead of repeated JS measurement

Expected impact:

- Medium in dense thread lists
- Also reduces forced layout risk

### 5.2 Popover positioning repeatedly clamps and measures on hover/focus

Evidence:

- [use-thread-previews.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-thread-previews.ts#L82)
- [use-thread-previews.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-thread-previews.ts#L128)
- [codex-model-selector.tsx](/home/jtenner/Projects/jt-ide/src/mainview/controls/codex-model-selector.tsx#L129)

Current behavior:

- Thread previews and the mobile model submenu both do layout measurement in effects/handlers

Likely improvements:

- Reuse cached geometry during a single open session
- Move more positioning work to CSS when possible

Expected impact:

- Medium, mostly for interaction smoothness

## 6. Memoization That Is Currently Weaker Than It Looks

### 6.1 `CodexModelSelector` recomputes grouped models every render

Evidence:

- [codex-model-selector.tsx](/home/jtenner/Projects/jt-ide/src/mainview/controls/codex-model-selector.tsx#L48)
- [codex-model-selector.tsx](/home/jtenner/Projects/jt-ide/src/mainview/controls/codex-model-selector.tsx#L84)

Current behavior:

- `groupCodexModels(models)` runs outside `useMemo`
- `filteredGroups` depends on `groupedModels`
- Because `groupedModels` is a fresh array every render, `filteredGroups` recomputes every render too

Likely improvements:

- Memoize `groupCodexModels(models)` with `useMemo`
- Optionally build `modelById` and `reasoningOptionById` maps once too

Expected impact:

- Easy win
- Most noticeable when the selector is open and filtering/searching

## 7. Search And Formatting Allocation Churn

### 7.1 Workspace thread lists sort the same thread collection twice

Evidence:

- [use-mainview-derived-state.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-mainview-derived-state.ts#L533)
- [use-mainview-derived-state.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-mainview-derived-state.ts#L538)

Current behavior:

- One filtered+sorted pass for pinned threads
- One filtered+sorted pass for unpinned threads

Likely improvements:

- Sort once, then partition
- Or keep a maintained sorted thread list and derive slices from that

Expected impact:

- Medium

### 7.2 `selectedProject` and `selectedThread` still use repeated array scans

Evidence:

- [use-mainview-derived-state.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-mainview-derived-state.ts#L135)
- [use-mainview-derived-state.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-mainview-derived-state.ts#L143)

Current behavior:

- `projects.find(...)` and `threads.find(...)` are repeated for basic selection lookups

Likely improvements:

- Build `projectById` and `threadById`
- Reuse those lookups across the whole derived-state hook

Expected impact:

- Low to medium individually, but useful because the same maps would unlock other optimizations too

## 8. Lazy Formatting Opportunities

### 8.1 Security audit payloads are stringified for every visible row even when details stay collapsed

Evidence:

- [security-audit-panel.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/security-audit-panel.tsx#L235)

Current behavior:

- `JSON.stringify(event.payload, null, 2)` runs during row render
- The details payload may never be expanded

Likely improvements:

- Stringify lazily only after `<details>` is opened
- Or precompute on the backend and send a compact summary plus optional detail blob

Expected impact:

- Medium for large audit payloads or long event lists

## 9. Event Bridge And Update Fan-Out

### 9.1 Websocket messages are parsed and re-emitted as DOM `CustomEvent`s

Evidence:

- [index.ts](/home/jtenner/Projects/jt-ide/src/mainview/index.ts#L435)
- [index.ts](/home/jtenner/Projects/jt-ide/src/mainview/index.ts#L447)

Current behavior:

- Incoming websocket message -> `JSON.parse(...)`
- Then some message types are immediately wrapped into `CustomEvent`s and dispatched on `window`

Likely improvements:

- Keep a direct subscription channel for internal app consumers instead of routing through DOM events
- Batch repeated invalidations per worktree on the same tick

Expected impact:

- Low to medium now
- More valuable if task/history invalidations become frequent

## 10. Practical Optimization Order

### Fast, low-risk wins

1. Memoize grouped model data in [codex-model-selector.tsx](/home/jtenner/Projects/jt-ide/src/mainview/controls/codex-model-selector.tsx#L48).
2. Add `useMemo` around diff stats in [diff-workspace.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/diff-workspace.tsx#L262).
3. Remove or throttle `onMouseMove` preview updates in [use-thread-previews.ts](/home/jtenner/Projects/jt-ide/src/mainview/app/use-thread-previews.ts#L229).
4. Make security-audit payload formatting lazy in [security-audit-panel.tsx](/home/jtenner/Projects/jt-ide/src/mainview/app/security-audit-panel.tsx#L235).

### Medium-effort, high-payoff work

1. Introduce `projectById`, `threadById`, and `worktreeByProjectAndPath` lookup maps in derived state and row render paths.
2. Replace repeated `upsertThreadList()` full re-sorts with a more incremental structure.
3. Cache transcript view-model generation so only the tail changes when messages stream in.
4. Cache parsed diff lines by `diffText`.

### Architectural work

1. Replace thread status polling with push updates or a narrower working-thread status endpoint.
2. Push worktree diff invalidation instead of snapshot polling.
3. Consider workerizing large diff parsing or markdown/code-block preprocessing if real-world traces show main-thread stalls.

## Suggested Next Step

If the goal is to move quickly with low regression risk, the best sequence is:

1. Fix the broken/weak memoization and hover churn.
2. Add project/thread/worktree lookup maps.
3. Reduce thread-list reorder churn.
4. Profile again before taking on workerization or protocol changes.

