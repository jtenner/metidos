import { describe, expect, it } from "bun:test";

import type {
  RpcOpenWorktreeRequest,
  RpcProject,
  RpcWorktree,
} from "../bun/rpc-schema";
import {
  filterStartupWorktreeRestoreRequests,
  reconcileStartupSelectedWorktreePath,
} from "./startup-worktree-restore";

function project(
  id: number,
  path: string,
  options?: Partial<Pick<RpcProject, "isOpen" | "name">>,
): RpcProject {
  return {
    createdAt: "2026-04-04T00:00:00.000Z",
    id,
    isOpen: options?.isOpen ?? 1,
    lastOpenedAt: "2026-04-04T00:00:00.000Z",
    name: options?.name ?? `Project ${id}`,
    path,
    updatedAt: "2026-04-04T00:00:00.000Z",
  };
}

function worktree(path: string, branch = "feature"): RpcWorktree {
  return {
    bare: false,
    branch,
    head: "abc123",
    path,
    pinnedAt: null,
  };
}

describe("startup worktree restore helpers", () => {
  it("filters startup worktree restores to projects that actually reopened", () => {
    const requests: RpcOpenWorktreeRequest[] = [
      { projectId: 1, worktreePath: "/repo-a" },
      { projectId: 2, worktreePath: "/repo-b" },
      { projectId: 3, worktreePath: "/repo-c" },
    ];

    expect(
      filterStartupWorktreeRestoreRequests(requests, new Set([1, 3])),
    ).toEqual([
      { projectId: 1, worktreePath: "/repo-a" },
      { projectId: 3, worktreePath: "/repo-c" },
    ]);
  });

  it("falls back to the primary worktree when the selected restore failed", () => {
    const reconciled = reconcileStartupSelectedWorktreePath({
      allowFallback: true,
      project: project(1, "/repo-a"),
      restoredOpenWorktrees: [
        {
          error: "missing worktree",
          ok: false,
          projectId: 1,
          worktreePath: "/repo-a/feature",
        },
      ],
      selectedWorktreePath: "/repo-a/feature",
      worktrees: [worktree("/repo-a"), worktree("/repo-a/feature")],
    });

    expect(reconciled).toBe("/repo-a");
  });

  it("falls back to the primary worktree when the selected path is no longer tracked", () => {
    const reconciled = reconcileStartupSelectedWorktreePath({
      allowFallback: true,
      project: project(1, "/repo-a"),
      restoredOpenWorktrees: [],
      selectedWorktreePath: "/repo-a/missing",
      worktrees: [worktree("/repo-a"), worktree("/repo-a/feature")],
    });

    expect(reconciled).toBe("/repo-a");
  });

  it("preserves a valid selected worktree even when it was not part of the open-worktree restore set", () => {
    const reconciled = reconcileStartupSelectedWorktreePath({
      allowFallback: true,
      project: project(1, "/repo-a"),
      restoredOpenWorktrees: [],
      selectedWorktreePath: "/repo-a/feature",
      worktrees: [worktree("/repo-a"), worktree("/repo-a/feature")],
    });

    expect(reconciled).toBe("/repo-a/feature");
  });
});
