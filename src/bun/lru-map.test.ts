/**
 * @file src/bun/lru-map.test.ts
 * @description Tests for Map-backed LRU helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  lruMapEntriesNewestFirst,
  pruneLruMapToMaxEntries,
  readLruMapValue,
  writeLruMapValue,
} from "./lru-map";

describe("lru-map helpers", () => {
  it("promotes reads and writes to most-recent order", () => {
    const cache = new Map<string, number>([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);

    expect(readLruMapValue(cache, "a")).toBe(1);
    writeLruMapValue(cache, "b", 20);

    expect([...cache.keys()]).toEqual(["c", "a", "b"]);
    expect(lruMapEntriesNewestFirst(cache)).toEqual([
      ["b", 20],
      ["a", 1],
      ["c", 3],
    ]);
  });

  it("prunes oldest entries to the configured max", () => {
    const cache = new Map<string, number>([
      ["oldest", 1],
      ["middle", 2],
      ["newest", 3],
    ]);

    pruneLruMapToMaxEntries(cache, 2);

    expect([...cache.entries()]).toEqual([
      ["middle", 2],
      ["newest", 3],
    ]);
  });

  it("treats negative limits as zero", () => {
    const cache = new Map<string, number>([["a", 1]]);

    pruneLruMapToMaxEntries(cache, -1);

    expect(cache.size).toBe(0);
  });
});
