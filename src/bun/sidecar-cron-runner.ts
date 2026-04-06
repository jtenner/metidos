/**
 * @file src/bun/sidecar-cron-runner.ts
 * @description Cron job runner entrypoint used by Bun.cron registrations.
 */

import {
  type CronJobRecord,
  type CronJobRunStatus,
  claimCronJobsForScheduledRun,
  closeAppDatabase,
  createCronJobRun,
  getThreadById,
  initAppDatabase,
  updateCronJobLastRun,
  updateCronJobRunStatus,
} from "./db";
import {
  createThreadProcedure,
  sendThreadMessageProcedure,
} from "./project-procedures";
import { isStoppedThreadMessage } from "./project-procedures/thread-detail";

/** Poll interval used while waiting for the cron-spawned thread to finish. */
const THREAD_POLL_INTERVAL_MS = 500;
/** Maximum elapsed time allowed for one cron invocation before marking it errored. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

type CronExecutionController = {
  cron: string;
  scheduledTime: number;
};

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
 * Uses `runStartedAt` as the cut-off to disambiguate stale thread status from an
 * unrelated previous run.
 */
async function waitForThreadRunCompletion(
  threadId: number,
  database: ReturnType<typeof initAppDatabase>,
  runStartedAt: string | null,
  deadlineMs: number,
): Promise<CronJobRunStatus> {
  const runStartedAtMs = parseThreadDate(runStartedAt) ?? Date.now();
  while (Date.now() <= deadlineMs) {
    const thread = getThreadById(database, threadId);
    if (!thread) {
      return "Errored";
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
          return "Stopped";
        }
        return "Errored";
      }
      if (typeof lastRunAtMs === "number" && lastRunAtMs >= runStartedAtMs) {
        return "Completed";
      }
      return "Completed";
    }

    await new Promise((resolve) =>
      setTimeout(resolve, THREAD_POLL_INTERVAL_MS),
    );
  }

  return "Errored";
}

/**
 * Create the cron job run record and execute the cron prompt in a child thread.
 */
async function executeCronJob(
  database: ReturnType<typeof initAppDatabase>,
  cronJob: CronJobRecord,
  scheduledTime: number,
): Promise<CronJobRunStatus> {
  const cronJobId = cronJob.id;
  let runId: number | null = null;

  try {
    const threadResult = await createThreadProcedure({
      projectId: cronJob.projectId,
      worktreePath: cronJob.worktreePath,
    });
    const threadId = threadResult.thread.id;
    const run = createCronJobRun(database, {
      cronJobId,
      threadId,
      runDate: scheduledTime,
      runStatus: "InProgress",
    });
    runId = run.id;

    const execution = await sendThreadMessageProcedure({
      threadId,
      input: cronJob.prompt,
    });
    const status = await waitForThreadRunCompletion(
      threadId,
      database,
      execution.thread.runStatus.startedAt,
      Date.now() + RUN_TIMEOUT_MS,
    );
    updateCronJobRunStatus(database, run.id, status);
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
    return status;
  } catch (error) {
    const status = "Errored" as const;
    if (runId) {
      updateCronJobRunStatus(database, runId, status);
    }
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
    console.error(
      `Cron job ${cronJobId} failed with error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return status;
  }
}

/**
 * Claim due cron rows for this fire and execute them sequentially.
 */
async function runDueCronJobs(
  schedule: string,
  scheduledTime: number,
): Promise<void> {
  const database = initAppDatabase();
  const jobs = claimCronJobsForScheduledRun(database, schedule, scheduledTime);
  if (!jobs.length) {
    return;
  }

  for (const job of jobs) {
    await executeCronJob(database, job, scheduledTime);
  }
}

export default {
  /**
   * Bun Cron entrypoint: claim and run jobs for the provided schedule payload.
   */
  async scheduled(controller: CronExecutionController): Promise<void> {
    try {
      await runDueCronJobs(controller.cron, controller.scheduledTime);
    } finally {
      closeAppDatabase();
    }
  },
};
