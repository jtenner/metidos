/**
 * @file src/bun/sidecar-cron-scheduler.ts
 * @description Main-process handle for in-process cron scheduler registrations.
 */

import {
  expandCronScheduleForBun,
  getCurrentTimezoneUtcOffsetMinutes,
} from "./cron-schedules";
import { initAppDatabase } from "./db";
import { getEffectiveLocalTimezone } from "./local-settings";
import { createBoundCronStore } from "./cron-store";
import { createSubsystemLogger } from "./logging";

const logger = createSubsystemLogger("Cron Scheduler");

const CRON_TIMEZONE_OFFSET_MONITOR_INTERVAL_MS = 15 * 60_000;
const MAX_REGISTERED_CRON_JOBS = 256;
const MAX_CRON_HANDLES_PER_JOB = 8;

type InProcessCronHandle = {
  stop: () => unknown;
};

const registrations = new Map<number, InProcessCronHandle[]>();
let schedulerStarted = false;
let schedulerTimezoneSignature: string | null = null;
let schedulerTimezoneMonitorTimer: ReturnType<typeof setInterval> | null = null;

function schedulerDatabase() {
  return initAppDatabase();
}

function schedulerCronStore() {
  return createBoundCronStore(schedulerDatabase());
}

function unregisterCronJob(cronJobId: number): void {
  const handles = registrations.get(cronJobId);
  if (!handles) {
    return;
  }

  for (const handle of handles) {
    try {
      handle.stop();
    } catch {
      // Ignore stale handles during shutdown or hot-reload reconciliation.
    }
  }
  registrations.delete(cronJobId);
}

function unregisterAllCronJobs(): void {
  for (const cronJobId of registrations.keys()) {
    unregisterCronJob(cronJobId);
  }
}

function currentTimezoneSignature(): string {
  const timezone = getEffectiveLocalTimezone(schedulerDatabase());
  const offsetMinutes = getCurrentTimezoneUtcOffsetMinutes(timezone);
  return `${timezone}:${offsetMinutes}`;
}

function captureTimezoneSignature(): void {
  try {
    schedulerTimezoneSignature = currentTimezoneSignature();
  } catch (error) {
    // Keep the monitor running after a transient timezone lookup failure. A
    // later successful poll will capture a signature and reconcile jobs; null
    // only means the previous signature could not be trusted.
    schedulerTimezoneSignature = null;
    logger.warning({
      message: "Cron scheduler could not capture timezone offset signature.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function reconcileCronSchedulerTimezoneOffset(): void {
  if (!schedulerStarted) {
    return;
  }
  let nextSignature: string;
  try {
    nextSignature = currentTimezoneSignature();
  } catch (error) {
    logger.warning({
      message: "Cron scheduler timezone offset check failed.",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (schedulerTimezoneSignature === nextSignature) {
    return;
  }
  schedulerTimezoneSignature = nextSignature;
  syncCronSchedulerJobs(schedulerCronStore().listActive());
}

function startTimezoneOffsetMonitor(): void {
  if (schedulerTimezoneMonitorTimer) {
    return;
  }
  schedulerTimezoneMonitorTimer = setInterval(() => {
    reconcileCronSchedulerTimezoneOffset();
  }, CRON_TIMEZONE_OFFSET_MONITOR_INTERVAL_MS);
  schedulerTimezoneMonitorTimer.unref?.();
}

function stopTimezoneOffsetMonitor(): void {
  if (!schedulerTimezoneMonitorTimer) {
    return;
  }
  clearInterval(schedulerTimezoneMonitorTimer);
  schedulerTimezoneMonitorTimer = null;
}

function launchScheduledCronJob(cronJobId: number): void {
  void import("./sidecar-cron-runner")
    .then(({ runCronJobById }) =>
      runCronJobById(cronJobId, Date.now(), undefined, {
        allowStaleRestart: true,
      }),
    )
    .then((threadId) => {
      if (threadId !== null) {
        return;
      }
      logger.warning(
        `Cron scheduler skipped due fire for cron job #${cronJobId}.`,
      );
    })
    .catch((error) => {
      logger.error({
        message: `Cron scheduler failed to execute cron job #${cronJobId}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    });
}

function registerCronJob(cronJob: { id: number; schedule: string }): void {
  const wasRegistered = registrations.has(cronJob.id);
  unregisterCronJob(cronJob.id);
  const handles: InProcessCronHandle[] = [];

  try {
    if (!wasRegistered && registrations.size >= MAX_REGISTERED_CRON_JOBS) {
      throw new Error(
        `Cron scheduler registrations are limited to ${MAX_REGISTERED_CRON_JOBS} active jobs.`,
      );
    }
    const timezone = getEffectiveLocalTimezone(schedulerDatabase());
    const schedules = expandCronScheduleForBun(cronJob.schedule, timezone);
    if (schedules.length > MAX_CRON_HANDLES_PER_JOB) {
      throw new Error(
        `Cron schedule expands to ${schedules.length} handles; limit is ${MAX_CRON_HANDLES_PER_JOB}.`,
      );
    }
    for (const schedule of schedules) {
      const handle = Bun.cron(schedule, () => {
        launchScheduledCronJob(cronJob.id);
      });
      handles.push(handle);
    }
    registrations.set(cronJob.id, handles);
  } catch (error) {
    for (const handle of handles) {
      try {
        handle.stop();
      } catch {
        // Ignore partial registration cleanup failures.
      }
    }
    logger.error({
      message: `Cron scheduler failed to register cron job #${cronJob.id}`,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function syncCronSchedulerJobs(
  jobs: ReturnType<ReturnType<typeof createBoundCronStore>["listActive"]>,
): void {
  const activeJobIds = new Set(jobs.map((job) => job.id));
  for (const cronJobId of registrations.keys()) {
    if (!activeJobIds.has(cronJobId)) {
      unregisterCronJob(cronJobId);
    }
  }
  let registered = 0;
  for (const job of jobs) {
    if (job.enabled !== 1 || job.deletedAt !== null) {
      continue;
    }
    if (registered >= MAX_REGISTERED_CRON_JOBS) {
      logger.error({
        message:
          "Cron scheduler registration limit reached; skipping remaining active jobs.",
        limit: MAX_REGISTERED_CRON_JOBS,
      });
      break;
    }
    registerCronJob(job);
    registered += 1;
  }
}

/**
 * Start the scheduler and register all enabled, non-deleted cron jobs.
 */
export function startCronScheduler(): void {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  captureTimezoneSignature();
  startTimezoneOffsetMonitor();
  syncCronSchedulerJobs(schedulerCronStore().listActive());

  logger.info("Cron scheduler started.");
}

/**
 * Stop all active cron registrations.
 */
export async function stopCronScheduler(): Promise<void> {
  if (!schedulerStarted) {
    return;
  }

  unregisterAllCronJobs();
  stopTimezoneOffsetMonitor();
  schedulerTimezoneSignature = null;
  schedulerStarted = false;
  logger.info("Cron scheduler stopped.");
}

/**
 * Reconcile a single cron job after DB changes.
 */
export function syncCronSchedulerCron(cronJobId: number): void {
  if (!schedulerStarted) {
    return;
  }

  unregisterCronJob(cronJobId);
  const cronJob = schedulerCronStore().getById(cronJobId, {
    includeNextRunDate: false,
  });
  if (!cronJob || cronJob.enabled !== 1 || cronJob.deletedAt !== null) {
    return;
  }
  registerCronJob(cronJob);
}

/**
 * Rebuild active registrations after timezone changes.
 */
export function syncCronSchedulerTimezone(): void {
  if (!schedulerStarted) {
    return;
  }

  captureTimezoneSignature();
  const database = schedulerDatabase();
  const jobs = createBoundCronStore(database).listActive();
  syncCronSchedulerJobs(jobs);
}

/**
 * Start a specific cron job immediately and return the created thread identifier.
 */
export async function runCronNow(cronJobId: number): Promise<number | null> {
  const { runCronJobById } = await import("./sidecar-cron-runner");
  return runCronJobById(cronJobId, Date.now(), undefined, {
    allowStaleRestart: true,
  });
}
