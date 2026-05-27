/**
 * @file src/mainview/app/project-worktree-state.test.ts
 * @description Tests for project/worktree UI state pruning helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcWorktree } from "../../bun/rpc-schema";
import {
  buildProjectWorktreeIndex,
  defaultProjectState,
  defaultWorktreeState,
  type ProjectStateMap,
  pruneProjectStates,
  pruneWorktreeStates,
  type WorktreeStateMap,
  worktreeKey,
} from "./project-worktree-state";

function worktree(path: string): RpcWorktree {
  return {
    branch: path.split("/").at(-1) ?? "main",
    path,
    pinnedAt: null,
  } as RpcWorktree;
}

describe("project/worktree state pruning", () => {
  it("removes project state absent from canonical project snapshots", () => {
    const states: ProjectStateMap = {
      1: defaultProjectState(),
      2: defaultProjectState(),
    };

    expect(Object.keys(pruneProjectStates(states, [2]))).toEqual(["2"]);
  });

  it("removes stale open worktree paths no longer in the project snapshot", () => {
    const state = {
      ...defaultProjectState(),
      ...buildProjectWorktreeIndex([worktree("/repos/alpha")]),
      openWorktrees: new Set(["/repos/alpha", "/repos/stale"]),
    };

    const pruned = pruneProjectStates({ 1: state }, [1]);

    expect([...new Set(pruned[1]?.openWorktrees)]).toEqual(["/repos/alpha"]);
  });

  it("keeps known and explicitly opened worktree state while pruning unreachable entries", () => {
    const projectStates: ProjectStateMap = {
      1: {
        ...defaultProjectState(),
        ...buildProjectWorktreeIndex([worktree("/repos/alpha")]),
        openWorktrees: new Set(["/repos/open"]),
      },
    };
    const states: WorktreeStateMap = {
      [worktreeKey(1, "/repos/alpha")]: defaultWorktreeState(),
      [worktreeKey(1, "/repos/open")]: defaultWorktreeState(),
      [worktreeKey(1, "/repos/visible")]: {
        ...defaultWorktreeState(),
        opened: true,
      },
      [worktreeKey(1, "/repos/stale")]: defaultWorktreeState(),
      [worktreeKey(2, "/repos/other")]: defaultWorktreeState(),
    };

    expect(
      Object.keys(pruneWorktreeStates(states, projectStates)).sort(),
    ).toEqual([
      worktreeKey(1, "/repos/alpha"),
      worktreeKey(1, "/repos/open"),
      worktreeKey(1, "/repos/visible"),
    ]);
  });
});
