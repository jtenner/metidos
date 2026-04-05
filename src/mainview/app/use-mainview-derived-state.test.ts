/**
 * @file src/mainview/app/use-mainview-derived-state.test.ts
 * @description Test file for use mainview derived state.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { worktreeKey } from "./state";
import { deriveWorktreeDisplayPathByKey } from "./use-mainview-derived-state";

function project(id: number, path: string): RpcProject {
  return {
    createdAt: "2026-04-04T00:00:00.000Z",
    id,
    isOpen: 1,
    lastOpenedAt: "2026-04-04T00:00:00.000Z",
    name: `Project ${id}`,
    path,
    updatedAt: "2026-04-04T00:00:00.000Z",
  };
}

function worktree(path: string, branch: string | null = "main"): RpcWorktree {
  return {
    bare: false,
    branch,
    head: "abc123",
    path,
    pinnedAt: null,
  };
}

describe("deriveWorktreeDisplayPathByKey", () => {
  it("preformats worktree display paths with home-directory shorthand", () => {
    const projects = [project(7, "/Users/example/project")];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [
        7,
        [
          worktree("/Users/example/project"),
          worktree("/Users/example/project/feature"),
          worktree("/srv/shared/project"),
        ],
      ],
    ]);

    const result = deriveWorktreeDisplayPathByKey(
      projects,
      (projectId) => worktreesByProjectId.get(projectId) ?? [],
      "/Users/example",
      true,
    );

    expect(result.get(worktreeKey(7, "/Users/example/project"))).toBe(
      "~/project",
    );
    expect(result.get(worktreeKey(7, "/Users/example/project/feature"))).toBe(
      "~/project/feature",
    );
    expect(result.get(worktreeKey(7, "/srv/shared/project"))).toBe(
      "/srv/shared/project",
    );
  });

  it("falls back to raw paths when tilde formatting is disabled", () => {
    const projects = [project(3, "/Users/example/project")];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [3, [worktree("/Users/example/project/feature")]],
    ]);

    const result = deriveWorktreeDisplayPathByKey(
      projects,
      (projectId) => worktreesByProjectId.get(projectId) ?? [],
      "/Users/example",
      false,
    );

    expect(result.get(worktreeKey(3, "/Users/example/project/feature"))).toBe(
      "/Users/example/project/feature",
    );
  });
});
