/**
 * @file src/bun/sidecar-cron-runner.ts
 * @description Pi-backed cron job execution logic used by in-process Bun.cron callbacks.
 */

import {
  createSecurityAuditEvent,
  type CronJobRecord,
  type CronJobRunStatus,
  initAppDatabase,
} from "./db";
import { createBoundCronStore } from "./cron-store";
import {
  createPiToolRequestContext,
  createThreadProcedure,
  onThreadRunSettled,
  onThreadStatusChanged,
  sendThreadMessageProcedure,
  type ThreadRunSettledEvent,
} from "./project-procedures";
import { getLocalOperatorState } from "./project-procedures/local-operator";
import { normalizeStoredCodexReasoningEffort } from "./project-procedures/model-catalog";
import { createAsyncConcurrencyLimit } from "./project-procedures/shared";
import { workContextLifecycle } from "./project-procedures/work-context-lifecycle";
import { isStoppedThreadMessage } from "./project-procedures/thread-detail";
import type { RpcThreadRunStatus } from "./rpc-schema";
import {
  type CronRunMeasurementToken,
  recordCronPendingRuns,
  recordCronRunFinished,
  recordCronRunQueued,
  recordCronRunStarted,
} from "./runtime-stats";
import { createBoundThreadStore } from "./thread-store";

/** Poll interval used only by custom test hosts that cannot publish thread-settled events. */
const THREAD_FALLBACK_POLL_INTERVAL_MS = 500;
/** Maximum elapsed time allowed for one cron invocation before marking it errored. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** Conservative launch cap for scheduler-fired cron work so bursts do not spawn unlimited threads at once. */
const SCHEDULED_CRON_EXECUTION_CONCURRENCY = 2;
const scheduledCronExecutionLimit = createAsyncConcurrencyLimit(
  SCHEDULED_CRON_EXECUTION_CONCURRENCY,
);

function persistedLocalOperatorUserId(database = initAppDatabase()): number {
  const row = database
    .query<{ id: number }, []>(`SELECT id FROM users ORDER BY id ASC LIMIT 1`)
    .get();
  if (!row) {
    throw new Error("No local operator is configured.");
  }
  return row.id;
}
let activeCronRunCount = 0;
const activeCronJobIds = new Set<number>();
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

function markCronJobActive(cronJobId: number): void {
  activeCronJobIds.add(cronJobId);
}

function clearActiveCronJob(cronJobId: number): void {
  activeCronJobIds.delete(cronJobId);
}

function cronRunStatusFromThreadState(
  state: ThreadRunSettledEvent["status"],
): CronJobRunStatus {
  if (state === "idle") {
    return "Completed";
  }
  if (state === "stopped") {
    return "Stopped";
  }
  return "Errored";
}

function cronRunStatusFromRpcThreadRunStatus(
  runStatus: RpcThreadRunStatus,
): CronJobRunStatus | null {
  if (runStatus.state === "working") {
    return null;
  }
  if (runStatus.state === "idle") {
    return "Completed";
  }
  if (runStatus.state === "stopped") {
    return "Stopped";
  }
  return "Errored";
}

function readCurrentCronThreadState(
  database: ReturnType<typeof initAppDatabase>,
  threadId: number,
): {
  active: boolean;
  status: CronJobRunStatus;
} {
  const thread = createBoundThreadStore(database).getById(threadId);
  if (!thread) {
    return {
      active: false,
      status: "Errored",
    };
  }
  if (thread.activeTurnStartedAt !== null) {
    return {
      active: true,
      status: "Errored",
    };
  }
  if (
    thread.lastErrorAt &&
    (!thread.lastRunAt || thread.lastErrorAt >= thread.lastRunAt)
  ) {
    return {
      active: false,
      status: isStoppedThreadMessage(thread.lastErrorMessage)
        ? "Stopped"
        : "Errored",
    };
  }
  return {
    active: false,
    status: "Completed",
  };
}

async function waitForThreadRunSettledFallbackPoll(
  database: ReturnType<typeof initAppDatabase>,
  threadId: number,
): Promise<{
  status: CronJobRunStatus;
  timedOut: boolean;
}> {
  const deadlineMs = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() <= deadlineMs) {
    const currentThreadState = readCurrentCronThreadState(database, threadId);
    if (!currentThreadState.active) {
      return {
        status: currentThreadState.status,
        timedOut: false,
      };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, THREAD_FALLBACK_POLL_INTERVAL_MS),
    );
  }
  return {
    status: "Errored",
    timedOut: true,
  };
}

function waitForThreadRunSettled(
  database: ReturnType<typeof initAppDatabase>,
  threadId: number,
  host: CronThreadExecutionHost,
): Promise<{
  status: CronJobRunStatus;
  timedOut: boolean;
}> {
  const currentThreadState = readCurrentCronThreadState(database, threadId);
  if (!currentThreadState.active) {
    return Promise.resolve({
      status: currentThreadState.status,
      timedOut: false,
    });
  }
  const subscribeToThreadStatusChanged = host.onThreadStatusChanged;
  if (subscribeToThreadStatusChanged) {
    return new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;
      const settle = (status: CronJobRunStatus, timedOut: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        unsubscribe?.();
        resolve({
          status,
          timedOut,
        });
      };
      timeout = setTimeout(() => settle("Errored", true), RUN_TIMEOUT_MS);
      unsubscribe = subscribeToThreadStatusChanged((thread) => {
        if (thread.id !== threadId) {
          return;
        }
        const status = cronRunStatusFromRpcThreadRunStatus(thread.runStatus);
        if (status === null) {
          return;
        }
        settle(status, false);
      });
      const latestThreadState = readCurrentCronThreadState(database, threadId);
      if (!latestThreadState.active) {
        settle(latestThreadState.status, false);
      }
    });
  }

  const subscribeToThreadRunSettled = host.onThreadRunSettled;
  if (subscribeToThreadRunSettled) {
    return new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;
      const settle = (status: CronJobRunStatus, timedOut: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        unsubscribe?.();
        resolve({
          status,
          timedOut,
        });
      };
      timeout = setTimeout(() => settle("Errored", true), RUN_TIMEOUT_MS);
      unsubscribe = subscribeToThreadRunSettled((event) => {
        if (event.threadId !== threadId) {
          return;
        }
        settle(cronRunStatusFromThreadState(event.status), false);
      });
      const latestThreadState = readCurrentCronThreadState(database, threadId);
      if (!latestThreadState.active) {
        settle(latestThreadState.status, false);
      }
    });
  }

  return waitForThreadRunSettledFallbackPoll(database, threadId);
}

/**
 * Launches background completion tracking for a single cron run row.
 */
async function monitorCronJobRun(
  database: ReturnType<typeof initAppDatabase>,
  cronJobId: number,
  runId: number,
  threadId: number,
  runMeasurement: CronRunMeasurementToken,
  scheduledTime: number,
  host: CronThreadExecutionHost,
): Promise<void> {
  const cronStore = createBoundCronStore(database);
  let status: CronJobRunStatus = "Errored";
  let timedOut = false;
  try {
    const completion = await waitForThreadRunSettled(database, threadId, host);
    status = completion.status;
    timedOut = completion.timedOut;
    cronStore.updateRunStatus(runId, status);
    cronStore.updateLastRun(cronJobId, scheduledTime, status);
  } catch (error) {
    status = "Errored";
    timedOut = false;
    cronStore.updateRunStatus(runId, status);
    cronStore.updateLastRun(cronJobId, scheduledTime, status);
    console.error(
      `Cron job ${cronJobId} failed while waiting for thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearActiveCronJob(cronJobId);
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

type CronThreadCreateParams = Parameters<typeof createThreadProcedure>[0] & {
  cronJobId: number;
};

export type CronThreadExecutionHost = {
  createThread: (
    params: CronThreadCreateParams,
  ) => ReturnType<typeof createThreadProcedure>;
  onThreadRunSettled?: typeof onThreadRunSettled;
  onThreadStatusChanged?: typeof onThreadStatusChanged;
  sendThreadMessage: typeof sendThreadMessageProcedure;
};

const defaultCronThreadExecutionHost: CronThreadExecutionHost = {
  createThread: ({ cronJobId, ...params }) => {
    const context = createPiToolRequestContext(persistedLocalOperatorUserId());
    return createThreadProcedure(params, context, {
      allowPreauthorizedUnsafeMode:
        params.permissions?.includes("metidos:unsafe") === true &&
        getLocalOperatorState(context).canManageApp,
      cronJobId,
    });
  },
  onThreadRunSettled,
  onThreadStatusChanged,
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
  const database = initAppDatabase();
  const cronStore = createBoundCronStore(database);
  const cronJobId = cronJob.id;
  markCronJobActive(cronJobId);
  let runId: number | null = null;
  let createdThreadId: number | null = null;
  let monitoringStarted = false;
  const runMeasurement = startCronRunMeasurement();

  try {
    const queued = await workContextLifecycle.threads.queueCallerTurn({
      afterThreadResolved: (threadId) => {
        const run = cronStore.createRun({
          cronJobId,
          threadId,
          runDate: scheduledTime,
          runStatus: "InProgress",
        });
        runId = run.id;
      },
      input: cronJob.prompt,
      queueTurn: ({ input, threadId }) =>
        host.sendThreadMessage({
          input,
          threadId,
        }),
      resolveThreadId: async () => {
        const threadResult = await host.createThread({
          cronJobId,
          projectId: cronJob.projectId,
          worktreePath: cronJob.worktreePath,
          model: cronJob.model ?? null,
          reasoningEffort: normalizeStoredCodexReasoningEffort(
            cronJob.reasoningEffort,
          ),
          permissions: cronJob.permissions,
        });
        createdThreadId = threadResult.thread.id;
        return threadResult.thread.id;
      },
    });
    const threadId = queued.threadId;
    const execution = queued.result;
    if (runId === null) {
      throw new Error(`Cron job ${cronJobId} did not create a run record.`);
    }
    void monitorCronJobRun(
      database,
      cronJobId,
      runId,
      threadId,
      runMeasurement,
      scheduledTime,
      host,
    );
    monitoringStarted = true;
    return {
      runId,
      threadId,
      runStartedAt: execution.thread.runStatus.startedAt,
    };
  } catch (error) {
    const status = "Errored" as const;
    if (runId) {
      cronStore.updateRunStatus(runId, status);
    } else if (createdThreadId !== null) {
      // If creating the cron-run row fails after the child thread exists, the
      // prompt was never queued and no monitor will own that thread. Remove the
      // empty child now so failed cron launches do not leak orphan threads.
      try {
        createBoundThreadStore(database).delete(createdThreadId);
      } catch (cleanupError) {
        console.error(
          `Cron job ${cronJobId} failed to delete orphaned thread ${createdThreadId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }
    cronStore.updateLastRun(cronJobId, scheduledTime, status);
    console.error(
      `Cron job ${cronJobId} failed with error: ${error instanceof Error ? error.message : String(error)}`,
    );
    finishCronRunMeasurement(runMeasurement, {
      status,
      timedOut: false,
    });
    if (!monitoringStarted) {
      clearActiveCronJob(cronJobId);
    }
    return null;
  }
}

async function runScheduledCronJob(
  cronJob: CronJobRecord,
  scheduledTime: number,
  host: CronThreadExecutionHost,
): Promise<CronJobExecution | null> {
  // This snapshot and the following limiter enqueue happen without an `await`,
  // so no other cron coroutine can interleave between them in Bun's single JS
  // thread. The derived flag is therefore stable for telemetry bookkeeping for
  // this enqueue, even though the limiter state can change after `run()` yields.
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
  const database = initAppDatabase();
  const cronStore = createBoundCronStore(database);
  const threadStore = createBoundThreadStore(database);
  const jobs: CronJobRecord[] = [];
  for (const cronJobId of cronStore.listDueScheduledJobIds(
    schedule,
    scheduledTime,
  )) {
    if (
      activeCronJobIds.has(cronJobId) ||
      threadStore.hasActiveForCronJob(cronJobId)
    ) {
      continue;
    }
    jobs.push(...cronStore.claimForScheduledRunById(cronJobId, scheduledTime));
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
  options: {
    allowStaleRestart?: boolean;
  } = {},
): Promise<number | null> {
  const database = initAppDatabase();
  const cronStore = createBoundCronStore(database);
  const threadStore = createBoundThreadStore(database);
  const cronJob = cronStore.getById(cronJobId, {
    includeNextRunDate: false,
  });
  let jobs: CronJobRecord[] = [];
  if (
    options.allowStaleRestart === true &&
    !activeCronJobIds.has(cronJobId) &&
    !threadStore.hasActiveForCronJob(cronJobId)
  ) {
    cronStore.stopInProgressRuns(cronJobId);
  }
  jobs = cronStore.claimForScheduledRunById(cronJobId, scheduledTime, {
    includeDisabled: true,
  });
  if (jobs.length > 0 && cronJob?.enabled !== 1) {
    createSecurityAuditEvent(database, {
      eventType: "disabled_cron_job_run_requested",
      payloadJson: JSON.stringify({
        cronJobId,
        scheduledTime,
      }),
      projectId: cronJob?.projectId ?? null,
      summaryText: `Manually ran disabled cron job #${cronJobId}.`,
      worktreePath: cronJob?.worktreePath ?? null,
    });
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
