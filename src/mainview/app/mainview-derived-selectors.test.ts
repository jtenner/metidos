/**
 * @file src/mainview/app/mainview-derived-selectors.test.ts
 * @description Test file for mainview derived selectors.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import {
  buildProjectWorktreeDerivedMaps,
  buildSidebarProjectSearchIndexes,
  deriveProjectWorktreesById,
  filterProjectsBySidebarSearch,
} from "./mainview-derived-selectors";
import { buildProjectWorktreeIndex, worktreeKey } from "./state";

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

describe("mainview derived selectors", () => {
  it("materializes project worktree arrays from indexed project state", () => {
    const projects = [project(7, "/Users/example/project")];
    const projectStates = new Map([
      [
        7,
        buildProjectWorktreeIndex([
          worktree("/Users/example/project"),
          worktree("/Users/example/project/feature"),
        ]),
      ],
    ]);

    const result = deriveProjectWorktreesById(
      projects,
      (projectId) =>
        projectStates.get(projectId) ?? buildProjectWorktreeIndex([]),
    );

    expect(result.get(7)?.map((entry) => entry.path)).toEqual([
      "/Users/example/project",
      "/Users/example/project/feature",
    ]);
  });

  it("builds shared worktree lookups and formatted display paths in one pass", () => {
    const projects = [project(7, "/Users/example/project")];
    const projectWorktreesById = new Map<number, RpcWorktree[]>([
      [
        7,
        [
          worktree("/Users/example/project"),
          worktree("/Users/example/project/feature"),
        ],
      ],
    ]);

    const result = buildProjectWorktreeDerivedMaps({
      homeDirectory: "/Users/example",
      projectWorktreesById,
      projects,
      supportsTildePath: true,
    });

    expect(
      result.worktreeByProjectAndPath.get(
        worktreeKey(7, "/Users/example/project/feature"),
      )?.path,
    ).toBe("/Users/example/project/feature");
    expect(
      result.worktreeDisplayPathByKey.get(
        worktreeKey(7, "/Users/example/project/feature"),
      ),
    ).toBe("~/project/feature");
  });

  it("filters projects by either project metadata or matching worktree text", () => {
    const projects = [
      project(7, "/Users/example/project"),
      project(8, "/srv/shared/ops"),
    ];
    const projectWorktreesById = new Map<number, RpcWorktree[]>([
      [
        7,
        [
          worktree("/Users/example/project"),
          worktree(
            "/Users/example/project/feature-redesign",
            "feature/redesign",
          ),
        ],
      ],
      [8, [worktree("/srv/shared/ops")]],
    ]);

    const { worktreeDisplayPathByKey } = buildProjectWorktreeDerivedMaps({
      homeDirectory: "/Users/example",
      projectWorktreesById,
      projects,
      supportsTildePath: true,
    });
    const searchIndexes = buildSidebarProjectSearchIndexes({
      homeDirectory: "/Users/example",
      projectWorktreesById,
      projects,
      supportsTildePath: true,
      worktreeDisplayPathByKey,
    });

    expect(
      filterProjectsBySidebarSearch({
        normalizedSidebarSearchQuery: "~/project",
        projectSearchTextById: searchIndexes.projectSearchTextById,
        projectWorktreesById,
        projects,
        worktreeSearchTextByKey: searchIndexes.worktreeSearchTextByKey,
      }).map((entry) => entry.id),
    ).toEqual([7]);

    expect(
      filterProjectsBySidebarSearch({
        normalizedSidebarSearchQuery: "feature/redesign",
        projectSearchTextById: searchIndexes.projectSearchTextById,
        projectWorktreesById,
        projects,
        worktreeSearchTextByKey: searchIndexes.worktreeSearchTextByKey,
      }).map((entry) => entry.id),
    ).toEqual([7]);
  });

  it("keeps large synthetic sidebar filtering deterministic", () => {
    const projects = Array.from({ length: 250 }, (_, index) =>
      project(index + 1, `/repos/project-${index + 1}`),
    );
    const projectWorktreesById = new Map<number, RpcWorktree[]>(
      projects.map((entry, index) => [
        entry.id,
        [
          worktree(entry.path),
          worktree(
            `${entry.path}/feature-${index + 1}`,
            `feature/${index + 1}`,
          ),
          worktree(
            `${entry.path}/release-${index + 1}`,
            `release/${index + 1}`,
          ),
        ],
      ]),
    );

    const { worktreeDisplayPathByKey } = buildProjectWorktreeDerivedMaps({
      homeDirectory: "/repos",
      projectWorktreesById,
      projects,
      supportsTildePath: true,
    });
    const searchIndexes = buildSidebarProjectSearchIndexes({
      homeDirectory: "/repos",
      projectWorktreesById,
      projects,
      supportsTildePath: true,
      worktreeDisplayPathByKey,
    });

    const result = filterProjectsBySidebarSearch({
      normalizedSidebarSearchQuery: "feature/249",
      projectSearchTextById: searchIndexes.projectSearchTextById,
      projectWorktreesById,
      projects,
      worktreeSearchTextByKey: searchIndexes.worktreeSearchTextByKey,
    });

    expect(result.map((entry) => entry.id)).toEqual([249]);
  });
});
