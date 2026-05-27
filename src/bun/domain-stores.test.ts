import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { createBoundCronStore } from "./cron-store";
import {
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  migrateDatabase,
} from "./db";
import { createBoundMessageActivityStore } from "./message-activity-store";
import { upsertProject } from "./project-store";
import { createBoundThreadStore } from "./thread-store";

function createDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  return database;
}

function createProject(database: Database, path: string, name: string) {
  return upsertProject(database, {
    name,
    projectPath: path,
  });
}

function createThreadInput(project: { id: number; path: string }) {
  return {
    agentsAccess: false,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    projectId: project.id,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    title: "Thread",
    unsafeMode: false,
    worktreePath: project.path,
  };
}

function createCronInput(
  project: { id: number; path: string },
  options?: { title?: string },
) {
  return {
    agentsAccess: false,
    description: "Cron description",
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    projectId: project.id,
    prompt: "Run the job",
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    schedule: "0 * * * *",
    title: options?.title ?? "Cron",
    unsafeMode: false,
    worktreePath: project.path,
  };
}

describe("domain persistence stores", () => {
  it("hydrates thread records through ownerless store reads", () => {
    const database = createDatabase();
    const project = createProject(database, "/repo/project", "project");
    const threadStore = createBoundThreadStore(database);

    const thread = threadStore.create(createThreadInput(project));

    expect(thread.permissions).toContain("metidos:threads");
    expect(threadStore.getById(thread.id)?.id).toBe(thread.id);
    expect(threadStore.list().map((item) => item.id)).toEqual([thread.id]);
    expect(threadStore.listByIds([thread.id]).map((item) => item.id)).toEqual([
      thread.id,
    ]);
  });

  it("hydrates message activity rows through the message/activity store", () => {
    const database = createDatabase();
    const project = createProject(database, "/repo/alice", "alice project");
    const threadStore = createBoundThreadStore(database);
    const messageActivityStore = createBoundMessageActivityStore(database);
    const thread = threadStore.create(createThreadInput(project));

    const message = messageActivityStore.createMessage({
      payloadJson: null,
      role: "user",
      text: "hello",
      threadId: thread.id,
    });
    messageActivityStore.upsertActivity({
      itemId: "turn-1:assistant",
      kind: "chat",
      payloadJson: null,
      role: "assistant",
      state: "completed",
      text: "hi",
      threadId: thread.id,
    });

    expect(message.threadId).toBe(thread.id);
    expect(
      messageActivityStore.listMessages(thread.id).map((item) => item.text),
    ).toEqual(["hello", "hi"]);
    expect(
      messageActivityStore.listMessagesPage(thread.id, { limit: 1 }).messages,
    ).toHaveLength(1);
  });

  it("hydrates cron jobs and due scheduled job ids through ownerless reads", () => {
    const database = createDatabase();
    const project = createProject(database, "/repo/project", "project");
    const cronStore = createBoundCronStore(database);

    const cronJob = cronStore.create(createCronInput(project));

    expect(cronStore.getById(cronJob.id)?.id).toBe(cronJob.id);
    expect(cronStore.list().map((item) => item.id)).toEqual([cronJob.id]);
    expect(cronStore.listDueScheduledJobIds("0 * * * *", 1_000)).toEqual([
      cronJob.id,
    ]);
  });

  it("filters due cron job ids using the same in-progress guards as claims", () => {
    const database = createDatabase();
    const project = createProject(database, "/repo/project", "project");
    const cronStore = createBoundCronStore(database);
    const threadStore = createBoundThreadStore(database);

    const inProgressCronJob = cronStore.create(
      createCronInput(project, { title: "In-progress cron" }),
    );
    cronStore.updateLastRun(inProgressCronJob.id, 500, "InProgress");

    const activeThreadCronJob = cronStore.create(
      createCronInput(project, { title: "Active thread cron" }),
    );
    const activeThread = threadStore.create({
      ...createThreadInput(project),
      cronJobId: activeThreadCronJob.id,
      title: "Cron thread",
    });
    threadStore.markRunStarted(activeThread.id, "2026-05-03T12:00:00.000Z");

    expect(cronStore.listDueScheduledJobIds("0 * * * *", 1_000)).toEqual([]);
  });
});
