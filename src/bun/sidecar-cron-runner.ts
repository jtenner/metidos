/**
 * @file src/bun/sidecar-cron-runner.ts
 * @description Cron job execution logic used by in-process Bun.cron callbacks.
 */

import { Database } from "bun:sqlite";
import {
  type CronJobRecord,
  type CronJobRunStatus,
  claimCronJobForScheduledRunById,
  claimCronJobsForScheduledRun,
  createCronJobRun,
  getAppDatabasePath,
  getThreadById,
  updateCronJobLastRun,
  updateCronJobRunStatus,
} from "./db";
import {
  createThreadProcedure,
  sendThreadMessageProcedure,
} from "./project-procedures";
import { normalizeStoredCodexReasoningEffort } from "./project-procedures/codex-catalog";
import { isStoppedThreadMessage } from "./project-procedures/thread-detail";

/** Poll interval used while waiting for the cron-spawned thread to finish. */
const THREAD_POLL_INTERVAL_MS = 500;
/** Maximum elapsed time allowed for one cron invocation before marking it errored. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const SQL_BUSY_TIMEOUT_MS = 2500;

function openCronDatabase(): Database {
  const database = new Database(getAppDatabasePath());
  database.run("PRAGMA foreign_keys = ON");
  database.run(`PRAGMA busy_timeout = ${SQL_BUSY_TIMEOUT_MS}`);
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
 * Uses `runStartedAt` as the cut-off to disambiguate stale thread status from an
 * unrelated previous run.
 */
async function waitForThreadRunCompletion(
  threadId: number,
  database: Database,
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
 * Launches background completion tracking for a single cron run row.
 */
async function monitorCronJobRun(
  cronJobId: number,
  runId: number,
  threadId: number,
  runStartedAt: string | null,
  scheduledTime: number,
): Promise<void> {
  const database = openCronDatabase();
  try {
    const status = await waitForThreadRunCompletion(
      threadId,
      database,
      runStartedAt,
      Date.now() + RUN_TIMEOUT_MS,
    );
    updateCronJobRunStatus(database, runId, status);
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
  } catch (error) {
    const status = "Errored" as const;
    updateCronJobRunStatus(database, runId, status);
    updateCronJobLastRun(database, cronJobId, scheduledTime, status);
    console.error(
      `Cron job ${cronJobId} failed while waiting for thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    database.close(false);
  }
}

type CronJobExecution = {
  runId: number;
  threadId: number;
  runStartedAt: string | null;
};

/**
 * Create the cron job run record and execute the cron prompt in a child thread.
 */
async function executeCronJob(
  database: Database,
  cronJob: CronJobRecord,
  scheduledTime: number,
): Promise<CronJobExecution | null> {
  const cronJobId = cronJob.id;
  let runId: number | null = null;

  try {
    const threadResult = await createThreadProcedure({
      projectId: cronJob.projectId,
      worktreePath: cronJob.worktreePath,
      model: cronJob.model ?? null,
      reasoningEffort: normalizeStoredCodexReasoningEffort(
        cronJob.reasoningEffort,
      ),
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

    const execution = await sendThreadMessageProcedure({
      threadId,
      input: cronJob.prompt,
    });
    void monitorCronJobRun(
      cronJobId,
      run.id,
      threadId,
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
    return null;
  }
}

/**
 * Claim due cron rows for this fire and execute them sequentially.
 */
export async function runDueCronJobs(
  schedule: string,
  scheduledTime: number,
): Promise<void> {
  const database = openCronDatabase();
  try {
    const jobs = claimCronJobsForScheduledRun(
      database,
      schedule,
      scheduledTime,
    );
    if (!jobs.length) {
      return;
    }

    for (const job of jobs) {
      await executeCronJob(database, job, scheduledTime);
    }
  } finally {
    database.close(false);
  }
}

/**
 * Claim a single cron row and execute it once on demand.
 */
export async function runCronJobById(
  cronJobId: number,
  scheduledTime: number,
): Promise<number | null> {
  const database = openCronDatabase();
  try {
    const jobs = claimCronJobForScheduledRunById(
      database,
      cronJobId,
      scheduledTime,
    );
    if (!jobs.length) {
      return null;
    }
    let runThreadId: number | null = null;

    for (const job of jobs) {
      const execution = await executeCronJob(database, job, scheduledTime);
      if (runThreadId === null && execution !== null) {
        runThreadId = execution.threadId;
      }
    }
    return runThreadId;
  } finally {
    database.close(false);
  }
}
