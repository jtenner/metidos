import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import {
  createThread,
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  migrateDatabase,
  upsertProject,
} from "../db";
import { createThreadActivityPersistenceStore } from "./thread-activity-persistence";

function createThreadFixture(): { database: Database; threadId: number } {
  const database = new Database(":memory:");
  migrateDatabase(database);
  const project = upsertProject(database, {
    name: "Project",
    projectPath: "/repo",
  });
  const thread = createThread(database, {
    agentsAccess: false,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    projectId: project.id,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    title: "Thread",
    unsafeMode: false,
    worktreePath: project.path,
  });
  return { database, threadId: thread.id };
}

describe("createThreadActivityPersistenceStore", () => {
  it("updates non-buffered activity inputs through the existing message row", () => {
    const { database, threadId } = createThreadFixture();
    const invalidatedThreadIds: number[] = [];
    const store = createThreadActivityPersistenceStore({
      database,
      invalidateThreadDetail: (invalidatedThreadId) => {
        invalidatedThreadIds.push(invalidatedThreadId);
      },
    });

    store.persistInputs([
      {
        itemId: "turn-1:assistant",
        kind: "chat",
        state: "in_progress",
        text: "Draft",
        threadId,
      },
    ]);
    store.persistInputs([
      {
        itemId: "turn-1:assistant",
        kind: "chat",
        state: "completed",
        text: "Final",
        threadId,
      },
    ]);

    expect(
      database
        .query<
          {
            itemId: string;
            state: string;
            text: string;
          },
          [number]
        >(
          `
            SELECT item_id AS itemId, state, text
            FROM thread_messages
            WHERE thread_id = ?
          `,
        )
        .all(threadId),
    ).toEqual([
      {
        itemId: "turn-1:assistant",
        state: "completed",
        text: "Final",
      },
    ]);
    expect(invalidatedThreadIds).toEqual([threadId, threadId]);
  });

  it("coalesces buffered running activity and flushes terminal state through the same message row", async () => {
    const { database, threadId } = createThreadFixture();
    const invalidatedThreadIds: number[] = [];
    let now = 1_000;
    const store = createThreadActivityPersistenceStore({
      database,
      flushIntervalMs: 10_000,
      invalidateThreadDetail: (invalidatedThreadId) => {
        invalidatedThreadIds.push(invalidatedThreadId);
      },
      now: () => now,
      performanceNow: () => now,
    });
    const writer = store.createBufferedWriter();

    await writer.queue(
      "turn-1:tool:bash-1",
      "in_progress\u0000ls",
      async () => [
        {
          itemId: "turn-1:tool:bash-1",
          kind: "command",
          payloadJson: JSON.stringify({
            command: "ls",
            exitCode: null,
            output: "",
          }),
          state: "in_progress",
          text: "ls",
          threadId,
        },
      ],
    );
    await writer.queue(
      "turn-1:tool:bash-1",
      "in_progress\u0000ls -la",
      async () => [
        {
          itemId: "turn-1:tool:bash-1",
          kind: "command",
          payloadJson: JSON.stringify({
            command: "ls -la",
            exitCode: null,
            output: "",
          }),
          state: "in_progress",
          text: "ls -la",
          threadId,
        },
      ],
    );
    await writer.flushAll();

    const afterRunningFlush = database
      .query<
        {
          id: number;
          itemId: string;
          state: string;
          text: string;
        },
        [number]
      >(
        `
          SELECT id, item_id AS itemId, state, text
          FROM thread_messages
          WHERE thread_id = ?
        `,
      )
      .all(threadId);
    expect(afterRunningFlush).toEqual([
      {
        id: expect.any(Number),
        itemId: "turn-1:tool:bash-1",
        state: "in_progress",
        text: "ls -la",
      },
    ]);
    const runningMessageId = afterRunningFlush[0]?.id;
    if (typeof runningMessageId !== "number") {
      throw new Error("Expected running activity to persist a message row.");
    }

    now = 1_001;
    await writer.queue(
      "turn-1:tool:bash-1",
      "completed\u0000ls -la",
      async () => [
        {
          itemId: "turn-1:tool:bash-1",
          kind: "command",
          payloadJson: JSON.stringify({
            command: "ls -la",
            exitCode: 0,
            output: "file.txt",
          }),
          state: "completed",
          text: "ls -la",
          threadId,
        },
      ],
      { terminal: true },
    );

    const afterTerminalFlush = database
      .query<
        {
          id: number;
          itemId: string;
          state: string;
          text: string;
        },
        [number]
      >(
        `
          SELECT id, item_id AS itemId, state, text
          FROM thread_messages
          WHERE thread_id = ?
        `,
      )
      .all(threadId);
    expect(afterTerminalFlush).toEqual([
      {
        id: runningMessageId,
        itemId: "turn-1:tool:bash-1",
        state: "completed",
        text: "ls -la",
      },
    ]);
    expect(invalidatedThreadIds).toEqual([threadId, threadId]);
  });
});
