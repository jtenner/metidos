/**
 * @file src/mainview/app/calendar-notifications.test.ts
 * @description Notification merge and retention helper coverage.
 */

import { describe, expect, test } from "bun:test";
import type { RpcCalendarReminderDelivery } from "../../bun/calendar/types";
import type { RpcUserNotificationDelivery } from "../../bun/rpc-schema";
import {
  limitCalendarNotifications,
  limitUserNotifications,
  mergeCalendarNotifications,
  mergeUserNotifications,
  NOTIFICATION_STATE_MAX_ITEMS,
} from "./calendar-notifications";

function calendarNotification(
  id: number,
  scheduledAt: string,
): RpcCalendarReminderDelivery {
  return {
    id,
    userId: 1,
    sourceType: "local",
    calendarId: 1,
    eventId: `event-${id}`,
    occurrenceStart: scheduledAt,
    occurrenceTimezone: "UTC",
    reminderId: `reminder-${id}`,
    channel: "in_app",
    scheduledAt,
    status: "delivered",
    deliveredAt: scheduledAt,
    dismissedAt: null,
    readAt: null,
    title: `Calendar ${id}`,
    body: "Body",
    openEventPayloadJson: null,
    retryCount: 0,
    lastError: null,
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
  };
}

function userNotification(
  id: number,
  sentAt: string,
): RpcUserNotificationDelivery {
  return {
    id,
    userId: 1,
    pluginId: null,
    title: `User ${id}`,
    body: "Body",
    clickUrl: null,
    priority: null,
    tagsJson: "[]",
    status: "sent",
    sentAt,
    dismissedAt: null,
    createdAt: sentAt,
    updatedAt: sentAt,
  };
}

function timestampForIndex(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
}

describe("notification retention helpers", () => {
  test("bounds calendar notification state to the latest deliveries", () => {
    const notifications = Array.from(
      { length: NOTIFICATION_STATE_MAX_ITEMS + 10 },
      (_, index) => calendarNotification(index, timestampForIndex(index)),
    );

    const limited = limitCalendarNotifications(notifications);

    expect(limited).toHaveLength(NOTIFICATION_STATE_MAX_ITEMS);
    expect(limited[0]?.id).toBe(NOTIFICATION_STATE_MAX_ITEMS + 9);
    expect(limited.at(-1)?.id).toBe(10);
  });

  test("merges calendar notifications by id before applying the retention limit", () => {
    const current = Array.from(
      { length: NOTIFICATION_STATE_MAX_ITEMS },
      (_, index) => calendarNotification(index, timestampForIndex(index)),
    );
    const incomingReplacement = calendarNotification(0, timestampForIndex(99));
    const incomingNew = calendarNotification(
      NOTIFICATION_STATE_MAX_ITEMS,
      timestampForIndex(NOTIFICATION_STATE_MAX_ITEMS),
    );

    const merged = mergeCalendarNotifications(current, [
      incomingReplacement,
      incomingNew,
    ]);

    expect(merged).toHaveLength(NOTIFICATION_STATE_MAX_ITEMS);
    expect(merged[0]).toBe(incomingReplacement);
    expect(merged.some((notification) => notification.id === 1)).toBeFalse();
  });

  test("bounds user notification state to the latest deliveries", () => {
    const notifications = Array.from(
      { length: NOTIFICATION_STATE_MAX_ITEMS + 10 },
      (_, index) => userNotification(index, timestampForIndex(index)),
    );

    const limited = limitUserNotifications(notifications);

    expect(limited).toHaveLength(NOTIFICATION_STATE_MAX_ITEMS);
    expect(limited[0]?.id).toBe(NOTIFICATION_STATE_MAX_ITEMS + 9);
    expect(limited.at(-1)?.id).toBe(10);
  });

  test("merges user notifications by id before applying the retention limit", () => {
    const current = Array.from(
      { length: NOTIFICATION_STATE_MAX_ITEMS },
      (_, index) => userNotification(index, timestampForIndex(index)),
    );
    const incomingReplacement = userNotification(0, timestampForIndex(99));
    const incomingNew = userNotification(
      NOTIFICATION_STATE_MAX_ITEMS,
      timestampForIndex(NOTIFICATION_STATE_MAX_ITEMS),
    );

    const merged = mergeUserNotifications(current, [
      incomingReplacement,
      incomingNew,
    ]);

    expect(merged).toHaveLength(NOTIFICATION_STATE_MAX_ITEMS);
    expect(merged[0]).toBe(incomingReplacement);
    expect(merged.some((notification) => notification.id === 1)).toBeFalse();
  });
});
