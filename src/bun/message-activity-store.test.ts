import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import {
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  createThread,
  migrateDatabase,
  upsertProject,
} from "./db";
import { createBoundMessageActivityStore } from "./message-activity-store";

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  return database;
}

function createProject(database: Database, suffix: string) {
  return upsertProject(database, {
    name: `Message Activity Store ${suffix}`,
    projectPath: `/tmp/metidos-message-activity-store-${suffix}`,
  });
}

function createThreadFixture(database: Database, suffix: string) {
  const project = createProject(database, suffix);
  return createThread(database, {
    agentsAccess: false,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    permissions: ["metidos:threads"],
    projectId: project.id,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    title: `Message Activity Store ${suffix}`,
    unsafeMode: false,
    worktreePath: project.path,
  });
}

describe("message activity store", () => {
  it("uses the bound database for message and activity store methods", () => {
    const firstDatabase = createTestDatabase();
    const secondDatabase = createTestDatabase();
    try {
      const firstThread = createThreadFixture(firstDatabase, "bound-first");
      createThreadFixture(secondDatabase, "bound-second-padding");
      const secondThread = createThreadFixture(secondDatabase, "bound-second");
      const firstStore = createBoundMessageActivityStore(firstDatabase);
      const secondStore = createBoundMessageActivityStore(secondDatabase);

      const firstMessage = firstStore.createMessage({
        threadId: firstThread.id,
        role: "user",
        text: "First database message",
      });
      firstStore.upsertActivity({
        threadId: firstThread.id,
        itemId: "activity-1",
        kind: "tool_call",
        text: "First database activity",
        state: "in_progress",
      });
      secondStore.createMessage({
        threadId: secondThread.id,
        role: "user",
        text: "Second database message",
      });

      expect(
        firstStore.listMessages(firstThread.id).map((row) => row.text),
      ).toEqual(["First database message", "First database activity"]);
      expect(firstStore.listMessages(firstThread.id)[0]?.id).toBe(
        firstMessage.id,
      );
      expect(firstStore.listMessages(secondThread.id)).toEqual([]);
    } finally {
      firstDatabase.close(false);
      secondDatabase.close(false);
    }
  });

  it("persists, updates, pages, and stops activity rows predictably", () => {
    const database = createTestDatabase();
    try {
      const thread = createThreadFixture(database, "activity-lifecycle");
      const store = createBoundMessageActivityStore(database);

      const firstMessage = store.createMessage({
        threadId: thread.id,
        role: "user",
        text: "User prompt",
        payloadJson: JSON.stringify({ kind: "prompt" }),
      });
      const activityIds = store.upsertActivities([
        {
          threadId: thread.id,
          itemId: "reasoning-1",
          kind: "reasoning",
          text: "Thinking",
          state: "in_progress",
        },
        {
          threadId: thread.id,
          itemId: "command-1",
          kind: "command",
          text: "Running command",
          state: "in_progress",
          payloadJson: JSON.stringify({ command: "bun test" }),
        },
      ]);

      store.upsertActivity({
        threadId: thread.id,
        itemId: "reasoning-1",
        kind: "reasoning",
        text: "Done thinking",
        state: "completed",
      });
      store.stopInProgressMessages(thread.id);

      const messages = store.listMessages(thread.id);
      expect(messages.map((row) => row.text)).toEqual([
        "User prompt",
        "Done thinking",
        "Running command",
      ]);
      expect(messages[0]).toMatchObject({
        id: firstMessage.id,
        kind: "chat",
        payloadJson: JSON.stringify({ kind: "prompt" }),
        role: "user",
        state: null,
      });
      expect(messages[1]).toMatchObject({
        id: activityIds[0],
        itemId: "reasoning-1",
        kind: "reasoning",
        role: "assistant",
        state: "completed",
      });
      expect(messages[2]).toMatchObject({
        id: activityIds[1],
        itemId: "command-1",
        kind: "command",
        payloadJson: JSON.stringify({ command: "bun test" }),
        state: "stopped",
      });

      const firstPage = store.listMessagesPage(thread.id, { limit: 2 });
      expect(firstPage.messages.map((row) => row.text)).toEqual([
        "Done thinking",
        "Running command",
      ]);
      const [firstActivityId] = activityIds;
      if (firstActivityId === undefined) {
        throw new Error("expected at least one activity id");
      }
      expect(firstPage.nextCursor).toBe(firstActivityId);
      const secondPage = store.listMessagesPage(thread.id, {
        cursor: firstPage.nextCursor ?? null,
        limit: 2,
      });
      expect(secondPage.messages.map((row) => row.text)).toEqual([
        "User prompt",
      ]);
      expect(secondPage.nextCursor).toBeNull();
    } finally {
      database.close(false);
    }
  });

  it("returns empty reads and no-op cleanup for threads without messages", () => {
    const database = createTestDatabase();
    try {
      const thread = createThreadFixture(database, "empty-thread");
      const store = createBoundMessageActivityStore(database);

      expect(store.listMessages(thread.id)).toEqual([]);
      expect(store.listMessagesPage(thread.id)).toEqual({
        messages: [],
        nextCursor: null,
      });
      expect(store.listMessages(999_999)).toEqual([]);
      expect(store.listMessagesPage(999_999, { limit: 5 })).toEqual({
        messages: [],
        nextCursor: null,
      });
      expect(() => store.stopInProgressMessages(thread.id)).not.toThrow();
      expect(() => store.stopInProgressMessages(999_999)).not.toThrow();
    } finally {
      database.close(false);
    }
  });
});
