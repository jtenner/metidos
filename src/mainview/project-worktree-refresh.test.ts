/**
 * @file src/mainview/project-worktree-refresh.test.ts
 * @description Test file for project worktree refresh.
 */

import { describe, expect, it } from "bun:test";

import type { RpcWorktree } from "../bun/rpc-schema";
import { buildProjectWorktreeIndex, type ProjectNodeState } from "./app/state";
import {
  buildLoadedProjectWorktreesState,
  PROJECT_ACTION_MENU_WORKTREE_REFRESH_STALE_MS,
  shouldRefreshProjectActionMenuWorktrees,
  shouldUseCachedProjectWorktrees,
} from "./project-worktree-refresh";

/**
 * Builds a worktree fixture.
 * @param overrides - Optional test overrides used to construct the worktree state.
 */

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
/**
 * Performs projectState operation.
 * @param overrides - Optional test overrides used to construct project state.
 */

function projectState(overrides?: Partial<ProjectNodeState>): ProjectNodeState {
  return {
    error: "",
    loadingWorktrees: false,
    openWorktrees: new Set(),
    ...buildProjectWorktreeIndex([]),
    worktreesLoadedAt: null,
    ...overrides,
  };
}

describe("project worktree refresh helpers", () => {
  it("builds a loaded worktree snapshot with timestamps and cleared loading state", () => {
    expect(buildLoadedProjectWorktreesState([worktree()], 1234)).toEqual({
      ...buildProjectWorktreeIndex([worktree()]),
      error: "",
      loadingWorktrees: false,
      worktreesLoadedAt: 1234,
    });
  });

  it("uses cached worktrees only when preferred and present", () => {
    expect(
      shouldUseCachedProjectWorktrees(
        projectState({
          ...buildProjectWorktreeIndex([worktree()]),
        }),
      ),
    ).toBeTrue();
    expect(
      shouldUseCachedProjectWorktrees(
        projectState({
          ...buildProjectWorktreeIndex([worktree()]),
        }),
        {
          preferCached: false,
        },
      ),
    ).toBeFalse();
    expect(shouldUseCachedProjectWorktrees(projectState())).toBeFalse();
  });

  it("skips project-action-menu refreshes for recent cached worktrees", () => {
    expect(
      shouldRefreshProjectActionMenuWorktrees(
        projectState({
          ...buildProjectWorktreeIndex([worktree()]),
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
          ...buildProjectWorktreeIndex([worktree()]),
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
          ...buildProjectWorktreeIndex([worktree()]),
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
