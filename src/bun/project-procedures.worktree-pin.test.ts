/**
 * @file src/bun/project-procedures.worktree-pin.test.ts
 * @description Regression tests for worktree pin lifecycle procedures.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  initAppDatabase,
  listProjectWorktreesMetadata,
  resetResolvedAppDataDirectory,
  setProjectWorktreePinned,
  upsertProject,
} from "./db";

type ProjectProceduresModule = typeof import("./project-procedures");

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

async function loadProjectProcedures(): Promise<ProjectProceduresModule> {
  return (await import(
    `./project-procedures?worktree-pin=${Date.now()}-${Math.random()}`
  )) as ProjectProceduresModule;
}

beforeEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
    "metidos-worktree-pin-app-",
  );
});

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("setWorktreePinnedProcedure", () => {
  it("unpins a tracked worktree whose folder has been deleted", async () => {
    const database = initAppDatabase();
    const projectPath = createTempDirectory("metidos-worktree-pin-project-");
    const deletedWorktreePath = join(projectPath, "deleted-worktree");
    const project = upsertProject(database, {
      name: "Pinned project",
      projectPath,
    });
    setProjectWorktreePinned(database, project.id, deletedWorktreePath, true);
    const { setWorktreePinnedProcedure } = await loadProjectProcedures();

    const result = await setWorktreePinnedProcedure({
      pinned: false,
      projectId: project.id,
      worktreePath: deletedWorktreePath,
    });

    expect(result.project.id).toBe(project.id);
    expect(
      listProjectWorktreesMetadata(database, project.id).find(
        (record) => record.worktreePath === deletedWorktreePath,
      )?.pinnedAt,
    ).toBeNull();
    expect(
      result.worktrees.some(
        (worktree) => worktree.path === deletedWorktreePath,
      ),
    ).toBeFalse();
  });

  it("still rejects pinning a deleted worktree folder", async () => {
    const database = initAppDatabase();
    const projectPath = createTempDirectory("metidos-worktree-pin-project-");
    const deletedWorktreePath = join(projectPath, "deleted-worktree");
    const project = upsertProject(database, {
      name: "Pinned project",
      projectPath,
    });
    const { setWorktreePinnedProcedure } = await loadProjectProcedures();

    await expect(
      setWorktreePinnedProcedure({
        pinned: true,
        projectId: project.id,
        worktreePath: deletedWorktreePath,
      }),
    ).rejects.toThrow("Worktree not found");
  });
});
