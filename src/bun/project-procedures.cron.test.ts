import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  getCronJobById,
  initAppDatabase,
  resetResolvedAppDataDirectory,
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
    `./project-procedures?cron-validation=${Date.now()}`
  )) as ProjectProceduresModule;
}

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

describe("cron procedure validation", () => {
  it("rejects invalid cron schedules before persisting them", async () => {
    process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
      "metidos-cron-procedure-db-",
    );
    const repoPath = createTempDirectory("metidos-cron-procedure-repo-");
    mkdirSync(repoPath, { recursive: true });
    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Cron Procedure Repo",
      projectPath: repoPath,
    });
    const { listCronsProcedure, newCronProcedure } =
      await loadProjectProcedures();

    await expect(
      newCronProcedure({
        enabled: true,
        permissions: ["metidos:threads"],
        projectId: project.id,
        prompt: "echo no",
        schedule: "not a cron",
        title: "Invalid cron",
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(/Invalid cron schedule/);
    await expect(listCronsProcedure(undefined)).resolves.toEqual([]);
  });

  it("rejects invalid cron schedule updates without changing the job", async () => {
    process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
      "metidos-cron-update-db-",
    );
    const repoPath = createTempDirectory("metidos-cron-update-repo-");
    mkdirSync(repoPath, { recursive: true });
    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Cron Update Repo",
      projectPath: repoPath,
    });
    const { newCronProcedure, updateCronProcedure } =
      await loadProjectProcedures();
    const cronJob = await newCronProcedure({
      enabled: true,
      permissions: ["metidos:threads"],
      projectId: project.id,
      prompt: "echo ok",
      schedule: "0 * * * *",
      title: "Valid cron",
      worktreePath: repoPath,
    });

    await expect(
      updateCronProcedure({
        cronJobId: cronJob.id,
        schedule: "still not a cron",
      }),
    ).rejects.toThrow(/Invalid cron schedule/);
    expect(getCronJobById(database, cronJob.id)?.schedule).toBe("0 * * * *");
  });
});
