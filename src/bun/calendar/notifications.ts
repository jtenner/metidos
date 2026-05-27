/**
 * @file src/bun/calendar/notifications.ts
 * @description Hybrid reminder scheduling, delivery state, and cleanup helpers.
 */

import type { Database } from "bun:sqlite";
import {
  ensureNotificationSettings,
  listCalendarNotifications,
  listCalendarOccurrences,
  markDeliveryDelivered,
  MAX_CALENDAR_OCCURRENCES_PER_REQUEST,
  MAX_CALENDAR_REMINDERS_PER_EVENT,
  pruneDismissedCalendarNotifications,
  upsertReminderDelivery,
} from "./store";
import type {
  CalendarNotificationChannel,
  CalendarReminderInput,
  RpcCalendarReminderDelivery,
} from "./types";

const CATCH_UP_WINDOW_MS = 30 * 60 * 1000;
const LOOK_AHEAD_WINDOW_MS = 2 * 60 * 1000;
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_DUE_NOTIFICATION_DELIVERIES_PER_TICK = 1_000;
const LOCAL_CALENDAR_COMPAT_USER_ID = 1;

export type CalendarNotificationListener = (
  userId: number,
  deliveries: RpcCalendarReminderDelivery[],
) => void;
let notificationListener: CalendarNotificationListener | null = null;

export function setCalendarNotificationListener(
  listener: CalendarNotificationListener | null,
): void {
  notificationListener = listener;
}

function parseDateMs(value: string, context: string): number {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(
      `Invalid calendar notification date for ${context}: ${value}`,
    );
  }
  return ms;
}

function allDayReminderBaselineIso(date: string): string {
  return `${date}T08:00:00.000Z`;
}

function occurrenceStartIso(occurrence: {
  allDay: boolean;
  startDate: string | null;
  startAt: string | null;
}): string {
  if (occurrence.allDay) {
    return allDayReminderBaselineIso(
      occurrence.startDate ?? new Date().toISOString().slice(0, 10),
    );
  }
  return occurrence.startAt ?? new Date().toISOString();
}

function deliveryBody(startLabel: string): string {
  return `Starts ${startLabel}`;
}

function channelsForCalendar(
  calendarChannels: readonly CalendarNotificationChannel[],
  settings: ReturnType<typeof ensureNotificationSettings>,
): CalendarNotificationChannel[] {
  const enabled = new Set<CalendarNotificationChannel>();
  for (const channel of calendarChannels) {
    if (channel === "in_app" && settings.inAppEnabled) {
      enabled.add("in_app");
    }
    if (channel === "browser" && settings.browserEnabled) {
      enabled.add("browser");
    }
  }
  if (enabled.size === 0 && settings.inAppEnabled) {
    enabled.add("in_app");
  }
  return [...enabled];
}

function defaultReminders(
  settings: ReturnType<typeof ensureNotificationSettings>,
): CalendarReminderInput[] {
  return settings.defaultReminders.length > 0
    ? settings.defaultReminders
    : [{ minutesBefore: 10 }];
}

export function scheduleDueCalendarReminders(
  database: Database,
  now = new Date(),
): RpcCalendarReminderDelivery[] {
  const nowMs = now.getTime();
  const from = new Date(nowMs - CATCH_UP_WINDOW_MS).toISOString();
  const to = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
  const settings = ensureNotificationSettings(
    database,
    LOCAL_CALENDAR_COMPAT_USER_ID,
  );
  const occurrences = listCalendarOccurrences(
    database,
    LOCAL_CALENDAR_COMPAT_USER_ID,
    from,
    to,
    { maxOccurrences: MAX_CALENDAR_OCCURRENCES_PER_REQUEST },
  );
  const calendarsById = new Map(
    database
      .query<
        {
          id: number;
          notificationsEnabled: 0 | 1 | null;
          channels: string | null;
        },
        []
      >(
        `
          SELECT calendars.id AS id,
            calendar_user_preferences.notifications_enabled AS notificationsEnabled,
            calendar_user_preferences.notification_channels_json AS channels
          FROM calendars
          LEFT JOIN calendar_user_preferences
            ON calendar_user_preferences.calendar_id = calendars.id
        `,
      )
      .all()
      .map((row) => [row.id, row]),
  );
  for (const occurrence of occurrences) {
    let reminders: CalendarReminderInput[];
    if (occurrence.sourceType === "external_ics") {
      const external = database
        .query<
          {
            notificationsEnabled: 0 | 1;
            notificationMode: "source" | "default";
          },
          [number]
        >(
          `SELECT notifications_enabled AS notificationsEnabled, notification_mode AS notificationMode FROM external_ics_calendars WHERE id = ?`,
        )
        .get(occurrence.calendarId);
      if (!external || external.notificationsEnabled !== 1) {
        continue;
      }
      reminders =
        external.notificationMode === "source"
          ? (occurrence.reminders ?? [])
          : defaultReminders(settings);
      if (external.notificationMode === "source" && reminders.length === 0) {
        continue;
      }
    } else {
      const pref = calendarsById.get(occurrence.calendarId);
      if (pref?.notificationsEnabled !== 1) {
        continue;
      }
      reminders = occurrence.reminders ?? defaultReminders(settings);
      if (reminders.length === 0) {
        continue;
      }
    }
    const startIso = occurrenceStartIso(occurrence);
    const startMs = parseDateMs(
      startIso,
      `${occurrence.sourceType} event ${occurrence.eventId}`,
    );
    for (const [index, reminder] of reminders
      .slice(0, MAX_CALENDAR_REMINDERS_PER_EVENT)
      .entries()) {
      const scheduledAt = new Date(startMs - reminder.minutesBefore * 60_000);
      const scheduledMs = scheduledAt.getTime();
      if (
        scheduledMs < nowMs - CATCH_UP_WINDOW_MS ||
        scheduledMs > nowMs + LOOK_AHEAD_WINDOW_MS
      ) {
        continue;
      }
      const pref =
        occurrence.sourceType === "local"
          ? calendarsById.get(occurrence.calendarId)
          : null;
      const parsedChannels = (() => {
        if (occurrence.sourceType === "external_ics") {
          return ["in_app"] as CalendarNotificationChannel[];
        }
        try {
          const parsed = JSON.parse(pref?.channels ?? "[]") as unknown;
          return Array.isArray(parsed)
            ? parsed.filter(
                (item): item is CalendarNotificationChannel =>
                  item === "in_app" || item === "browser" || item === "ntfy",
              )
            : (["in_app"] as CalendarNotificationChannel[]);
        } catch {
          return ["in_app"] as CalendarNotificationChannel[];
        }
      })();
      for (const channel of channelsForCalendar(parsedChannels, settings)) {
        upsertReminderDelivery(database, {
          userId: LOCAL_CALENDAR_COMPAT_USER_ID,
          sourceType: occurrence.sourceType,
          calendarId: occurrence.calendarId,
          eventId: String(occurrence.eventId),
          occurrenceStart: occurrence.originalStart,
          occurrenceTimezone: occurrence.timezone,
          reminderId: String(
            reminder.id ?? `${index}:${reminder.minutesBefore}`,
          ),
          channel,
          scheduledAt: scheduledAt.toISOString(),
          status: "scheduled",
          title: occurrence.title,
          body: deliveryBody(startIso),
          openEventPayloadJson: JSON.stringify({
            occurrenceId: occurrence.occurrenceId,
            date: startIso,
          }),
        });
      }
    }
  }
  return deliverDueInAppAndBrowserNotifications(database, now);
}

export function deliverDueInAppAndBrowserNotifications(
  database: Database,
  now = new Date(),
): RpcCalendarReminderDelivery[] {
  const rows = database
    .query<RpcCalendarReminderDelivery, [string, number]>(
      `
        SELECT id, 1 AS userId, source_type AS sourceType, calendar_id AS calendarId, event_id AS eventId,
          occurrence_start AS occurrenceStart, occurrence_timezone AS occurrenceTimezone, reminder_id AS reminderId,
          channel, scheduled_at AS scheduledAt, status, delivered_at AS deliveredAt, dismissed_at AS dismissedAt,
          read_at AS readAt, title, body, open_event_payload_json AS openEventPayloadJson,
          retry_count AS retryCount, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
        FROM calendar_reminder_deliveries
        WHERE status IN ('scheduled', 'snoozed')
          AND channel IN ('in_app', 'browser')
          AND scheduled_at <= ?
        ORDER BY scheduled_at ASC, id ASC
        LIMIT ?
      `,
    )
    .all(now.toISOString(), MAX_DUE_NOTIFICATION_DELIVERIES_PER_TICK);
  for (const row of rows) {
    markDeliveryDelivered(database, row.id);
  }
  const deliveredRows = rows.map((row) => ({
    ...row,
    status: "delivered" as const,
    deliveredAt: now.toISOString(),
  }));
  if (deliveredRows.length > 0) {
    notificationListener?.(LOCAL_CALENDAR_COMPAT_USER_ID, deliveredRows);
  }
  return deliveredRows;
}

export function runCalendarNotificationCleanup(
  database: Database,
  now = new Date(),
): void {
  pruneDismissedCalendarNotifications(
    database,
    new Date(now.getTime() - CLEANUP_RETENTION_MS).toISOString(),
  );
}

export function listCurrentCalendarNotifications(
  database: Database,
  userId: number,
): RpcCalendarReminderDelivery[] {
  return listCalendarNotifications(database, userId);
}
