/**
 * @file src/bun/thread-metadata-normalization.test.ts
 * @description Tests for shared thread metadata input normalization.
 */

import { describe, expect, it } from "bun:test";

import {
  hasNormalizedThreadMetadataPatch,
  normalizeOptionalThreadSummary,
  normalizeOptionalThreadTitle,
  normalizeThreadMetadataPatch,
} from "./thread-metadata-normalization";

describe("thread metadata normalization", () => {
  it("normalizes optional titles and rejects blank titles", () => {
    expect(normalizeOptionalThreadTitle(undefined)).toBeUndefined();
    expect(normalizeOptionalThreadTitle(null)).toBeUndefined();
    expect(normalizeOptionalThreadTitle("  New title  ")).toBe("New title");
    expect(() => normalizeOptionalThreadTitle("   ")).toThrow(
      "Thread title is required.",
    );
  });

  it("normalizes blank summaries to null", () => {
    expect(normalizeOptionalThreadSummary(undefined)).toBeUndefined();
    expect(normalizeOptionalThreadSummary(null)).toBeNull();
    expect(normalizeOptionalThreadSummary("   ")).toBeNull();
    expect(normalizeOptionalThreadSummary("  Useful summary  ")).toBe(
      "Useful summary",
    );
  });

  it("builds canonical patches from summary, description, and pinned input", () => {
    expect(
      normalizeThreadMetadataPatch({
        description: "  Description fallback  ",
        pinned: true,
        title: "  Renamed  ",
      }),
    ).toEqual({
      pinned: true,
      summary: "Description fallback",
      title: "Renamed",
    });

    expect(
      normalizeThreadMetadataPatch({
        description: "ignored",
        summary: "  Summary wins  ",
      }),
    ).toEqual({
      summary: "Summary wins",
    });
  });

  it("detects whether a normalized patch has any work", () => {
    expect(hasNormalizedThreadMetadataPatch({})).toBeFalse();
    expect(hasNormalizedThreadMetadataPatch({ pinned: false })).toBeTrue();
    expect(hasNormalizedThreadMetadataPatch({ summary: null })).toBeTrue();
  });
});
