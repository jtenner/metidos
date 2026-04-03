# React Virtuoso Chat Migration Plan

## Summary

This document describes how to replace the current eager-rendered chat transcript with a virtualized `react-virtuoso` list without changing chat behavior yet.

The recommended approach is:

- use the MIT-licensed core `Virtuoso` component, not the commercial `VirtuosoMessageList`
- virtualize transcript rows at the current `MessageGroup[]` level rather than raw `VisibleMessage[]`
- move chat scroll ownership from DOM refs and `ResizeObserver` bookkeeping in [`src/mainview/App.tsx`](../src/mainview/App.tsx) to Virtuoso callbacks and a `VirtuosoHandle`
- mount only the active responsive chat view while virtualized, instead of keeping both desktop and mobile transcripts mounted behind CSS
- hoist expandable transcript-card UI state out of row-local `useState` so virtualization does not reset expanded cards when rows unmount offscreen

This migration will reduce DOM size, layout work, paint cost, and React reconciliation cost for long threads. It will not reduce the size of the transcript payload returned by `getThread(...)`, nor the in-memory size of the `threadMessages` array already held in React state.

## Problem This Solves

The current chat transcript renders the entire visible conversation tree into the DOM on every thread open and on every streaming update. That is workable for short threads, but it scales poorly when a thread accumulates:

- many assistant/user turns
- long markdown responses
- many activity cards such as commands, diffs, tool calls, searches, and errors
- expandable transcript items with large outputs

The result is unnecessary browser work even when the user can only see a small portion of the transcript.

## Current State In This Repo

### Data flow

- [`src/mainview/App.tsx`](../src/mainview/App.tsx) stores the full `RpcThreadMessage[]` transcript in `threadMessages`.
- [`src/mainview/App.tsx`](../src/mainview/App.tsx) derives `visibleMessages` from `threadMessages`, including synthetic rows such as:
  - the initial “Thread ready” message
  - the in-progress “Processing” row
  - run-level error/notice rows
- [`src/mainview/app/chat-workspace.tsx`](../src/mainview/app/chat-workspace.tsx) regroups those messages into `MessageGroup[]`.

### Rendering

- desktop chat renders all groups inside one scroll container
- mobile chat renders all groups inside another scroll container
- both desktop and mobile chat trees are mounted at the same time and hidden with CSS classes rather than conditional rendering

### Scroll behavior

[`src/mainview/App.tsx`](../src/mainview/App.tsx) currently manages chat scroll manually:

- `desktopChatScrollRef` and `mobileChatScrollRef` point at DOM scroll containers
- `desktopChatPinnedToBottomRef` and `mobileChatPinnedToBottomRef` track whether each container is near the bottom
- `observeChatScrollContent(...)` attaches `ResizeObserver` and `MutationObserver` to keep pinned views scrolled down as content grows
- thread changes force both views back to the bottom

### Transcript item behavior

The transcript contains variable-height content and some stateful rows:

- markdown
- reasoning
- command output
- file diff cards
- tool call cards
- web search cards
- error cards

Two item components currently keep expansion state locally inside the row:

- [`CommandExecutionMessage`](../src/mainview/app/message-ui.tsx)
- [`FileChangeMessage`](../src/mainview/app/message-ui.tsx)

That is fine for a fully mounted transcript, but virtualization will unmount offscreen rows and reset that local state unless it is moved upward.

## Relevant React Virtuoso Capabilities

The official `react-virtuoso` docs are a good fit for this transcript because the library supports:

- variable-height rows without manual measurement
- dynamic height changes through `ResizeObserver`
- flexbox-safe container sizing
- imperative scrolling through `VirtuosoHandle`
- list customization through `Header`, `Footer`, `Scroller`, `List`, and `Item`
- bottom-following behavior through `alignToBottom`, `followOutput`, and `atBottomStateChange`
- optional state snapshot/restore through `getState()` and `restoreStateFrom`

Important implementation details from the official docs:

- the list needs a real measurable height, either directly or through a flex parent
- top/bottom margins should not protrude outside the row container
- custom Virtuoso components should not be declared inline in render

## Why Use Core `Virtuoso` Instead Of `VirtuosoMessageList`

This repo should target core `react-virtuoso` first.

Reasons:

- the user explicitly pointed at the `react-virtuoso` docs
- core `Virtuoso` is MIT-licensed
- the chat transcript already has a custom visual system and custom row types
- the repo does not currently need the commercial message-list package to get the main benefit, which is DOM virtualization

The official Virtuoso site also exposes `VirtuosoMessageList`, but that package is commercial and is optimized for message-list-specific data/scroll semantics. It is worth knowing about, but it should not be the initial migration target for this app.

## Recommended Target Design

### 1. Virtualize grouped transcript rows, not raw messages

Do not virtualize individual `VisibleMessage` objects.

Instead, virtualize the current `MessageGroup[]` shape or a small refinement of it.

Why:

- it preserves the current visual grouping, especially the shared assistant avatar/label shell
- it keeps the number of virtual rows smaller than raw message count
- it matches the current user-facing transcript structure more closely
- it avoids unnecessary churn when several assistant-side activity rows belong to one grouped assistant block

Do not use `GroupedVirtuoso`.

Reason:

- the current transcript does not have sticky group headers
- the existing “groups” are rendered rows, not section headers
- a flat `Virtuoso<MessageGroup>` is the correct model

### 2. Introduce a stable virtual row model

The current `MessageGroup.key` values are index-derived, which is acceptable for plain rendering but not ideal for virtualization.

The migration should introduce a stable row model such as:

```ts
type TranscriptRow =
  | {
      key: string;
      kind: "assistant_group";
      group: MessageGroup;
    }
  | {
      key: string;
      kind: "user_group";
      group: MessageGroup;
    };
```

Recommended key strategy:

- derive row keys from `RpcThreadMessage.id` whenever possible
- for assistant groups, derive the group key from the first and last grouped message IDs
- for synthetic rows such as “Processing”, run error, or run notice, use deterministic keys based on thread ID plus run-status metadata

This lets `computeItemKey` stay stable even while the last assistant row is updated repeatedly during streaming.

### 3. Keep transcript derivation in two explicit steps

The migration should make the current derivation pipeline explicit:

1. `RpcThreadMessage[] -> VisibleMessage[]`
2. `VisibleMessage[] -> TranscriptRow[]`

That separation makes the virtualization layer simpler:

- `App.tsx` can keep owning thread data and run state
- a dedicated transcript helper can own grouping and key generation
- the Virtuoso component only needs a stable array of rows plus a renderer

### 4. Replace `ChatTranscript` with a virtualized transcript component

Introduce a component boundary such as:

```ts
type VirtualizedChatTranscriptProps = {
  localUserLabel: string;
  rows: TranscriptRow[];
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  variant: "desktop" | "mobile";
  onAtBottomChange: (atBottom: boolean) => void;
};
```

The component should own:

- the `VirtuosoHandle` ref
- `computeItemKey`
- `followOutput`
- `atBottomStateChange`
- `itemContent`

It should not own:

- thread fetching
- run-state polling
- thread selection
- chat send/stop actions

### 5. Preserve current desktop/mobile layout with different Virtuoso wrappers

Desktop and mobile should not share the exact same wrapper structure.

#### Desktop

Desktop currently scrolls:

- the screen title
- the worktree subtitle
- the transcript

That maps well to Virtuoso `components.Header`.

Recommended desktop structure:

- the existing outer `flex-1` transcript area stays
- Virtuoso becomes the scroll container inside it
- the title/subtitle block moves into `components.Header`
- the list body uses a custom `List` component that preserves the `max-w-4xl` center column

#### Mobile

Mobile currently keeps the title above the scroll area and the composer fixed below it.

Recommended mobile structure:

- keep the title block outside Virtuoso
- let Virtuoso fill the remaining height
- keep the fixed footer/composer
- preserve the bottom safe area through either:
  - a Virtuoso `Footer` spacer, or
  - scroller padding plus a footer spacer

### 6. Mount only the active responsive chat view

This is an important migration requirement.

Today the app mounts both:

- the desktop chat tree inside a `hidden md:flex` wrapper
- the mobile chat tree inside a `md:hidden` wrapper

That is acceptable for normal DOM rendering, but it is risky for virtualization because a hidden list has no useful measurable height.

Inference from the official docs:

- Virtuoso expects a real measurable viewport height
- `display: none` branches can lead to bad measurement, zero-height layout, or extra recalculation work

Recommendation:

- render only one chat variant at a time based on a real media-query hook
- do not mount both virtualized lists simultaneously

### 7. Reuse the row markup that already exists

There is already transcript-group rendering logic in:

- [`src/mainview/app/chat-workspace.tsx`](../src/mainview/app/chat-workspace.tsx)
- [`src/mainview/app/message-ui.tsx`](../src/mainview/app/message-ui.tsx)

[`src/mainview/app/message-ui.tsx`](../src/mainview/app/message-ui.tsx) already contains:

- `DesktopMessageGroups`
- `MobileMessageGroups`

Those helpers currently render whole arrays, not one row, but they show that the repo already has reusable group-level presentation logic that can be split into single-row renderers instead of duplicating the transcript markup again.

## Scroll Behavior Mapping

The current bottom-following behavior should be preserved, but the implementation should move from DOM bookkeeping to Virtuoso APIs.

| Current behavior | Current mechanism | Virtuoso replacement |
| --- | --- | --- |
| Track whether user is pinned near bottom | manual `onScroll` + `isScrolledToBottom(...)` | `atBottomStateChange` |
| Keep list bottom-aligned when transcript is short | manual `scrollTop = scrollHeight` | `alignToBottom` |
| Follow new output only when user is already at bottom | manual pinned refs + scheduled scroll | `followOutput={(isAtBottom) => isAtBottom ? "auto" : false}` |
| Force bottom on thread switch | `useLayoutEffect` on `selectedThreadId` | keyed remount or `scrollToIndex({ index: "LAST", align: "end" })` |
| Access scroll container directly | DOM refs | `scrollerRef` |
| Optional future scroll restoration per thread | not supported today | `getState()` + `restoreStateFrom` |

## Dynamic Height And Streaming Considerations

### Variable-height rows

This transcript is a good virtualization candidate because Virtuoso explicitly supports variable-height content.

That matters here because rows can change height due to:

- markdown layout
- syntax-highlighted code blocks
- expanded command output
- expanded diff cards
- updated streaming content

### Streaming updates to the last row

The current chat frequently updates the last assistant area while a run is active.

That means the migration should not rely only on “item count increased” semantics.

Recommended behavior:

- use `followOutput` for appended rows
- when the user is pinned at bottom and the last row grows because its content changed, call `autoscrollToBottom()` if needed

The official docs explicitly mention `autoscrollToBottom()` for late size changes such as images loading. The same idea applies here if markdown images or other delayed size changes appear in assistant output.

### Markdown margins

Virtuoso warns against margins protruding outside the measured row container.

This repo is already in a decent position because the markdown stylesheet in [`src/mainview/index.css`](../src/mainview/index.css) removes top margin from the first child and bottom margin from the last child inside `.message-markdown`.

That should reduce measurement problems, but the migration should still keep each virtual row wrapped in its own explicit container so internal content margins stay contained.

## Stateful Row Content Must Be Hoisted

This is the largest React-side behavior change in the migration.

Virtualization means offscreen rows will unmount.

As a result, local `useState` inside row components will not persist once a row scrolls far enough away.

That affects at least:

- [`CommandExecutionMessage`](../src/mainview/app/message-ui.tsx), which stores `isExpanded` locally
- [`FileChangeMessage`](../src/mainview/app/message-ui.tsx), which stores `isExpanded` locally

Recommended fix:

- move row expansion state into transcript-level state keyed by transcript row key or message key
- pass `expanded` and `onExpandedChange` down as props

Example shape:

```ts
type TranscriptUiState = {
  expandedCommandIds: Record<string, true>;
  expandedFileChangeIds: Record<string, true>;
};
```

Without that change, users will see expanded rows collapse when they scroll away and back.

## Suggested Implementation Shape

This is the recommended shape for the first real implementation pass:

```tsx
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

function VirtualizedChatTranscript({
  rows,
  variant,
  localUserLabel,
  selectedThreadId,
  selectedWorktreePath,
}: Props) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  return (
    <Virtuoso<TranscriptRow>
      key={`${variant}:${selectedThreadId ?? "none"}`}
      ref={virtuosoRef}
      style={{ height: "100%" }}
      data={rows}
      computeItemKey={(_, row) => row.key}
      alignToBottom
      atBottomStateChange={setAtBottom}
      followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
      itemContent={(index, row) => (
        <TranscriptRowRenderer
          group={row.group}
          index={index}
          isLast={index === rows.length - 1}
          localUserLabel={localUserLabel}
          selectedWorktreePath={selectedWorktreePath}
          variant={variant}
        />
      )}
    />
  );
}
```

This example is intentionally incomplete. The real implementation also needs:

- desktop/mobile wrapper components
- stable row-key generation
- lifted expansion state
- conditional mounting of only one responsive variant

## Non-Goals Of The First Migration

This document recommends keeping the first implementation narrowly scoped.

Do not try to solve these in the same change:

- transcript pagination from the backend
- per-thread scroll restoration
- reworking transcript visuals
- replacing the composer
- moving to the commercial `VirtuosoMessageList` package

## What This Migration Does Not Solve

Virtualization only reduces render cost. It does not change transcript loading semantics.

The app will still:

- fetch the full thread transcript into memory through `getThread(...)`
- keep the entire `threadMessages` array in React state
- derive the full `visibleMessages` array in memory

If very large transcripts become a transport or memory problem, the next layer of work would be:

- backend transcript pagination
- incremental loading with `startReached`
- possibly restoring scroll position when older pages are prepended

That is separate from the first Virtuoso migration.

## Recommended Phases

### Phase 1: Transcript prep

- extract grouping into a pure helper that returns stable-keyed transcript rows
- hoist expansion state for command/file-change cards
- conditionally mount only one chat variant at a time

### Phase 2: Desktop virtualization

- replace desktop `ChatTranscript` with `Virtuoso`
- move the current desktop title/subtitle into a Virtuoso header
- replace the manual desktop scroll ref and pinned-bottom logic

### Phase 3: Mobile virtualization

- replace mobile `ChatTranscript` with `Virtuoso`
- preserve footer inset behavior with a footer spacer or scroller padding
- remove the manual mobile scroll ref and pinned-bottom logic

### Phase 4: Cleanup

- delete `observeChatScrollContent(...)`
- delete manual pinned-to-bottom DOM bookkeeping from [`src/mainview/App.tsx`](../src/mainview/App.tsx)
- consolidate transcript row rendering so there is one source of truth for desktop rows and one for mobile rows

## Sources

- React Virtuoso overview: https://virtuoso.dev/react-virtuoso/
- Virtuoso API reference: https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/
- Virtuoso customize rendering: https://virtuoso.dev/react-virtuoso/virtuoso/customize-rendering/
- Virtuoso custom scroll container: https://virtuoso.dev/react-virtuoso/virtuoso/custom-scroll-container/
- Virtuoso auto resizing: https://virtuoso.dev/react-virtuoso/virtuoso/auto-resizing/
- Virtuoso scroll to index: https://virtuoso.dev/react-virtuoso/virtuoso/scroll-to-index/
- Virtuoso Message List overview: https://virtuoso.dev/message-list/
