/**
 * @file src/bun/user-notifications.ts
 * @description User-facing notification inbox persistence helpers.
 */

import type { Database } from "bun:sqlite";
import type { RpcUserNotificationDelivery } from "./rpc-schema";

const LOCAL_NOTIFICATION_COMPAT_USER_ID = 1;

export function recordUserNotificationDelivery(
  database: Database,
  input: {
    body: string;
    clickUrl?: string | null;
    pluginId?: string | null;
    priority?: string | null;
    status?: RpcUserNotificationDelivery["status"];
    tags?: string[] | null;
    title: string;
  },
): RpcUserNotificationDelivery {
  const tagsJson = JSON.stringify(input.tags ?? []);
  const row = database
    .query<
      { id: number },
      [
        string | null,
        string,
        string,
        string | null,
        string | null,
        string,
        string,
      ]
    >(
      `INSERT INTO app_notification_deliveries(
        plugin_id,
        title,
        body,
        click_url,
        priority,
        tags_json,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id`,
    )
    .get(
      input.pluginId ?? null,
      input.title,
      input.body,
      input.clickUrl ?? null,
      input.priority ?? null,
      tagsJson,
      input.status ?? "sent",
    );
  if (!row) {
    throw new Error("Failed to record user notification delivery.");
  }
  const notification = getUserNotificationDelivery(database, row.id);
  if (!notification) {
    throw new Error("Failed to load recorded user notification delivery.");
  }
  return notification;
}

export function listUserNotificationDeliveries(
  database: Database,
  _userId?: number,
): RpcUserNotificationDelivery[] {
  // Notification delivery rows are intentionally local-operator scoped after
  // the ownerless app-inbox migration. The userId parameter remains on this
  // helper only for RPC shape compatibility; list queries project the singleton
  // compatibility id instead of filtering by a removed per-user column.
  return database
    .query<RpcUserNotificationDelivery, []>(
      `SELECT id, ${LOCAL_NOTIFICATION_COMPAT_USER_ID} AS userId,
        plugin_id AS pluginId, title, body,
        click_url AS clickUrl, priority, tags_json AS tagsJson, status,
        sent_at AS sentAt, dismissed_at AS dismissedAt, created_at AS createdAt,
        updated_at AS updatedAt
      FROM app_notification_deliveries
      WHERE dismissed_at IS NULL
      ORDER BY sent_at DESC, id DESC
      LIMIT 50`,
    )
    .all();
}

export function dismissUserNotificationDelivery(
  database: Database,
  _userId: number,
  deliveryId: number,
): void {
  // Same singleton-inbox rationale as listUserNotificationDeliveries(): this
  // store has no per-user rows, and callers already require an authenticated
  // local operator before invoking dismissal.
  database
    .query<unknown, [number]>(
      `UPDATE app_notification_deliveries
      SET dismissed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    )
    .run(deliveryId);
}

function getUserNotificationDelivery(
  database: Database,
  deliveryId: number,
): RpcUserNotificationDelivery | null {
  return (
    database
      .query<RpcUserNotificationDelivery, [number]>(
        `SELECT id, ${LOCAL_NOTIFICATION_COMPAT_USER_ID} AS userId,
          plugin_id AS pluginId, title, body,
          click_url AS clickUrl, priority, tags_json AS tagsJson, status,
          sent_at AS sentAt, dismissed_at AS dismissedAt, created_at AS createdAt,
          updated_at AS updatedAt
        FROM app_notification_deliveries
        WHERE id = ?`,
      )
      .get(deliveryId) ?? null
  );
}
