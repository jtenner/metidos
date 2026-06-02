import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { migrateDatabase } from "./db";
import {
  dismissUserNotificationDelivery,
  listUserNotificationDeliveries,
  recordUserNotificationDelivery,
} from "./user-notifications";

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  return database;
}

describe("user notification deliveries", () => {
  it("records delivery metadata and lists the local operator inbox in newest-first order", () => {
    const database = createTestDatabase();
    try {
      const first = recordUserNotificationDelivery(database, {
        body: "First notification body",
        clickUrl: "https://example.test/first",
        pluginId: "example-plugin",
        priority: "high",
        status: "delivered",
        tags: ["deploy", "urgent"],
        title: "First notification",
      });
      const second = recordUserNotificationDelivery(database, {
        body: "Second notification body",
        tags: null,
        title: "Second notification",
      });

      expect(first).toMatchObject({
        body: "First notification body",
        clickUrl: "https://example.test/first",
        pluginId: "example-plugin",
        priority: "high",
        status: "delivered",
        tagsJson: JSON.stringify(["deploy", "urgent"]),
        title: "First notification",
        userId: 1,
      });
      expect(first.sentAt).toEqual(expect.any(String));
      expect(first.dismissedAt).toBeNull();
      expect(second).toMatchObject({
        body: "Second notification body",
        clickUrl: null,
        pluginId: null,
        priority: null,
        status: "sent",
        tagsJson: "[]",
        title: "Second notification",
        userId: 1,
      });

      expect(
        listUserNotificationDeliveries(database).map((delivery) => delivery.id),
      ).toEqual([second.id, first.id]);
    } finally {
      database.close(false);
    }
  });

  it("dismisses notifications from the inbox without deleting delivery history", () => {
    const database = createTestDatabase();
    try {
      const visible = recordUserNotificationDelivery(database, {
        body: "Visible body",
        title: "Visible notification",
      });
      const dismissed = recordUserNotificationDelivery(database, {
        body: "Dismissed body",
        title: "Dismissed notification",
      });

      dismissUserNotificationDelivery(database, 1, dismissed.id);

      expect(
        listUserNotificationDeliveries(database).map((delivery) => delivery.id),
      ).toEqual([visible.id]);
      expect(
        database
          .query<{ dismissedAt: string | null; title: string }, [number]>(
            `SELECT dismissed_at AS dismissedAt, title
             FROM app_notification_deliveries
             WHERE id = ?`,
          )
          .get(dismissed.id),
      ).toEqual({
        dismissedAt: expect.any(String),
        title: "Dismissed notification",
      });
    } finally {
      database.close(false);
    }
  });

  it("treats obsolete user and project scope as local-inbox compatibility only", () => {
    const firstDatabase = createTestDatabase();
    const secondDatabase = createTestDatabase();
    try {
      const firstDelivery = recordUserNotificationDelivery(firstDatabase, {
        body: "First database body",
        title: "First database notification",
      });
      recordUserNotificationDelivery(secondDatabase, {
        body: "Second database body",
        title: "Second database notification",
      });

      expect(listUserNotificationDeliveries(firstDatabase, 999_999)).toEqual([
        expect.objectContaining({
          id: firstDelivery.id,
          title: "First database notification",
          userId: 1,
        }),
      ]);

      expect(() =>
        dismissUserNotificationDelivery(firstDatabase, 999_999, 999_999),
      ).not.toThrow();
      expect(listUserNotificationDeliveries(firstDatabase, 999_999)).toEqual([
        expect.objectContaining({
          id: firstDelivery.id,
          title: "First database notification",
          userId: 1,
        }),
      ]);
    } finally {
      firstDatabase.close(false);
      secondDatabase.close(false);
    }
  });
});
