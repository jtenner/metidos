/**
 * @file src/mainview/app/projects-panel.test.ts
 * @description Test file for projects panel.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { buildNormalizedSearchText } from "../controls/search-utils";
import { deriveProjectsPanelWorktreeData } from "./projects-panel";
import { worktreeKey } from "./state";

function createProject(id: number, name: string, path: string): RpcProject {
  return {
    id,
    path,
    name,
    isOpen: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    lastOpenedAt: "2026-04-04T00:00:00.000Z",
  };
}

function createWorktree(
  path: string,
  branch: string | null,
  pinnedAt: string | null,
): RpcWorktree {
  return {
    path,
    branch,
    head: null,
    bare: false,
    pinnedAt,
  };
}

function buildWorktreeSearchText(
  projects: RpcProject[],
  worktreesByProjectId: ReadonlyMap<number, RpcWorktree[]>,
): Map<string, string> {
  const next = new Map<string, string>();

  for (const project of projects) {
    for (const worktree of worktreesByProjectId.get(project.id) ?? []) {
      next.set(
        worktreeKey(project.id, worktree.path),
        buildNormalizedSearchText(project.name, worktree.branch, worktree.path),
      );
    }
  }

  return next;
}

describe("deriveProjectsPanelWorktreeData", () => {
  it("orders pinned worktrees first and then alphabetically by workspace name", () => {
    const project = createProject(1, "Alpha", "/repos/alpha");
    const filteredProjects = [project];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [
        project.id,
        [
          createWorktree("/repos/alpha/delta", "delta", null),
          createWorktree(
            "/repos/alpha/zeta",
            "zeta",
            "2026-04-04T10:00:00.000Z",
          ),
          createWorktree("/repos/alpha/alpha", "alpha", null),
          createWorktree(
            "/repos/alpha/beta",
            "beta",
            "2026-04-04T09:00:00.000Z",
          ),
        ],
      ],
    ]);
    const worktreeSearchTextByKey = buildWorktreeSearchText(
      filteredProjects,
      worktreesByProjectId,
    );
    const callsByProjectId = new Map<number, number>();

    const data = deriveProjectsPanelWorktreeData(
      filteredProjects,
      (projectId) => {
        callsByProjectId.set(
          projectId,
          (callsByProjectId.get(projectId) ?? 0) + 1,
        );
        return worktreesByProjectId.get(projectId) ?? [];
      },
      "",
      worktreeSearchTextByKey,
    );

    expect(callsByProjectId).toEqual(new Map([[project.id, 1]]));

    const sections = data.get(project.id);
    expect(sections?.visibleWorktrees.map((worktree) => worktree.path)).toEqual(
      [
        "/repos/alpha/beta",
        "/repos/alpha/zeta",
        "/repos/alpha/alpha",
        "/repos/alpha/delta",
      ],
    );
  });

  it("filters out nonmatching worktrees without changing the selector order", () => {
    const project = createProject(7, "Gamma", "/repos/gamma");
    const filteredProjects = [project];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [
        project.id,
        [
          createWorktree(
            "/repos/gamma/feature",
            "feature",
            "2026-04-04T10:00:00.000Z",
          ),
          createWorktree("/repos/gamma/release", "release", null),
          createWorktree("/repos/gamma", "main", null),
        ],
      ],
    ]);
    const worktreeSearchTextByKey = buildWorktreeSearchText(
      filteredProjects,
      worktreesByProjectId,
    );

    const data = deriveProjectsPanelWorktreeData(
      filteredProjects,
      (projectId) => worktreesByProjectId.get(projectId) ?? [],
      "release",
      worktreeSearchTextByKey,
    );

    const sections = data.get(project.id);
    expect(sections?.visibleWorktrees.map((worktree) => worktree.path)).toEqual(
      ["/repos/gamma/release"],
    );
  });
});
