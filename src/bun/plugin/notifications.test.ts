/**
 * @file src/bun/plugin/notifications.test.ts
 * @description Tests for Plugin System v1 notification send receipts.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import { migrateDatabase } from "../db";
import {
  assertPluginNotificationSendPermission,
  PLUGIN_NOTIFICATION_DISABLED,
  PLUGIN_NOTIFICATION_NO_ENABLED_OUTLETS,
  PLUGIN_NOTIFICATION_PROVIDER_FAILED,
  PLUGIN_NOTIFICATION_RATE_LIMITED,
  PLUGIN_NOTIFICATION_SEND_PERMISSION,
  resetPluginNotificationRateLimitsForTests,
  sendPluginNotificationThroughUserOutlets,
} from "./notifications";

const openDatabases = new Set<Database>();

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

afterEach(() => {
  resetPluginNotificationRateLimitsForTests();
  for (const database of openDatabases) {
    database.close(false);
  }
  openDatabases.clear();
});

describe("plugin notification sends", () => {
  it("rejects sends without notification:send permission", () => {
    expect(() => assertPluginNotificationSendPermission([])).toThrow(
      "metidos.notifications.send requires notification:send.",
    );
    expect(() =>
      assertPluginNotificationSendPermission([
        "log:write",
        PLUGIN_NOTIFICATION_SEND_PERMISSION,
      ]),
    ).not.toThrow();
  });

  it("returns a failed receipt when plugin notification controls are disabled", async () => {
    const database = createTestDatabase();

    const result = await sendPluginNotificationThroughUserOutlets({
      controls: {
        notificationSettings: {
          enabled: false,
          perDayLimit: 25,
          perMinuteLimit: 3,
        },
      },
      database,
      request: {
        body: "The build finished.",
        context: {
          contextKind: "threadTool",
          ownerUserId: 1,
          sourceThreadId: 123,
        },
        pluginId: "disabled_plugin",
        title: "Build done",
      },
    });

    expect(result).toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_DISABLED,
          deliveryId: null,
          message: "Plugin notifications are disabled for this plugin.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });
  });

  it("returns a failed receipt when the recipient has no enabled outlets", async () => {
    const database = createTestDatabase();

    const result = await sendPluginNotificationThroughUserOutlets({
      database,
      request: {
        body: "The build finished.",
        context: {
          contextKind: "threadTool",
          ownerUserId: 1,
          sourceThreadId: 123,
        },
        pluginId: "alpha_plugin",
        title: "Build done",
      },
    });

    expect(result).toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_NO_ENABLED_OUTLETS,
          deliveryId: null,
          message:
            "No enabled notification outlets are configured for the local operator.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });
  });

  it("dispatches through plugin notification providers when user outlets are disabled", async () => {
    const database = createTestDatabase();
    const providerRequests: unknown[] = [];

    const result = await sendPluginNotificationThroughUserOutlets({
      controls: {
        providerDispatcher: async (input) => {
          providerRequests.push(input.request);
          return [
            {
              channel: "plugin",
              deliveryId: null,
              externalId: "provider-123",
              externalUrl: "https://example.com/messages/provider-123",
              message: "Sent by provider.",
              outlet: "plugin",
              provider: "provider_plugin/alerts",
              status: "delivered",
            },
          ];
        },
      },
      database,
      request: {
        body: "The build finished.",
        context: {
          contextKind: "threadTool",
          ownerUserId: 1,
          sourceThreadId: 123,
        },
        pluginId: "alpha_plugin",
        title: "Build done",
      },
    });

    expect(providerRequests).toHaveLength(1);
    expect(result).toEqual({
      receipts: [
        {
          channel: "plugin",
          deliveryId: null,
          externalId: "provider-123",
          externalUrl: "https://example.com/messages/provider-123",
          message: "Sent by provider.",
          outlet: "plugin",
          provider: "provider_plugin/alerts",
          status: "delivered",
        },
      ],
    });
  });

  it("returns a failed receipt when plugin provider dispatch throws", async () => {
    const database = createTestDatabase();

    const result = await sendPluginNotificationThroughUserOutlets({
      controls: {
        providerDispatcher: async () => {
          throw new Error("Provider bus failed.");
        },
      },
      database,
      request: {
        body: "The build finished.",
        context: {
          contextKind: "threadTool",
          ownerUserId: 1,
          sourceThreadId: 123,
        },
        pluginId: "alpha_plugin",
        title: "Build done",
      },
    });

    expect(result).toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_PROVIDER_FAILED,
          deliveryId: null,
          message: "Provider bus failed.",
          outlet: "plugin",
          provider: "plugin-notification-providers",
          retryable: true,
          status: "failed",
        },
      ],
    });
  });

  it("allows cron notification sends through plugin provider outlets without Plugin Settings", async () => {
    const database = createTestDatabase();
    const providerRequests: unknown[] = [];

    const result = await sendPluginNotificationThroughUserOutlets({
      controls: {
        providerDispatcher: async (input) => {
          providerRequests.push(input.request);
          return [
            {
              channel: "plugin",
              deliveryId: null,
              message: "Sent by provider.",
              outlet: "plugin",
              provider: "provider_plugin/alerts",
              status: "delivered",
            },
          ];
        },
      },
      database,
      request: {
        body: "Cron finished.",
        context: { contextKind: "cron", ownerUserId: null },
        pluginId: "cron_plugin",
        title: "Cron done",
      },
    });

    expect(providerRequests).toEqual([
      {
        body: "Cron finished.",
        context: { contextKind: "cron", ownerUserId: null },
        pluginId: "cron_plugin",
        title: "Cron done",
      },
    ]);
    expect(result).toEqual({
      receipts: [
        {
          channel: "plugin",
          deliveryId: null,
          message: "Sent by provider.",
          outlet: "plugin",
          provider: "provider_plugin/alerts",
          status: "delivered",
        },
      ],
    });
  });

  it("returns failed receipts instead of throwing when cron notification outlets are unavailable", async () => {
    const database = createTestDatabase();

    await expect(
      sendPluginNotificationThroughUserOutlets({
        database,
        request: {
          body: "Cron finished.",
          context: { contextKind: "cron", ownerUserId: null },
          pluginId: "cron_plugin",
          title: "Cron done",
        },
      }),
    ).resolves.toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_NO_ENABLED_OUTLETS,
          deliveryId: null,
          message:
            "No enabled notification outlets are configured for this cron context.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });
  });

  it("rate limits cron notification sends before contacting provider outlets", async () => {
    const database = createTestDatabase();
    const providerRequests: unknown[] = [];
    const warnings: unknown[] = [];
    const send = (index: number) =>
      sendPluginNotificationThroughUserOutlets({
        controls: {
          logSettings: { enabled: true },
          logger: { warning: (description) => warnings.push(description) },
          notificationSettings: {
            enabled: true,
            perDayLimit: 25,
            perMinuteLimit: 1,
          },
          permissions: ["log:write"],
          providerDispatcher: async (input) => {
            providerRequests.push(input.request);
            return [
              {
                channel: "plugin",
                deliveryId: null,
                message: `Sent cron ${index}.`,
                outlet: "plugin",
                provider: "provider_plugin/alerts",
                status: "delivered",
              },
            ];
          },
        },
        database,
        now: new Date("2026-04-28T12:00:00Z"),
        request: {
          body: `Cron ${index} finished.`,
          context: { contextKind: "cron", ownerUserId: null },
          pluginId: "cron_plugin",
          title: `Cron ${index} done`,
        },
      });

    await expect(send(1)).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    await expect(send(2)).resolves.toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_RATE_LIMITED,
          deliveryId: null,
          message: "Plugin notification rate limit exceeded.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });

    expect(providerRequests).toHaveLength(1);
    expect(warnings).toEqual([
      {
        contextKind: "cron",
        pluginId: "cron_plugin",
        reason: PLUGIN_NOTIFICATION_RATE_LIMITED,
        summary: "Plugin notification send was rate limited.",
      },
    ]);
  });

  it("does not share rate limits across plugin ids and ignores untrusted owner ids", async () => {
    const database = createTestDatabase();
    const alice = { id: 1 };
    const bob = { id: 2 };
    let fetchCalls = 0;
    const send = (pluginId: string, recipientUserId: number) =>
      sendPluginNotificationThroughUserOutlets({
        controls: {
          notificationSettings: {
            enabled: true,
            perDayLimit: 25,
            perMinuteLimit: 1,
          },
          providerDispatcher: async () => {
            fetchCalls += 1;
            return [
              {
                channel: "plugin",
                deliveryId: null,
                message: "Sent by provider.",
                outlet: "plugin",
                provider: "provider_plugin/alerts",
                status: "delivered",
              },
            ];
          },
        },
        database,
        now: new Date("2026-04-28T12:00:00Z"),
        request: {
          body: "The build finished.",
          context: {
            contextKind: "threadTool",
            ownerUserId: recipientUserId,
            sourceThreadId: 123,
          },
          pluginId,
          title: "Build done",
        },
      });

    await expect(send("alpha_plugin", alice.id)).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    await expect(send("alpha_plugin", alice.id)).resolves.toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_RATE_LIMITED,
          deliveryId: null,
          message: "Plugin notification rate limit exceeded.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });
    await expect(send("beta_plugin", alice.id)).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    await expect(send("alpha_plugin", bob.id)).resolves.toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_RATE_LIMITED,
          deliveryId: null,
          message: "Plugin notification rate limit exceeded.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });

    expect(fetchCalls).toBe(2);
  });

  it("persists plugin notification rate limits in SQLite", async () => {
    const database = createTestDatabase();
    const send = () =>
      sendPluginNotificationThroughUserOutlets({
        controls: {
          notificationSettings: {
            enabled: true,
            perDayLimit: 25,
            perMinuteLimit: 1,
          },
          providerDispatcher: async () => [
            {
              channel: "plugin",
              deliveryId: null,
              message: "Sent.",
              outlet: "plugin",
              provider: "provider_plugin/alerts",
              status: "delivered",
            },
          ],
        },
        database,
        now: new Date("2026-04-28T12:00:00Z"),
        request: {
          body: "Cron finished.",
          context: { contextKind: "cron", ownerUserId: null },
          pluginId: "persisted_rate_plugin",
          title: "Cron done",
        },
      });

    await expect(send()).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    expect(
      database
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM plugin_notification_rate_limits",
        )
        .get()?.count,
    ).toBe(1);
    await expect(send()).resolves.toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_RATE_LIMITED,
          deliveryId: null,
          message: "Plugin notification rate limit exceeded.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });
  });

  it("rate limits per plugin and recipient before contacting outlets", async () => {
    const database = createTestDatabase();
    let fetchCalls = 0;
    const warnings: unknown[] = [];
    const send = (index: number) =>
      sendPluginNotificationThroughUserOutlets({
        controls: {
          logSettings: { enabled: true },
          logger: { warning: (description) => warnings.push(description) },
          notificationSettings: {
            enabled: true,
            perDayLimit: 25,
            perMinuteLimit: 3,
          },
          permissions: ["log:write"],
          providerDispatcher: async () => {
            fetchCalls += 1;
            return [
              {
                channel: "plugin",
                deliveryId: null,
                message: `Sent build ${index}.`,
                outlet: "plugin",
                provider: "provider_plugin/alerts",
                status: "delivered",
              },
            ];
          },
        },
        database,
        now: new Date("2026-04-28T12:00:00Z"),
        request: {
          body: `Build ${index} finished.`,
          context: {
            contextKind: "threadTool",
            ownerUserId: 1,
            sourceThreadId: 123,
          },
          pluginId: "rate_limited_plugin",
          title: `Build ${index} done`,
        },
      });

    await expect(send(1)).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    await expect(send(2)).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    await expect(send(3)).resolves.toMatchObject({
      receipts: [{ status: "delivered" }],
    });
    await expect(send(4)).resolves.toEqual({
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_RATE_LIMITED,
          deliveryId: null,
          message: "Plugin notification rate limit exceeded.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    });

    expect(fetchCalls).toBe(3);
    expect(warnings).toEqual([
      {
        pluginId: "rate_limited_plugin",
        reason: PLUGIN_NOTIFICATION_RATE_LIMITED,
        recipientUserId: 1,
        summary: "Plugin notification send was rate limited.",
      },
    ]);
  });
});
