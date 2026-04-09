import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "./db";
import {
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
} from "./pi-thread-runtime";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;
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
  process.env.JOLT_APP_DATA_DIR = createTempDirectory("jolt-cron-runtime-db-");
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

beforeAll(async () => {
  await loadCronModules();
});

afterEach(async () => {
  projectProcedures?.shutdownProjectPolling();
  await projectProcedures?.shutdownActiveThreadTurns();
});

afterAll(async () => {
  projectProcedures?.shutdownProjectPolling();
  await projectProcedures?.shutdownActiveThreadTurns();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.JOLT_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.JOLT_APP_DATA_DIR;
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
    const repoPath = createTempDirectory("jolt-cron-run-now-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Cron Run Now Repo",
      projectPath: repoPath,
    });
    const cronJob = await procedures.newCronProcedure({
      agentsAccess: true,
      githubAccess: false,
      joltAccess: true,
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
    expect(settled.thread.codexThreadId).toBeNull();
    expect(settled.thread.piSessionId).toBeString();
    expect(settled.thread.piSessionFile).toBeString();
    expect(settled.thread.piLeafEntryId).toBeString();
    expect(Boolean(settled.thread.agentsAccess)).toBeTrue();
    expect(Boolean(settled.thread.joltAccess)).toBeTrue();
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
    const repoPath = createTempDirectory("jolt-cron-scheduled-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Scheduled Cron Repo",
      projectPath: repoPath,
    });
    const cronJob = await procedures.newCronProcedure({
      githubAccess: false,
      joltAccess: false,
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
    expect(settled.thread.codexThreadId).toBeNull();
    expect(settled.thread.piSessionId).toBeString();
    expect(settled.thread.piSessionFile).toBeString();
    expect(settled.thread.piLeafEntryId).toBeString();
    expect(lastAssistantMessage?.text).toContain("pi-runtime-probe");
    expect(lastAssistantMessage?.text).toContain("scheduled cron smoke");
    expect(completedCron.lastRunStatus).toBe("Completed");
    expect(completedCron.lastRunDate).toBe(scheduledTime);
  });
});
