/**
 * @file src/bun/sidecar-cron-thread.ts
 * @description Worker thread that registers Bun.cron jobs for cron rows.
 */

import { Database } from "bun:sqlite";

import { listActiveCronJobs } from "./db";

type StartCronSchedulerThread = {
  type: "start";
  dbPath: string;
  runnerPath: string;
};

type StopCronSchedulerThread = {
  type: "stop";
};

type CronSchedulerThreadMessage =
  | StartCronSchedulerThread
  | StopCronSchedulerThread;

type CronSchedulerThreadStatusMessage =
  | { type: "stopped" }
  | { type: "error"; error: string };

type CronSchedulerWorkerScope = {
  onmessage: ((event: MessageEvent<CronSchedulerThreadMessage>) => void) | null;
  postMessage: (payload: CronSchedulerThreadStatusMessage) => void;
};

const workerScope = globalThis as unknown as CronSchedulerWorkerScope;

let database: Database | null = null;
const cronJobTitles = new Set<string>();

function slugifyCronTitle(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "cron-job"
  ).slice(0, 64);
}

function buildCronJobTitle(job: { id: number; title: string }): string {
  const safeTitle = slugifyCronTitle(job.title);
  return `jolt-cron-${job.id}-${safeTitle}`;
}

function postError(error: unknown): void {
  workerScope.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

async function unregisterAllCronJobs(): Promise<void> {
  for (const title of cronJobTitles) {
    try {
      await Bun.cron.remove(title);
    } catch {
      // Ignore when registration is already gone.
    }
  }
  cronJobTitles.clear();
}

async function registerCronJobs(runnerPath: string): Promise<void> {
  const databaseHandle = database;
  if (!databaseHandle) {
    return;
  }

  const jobs = listActiveCronJobs(databaseHandle);
  const scheduleByTitle = new Map<string, string>();

  for (const job of jobs) {
    scheduleByTitle.set(buildCronJobTitle(job), job.schedule);
  }

  const titles = Array.from(scheduleByTitle.keys());
  for (const title of titles) {
    const schedule = scheduleByTitle.get(title);
    if (!schedule) {
      continue;
    }
    cronJobTitles.add(title);
    await Bun.cron.remove(title).catch(() => undefined);
    try {
      await Bun.cron(runnerPath, schedule, title);
    } catch (error) {
      cronJobTitles.delete(title);
      postError(error);
    }
  }
}

async function start(message: StartCronSchedulerThread): Promise<void> {
  await unregisterAllCronJobs();
  await closeDatabase();
  database = new Database(message.dbPath);
  database.run("PRAGMA foreign_keys = ON");
  await registerCronJobs(message.runnerPath);
}

async function stop(): Promise<void> {
  await unregisterAllCronJobs();
  await closeDatabase();
  workerScope.postMessage({ type: "stopped" });
}

async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  database.close(false);
  database = null;
}

workerScope.onmessage = (event) => {
  const message = event.data as CronSchedulerThreadMessage;
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "start") {
    void start(message).catch((error) => {
      postError(error);
    });
    return;
  }

  if (message.type === "stop") {
    void stop().catch((error) => {
      postError(error);
    });
  }
};
