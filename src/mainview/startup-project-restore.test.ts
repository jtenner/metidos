/**
 * @file src/mainview/startup-project-restore.test.ts
 * @description Test file for startup project restore.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcOpenProjectsBatchResultItem,
  RpcProject,
} from "../bun/rpc-schema";
import {
  closeProjectsForStartupRestore,
  collectStartupRestoreProjectIds,
  reconcileStartupProjectRestore,
} from "./startup-project-restore";

/**
 * Builds a project fixture.
 * @param id - Identifier value.
 * @param path - Filesystem path.
 * @param options - Configuration options used by this operation.
 */

function project(
  id: number,
  path: string,
  options?: Partial<Pick<RpcProject, "isOpen" | "name">>,
): RpcProject {
  return {
    createdAt: "2026-04-04T00:00:00.000Z",
    id,
    isOpen: options?.isOpen ?? 0,
    lastOpenedAt: "2026-04-04T00:00:00.000Z",
    name: options?.name ?? `Project ${id}`,
    path,
    updatedAt: "2026-04-04T00:00:00.000Z",
  };
}

describe("startup project restore helpers", () => {
  it("forces projects closed until restore confirmation arrives", () => {
    const closed = closeProjectsForStartupRestore([
      project(1, "/repo-a", { isOpen: 1 }),
      project(2, "/repo-b", { isOpen: 0 }),
    ]);

    expect(closed.map((entry) => entry.isOpen)).toEqual([0, 0]);
  });

  it("collects every project id whose workspace state should be restored", () => {
    const restored = collectStartupRestoreProjectIds({
      initialProjectId: 3,
      initialThreadProjectId: 2,
      initiallyOpenProjectTreePaths: new Set(["/repo-a"]),
      loadedProjects: [
        project(1, "/repo-a"),
        project(2, "/repo-b"),
        project(3, "/repo-c"),
      ],
      openWorktrees: [
        {
          projectId: 4,
        },
      ],
      selectedProjectId: 5,
    });

    expect([...restored].sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("falls back to the first loaded project when no startup selection is available", () => {
    const restored = collectStartupRestoreProjectIds({
      initialProjectId: null,
      initialThreadProjectId: null,
      initiallyOpenProjectTreePaths: new Set<string>(),
      loadedProjects: [project(7, "/repo-a"), project(8, "/repo-b")],
      openWorktrees: [],
      selectedProjectId: null,
    });

    expect([...restored]).toEqual([7]);
  });

  it("keeps failed restore targets closed and reports their tree paths", () => {
    const projects = closeProjectsForStartupRestore([
      project(1, "/repo-a", { isOpen: 1 }),
      project(2, "/repo-b", { isOpen: 1 }),
    ]);
    const results: RpcOpenProjectsBatchResultItem[] = [
      {
        error: "missing git metadata",
        ok: false,
        projectId: 1,
      },
      {
        ok: true,
        project: {
          ...project(2, "/repo-b", { isOpen: 1 }),
          name: "Recovered Repo",
        },
        projectId: 2,
        worktrees: [],
      },
    ];

    const reconciled = reconcileStartupProjectRestore({
      allowSelectedProjectFallback: false,
      projects,
      results,
      selectedProjectId: 1,
      selectedWorktreePath: "/repo-a",
    });

    expect(reconciled.projects.find((entry) => entry.id === 1)?.isOpen).toBe(0);
    expect(reconciled.projects.find((entry) => entry.id === 2)?.isOpen).toBe(1);
    expect([...reconciled.failedProjectPaths]).toEqual(["/repo-a"]);
    expect(reconciled.selectedProjectId).toBe(1);
    expect(reconciled.selectedWorktreePath).toBe("/repo-a");
  });

  it("retargets project selection to a confirmed open project when fallback is allowed", () => {
    const projects = closeProjectsForStartupRestore([
      project(1, "/repo-a", { isOpen: 1 }),
      project(2, "/repo-b", { isOpen: 1 }),
    ]);
    const results: RpcOpenProjectsBatchResultItem[] = [
      {
        error: "project removed",
        ok: false,
        projectId: 1,
      },
      {
        ok: true,
        project: project(2, "/repo-b", { isOpen: 1 }),
        projectId: 2,
        worktrees: [],
      },
    ];

    const reconciled = reconcileStartupProjectRestore({
      allowSelectedProjectFallback: true,
      projects,
      results,
      selectedProjectId: 1,
      selectedWorktreePath: "/repo-a",
    });

    expect(reconciled.selectedProjectId).toBe(2);
    expect(reconciled.selectedWorktreePath).toBe("/repo-b");
  });
});
