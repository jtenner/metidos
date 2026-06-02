import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { createBoundCronStore } from "./cron-store";
import {
  createCronJob,
  createThread,
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  markThreadRunStarted,
  migrateDatabase,
  setCronJobEnabled,
  softDeleteCronJob,
  updateCronJobLastRun,
  upsertProject,
} from "./db";

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  return database;
}

function createProject(database: Database, suffix: string) {
  return upsertProject(database, {
    name: `Cron Store ${suffix}`,
    projectPath: `/tmp/metidos-cron-store-${suffix}`,
  });
}

function createCron(
  database: Database,
  suffix: string,
  schedule = "0 0 * * *",
) {
  const project = createProject(database, suffix);
  return createCronJob(database, {
    agentsAccess: false,
    description: `Cron store fixture ${suffix}`,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    permissions: ["metidos:threads"],
    projectId: project.id,
    prompt: `Run cron store fixture ${suffix}.`,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    schedule,
    title: `Cron Store ${suffix}`,
    unsafeMode: false,
    worktreePath: project.path,
  });
}

describe("cron store", () => {
  it("uses the bound database for store methods", () => {
    const firstDatabase = createTestDatabase();
    const secondDatabase = createTestDatabase();
    try {
      const firstCron = createCron(firstDatabase, "bound-first");
      createCron(secondDatabase, "bound-second");

      const firstStore = createBoundCronStore(firstDatabase);

      expect(firstStore.list().map((cron) => cron.id)).toEqual([firstCron.id]);
      expect(firstStore.getById(firstCron.id)?.title).toBe(
        "Cron Store bound-first",
      );
    } finally {
      firstDatabase.close(false);
      secondDatabase.close(false);
    }
  });

  it("filters due scheduled jobs by enabled, deleted, last-run, and active thread state", () => {
    const database = createTestDatabase();
    try {
      const store = createBoundCronStore(database);
      const dueCron = createCron(database, "due");
      const disabledCron = createCron(database, "disabled");
      const deletedCron = createCron(database, "deleted");
      const inProgressCron = createCron(database, "in-progress");
      const alreadyRunCron = createCron(database, "already-run");
      const activeThreadCron = createCron(database, "active-thread");
      createCron(database, "other-schedule", "30 0 * * *");

      setCronJobEnabled(database, disabledCron.id, false);
      softDeleteCronJob(database, deletedCron.id);
      updateCronJobLastRun(database, inProgressCron.id, 1_000, "InProgress");
      updateCronJobLastRun(database, alreadyRunCron.id, 2_000, "Completed");

      const activeThread = createThread(database, {
        agentsAccess: false,
        cronJobId: activeThreadCron.id,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        permissions: ["metidos:threads"],
        projectId: activeThreadCron.projectId,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Active cron thread",
        unsafeMode: false,
        worktreePath: activeThreadCron.worktreePath,
      });
      markThreadRunStarted(
        database,
        activeThread.id,
        "2026-06-02T12:00:00.000Z",
      );

      expect(store.listDueScheduledJobIds("0 0 * * *", 1_500)).toEqual([
        dueCron.id,
      ]);
    } finally {
      database.close(false);
    }
  });

  it("stops in-progress run history and stale job metadata together", () => {
    const database = createTestDatabase();
    try {
      const store = createBoundCronStore(database);
      const cron = createCron(database, "stop-in-progress");
      const runThread = createThread(database, {
        agentsAccess: false,
        cronJobId: cron.id,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        permissions: ["metidos:threads"],
        projectId: cron.projectId,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Cron run thread",
        unsafeMode: false,
        worktreePath: cron.worktreePath,
      });
      const inProgressRun = store.createRun({
        cronJobId: cron.id,
        runDate: 1_000,
        runStatus: "InProgress",
        threadId: runThread.id,
      });
      const completedRun = store.createRun({
        cronJobId: cron.id,
        runDate: 500,
        runStatus: "Completed",
        threadId: runThread.id,
      });
      store.updateLastRun(cron.id, 1_000, "InProgress");

      store.stopInProgressRuns(cron.id);

      expect(store.getRunById(inProgressRun.id)?.runStatus).toBe("Stopped");
      expect(store.getRunById(completedRun.id)?.runStatus).toBe("Completed");
      expect(store.getById(cron.id)?.lastRunStatus).toBe("Stopped");
    } finally {
      database.close(false);
    }
  });
});
