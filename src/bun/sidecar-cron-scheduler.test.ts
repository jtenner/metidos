import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  createCronJob,
  initAppDatabase,
  resetResolvedAppDataDirectory,
  setCronJobEnabled,
  updateCronJob,
  upsertProject,
} from "./db";
import {
  startCronScheduler,
  stopCronScheduler,
  syncCronSchedulerCron,
  syncCronSchedulerTimezone,
} from "./sidecar-cron-scheduler";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalAppDatabasePath = process.env.METIDOS_APP_DATABASE_PATH;
const originalBunCron = Bun.cron;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

afterEach(async () => {
  await stopCronScheduler();
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  (Bun as { cron: typeof Bun.cron }).cron = originalBunCron;

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
});

describe("sidecar cron scheduler", () => {
  it("registers enabled cron jobs and stops them on shutdown", async () => {
    process.env.METIDOS_APP_DATABASE_PATH = ":memory:";
    const repoPath = createTempDirectory("metidos-cron-scheduler-repo-");
    mkdirSync(repoPath, {
      recursive: true,
    });

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Cron Scheduler Repo",
      projectPath: repoPath,
    });

    createCronJob(database, {
      agentsAccess: false,
      description: "Enabled cron",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "run enabled cron",
      reasoningEffort: "medium",
      schedule: "*/5 * * * *",
      title: "Enabled Cron",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    createCronJob(database, {
      agentsAccess: false,
      description: "Disabled cron",
      enabled: false,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "run disabled cron",
      reasoningEffort: "medium",
      schedule: "*/10 * * * *",
      title: "Disabled Cron",
      unsafeMode: false,
      worktreePath: repoPath,
    });

    const registeredSchedules: string[] = [];
    let stoppedCount = 0;
    (Bun as { cron: typeof Bun.cron }).cron = ((
      schedule: string,
      _handler: () => unknown,
    ) => {
      registeredSchedules.push(schedule);
      return {
        stop() {
          stoppedCount += 1;
          return this;
        },
      };
    }) as unknown as typeof Bun.cron;

    startCronScheduler();

    expect(registeredSchedules).toEqual(["*/5 * * * *"]);

    await stopCronScheduler();

    expect(stoppedCount).toBe(1);
  });

  it("re-registers updated cron jobs and removes disabled ones on sync", () => {
    process.env.METIDOS_APP_DATABASE_PATH = ":memory:";
    const repoPath = createTempDirectory("metidos-cron-scheduler-sync-repo-");
    mkdirSync(repoPath, {
      recursive: true,
    });

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Cron Scheduler Sync Repo",
      projectPath: repoPath,
    });

    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Sync cron",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "run sync cron",
      reasoningEffort: "medium",
      schedule: "*/5 * * * *",
      title: "Sync Cron",
      unsafeMode: false,
      worktreePath: repoPath,
    });

    const registeredSchedules: string[] = [];
    let stoppedCount = 0;
    (Bun as { cron: typeof Bun.cron }).cron = ((
      schedule: string,
      _handler: () => unknown,
    ) => {
      registeredSchedules.push(schedule);
      return {
        stop() {
          stoppedCount += 1;
          return this;
        },
      };
    }) as unknown as typeof Bun.cron;

    startCronScheduler();
    expect(registeredSchedules).toEqual(["*/5 * * * *"]);

    updateCronJob(database, cronJob.id, {
      schedule: "*/10 * * * *",
    });
    syncCronSchedulerCron(cronJob.id);

    expect(registeredSchedules).toEqual(["*/5 * * * *", "*/10 * * * *"]);
    expect(stoppedCount).toBe(1);

    setCronJobEnabled(database, cronJob.id, false);
    syncCronSchedulerCron(cronJob.id);

    expect(registeredSchedules).toEqual(["*/5 * * * *", "*/10 * * * *"]);
    expect(stoppedCount).toBe(2);
  });

  it("removes jobs that leave the timezone scheduler sync set", () => {
    process.env.METIDOS_APP_DATABASE_PATH = ":memory:";
    const repoPath = createTempDirectory(
      "metidos-cron-scheduler-timezone-sync-repo-",
    );
    mkdirSync(repoPath, {
      recursive: true,
    });

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Cron Scheduler Local Sync Repo",
      projectPath: repoPath,
    });

    createCronJob(database, {
      agentsAccess: false,
      description: "Kept cron",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "run kept cron",
      reasoningEffort: "medium",
      schedule: "*/5 * * * *",
      title: "Kept Cron",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const disabledCronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Disabled cron",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "run disabled cron",
      reasoningEffort: "medium",
      schedule: "*/10 * * * *",
      title: "Disabled Cron For Timezone Sync",
      unsafeMode: false,
      worktreePath: repoPath,
    });

    const registeredSchedules: string[] = [];
    const stoppedSchedules: string[] = [];
    (Bun as { cron: typeof Bun.cron }).cron = ((
      schedule: string,
      _handler: () => unknown,
    ) => {
      registeredSchedules.push(schedule);
      return {
        stop() {
          stoppedSchedules.push(schedule);
          return this;
        },
      };
    }) as unknown as typeof Bun.cron;

    startCronScheduler();
    expect(registeredSchedules).toEqual(["*/5 * * * *", "*/10 * * * *"]);

    setCronJobEnabled(database, disabledCronJob.id, false);
    syncCronSchedulerTimezone();

    expect(stoppedSchedules).toEqual(["*/10 * * * *", "*/5 * * * *"]);
    expect(registeredSchedules).toEqual([
      "*/5 * * * *",
      "*/10 * * * *",
      "*/5 * * * *",
    ]);
  });
});

afterAll(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});
