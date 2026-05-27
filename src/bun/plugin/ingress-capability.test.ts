import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { getPluginIngressCursor, upsertPluginIngressCursor } from "../db";
import {
  buildPluginIngressPollSidecarRequest,
  buildPluginIngressPromptTemplateSidecarRequest,
  buildPluginIngressResponseSidecarRequest,
  PluginIngressCapability,
  type PluginIngressCapabilitySession,
} from "./ingress-capability";
import type { PluginIngressBatchThreadHost } from "./ingress-batch-processor";
import {
  consumePluginIngressLinkCode,
  createPluginIngressLinkCode,
  getPluginIngressMessage,
  initPluginIngressMessageSchema,
  listPluginIngressAuditEvents,
} from "./ingress-store";
import type { PluginIngressRoute } from "./ingress-thread-router";
import type { PluginStartupIngressSourceRegistration } from "./startup-registrations";

function createDatabase(): Database {
  const database = new Database(":memory:");
  database.run("PRAGMA foreign_keys = ON");
  database.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  database.run("INSERT INTO users DEFAULT VALUES");
  database.run(`CREATE TABLE plugin_ingress_cursors (
    plugin_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    cursor TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (plugin_id, source_id)
  )`);
  initPluginIngressMessageSchema(database);
  return database;
}

function sourceRegistration(
  overrides: Partial<PluginStartupIngressSourceRegistration> = {},
): PluginStartupIngressSourceRegistration {
  return {
    id: "direct",
    description: null,
    name: "Direct messages",
    pollHandle: "ingress:direct:poll",
    pollIntervalMs: 5_000,
    promptTemplateHandle: "ingress:direct:prompt",
    respondHandle: null,
    supportsReplyToSource: false,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function createSession(
  source: PluginStartupIngressSourceRegistration,
): PluginIngressCapabilitySession {
  return {
    directoryName: "chat_plugin",
    ingressSourceIds: new Set(),
    plugin: {
      pluginId: "chat_plugin",
      status: "active",
      approvedReviewHash: "review-1",
      currentReviewHash: "review-1",
      manifest: { permissions: ["plugin:request-ingress"] },
    } as PluginIngressCapabilitySession["plugin"],
    ready: true,
    registrations: {
      tools: [],
      crons: [],
      gc: null,
      modelProviders: [],
      notificationProviders: [],
      oauthProviders: [],
      injections: [],
      ingressSources: [source],
    },
    stopping: false,
  };
}

const route: PluginIngressRoute = {
  id: "default",
  metidosUserId: 1,
  projectId: 7,
  worktreePath: "/workspace",
  permissions: ["metidos:threads"],
  enabled: true,
};

function createThreadHost(
  overrides: Partial<PluginIngressBatchThreadHost> = {},
): {
  calls: { sent: unknown[] };
  host: PluginIngressBatchThreadHost;
} {
  const calls = { sent: [] as unknown[] };
  return {
    calls,
    host: {
      lookupRoute: () => route,
      assertRouteAccess: () => {},
      createThread: () => ({ threadId: 42 }),
      sendThreadMessage: (input) => {
        calls.sent.push(input);
      },
      ...overrides,
    },
  };
}

describe("PluginIngressCapability", () => {
  test("builds stable sidecar requests for poll, prompt template, and response callbacks", () => {
    const source = sourceRegistration({
      respondHandle: "ingress:direct:respond",
    });
    const signal = new AbortController().signal;

    expect(
      buildPluginIngressPollSidecarRequest({
        directoryName: "chat_plugin",
        source,
        context: { cursor: "cursor-0", maxMessages: 25, signal },
      }),
    ).toMatchObject({
      directoryName: "chat_plugin",
      operation: "ingress.poll",
      params: {
        context: { cursor: "cursor-0", maxMessages: 25 },
        pollHandle: "ingress:direct:poll",
        sourceId: "direct",
      },
      signal,
      timeoutMs: 5_000,
    });

    expect(
      buildPluginIngressPromptTemplateSidecarRequest({
        directoryName: "chat_plugin",
        source,
        context: {
          sourceId: "direct",
          sourceName: "Direct messages",
          external_message_id: "m1",
          external_user_id: "u1",
        },
      }),
    ).toMatchObject({
      operation: "ingress.prompt.template",
      params: {
        promptTemplateHandle: "ingress:direct:prompt",
        sourceId: "direct",
      },
    });

    expect(
      buildPluginIngressResponseSidecarRequest({
        directoryName: "chat_plugin",
        source,
        context: { external_message_id: "m1", external_user_id: "u1" },
        payload: { message: "Done" },
      }),
    ).toMatchObject({
      operation: "ingress.respond",
      params: {
        payload: { message: "Done" },
        respondHandle: "ingress:direct:respond",
        sourceId: "direct",
      },
    });
  });

  test("registers poll sources, hydrates cursors, invokes polling, and persists returned cursors", async () => {
    const database = createDatabase();
    const source = sourceRegistration();
    const session = createSession(source);
    upsertPluginIngressCursor(database, {
      pluginId: "chat_plugin",
      sourceId: "direct",
      cursor: "cursor-0",
    });
    const pollContexts: unknown[] = [];

    const capability = new PluginIngressCapability({
      database,
      logger: { warning: () => {} },
      operations: {
        findReadySession: () => session,
        invokePoll: async ({ context }) => {
          pollContexts.push(context);
          return { cursor: "cursor-1", messages: [] };
        },
        invokePromptTemplate: async () => "Handle this message.",
        invokeResponse: async () => {},
      },
      sendNotification: async () => ({ receipts: [] }),
    });

    capability.registerSessionSources(session);
    await capability.pollSourceNow("chat_plugin", "direct");

    expect(pollContexts[0]).toMatchObject({
      cursor: "cursor-0",
      maxMessages: 50,
    });
    expect(
      getPluginIngressCursor(database, "chat_plugin", "direct")?.cursor,
    ).toBe("cursor-1");
  });

  test("routes verified messages through the batch processor and binds reply contexts", async () => {
    const database = createDatabase();
    const source = sourceRegistration({
      respondHandle: "ingress:direct:respond",
      supportsReplyToSource: true,
    });
    const session = createSession(source);
    const { code } = createPluginIngressLinkCode(database, {
      pluginId: "chat_plugin",
      sourceId: "direct",
      code: "ABCDEFG2",
    });
    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "chat_plugin",
        sourceId: "direct",
        externalUserId: "external-1",
        code,
      }).ok,
    ).toBe(true);
    const { calls, host } = createThreadHost();
    const replies: unknown[] = [];

    const capability = new PluginIngressCapability({
      database,
      ingressThreadHost: host,
      logger: { warning: () => {} },
      now: () => new Date("2026-05-10T20:00:00Z"),
      operations: {
        findReadySession: () => session,
        invokePoll: async () => ({
          messages: [
            {
              id: "m1",
              user_id: "external-1",
              conversation_id: "external-1",
              message: "please summarize this",
            },
          ],
        }),
        invokePromptTemplate: async ({ context }) =>
          `Handle ${context.external_user_id}.`,
        invokeResponse: async (input) => {
          replies.push(input);
        },
      },
      sendNotification: async () => ({ receipts: [] }),
    });

    capability.registerSessionSources(session);
    await capability.pollSourceNow("chat_plugin", "direct");

    expect(calls.sent).toHaveLength(1);
    expect(
      getPluginIngressMessage(database, "chat_plugin", "direct", "m1"),
    ).toMatchObject({ status: "processed", metidosUserId: null });
    expect(capability.getActiveReplyContext(42)).toMatchObject({
      pluginId: "chat_plugin",
      sourceId: "direct",
      ingress: {
        externalMessageId: "m1",
        responseContextEnabled: true,
        threadId: 42,
      },
    });

    await capability.sendReplyToSource({
      pluginId: "chat_plugin",
      sourceId: "direct",
      responseContext: {
        external_message_id: "m1",
        external_user_id: "external-1",
      },
      message: "Done",
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ payload: { message: "Done" } });
  });

  test("clears pre-registered reply contexts when route execution fails", async () => {
    const database = createDatabase();
    const source = sourceRegistration({
      respondHandle: "ingress:direct:respond",
      supportsReplyToSource: true,
    });
    const session = createSession(source);
    const { code } = createPluginIngressLinkCode(database, {
      pluginId: "chat_plugin",
      sourceId: "direct",
      code: "ABCDEFG2",
    });
    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "chat_plugin",
        sourceId: "direct",
        externalUserId: "external-1",
        code,
      }).ok,
    ).toBe(true);
    const { calls, host } = createThreadHost({
      sendThreadMessage: (input) => {
        calls.sent.push(input);
        throw new Error("configured model is unavailable");
      },
    });

    const capability = new PluginIngressCapability({
      database,
      ingressThreadHost: host,
      logger: { warning: () => {} },
      now: () => new Date("2026-05-10T20:00:00Z"),
      operations: {
        findReadySession: () => session,
        invokePoll: async () => ({
          cursor: "cursor-2",
          messages: [
            {
              id: "m-fail",
              user_id: "external-1",
              conversation_id: "external-1",
              message: "please summarize this",
            },
          ],
        }),
        invokePromptTemplate: async () => "ignored",
        invokeResponse: async () => {},
      },
      sendNotification: async () => ({ receipts: [] }),
    });

    capability.registerSessionSources(session);
    await capability.pollSourceNow("chat_plugin", "direct");

    expect(calls.sent).toHaveLength(1);
    expect(
      getPluginIngressMessage(database, "chat_plugin", "direct", "m-fail"),
    ).toMatchObject({ status: "failed" });
    expect(capability.getActiveReplyContext(42)).toBeNull();
    expect(
      listPluginIngressAuditEvents(database, { pluginId: "chat_plugin" })[0],
    ).toMatchObject({
      decision: "routing_failed",
      reason: "route_execution_failed",
      threadId: 42,
    });
    expect(
      getPluginIngressCursor(database, "chat_plugin", "direct"),
    ).toMatchObject({ cursor: "cursor-2" });
  });
});
