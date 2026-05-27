/**
 * @file src/mainview/app/chat-transcript-scroll.ts
 * @description Scroll state and viewport-anchor helpers for the Thread transcript.
 */

import type { VisibleMessage } from "./visible-message-state";

export type ChatTranscriptScrollState = "free" | "pinned";
export type ChatTranscriptScrollDirection = "down" | "none" | "up";

export type TranscriptViewportAnchor = {
  index: number;
  key: string;
  offsetWithinItemPx: number;
};

export type TranscriptMeasuredItem = {
  end?: number;
  index: number;
  key: string;
  size?: number;
  start: number;
};

const CHAT_PINNED_BOTTOM_EPSILON_PX = 2;

export function shouldNotAdjustScrollPositionOnTranscriptItemSizeChange(): boolean {
  return false;
}

export function shouldRepinChatTranscriptOnItemSizeChange({
  delta,
  scrollState,
}: {
  delta: number;
  scrollState: ChatTranscriptScrollState;
}): boolean {
  return scrollState === "pinned" && delta !== 0;
}

/**
 * Checks whether the transcript viewport is effectively pinned to the bottom.
 */
export function isChatTranscriptAtBottom(
  container: Pick<
    HTMLDivElement,
    "clientHeight" | "scrollHeight" | "scrollTop"
  >,
): boolean {
  return (
    Math.max(
      container.scrollHeight - container.scrollTop - container.clientHeight,
      0,
    ) <= CHAT_PINNED_BOTTOM_EPSILON_PX
  );
}

/**
 * Collapse transcript scrolling into two states: pinned to the live tail or
 * free-scroll while the user reads older content.
 */
export function deriveChatTranscriptScrollState({
  atBottom,
  currentState,
  manualScrollDirection,
  observedScrollDirection,
}: {
  atBottom: boolean;
  currentState: ChatTranscriptScrollState;
  manualScrollDirection: ChatTranscriptScrollDirection;
  observedScrollDirection: ChatTranscriptScrollDirection;
}): ChatTranscriptScrollState {
  if (atBottom) {
    return "pinned";
  }
  if (manualScrollDirection === "up" || observedScrollDirection === "up") {
    return "free";
  }
  if (currentState === "free") {
    return "free";
  }
  return "pinned";
}

/**
 * Thread switches and newly-submitted user messages should always repin the
 * transcript to the latest message.
 */
export function shouldForcePinChatTranscript(
  activeThreadId: number | null,
  previousThreadId: number | null,
  previousTailMessageKey: string | null,
  tailMessage: VisibleMessage | null,
): boolean {
  if (activeThreadId !== previousThreadId) {
    return true;
  }
  if (!tailMessage || tailMessage.key === previousTailMessageKey) {
    return false;
  }
  return tailMessage.kind === "chat" && tailMessage.speaker === "user";
}

function readTranscriptMeasuredItemEnd(item: TranscriptMeasuredItem): number {
  return item.end ?? item.start + (item.size ?? 0);
}

function isTranscriptMeasuredItem(
  item: TranscriptMeasuredItem | undefined,
): item is TranscriptMeasuredItem {
  return item !== undefined;
}

export function captureTranscriptViewportAnchor(
  scrollTop: number,
  items: readonly (TranscriptMeasuredItem | undefined)[],
): TranscriptViewportAnchor | null {
  const anchoredItem = items.find((item) => {
    if (!isTranscriptMeasuredItem(item)) {
      return false;
    }

    const itemEnd = readTranscriptMeasuredItemEnd(item);
    return item.start <= scrollTop && itemEnd > scrollTop;
  });

  if (!anchoredItem) {
    return null;
  }

  return {
    index: anchoredItem.index,
    key: anchoredItem.key,
    offsetWithinItemPx: Math.max(scrollTop - anchoredItem.start, 0),
  };
}

function resolveTranscriptViewportAnchorIndex(
  anchor: TranscriptViewportAnchor | null,
  currentItemKeys: readonly string[],
): number | null {
  if (!anchor) {
    return null;
  }

  const exactIndex = currentItemKeys.indexOf(anchor.key);
  if (exactIndex >= 0) {
    return exactIndex;
  }

  return anchor.index >= 0 && anchor.index < currentItemKeys.length
    ? anchor.index
    : null;
}

export function restoreTranscriptViewportAnchorScrollTop(
  anchor: TranscriptViewportAnchor | null,
  items: readonly (TranscriptMeasuredItem | undefined)[],
): number | null {
  if (!anchor) {
    return null;
  }

  const anchoredItem =
    items.find(
      (item) => isTranscriptMeasuredItem(item) && item.key === anchor.key,
    ) ??
    items.find(
      (item) => isTranscriptMeasuredItem(item) && item.index === anchor.index,
    );

  return anchoredItem ? anchoredItem.start + anchor.offsetWithinItemPx : null;
}

export function deriveTranscriptHeightDeltaAdjustedScrollTop({
  anchor,
  currentItemKeys,
  currentScrollTop,
  delta,
  resizedItemIndex,
  scrollState,
}: {
  anchor: TranscriptViewportAnchor | null;
  currentItemKeys: readonly string[];
  currentScrollTop: number;
  delta: number;
  resizedItemIndex: number;
  scrollState: ChatTranscriptScrollState;
}): number | null {
  const anchorIndex = resolveTranscriptViewportAnchorIndex(
    anchor,
    currentItemKeys,
  );

  if (
    scrollState !== "free" ||
    anchorIndex === null ||
    delta === 0 ||
    resizedItemIndex >= anchorIndex
  ) {
    return null;
  }

  return currentScrollTop + delta;
}
