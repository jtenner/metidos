# TanStack Virtual Chat Migration Plan

## Summary

This document describes how to migrate the chat transcript from eager DOM rendering to `@tanstack/react-virtual` without changing chat behavior yet.

The recommended direction is:

- use `@tanstack/react-virtual` and its `useVirtualizer` hook
- virtualize at the transcript row level, not at the raw message level
- keep the current `RpcThreadMessage[] -> VisibleMessage[]` transformation and add a second `VisibleMessage[] -> TranscriptRow[]` step with stable keys
- mount only one responsive chat view at a time while virtualized
- move expandable transcript-card UI state out of row-local `useState`
- replace the current manual DOM-based bottom-follow logic with an explicit TanStack Virtual anchor model

TanStack Virtual is a good fit here because it is fully open source, headless, and gives precise control over measurement, scrolling, and rendering. The tradeoff is that chat-specific behavior such as bottom anchoring, scroll-follow on streamed output, and persistent expanded state must be implemented by this app rather than supplied by the library.

## Problem This Solves

The current transcript renders the entire conversation DOM for every opened thread. That creates avoidable browser work when a thread contains:

- many chat turns
- long markdown responses
- many activity items such as commands, tool calls, diffs, searches, and errors
- expandable rows with large outputs

Virtualization reduces:

- mounted DOM nodes
- layout and paint work
- React reconciliation cost for long threads

It does not reduce:

- the full transcript payload returned by `getThread(...)`
- the full `threadMessages` array already stored in React state

## Why TanStack Virtual For This Repo

TanStack Virtual is the better fit for this repo if the priority is a fully open-source solution with maximum control.

Reasons:

- `@tanstack/react-virtual` is open source and headless
- the chat UI in this repo is already custom and does not need a packaged message-list opinion
- the transcript has many variable-height row types
- the app already owns complex scroll behavior and can keep owning it explicitly

The main tradeoff versus a higher-level library is that TanStack Virtual gives primitives, not chat semantics. That means the app must implement:

- bottom-follow behavior
- thread-switch scroll resets
- preserve-position behavior when rows resize
- lifted row expansion state

## Package To Use

The package for this migration is:

```bash
bun add @tanstack/react-virtual
```

That adds the React adapter around the core virtualizer logic.

## Current State In This Repo

### Data flow

- [`src/mainview/App.tsx`](../src/mainview/App.tsx) stores the full `RpcThreadMessage[]` transcript in `threadMessages`
- [`src/mainview/App.tsx`](../src/mainview/App.tsx) derives `visibleMessages` from `threadMessages`
- [`src/mainview/app/chat-workspace.tsx`](../src/mainview/app/chat-workspace.tsx) groups those messages into `MessageGroup[]`

### Rendering

- desktop chat renders all transcript groups into one eager scroll container
- mobile chat renders all transcript groups into a second eager scroll container
- both desktop and mobile chat trees are mounted at the same time and hidden with CSS

### Scroll behavior

[`src/mainview/App.tsx`](../src/mainview/App.tsx) currently owns manual scroll behavior through:

- `desktopChatScrollRef`
- `mobileChatScrollRef`
- `desktopChatPinnedToBottomRef`
- `mobileChatPinnedToBottomRef`
- `observeChatScrollContent(...)`
- `schedulePinnedChatScroll()`
- `syncPinnedChatScroll()`

That logic uses `ResizeObserver`, `MutationObserver`, and manual `scrollTop` updates.

### Stateful transcript rows

Two transcript item types currently keep UI state locally inside the row:

- [`CommandExecutionMessage`](../src/mainview/app/message-ui.tsx)
- [`FileChangeMessage`](../src/mainview/app/message-ui.tsx)

That is compatible with fully mounted rendering, but not with virtualization. Once a row scrolls out of view and unmounts, its local state is lost.

## Desired State

The desired end state is:

- one active chat view mounted at a time
- the transcript rendered by a dedicated virtualized component
- stable transcript row keys derived from actual message identity
- scroll position and bottom-follow behavior controlled explicitly in React
- dynamic row measurement handled by TanStack Virtual
- row expansion state owned above the individual rows

The desired ownership boundary looks like this:

```text
App.tsx
  -> fetches thread detail
  -> derives VisibleMessage[]
  -> derives TranscriptRow[]
  -> owns scroll-follow / row expansion state
  -> passes rows into virtualized chat view

Virtualized chat view
  -> owns useVirtualizer(...)
  -> owns list DOM structure
  -> renders only visible rows
```

## Relevant TanStack Virtual APIs

The official TanStack Virtual docs expose the core pieces needed for this migration.

### Required core hook

- `useVirtualizer`

This will be the main integration point in React.

### Required options

- `count`
- `getScrollElement`
- `estimateSize`

### Important optional options for this chat

- `getItemKey`
- `overscan`
- `paddingStart`
- `paddingEnd`
- `scrollPaddingStart`
- `scrollPaddingEnd`
- `initialOffset`
- `scrollMargin`
- `measureElement`
- `shouldAdjustScrollPositionOnItemSizeChange`
- `onChange`

### Important instance methods

- `getVirtualItems()`
- `getTotalSize()`
- `scrollToIndex(...)`
- `scrollToOffset(...)`
- `measure()`
- `measureElement(...)`

### Important React 19 note

The React adapter exposes `useAnimationFrameWithResizeObserver` and `useScrollendEvent`, and also documents `useFlushSync`. Because this repo is already on React 19, the implementation should verify the current adapter guidance and avoid unnecessary `flushSync` assumptions during the migration.

Recommended default for this repo:

- start with `useFlushSync: false`

Reason:

- the official React adapter docs explicitly call out React 19 warnings from `flushSync`
- this transcript is not a pixel-perfect spreadsheet where synchronous scroll rendering is more important than compatibility and stability
- if scroll correctness later proves insufficient, this can be revisited with measurement

## Recommended Row Model

Do not virtualize raw `VisibleMessage[]`.

Instead, introduce a stable virtual row model built from grouped transcript rows.

Recommended shape:

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

- derive keys from `RpcThreadMessage.id` whenever possible
- for grouped assistant rows, derive a key from the first and last grouped message IDs
- for synthetic rows such as “Processing” or run-level error/notice, derive keys from thread ID plus run-status metadata

This is important because TanStack Virtual caches measurements per item identity. Index-only keys are fragile when the last assistant row is updated or when older messages are eventually prepended.

## Recommended Layout Strategy

### 1. Use a measured scroll element, not window virtualization

This transcript should use element virtualization, not window virtualization.

Reason:

- the chat lives inside app-specific flex layouts
- desktop and mobile each have custom wrappers
- the app already has separate transcript containers
- the chat composer and surrounding app chrome are not part of the browser window scroll

So the core shape should be:

```tsx
const parentRef = useRef<HTMLDivElement | null>(null)

const virtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 120,
  getItemKey: (index) => rows[index].key,
})
```

### 2. Use block translation for the visible range

The official dynamic example uses:

- a full-height spacer element via `getTotalSize()`
- an inner translated block positioned at `items[0]?.start`
- row elements inside that translated block

That pattern is a good fit here because:

- it reduces per-row positioning boilerplate
- it works well with dynamic measurement
- it is easier to reason about for a vertically stacked chat transcript

Recommended DOM shape:

```tsx
<div ref={parentRef} style={{ overflowY: "auto" }}>
  <div
    style={{
      height: virtualizer.getTotalSize(),
      position: "relative",
      width: "100%",
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
      }}
    >
      {virtualItems.map((virtualRow) => (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={virtualizer.measureElement}
        >
          <TranscriptRowRenderer row={rows[virtualRow.index]} />
        </div>
      ))}
    </div>
  </div>
</div>
```

### 3. Only mount one responsive transcript at a time

This is a required migration step.

The current UI mounts both desktop and mobile chat trees simultaneously behind CSS visibility classes. That is risky for virtualization because a hidden branch may have:

- zero measurable height
- unstable measurements
- unnecessary observer work

Recommendation:

- introduce a real responsive mode hook
- mount only the active chat variant

## Desktop And Mobile Wrapper Strategy

### Desktop

Desktop currently scrolls:

- the thread title
- the worktree subtitle
- the transcript

There are two viable approaches.

#### Recommended desktop approach

Represent the desktop title/subtitle shell as a dedicated non-message transcript row at the start of the virtualized content.

Why:

- it preserves current “header scrolls with transcript” behavior
- it keeps one scroll model
- it avoids keeping a separate fixed header outside the list

Suggested row addition:

```ts
type TranscriptRow =
  | { key: string; kind: "screen_header"; ... }
  | { key: string; kind: "assistant_group"; ... }
  | { key: string; kind: "user_group"; ... }
```

Alternative:

- keep the title outside the virtualizer and let only the transcript rows scroll

That is simpler to implement but it changes current desktop behavior.

### Mobile

Mobile already has a more separable structure:

- title block above transcript
- scrollable transcript area
- fixed composer footer

Recommended mobile approach:

- keep the title block outside the virtualized list
- virtualize only the transcript rows
- preserve current footer inset by using bottom padding or a synthetic spacer row

## Scroll And Bottom-Anchor Model

This is the main area where TanStack Virtual requires explicit app logic.

### Current behavior to preserve

The existing app behaves like this:

- if the user is effectively at the bottom, new output keeps the transcript pinned to the bottom
- if the user scrolls upward, new output does not snap them back down
- switching to a different thread resets to bottom

### Recommended new model

Track bottom anchoring explicitly from the virtualizer scroll state.

Recommended state:

```ts
type ChatScrollState = {
  isNearBottom: boolean;
  lastKnownDistanceFromBottom: number;
};
```

Recommended calculation:

```ts
const distanceFromBottom =
  virtualizer.getTotalSize() -
  (scrollOffset + viewportHeight)

const isNearBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX
```

Where:

- `scrollOffset` comes from the scroll element
- `viewportHeight` comes from the scroll element client height
- `BOTTOM_THRESHOLD_PX` matches or replaces the current `CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX`

### When to scroll automatically

#### On thread change

- always scroll to the last row

Recommended call:

```ts
virtualizer.scrollToIndex(rows.length - 1, { align: "end" })
```

#### On appended output while pinned

- if `isNearBottom` was true before the data change, scroll to end after the virtualizer recalculates

#### On appended output while not pinned

- do not move the user

#### On last-row growth while pinned

- scroll to the end again after measurement settles

This matters because streamed assistant content may change row height without increasing row count.

## Dynamic Measurement Strategy

### Use `measureElement`

The transcript needs dynamic measurement because row height is not fixed.

Drivers of variable height:

- markdown
- syntax highlighting
- command output expansion
- diff expansion
- tool outputs
- streamed content growth

The official dynamic example uses `ref={virtualizer.measureElement}` with `data-index`, and that is the right starting point here.

### Estimate generously

The docs recommend using a reasonable estimate, especially when rows are dynamically measured.

For this transcript, the estimate should be biased upward rather than downward because:

- underestimating causes more frequent position corrections
- activity cards are often much taller than simple chat bubbles

### Use `shouldAdjustScrollPositionOnItemSizeChange`

This hook matters for chat.

Recommended policy:

- when the user is pinned near bottom, allow adjustment so the bottom anchor stays visually stable
- when the user is not pinned and a row below the viewport grows, do not force a scroll jump
- when a row above the viewport changes size, allow the adjustment that preserves the visible reading position

This needs to be tuned in implementation, but it is the right hook for the job.

## Stateful Rows Must Be Hoisted

Virtualization will unmount offscreen rows. That means local `useState` inside the row component is not durable.

Affected components today:

- [`CommandExecutionMessage`](../src/mainview/app/message-ui.tsx)
- [`FileChangeMessage`](../src/mainview/app/message-ui.tsx)

Recommended fix:

- move expansion state into transcript-level state keyed by stable message or row keys
- pass `expanded` and `onExpandedChange` into the row components

Example:

```ts
type TranscriptUiState = {
  expandedCommandIds: Record<string, true>;
  expandedFileChangeIds: Record<string, true>;
};
```

Without this step, expanded rows will collapse whenever they unmount offscreen.

## Styling And Measurement Notes

### Use a bounded scroll container

The docs require the virtualized element to have a real bounded size. The implementation should keep using the current flex layout, but the actual scroll element must have:

- measurable height
- `overflow-y: auto`

### Consider `contain: strict`

The official dynamic example uses `contain: strict` on the scroll container.

That is worth testing here because:

- the chat transcript is isolated
- layout containment may reduce browser work

It should be treated as an optimization to validate visually rather than a guaranteed requirement.

### Disable browser overflow anchoring if needed

The official dynamic example also uses `overflowAnchor: 'none'`.

That is worth preserving if browser-native overflow anchoring fights the app’s explicit bottom-anchor logic.

### Markdown margins

This repo already trims first/last markdown child margins inside `.message-markdown`, which helps. The migration should still ensure every virtual row has an explicit wrapper so margins remain measured inside the item box.

## Recommended Implementation Phases

### Phase 1: Transcript model prep

Goal:

- prepare the transcript for virtualization without changing the scroll implementation yet

Tasks:

- extract `VisibleMessage[] -> TranscriptRow[]` into a dedicated helper
- add stable row keys
- hoist expandable row state out of `CommandExecutionMessage` and `FileChangeMessage`
- introduce single-variant mounting for desktop vs mobile chat

Deliverable:

- current transcript still renders eagerly, but its data model is virtualization-ready

### Phase 2: Desktop virtualizer

Goal:

- replace desktop eager rendering with TanStack Virtual first

Tasks:

- add `@tanstack/react-virtual`
- build a desktop `VirtualizedChatTranscript`
- wire `useVirtualizer`
- preserve current desktop row styling
- decide whether desktop title remains a scrolling synthetic row or becomes a fixed outer block

Deliverable:

- desktop chat is virtualized
- mobile still uses the current eager transcript

### Phase 3: Desktop scroll anchoring

Goal:

- restore the current bottom-follow behavior on desktop

Tasks:

- replace `desktopChatPinnedToBottomRef` logic with explicit anchor tracking
- scroll to end on thread changes
- follow streamed output only while pinned
- tune `shouldAdjustScrollPositionOnItemSizeChange`

Deliverable:

- desktop virtualization behaves like the current desktop chat during streaming and manual reading

### Phase 4: Mobile virtualizer

Goal:

- apply the same virtualized model to mobile

Tasks:

- add a mobile virtualized wrapper
- preserve current composer inset behavior
- keep the title above the list
- preserve current row spacing and edge padding

Deliverable:

- both desktop and mobile transcripts are virtualized, but with layout-specific wrappers

### Phase 5: Cleanup

Goal:

- remove obsolete eager-rendering and DOM observer machinery

Tasks:

- remove `observeChatScrollContent(...)`
- remove manual pinned-to-bottom DOM observers from [`src/mainview/App.tsx`](../src/mainview/App.tsx)
- remove duplicated eager transcript code paths
- consolidate row rendering around one row-model source of truth

Deliverable:

- the transcript code path is fully virtualized and simpler than the mixed old/new state

### Phase 6: Optional large-transcript follow-up

Goal:

- address transcript transport and memory costs, not just DOM costs

Tasks:

- add backend transcript pagination
- prepend older transcript pages on demand
- use loader rows or range-aware fetching based on the official infinite-scroll pattern

Deliverable:

- the app avoids both eager DOM cost and eager transcript payload growth

## Non-Goals Of The First Migration

The first TanStack Virtual migration should not try to solve everything at once.

Non-goals:

- backend transcript pagination
- changing the visual design of the chat UI
- replacing the chat composer
- reworking message semantics or grouping rules
- implementing per-thread scroll restoration from day one

## Risks And Open Questions

### 1. Header behavior choice on desktop

Need to decide whether desktop title/subtitle should:

- remain part of the scrolling content
- or become fixed above the virtualized transcript

The recommended plan above preserves current behavior by treating the header as a synthetic row.

### 2. Measurement churn from streamed markdown

Long streamed markdown replies may cause repeated remeasurement of the final row. That is expected, but the scroll-anchor policy must be tuned so the user does not feel jumpiness.

### 3. Multiple expansion states

If more transcript item types gain expandable UI later, their state should be added to the lifted transcript UI state rather than reintroduced locally.

### 4. Future prepend behavior

If transcript pagination is added later, prepend behavior will require careful scroll preservation. TanStack Virtual can support this, but it should not be mixed into the first migration.

## Sources

- TanStack Virtualizer API: https://tanstack.com/virtual/latest/docs/api/virtualizer
- TanStack React adapter docs: https://tanstack.com/virtual/latest/docs/framework/react/react-virtual
- TanStack React dynamic example: https://tanstack.com/virtual/latest/docs/framework/react/examples/dynamic
- TanStack React infinite scroll example: https://tanstack.com/virtual/latest/docs/framework/react/examples/infinite-scroll
