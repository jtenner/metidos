/**
 * @file src/bun/sidecar-cron-scheduler.ts
 * @description Main-process handle for the cron scheduler worker thread.
 */

import { getAppDatabasePath } from "./db";
import { createSubsystemLogger } from "./logging";

const CRON_SCHEDULER_THREAD_NAME = "jolt-cron-scheduler-thread";
const CRON_SCHEDULER_THREAD_URL = new URL(
  "./sidecar-cron-thread.ts",
  import.meta.url,
);

type CronSchedulerThreadStart = {
  type: "start";
  dbPath: string;
};

type CronSchedulerThreadSync = {
  type: "sync";
  cronJobId: number;
};

type CronSchedulerThreadStop = { type: "stop" };
type CronSchedulerThreadMessage =
  | CronSchedulerThreadStart
  | CronSchedulerThreadStop
  | CronSchedulerThreadSync;

type CronSchedulerThreadStatusMessage =
  | { type: "stopped" }
  | { type: "error"; error: string };

const logger = createSubsystemLogger("Cron Scheduler");
let schedulerWorker: Worker | null = null;
let stopResolve: (() => void) | null = null;
let stopTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Resolve any pending stop waiter when the worker has shut down.
 */
function resolveSchedulerStop(): void {
  if (!stopResolve) {
    return;
  }
  stopResolve();
  stopResolve = null;
  if (stopTimeoutHandle) {
    clearTimeout(stopTimeoutHandle);
    stopTimeoutHandle = null;
  }
}

/**
 * Send a control message to the scheduler worker if it is currently active.
 */
function notifySchedulerWorker(message: CronSchedulerThreadMessage): void {
  if (!schedulerWorker) {
    return;
  }
  schedulerWorker.postMessage(message);
}

/**
 * Ask the worker to stop, terminate it, and clean up local state.
 */
function shutdownWorker(): void {
  if (!schedulerWorker) {
    return;
  }
  notifySchedulerWorker({ type: "stop" });
  schedulerWorker.terminate();
  schedulerWorker = null;
  resolveSchedulerStop();
}

/**
 * Handle lifecycle messages from the worker thread.
 */
function onWorkerMessage(
  event: MessageEvent<CronSchedulerThreadStatusMessage>,
): void {
  const message = event.data;
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "stopped") {
    logger.info("Cron scheduler worker stopped.");
    shutdownWorker();
    return;
  }

  logger.error({
    message: "Cron scheduler worker error",
    detail: message.error,
  });
}

/**
 * Start the scheduler worker and register all enabled, non-deleted jobs.
 */
export function startCronScheduler(): void {
  if (schedulerWorker) {
    return;
  }

  const dbPath = getAppDatabasePath();
  const worker = new Worker(CRON_SCHEDULER_THREAD_URL, {
    name: CRON_SCHEDULER_THREAD_NAME,
    type: "module",
  });
  schedulerWorker = worker;
  worker.addEventListener("message", onWorkerMessage);
  worker.addEventListener("error", () => {
    logger.warning("Cron scheduler worker failed to start.");
    worker.terminate();
    if (schedulerWorker === worker) {
      schedulerWorker = null;
    }
  });

  const startPayload: CronSchedulerThreadStart = {
    type: "start",
    dbPath,
  };
  notifySchedulerWorker(startPayload);
  logger.info("Cron scheduler worker started.");
}

/**
 * Stop the scheduler worker and unregister any active Bun.cron jobs.
 */
export async function stopCronScheduler(): Promise<void> {
  if (!schedulerWorker) {
    return;
  }

  await new Promise<void>((resolve) => {
    stopResolve = resolve;
    stopTimeoutHandle = setTimeout(() => {
      logger.warning("Cron scheduler stop timed out; terminating worker.");
      shutdownWorker();
    }, 2_000);

    notifySchedulerWorker({ type: "stop" });
  });
}

/**
 * Ask the scheduler worker to sync a single cron job after DB changes.
 */
export function syncCronSchedulerCron(cronJobId: number): void {
  notifySchedulerWorker({
    type: "sync",
    cronJobId,
  });
}
