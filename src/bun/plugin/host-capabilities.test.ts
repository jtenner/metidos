import { describe, expect, test } from "bun:test";
import {
  executePluginHostCalendarEventsOperation,
  executePluginHostEmbeddingsOperation,
  executePluginHostLanceDbOperation,
  executePluginHostLogOperation,
  executePluginHostNotificationSendOperation,
  executePluginHostSqliteOperation,
  executePluginHostTerminalOperation,
} from "./host-capabilities";

class TestHostCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestHostCapabilityError";
  }
}

const metadata = Object.freeze({ context: { threadId: 1 }, deadlineMs: 1234 });
const createError = (message: string) => new TestHostCapabilityError(message);

describe("plugin host capability operations", () => {
  test("dispatches calendar/events operations with shared permission checks", async () => {
    const calls: unknown[] = [];
    await expect(
      executePluginHostCalendarEventsOperation({
        createError,
        metadata,
        operation: "events.list",
        params: { start: "2026-05-27", end: "2026-05-28" },
        pluginApi: {
          calendarEvents: async (_operation, request) => {
            calls.push(request);
            return { ok: true };
          },
          permissions: ["events:list"],
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        ...metadata,
        params: { start: "2026-05-27", end: "2026-05-28" },
      },
    ]);

    await expect(
      executePluginHostCalendarEventsOperation({
        createError,
        metadata,
        operation: "events.list",
        params: {},
        pluginApi: { permissions: [] },
      }),
    ).rejects.toThrow("requires events:list");
  });

  test("dispatches terminal operations with unsafe and read permissions", async () => {
    await expect(
      executePluginHostTerminalOperation({
        createError,
        metadata,
        operation: "terminal.read",
        params: { terminalIndex: 0 },
        pluginApi: {
          permissions: ["terminal:read"],
          terminal: async (operation, request) => ({ operation, request }),
        },
      }),
    ).resolves.toMatchObject({ operation: "terminal.read" });

    await expect(
      executePluginHostTerminalOperation({
        createError,
        metadata,
        operation: "terminal.create",
        params: {},
        pluginApi: {
          permissions: ["terminal:create"],
          terminal: async () => ({}),
        },
      }),
    ).rejects.toThrow("requires unsafe");
  });

  test("enforces storage permissions for SQLite and LanceDB before dispatch", async () => {
    await expect(
      executePluginHostSqliteOperation({
        createError,
        metadata,
        operation: "sqlite.all",
        params: { path: "~/state.db", statement: "select 1" },
        pluginApi: {
          permissions: ["sqlite", "storage:write"],
          sqlite: async (operation, request) => ({ operation, request }),
        },
      }),
    ).resolves.toMatchObject({ operation: "sqlite.all" });

    await expect(
      executePluginHostLanceDbOperation({
        createError,
        metadata,
        operation: "lancedb.upsert",
        params: { path: "~/vectors", rows: [] },
        pluginApi: {
          lancedb: async (operation, request) => ({ operation, request }),
          permissions: ["metidos:lancedb", "storage:write"],
        },
      }),
    ).resolves.toMatchObject({ operation: "lancedb.upsert" });

    await expect(
      executePluginHostSqliteOperation({
        createError,
        metadata,
        operation: "sqlite.run",
        params: { path: "~/state.db" },
        pluginApi: { permissions: ["sqlite"] },
      }),
    ).rejects.toThrow("storage:write");
  });

  test("enforces embedding, log, and notification permissions through one path", async () => {
    await expect(
      executePluginHostEmbeddingsOperation({
        createError,
        metadata,
        params: { input: "hello", payload: null },
        pluginApi: {
          embeddings: async (request) => request,
          permissions: ["metidos:can_embed"],
        },
      }),
    ).resolves.toMatchObject({ params: { input: "hello", payload: null } });

    await expect(
      executePluginHostLogOperation({
        createError,
        metadata,
        params: { level: "info", message: "hello" },
        pluginApi: { log: async (request) => request, permissions: [] },
      }),
    ).rejects.toThrow("log:write");

    const notificationRequests: unknown[] = [];
    await expect(
      executePluginHostNotificationSendOperation({
        createError,
        metadata,
        pluginApi: {
          permissions: ["notification:send"],
          sendNotification: async (request) => {
            notificationRequests.push(request);
            return { receipts: [] };
          },
        },
        request: { body: "Body", title: "Title" },
      }),
    ).resolves.toEqual({ receipts: [] });
    expect(notificationRequests).toEqual([
      {
        body: "Body",
        clickUrl: null,
        priority: null,
        tags: [],
        title: "Title",
        ...metadata,
      },
    ]);
  });

  test("uses adapter error types for unavailable host APIs and invalid operations", async () => {
    await expect(
      executePluginHostTerminalOperation({
        createError,
        metadata,
        operation: "terminal.read",
        params: {},
        pluginApi: { permissions: ["terminal:read"] },
      }),
    ).rejects.toThrow(TestHostCapabilityError);

    await expect(
      executePluginHostSqliteOperation({
        createError,
        metadata,
        operation: "sqlite.exec",
        params: {},
        pluginApi: { permissions: ["sqlite", "storage:write"] },
      }),
    ).rejects.toThrow("Plugin SQLite operation sqlite.exec is not supported.");
  });
});
