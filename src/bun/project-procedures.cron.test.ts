import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RpcRequestContext } from "./rpc-schema";
import {
  closeAppDatabase,
  createCronJob,
  createThread,
  createUser,
  getCronJobById,
  initAppDatabase,
  markThreadRunStarted,
  resetResolvedAppDataDirectory,
  runInTransaction,
  softDeleteCronJob,
  updateTimezoneSettings,
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

function createAdminContextWithoutStepUp(): RpcRequestContext {
  return {
    auth: {
      isAdmin: true,
      sessionId: "cron-admin-session",
      stepUpValidUntil: null,
      userId: 1,
      username: "admin",
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

function createRegularContext(
  auth: Partial<RpcRequestContext["auth"]>,
): RpcRequestContext {
  return {
    auth: {
      isAdmin: false,
      sessionId: "cron-user-session",
      userId: 1,
      username: "alice",
      ...auth,
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

function seedCronJobs(
  database: ReturnType<typeof initAppDatabase>,
  project: ReturnType<typeof upsertProject>,
  repoPath: string,
  count: number,
  options: { enabled: boolean },
): void {
  runInTransaction(database, () => {
    for (let index = 0; index < count; index += 1) {
      createCronJob(database, {
        description: `Seed cron job ${index}`,
        enabled: options.enabled,
        model: "gpt-5.4",
        permissions: ["metidos:threads"],
        pluginAccessGroups: [],
        projectId: project.id,
        prompt: `echo seed ${index}`,
        reasoningEffort: "medium",
        schedule: "0 * * * *",
        title: `Seed cron ${index}`,
        worktreePath: repoPath,
      });
    }
  });
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
  it("returns deterministic manual-run errors for missing, deleted, and already-active jobs", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-manual-edge-repo-",
    );
    const { runCronNowProcedure } = await loadProjectProcedures();

    await expect(runCronNowProcedure({ cronJobId: 404 })).rejects.toThrow(
      "Cron job not found: 404",
    );

    const deletedCronJob = createCronJob(database, {
      description: "Deleted manual-run edge cron",
      enabled: true,
      model: "gpt-5.4",
      permissions: ["metidos:threads"],
      pluginAccessGroups: [],
      projectId: project.id,
      prompt: "echo deleted",
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      title: "Deleted edge cron",
      worktreePath: repoPath,
    });
    softDeleteCronJob(database, deletedCronJob.id);
    await expect(
      runCronNowProcedure({ cronJobId: deletedCronJob.id }),
    ).rejects.toThrow("Cannot run a deleted cron job.");

    const activeCronJob = createCronJob(database, {
      description: "Active manual-run edge cron",
      enabled: true,
      model: "gpt-5.4",
      permissions: ["metidos:threads"],
      pluginAccessGroups: [],
      projectId: project.id,
      prompt: "echo active",
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      title: "Active edge cron",
      worktreePath: repoPath,
    });
    const activeThread = createThread(database, {
      agentsAccess: false,
      cronJobId: activeCronJob.id,
      githubAccess: false,
      gitAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      permissions: ["metidos:threads"],
      pluginAccessGroups: [],
      projectId: project.id,
      reasoningEffort: "medium",
      threadsAccess: true,
      title: "Active cron child",
      unsafeMode: false,
      webSearchAccess: false,
      worktreePath: repoPath,
    });
    markThreadRunStarted(database, activeThread.id, "2026-06-02T15:00:00.000Z");

    await expect(
      runCronNowProcedure({ cronJobId: activeCronJob.id }),
    ).rejects.toThrow("Cron job is already running.");
  });

  it("does not require recent step-up before enforcing manual-run job guards", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-no-step-up-repo-",
    );
    const { runCronNowProcedure } = await loadProjectProcedures();
    const deletedCronJob = createCronJob(database, {
      description: "Deleted no-step-up cron",
      enabled: true,
      model: "gpt-5.4",
      permissions: ["metidos:threads"],
      pluginAccessGroups: [],
      projectId: project.id,
      prompt: "echo no-step-up",
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      title: "Deleted no-step-up cron",
      worktreePath: repoPath,
    });
    softDeleteCronJob(database, deletedCronJob.id);

    await expect(
      runCronNowProcedure(
        { cronJobId: deletedCronJob.id },
        createAdminContextWithoutStepUp(),
      ),
    ).rejects.toThrow("Cannot run a deleted cron job.");
  });

  it("rejects manual runs outside a regular caller's visible project scope", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-hidden-scope-repo-",
    );
    const alice = createUser(database, { isAdmin: false, username: "alice" });
    const context = createRegularContext({
      userId: alice.id,
      username: alice.username,
    });
    const { listCronsProcedure, runCronNowProcedure } =
      await loadProjectProcedures();
    const hiddenCronJob = createCronJob(database, {
      description: "Hidden manual-run scope cron",
      enabled: true,
      model: "gpt-5.4",
      permissions: ["metidos:threads"],
      pluginAccessGroups: [],
      projectId: project.id,
      prompt: "echo hidden",
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      title: "Hidden scope cron",
      worktreePath: repoPath,
    });

    expect(
      (await listCronsProcedure(undefined, context)).map((entry) => entry.id),
    ).not.toContain(hiddenCronJob.id);
    await expect(
      runCronNowProcedure({ cronJobId: hiddenCronJob.id }, context),
    ).rejects.toThrow(`Project not currently tracked: ${project.id}`);
  });

  it("rejects updates and deletion outside a regular caller's visible project scope", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-hidden-mutation-scope-repo-",
    );
    const alice = createUser(database, { isAdmin: false, username: "alice" });
    const context = createRegularContext({
      userId: alice.id,
      username: alice.username,
    });
    const { updateCronProcedure } = await loadProjectProcedures();
    const hiddenCronJob = createCronJob(database, {
      description: "Hidden mutation scope cron",
      enabled: true,
      model: "gpt-5.4",
      permissions: ["metidos:threads"],
      pluginAccessGroups: [],
      projectId: project.id,
      prompt: "echo hidden mutation",
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      title: "Hidden mutation scope cron",
      worktreePath: repoPath,
    });

    await expect(
      updateCronProcedure(
        { cronJobId: hiddenCronJob.id, title: "Unauthorized rename" },
        context,
      ),
    ).rejects.toThrow(`Project not currently tracked: ${project.id}`);
    await expect(
      updateCronProcedure(
        { cronJobId: hiddenCronJob.id, deleted: true },
        context,
      ),
    ).rejects.toThrow(`Project not currently tracked: ${project.id}`);
    expect(getCronJobById(database, hiddenCronJob.id)).toMatchObject({
      deletedAt: null,
      title: "Hidden mutation scope cron",
    });
  });

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
      updateCronProcedure({ cronJobId: cronJob.id, schedule: "   " }),
    ).rejects.toThrow(/Cron schedule is required/);
    await expect(
      updateCronProcedure({ cronJobId: cronJob.id, prompt: "   " }),
    ).rejects.toThrow(/Cron prompt is required/);
    await expect(
      updateCronProcedure({ cronJobId: cronJob.id, title: "   " }),
    ).rejects.toThrow(/Cron title is required/);
    await expect(
      updateCronProcedure({ cronJobId: cronJob.id, description: "   " }),
    ).rejects.toThrow(/Cron description is required/);
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
    await expect(
      updateCronProcedure({
        cronJobId: cronJob.id,
        schedule: "* ".repeat(129).trim(),
      }),
    ).rejects.toThrow(/Cron schedule is limited to 256 characters/);
    expect(getCronJobById(database, cronJob.id)).toMatchObject({
      description: expect.stringMatching(/^Schedule 0 \* \* \* \*/u),
      prompt: "echo ok",
      schedule: "0 * * * *",
      title: "Valid cron",
    });
  });

  it("rejects new cron jobs once the total job limit is reached", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-total-capacity-repo-",
    );
    seedCronJobs(database, project, repoPath, 512, { enabled: false });
    const { listCronsProcedure, newCronProcedure } =
      await loadProjectProcedures();

    await expect(
      newCronProcedure({
        enabled: false,
        permissions: ["metidos:threads"],
        projectId: project.id,
        prompt: "echo one too many",
        schedule: "0 * * * *",
        title: "Overflow cron",
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(/Cron jobs are limited to 512/);
    await expect(listCronsProcedure(undefined)).resolves.toHaveLength(512);
  });

  it("rejects schedules that expand beyond the per-job handle limit", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-expanded-handle-repo-",
    );
    updateTimezoneSettings(database, project.id, {
      timezone: "Pacific/Chatham",
    });
    const { newCronProcedure, updateCronProcedure } =
      await loadProjectProcedures();
    const tooManyHandlesSchedule =
      "16,19,24,25,26,30,31,51 5,6,11,13,22,23 8,10,13,18,19,20,21,22,25,31 1,2,6,8,9 *";

    await expect(
      newCronProcedure({
        enabled: true,
        permissions: ["metidos:threads"],
        projectId: project.id,
        prompt: "echo too many handles",
        schedule: tooManyHandlesSchedule,
        title: "Expanded handle overflow",
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(
      /Invalid cron schedule: Cron schedule expands to 9 handles; limit is 8/,
    );

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
        schedule: tooManyHandlesSchedule,
      }),
    ).rejects.toThrow(
      /Invalid cron schedule: Cron schedule expands to 9 handles; limit is 8/,
    );
    expect(getCronJobById(database, cronJob.id)?.schedule).toBe("0 * * * *");
  });

  it("rejects enabling cron jobs once the active job limit is reached", async () => {
    const { database, project, repoPath } = createCronProcedureWorkspace(
      "metidos-cron-active-capacity-repo-",
    );
    seedCronJobs(database, project, repoPath, 256, { enabled: true });
    const { newCronProcedure, updateCronProcedure } =
      await loadProjectProcedures();

    await expect(
      newCronProcedure({
        enabled: true,
        permissions: ["metidos:threads"],
        projectId: project.id,
        prompt: "echo active overflow",
        schedule: "0 * * * *",
        title: "Active overflow cron",
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(/Enabled cron jobs are limited to 256/);

    const disabledCron = await newCronProcedure({
      enabled: false,
      permissions: ["metidos:threads"],
      projectId: project.id,
      prompt: "echo disabled ok",
      schedule: "0 * * * *",
      title: "Disabled cron",
      worktreePath: repoPath,
    });
    await expect(
      updateCronProcedure({ cronJobId: disabledCron.id, enabled: true }),
    ).rejects.toThrow(/Enabled cron jobs are limited to 256/);
    expect(getCronJobById(database, disabledCron.id)?.enabled).toBe(0);
  });
});
