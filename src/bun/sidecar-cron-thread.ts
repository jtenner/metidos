/**
 * @file src/bun/sidecar-cron-thread.ts
 * @description Worker thread that registers Bun.cron jobs for cron rows.
 */

import { Database } from "bun:sqlite";
import { expandCronScheduleForBun } from "./cron-schedules";
import type { CronJobRecord } from "./db";
import {
  applyAppDatabasePragmas,
  getCronJobById,
  getEffectiveTimezoneForUser,
  listActiveCronJobs,
  resolveSingletonLocalSettingsUserId,
  SQL_BUSY_TIMEOUT_MS,
} from "./db";

function persistedLocalOperatorUserId(database: Database): number {
  // Local timezone settings are currently app-scoped, but route this through
  // the same compatibility helper used by the main process so future ownership
  // changes do not leave the scheduler worker pinned to a magic user id.
  return resolveSingletonLocalSettingsUserId(database);
}

type StartCronSchedulerThread = {
  type: "start";
  dbPath: string;
};

type StopCronSchedulerThread = {
  type: "stop";
};

type SyncCronSchedulerThread = {
  type: "sync";
  cronJobId: number;
};

type CronSchedulerThreadMessage =
  | StartCronSchedulerThread
  | StopCronSchedulerThread
  | SyncCronSchedulerThread;

type CronSchedulerThreadStatusMessage =
  | { type: "stopped" }
  | { type: "error"; error: string }
  | {
      type: "fire";
      schedule: string;
      scheduledTime: number;
    };

type CronSchedulerWorkerScope = {
  onmessage: ((event: MessageEvent<CronSchedulerThreadMessage>) => void) | null;
  postMessage: (payload: CronSchedulerThreadStatusMessage) => void;
};

const workerScope = globalThis as unknown as CronSchedulerWorkerScope;

let database: Database | null = null;
let queue: Promise<void> = Promise.resolve();
const cronJobTitles = new Set<string>();
const CRON_JOB_TITLE_PREFIX = "metidos-cron-";
const SCHEDULER_COMMAND_TIMEOUT_MS = 30_000;

type BunCronRegister = (
  schedule: string,
  handler: () => Promise<void> | void,
  title: string,
) => Promise<void>;

const registerCron = Bun.cron as unknown as BunCronRegister;

/**
 * Convert a cron title into a stable, filesystem-safe token for Bun.cron labels.
 */
function slugifyCronTitle(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "cron-job"
  ).slice(0, 64);
}

/**
 * Build the deterministic Bun.cron label used for a single cron row.
 */
function buildCronJobTitle(
  job: { id: number; title: string },
  index: number,
): string {
  const safeTitle = slugifyCronTitle(job.title);
  return `${CRON_JOB_TITLE_PREFIX}${job.id}-${safeTitle}-${index + 1}`;
}

/**
 * Build the shared prefix that identifies all job labels for one cron id.
 */
function buildCronJobTitlePrefix(cronJobId: number): string {
  return `${CRON_JOB_TITLE_PREFIX}${cronJobId}-`;
}

/**
 * Report an async scheduler error to the main worker process.
 */
function postError(error: unknown): void {
  workerScope.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Unregister every job registered for this worker instance.
 */
async function unregisterAllCronJobs(): Promise<void> {
  for (const title of cronJobTitles) {
    try {
      await Bun.cron.remove(title);
    } catch {
      // Ignore when registration is already gone.
    }
  }
  cronJobTitles.clear();
}

/**
 * Remove all registrations for a single cron id while keeping other jobs intact.
 */
async function unregisterCronJobsForCronId(cronJobId: number): Promise<void> {
  const prefix = buildCronJobTitlePrefix(cronJobId);
  const titleSnapshot = Array.from(cronJobTitles);
  for (const title of titleSnapshot) {
    if (!title.startsWith(prefix)) {
      continue;
    }
    try {
      await Bun.cron.remove(title);
    } catch {
      // Ignore when registration is already gone.
    }
    cronJobTitles.delete(title);
  }
}

/**
 * Register a cron job with Bun.cron and track its title for later cleanup.
 */
async function registerCronJob(
  cronJob: Pick<CronJobRecord, "id" | "title" | "schedule">,
): Promise<void> {
  const databaseHandle = database;
  if (!databaseHandle) {
    return;
  }
  const timezone = getEffectiveTimezoneForUser(
    databaseHandle,
    persistedLocalOperatorUserId(databaseHandle),
  );
  const schedules = expandCronScheduleForBun(cronJob.schedule, timezone);
  const registeredTitles: string[] = [];
  try {
    for (const [index, schedule] of schedules.entries()) {
      const title = buildCronJobTitle(cronJob, index);
      cronJobTitles.add(title);
      registeredTitles.push(title);
      await Bun.cron.remove(title).catch(() => undefined);
      await registerCron(
        schedule,
        () => {
          workerScope.postMessage({
            type: "fire",
            schedule: cronJob.schedule,
            scheduledTime: Date.now(),
          });
        },
        title,
      );
    }
  } catch (error) {
    for (const title of registeredTitles) {
      await Bun.cron.remove(title).catch(() => undefined);
      cronJobTitles.delete(title);
    }
    throw error;
  }
}

/**
 * Reconcile one cron id from the database into active worker registration.
 */
async function syncCronJobFromDatabase(cronJobId: number): Promise<void> {
  const databaseHandle = database;
  if (!databaseHandle) {
    return;
  }

  await unregisterCronJobsForCronId(cronJobId);
  const cronJob = getCronJobById(databaseHandle, cronJobId, {
    includeNextRunDate: false,
  });
  if (!cronJob || cronJob.enabled !== 1 || cronJob.deletedAt !== null) {
    return;
  }

  try {
    await registerCronJob(cronJob);
  } catch (error) {
    postError(error);
  }
}

/**
 * Register all active cron jobs during scheduler startup.
 */
async function registerCronJobs(): Promise<void> {
  const databaseHandle = database;
  if (!databaseHandle) {
    return;
  }

  const jobs = listActiveCronJobs(databaseHandle);
  for (const job of jobs) {
    if (job.enabled !== 1 || job.deletedAt !== null) {
      continue;
    }
    try {
      await registerCronJob(job);
    } catch (error) {
      postError(error);
    }
  }
}

async function runSchedulerCommandWithTimeout(
  command: () => Promise<void>,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      command(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `Cron scheduler command timed out after ${SCHEDULER_COMMAND_TIMEOUT_MS}ms.`,
            ),
          );
        }, SCHEDULER_COMMAND_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Queue async worker commands to ensure deterministic start/stop/sync sequencing.
 */
function queueSchedulerCommand(command: () => Promise<void>): void {
  queue = queue
    .then(() => runSchedulerCommandWithTimeout(command))
    .catch((error) => {
      postError(error);
    });
}

/**
 * Initialize state, open the app DB, and register all currently active cron jobs.
 */
async function start(message: StartCronSchedulerThread): Promise<void> {
  await unregisterAllCronJobs();
  await closeDatabase();
  // Keep the scheduler worker on its own SQLite handle instead of reusing the
  // main-process app database singleton. The scheduler is an independent
  // writer/reader for cron registration state, and a dedicated handle lets WAL
  // busy-timeout/pragmas coordinate between processes without sharing Bun
  // statement/transaction state across worker boundaries.
  database = new Database(message.dbPath);
  applyAppDatabasePragmas(database, {
    busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
  });
  await registerCronJobs();
}

/**
 * Remove all registered cron jobs and close db access before signaling shutdown.
 */
async function stop(): Promise<void> {
  await unregisterAllCronJobs();
  await closeDatabase();
  workerScope.postMessage({ type: "stopped" });
}

/**
 * Close database handles and reset the local cache.
 */
async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  database.close(false);
  database = null;
}

/**
 * Handle control messages sent from the scheduler orchestrator thread.
 */
workerScope.onmessage = (event) => {
  const message = event.data as CronSchedulerThreadMessage;
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "start") {
    queueSchedulerCommand(() => start(message));
    return;
  }

  if (message.type === "stop") {
    queueSchedulerCommand(stop);
    return;
  }

  if (message.type === "sync") {
    queueSchedulerCommand(() => syncCronJobFromDatabase(message.cronJobId));
  }
};
