import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  createCronJob,
  createCronJobRun,
  createThread,
  getCronJobById,
  getCronJobRunById,
  getThreadById,
  initAppDatabase,
  listCronJobRuns,
  listThreads,
  markThreadRunStarted,
  markThreadStopped,
  resetResolvedAppDataDirectory,
  updateCronJobLastRun,
  upsertProject,
} from "./db";
import {
  PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
} from "./pi/thread-runtime";
import type { RpcThreadDetail } from "./rpc-schema";
import { getRuntimeStatsSummary, resetRuntimeStats } from "./runtime-stats";
import type { CronThreadExecutionHost } from "./sidecar-cron-runner";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalPiRuntimeTestProvider =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
const originalPiRuntimeTestProviderChunkDelay =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV];

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

async function waitForCronStatus(
  procedures: ProjectProceduresModule,
  cronJobId: number,
  status: "Stopped",
) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const cronJob =
      (await procedures.listCronsProcedure(undefined)).find(
        (entry) => entry.id === cronJobId,
      ) ?? null;
    if (cronJob?.lastRunStatus === status) {
      return cronJob;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Timed out waiting for cron job ${cronJobId} to reach ${status}.`,
  );
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
      webSearchAccess: false,
      worktreePath: options.worktreePath,
    },
  };
}

function createProcedureBackedCronThread(
  procedures: ProjectProceduresModule,
): CronThreadExecutionHost["createThread"] {
  return (params) =>
    procedures.createThreadProcedure(params, undefined, {
      allowPreauthorizedUnsafeMode:
        params.permissions?.includes("metidos:unsafe") === true,
      cronJobId: params.cronJobId,
    });
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
  if (typeof originalPiRuntimeTestProviderChunkDelay === "string") {
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV] =
      originalPiRuntimeTestProviderChunkDelay;
  } else {
    delete process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV];
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
  it("runCronJobById propagates cron permission strings to the spawned thread", async () => {
    const { cronRunner: runner, projectProcedures: procedures } =
      await loadCronModules();
    const repoPath = createTempDirectory("metidos-cron-git-access-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Cron Git Access Repo",
      projectPath: repoPath,
    });
    const cronJob = await procedures.newCronProcedure({
      permissions: [
        "metidos:git",
        "metidos:sqlite",
        "metidos:threads",
        "metidos:crons",
      ],
      model: "gpt-5.4",
      projectId: opened.project.id,
      prompt: "cron git access smoke",
      reasoningEffort: "medium",
      schedule: "*/7 * * * *",
      worktreePath: repoPath,
    });

    const database = initAppDatabase();
    const threadContext = new Map<
      number,
      {
        projectId: number;
        worktreePath: string;
      }
    >();
    const threadId = await runner.runCronJobById(cronJob.id, Date.now(), {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          cronJobId: params.cronJobId,
          gitAccess: params.permissions?.includes("metidos:git") ?? false,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess:
            params.permissions?.some((permission) =>
              ["metidos:threads", "metidos:crons"].includes(permission),
            ) ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          sqliteAccess: params.permissions?.includes("metidos:sqlite") ?? false,
          title: `Cron Access Thread ${Date.now()}`,
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
          weatherAccess:
            params.permissions?.some((permission) =>
              permission.startsWith("weather:"),
            ) ?? false,
          worktreePath: params.worktreePath,
        });
        threadContext.set(thread.id, {
          projectId: params.projectId,
          worktreePath: params.worktreePath,
        });
        return {
          messages: [],
          nextCursor: null,
          thread: {
            ...buildFakeThreadDetail({
              projectId: params.projectId,
              startedAt: null,
              threadId: thread.id,
              worktreePath: params.worktreePath,
            }).thread,
            gitAccess: params.permissions?.includes("metidos:git") ?? false,
            sqliteAccess:
              params.permissions?.includes("metidos:sqlite") ?? false,
            weatherAccess: false,
          },
        };
      },
      async sendThreadMessage(params) {
        const context = threadContext.get(params.threadId);
        if (!context) {
          throw new Error(
            `Missing fake thread context for ${params.threadId}.`,
          );
        }
        return buildFakeThreadDetail({
          projectId: context.projectId,
          startedAt: new Date().toISOString(),
          threadId: params.threadId,
          worktreePath: context.worktreePath,
        });
      },
    });
    expect(threadId).not.toBeNull();
    if (threadId === null) {
      throw new Error("Expected cron runner to create a git-enabled thread.");
    }

    const spawnedThread = getThreadById(database, threadId);
    expect(Boolean(spawnedThread?.gitAccess)).toBeTrue();
    expect(Boolean(spawnedThread?.sqliteAccess)).toBeTrue();
    expect(Boolean(spawnedThread?.weatherAccess)).toBeFalse();
  });

  it("runCronJobById allows manual runs for disabled cron jobs", async () => {
    const { cronRunner: runner } = await loadCronModules();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-disabled-run-repo-");
    const project = upsertProject(database, {
      name: "Cron Disabled Manual Run Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Manual run while disabled",
      enabled: false,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "run even when disabled",
      reasoningEffort: "medium",
      schedule: "*/13 * * * *",
      title: "Disabled Manual Cron",
      worktreePath: repoPath,
    });
    const threadContext = new Map<
      number,
      {
        projectId: number;
        worktreePath: string;
      }
    >();
    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          cronJobId: params.cronJobId,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess:
            params.permissions?.some((permission) =>
              ["metidos:threads", "metidos:crons"].includes(permission),
            ) ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: "Disabled Cron Manual Thread",
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
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
        return buildFakeThreadDetail({
          projectId: context.projectId,
          startedAt: "2026-04-15T13:00:00.000Z",
          threadId: params.threadId,
          worktreePath: context.worktreePath,
        });
      },
    };

    const threadId = await runner.runCronJobById(cronJob.id, Date.now(), host);

    expect(threadId).not.toBeNull();
    expect(getCronJobById(database, cronJob.id)?.enabled).toBe(0);
    expect(listCronJobRuns(database, cronJob.id)).toHaveLength(1);
  });

  it("deletes an empty cron child thread when creating the run row fails", async () => {
    const { cronRunner: runner } = await loadCronModules();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-run-row-failure-repo-");
    const project = upsertProject(database, {
      name: "Cron Run Row Failure Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Run row failure cleanup",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "this prompt should never queue",
      reasoningEffort: "medium",
      schedule: "*/17 * * * *",
      title: "Run Row Failure Cron",
      worktreePath: repoPath,
    });
    let createdThreadId: number | null = null;
    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: false,
          cronJobId: params.cronJobId,
          githubAccess: false,
          metidosAccess: true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: "Run Row Failure Thread",
          unsafeMode: false,
          worktreePath: params.worktreePath,
        });
        createdThreadId = thread.id;
        return buildFakeThreadDetail({
          projectId: params.projectId,
          startedAt: null,
          threadId: thread.id,
          worktreePath: params.worktreePath,
        });
      },
      async sendThreadMessage() {
        throw new Error("sendThreadMessage should not run without a run row.");
      },
    };

    database.run(`
      CREATE TRIGGER fail_cron_job_run_insert
      BEFORE INSERT ON cron_job_runs
      BEGIN
        SELECT RAISE(ABORT, 'forced cron run insert failure');
      END;
    `);
    try {
      const threadId = await runner.runCronJobById(
        cronJob.id,
        Date.now(),
        host,
      );

      expect(threadId).toBeNull();
      expect(createdThreadId).not.toBeNull();
      expect(listCronJobRuns(database, cronJob.id)).toHaveLength(0);
      if (createdThreadId !== null) {
        expect(getThreadById(database, createdThreadId)).toBeNull();
      }
      expect(getCronJobById(database, cronJob.id)?.lastRunStatus).toBe(
        "Errored",
      );
    } finally {
      database.run("DROP TRIGGER IF EXISTS fail_cron_job_run_insert");
    }
  });

  it("marks cron runs errored before thread creation when prompt validation fails", async () => {
    const { cronRunner: runner } = await loadCronModules();
    resetRuntimeStats();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-empty-prompt-repo-");
    const project = upsertProject(database, {
      name: "Cron Empty Prompt Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Empty prompt failure",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "   ",
      reasoningEffort: "medium",
      schedule: "*/19 * * * *",
      title: "Empty Prompt Cron",
      worktreePath: repoPath,
    });
    let createThreadCalls = 0;
    const host: CronThreadExecutionHost = {
      async createThread() {
        createThreadCalls += 1;
        throw new Error("createThread should not run for an empty prompt.");
      },
      async sendThreadMessage() {
        throw new Error(
          "sendThreadMessage should not run for an empty prompt.",
        );
      },
    };

    const threadId = await runner.runCronJobById(cronJob.id, Date.now(), host);

    expect(threadId).toBeNull();
    expect(createThreadCalls).toBe(0);
    expect(listCronJobRuns(database, cronJob.id)).toHaveLength(0);
    expect(getCronJobById(database, cronJob.id)?.lastRunStatus).toBe("Errored");
    expect(getRuntimeStatsSummary().cron).toMatchObject({
      activeRuns: 0,
      erroredRuns: 1,
      startedRuns: 1,
    });
  });

  it("marks cron runs errored when thread creation fails", async () => {
    const { cronRunner: runner } = await loadCronModules();
    resetRuntimeStats();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-create-failure-repo-");
    const project = upsertProject(database, {
      name: "Cron Create Failure Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Thread creation failure",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "fail while creating the child thread",
      reasoningEffort: "medium",
      schedule: "*/23 * * * *",
      title: "Thread Create Failure Cron",
      worktreePath: repoPath,
    });
    let sendCalls = 0;
    const host: CronThreadExecutionHost = {
      async createThread() {
        throw new Error("forced child thread creation failure");
      },
      async sendThreadMessage() {
        sendCalls += 1;
        throw new Error("sendThreadMessage should not run without a thread.");
      },
    };

    const threadId = await runner.runCronJobById(cronJob.id, Date.now(), host);

    expect(threadId).toBeNull();
    expect(sendCalls).toBe(0);
    expect(listCronJobRuns(database, cronJob.id)).toHaveLength(0);
    expect(getCronJobById(database, cronJob.id)?.lastRunStatus).toBe("Errored");
    expect(getRuntimeStatsSummary().cron).toMatchObject({
      activeRuns: 0,
      erroredRuns: 1,
      startedRuns: 1,
    });
  });

  it("marks cron runs errored when queuing runtime execution fails", async () => {
    const { cronRunner: runner } = await loadCronModules();
    resetRuntimeStats();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-send-failure-repo-");
    const project = upsertProject(database, {
      name: "Cron Send Failure Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Runtime queue failure",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "fail while queuing cron prompt",
      reasoningEffort: "medium",
      schedule: "*/29 * * * *",
      title: "Runtime Queue Failure Cron",
      worktreePath: repoPath,
    });
    let createdThreadId: number | null = null;
    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: false,
          cronJobId: params.cronJobId,
          githubAccess: false,
          metidosAccess: true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: "Runtime Queue Failure Thread",
          unsafeMode: false,
          worktreePath: params.worktreePath,
        });
        createdThreadId = thread.id;
        return buildFakeThreadDetail({
          projectId: params.projectId,
          startedAt: null,
          threadId: thread.id,
          worktreePath: params.worktreePath,
        });
      },
      async sendThreadMessage() {
        throw new Error("forced runtime queue failure");
      },
    };

    const threadId = await runner.runCronJobById(cronJob.id, Date.now(), host);

    expect(threadId).toBeNull();
    expect(createdThreadId).not.toBeNull();
    const runs = listCronJobRuns(database, cronJob.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runStatus).toBe("Errored");
    expect(getCronJobById(database, cronJob.id)?.lastRunStatus).toBe("Errored");
    if (createdThreadId !== null) {
      expect(getThreadById(database, createdThreadId)).not.toBeNull();
    }
    expect(getRuntimeStatsSummary().cron).toMatchObject({
      activeRuns: 0,
      erroredRuns: 1,
      startedRuns: 1,
    });
  });

  it("runCronJobById blocks a second launch while the same cron is still in progress", async () => {
    const { cronRunner: runner } = await loadCronModules();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-overlap-repo-");
    const project = upsertProject(database, {
      name: "Cron Overlap Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Prevent overlapping runs",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "do not overlap",
      reasoningEffort: "medium",
      schedule: "*/11 * * * *",
      title: "Cron overlap guard",
      worktreePath: repoPath,
    });
    const sendStarted = createDeferredPromise<void>();
    const releaseSend = createDeferredPromise<void>();
    const threadContext = new Map<
      number,
      {
        projectId: number;
        worktreePath: string;
      }
    >();

    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          cronJobId: params.cronJobId,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess:
            params.permissions?.some((permission) =>
              ["metidos:threads", "metidos:crons"].includes(permission),
            ) ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: `Overlap Guard Thread ${Date.now()}`,
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
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
        sendStarted.resolve(undefined);
        await releaseSend.promise;
        return buildFakeThreadDetail({
          projectId: context.projectId,
          startedAt: "2026-04-15T14:00:00.000Z",
          threadId: params.threadId,
          worktreePath: context.worktreePath,
        });
      },
    };

    const firstRunDate = Date.now();
    const firstRunPromise = runner.runCronJobById(
      cronJob.id,
      firstRunDate,
      host,
    );
    await sendStarted.promise;

    const secondRunThreadId = await runner.runCronJobById(
      cronJob.id,
      firstRunDate + 1,
      host,
    );

    releaseSend.resolve(undefined);
    const firstRunThreadId = await firstRunPromise;

    expect(firstRunThreadId).not.toBeNull();
    expect(secondRunThreadId).toBeNull();
    expect(listCronJobRuns(database, cronJob.id)).toHaveLength(1);
    if (firstRunThreadId !== null) {
      expect(getThreadById(database, firstRunThreadId)?.cronJobId).toBe(
        cronJob.id,
      );
    }
  });

  it("suppresses manual overlap while a scheduled cron run is in progress and settles job status", async () => {
    const { cronRunner: runner } = await loadCronModules();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-scheduled-manual-repo-");
    const project = upsertProject(database, {
      name: "Cron Scheduled Manual Repo",
      projectPath: repoPath,
    });
    const schedule = "17 * * * *";
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Suppress manual overlap during scheduled runs",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "scheduled/manual overlap",
      reasoningEffort: "medium",
      schedule,
      title: "Scheduled Manual Overlap Guard",
      worktreePath: repoPath,
    });
    const sendStarted = createDeferredPromise<void>();
    const releaseSend = createDeferredPromise<void>();
    const threadContext = new Map<
      number,
      {
        projectId: number;
        worktreePath: string;
      }
    >();

    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const thread = createThread(database, {
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          cronJobId: params.cronJobId,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess:
            params.permissions?.some((permission) =>
              ["metidos:threads", "metidos:crons"].includes(permission),
            ) ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: "Scheduled Manual Overlap Thread",
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
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
        sendStarted.resolve(undefined);
        await releaseSend.promise;
        return buildFakeThreadDetail({
          projectId: context.projectId,
          startedAt: "2026-04-15T14:30:00.000Z",
          threadId: params.threadId,
          worktreePath: context.worktreePath,
        });
      },
    };

    const scheduledRunDate = Date.now();
    const scheduledRunPromise = runner.runDueCronJobs(
      schedule,
      scheduledRunDate,
      host,
    );
    await sendStarted.promise;

    const manualThreadId = await runner.runCronJobById(
      cronJob.id,
      scheduledRunDate + 1,
      host,
    );

    expect(manualThreadId).toBeNull();
    expect(listCronJobRuns(database, cronJob.id)).toHaveLength(1);
    expect(getCronJobById(database, cronJob.id)?.lastRunStatus).toBe(
      "InProgress",
    );

    releaseSend.resolve(undefined);
    await scheduledRunPromise;
    await waitForCondition(
      "scheduled cron monitor to settle after suppressed manual run",
      () => getCronJobById(database, cronJob.id)?.lastRunStatus === "Completed",
    );

    const runs = listCronJobRuns(database, cronJob.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runDate).toBe(scheduledRunDate);
    expect(runs[0]?.runStatus).toBe("Completed");
    expect(getCronJobById(database, cronJob.id)?.lastRunDate).toBe(
      scheduledRunDate,
    );
  });

  it("runCronJobById lets a manual restart clear stale in-progress cron state", async () => {
    const { cronRunner: runner } = await loadCronModules();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-recovery-repo-");
    const project = upsertProject(database, {
      name: "Cron Recovery Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Restart stale cron manually",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "recover stale cron state",
      reasoningEffort: "medium",
      schedule: "31 * * * *",
      title: "Cron Recovery",
      worktreePath: repoPath,
    });
    const thread = createThread(database, {
      agentsAccess: false,
      cronJobId: cronJob.id,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      piLeafEntryId: null,
      piSessionFile: null,
      piSessionId: null,
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Recovered Cron Thread",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const startedAt = "2026-04-15T15:00:00.000Z";
    const runDate = Date.now();
    markThreadRunStarted(database, thread.id, startedAt);
    const run = createCronJobRun(database, {
      cronJobId: cronJob.id,
      runDate,
      runStatus: "InProgress",
      threadId: thread.id,
    });
    updateCronJobLastRun(database, cronJob.id, runDate, "InProgress");
    markThreadStopped(
      database,
      thread.id,
      "Thread run was interrupted before completion.",
    );

    const threadContext = new Map<
      number,
      {
        projectId: number;
        worktreePath: string;
      }
    >();
    const host: CronThreadExecutionHost = {
      async createThread(params) {
        const restartedThread = createThread(database, {
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          cronJobId: params.cronJobId,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess:
            params.permissions?.some((permission) =>
              ["metidos:threads", "metidos:crons"].includes(permission),
            ) ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: "Manual Restart Thread",
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
          worktreePath: params.worktreePath,
        });
        threadContext.set(restartedThread.id, {
          projectId: params.projectId,
          worktreePath: params.worktreePath,
        });
        return buildFakeThreadDetail({
          projectId: params.projectId,
          startedAt: null,
          threadId: restartedThread.id,
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
        return buildFakeThreadDetail({
          projectId: context.projectId,
          startedAt: "2026-04-15T15:05:00.000Z",
          threadId: params.threadId,
          worktreePath: context.worktreePath,
        });
      },
    };

    const restartedThreadId = await runner.runCronJobById(
      cronJob.id,
      runDate + 1,
      host,
      {
        allowStaleRestart: true,
      },
    );

    expect(restartedThreadId).not.toBeNull();
    expect(getCronJobRunById(database, run.id)?.runStatus).toBe("Stopped");
    expect(listCronJobRuns(database, cronJob.id)).toHaveLength(2);
  });

  it("startup recovery updates and interrupts stale threads regardless of cron ownership", async () => {
    const { projectProcedures: procedures } = await loadCronModules();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-startup-thread-repo-");
    const project = upsertProject(database, {
      name: "Cron Startup Thread Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Startup-recovered cron thread",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "recover me on startup",
      reasoningEffort: "medium",
      schedule: "13 * * * *",
      title: "Startup Cron Thread",
      worktreePath: repoPath,
    });
    const regularThread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      piLeafEntryId: null,
      piSessionFile: null,
      piSessionId: null,
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Regular Interrupted Thread",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const cronThread = createThread(database, {
      agentsAccess: false,
      cronJobId: cronJob.id,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      piLeafEntryId: null,
      piSessionFile: null,
      piSessionId: null,
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Cron Interrupted Thread",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const idleThread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      piLeafEntryId: null,
      piSessionFile: null,
      piSessionId: null,
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Idle Thread",
      unsafeMode: false,
      worktreePath: repoPath,
    });

    markThreadRunStarted(
      database,
      regularThread.id,
      "2026-04-15T13:00:00.000Z",
    );
    markThreadRunStarted(database, cronThread.id, "2026-04-15T13:00:01.000Z");
    const interruptedRun = createCronJobRun(database, {
      cronJobId: cronJob.id,
      runDate: Date.parse("2026-04-15T13:00:01.000Z"),
      runStatus: "InProgress",
      threadId: cronThread.id,
    });
    updateCronJobLastRun(
      database,
      cronJob.id,
      Date.parse("2026-04-15T13:00:01.000Z"),
      "InProgress",
    );
    database.run(
      "UPDATE threads SET updated_at = '2026-04-15T12:59:59.000Z' WHERE id = ?",
      [idleThread.id],
    );

    procedures.recoverInterruptedThreadTurnsOnStartup();

    const recoveredRegularThread = getThreadById(database, regularThread.id);
    const recoveredCronThread = getThreadById(database, cronThread.id);
    const recoveredCronJob = getCronJobById(database, cronJob.id, {
      includeNextRunDate: false,
    });
    const listedThreadIds = listThreads(database).map((thread) => thread.id);

    expect(recoveredRegularThread?.lastErrorMessage).toBe(
      "Thread run was interrupted before completion.",
    );
    expect(recoveredCronThread?.lastErrorMessage).toBe(
      "Thread run was interrupted before completion.",
    );
    expect(recoveredRegularThread?.activeTurnStartedAt).toBeNull();
    expect(recoveredCronThread?.activeTurnStartedAt).toBeNull();
    expect(recoveredCronJob?.lastRunStatus).toBe("Stopped");
    expect(getCronJobRunById(database, interruptedRun.id)?.runStatus).toBe(
      "Stopped",
    );
    expect(
      listedThreadIds.slice(0, 2).sort((left, right) => left - right),
    ).toEqual(
      [regularThread.id, cronThread.id].sort((left, right) => left - right),
    );
    expect(listedThreadIds.at(-1)).toBe(idleThread.id);
  });

  it("runDueCronJobs keeps scheduled cron threads stoppable through the main-process thread runtime", async () => {
    const { cronRunner: runner, projectProcedures: procedures } =
      await loadCronModules();
    const repoPath = createTempDirectory("metidos-cron-stop-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Scheduled Cron Stop Repo",
      projectPath: repoPath,
    });
    const cronPrompt = "scheduled cron stop smoke ".repeat(160).trim();
    const cronJob = await procedures.newCronProcedure({
      permissions: [],
      model: "gpt-5.4",
      projectId: opened.project.id,
      prompt: cronPrompt,
      reasoningEffort: "medium",
      schedule: "23 * * * *",
      worktreePath: repoPath,
    });
    const sendStarted = createDeferredPromise<number>();
    const sendRelease = createDeferredPromise<void>();
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV] = "25";

    try {
      const runPromise = runner.runDueCronJobs(cronJob.schedule, Date.now(), {
        createThread: createProcedureBackedCronThread(procedures),
        sendThreadMessage: async (params) => {
          const started = await procedures.sendThreadMessageProcedure(params);
          sendStarted.resolve(params.threadId);
          await sendRelease.promise;
          return started;
        },
      });
      const createdThreadId = await sendStarted.promise;

      const stopped = await procedures.stopThreadTurnProcedure({
        threadId: createdThreadId,
      });
      sendRelease.resolve(undefined);
      await runPromise;
      const stoppedCron = await waitForCronStatus(
        procedures,
        cronJob.id,
        "Stopped",
      );

      expect(stopped.thread.runStatus.state).toBe("stopped");
      expect(stopped.thread.runStatus.error).toBe(
        "Thread run was stopped by the user.",
      );
      expect(stopped.thread.projectId).toBe(opened.project.id);
      expect(stopped.thread.worktreePath).toBe(repoPath);
      expect(stoppedCron.lastRunDate).not.toBeNull();
    } finally {
      if (typeof originalPiRuntimeTestProviderChunkDelay === "string") {
        process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV] =
          originalPiRuntimeTestProviderChunkDelay;
      } else {
        delete process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV];
      }
    }
  });

  it("lets separate manual cron runs bypass the scheduled launch limiter", async () => {
    const { cronRunner: runner } = await loadCronModules();
    resetRuntimeStats();
    const database = initAppDatabase();
    const repoPath = createTempDirectory("metidos-cron-manual-bypass-repo-");
    const project = upsertProject(database, {
      name: "Manual Cron Bypass Repo",
      projectPath: repoPath,
    });
    const cronJobs = [0, 1, 2].map((index) =>
      createCronJob(database, {
        agentsAccess: false,
        description: `manual bypass test ${index}`,
        enabled: true,
        githubAccess: false,
        metidosAccess: true,
        model: "gpt-5.4",
        projectId: project.id,
        prompt: `manual cron ${index}`,
        reasoningEffort: "medium",
        schedule: `manual-bypass-${Date.now()}-${index}`,
        title: `Manual Bypass Cron ${Date.now()}-${index}`,
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
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess: true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: `Manual Bypass Cron Thread ${Date.now()}`,
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
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

    const runPromises = cronJobs.map((cronJob, index) =>
      runner.runCronJobById(cronJob.id, Date.now() + index, host),
    );

    await waitForCondition(
      "all manual cron launches to begin without scheduler queueing",
      () => sendCallCount === cronJobs.length,
    );

    expect(peakSendCount).toBe(cronJobs.length);
    expect(runner.getScheduledCronExecutionLimitStats()).toEqual({
      activeCount: 0,
      maxConcurrent: limiterStats.maxConcurrent,
      pendingCount: 0,
    });

    for (const pending of inFlightSends) {
      pending.resolve(undefined);
    }
    await Promise.all(runPromises);

    for (const cronJob of cronJobs) {
      expect(listCronJobRuns(database, cronJob.id)).toHaveLength(1);
    }

    expect(getRuntimeStatsSummary().cron).toMatchObject({
      activeRuns: 0,
      completedRuns: 3,
      peakActiveRuns: 3,
      peakPendingRuns: 0,
      pendingRuns: 0,
      saturationEvents: 0,
      startedRuns: 3,
    });
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
          agentsAccess: params.permissions?.includes("metidos:agents") ?? false,
          githubAccess: params.permissions?.includes("metidos:github") ?? false,
          metidosAccess:
            params.permissions?.some((permission) =>
              ["metidos:threads", "metidos:crons"].includes(permission),
            ) ?? true,
          model: params.model ?? "gpt-5.4",
          piLeafEntryId: null,
          piSessionFile: null,
          piSessionId: null,
          projectId: params.projectId,
          reasoningEffort: params.reasoningEffort ?? "medium",
          title: `Queued Cron Thread ${Date.now()}`,
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
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
