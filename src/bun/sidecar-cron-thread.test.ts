import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  createCronJob,
  initAppDatabase,
  resetResolvedAppDataDirectory,
  upsertProject,
} from "./db";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalAppDatabasePath = process.env.METIDOS_APP_DATABASE_PATH;
const originalWorkerOnMessage = (globalThis as { onmessage?: unknown })
  .onmessage;
const originalWorkerPostMessage = (globalThis as { postMessage?: unknown })
  .postMessage;
const originalBunCron = Bun.cron;

type WorkerStatusMessage =
  | { type: "stopped" }
  | { type: "error"; error: string }
  | {
      type: "fire";
      schedule: string;
      scheduledTime: number;
    };

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  Object.defineProperty(globalThis, "onmessage", {
    configurable: true,
    value: originalWorkerOnMessage,
    writable: true,
  });
  Object.defineProperty(globalThis, "postMessage", {
    configurable: true,
    value: originalWorkerPostMessage,
    writable: true,
  });
  (Bun as { cron: typeof Bun.cron }).cron = originalBunCron;

  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (typeof originalAppDatabasePath === "string") {
    process.env.METIDOS_APP_DATABASE_PATH = originalAppDatabasePath;
  } else {
    delete process.env.METIDOS_APP_DATABASE_PATH;
  }
});

afterAll(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("sidecar cron worker", () => {
  it("forwards due cron fires back to the main process instead of running threads in-worker", async () => {
    process.env.METIDOS_APP_DATABASE_PATH = ":memory:";
    const repoPath = createTempDirectory("metidos-cron-thread-repo-");
    mkdirSync(repoPath, {
      recursive: true,
    });
    resetResolvedAppDataDirectory();
    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Cron Thread Repo",
      projectPath: repoPath,
    });
    const cronJob = createCronJob(database, {
      agentsAccess: false,
      description: "Cron worker fire test",
      enabled: true,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      prompt: "hello from cron",
      reasoningEffort: "medium",
      schedule: "17 * * * *",
      title: "Cron Fire Test",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const postedMessages: WorkerStatusMessage[] = [];
    const registrations: Array<{
      handler: () => Promise<void> | void;
      schedule: string;
      title: string;
    }> = [];
    const fakeCron = Object.assign(
      async (
        schedule: string,
        handler: () => Promise<void> | void,
        title: string,
      ) => {
        registrations.push({
          handler,
          schedule,
          title,
        });
      },
      {
        remove: async () => undefined,
      },
    );

    Object.defineProperty(globalThis, "postMessage", {
      configurable: true,
      value: (payload: WorkerStatusMessage) => {
        postedMessages.push(payload);
      },
      writable: true,
    });
    (Bun as { cron: typeof Bun.cron }).cron =
      fakeCron as unknown as typeof Bun.cron;

    const { __testingRegisterCronJobsForOpenDatabase } = await import(
      `./sidecar-cron-thread?sidecar-cron-thread=${Date.now()}`
    );
    const cleanupCronWorker =
      await __testingRegisterCronJobsForOpenDatabase(database);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      schedule: cronJob.schedule,
      title: expect.stringContaining(`metidos-cron-${cronJob.id}-`),
    });

    await registrations[0]?.handler();

    expect(postedMessages).toContainEqual({
      schedule: cronJob.schedule,
      scheduledTime: expect.any(Number),
      type: "fire",
    });

    await cleanupCronWorker();
  });
});
