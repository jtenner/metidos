import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  cleanupPluginIngressMessages,
  consumePluginIngressLinkCode,
  createPluginIngressAuditEvent,
  createPluginIngressLinkCode,
  deletePluginIngressExternalBinding,
  getPluginIngressExternalBinding,
  getPluginIngressMessage,
  getPluginIngressRouteConfig,
  initPluginIngressMessageSchema,
  listPluginIngressAuditEvents,
  listPluginIngressExternalBindings,
  listPluginIngressRouteConfigs,
  persistPluginIngressMessage,
  setPluginIngressExternalBindingEnabled,
  upsertPluginIngressRouteConfig,
  PLUGIN_INGRESS_AUDIT_PREVIEW_MAX_LENGTH,
  PLUGIN_INGRESS_LINK_CODE_PATTERN,
  PLUGIN_INGRESS_UNVERIFIED_WINDOW_LIMIT,
} from "./ingress-store";

function createDatabase(): Database {
  const database = new Database(":memory:");
  database.run("PRAGMA foreign_keys = ON");
  database.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  database.run("CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  database.run("INSERT INTO projects DEFAULT VALUES");
  database.run("INSERT INTO users DEFAULT VALUES");
  database.run("INSERT INTO users DEFAULT VALUES");
  initPluginIngressMessageSchema(database);
  return database;
}

describe("plugin ingress message store", () => {
  test("dedupes by plugin, source, and external message id", () => {
    const database = createDatabase();
    const first = persistPluginIngressMessage(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalMessageId: "message-1",
      externalUserId: "user-1",
      messageText: "hello",
      status: "verified",
    });
    const second = persistPluginIngressMessage(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalMessageId: "message-1",
      externalUserId: "user-1",
      messageText: "changed text is ignored for dedupe",
      status: "failed",
    });
    const otherSource = persistPluginIngressMessage(database, {
      pluginId: "plugin-a",
      sourceId: "other",
      externalMessageId: "message-1",
      externalUserId: "user-1",
      messageText: "hello from another source",
      status: "verified",
    });

    expect(first.rateLimited).toBe(false);
    expect(second.record?.id).toBe(first.record?.id);
    expect(second.record?.messageText).toBe("hello");
    expect(otherSource.record?.id).not.toBe(first.record?.id);
  });

  test("rejects invalid identifiers and oversized text before storage", () => {
    const database = createDatabase();
    expect(() =>
      persistPluginIngressMessage(database, {
        pluginId: "plugin-a",
        sourceId: "Bad Source",
        externalMessageId: "message-1",
        externalUserId: "user-1",
        messageText: "hello",
        status: "verified",
      }),
    ).toThrow("Invalid plugin ingress source id");
    expect(
      database
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM plugin_ingress_messages",
        )
        .get()?.count,
    ).toBe(0);
  });

  test("stores compact rate-limit markers instead of over-limit unverified text", () => {
    const database = createDatabase();
    const now = new Date("2026-05-08T15:00:00.000Z");
    for (let i = 0; i < PLUGIN_INGRESS_UNVERIFIED_WINDOW_LIMIT; i += 1) {
      persistPluginIngressMessage(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
        externalMessageId: `message-${i}`,
        externalUserId: "user-1",
        conversationId: "user-1",
        messageText: "unverified",
        status: "unverified",
        now,
      });
    }

    const limited = persistPluginIngressMessage(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalMessageId: "message-over-limit",
      externalUserId: "user-1",
      conversationId: "user-1",
      messageText: "do not store this text",
      status: "unverified",
      now,
    });

    expect(limited.rateLimited).toBe(true);
    expect(
      getPluginIngressMessage(
        database,
        "plugin-a",
        "direct",
        "message-over-limit",
      ),
    ).toBeNull();
    expect(
      database
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM plugin_ingress_rate_limit_markers",
        )
        .get()?.count,
    ).toBe(2);
  });

  test("stores bounded audit events for ingress and reply decisions", () => {
    const database = createDatabase();
    const text = `  ${"sensitive reply ".repeat(40)}  `;

    const event = createPluginIngressAuditEvent(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      decision: "reply_failed",
      externalMessageId: "message-1",
      externalUserId: "external-user-1",
      conversationId: "conversation-1",
      metidosUserId: null,
      threadId: 42,
      success: false,
      reason: "provider_send_failed",
      text,
      metadata: { code: "upstream_timeout", secret: undefined },
      now: new Date("2026-05-08T15:00:00.000Z"),
    });

    expect(event).toMatchObject({
      pluginId: "plugin-a",
      sourceId: "direct",
      decision: "reply_failed",
      success: false,
      reason: "provider_send_failed",
      threadId: 42,
    });
    expect(event.textPreview?.length).toBeLessThanOrEqual(
      PLUGIN_INGRESS_AUDIT_PREVIEW_MAX_LENGTH,
    );
    expect(event.textPreview).not.toContain("  ");
    expect(event.textSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(
      listPluginIngressAuditEvents(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
      }),
    ).toEqual([event]);
  });

  test("generates bounded one-time link codes when no code is provided", () => {
    const database = createDatabase();
    const generatedCodes = new Set<string>();

    for (let index = 0; index < 20; index += 1) {
      const { code, record } = createPluginIngressLinkCode(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
        now: new Date(
          `2026-05-08T15:${String(index).padStart(2, "0")}:00.000Z`,
        ),
      });
      expect(code).toMatch(PLUGIN_INGRESS_LINK_CODE_PATTERN);
      expect(record.codeSha256).not.toBe(code);
      generatedCodes.add(code);
    }

    expect(generatedCodes.size).toBeGreaterThan(1);
  });

  test("creates one-time link codes and verified external bindings", () => {
    const database = createDatabase();
    const now = new Date("2026-05-08T15:00:00.000Z");
    createPluginIngressAuditEvent(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      decision: "unverified_rejected",
      success: false,
      now,
    });
    const { code, record } = createPluginIngressLinkCode(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      code: "ABCD1234",
      now,
    });

    expect(code).toBe("ABCD1234");
    expect(record.codeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.codeSha256).not.toBe(code);

    const linked = consumePluginIngressLinkCode(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalUserId: "external-user-1",
      code,
      now: new Date("2026-05-08T15:01:00.000Z"),
    });

    expect(linked).toMatchObject({
      ok: true,
      binding: {
        pluginId: "plugin-a",
        sourceId: "direct",
        externalUserId: "external-user-1",
        enabled: true,
      },
    });
    expect(
      getPluginIngressExternalBinding(
        database,
        "plugin-a",
        "direct",
        "external-user-1",
      )?.metidosUserId,
    ).toBeNull();
    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
        externalUserId: "external-user-2",
        code,
        now: new Date("2026-05-08T15:02:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "consumed" });
  });

  test("rejects malformed, wrong-scope, and expired link codes safely", () => {
    const database = createDatabase();
    createPluginIngressLinkCode(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      code: "ZXCV9876",
      now: new Date("2026-05-08T15:00:00.000Z"),
      ttlMs: 60_000,
    });

    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
        externalUserId: "external-user-1",
        code: "bad code",
      }),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "plugin-a",
        sourceId: "other",
        externalUserId: "external-user-1",
        code: "ZXCV9876",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      consumePluginIngressLinkCode(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
        externalUserId: "external-user-1",
        code: "ZXCV9876",
        now: new Date("2026-05-08T15:02:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  test("lists, disables, and removes external bindings without exposing link codes", () => {
    const database = createDatabase();
    const { code } = createPluginIngressLinkCode(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      code: "QWER5678",
      now: new Date("2026-05-08T15:00:00.000Z"),
    });
    const linked = consumePluginIngressLinkCode(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalUserId: "external-user-1",
      code,
      now: new Date("2026-05-08T15:01:00.000Z"),
    });
    if (!linked.ok) throw new Error("Expected link code to create a binding.");

    expect(
      listPluginIngressExternalBindings(database, {
        pluginId: "plugin-a",
      }),
    ).toMatchObject([
      {
        externalUserId: "external-user-1",
        enabled: true,
        pluginId: "plugin-a",
        sourceId: "direct",
      },
    ]);

    const disabled = setPluginIngressExternalBindingEnabled(
      database,
      linked.binding.id,
      false,
      new Date("2026-05-08T15:02:00.000Z"),
    );
    expect(disabled?.enabled).toBe(false);
    expect(
      listPluginIngressAuditEvents(database, { pluginId: "plugin-a" }).map(
        (event) => event.reason,
      ),
    ).toContain("disabled");

    const removed = deletePluginIngressExternalBinding(
      database,
      linked.binding.id,
      new Date("2026-05-08T15:03:00.000Z"),
    );
    expect(removed?.externalUserId).toBe("external-user-1");
    expect(listPluginIngressExternalBindings(database)).toEqual([]);
  });

  test("persists local route configs for ingress-created threads", () => {
    const database = createDatabase();
    const route = upsertPluginIngressRouteConfig(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      projectId: 1,
      worktreePath: "/workspace/project",
      model: "openai-codex:gpt-5.4",
      permissions: ["metidos:threads", "metidos:threads"],
      enabled: true,
      now: new Date("2026-05-08T15:00:00.000Z"),
    });

    expect(route).toMatchObject({
      enabled: true,
      model: "openai-codex:gpt-5.4",
      permissions: ["metidos:threads"],
      pluginId: "plugin-a",
      projectId: 1,
      sourceId: "direct",
      worktreePath: "/workspace/project",
    });
    expect(
      getPluginIngressRouteConfig(database, {
        pluginId: "plugin-a",
        sourceId: "direct",
      }),
    ).toMatchObject({ id: route.id, projectId: 1 });

    const updated = upsertPluginIngressRouteConfig(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      projectId: 1,
      worktreePath: "/workspace/project-alt",
      model: "anthropic-codex:claude-sonnet-4.5",
      permissions: [],
      enabled: false,
      now: new Date("2026-05-08T15:01:00.000Z"),
    });

    expect(updated.id).toBe(route.id);
    expect(updated.enabled).toBe(false);
    expect(updated.model).toBe("anthropic-codex:claude-sonnet-4.5");
    expect(updated.permissions).toEqual([]);
    expect(listPluginIngressRouteConfigs(database)).toHaveLength(1);
    expect(
      listPluginIngressAuditEvents(database, { pluginId: "plugin-a" }).map(
        (event) => event.reason,
      ),
    ).toContain("route_config_updated");
  });

  test("adds the route config model column to existing databases", () => {
    const database = new Database(":memory:");
    database.run("PRAGMA foreign_keys = ON");
    database.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)");
    database.run(
      "CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT)",
    );
    database.run("INSERT INTO projects DEFAULT VALUES");
    database.run("INSERT INTO users DEFAULT VALUES");
    database.run(`CREATE TABLE plugin_ingress_route_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      metidos_user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      worktree_path TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(plugin_id, source_id, metidos_user_id)
    )`);

    const route = upsertPluginIngressRouteConfig(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      projectId: 1,
      worktreePath: "/workspace/project",
      model: "openai-codex:gpt-5.4",
      permissions: ["metidos:threads"],
      enabled: true,
    });

    expect(route.model).toBe("openai-codex:gpt-5.4");
    expect(
      database
        .query<{ name: string }, []>(
          "PRAGMA table_info(plugin_ingress_route_configs)",
        )
        .all()
        .map((column) => column.name),
    ).toContain("model");
  });

  test("removes short-retention diagnostics and redacts old verified text", () => {
    const database = createDatabase();
    persistPluginIngressMessage(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalMessageId: "old-unverified",
      externalUserId: "user-1",
      messageText: "temporary",
      status: "unverified",
      receivedAt: "2026-05-01T00:00:00.000Z",
    });
    persistPluginIngressMessage(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      externalMessageId: "old-verified",
      externalUserId: "user-1",
      messageText: "redact me",
      status: "verified",
      receivedAt: "2026-03-01T00:00:00.000Z",
    });
    createPluginIngressAuditEvent(database, {
      pluginId: "plugin-a",
      sourceId: "direct",
      decision: "routing_failed",
      externalUserId: "user-1",
      success: false,
      reason: "no_binding",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    cleanupPluginIngressMessages(
      database,
      new Date("2026-05-08T15:00:00.000Z"),
    );

    expect(
      getPluginIngressMessage(database, "plugin-a", "direct", "old-unverified"),
    ).toBeNull();
    expect(
      getPluginIngressMessage(database, "plugin-a", "direct", "old-verified")
        ?.messageText,
    ).toBeNull();
    expect(listPluginIngressAuditEvents(database)).toEqual([]);
  });
});
