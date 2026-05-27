import { describe, expect, test } from "bun:test";
import {
  captureTranscriptViewportAnchor,
  deriveTranscriptHeightDeltaAdjustedScrollTop,
  restoreTranscriptViewportAnchorScrollTop,
  shouldRepinChatTranscriptOnItemSizeChange,
  type TranscriptMeasuredItem,
} from "./chat-transcript-scroll";

describe("chat transcript scroll helpers", () => {
  test("repins when a measured row changes size while pinned", () => {
    expect(
      shouldRepinChatTranscriptOnItemSizeChange({
        delta: 24,
        scrollState: "pinned",
      }),
    ).toBe(true);
    expect(
      shouldRepinChatTranscriptOnItemSizeChange({
        delta: -12,
        scrollState: "pinned",
      }),
    ).toBe(true);
  });

  test("does not repin when free-scrolling or when size is unchanged", () => {
    expect(
      shouldRepinChatTranscriptOnItemSizeChange({
        delta: 24,
        scrollState: "free",
      }),
    ).toBe(false);
    expect(
      shouldRepinChatTranscriptOnItemSizeChange({
        delta: 0,
        scrollState: "pinned",
      }),
    ).toBe(false);
  });

  test("keeps free-scroll anchor stable for size changes above the anchor", () => {
    expect(
      deriveTranscriptHeightDeltaAdjustedScrollTop({
        anchor: {
          index: 2,
          key: "message-3",
          offsetWithinItemPx: 10,
        },
        currentItemKeys: ["message-1", "message-2", "message-3"],
        currentScrollTop: 240,
        delta: 20,
        resizedItemIndex: 1,
        scrollState: "free",
      }),
    ).toBe(260);
  });

  test("captures viewport anchors from sparse virtualizer measurements", () => {
    const measurements = new Array<TranscriptMeasuredItem | undefined>(3);
    measurements[2] = {
      index: 2,
      key: "message-3",
      size: 100,
      start: 200,
    };

    expect(captureTranscriptViewportAnchor(240, measurements)).toEqual({
      index: 2,
      key: "message-3",
      offsetWithinItemPx: 40,
    });
  });

  test("restores viewport anchors from sparse virtualizer measurements", () => {
    const measurements = new Array<TranscriptMeasuredItem | undefined>(3);
    measurements[2] = {
      index: 2,
      key: "message-3",
      size: 100,
      start: 200,
    };

    expect(
      restoreTranscriptViewportAnchorScrollTop(
        {
          index: 2,
          key: "message-3",
          offsetWithinItemPx: 40,
        },
        measurements,
      ),
    ).toBe(240);
  });
});
