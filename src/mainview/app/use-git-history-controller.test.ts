/**
 * @file src/mainview/app/use-git-history-controller.test.ts
 * @description Test file for git history controller helpers.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcProject,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import {
  canLoadMoreGitHistory,
  resolveGitHistoryLoadBehavior,
} from "./use-git-history-controller";

function project(): RpcProject {
  return {
    id: 7,
    path: "/repo",
  } as RpcProject;
}

function history(
  overrides?: Partial<RpcWorktreeGitHistoryResult>,
): RpcWorktreeGitHistoryResult {
  return {
    branch: "main",
    entries: [],
    headHash: "abc123",
    nextOffset: 50,
    projectId: 7,
    totalCount: 100,
    worktreePath: "/repo",
    ...overrides,
  } as RpcWorktreeGitHistoryResult;
}

describe("git history controller helpers", () => {
  it("resolves cached-history behavior without forcing extra booleans into the hook", () => {
    expect(
      resolveGitHistoryLoadBehavior({
        cachedHistory: history(),
        preferCached: true,
        skipRefreshWhenCached: true,
      }),
    ).toEqual({
      serveCachedHistory: true,
      silentRefresh: true,
      skipRefreshWhenCached: true,
    });

    expect(
      resolveGitHistoryLoadBehavior({
        cachedHistory: null,
        preferCached: true,
        silent: false,
      }),
    ).toEqual({
      serveCachedHistory: false,
      silentRefresh: false,
      skipRefreshWhenCached: false,
    });
  });

  it("only loads more history when selection, pagination, and loading guards allow it", () => {
    expect(
      canLoadMoreGitHistory({
        activeSelectedWorktreePath: "/repo",
        gitHistory: history(),
        gitHistoryLoading: false,
        gitHistoryLoadingMore: false,
        hasPendingLoadMore: false,
        selectedProject: project(),
      }),
    ).toBeTrue();

    expect(
      canLoadMoreGitHistory({
        activeSelectedWorktreePath: null,
        gitHistory: history(),
        gitHistoryLoading: false,
        gitHistoryLoadingMore: false,
        hasPendingLoadMore: false,
        selectedProject: project(),
      }),
    ).toBeFalse();
    expect(
      canLoadMoreGitHistory({
        activeSelectedWorktreePath: "/repo",
        gitHistory: history({ nextOffset: null }),
        gitHistoryLoading: false,
        gitHistoryLoadingMore: false,
        hasPendingLoadMore: false,
        selectedProject: project(),
      }),
    ).toBeFalse();
    expect(
      canLoadMoreGitHistory({
        activeSelectedWorktreePath: "/repo",
        gitHistory: history(),
        gitHistoryLoading: true,
        gitHistoryLoadingMore: false,
        hasPendingLoadMore: false,
        selectedProject: project(),
      }),
    ).toBeFalse();
    expect(
      canLoadMoreGitHistory({
        activeSelectedWorktreePath: "/repo",
        gitHistory: history(),
        gitHistoryLoading: false,
        gitHistoryLoadingMore: false,
        hasPendingLoadMore: true,
        selectedProject: project(),
      }),
    ).toBeFalse();
  });
});
