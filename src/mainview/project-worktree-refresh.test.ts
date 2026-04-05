import { describe, expect, it } from "bun:test";

import type { RpcWorktree } from "../bun/rpc-schema";
import type { ProjectNodeState } from "./app/state";
import {
  PROJECT_ACTION_MENU_WORKTREE_REFRESH_STALE_MS,
  shouldRefreshProjectActionMenuWorktrees,
} from "./project-worktree-refresh";

function worktree(overrides?: Partial<RpcWorktree>): RpcWorktree {
  return {
    path: "/repo",
    branch: "main",
    head: "abc123",
    bare: false,
    pinnedAt: null,
    ...overrides,
  };
}

function projectState(overrides?: Partial<ProjectNodeState>): ProjectNodeState {
  return {
    error: "",
    loadingWorktrees: false,
    openWorktrees: new Set(),
    worktrees: [],
    worktreesLoadedAt: null,
    ...overrides,
  };
}

describe("project worktree refresh helpers", () => {
  it("skips project-action-menu refreshes for recent cached worktrees", () => {
    expect(
      shouldRefreshProjectActionMenuWorktrees(
        projectState({
          worktrees: [worktree()],
          worktreesLoadedAt: 100,
        }),
        100 + PROJECT_ACTION_MENU_WORKTREE_REFRESH_STALE_MS - 1,
      ),
    ).toBeFalse();
  });

  it("refreshes project-action-menu worktrees when the cache is stale", () => {
    expect(
      shouldRefreshProjectActionMenuWorktrees(
        projectState({
          worktrees: [worktree()],
          worktreesLoadedAt: 100,
        }),
        100 + PROJECT_ACTION_MENU_WORKTREE_REFRESH_STALE_MS,
      ),
    ).toBeTrue();
  });

  it("refreshes when cached worktrees are missing or errored", () => {
    expect(shouldRefreshProjectActionMenuWorktrees(projectState())).toBeTrue();
    expect(
      shouldRefreshProjectActionMenuWorktrees(
        projectState({
          error: "refresh failed",
          worktrees: [worktree()],
          worktreesLoadedAt: Date.now(),
        }),
      ),
    ).toBeTrue();
  });

  it("skips refresh when a worktree load is already in progress", () => {
    expect(
      shouldRefreshProjectActionMenuWorktrees(
        projectState({
          loadingWorktrees: true,
        }),
      ),
    ).toBeFalse();
  });
});
