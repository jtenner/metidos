/**
 * @file src/mainview/app/calendar-notifications.ts
 * @description Mainview calendar notification helpers.
 */

import type { RpcCalendarReminderDelivery } from "../../bun/calendar/types";
import type { RpcUserNotificationDelivery } from "../../bun/rpc-schema";

export const CALENDAR_NOTIFICATIONS_DUE_EVENT_NAME =
  "metidos:calendar-notifications-due";
export const USER_NOTIFICATION_SENT_EVENT_NAME =
  "metidos:user-notification-sent";
export const NOTIFICATION_STATE_MAX_ITEMS = 50;

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!browserNotificationsSupported()) {
    return "unsupported";
  }
  return Notification.requestPermission();
}

export function showBrowserCalendarNotification(
  delivery: RpcCalendarReminderDelivery,
): void {
  if (
    !browserNotificationsSupported() ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  new Notification(delivery.title, {
    body: delivery.body,
    tag: `calendar:${delivery.id}`,
  });
}

export function limitCalendarNotifications(
  notifications: RpcCalendarReminderDelivery[],
): RpcCalendarReminderDelivery[] {
  return [...notifications]
    .sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt))
    .slice(0, NOTIFICATION_STATE_MAX_ITEMS);
}

export function mergeCalendarNotifications(
  current: RpcCalendarReminderDelivery[],
  incoming: RpcCalendarReminderDelivery[],
): RpcCalendarReminderDelivery[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return limitCalendarNotifications([...byId.values()]);
}

export function limitUserNotifications(
  notifications: RpcUserNotificationDelivery[],
): RpcUserNotificationDelivery[] {
  return [...notifications]
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt))
    .slice(0, NOTIFICATION_STATE_MAX_ITEMS);
}

export function mergeUserNotifications(
  current: RpcUserNotificationDelivery[],
  incoming: RpcUserNotificationDelivery[],
): RpcUserNotificationDelivery[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return limitUserNotifications([...byId.values()]);
}
