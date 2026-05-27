import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  extractPluginIngressLinkCode,
  PluginIngressBatchProcessor,
} from "./ingress-batch-processor";
import {
  consumePluginIngressLinkCode,
  createPluginIngressLinkCode,
  getPluginIngressExternalBinding,
  getPluginIngressMessage,
  initPluginIngressMessageSchema,
  listPluginIngressAuditEvents,
} from "./ingress-store";
import type { PluginIngressBatchThreadHost } from "./ingress-batch-processor";
import type { PluginIngressRoute } from "./ingress-thread-router";

function createDatabase(): Database {
  const database = new Database(":memory:");
  database.run("PRAGMA foreign_keys = ON");
  database.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  database.run("INSERT INTO users DEFAULT VALUES");
  initPluginIngressMessageSchema(database);
  return database;
}

function createThreadHost(route: PluginIngressRoute | null) {
  const calls = {
    created: [] as unknown[],
    sent: [] as unknown[],
  };
  const host: PluginIngressBatchThreadHost = {
    lookupRoute: () => route,
    assertRouteAccess: () => {},
    createThread: (params) => {
      calls.created.push(params);
      return { threadId: 42 };
    },
    sendThreadMessage: (input) => {
      calls.sent.push(input);
    },
  };
  return { calls, host };
}

const route: PluginIngressRoute = {
  id: "default",
  metidosUserId: 1,
  projectId: 7,
  worktreePath: "/workspace",
  permissions: ["metidos:threads"],
  enabled: true,
};

describe("PluginIngressBatchProcessor", () => {
  test("stores unverified ingress messages without routing them", async () => {
    const database = createDatabase();
    const { calls, host } = createThreadHost(route);
    const processor = new PluginIngressBatchProcessor(database, {
      threadHost: host,
      sourceResolver: () => ({
        id: "direct",
        name: "Direct messages",
        promptTemplate: () => "Handle direct messages.",
        supportsReplyToSource: false,
      }),
    });

    await processor.processBatch({
      pluginId: "chat",
      sourceId: "direct",
      messages: [{ id: "m1", user_id: "external-1", message: "hello" }],
    });

    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    expect(
      getPluginIngressMessage(database, "chat", "direct", "m1"),
    ).toMatchObject({ status: "unverified", metidosUserId: null });
    expect(
      listPluginIngressAuditEvents(database, { pluginId: "chat" })[0],
    ).toMatchObject({
      decision: "unverified_rejected",
      reason: "binding_not_found",
    });
  });

  test("detects link code command forms", () => {
    expect(extractPluginIngressLinkCode("ABCDEFG2")).toBe("ABCDEFG2");
    expect(extractPluginIngressLinkCode("/link abcdefg2")).toBe("ABCDEFG2");
    expect(extractPluginIngressLinkCode("link ABCDEFG2")).toBe("ABCDEFG2");
    expect(extractPluginIngressLinkCode("/link@metidos_bot ABCDEFG2")).toBe(
      "ABCDEFG2",
    );
    expect(extractPluginIngressLinkCode("hello ABCDEFG2")).toBeNull();
  });

  test("consumes link code messages before unverified rejection and never routes them", async () => {
    const database = createDatabase();
    const { code } = createPluginIngressLinkCode(database, {
      pluginId: "chat",
      sourceId: "direct",
      code: "ABCDEFG2",
    });
    const { calls, host } = createThreadHost(route);
    const processor = new PluginIngressBatchProcessor(database, {
      threadHost: host,
      sourceResolver: () => ({
        id: "direct",
        name: "Direct messages",
        promptTemplate: () => "Handle direct messages.",
        supportsReplyToSource: false,
      }),
    });

    await processor.processBatch({
      pluginId: "chat",
      sourceId: "direct",
      messages: [
        {
          id: "m-link",
          user_id: "external-1",
          conversation_id: "external-1",
          message: `/link ${code.toLowerCase()}`,
        },
      ],
    });

    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    expect(
      getPluginIngressExternalBinding(database, "chat", "direct", "external-1"),
    ).toMatchObject({ enabled: true });
    expect(
      getPluginIngressMessage(database, "chat", "direct", "m-link"),
    ).toMatchObject({ status: "processed", metidosUserId: null });
    expect(
      listPluginIngressAuditEvents(database, { pluginId: "chat" }).some(
        (event) => event.decision === "link_code_used" && event.success,
      ),
    ).toBe(true);
  });

  test("routes verified bound users through a plain text prompt and marks processed", async () => {
    const database = createDatabase();
    const { code } = createPluginIngressLinkCode(database, {
      pluginId: "chat",
      sourceId: "direct",
      code: "ABCDEFG2",
    });
    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "chat",
        sourceId: "direct",
        externalUserId: "external-1",
        code,
      }).ok,
    ).toBe(true);
    const { calls, host } = createThreadHost(route);
    const routed: unknown[] = [];
    const processor = new PluginIngressBatchProcessor(database, {
      threadHost: host,
      sourceResolver: () => ({
        id: "direct",
        name: "Direct messages",
        promptTemplate: (context) => `Handle ${context.external_user_id}.`,
        respondHandle: "respond:direct",
        supportsReplyToSource: true,
      }),
      onRoutedMessage: (context) => routed.push(context),
    });

    await processor.processBatch({
      pluginId: "chat",
      sourceId: "direct",
      messages: [
        {
          id: "m1",
          user_id: "external-1",
          conversation_id: "external-1",
          message: "please file this",
        },
      ],
    });

    expect(calls.created).toHaveLength(1);
    expect(calls.sent).toHaveLength(1);
    const sent = calls.sent[0] as { input: string };
    expect(sent.input).toContain(
      "The external user cannot see your response unless you use the `reply_to_source` tool.",
    );
    expect(sent.input).toContain(
      "This is the user's message. Please respond if appropriate:\n\n```\nplease file this\n```",
    );
    expect(
      getPluginIngressMessage(database, "chat", "direct", "m1"),
    ).toMatchObject({ status: "processed", metidosUserId: null });
    expect(routed).toHaveLength(1);
  });

  test("records actionable routing failures for configured but unroutable messages", async () => {
    const database = createDatabase();
    const { code } = createPluginIngressLinkCode(database, {
      pluginId: "chat",
      sourceId: "direct",
      code: "ABCDEFG2",
    });
    consumePluginIngressLinkCode(database, {
      pluginId: "chat",
      sourceId: "direct",
      externalUserId: "external-1",
      code,
    });
    const { calls, host } = createThreadHost(route);
    const processor = new PluginIngressBatchProcessor(database, {
      threadHost: host,
      sourceResolver: () => ({
        id: "direct",
        name: "Direct messages",
        promptTemplate: () => "Handle direct messages.",
        supportsReplyToSource: false,
      }),
    });

    await processor.processBatch({
      pluginId: "chat",
      sourceId: "direct",
      messages: [
        {
          id: "m1",
          user_id: "external-1",
          conversation_id: "group-1",
          message: "hello group",
        },
      ],
    });

    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    const record = getPluginIngressMessage(database, "chat", "direct", "m1");
    expect(record).toMatchObject({ status: "failed" });
    expect(record?.errorMetadata).toContain("unsupported_conversation_context");
    expect(
      listPluginIngressAuditEvents(database, { pluginId: "chat" })[0],
    ).toMatchObject({
      decision: "routing_failed",
      reason: "unsupported_conversation_context",
    });
  });
});
