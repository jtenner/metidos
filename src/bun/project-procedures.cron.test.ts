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
const originalAppDatabasePath = process.env.METIDOS_APP_DATABASE_PATH;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function createCronProcedureWorkspace(prefix: string): {
  database: ReturnType<typeof initAppDatabase>;
  project: ReturnType<typeof upsertProject>;
  repoPath: string;
} {
  process.env.METIDOS_APP_DATABASE_PATH = ":memory:";
  const repoPath = createTempDirectory(prefix);
  mkdirSync(repoPath, { recursive: true });
  const database = initAppDatabase();
  const project = upsertProject(database, {
    name: "Cron Procedure Repo",
    projectPath: repoPath,
  });
  return { database, project, repoPath };
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
  if (typeof originalAppDatabasePath === "string") {
    process.env.METIDOS_APP_DATABASE_PATH = originalAppDatabasePath;
  } else {
    delete process.env.METIDOS_APP_DATABASE_PATH;
  }
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("cron procedure validation", () => {
  it("rejects invalid cron schedules before persisting them", async () => {
    const { project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-procedure-repo-",
    );
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
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-update-repo-",
    );
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

  it("rejects blank create inputs before persisting cron jobs", async () => {
    const { project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-blank-create-repo-",
    );
    const { listCronsProcedure, newCronProcedure } =
      await loadProjectProcedures();
    const validParams = {
      enabled: true,
      permissions: ["metidos:threads"],
      projectId: project.id,
      prompt: "echo ok",
      schedule: "0 * * * *",
      title: "Valid cron",
      worktreePath: repoPath,
    };

    await expect(
      newCronProcedure({ ...validParams, schedule: "   " }),
    ).rejects.toThrow(/Cron schedule is required/);
    await expect(
      newCronProcedure({ ...validParams, prompt: "   " }),
    ).rejects.toThrow(/Cron prompt is required/);
    await expect(
      newCronProcedure({ ...validParams, title: "   " }),
    ).rejects.toThrow(/Cron title is required/);
    await expect(
      newCronProcedure({ ...validParams, description: "   " }),
    ).rejects.toThrow(/Cron description is required/);
    await expect(listCronsProcedure(undefined)).resolves.toEqual([]);
  });

  it("rejects oversized create inputs before persisting cron jobs", async () => {
    const { project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-oversized-create-repo-",
    );
    const { listCronsProcedure, newCronProcedure } =
      await loadProjectProcedures();
    const validParams = {
      enabled: true,
      permissions: ["metidos:threads"],
      projectId: project.id,
      prompt: "echo ok",
      schedule: "0 * * * *",
      title: "Valid cron",
      worktreePath: repoPath,
    };

    await expect(
      newCronProcedure({ ...validParams, prompt: "x".repeat(64 * 1024 + 1) }),
    ).rejects.toThrow(/Cron prompt is limited to 65536 characters/);
    await expect(
      newCronProcedure({ ...validParams, title: "x".repeat(73) }),
    ).rejects.toThrow(/Cron title is limited to 72 characters/);
    await expect(
      newCronProcedure({ ...validParams, description: "x".repeat(241) }),
    ).rejects.toThrow(/Cron description is limited to 240 characters/);
    await expect(
      newCronProcedure({ ...validParams, schedule: "* ".repeat(129).trim() }),
    ).rejects.toThrow(/Cron schedule is limited to 256 characters/);
    await expect(listCronsProcedure(undefined)).resolves.toEqual([]);
  });

  it("rejects blank and oversized updates without changing the job", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-update-validation-repo-",
    );
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
      updateCronProcedure({ cronJobId: cronJob.id, prompt: "   " }),
    ).rejects.toThrow(/Cron prompt is required/);
    await expect(
      updateCronProcedure({ cronJobId: cronJob.id, title: "x".repeat(73) }),
    ).rejects.toThrow(/Cron title is limited to 72 characters/);
    await expect(
      updateCronProcedure({
        cronJobId: cronJob.id,
        description: "x".repeat(241),
      }),
    ).rejects.toThrow(/Cron description is limited to 240 characters/);
    await expect(
      updateCronProcedure({
        cronJobId: cronJob.id,
        prompt: "x".repeat(64 * 1024 + 1),
      }),
    ).rejects.toThrow(/Cron prompt is limited to 65536 characters/);
    expect(getCronJobById(database, cronJob.id)).toMatchObject({
      description: expect.stringMatching(/^Schedule 0 \* \* \* \*/u),
      prompt: "echo ok",
      title: "Valid cron",
    });
  });
});
