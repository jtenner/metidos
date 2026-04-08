/**
 * @file src/mainview/app/use-thread-previews.test.ts
 * @description Test file for thread preview hover timing helpers.
 */

import { describe, expect, it } from "bun:test";

import { shouldHideDeferredPreview } from "./use-thread-previews";

describe("shouldHideDeferredPreview", () => {
  it("hides when the leaving anchor still owns the preview and is no longer active", () => {
    expect(
      shouldHideDeferredPreview({
        activeAnchorId: "thread-1",
        anchorId: "thread-1",
        anchorIsActive: false,
      }),
    ).toBe(true);
  });

  it("keeps the preview visible while the original anchor remains active", () => {
    expect(
      shouldHideDeferredPreview({
        activeAnchorId: "thread-1",
        anchorId: "thread-1",
        anchorIsActive: true,
      }),
    ).toBe(false);
  });

  it("ignores stale hides after a different anchor takes over the popover", () => {
    expect(
      shouldHideDeferredPreview({
        activeAnchorId: "thread-2",
        anchorId: "thread-1",
        anchorIsActive: false,
      }),
    ).toBe(false);
  });

  it("ignores deferred hides when no preview is active anymore", () => {
    expect(
      shouldHideDeferredPreview({
        activeAnchorId: null,
        anchorId: "thread-1",
        anchorIsActive: false,
      }),
    ).toBe(false);
  });
});
