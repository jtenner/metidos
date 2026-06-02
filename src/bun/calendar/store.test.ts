/**
 * @file src/bun/calendar/store.test.ts
 * @description Calendar persistence, permissions, reminders, and ICS tests.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeAppDatabase,
  createUser,
  initAppDatabase,
  resetResolvedAppDataDirectory,
} from "../db";
import { exportPublicCalendarIcs } from "./export";
import {
  externalIcsCalendarIsDueForRefresh,
  listDueExternalIcsCalendarRefreshes,
  parseIcsCalendar,
  refreshDueExternalIcsCalendars,
  refreshExternalIcsCalendar,
} from "./ics";
import {
  listCurrentCalendarNotifications,
  scheduleDueCalendarReminders,
} from "./notifications";
import {
  createCalendar,
  createCalendarEvent,
  createExternalCalendar,
  deleteCalendarEvent,
  getCalendarBootstrap,
  initCalendarSchema,
  listCalendarOccurrences,
  replaceExternalCalendarCache,
  updateCalendarEvent,
  updateCalendarNotificationSettings,
  updateCalendarPreference,
  updateExternalCalendar,
} from "./store";

const tempDirs = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "metidos-calendar-"));
  tempDirs.add(dir);
  process.env.METIDOS_APP_DATA_DIR = dir;
  resetResolvedAppDataDirectory();
  return initAppDatabase();
}

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  if (originalAppDataDir) process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  else delete process.env.METIDOS_APP_DATA_DIR;
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs.clear();
});

describe("calendar store", () => {
  test("creates a default Personal calendar for users", () => {
    const db = setupDb();
    const user = createUser(db, { username: "alice", isAdmin: false });
    const bootstrap = getCalendarBootstrap(db, user.id);
    expect(
      bootstrap.calendars.some((calendar) => calendar.title === "Personal"),
    ).toBeTrue();
    expect(bootstrap.calendars[0]?.notificationsEnabled).toBeTrue();
  });

  test("does not create legacy plaintext ntfy secret columns", () => {
    const db = setupDb();
    const columns = db
      .query<{ name: string }, []>(
        `PRAGMA table_info(calendar_notification_settings)`,
      )
      .all()
      .map((column) => column.name);

    expect(columns).not.toContain("ntfy_token");
    expect(columns).not.toContain("ntfy_password");
  });

  test("clears legacy plaintext ntfy secrets on schema initialization", () => {
    const db = setupDb();
    db.query(
      `ALTER TABLE calendar_notification_settings ADD COLUMN ntfy_token TEXT NOT NULL DEFAULT ''`,
    ).run();
    db.query(
      `ALTER TABLE calendar_notification_settings ADD COLUMN ntfy_password TEXT NOT NULL DEFAULT ''`,
    ).run();
    db.query(
      `UPDATE calendar_notification_settings SET ntfy_token = 'token', ntfy_password = 'password'`,
    ).run();

    initCalendarSchema(db);

    const row = db
      .query<{ ntfyToken: string; ntfyPassword: string }, []>(
        `SELECT ntfy_token AS ntfyToken, ntfy_password AS ntfyPassword FROM calendar_notification_settings WHERE id = 1`,
      )
      .get();
    expect(row).toEqual({ ntfyToken: "", ntfyPassword: "" });
  });

  test("preserves visibility preference for the default Personal calendar", () => {
    const db = setupDb();
    const user = createUser(db, { username: "alice", isAdmin: false });
    const personal = getCalendarBootstrap(db, user.id).calendars.find(
      (calendar) => calendar.title === "Personal",
    );

    if (!personal) {
      throw new Error("Expected Personal calendar to be created");
    }
    updateCalendarPreference(db, user.id, personal.id, { visible: false });

    const bootstrap = getCalendarBootstrap(db, user.id);
    expect(
      bootstrap.calendars.find((calendar) => calendar.id === personal.id)
        ?.visible,
    ).toBeFalse();
  });

  test("allocates unique numeric ids across local and external calendars", () => {
    const db = setupDb();
    const user = createUser(db, { username: "ids", isAdmin: false });
    const local = createCalendar(db, user.id, { title: "Local" });
    const external = createExternalCalendar(db, user.id, {
      title: "External",
      url: "https://example.com/calendar.ics",
    });
    const nextLocal = createCalendar(db, user.id, { title: "Next Local" });

    expect(new Set([local.id, external.id, nextLocal.id]).size).toBe(3);
  });

  test("validates external ICS URLs before persistence", () => {
    const db = setupDb();
    const user = createUser(db, { username: "ics-url", isAdmin: false });

    expect(() =>
      createExternalCalendar(db, user.id, {
        title: "Invalid",
        url: "http://%",
      }),
    ).toThrow(/valid http\(s\) URL/);
    expect(() =>
      createExternalCalendar(db, user.id, {
        title: "Credentials",
        url: "https://user:secret@example.com/calendar.ics",
      }),
    ).toThrow(/must not include credentials/);

    const external = createExternalCalendar(db, user.id, {
      title: "External",
      url: " https://example.com/calendar.ics ",
    });
    expect(external.url).toBe("https://example.com/calendar.ics");
    expect(() =>
      updateExternalCalendar(db, user.id, external.id, { url: "notaurl" }),
    ).toThrow(/valid http\(s\) URL/);
  });

  test("allows the local operator to write calendars without shares", () => {
    const db = setupDb();
    const operator = createUser(db, { username: "operator", isAdmin: true });
    const calendar = createCalendar(db, operator.id, { title: "Team" });

    const event = createCalendarEvent(db, operator.id, {
      calendarId: calendar.id,
      title: "Writable",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
    });

    expect(event.createdByUserId).toBe(operator.id);
  });

  test("rejects events with invalid timezones", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Validation" });

    expect(() =>
      createCalendarEvent(db, owner.id, {
        calendarId: calendar.id,
        title: "Bad zone",
        startAt: "2026-06-01T10:00:00.000Z",
        endAt: "2026-06-01T11:00:00.000Z",
        timezone: "Not/AZone",
      }),
    ).toThrow("Calendar timezone is invalid: Not/AZone");
  });

  test("rejects events whose end is not after the start", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Validation" });
    expect(() =>
      createCalendarEvent(db, owner.id, {
        calendarId: calendar.id,
        title: "Backwards",
        startAt: "2026-06-01T11:00:00.000Z",
        endAt: "2026-06-01T10:00:00.000Z",
        timezone: "UTC",
      }),
    ).toThrow("endAt after startAt");
    expect(() =>
      createCalendarEvent(db, owner.id, {
        calendarId: calendar.id,
        title: "Zero all-day",
        allDay: true,
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        timezone: "UTC",
      }),
    ).toThrow("endDate after startDate");
    expect(() =>
      createCalendarEvent(db, owner.id, {
        calendarId: calendar.id,
        title: "Invalid all-day date",
        allDay: true,
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        timezone: "UTC",
      }),
    ).toThrow("startDate must be a real calendar date");
    expect(() =>
      createCalendarEvent(db, owner.id, {
        calendarId: calendar.id,
        title: "Invalid all-day shape",
        allDay: true,
        startDate: "2026-6-1",
        endDate: "2026-06-02",
        timezone: "UTC",
      }),
    ).toThrow("startDate must be a valid YYYY-MM-DD date");
  });

  test("blocks stale optimistic concurrency edits", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Personal work" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Original",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
    });
    updateCalendarEvent(db, owner.id, {
      eventId: event.id,
      title: "New",
      expectedVersion: event.version,
    });
    expect(() =>
      updateCalendarEvent(db, owner.id, {
        eventId: event.id,
        title: "Stale",
        expectedVersion: event.version,
      }),
    ).toThrow("Event changed");
  });

  test("soft-deletes whole events and hides them from calendar selections", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Personal work" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Recoverable",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
    });

    deleteCalendarEvent(db, owner.id, event.id);

    const deletedAt = db
      .query<{ deletedAt: string | null }, [number]>(
        "SELECT deleted_at AS deletedAt FROM calendar_events WHERE id = ?",
      )
      .get(event.id)?.deletedAt;
    expect(deletedAt).toEqual(expect.any(String));
    expect(
      listCalendarOccurrences(
        db,
        owner.id,
        "2026-06-01T00:00:00.000Z",
        "2026-06-02T00:00:00.000Z",
      ),
    ).toEqual([]);
    expect(() =>
      updateCalendarEvent(db, owner.id, {
        eventId: event.id,
        title: "Should stay deleted",
      }),
    ).toThrow("Event not found.");
  });

  test("creates deleted-at indexes for calendars and events", () => {
    const db = setupDb();
    const indexNames = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_calendars_deleted_at', 'idx_calendar_events_deleted_at')",
      )
      .all()
      .map((row) => row.name)
      .sort();

    expect(indexNames).toEqual([
      "idx_calendar_events_deleted_at",
      "idx_calendars_deleted_at",
    ]);
  });

  test("stores recurrence exceptions for just-this deletes", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Recurring" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Standup",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
    });
    deleteCalendarEvent(db, owner.id, event.id, {
      scope: "just_this",
      occurrenceStart: "2026-06-02T10:00:00.000Z",
    });
    const occurrences = listCalendarOccurrences(
      db,
      owner.id,
      "2026-06-01T00:00:00.000Z",
      "2026-06-05T00:00:00.000Z",
    );
    expect(occurrences.map((item) => item.originalStart)).toEqual([
      "2026-06-01T10:00:00.000Z",
      "2026-06-03T10:00:00.000Z",
    ]);
  });

  test("caps recurrence-heavy occurrence listings", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Recurring" });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Every day",
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-01T00:01:00.000Z",
      timezone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=120",
    });

    expect(() =>
      listCalendarOccurrences(
        db,
        owner.id,
        "2026-06-01T00:00:00.000Z",
        "2026-10-02T00:00:00.000Z",
        { maxOccurrences: 100 },
      ),
    ).toThrow("more than 100 occurrences");
  });

  test("preserves custom reminders when updating without reminders", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Reminders" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Custom reminder",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
      reminders: [{ minutesBefore: 30 }],
    });
    const updated = updateCalendarEvent(db, owner.id, {
      eventId: event.id,
      title: "Renamed",
    });
    expect(updated.reminders.map((reminder) => reminder.minutesBefore)).toEqual(
      [30],
    );
  });

  test("renders just-this recurring updates and keeps occurrence time for partial edits", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Recurring" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Base",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
    });
    updateCalendarEvent(db, owner.id, {
      eventId: event.id,
      scope: "just_this",
      occurrenceStart: "2026-06-02T10:00:00.000Z",
      title: "Changed",
    });
    const occurrences = listCalendarOccurrences(
      db,
      owner.id,
      "2026-06-01T00:00:00.000Z",
      "2026-06-05T00:00:00.000Z",
    );
    expect(
      occurrences.map((item) => `${item.originalStart}:${item.title}`),
    ).toEqual([
      "2026-06-01T10:00:00.000Z:Base",
      "2026-06-02T10:00:00.000Z:Changed",
      "2026-06-03T10:00:00.000Z:Base",
    ]);
    expect(occurrences[1]?.startAt).toBe("2026-06-02T10:00:00.000Z");
    expect(occurrences[1]?.endAt).toBe("2026-06-02T11:00:00.000Z");
  });

  test("splits counted recurring updates without changing duration or total count", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Recurring" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Base",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=5",
    });
    updateCalendarEvent(db, owner.id, {
      eventId: event.id,
      scope: "after_this",
      occurrenceStart: "2026-06-03T10:00:00.000Z",
      title: "Changed",
    });
    const occurrences = listCalendarOccurrences(
      db,
      owner.id,
      "2026-06-01T00:00:00.000Z",
      "2026-06-11T00:00:00.000Z",
    );
    expect(occurrences).toHaveLength(5);
    expect(occurrences.map((item) => item.title)).toEqual([
      "Base",
      "Base",
      "Changed",
      "Changed",
      "Changed",
    ]);
    expect(
      occurrences.map(
        (item) =>
          new Date(item.endAt as string).getTime() -
          new Date(item.startAt as string).getTime(),
      ),
    ).toEqual(Array.from({ length: 5 }, () => 60 * 60_000));
  });

  test("rolls back after-this splits when the future event is invalid", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Recurring" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Base",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=5",
    });

    expect(() =>
      updateCalendarEvent(db, owner.id, {
        eventId: event.id,
        occurrenceStart: "2026-06-03T10:00:00.000Z",
        scope: "after_this",
        timezone: "Not/AZone",
      }),
    ).toThrow("Calendar timezone is invalid: Not/AZone");

    const rows = db
      .query<{ recurrenceRule: string | null; title: string }, []>(
        `SELECT recurrence_rule AS recurrenceRule, title FROM calendar_events ORDER BY id ASC`,
      )
      .all();
    expect(rows).toEqual([
      { recurrenceRule: "RRULE:FREQ=DAILY;COUNT=5", title: "Base" },
    ]);
  });

  test("dedupes reminder deliveries by delivery key", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Reminders" });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Soon",
      startAt: "2026-06-01T10:10:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
      reminders: [{ minutesBefore: 10 }],
    });
    scheduleDueCalendarReminders(db, new Date("2026-06-01T10:00:00.000Z"));
    scheduleDueCalendarReminders(db, new Date("2026-06-01T10:00:30.000Z"));
    const count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
      )
      .get()?.count;
    expect(count).toBe(1);
  });

  test("schedules reminders at inclusive catch-up and look-ahead boundaries", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Boundaries" });
    for (const [title, startAt, endAt] of [
      [
        "Before catch-up lower bound",
        "2026-06-01T09:29:59.999Z",
        "2026-06-01T09:35:00.000Z",
      ],
      [
        "At catch-up lower bound",
        "2026-06-01T09:30:00.000Z",
        "2026-06-01T09:35:00.000Z",
      ],
      [
        "At look-ahead upper bound",
        "2026-06-01T10:02:00.000Z",
        "2026-06-01T10:07:00.000Z",
      ],
      [
        "After look-ahead upper bound",
        "2026-06-01T10:02:00.001Z",
        "2026-06-01T10:07:00.001Z",
      ],
    ] as const) {
      createCalendarEvent(db, owner.id, {
        calendarId: calendar.id,
        title,
        startAt,
        endAt,
        timezone: "UTC",
        reminders: [{ minutesBefore: 0 }],
      });
    }

    scheduleDueCalendarReminders(db, new Date("2026-06-01T10:00:00.000Z"));

    const rows = db
      .query<{ title: string; status: string; scheduledAt: string }, []>(
        `SELECT title, status, scheduled_at AS scheduledAt FROM calendar_reminder_deliveries ORDER BY scheduled_at ASC`,
      )
      .all();
    expect(rows).toEqual([
      {
        title: "At catch-up lower bound",
        status: "delivered",
        scheduledAt: "2026-06-01T09:30:00.000Z",
      },
      {
        title: "At look-ahead upper bound",
        status: "scheduled",
        scheduledAt: "2026-06-01T10:02:00.000Z",
      },
    ]);
  });

  test("skips reminder deliveries when calendar notifications are disabled", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Muted" });
    updateCalendarPreference(db, owner.id, calendar.id, {
      notificationsEnabled: false,
    });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Muted reminder",
      startAt: "2026-06-01T10:10:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
      reminders: [{ minutesBefore: 10 }],
    });

    const delivered = scheduleDueCalendarReminders(
      db,
      new Date("2026-06-01T10:00:00.000Z"),
    );

    expect(delivered).toEqual([]);
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(0);
  });

  test("honors globally disabled in-app and browser notification outlets", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    updateCalendarNotificationSettings(db, owner.id, {
      inAppEnabled: false,
      browserEnabled: false,
    });
    const calendar = createCalendar(db, owner.id, { title: "Muted outlets" });
    updateCalendarPreference(db, owner.id, calendar.id, {
      notificationChannels: ["in_app", "browser"],
      notificationsEnabled: true,
    });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Outlet-muted reminder",
      startAt: "2026-06-01T10:10:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
      reminders: [{ minutesBefore: 10 }],
    });

    const delivered = scheduleDueCalendarReminders(
      db,
      new Date("2026-06-01T10:00:00.000Z"),
    );

    expect(delivered).toEqual([]);
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(0);
  });

  test("listing current notifications does not schedule reminders", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Reminders" });
    const startAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const endAt = new Date(Date.now() + 30 * 60_000).toISOString();
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Soon",
      startAt,
      endAt,
      timezone: "UTC",
      reminders: [{ minutesBefore: 10 }],
    });

    expect(listCurrentCalendarNotifications(db, owner.id)).toEqual([]);
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(0);
  });

  test("uses local event reminders instead of user defaults", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    updateCalendarNotificationSettings(db, owner.id, {
      defaultReminders: [{ minutesBefore: 10 }],
    });
    const calendar = createCalendar(db, owner.id, { title: "Reminders" });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Custom alarm",
      startAt: "2026-06-01T10:30:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
      reminders: [{ minutesBefore: 20 }],
    });

    scheduleDueCalendarReminders(db, new Date("2026-06-01T10:10:00.000Z"));
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(1);

    scheduleDueCalendarReminders(db, new Date("2026-06-01T10:20:00.000Z"));
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(1);
  });

  test("clears stale scheduled reminders when an event is moved", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, { title: "Reminders" });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Move me",
      startAt: "2026-06-01T10:10:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
      reminders: [{ minutesBefore: 10 }],
    });
    scheduleDueCalendarReminders(db, new Date("2026-06-01T10:00:00.000Z"));
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(1);

    updateCalendarEvent(db, owner.id, {
      eventId: event.id,
      expectedVersion: event.version,
      startAt: "2026-06-01T11:10:00.000Z",
      endAt: "2026-06-01T11:30:00.000Z",
    });
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(0);

    scheduleDueCalendarReminders(db, new Date("2026-06-01T11:00:00.000Z"));
    expect(
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
        )
        .get()?.count,
    ).toBe(1);
  });

  test("exports public ICS with stored event timezones and excludes private calendars", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, {
      title: "Published",
      isPublic: true,
      publicSlug: "published",
    });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Exported",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      timezone: "UTC",
    });
    createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "New York standup",
      startAt: "2026-06-01T14:00:00.000Z",
      endAt: "2026-06-01T14:30:00.000Z",
      timezone: "America/New_York",
      recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=2",
    });
    const ics = exportPublicCalendarIcs(db, "published");
    expect(ics).toContain("SUMMARY:Exported");
    expect(ics).toContain("DTSTART:20260601T100000Z");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20260601T100000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260601T103000");
    const privateCalendar = createCalendar(db, owner.id, {
      title: "Private",
      publicSlug: "private-cal",
    });
    expect(privateCalendar.isPublic).toBeFalse();
    expect(exportPublicCalendarIcs(db, "private-cal")).toBeNull();
  });

  test("skips invalid all-day export dates cleanly", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const calendar = createCalendar(db, owner.id, {
      title: "Published",
      isPublic: true,
      publicSlug: "published",
    });
    const event = createCalendarEvent(db, owner.id, {
      calendarId: calendar.id,
      title: "Bad all-day",
      allDay: true,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      timezone: "UTC",
    });
    db.query(`UPDATE calendar_events SET start_date = ? WHERE id = ?`).run(
      "2026-6-1",
      event.id,
    );
    const ics = exportPublicCalendarIcs(db, "published");
    expect(ics).not.toContain("SUMMARY:Bad all-day");
    expect(ics).toContain("BEGIN:VCALENDAR");
  });

  test("merges external ICS recurrence-id overrides", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://example.test/calendar.ics",
    });
    replaceExternalCalendarCache(db, external.id, [
      {
        uid: "one",
        title: "Base",
        startAt: "2026-06-01T10:00:00.000Z",
        endAt: "2026-06-01T11:00:00.000Z",
        timezone: "UTC",
        recurrenceRule: "RRULE:FREQ=DAILY;COUNT=2",
      },
      {
        uid: "one",
        recurrenceId: "2026-06-02T10:00:00.000Z",
        title: "Changed",
        startAt: "2026-06-02T12:00:00.000Z",
        endAt: "2026-06-02T13:00:00.000Z",
        timezone: "UTC",
      },
    ]);
    const occurrences = listCalendarOccurrences(
      db,
      owner.id,
      "2026-06-01T00:00:00.000Z",
      "2026-06-03T00:00:00.000Z",
    );
    expect(occurrences.map((item) => `${item.title}:${item.startAt}`)).toEqual([
      "Base:2026-06-01T10:00:00.000Z",
      "Changed:2026-06-02T12:00:00.000Z",
    ]);
  });

  test("updates external ICS refresh interval", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://example.test/calendar.ics",
    });
    expect(external.refreshIntervalMinutes).toBe(240);
    const updated = updateExternalCalendar(db, owner.id, external.id, {
      refreshIntervalMinutes: 360,
    });
    expect(updated.refreshIntervalMinutes).toBe(360);
  });

  test("evaluates external ICS refresh due times with UTC elapsed-time semantics", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const baseCalendar = {
      id: 1,
      consecutiveFailures: 0,
      lastErrorAt: null,
      refreshIntervalMinutes: 60,
    };

    expect(
      externalIcsCalendarIsDueForRefresh(
        { ...baseCalendar, lastFetchedAt: "2026-06-01T11:00:00.000Z" },
        now,
      ),
    ).toBeTrue();
    expect(
      externalIcsCalendarIsDueForRefresh(
        { ...baseCalendar, lastFetchedAt: "2026-06-01T11:00:01.000Z" },
        now,
      ),
    ).toBeFalse();
    expect(
      externalIcsCalendarIsDueForRefresh(
        { ...baseCalendar, lastFetchedAt: "2026-06-01T13:00:00.000Z" },
        now,
      ),
    ).toBeFalse();
    expect(
      externalIcsCalendarIsDueForRefresh(
        {
          ...baseCalendar,
          consecutiveFailures: 2,
          lastErrorAt: "2026-06-01T10:59:59.500Z",
          lastFetchedAt: "2026-06-01T07:00:00.000Z",
        },
        now,
      ),
    ).toBeTrue();
    expect(
      externalIcsCalendarIsDueForRefresh(
        {
          ...baseCalendar,
          consecutiveFailures: 2,
          lastErrorAt: "2026-06-01T11:00:00.500Z",
          lastFetchedAt: "2026-06-01T07:00:00.000Z",
        },
        now,
      ),
    ).toBeFalse();
  });

  test("finds due external ICS calendars using the 4 hour default and failure backoff", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const neverFetched = createExternalCalendar(db, owner.id, {
      title: "Never fetched",
      url: "https://203.0.113.10/never.ics",
    });
    const recent = createExternalCalendar(db, owner.id, {
      title: "Recent",
      url: "https://203.0.113.10/recent.ics",
    });
    const old = createExternalCalendar(db, owner.id, {
      title: "Old",
      url: "https://203.0.113.10/old.ics",
    });
    const failedRecently = createExternalCalendar(db, owner.id, {
      title: "Failed recently",
      url: "https://203.0.113.10/failed-recently.ics",
    });
    const failedDue = createExternalCalendar(db, owner.id, {
      title: "Failed due",
      url: "https://203.0.113.10/failed-due.ics",
    });
    const disabled = createExternalCalendar(db, owner.id, {
      title: "Disabled",
      url: "https://203.0.113.10/disabled.ics",
    });
    db.query(
      `UPDATE external_ics_calendars SET last_fetched_at = ? WHERE id = ?`,
    ).run("2026-06-01T11:00:00.000Z", recent.id);
    db.query(
      `UPDATE external_ics_calendars SET last_fetched_at = ? WHERE id = ?`,
    ).run("2026-06-01T07:59:00.000Z", old.id);
    db.query(
      `UPDATE external_ics_calendars SET last_fetched_at = ?, last_error_at = ?, consecutive_failures = 1 WHERE id = ?`,
    ).run(
      "2026-06-01T11:50:00.000Z",
      "2026-06-01T11:50:00.000Z",
      failedRecently.id,
    );
    db.query(
      `UPDATE external_ics_calendars SET last_fetched_at = ?, last_error_at = ?, consecutive_failures = 1 WHERE id = ?`,
    ).run("2026-06-01T11:44:00.000Z", "2026-06-01T11:44:00.000Z", failedDue.id);
    db.query(`UPDATE external_ics_calendars SET enabled = 0 WHERE id = ?`).run(
      disabled.id,
    );

    const dueIds = listDueExternalIcsCalendarRefreshes(
      db,
      new Date("2026-06-01T12:00:00.000Z"),
    )
      .map((calendar) => calendar.id)
      .sort((left, right) => left - right);

    expect(dueIds).toEqual(
      [neverFetched.id, old.id, failedDue.id].sort(
        (left, right) => left - right,
      ),
    );
  });

  test("refreshes due external ICS calendars", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const due = createExternalCalendar(db, owner.id, {
      title: "Due",
      url: "https://203.0.113.10/due.ics",
    });
    const recent = createExternalCalendar(db, owner.id, {
      title: "Recent",
      url: "https://203.0.113.10/recent.ics",
    });
    db.query(
      `UPDATE external_ics_calendars SET last_fetched_at = ? WHERE id = ?`,
    ).run("2026-06-01T11:00:00.000Z", recent.id);
    const fetchedUrls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      fetchedUrls.push(String(url));
      return new Response(
        `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:one\nSUMMARY:Auto refreshed\nDTSTART:20260601T100000Z\nDTEND:20260601T110000Z\nEND:VEVENT\nEND:VCALENDAR`,
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(
      refreshDueExternalIcsCalendars(db, {
        fetchImpl,
        now: new Date("2026-06-01T12:00:00.000Z"),
      }),
    ).resolves.toEqual([
      {
        calendarId: due.id,
        ownerUserId: owner.id,
        ok: true,
        refreshed: true,
        eventCount: 1,
        status: 200,
        error: null,
      },
    ]);
    expect(fetchedUrls).toEqual(["https://203.0.113.10/due.ics"]);
    expect(
      listCalendarOccurrences(
        db,
        owner.id,
        "2026-06-01T00:00:00.000Z",
        "2026-06-02T00:00:00.000Z",
      ).map((occurrence) => occurrence.title),
    ).toEqual(["Auto refreshed"]);
  });

  test("uses source alarms for external ICS source notifications", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://example.test/calendar.ics",
    });
    updateExternalCalendar(db, owner.id, external.id, {
      notificationsEnabled: true,
      notificationMode: "source",
    });
    replaceExternalCalendarCache(db, external.id, [
      {
        uid: "one",
        title: "Alarmed",
        startAt: "2026-06-01T10:00:00.000Z",
        endAt: "2026-06-01T11:00:00.000Z",
        timezone: "UTC",
        reminders: [{ minutesBefore: 20 }],
      },
    ]);
    scheduleDueCalendarReminders(db, new Date("2026-06-01T09:40:00.000Z"));
    const count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
      )
      .get()?.count;
    expect(count).toBe(1);
  });

  test("does not use defaults for external ICS source mode without source alarms", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    updateCalendarNotificationSettings(db, owner.id, {
      defaultReminders: [{ minutesBefore: 10 }],
    });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://example.test/calendar.ics",
    });
    updateExternalCalendar(db, owner.id, external.id, {
      notificationsEnabled: true,
      notificationMode: "source",
    });
    replaceExternalCalendarCache(db, external.id, [
      {
        uid: "one",
        title: "No alarm",
        startAt: "2026-06-01T10:00:00.000Z",
        endAt: "2026-06-01T11:00:00.000Z",
        timezone: "UTC",
      },
    ]);
    scheduleDueCalendarReminders(db, new Date("2026-06-01T09:50:00.000Z"));
    const count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
      )
      .get()?.count;
    expect(count).toBe(0);
  });

  test("uses default reminders for external ICS default notification mode", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    updateCalendarNotificationSettings(db, owner.id, {
      defaultReminders: [{ minutesBefore: 10 }],
    });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://example.test/calendar.ics",
    });
    updateExternalCalendar(db, owner.id, external.id, {
      notificationsEnabled: true,
      notificationMode: "default",
    });
    replaceExternalCalendarCache(db, external.id, [
      {
        uid: "one",
        title: "Default alarm",
        startAt: "2026-06-01T10:00:00.000Z",
        endAt: "2026-06-01T11:00:00.000Z",
        timezone: "UTC",
        reminders: [{ minutesBefore: 20 }],
      },
    ]);
    scheduleDueCalendarReminders(db, new Date("2026-06-01T09:40:00.000Z"));
    let count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
      )
      .get()?.count;
    expect(count).toBe(0);
    scheduleDueCalendarReminders(db, new Date("2026-06-01T09:50:00.000Z"));
    count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM calendar_reminder_deliveries",
      )
      .get()?.count;
    expect(count).toBe(1);
  });

  test("rejects unsafe external ICS refresh URLs before fetch", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const blockedUrls = [
      "file:///etc/passwd",
      "http://localhost/calendar.ics",
      "http://127.0.0.1/calendar.ics",
      "http://10.0.0.1/calendar.ics",
      "http://172.16.0.1/calendar.ics",
      "http://192.168.1.1/calendar.ics",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/calendar.ics",
      "http://[fe80::1]/calendar.ics",
      "http://[fd00::1]/calendar.ics",
    ];
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;

    for (const url of blockedUrls) {
      const external = createExternalCalendar(db, owner.id, {
        title: "ICS",
        url: "https://203.0.113.10/calendar.ics",
      });
      db.query(`UPDATE external_ics_calendars SET url = ? WHERE id = ?`).run(
        url,
        external.id,
      );
      await expect(
        refreshExternalIcsCalendar(db, external.id, fetchImpl),
      ).rejects.toThrow(/External ICS URL/);
    }

    expect(fetchCalls).toBe(0);
  });

  test("rejects external ICS hostnames that resolve to blocked addresses", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://calendar.example.test/feed.ics",
    });
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl, {
        resolveHostname: async () => ["127.0.0.1"],
      }),
    ).rejects.toThrow(/External ICS URL/);

    expect(fetchCalls).toBe(0);
  });

  test("rejects Google Calendar web URLs with iCal guidance", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "Google",
      url: "https://calendar.google.com/calendar/u/0?cid=dGVzdEBleGFtcGxlLmNvbQ",
    });
    const fetchImpl = (async () =>
      new Response("<html><title>Sign in</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl),
    ).rejects.toThrow(/Google Calendar web pages cannot be imported directly/);
  });

  test("rejects non-ICS refresh responses with a helpful message", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://203.0.113.10/calendar",
    });
    const fetchImpl = (async () =>
      new Response("<html><title>Calendar</title></html>", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl),
    ).rejects.toThrow(/did not return an iCalendar feed/);
  });

  test("rejects unsupported external ICS response content types before parsing", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://203.0.113.10/calendar.ics",
    });
    const fetchImpl = (async () =>
      new Response('{"calendar":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl),
    ).rejects.toThrow(/unsupported content type application\/json/);
  });

  test("rejects oversized external ICS refresh responses before buffering", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://203.0.113.10/calendar.ics",
    });
    const fetchImpl = (async () =>
      new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", {
        status: 200,
        headers: { "content-length": String(6 * 1024 * 1024) },
      })) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl),
    ).rejects.toThrow(/External ICS response is too large/);
  });

  test("times out external ICS refreshes through the request abort signal", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://203.0.113.10/calendar.ics",
    });
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      })) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl, { timeoutMs: 1 }),
    ).rejects.toThrow(/timed out after 1ms/);
  });

  test("allows public http external ICS refresh URLs", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://203.0.113.10/calendar.ics",
    });
    const fetchImpl = (async () =>
      new Response(
        `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:one\nSUMMARY:Imported\nDTSTART:20260601T100000Z\nDTEND:20260601T110000Z\nEND:VEVENT\nEND:VCALENDAR`,
        { status: 200 },
      )) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl),
    ).resolves.toEqual({ refreshed: true, eventCount: 1, status: 200 });
  });

  test("cancels external ICS redirect bodies before following", async () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://203.0.113.10/start.ics",
    });
    let redirectBodyCanceled = false;
    const redirectBody = new ReadableStream({
      cancel() {
        redirectBodyCanceled = true;
      },
    });
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://203.0.113.10/start.ics") {
        return new Response(redirectBody, {
          headers: { location: "https://203.0.113.11/final.ics" },
          status: 302,
        });
      }
      return new Response(
        `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:one\nSUMMARY:Imported\nDTSTART:20260601T100000Z\nDTEND:20260601T110000Z\nEND:VEVENT\nEND:VCALENDAR`,
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(
      refreshExternalIcsCalendar(db, external.id, fetchImpl),
    ).resolves.toEqual({ refreshed: true, eventCount: 1, status: 200 });
    expect(redirectBodyCanceled).toBeTrue();
  });

  test("rejects non-calendar text before invoking ical.js internals", () => {
    expect(() => parseIcsCalendar("<html></html>")).toThrow(
      /not an iCalendar VCALENDAR feed/,
    );
  });

  test("rejects external ICS feeds with too many events", () => {
    const text = `BEGIN:VCALENDAR\nVERSION:2.0\n${Array.from(
      { length: 3 },
      (_unused, index) =>
        `BEGIN:VEVENT\nUID:${index}\nSUMMARY:Event ${index}\nDTSTART:2026060${index + 1}T100000Z\nEND:VEVENT`,
    ).join("\n")}\nEND:VCALENDAR`;

    expect(() => parseIcsCalendar(text, { maxEvents: 2 })).toThrow(
      /more than 2 events/,
    );
  });

  test("drops oversized external ICS raw event JSON", () => {
    const [event] = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:large\nSUMMARY:Large raw event\nDESCRIPTION:${"x".repeat(70 * 1024)}\nDTSTART:20260601T100000Z\nEND:VEVENT\nEND:VCALENDAR`,
    );

    expect(event?.rawJson).toBeNull();
  });

  test("parses external ICS events and source alarms", () => {
    const events = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:one\nSUMMARY:Imported\nDTSTART:20260601T100000Z\nDTEND:20260601T110000Z\nRRULE:FREQ=DAILY;COUNT=2\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT10M\nEND:VALARM\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:PT0S\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Imported");
    expect(events[0]?.recurrenceRule).toBe("RRULE:FREQ=DAILY;COUNT=2");
    expect(
      events[0]?.reminders.map((reminder) => reminder.minutesBefore),
    ).toEqual([10, 0]);
  });

  test("parses external ICS all-day date events", () => {
    const events = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:all-day\nSUMMARY:All day imported\nDTSTART;VALUE=DATE:20260601\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "all-day",
      title: "All day imported",
      startAt: null,
      endAt: null,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      allDay: true,
    });
  });

  test("parses Cozi bare date all-day events without VALUE=DATE", () => {
    const events = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:cozi-all-day\nSUMMARY:All: Book fair\nDTSTART:20260427\nDTEND:20260502\nDTSTAMP:20260425T174745Z\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "cozi-all-day",
      title: "All: Book fair",
      startAt: null,
      endAt: null,
      startDate: "2026-04-27",
      endDate: "2026-05-02",
      allDay: true,
    });
  });

  test("lists imported ICS all-day events in occurrence windows", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "ICS",
      url: "https://example.test/calendar.ics",
    });
    const [event] = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:all-day\nSUMMARY:All day imported\nDTSTART;VALUE=DATE:20260601\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(event).toBeDefined();
    if (!event) {
      throw new Error("Expected all-day fixture to parse.");
    }
    replaceExternalCalendarCache(db, external.id, [event]);

    const occurrences = listCalendarOccurrences(
      db,
      owner.id,
      "2026-06-01T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      sourceType: "external_ics",
      eventId: "all-day",
      title: "All day imported",
      allDay: true,
      startAt: null,
      endAt: null,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });
  });

  test("lists Cozi bare date all-day events in occurrence windows", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const external = createExternalCalendar(db, owner.id, {
      title: "Cozi",
      url: "https://example.test/cozi.ics",
    });
    const [event] = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:cozi-book-fair\nSUMMARY:All: Book fair\nDTSTART:20260427\nDTEND:20260502\nDTSTAMP:20260425T174745Z\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(event).toBeDefined();
    if (!event) {
      throw new Error("Expected Cozi fixture to parse.");
    }
    replaceExternalCalendarCache(db, external.id, [event]);

    const occurrences = listCalendarOccurrences(
      db,
      owner.id,
      "2026-04-27T00:00:00.000Z",
      "2026-04-28T00:00:00.000Z",
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      sourceType: "external_ics",
      eventId: "cozi-book-fair",
      title: "All: Book fair",
      allDay: true,
      startDate: "2026-04-27",
      endDate: "2026-05-02",
    });
  });

  test("derives stable UIDs for UID-less recurring events and overrides", () => {
    const text = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:No UID\nDTSTART:20260601T100000Z\nDTEND:20260601T110000Z\nRRULE:FREQ=DAILY;COUNT=2\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:No UID\nRECURRENCE-ID:20260602T100000Z\nDTSTART:20260602T120000Z\nDTEND:20260602T130000Z\nEND:VEVENT\nEND:VCALENDAR`;
    const first = parseIcsCalendar(text);
    const second = parseIcsCalendar(text);
    expect(first).toHaveLength(2);
    expect(first[0]?.uid).toMatch(/^uidless-/);
    expect(first[0]?.uid).toBe(first[1]?.uid);
    expect(second.map((event) => event.uid)).toEqual(
      first.map((event) => event.uid),
    );
  });

  test("uses embedded VTIMEZONE definitions for custom TZID events", () => {
    const events = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VTIMEZONE\nTZID:Custom/Fixed\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0400\nTZNAME:CUST\nEND:STANDARD\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:custom-zone\nSUMMARY:Custom zone\nDTSTART;TZID=Custom/Fixed:20260601T100000\nDTEND;TZID=Custom/Fixed:20260601T110000\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.timezone).toBe("Custom/Fixed");
    expect(events[0]?.startAt).toBe("2026-06-01T14:00:00.000Z");
    expect(events[0]?.endAt).toBe("2026-06-01T15:00:00.000Z");
  });

  test("skips malformed external ICS events without dropping valid events", () => {
    const events = parseIcsCalendar(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:bad\nSUMMARY:Bad\nDTSTART:19040119T\nEND:VEVENT\nBEGIN:VEVENT\nUID:good\nSUMMARY:Good\nDTSTART:20260601T100000Z\nDTEND:20260601T110000Z\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(events.map((event) => event.uid)).toEqual(["good"]);
    expect(events[0]?.startAt).toBe("2026-06-01T10:00:00.000Z");
  });
});
