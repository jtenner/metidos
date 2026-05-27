/**
 * @file src/bun/project-procedures/project-worktrees.test.ts
 * @description Tests for Project/Worktree listing and visibility helpers.
 */

import { describe, expect, it } from "bun:test";
import type { RpcWorktree } from "../rpc-schema";
import {
  createProjectRootWorkspaceWorktree,
  filterProjectWorktreesForAccess,
  isGitWorkspaceUnavailableError,
  reconcileProjectPrimaryWorktreePath,
  splitProjectWorktreesForVisibility,
} from "./project-worktree-lifecycle";

function worktree(path: string): RpcWorktree {
  return {
    path,
    bare: false,
    branch: null,
    head: null,
    pinnedAt: null,
  };
}

describe("project worktree helpers", () => {
  it("splits visible tracked worktrees from hidden untracked worktrees", () => {
    const project = worktree("/repo");
    const feature = worktree("/repo-feature");
    const hidden = worktree("/repo-hidden");

    expect(
      splitProjectWorktreesForVisibility(
        project.path,
        [{ worktreePath: feature.path, pinnedAt: "2026-05-01T00:00:00Z" }],
        [hidden, feature, project],
        true,
      ),
    ).toEqual({
      hiddenWorktrees: [hidden],
      worktrees: [{ ...feature, pinnedAt: "2026-05-01T00:00:00Z" }, project],
    });
  });

  it("creates a visible root workspace row for folders without git worktrees", () => {
    expect(
      createProjectRootWorkspaceWorktree(
        "/home/alice/project",
        "2026-05-08T19:40:00.000Z",
      ),
    ).toEqual({
      path: "/home/alice/project",
      bare: false,
      branch: null,
      head: null,
      pinnedAt: "2026-05-08T19:40:00.000Z",
    });
  });

  it("reconciles the requested root path only when git reports an equivalent primary worktree", () => {
    expect(
      reconcileProjectPrimaryWorktreePath("/repo", [
        worktree("/repo-feature"),
        worktree("/repo"),
      ]),
    ).toEqual([worktree("/repo-feature"), worktree("/repo")]);

    expect(
      reconcileProjectPrimaryWorktreePath("/repo", [worktree("/repo-feature")]),
    ).toEqual([]);
  });

  it("delegates path access decisions to the caller's workspace rules", () => {
    expect(
      filterProjectWorktreesForAccess(
        [worktree("/home/alice/project"), worktree("/tmp/outside")],
        (path) => path.startsWith("/home/alice/"),
      ).map((entry) => entry.path),
    ).toEqual(["/home/alice/project"]);
  });

  it("recognizes git availability failures", () => {
    expect(
      isGitWorkspaceUnavailableError(new Error("fatal: not a git repository")),
    ).toBe(true);
    expect(isGitWorkspaceUnavailableError(new Error("permission denied"))).toBe(
      false,
    );
  });
});
