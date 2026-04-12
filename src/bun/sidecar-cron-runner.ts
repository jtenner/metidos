/**
 * @file src/bun/sidecar-cron-runner.ts
 * @description Pi-backed cron job execution logic used by in-process Bun.cron callbacks.
 */

import { Database } from "bun:sqlite";
import {
  applyAppDatabasePragmas,
  type CronJobRecord,
  type CronJobRunStatus,
  claimCronJobForScheduledRunById,
  claimCronJobsForScheduledRun,
  createCronJobRun,
  getAppDatabasePath,
  getThreadById,
  SQL_BUSY_TIMEOUT_MS,
  updateCronJobLastRun,
  updateCronJobRunStatus,
} from "./db";
import {
  createThreadProcedure,
  sendThreadMessageProcedure,
} from "./project-procedures";
import { normalizeStoredCodexReasoningEffort } from "./project-procedures/model-catalog";
import { createAsyncConcurrencyLimit } from "./project-procedures/shared";
import { isStoppedThreadMessage } from "./project-procedures/thread-detail";
import {
  type CronRunMeasurementToken,
  recordCronPendingRuns,
  recordCronRunFinished,
  recordCronRunQueued,
  recordCronRunStarted,
} from "./runtime-stats";

/** Poll interval used while waiting for the cron-spawned thread to finish. */
const THREAD_POLL_INTERVAL_MS = 500;
/** Maximum elapsed time allowed for one cron invocation before marking it errored. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** Conservative launch cap for scheduler-fired cron work so bursts do not spawn unlimited threads at once. */
const SCHEDULED_CRON_EXECUTION_CONCURRENCY = 2;
const scheduledCronExecutionLimit = createAsyncConcurrencyLimit(
  SCHEDULED_CRON_EXECUTION_CONCURRENCY,
);
let activeCronRunCount = 0;
let pendingScheduledCronLaunchCount = 0;

export function getScheduledCronExecutionLimitStats(): {
  activeCount: number;
  maxConcurrent: number;
  pendingCount: number;
} {
  return scheduledCronExecutionLimit.stats();
}

function decrementPendingScheduledCronLaunchCount(): void {
  pendingScheduledCronLaunchCount = Math.max(
    0,
    pendingScheduledCronLaunchCount - 1,
  );
  recordCronPendingRuns(pendingScheduledCronLaunchCount);
}

function startCronRunMeasurement(): CronRunMeasurementToken {
  activeCronRunCount += 1;
  return recordCronRunStarted({
    activeRuns: activeCronRunCount,
    pendingRuns: pendingScheduledCronLaunchCount,
  });
}

function finishCronRunMeasurement(
  token: CronRunMeasurementToken,
  options: {
    status: CronJobRunStatus;
    timedOut: boolean;
  },
): void {
  activeCronRunCount = Math.max(0, activeCronRunCount - 1);
  recordCronRunFinished(token, {
    activeRuns: activeCronRunCount,
    pendingRuns: pendingScheduledCronLaunchCount,
    status: options.status,
    timedOut: options.timedOut,
  });
}

function openCronDatabase(): Database {
  const database = new Database(getAppDatabasePath());
  applyAppDatabasePragmas(database, {
    busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
  });
  return database;
}

/**
 * Parse thread timestamp strings returned by DB columns.
 */
function parseThreadDate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Wait for a thread run to exit active work, or timeout.
 *
 * Uses `runStartedAt` as the cut-off to ignore status updates from an unrelated
 * previous run.
 */
async function waitForThreadRunCompletion(
  threadId: number,
  database: Database,
  runStartedAt: string | null,
  deadlineMs: number,
): Promise<{
  status: CronJobRunStatus;
  timedOut: boolean;
}> {
  const runStartedAtMs = parseThreadDate(runStartedAt) ?? Date.now();
  while (Date.now() <= deadlineMs) {
    const thread = getThreadById(database, threadId);
    if (!thread) {
      return {
        status: "Errored",
        timedOut: false,
      };
    }

    if (thread.activeTurnStartedAt === null) {
      const lastErrorAtMs = parseThreadDate(thread.lastErrorAt);
      const lastRunAtMs = parseThreadDate(thread.lastRunAt);

      if (
        typeof lastErrorAtMs === "number" &&
        lastErrorAtMs >= runStartedAtMs
      ) {
        if (
          thread.lastErrorMessage &&
          isStoppedThreadMessage(thread.lastErrorMessage)
        ) {
          return {
            status: "Stopped",
            timedOut: false,
          };
        }
        return {
          status: "Errored",
          timedOut: false,
        };
      }
      if (typeof lastRunAtMs === "number" && lastRunAtMs >= runStartedAtMs) {
        return {
          status: "Completed",
          timedOut: false,
        };
      }
      return {
        status: "Completed",
        timedOut: false,
      };
    }

    await new Promise((resolve) =>
      setTimeout(resolve, THREAD_POLL_INTERVAL_MS),
    );
  }

  return {
    status: "Errored",
    timedOut: true,
  };
}

/**
 * Launches background completion tracking for a single cron run row.
 */
async function monitorCronJobRun(
  cronJobId: number,
  runId: number,
  threadId: number,
  runMeasurement: CronRunMeasurementToken,
  runStartedAt: string | null,
  scheduledTime: number,
): Promise<void> {
  const database = openCronDatabase();
  let status: CronJobRunStatus = "Errored";
  let timedOut = false;
  try {
    const completion = await waitForThreadRunCompletion(
      threadId,
      database,
      runStartedAt,
      Date.now() + RUN_TIMEOUT_MS,
    );
    status = completion.status;
    timedOut = completion.timedOut;
    updateCronJobRunStatus(database, runId, status);
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
  } catch (error) {
    status = "Errored";
    timedOut = false;
    updateCronJobRunStatus(database, runId, status);
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
    console.error(
      `Cron job ${cronJobId} failed while waiting for thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    database.close(false);
    finishCronRunMeasurement(runMeasurement, {
      status,
      timedOut,
    });
  }
}

type CronJobExecution = {
  runId: number;
  threadId: number;
  runStartedAt: string | null;
};

export type CronThreadExecutionHost = {
  createThread: typeof createThreadProcedure;
  sendThreadMessage: typeof sendThreadMessageProcedure;
};

const defaultCronThreadExecutionHost: CronThreadExecutionHost = {
  createThread: (params) =>
    createThreadProcedure(params, undefined, {
      allowPreauthorizedUnsafeMode: params.unsafeMode === true,
    }),
  sendThreadMessage: sendThreadMessageProcedure,
};

/**
 * Create the cron job run record and execute the cron prompt in a child thread.
 * The default host flows through the same Pi-backed thread runtime used by interactive threads.
 */
async function executeCronJob(
  cronJob: CronJobRecord,
  scheduledTime: number,
  host: CronThreadExecutionHost = defaultCronThreadExecutionHost,
): Promise<CronJobExecution | null> {
  const database = openCronDatabase();
  const cronJobId = cronJob.id;
  let runId: number | null = null;
  const runMeasurement = startCronRunMeasurement();

  try {
    const threadResult = await host.createThread({
      projectId: cronJob.projectId,
      worktreePath: cronJob.worktreePath,
      model: cronJob.model ?? null,
      reasoningEffort: normalizeStoredCodexReasoningEffort(
        cronJob.reasoningEffort,
      ),
      githubAccess: cronJob.githubAccess,
      agentsAccess: cronJob.agentsAccess,
      metidosAccess: cronJob.metidosAccess,
      unsafeMode: cronJob.unsafeMode === 1,
    });
    const threadId = threadResult.thread.id;
    const run = createCronJobRun(database, {
      cronJobId,
      threadId,
      runDate: scheduledTime,
      runStatus: "InProgress",
    });
    runId = run.id;

    const execution = await host.sendThreadMessage({
      threadId,
      input: cronJob.prompt,
    });
    void monitorCronJobRun(
      cronJobId,
      run.id,
      threadId,
      runMeasurement,
      execution.thread.runStatus.startedAt,
      scheduledTime,
    );
    return {
      runId,
      threadId,
      runStartedAt: execution.thread.runStatus.startedAt,
    };
  } catch (error) {
    const status = "Errored" as const;
    if (runId) {
      updateCronJobRunStatus(database, runId, status);
    }
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
    console.error(
      `Cron job ${cronJobId} failed with error: ${error instanceof Error ? error.message : String(error)}`,
    );
    finishCronRunMeasurement(runMeasurement, {
      status,
      timedOut: false,
    });
    return null;
  } finally {
    database.close(false);
  }
}

async function runScheduledCronJob(
  cronJob: CronJobRecord,
  scheduledTime: number,
  host: CronThreadExecutionHost,
): Promise<CronJobExecution | null> {
  const limiterStats = scheduledCronExecutionLimit.stats();
  const queuedByLimiter =
    limiterStats.activeCount >= limiterStats.maxConcurrent ||
    limiterStats.pendingCount > 0;

  if (queuedByLimiter) {
    pendingScheduledCronLaunchCount += 1;
    recordCronRunQueued(pendingScheduledCronLaunchCount);
  }

  return scheduledCronExecutionLimit.run(
    async () => {
      if (queuedByLimiter) {
        decrementPendingScheduledCronLaunchCount();
      }
      return executeCronJob(cronJob, scheduledTime, host);
    },
    {
      abortMessage: `Scheduled cron job ${cronJob.id} execution was aborted.`,
    },
  );
}

/**
 * Claim due cron rows for this fire and execute them through the shared scheduled-work limiter.
 */
export async function runDueCronJobs(
  schedule: string,
  scheduledTime: number,
  host: CronThreadExecutionHost = defaultCronThreadExecutionHost,
): Promise<void> {
  const database = openCronDatabase();
  let jobs: CronJobRecord[] = [];
  try {
    jobs = claimCronJobsForScheduledRun(database, schedule, scheduledTime);
  } finally {
    database.close(false);
  }
  if (!jobs.length) {
    return;
  }

  await Promise.all(
    jobs.map((job) => runScheduledCronJob(job, scheduledTime, host)),
  );
}

/**
 * Claim a single cron row and execute it once on demand.
 */
export async function runCronJobById(
  cronJobId: number,
  scheduledTime: number,
  host: CronThreadExecutionHost = defaultCronThreadExecutionHost,
): Promise<number | null> {
  const database = openCronDatabase();
  let jobs: CronJobRecord[] = [];
  try {
    jobs = claimCronJobForScheduledRunById(database, cronJobId, scheduledTime);
  } finally {
    database.close(false);
  }
  if (!jobs.length) {
    return null;
  }
  let runThreadId: number | null = null;

  for (const job of jobs) {
    const execution = await executeCronJob(job, scheduledTime, host);
    if (runThreadId === null && execution !== null) {
      runThreadId = execution.threadId;
    }
  }
  return runThreadId;
}
