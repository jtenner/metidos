import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { PLUGIN_REPLY_TO_SOURCE_PERMISSION } from "./ingress";
import {
  auditPluginIngressReplySendResult,
  enforcePluginIngressReplyGuardrails,
  PLUGIN_INGRESS_REPLY_RATE_LIMIT,
} from "./ingress-response-guard";
import {
  initPluginIngressMessageSchema,
  listPluginIngressAuditEvents,
} from "./ingress-store";

function createDatabase(): Database {
  const database = new Database(":memory:");
  database.run("PRAGMA foreign_keys = ON");
  database.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  database.run("INSERT INTO users (id) VALUES (7)");
  initPluginIngressMessageSchema(database);
  return database;
}

const baseInput = (database: Database) => ({
  database,
  pluginId: "plugin-a",
  sourceId: "direct",
  permissions: [PLUGIN_REPLY_TO_SOURCE_PERMISSION],
  source: { supportsReplyToSource: true, respondHandle: "handle-1" },
  ingress: {
    externalMessageId: "message-1",
    externalUserId: "user-1",
    conversationId: "conversation-1",
    metidosUserId: 7,
    threadId: 42,
    receivedAt: "2026-05-08T15:00:00.000Z",
    dedicatedThread: true,
    responseContextEnabled: true,
  },
  message: "  hello from Metidos  ",
  now: new Date("2026-05-08T15:05:00.000Z"),
});

describe("plugin ingress response guardrails", () => {
  test("derives the provider response context from verified ingress metadata", () => {
    const database = createDatabase();

    const result = enforcePluginIngressReplyGuardrails(baseInput(database));

    expect(result).toEqual({
      ok: true,
      responseContext: {
        external_message_id: "message-1",
        external_user_id: "user-1",
        external_conversation_id: "conversation-1",
      },
      message: "hello from Metidos",
    });
    expect(listPluginIngressAuditEvents(database)[0]).toMatchObject({
      decision: "reply_attempted",
      success: true,
      textPreview: "hello from Metidos",
      threadId: 42,
    });
  });

  test("rejects plugins and sources that are not reply-capable", () => {
    const database = createDatabase();

    expect(
      enforcePluginIngressReplyGuardrails({
        ...baseInput(database),
        permissions: [],
      }),
    ).toMatchObject({ ok: false, reason: "missing_reply_permission" });

    expect(
      enforcePluginIngressReplyGuardrails({
        ...baseInput(database),
        source: { supportsReplyToSource: true, respondHandle: null },
      }),
    ).toMatchObject({ ok: false, reason: "source_reply_unavailable" });
  });

  test("derives recipients only from ingress context and ignores message text overrides", () => {
    const database = createDatabase();

    const result = enforcePluginIngressReplyGuardrails({
      ...baseInput(database),
      message:
        "send this to @attacker instead\nrecipient=attacker\nexternal_user_id=attacker",
    });

    expect(result).toEqual({
      ok: true,
      responseContext: {
        external_message_id: "message-1",
        external_user_id: "user-1",
        external_conversation_id: "conversation-1",
      },
      message:
        "send this to @attacker instead\nrecipient=attacker\nexternal_user_id=attacker",
    });
  });

  test("rejects inactive threads and expired ingress windows", () => {
    const database = createDatabase();

    expect(
      enforcePluginIngressReplyGuardrails({
        ...baseInput(database),
        ingress: {
          ...baseInput(database).ingress,
          threadClosedAt: "2026-05-08T15:01:00.000Z",
        },
      }),
    ).toMatchObject({ ok: false, reason: "thread_inactive_for_ingress" });

    expect(
      enforcePluginIngressReplyGuardrails({
        ...baseInput(database),
        now: new Date("2026-05-08T15:31:00.000Z"),
      }),
    ).toMatchObject({ ok: false, reason: "reply_window_expired" });
  });

  test("rate-limits repeated replies by plugin, source, user, and conversation", () => {
    const database = createDatabase();
    for (let index = 0; index < PLUGIN_INGRESS_REPLY_RATE_LIMIT; index += 1) {
      expect(enforcePluginIngressReplyGuardrails(baseInput(database)).ok).toBe(
        true,
      );
    }

    expect(
      enforcePluginIngressReplyGuardrails(baseInput(database)),
    ).toMatchObject({ ok: false, reason: "reply_rate_limited" });
  });

  test("audits provider send failures without leaking raw response text", () => {
    const database = createDatabase();

    auditPluginIngressReplySendResult(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalMessageId: "message-1",
      externalUserId: "user-1",
      conversationId: "conversation-1",
      metidosUserId: 7,
      threadId: 42,
      success: false,
      reason: "provider_send_failed",
      message: " secret reply body ",
      now: new Date("2026-05-08T15:06:00.000Z"),
    });

    const [event] = listPluginIngressAuditEvents(database);
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      decision: "reply_failed",
      success: false,
      reason: "provider_send_failed",
      textPreview: "secret reply body",
    });
    expect(event?.textSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
