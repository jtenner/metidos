import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import {
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  migrateDatabase,
  upsertProject,
} from "./db";
import { createBoundThreadStore } from "./thread-store";

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  return database;
}

function createProject(database: Database, suffix: string) {
  return upsertProject(database, {
    name: `Thread Store ${suffix}`,
    projectPath: `/tmp/metidos-thread-store-${suffix}`,
  });
}

function createThreadInput(
  project: { id: number; path: string },
  title: string,
) {
  return {
    agentsAccess: false,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    projectId: project.id,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    title,
    unsafeMode: false,
    worktreePath: project.path,
  };
}

describe("thread store", () => {
  it("uses the bound database for store methods", () => {
    const firstDatabase = createTestDatabase();
    const secondDatabase = createTestDatabase();
    try {
      const firstProject = createProject(firstDatabase, "bound-first");
      const secondProject = createProject(secondDatabase, "bound-second");
      const firstStore = createBoundThreadStore(firstDatabase);
      const secondStore = createBoundThreadStore(secondDatabase);
      const firstThread = firstStore.create(
        createThreadInput(firstProject, "First bound thread"),
      );
      secondStore.create(
        createThreadInput(secondProject, "Second bound thread"),
      );

      expect(firstStore.list().map((thread) => thread.id)).toEqual([
        firstThread.id,
      ]);
      expect(firstStore.getById(firstThread.id)?.title).toBe(
        "First bound thread",
      );
      expect(firstStore.getById(firstThread.id)?.projectId).toBe(
        firstProject.id,
      );
    } finally {
      firstDatabase.close(false);
      secondDatabase.close(false);
    }
  });

  it("persists key thread lifecycle, metadata, and status changes", () => {
    const database = createTestDatabase();
    try {
      const project = createProject(database, "lifecycle");
      const store = createBoundThreadStore(database);
      const thread = store.create(
        createThreadInput(project, "Lifecycle thread"),
      );

      store.rename(thread.id, "Renamed thread", "Summary text");
      store.setModel(thread.id, "provider/model");
      store.setReasoningEffort(thread.id, "high");
      store.setAccess(thread.id, {
        agentsAccess: true,
        calendarAccess: false,
        cronsAccess: true,
        githubAccess: true,
        gitAccess: true,
        metidosAccess: true,
        notificationsAccess: true,
        permissions: [
          "metidos:agents",
          "metidos:crons",
          "metidos:git",
          "metidos:github",
          "metidos:notifications",
          "metidos:sqlite",
          "metidos:threads",
          "metidos:unsafe",
          "metidos:web-search",
          "metidos:webserver",
        ],
        pluginAccessGroups: ["plugin-a/group-a"],
        sqliteAccess: true,
        threadsAccess: true,
        unsafeMode: true,
        weatherAccess: false,
        webSearchAccess: true,
        webServerAccess: true,
      });
      store.setPinned(thread.id, true);
      store.updatePiSessionState(thread.id, {
        piLeafEntryId: "leaf-1",
        piSessionFile: "/tmp/session.jsonl",
        piSessionId: "session-1",
      });
      store.setUsage(
        thread.id,
        {
          cachedInputTokens: 2,
          inputTokens: 10,
          outputTokens: 4,
        },
        {
          compactionCount: 1,
          estimatedCompactionTriggerTokens: 1_500,
          lastCompactionAfterInputTokens: 500,
          lastCompactionAt: "2026-06-02T12:30:00.000Z",
          lastCompactionBeforeInputTokens: 1_000,
          maxInputTokens: 2_000,
        },
      );
      store.markRunStarted(thread.id, "2026-06-02T12:00:00.000Z");
      expect(store.getById(thread.id)?.activeTurnStartedAt).toBe(
        "2026-06-02T12:00:00.000Z",
      );

      store.markFailed(thread.id, "Provider failed");
      expect(store.getById(thread.id)).toMatchObject({
        activeTurnStartedAt: null,
        agentsAccess: true,
        cronsAccess: true,
        gitAccess: true,
        githubAccess: true,
        lastCachedInputTokens: 2,
        lastCompactionAfterInputTokens: 500,
        lastCompactionAt: "2026-06-02T12:30:00.000Z",
        lastCompactionBeforeInputTokens: 1_000,
        lastErrorMessage: "Provider failed",
        lastInputTokens: 10,
        lastOutputTokens: 4,
        maxInputTokens: 2_000,
        model: "provider/model",
        notificationsAccess: true,
        piLeafEntryId: "leaf-1",
        piSessionFile: "/tmp/session.jsonl",
        piSessionId: "session-1",
        pluginAccessGroups: ["plugin-a/group-a"],
        reasoningEffort: "high",
        sqliteAccess: true,
        summary: "Summary text",
        threadsAccess: true,
        title: "Renamed thread",
        webSearchAccess: true,
        webServerAccess: true,
      });
      expect(store.getById(thread.id)?.permissions).toEqual([
        "metidos:agents",
        "metidos:crons",
        "metidos:git",
        "metidos:github",
        "metidos:notifications",
        "metidos:sqlite",
        "metidos:threads",
        "metidos:unsafe",
        "metidos:web-search",
        "metidos:webserver",
      ]);
      expect(store.getById(thread.id)?.lastErrorAt).toEqual(expect.any(String));
      expect(store.getById(thread.id)?.pinnedAt).toEqual(expect.any(String));

      store.markErrorSeen(thread.id);
      expect(store.getById(thread.id)?.lastErrorSeenAt).toEqual(
        expect.any(String),
      );

      store.markRan(thread.id);
      expect(store.getById(thread.id)).toMatchObject({
        activeTurnStartedAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastErrorSeenAt: null,
      });
      expect(store.getById(thread.id)?.lastRunAt).toEqual(expect.any(String));

      store.markRunStarted(thread.id, "2026-06-02T13:00:00.000Z");
      store.markStopped(
        thread.id,
        "Stopped by operator",
        "2026-06-02T13:05:00.000Z",
      );
      expect(store.getById(thread.id)).toMatchObject({
        activeTurnStartedAt: null,
        lastErrorAt: "2026-06-02T13:05:00.000Z",
        lastErrorMessage: "Stopped by operator",
        lastErrorSeenAt: "2026-06-02T13:05:00.000Z",
        lastRunAt: "2026-06-02T13:05:00.000Z",
      });

      store.setPinned(thread.id, false);
      expect(store.getById(thread.id)?.pinnedAt).toBeNull();

      store.delete(thread.id);
      expect(store.getById(thread.id)).toBeNull();
      expect(store.list()).toEqual([]);
    } finally {
      database.close(false);
    }
  });

  it("orders, pages, and filters visible thread records predictably", () => {
    const database = createTestDatabase();
    try {
      const project = createProject(database, "listing");
      const store = createBoundThreadStore(database);
      const firstThread = store.create(createThreadInput(project, "First"));
      const secondThread = store.create(createThreadInput(project, "Second"));
      const deletedThread = store.create(createThreadInput(project, "Deleted"));

      store.setPinned(firstThread.id, true);
      store.delete(deletedThread.id);

      expect(store.list().map((thread) => thread.id)).toEqual([
        firstThread.id,
        secondThread.id,
      ]);
      expect(
        store.listPage({ limit: 1, offset: 1 }).map((thread) => thread.id),
      ).toEqual([secondThread.id]);
      expect(
        store
          .listByIds([deletedThread.id, secondThread.id, firstThread.id])
          .map((thread) => thread.id),
      ).toEqual([firstThread.id, secondThread.id]);
    } finally {
      database.close(false);
    }
  });
});
