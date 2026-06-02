/**
 * @file src/mainview/app/git-history-state.test.ts
 * @description Tests for git history pagination and cache helpers.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcGitHistoryEntry,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import {
  createGitHistoryDiffModalOpenState,
  estimateGitHistoryDiffCacheEntryBytes,
  estimateGitHistoryResultBytes,
  GIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
  GIT_HISTORY_MAX_RETAINED_ENTRIES,
  gitHistoryDiffCacheKey,
  handleGitHistoryScrollPosition,
  isGitHistoryLoadMoreThresholdReached,
  trimGitHistoryResultEntries,
} from "./git-history-state";

describe("git history state helpers", () => {
  it("builds modal state for uncached loads and cached diff reopens", () => {
    const entry: RpcGitHistoryEntry = {
      authorName: "Alice",
      committedAt: "2026-05-05T00:00:00Z",
      hash: "abc123",
      shortHash: "abc123",
      subject: "Initial commit",
    };
    const cachedCommit: RpcGitHistoryEntry = {
      ...entry,
      authorName: "Cached Author",
      subject: "Cached commit metadata",
    };

    expect(
      createGitHistoryDiffModalOpenState({
        projectId: 7,
        worktreePath: "/repo/main",
        entry,
      }),
    ).toEqual({
      projectId: 7,
      worktreePath: "/repo/main",
      entry,
      diffText: "",
      loading: true,
      error: "",
    });

    expect(
      createGitHistoryDiffModalOpenState({
        projectId: 7,
        worktreePath: "/repo/main",
        entry,
        cached: {
          commit: cachedCommit,
          diffText: "+cached diff",
        },
      }),
    ).toEqual({
      projectId: 7,
      worktreePath: "/repo/main",
      entry: cachedCommit,
      diffText: "+cached diff",
      loading: false,
      error: "",
    });
  });

  it("builds stable commit-diff cache keys", () => {
    expect(gitHistoryDiffCacheKey(7, "/repo/main", "abc123")).toBe(
      "7::/repo/main::abc123",
    );
  });

  it("detects and handles scroll positions near the loading threshold", () => {
    let scrollTop = 0;
    let loadCount = 0;
    const currentTarget = {
      clientHeight: 200,
      scrollHeight: 1_000,
      scrollTop: 1_000 - 200 - GIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
    };
    const event = { currentTarget };

    expect(isGitHistoryLoadMoreThresholdReached(currentTarget)).toBeTrue();

    handleGitHistoryScrollPosition(
      event as Parameters<typeof handleGitHistoryScrollPosition>[0],
      (value) => {
        scrollTop = value;
      },
      () => {
        loadCount += 1;
      },
    );

    expect(scrollTop).toBe(currentTarget.scrollTop);
    expect(loadCount).toBe(1);
  });

  it("trims retained git history entries", () => {
    const entries = Array.from(
      { length: GIT_HISTORY_MAX_RETAINED_ENTRIES + 1 },
      (_, index): RpcGitHistoryEntry => ({
        authorName: "Alice",
        committedAt: "2026-05-05T00:00:00Z",
        hash: `hash-${index}`,
        shortHash: `${index}`,
        subject: `Commit ${index}`,
      }),
    );
    const result: RpcWorktreeGitHistoryResult = {
      branch: "main",
      entries,
      headHash: "hash-0",
      headShortHash: "0",
      lastUpdatedAt: "2026-05-05T00:00:00Z",
      limit: 20,
      nextOffset: 220,
      projectId: 7,
      worktreePath: "/repo/main",
    };

    const trimmed = trimGitHistoryResultEntries(result);

    expect(trimmed.entries).toHaveLength(GIT_HISTORY_MAX_RETAINED_ENTRIES);
    expect(trimmed.nextOffset).toBeNull();
  });

  it("estimates git cache payload sizes from retained text", () => {
    const commit: RpcGitHistoryEntry = {
      authorName: "Alice",
      committedAt: "2026-05-05T00:00:00Z",
      hash: "abc123",
      shortHash: "abc123",
      subject: "Initial commit",
    };
    const result: RpcWorktreeGitHistoryResult = {
      branch: "main",
      entries: [commit],
      headHash: "abc123",
      headShortHash: "abc123",
      lastUpdatedAt: "2026-05-05T00:00:00Z",
      limit: 20,
      nextOffset: null,
      projectId: 7,
      worktreePath: "/repo/main",
    };

    expect(estimateGitHistoryResultBytes(result)).toBeGreaterThan(0);
    expect(
      estimateGitHistoryDiffCacheEntryBytes({ commit, diffText: "+hello" }),
    ).toBeGreaterThan(
      estimateGitHistoryResultBytes({ ...result, entries: [] }),
    );
  });
});
