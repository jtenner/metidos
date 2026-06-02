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

function startActiveCronThread(
  database: Database,
  cron: ReturnType<typeof createCron>,
) {
  const activeThread = createThread(database, {
    agentsAccess: false,
    cronJobId: cron.id,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    permissions: ["metidos:threads"],
    projectId: cron.projectId,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    title: "Active cron thread",
    unsafeMode: false,
    worktreePath: cron.worktreePath,
  });
  markThreadRunStarted(database, activeThread.id, "2026-06-02T12:00:00.000Z");
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

  it("keeps soft-deleted jobs inspectable while excluding them from active registration", () => {
    const database = createTestDatabase();
    try {
      const store = createBoundCronStore(database);
      const activeCron = createCron(database, "visibility-active");
      const disabledCron = createCron(database, "visibility-disabled");
      const deletedCron = createCron(database, "visibility-deleted");

      setCronJobEnabled(database, disabledCron.id, false);
      softDeleteCronJob(database, deletedCron.id);

      expect(store.list().map((cron) => cron.id)).toEqual([
        deletedCron.id,
        disabledCron.id,
        activeCron.id,
      ]);
      expect(store.getById(deletedCron.id)).toMatchObject({
        id: deletedCron.id,
        enabled: 0,
        title: "Cron Store visibility-deleted",
      });
      expect(store.getById(deletedCron.id)?.deletedAt).toEqual(
        expect.any(Number),
      );
      expect(store.listActive().map((cron) => cron.id)).toEqual([
        activeCron.id,
      ]);
    } finally {
      database.close(false);
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

      startActiveCronThread(database, activeThreadCron);

      expect(store.listDueScheduledJobIds("0 0 * * *", 1_500)).toEqual([
        dueCron.id,
      ]);
    } finally {
      database.close(false);
    }
  });

  it("treats stale completed or errored last-run metadata as due while blocking stale in-progress metadata", () => {
    const database = createTestDatabase();
    try {
      const store = createBoundCronStore(database);
      const staleCompletedCron = createCron(database, "stale-completed");
      const staleErroredCron = createCron(database, "stale-errored");
      const staleInProgressCron = createCron(database, "stale-in-progress");
      const freshCompletedCron = createCron(database, "fresh-completed");

      updateCronJobLastRun(database, staleCompletedCron.id, 1_000, "Completed");
      updateCronJobLastRun(database, staleErroredCron.id, 1_000, "Errored");
      updateCronJobLastRun(
        database,
        staleInProgressCron.id,
        1_000,
        "InProgress",
      );
      updateCronJobLastRun(database, freshCompletedCron.id, 2_000, "Completed");

      expect(store.listDueScheduledJobIds("0 0 * * *", 1_500)).toEqual([
        staleCompletedCron.id,
        staleErroredCron.id,
      ]);
    } finally {
      database.close(false);
    }
  });

  it("claims scheduled runs only for eligible due jobs and returns job metadata", () => {
    const database = createTestDatabase();
    try {
      const store = createBoundCronStore(database);
      const dueCron = createCron(database, "claim-due", "15 8 * * *");
      const disabledCron = createCron(database, "claim-disabled", "15 8 * * *");
      const deletedCron = createCron(database, "claim-deleted", "15 8 * * *");
      const activeThreadCron = createCron(
        database,
        "claim-active-thread",
        "15 8 * * *",
      );
      const equalLastRunCron = createCron(
        database,
        "claim-equal-last-run",
        "15 8 * * *",
      );
      const newerLastRunCron = createCron(
        database,
        "claim-newer-last-run",
        "15 8 * * *",
      );
      createCron(database, "claim-other-schedule", "30 8 * * *");

      setCronJobEnabled(database, disabledCron.id, false);
      softDeleteCronJob(database, deletedCron.id);
      startActiveCronThread(database, activeThreadCron);
      updateCronJobLastRun(database, equalLastRunCron.id, 1_500, "Completed");
      updateCronJobLastRun(database, newerLastRunCron.id, 2_000, "Errored");

      const claimed = store.claimScheduledRuns("15 8 * * *", 1_500);

      expect(claimed.map((cron) => cron.id)).toEqual([dueCron.id]);
      expect(claimed[0]).toMatchObject({
        id: dueCron.id,
        description: "Cron store fixture claim-due",
        enabled: 1,
        lastRunDate: 1_500,
        lastRunStatus: "InProgress",
        permissions: ["metidos:threads"],
        prompt: "Run cron store fixture claim-due.",
        schedule: "15 8 * * *",
        title: "Cron Store claim-due",
        worktreePath: dueCron.worktreePath,
      });
      expect(store.getById(dueCron.id)?.lastRunStatus).toBe("InProgress");
      expect(store.getById(disabledCron.id)?.lastRunDate).toBeNull();
      expect(store.getById(deletedCron.id)?.lastRunDate).toBeNull();
      expect(store.getById(activeThreadCron.id)?.lastRunDate).toBeNull();
      expect(store.getById(equalLastRunCron.id)?.lastRunDate).toBe(1_500);
      expect(store.getById(newerLastRunCron.id)?.lastRunDate).toBe(2_000);
    } finally {
      database.close(false);
    }
  });

  it("claims a specific scheduled run only when manual and safety gates allow it", () => {
    const database = createTestDatabase();
    try {
      const store = createBoundCronStore(database);
      const disabledCron = createCron(database, "claim-by-id-disabled");
      const deletedCron = createCron(database, "claim-by-id-deleted");
      const activeThreadCron = createCron(
        database,
        "claim-by-id-active-thread",
      );
      const equalLastRunCron = createCron(
        database,
        "claim-by-id-equal-last-run",
      );
      const newerLastRunCron = createCron(
        database,
        "claim-by-id-newer-last-run",
      );

      setCronJobEnabled(database, disabledCron.id, false);
      softDeleteCronJob(database, deletedCron.id);
      startActiveCronThread(database, activeThreadCron);
      updateCronJobLastRun(database, equalLastRunCron.id, 1_500, "Completed");
      updateCronJobLastRun(database, newerLastRunCron.id, 2_000, "Completed");

      expect(store.claimForScheduledRunById(disabledCron.id, 1_500)).toEqual(
        [],
      );

      const disabledManualClaim = store.claimForScheduledRunById(
        disabledCron.id,
        1_500,
        { includeDisabled: true },
      );

      expect(disabledManualClaim).toHaveLength(1);
      expect(disabledManualClaim[0]).toMatchObject({
        id: disabledCron.id,
        enabled: 0,
        lastRunDate: 1_500,
        lastRunStatus: "InProgress",
        title: "Cron Store claim-by-id-disabled",
      });
      expect(
        store.claimForScheduledRunById(deletedCron.id, 1_500, {
          includeDisabled: true,
        }),
      ).toEqual([]);
      expect(
        store.claimForScheduledRunById(activeThreadCron.id, 1_500, {
          includeDisabled: true,
        }),
      ).toEqual([]);
      expect(
        store.claimForScheduledRunById(equalLastRunCron.id, 1_500, {
          includeDisabled: true,
        }),
      ).toEqual([]);
      expect(
        store.claimForScheduledRunById(newerLastRunCron.id, 1_500, {
          includeDisabled: true,
        }),
      ).toEqual([]);
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
