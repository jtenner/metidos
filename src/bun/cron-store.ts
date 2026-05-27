/**
 * @file src/bun/cron-store.ts
 * @description Domain store Interface for cron job and cron run persistence.
 */

import type { Database } from "bun:sqlite";

import {
  claimCronJobForScheduledRunById,
  claimCronJobsForScheduledRun,
  createCronJob,
  createCronJobRun,
  getCronJobById,
  getCronJobRunById,
  listActiveCronJobs,
  listCronJobRuns,
  listCronJobs,
  setCronJobEnabled,
  softDeleteCronJob,
  stopInProgressCronJobRuns,
  updateCronJob,
  updateCronJobLastRun,
  updateCronJobRunStatus,
} from "./db";

export type CronStore = {
  claimForScheduledRunById: typeof claimCronJobForScheduledRunById;
  claimScheduledRuns: typeof claimCronJobsForScheduledRun;
  create: typeof createCronJob;
  createRun: typeof createCronJobRun;
  getById: typeof getCronJobById;
  getRunById: typeof getCronJobRunById;
  list: typeof listCronJobs;
  listActive: typeof listActiveCronJobs;
  listDueScheduledJobIds: (
    database: Database,
    schedule: string,
    scheduledTime: number,
  ) => number[];
  listRuns: typeof listCronJobRuns;
  setEnabled: typeof setCronJobEnabled;
  softDelete: typeof softDeleteCronJob;
  stopInProgressRuns: typeof stopInProgressCronJobRuns;
  update: typeof updateCronJob;
  updateLastRun: typeof updateCronJobLastRun;
  updateRunStatus: typeof updateCronJobRunStatus;
};

export function createCronStore(_database: Database): CronStore {
  return {
    claimForScheduledRunById: (db, cronJobId, scheduledTime, options) =>
      claimCronJobForScheduledRunById(db, cronJobId, scheduledTime, options),
    claimScheduledRuns: (db, schedule, scheduledTime) =>
      claimCronJobsForScheduledRun(db, schedule, scheduledTime),
    create: (db, input) => createCronJob(db, input),
    createRun: (db, input) => createCronJobRun(db, input),
    getById: (db, cronJobId, options) => getCronJobById(db, cronJobId, options),
    getRunById: (db, cronJobRunId) => getCronJobRunById(db, cronJobRunId),
    list: (db) => listCronJobs(db),
    listActive: (db) => listActiveCronJobs(db),
    listDueScheduledJobIds: (db, schedule, scheduledTime) =>
      db
        .query<{ id: number }, [string, number]>(
          `
            SELECT id
            FROM cron_jobs
            WHERE schedule = ?
              AND enabled = 1
              AND deleted_at IS NULL
              AND (
                last_run_status IS NULL
                OR last_run_status != 'InProgress'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM threads
                WHERE threads.cron_job_id = cron_jobs.id
                  AND threads.deleted_at IS NULL
                  AND threads.active_turn_started_at IS NOT NULL
              )
              AND (
                last_run_date IS NULL
                OR last_run_date < ?
              )
            ORDER BY id ASC
          `,
        )
        .all(schedule, scheduledTime)
        .map((row) => row.id),
    listRuns: (db, cronJobId) => listCronJobRuns(db, cronJobId),
    setEnabled: (db, cronJobId, enabled) =>
      setCronJobEnabled(db, cronJobId, enabled),
    softDelete: (db, cronJobId) => softDeleteCronJob(db, cronJobId),
    stopInProgressRuns: (db, cronJobId) =>
      stopInProgressCronJobRuns(db, cronJobId),
    update: (db, cronJobId, updates) => updateCronJob(db, cronJobId, updates),
    updateLastRun: (db, cronJobId, date, status) =>
      updateCronJobLastRun(db, cronJobId, date, status),
    updateRunStatus: (db, cronJobRunId, status) =>
      updateCronJobRunStatus(db, cronJobRunId, status),
  };
}

export function createBoundCronStore(database: Database): {
  [K in keyof CronStore]: CronStore[K] extends (
    database: Database,
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Result
    : never;
} {
  const store = createCronStore(database);
  return {
    claimForScheduledRunById: (...args) =>
      store.claimForScheduledRunById(database, ...args),
    claimScheduledRuns: (...args) =>
      store.claimScheduledRuns(database, ...args),
    create: (...args) => store.create(database, ...args),
    createRun: (...args) => store.createRun(database, ...args),
    getById: (...args) => store.getById(database, ...args),
    getRunById: (...args) => store.getRunById(database, ...args),
    list: (...args) => store.list(database, ...args),
    listActive: (...args) => store.listActive(database, ...args),
    listDueScheduledJobIds: (...args) =>
      store.listDueScheduledJobIds(database, ...args),
    listRuns: (...args) => store.listRuns(database, ...args),
    setEnabled: (...args) => store.setEnabled(database, ...args),
    softDelete: (...args) => store.softDelete(database, ...args),
    stopInProgressRuns: (...args) =>
      store.stopInProgressRuns(database, ...args),
    update: (...args) => store.update(database, ...args),
    updateLastRun: (...args) => store.updateLastRun(database, ...args),
    updateRunStatus: (...args) => store.updateRunStatus(database, ...args),
  };
}
