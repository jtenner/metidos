/**
 * @file src/bun/plugin/core-hacker-news-plugin.test.ts
 * @description Coverage for the core Hacker News plugin markdown helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  idsFromResponse,
  itemUrl,
  renderStoryTable,
  rowsFromItems,
} from "../../../core_plugins/hacker_news/hacker-news";

describe("core Hacker News plugin", () => {
  it("renders bounded markdown tables from Hacker News items", () => {
    expect(itemUrl(42)).toBe(
      "https://hacker-news.firebaseio.com/v0/item/42.json",
    );
    expect(idsFromResponse([1, "bad", 2, -1, 3.5])).toEqual([1, 2]);
    const rows = rowsFromItems([
      {
        by: "pg",
        descendants: 12,
        id: 42,
        score: 99,
        time: 1_700_000_000,
        title: "A | story &amp; title",
        type: "story",
        url: "https://example.com/path",
      },
      { deleted: true, id: 43, title: "deleted" },
      { id: 44, title: "Ask HN: No URL", type: "story" },
    ]);
    expect(rows).toHaveLength(2);

    const markdown = renderStoryTable({
      endpoint: "https://hacker-news.firebaseio.com/v0/topstories.json",
      fetchedAt: new Date("2026-05-10T02:00:00Z"),
      idsReturned: 3,
      kind: "top",
      rows,
    });

    expect(markdown).toContain("# Hacker News Top Stories");
    expect(markdown).toContain("Items: 2/3");
    expect(markdown).toContain("A \\| story & title");
    expect(markdown).toContain("example.com");
    expect(markdown).toContain(
      "[comments](https://news.ycombinator.com/item?id=42)",
    );
    expect(markdown).toContain("news.ycombinator.com");
  });
});
