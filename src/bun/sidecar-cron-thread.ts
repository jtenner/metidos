/**
 * @file src/bun/sidecar-cron-thread.ts
 * @description Worker thread that registers Bun.cron jobs for cron rows.
 */

import { Database } from "bun:sqlite";

import { getCronJobById, listActiveCronJobs } from "./db";
import type { CronJobRecord } from "./db";
import { runCronJobById, runDueCronJobs } from "./sidecar-cron-runner";

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

type RunCronSchedulerThread = {
  type: "run";
  cronJobId: number;
};

type CronSchedulerThreadMessage =
  | StartCronSchedulerThread
  | StopCronSchedulerThread
  | SyncCronSchedulerThread
  | RunCronSchedulerThread;

type CronSchedulerThreadStatusMessage =
  | { type: "stopped" }
  | { type: "error"; error: string };

type CronSchedulerWorkerScope = {
  onmessage: ((event: MessageEvent<CronSchedulerThreadMessage>) => void) | null;
  postMessage: (payload: CronSchedulerThreadStatusMessage) => void;
};

const workerScope = globalThis as unknown as CronSchedulerWorkerScope;

let database: Database | null = null;
let queue: Promise<void> = Promise.resolve();
const cronJobTitles = new Set<string>();
const CRON_JOB_TITLE_PREFIX = "jolt-cron-";

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
function buildCronJobTitle(job: { id: number; title: string }): string {
  const safeTitle = slugifyCronTitle(job.title);
  return `${CRON_JOB_TITLE_PREFIX}${job.id}-${safeTitle}`;
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
  const title = buildCronJobTitle(cronJob);
  cronJobTitles.add(title);
  try {
    await Bun.cron.remove(title).catch(() => undefined);
    await registerCron(
      cronJob.schedule,
      async () => {
        await runDueCronJobs(cronJob.schedule, Date.now());
      },
      title,
    );
  } catch (error) {
    cronJobTitles.delete(title);
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

/**
 * Queue async worker commands to ensure deterministic start/stop/sync sequencing.
 */
function queueSchedulerCommand(command: () => Promise<void>): void {
  queue = queue
    .then(() => command())
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
  database = new Database(message.dbPath);
  database.run("PRAGMA foreign_keys = ON");
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
    return;
  }

  if (message.type === "run") {
    queueSchedulerCommand(() => runCronJobById(message.cronJobId, Date.now()));
  }
};
