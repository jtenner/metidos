/**
 * @file src/mainview/app/projects-panel.test.ts
 * @description Test file for projects panel.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { buildNormalizedSearchText } from "../controls/search-utils";
import {
  deriveProjectsPanelRows,
  worktreePinButtonVisibilityClassName,
} from "./projects-panel";
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

describe("deriveProjectsPanelRows", () => {
  it("keeps the primary folder first and orders subprojects by pin state and name", () => {
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

    const rows = deriveProjectsPanelRows(
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

    expect(
      rows.map((row) => ({
        kind: row.kind,
        path: row.worktree.path,
      })),
    ).toEqual([
      {
        kind: "project",
        path: "/repos/alpha",
      },
      {
        kind: "subproject",
        path: "/repos/alpha/beta",
      },
      {
        kind: "subproject",
        path: "/repos/alpha/zeta",
      },
      {
        kind: "subproject",
        path: "/repos/alpha/alpha",
      },
      {
        kind: "subproject",
        path: "/repos/alpha/delta",
      },
    ]);
  });

  it("filters the flat list down to matching folders", () => {
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

    const rows = deriveProjectsPanelRows(
      filteredProjects,
      (projectId) => worktreesByProjectId.get(projectId) ?? [],
      "release",
      worktreeSearchTextByKey,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "subproject",
      worktree: {
        path: "/repos/gamma/release",
      },
    });
  });
});

describe("worktreePinButtonVisibilityClassName", () => {
  it("keeps pinned worktree pin buttons visible", () => {
    expect(worktreePinButtonVisibilityClassName(true)).toBe("opacity-100");
  });

  it("reveals unpinned worktree pin buttons only on hover or focus", () => {
    expect(worktreePinButtonVisibilityClassName(false)).toContain("opacity-0");
    expect(worktreePinButtonVisibilityClassName(false)).toContain(
      "group-hover/worktree:opacity-100",
    );
    expect(worktreePinButtonVisibilityClassName(false)).toContain(
      "group-focus-within/worktree:opacity-100",
    );
  });
});
