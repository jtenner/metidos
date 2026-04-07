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
  it("sorts once per project and keeps pinned worktrees scoped to their own project tree", () => {
    const betaProject = createProject(2, "Beta", "/repos/beta");
    const alphaProject = createProject(1, "Alpha", "/repos/alpha");
    const filteredProjects = [betaProject, alphaProject];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [
        betaProject.id,
        [
          createWorktree(
            "/repos/beta/feature",
            "feature",
            "2026-04-04T09:00:00.000Z",
          ),
          createWorktree("/repos/beta", "main", null),
          createWorktree("/repos/beta/release", "release", null),
        ],
      ],
      [
        alphaProject.id,
        [
          createWorktree(
            "/repos/alpha/feature",
            "feature",
            "2026-04-04T10:00:00.000Z",
          ),
          createWorktree("/repos/alpha/release", "release", null),
          createWorktree("/repos/alpha", "main", null),
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

    expect(callsByProjectId).toEqual(
      new Map([
        [betaProject.id, 1],
        [alphaProject.id, 1],
      ]),
    );

    const betaSections = data.get(betaProject.id);
    const alphaSections = data.get(alphaProject.id);

    expect(betaSections?.hasPinnedWorktrees).toBeTrue();
    expect(
      betaSections?.orderedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/beta/feature", "/repos/beta", "/repos/beta/release"]);
    expect(
      betaSections?.visiblePinnedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/beta/feature"]);
    expect(
      betaSections?.visibleUnpinnedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/beta", "/repos/beta/release"]);

    expect(alphaSections?.hasPinnedWorktrees).toBeTrue();
    expect(
      alphaSections?.orderedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/alpha/feature", "/repos/alpha", "/repos/alpha/release"]);
    expect(
      alphaSections?.visiblePinnedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/alpha/feature"]);
    expect(
      alphaSections?.visibleUnpinnedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/alpha", "/repos/alpha/release"]);
  });

  it("keeps nonmatching pinned worktrees out of the visible pinned subsection while preserving pinned presence per project", () => {
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
    expect(sections?.hasPinnedWorktrees).toBeTrue();
    expect(sections?.visiblePinnedWorktrees).toEqual([]);
    expect(
      sections?.visibleUnpinnedWorktrees.map((worktree) => worktree.path),
    ).toEqual(["/repos/gamma/release"]);
  });
});
