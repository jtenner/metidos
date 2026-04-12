import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  createCronJob,
  createThread,
  initAppDatabase,
  listCronJobRuns,
  resetResolvedAppDataDirectory,
  upsertProject,
} from "./db";
import {
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
} from "./pi-thread-runtime";
import type { RpcThreadDetail } from "./rpc-schema";
import { getRuntimeStatsSummary, resetRuntimeStats } from "./runtime-stats";
import type { CronThreadExecutionHost } from "./sidecar-cron-runner";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalPiRuntimeTestProvider =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];

type ProjectProceduresModule = typeof import("./project-procedures");
type CronRunnerModule = typeof import("./sidecar-cron-runner");

let projectProcedures: ProjectProceduresModule | null = null;
let cronRunner: CronRunnerModule | null = null;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function initializeGitRepository(path: string): void {
  execFileSync("git", ["init"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: path,
    stdio: "ignore",
  });
  writeFileSync(join(path, "README.md"), "# Cron repo\n");
  execFileSync("git", ["add", "."], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: path,
    stdio: "ignore",
  });
}

async function loadCronModules() {
  if (projectProcedures && cronRunner) {
    return {
      cronRunner,
      projectProcedures,
    };
  }

  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
    "metidos-cron-runtime-db-",
  );
  process.env.CODEX_HOME = createTempDirectory("metidos-codex-home-");
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;
  const token = Date.now();
  projectProcedures = (await import(
    `./project-procedures?cron-runtime=${token}`
  )) as ProjectProceduresModule;
  cronRunner = (await import(
    `./sidecar-cron-runner?cron-runtime=${token}`
  )) as CronRunnerModule;
  return {
    cronRunner,
    projectProcedures,
  };
}

async function waitForThreadToSettle(
  procedures: ProjectProceduresModule,
  threadId: number,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const detail = await procedures.getThreadProcedure({
      threadId,
    });
    if (detail.thread.runStatus.state !== "working") {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for thread ${threadId} to settle.`);
}

async function waitForCronCompletion(
  procedures: ProjectProceduresModule,
  cronJobId: number,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const cronJob =
      (await procedures.listCronsProcedure(undefined)).find(
        (entry) => entry.id === cronJobId,
      ) ?? null;
    if (cronJob?.lastRunStatus === "Completed") {
      return cronJob;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for cron job ${cronJobId} to complete.`);
}

async function waitForNewThreadId(
  procedures: ProjectProceduresModule,
  existingThreadIds: Set<number>,
  projectId: number,
  worktreePath: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const newThread = (await procedures.listThreadsProcedure(undefined)).find(
      (thread) =>
        !existingThreadIds.has(thread.id) &&
        thread.projectId === projectId &&
        thread.worktreePath === worktreePath,
    );
    if (newThread) {
      return newThread.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for a cron-created thread.");
}

function createDeferredPromise<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

function buildFakeThreadDetail(options: {
  projectId: number;
  startedAt: string | null;
  threadId: number;
  worktreePath: string;
}): RpcThreadDetail {
  const updatedAt = options.startedAt ?? "2026-04-11T12:00:00.000Z";
  return {
    messages: [],
    nextCursor: null,
    thread: {
      agentsAccess: false,
      compaction: {
        estimatedTriggerSource: "heuristic",
        estimatedTriggerTokens: 0,
        inferredCount: 0,
        lastInferredAfterInputTokens: null,
        lastInferredAt: null,
        lastInferredBeforeInputTokens: null,
        maxObservedInputTokens: null,
      },
      createdAt: updatedAt,
      githubAccess: false,
      id: options.threadId,
      lastRunAt: null,
      metidosAccess: true,
      model: "gpt-5.4",
      piLeafEntryId: null,
      piSessionFile: null,
      piSessionId: null,
      pinnedAt: null,
      projectId: options.projectId,
      reasoningEffort: "medium",
      runStatus: {
        error: null,
        hasUnreadError: false,
        startedAt: options.startedAt,
        state: options.startedAt ? "working" : "idle",
        updatedAt,
      },
      summary: null,
      title: `Cron Thread ${options.threadId}`,
      unsafeMode: false,
      updatedAt,
      usage: null,
      worktreePath: options.worktreePath,
    },
  };
}

async function waitForCondition(
  description: string,
  predicate: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

beforeAll(async () => {
  await loadCronModules();
});

afterEach(async () => {
  projectProcedures?.shutdownProjectPolling();
  await projectProcedures?.shutdownActiveThreadTurns();
  if (typeof process.env.CODEX_HOME !== "string" || !process.env.CODEX_HOME) {
    process.env.CODEX_HOME = createTempDirectory("metidos-codex-home-");
  }
});

afterAll(async () => {
  projectProcedures?.shutdownProjectPolling();
  await projectProcedures?.shutdownActiveThreadTurns();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
  }
  if (typeof originalOpenAiApiKey === "string") {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  if (typeof originalPiRuntimeTestProvider === "string") {
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
      originalPiRuntimeTestProvider;
  } else {
    delete process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("sidecar cron runner", () => {
  it("runCronJobById starts a Pi-backed cron thread and records completion", async () => {
    const { cronRunner: runner, projectProcedures: procedures } =
      await loadCronModules();
    const repoPath = createTempDirectory("metidos-cron-run-now-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Cron Run Now Repo",
      projectPath: repoPath,
    });
    const cronJob = await procedures.newCronProcedure({
      agentsAccess: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: opened.project.id,
      prompt: "cron run now smoke",
      reasoningEffort: "medium",
      schedule: "* * * * *",
      unsafeMode: false,
      worktreePath: repoPath,
    });

    const threadId = await runner.runCronJobById(cronJob.id, Date.now(), {
      createThread: procedures.createThreadProcedure,
      sendThreadMessage: procedures.sendThreadMessageProcedure,
    });
    expect(threadId).not.toBeNull();
    if (threadId === null) {
      throw new Error("Expected cron runner to create a thread.");
    }
    const settled = await waitForThreadToSettle(procedures, threadId);
    const completedCron = await waitForCronCompletion(procedures, cronJob.id);
    const assistantMessages = settled.messages.filter(
      (message) => message.role === "assistant",
    );
    const lastAssistantMessage =
      assistantMessages[assistantMessages.length - 1] ?? null;

    expect(settled.thread.runStatus.state).toBe("idle");
    expect(settled.thread.piSessionId).toBeString();
    expect(settled.thread.piSessionFile).toBeString();
    expect(settled.thread.piLeafEntryId).toBeString();
    expect(Boolean(settled.thread.agentsAccess)).toBeTrue();
    expect(Boolean(settled.thread.metidosAccess)).toBeTrue();
    expect(Boolean(settled.thread.githubAccess)).toBeFalse();
    expect(Boolean(settled.thread.unsafeMode)).toBeFalse();
    expect(lastAssistantMessage?.text).toContain("pi-runtime-probe");
    expect(lastAssistantMessage?.text).toContain("cron run now smoke");
    expect(completedCron.lastRunStatus).toBe("Completed");
    expect(completedCron.lastRunDate).not.toBeNull();
  });

  it("runDueCronJobs executes scheduled work through the Pi-backed thread path", async () => {
    const { cronRunner: runner, projectProcedures: procedures } =
      await loadCronModules();
    const repoPath = createTempDirectory("metidos-cron-scheduled-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Scheduled Cron Repo",
      projectPath: repoPath,
    });
    const cronJob = await procedures.newCronProcedure({
      githubAccess: false,
      metidosAccess: false,
      model: "gpt-5.4",
      projectId: opened.project.id,
      prompt: "scheduled cron smoke",
      reasoningEffort: "medium",
      schedule: "17 * * * *",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const existingThreadIds = new Set(
      (await procedures.listThreadsProcedure(undefined)).map(
        (thread) => thread.id,
      ),
    );
    const scheduledTime = Date.now();

    await runner.runDueCronJobs(cronJob.schedule, scheduledTime, {
      createThread: procedures.createThreadProcedure,
      sendThreadMessage: procedures.sendThreadMessageProcedure,
    });

    const createdThreadId = await waitForNewThreadId(
      procedures,
      existingThreadIds,
      opened.project.id,
      repoPath,
    );
    const settled = await waitForThreadToSettle(procedures, createdThreadId);
    const completedCron = await waitForCronCompletion(procedures, cronJob.id);
    const assistantMessages = settled.messages.filter(
      (message) => message.role === "assistant",
    );
    const lastAssistantMessage =
      assistantMessages[assistantMessages.length - 1] ?? null;

    expect(settled.thread.runStatus.state).toBe("idle");
    expect(settled.thread.piSessionId).toBeString();
    expect(settled.thread.piSessionFile).toBeString();
    expect(settled.thread.piLeafEntryId).toBeString();
    expect(lastAssistantMessage?.text).toContain("pi-runtime-probe");
    expect(lastAssistantMessage?.text).toContain("scheduled cron smoke");
    expect(completedCron.lastRunStatus).toBe("Completed");
    expect(completedCron.lastRunDate).toBe(scheduledTime);
  });

  it("caps scheduled cron launches and exposes pending queue stats", async () => {
    const { cronRunner: runner } = await loadCronModules();
    resetRuntimeStats();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-limit-repo-");
    const project = upsertProject(database, {
      name: "Cron Limit Repo",
      projectPath: repoPath,
    });
    const schedule = `limit-${Date.now()}`;
    const cronJobs = [0, 1, 2].map((index) =>
      createCronJob(database, {
        agentsAccess: false,
        description: `queue test ${index}`,
        enabled: true,
        githubAccess: false,
        metidosAccess: true,
        model: "gpt-5.4",
        projectId: project.id,
        prompt: `queued cron ${index}`,
        reasoningEffort: "medium",
        schedule,
        title: `Queued Cron ${Date.now()}-${index}`,
        unsafeMode: false,
        worktreePath: repoPath,
      }),
    );

    const limiterStats = runner.getScheduledCronExecutionLimitStats();
    const inFlightSends: Array<ReturnType<typeof createDeferredPromise<void>>> =
      [];
    const threadContext = new Map<
      number,
      {
        projectId: number;
        worktreePath: string;
      }
    >();
    let activeSendCount = 0;
    let peakSendCount = 0;
    let sendCallCount = 0;

    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: params.agentsAccess ?? false,
          githubAccess: params.githubAccess ?? false,
          metidosAccess: params.metidosAccess ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: `Queued Cron Thread ${Date.now()}`,
          unsafeMode: params.unsafeMode ?? false,
          worktreePath: params.worktreePath,
        });
        threadContext.set(thread.id, {
          projectId: params.projectId,
          worktreePath: params.worktreePath,
        });
        return buildFakeThreadDetail({
          projectId: params.projectId,
          startedAt: null,
          threadId: thread.id,
          worktreePath: params.worktreePath,
        });
      },
      async sendThreadMessage(params) {
        const context = threadContext.get(params.threadId);
        if (!context) {
          throw new Error(
            `Missing fake thread context for ${params.threadId}.`,
          );
        }
        sendCallCount += 1;
        activeSendCount += 1;
        peakSendCount = Math.max(peakSendCount, activeSendCount);
        const deferred = createDeferredPromise<void>();
        inFlightSends.push(deferred);
        await deferred.promise;
        activeSendCount = Math.max(0, activeSendCount - 1);
        return buildFakeThreadDetail({
          projectId: context.projectId,
          startedAt: `2026-04-11T12:00:0${sendCallCount}.000Z`,
          threadId: params.threadId,
          worktreePath: context.worktreePath,
        });
      },
    };

    const scheduledTime = Date.now();
    const runPromise = runner.runDueCronJobs(schedule, scheduledTime, host);

    await waitForCondition("cron launch limiter saturation", () => {
      const stats = runner.getScheduledCronExecutionLimitStats();
      return (
        stats.activeCount === limiterStats.maxConcurrent &&
        stats.pendingCount === 1 &&
        sendCallCount === limiterStats.maxConcurrent
      );
    });

    expect(peakSendCount).toBe(limiterStats.maxConcurrent);
    expect(runner.getScheduledCronExecutionLimitStats()).toEqual({
      activeCount: limiterStats.maxConcurrent,
      maxConcurrent: limiterStats.maxConcurrent,
      pendingCount: 1,
    });

    inFlightSends[0]?.resolve(undefined);
    await waitForCondition(
      "queued cron launch to begin",
      () => sendCallCount === 3,
    );
    expect(peakSendCount).toBe(limiterStats.maxConcurrent);

    for (const pending of inFlightSends) {
      pending.resolve(undefined);
    }
    await runPromise;
    await waitForCondition("cron launch limiter drain", () => {
      const stats = runner.getScheduledCronExecutionLimitStats();
      return stats.activeCount === 0 && stats.pendingCount === 0;
    });

    for (const cronJob of cronJobs) {
      expect(listCronJobRuns(database, cronJob.id)).toHaveLength(1);
    }

    expect(getRuntimeStatsSummary().cron).toMatchObject({
      activeRuns: 0,
      completedRuns: 3,
      erroredRuns: 0,
      peakActiveRuns: limiterStats.maxConcurrent,
      peakPendingRuns: 1,
      pendingRuns: 0,
      saturationEvents: 1,
      startedRuns: 3,
      stoppedRuns: 0,
      timedOutRuns: 0,
    });
    expect(
      getRuntimeStatsSummary().cron.totalDurationMs,
    ).toBeGreaterThanOrEqual(0);
    expect(getRuntimeStatsSummary().cron.peakDurationMs).toBeGreaterThanOrEqual(
      getRuntimeStatsSummary().cron.lastDurationMs,
    );
  });
});
