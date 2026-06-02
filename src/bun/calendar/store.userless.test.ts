/**
 * @file src/bun/calendar/store.userless.test.ts
 * @description Focused regression coverage for the single-operator calendar persistence model.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeAppDatabase,
  initAppDatabase,
  resetResolvedAppDataDirectory,
} from "../db";
import { listDueExternalIcsCalendarRefreshes } from "./ics";
import {
  listCurrentCalendarNotifications,
  scheduleDueCalendarReminders,
} from "./notifications";
import {
  createCalendar,
  createCalendarEvent,
  createExternalCalendar,
  getCalendarBootstrap,
  initCalendarSchema,
  listCalendarOccurrences,
  replaceExternalCalendarCache,
  updateCalendarNotificationSettings,
  updateCalendarPreference,
} from "./store";

const tempDirs = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const LOCAL_USER_ID = 1;

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "metidos-calendar-userless-"));
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

function tableColumns(db: ReturnType<typeof initAppDatabase>, table: string) {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
}

function foreignKeyTargets(db: Database, table: string): string[] {
  return db
    .query<{ table: string }, []>(`PRAGMA foreign_key_list(${table})`)
    .all()
    .map((foreignKey) => foreignKey.table);
}

function foreignKeyCheck(db: Database): Record<string, unknown>[] {
  return db
    .query<Record<string, unknown>, []>(`PRAGMA foreign_key_check`)
    .all();
}

function tableCreateSql(db: Database, table: string): string {
  const row = db
    .query<{ sql: string | null }, [string]>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(table);
  if (!row?.sql) {
    throw new Error(`Missing create SQL for ${table}`);
  }
  return row.sql;
}

function setupMemoryCalendarDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initCalendarSchema(db);
  return db;
}

function seedForeignKeySensitiveCalendarRows(db: Database) {
  const calendar = createCalendar(db, LOCAL_USER_ID, { title: "Ops" });
  const event = createCalendarEvent(db, LOCAL_USER_ID, {
    calendarId: calendar.id,
    title: "Reminder migration check",
    startAt: "2026-06-01T10:00:00.000Z",
    endAt: "2026-06-01T10:30:00.000Z",
    timezone: "UTC",
    reminders: [{ minutesBefore: 5 }],
  });
  const external = createExternalCalendar(db, LOCAL_USER_ID, {
    title: "Feed",
    url: "https://example.com/calendar.ics",
  });
  replaceExternalCalendarCache(db, external.id, [
    {
      uid: "external-before-migration",
      title: "External before migration",
      startAt: "2026-06-01T12:00:00.000Z",
      endAt: "2026-06-01T13:00:00.000Z",
      timezone: "UTC",
    },
  ]);
  return { calendar, event, external };
}

function corruptCalendarForeignKeysAsPreviousMigrationDid(db: Database): void {
  const calendarEventsSql = tableCreateSql(db, "calendar_events");
  const calendarEventExdatesSql = tableCreateSql(db, "calendar_event_exdates");
  const calendarEventOverridesSql = tableCreateSql(
    db,
    "calendar_event_overrides",
  );
  const externalCalendarsSql = tableCreateSql(db, "external_ics_calendars");

  db.run("PRAGMA foreign_keys = OFF");
  db.run("BEGIN IMMEDIATE");
  try {
    db.run("ALTER TABLE calendar_events RENAME TO calendar_events_legacy");
    db.run(calendarEventsSql);
    db.run("INSERT INTO calendar_events SELECT * FROM calendar_events_legacy");
    db.run(
      "ALTER TABLE calendar_event_exdates RENAME TO calendar_event_exdates_legacy",
    );
    db.run(calendarEventExdatesSql);
    db.run(
      "INSERT INTO calendar_event_exdates SELECT * FROM calendar_event_exdates_legacy",
    );
    db.run("DROP TABLE calendar_event_exdates_legacy");
    db.run(
      "ALTER TABLE calendar_event_overrides RENAME TO calendar_event_overrides_legacy",
    );
    db.run(calendarEventOverridesSql);
    db.run(
      "INSERT INTO calendar_event_overrides SELECT * FROM calendar_event_overrides_legacy",
    );
    db.run("DROP TABLE calendar_event_overrides_legacy");
    db.run("DROP TABLE calendar_events_legacy");

    db.run(
      "ALTER TABLE external_ics_calendars RENAME TO external_ics_calendars_legacy",
    );
    db.run(externalCalendarsSql);
    db.run(
      "INSERT INTO external_ics_calendars SELECT * FROM external_ics_calendars_legacy",
    );
    db.run("DROP TABLE external_ics_calendars_legacy");
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

describe("userless calendar store", () => {
  test("fresh schema removes user-owned calendar columns and tables", () => {
    const db = setupDb();

    expect(
      db
        .query<{ name: string }, []>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calendar_shares'`,
        )
        .get(),
    ).toBeNull();
    expect(tableColumns(db, "calendars")).not.toContain("owner_user_id");
    expect(tableColumns(db, "calendar_user_preferences")).not.toContain(
      "user_id",
    );
    expect(tableColumns(db, "calendar_events")).not.toContain(
      "created_by_user_id",
    );
    expect(tableColumns(db, "external_ics_calendars")).not.toContain(
      "owner_user_id",
    );
    expect(tableColumns(db, "calendar_notification_settings")).not.toContain(
      "user_id",
    );
    expect(tableColumns(db, "calendar_reminder_deliveries")).not.toContain(
      "user_id",
    );
  });

  test("bootstrap creates a personal calendar with singleton settings and no users/shares", () => {
    const db = setupDb();
    const bootstrap = getCalendarBootstrap(db, LOCAL_USER_ID);

    expect(
      bootstrap.calendars.some((calendar) => calendar.title === "Personal"),
    ).toBeTrue();
    expect(bootstrap.users).toEqual([]);
    expect(bootstrap.shares).toEqual([]);
    expect(bootstrap.notificationSettings.userId).toBe(LOCAL_USER_ID);
  });

  test("local calendars and occurrences work without user rows", () => {
    const db = setupDb();
    const calendar = createCalendar(db, LOCAL_USER_ID, { title: "Ops" });
    updateCalendarPreference(db, LOCAL_USER_ID, calendar.id, {
      visible: true,
      notificationsEnabled: true,
    });
    createCalendarEvent(db, LOCAL_USER_ID, {
      calendarId: calendar.id,
      title: "Standup",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
      recurrenceRule: "RRULE:FREQ=DAILY;COUNT=2",
    });

    const occurrences = listCalendarOccurrences(
      db,
      LOCAL_USER_ID,
      "2026-06-01T00:00:00.000Z",
      "2026-06-03T00:00:00.000Z",
    );

    expect(occurrences.map((item) => item.title)).toEqual([
      "Standup",
      "Standup",
    ]);
    expect(occurrences[0]?.createdByUserId).toBe(LOCAL_USER_ID);
    expect(occurrences[0]?.createdByUsername).toBe("Local Operator");
  });

  test("local event reminders schedule and list without user rows", () => {
    const db = setupDb();
    expect(
      db
        .query<{ name: string }, []>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
        )
        .get(),
    ).toBeNull();
    updateCalendarNotificationSettings(db, LOCAL_USER_ID, {
      defaultReminders: [{ minutesBefore: 10 }],
      inAppEnabled: true,
    });
    const calendar = createCalendar(db, LOCAL_USER_ID, { title: "Ops" });
    updateCalendarPreference(db, LOCAL_USER_ID, calendar.id, {
      notificationChannels: ["in_app"],
      notificationsEnabled: true,
    });
    const event = createCalendarEvent(db, LOCAL_USER_ID, {
      calendarId: calendar.id,
      title: "Userless reminder",
      startAt: "2026-06-01T10:10:00.000Z",
      endAt: "2026-06-01T10:30:00.000Z",
      timezone: "UTC",
    });

    const delivered = scheduleDueCalendarReminders(
      db,
      new Date("2026-06-01T10:00:00.000Z"),
    );
    const listed = listCurrentCalendarNotifications(db, LOCAL_USER_ID);

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      calendarId: calendar.id,
      channel: "in_app",
      eventId: String(event.id),
      sourceType: "local",
      status: "delivered",
      title: "Userless reminder",
      userId: LOCAL_USER_ID,
    });
    expect(listed.map((item) => item.id)).toEqual(
      delivered.map((item) => item.id),
    );
  });

  test("external ICS calendars stay ownerless but remain refreshable", () => {
    const db = setupDb();
    const external = createExternalCalendar(db, LOCAL_USER_ID, {
      title: "Feed",
      url: "https://example.com/calendar.ics",
    });

    const due = listDueExternalIcsCalendarRefreshes(
      db,
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(due.some((candidate) => candidate.id === external.id)).toBeTrue();
    expect(due[0]?.ownerUserId).toBe(LOCAL_USER_ID);
  });

  test("calendar ownerless migration keeps child foreign keys on current tables", () => {
    const db = setupMemoryCalendarDb();
    try {
      const { calendar, external } = seedForeignKeySensitiveCalendarRows(db);
      db.run("ALTER TABLE calendars ADD COLUMN owner_user_id INTEGER");
      db.run(
        "ALTER TABLE external_ics_calendars ADD COLUMN owner_user_id INTEGER",
      );

      initCalendarSchema(db);

      expect(foreignKeyTargets(db, "calendar_event_reminders")).toEqual([
        "calendar_events",
      ]);
      expect(foreignKeyTargets(db, "external_ics_event_cache")).toEqual([
        "external_ics_calendars",
      ]);
      expect(
        db
          .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count FROM calendar_event_reminders`,
          )
          .get()?.count,
      ).toBe(1);
      replaceExternalCalendarCache(db, external.id, [
        {
          uid: "external-after-migration",
          title: "External after migration",
          startAt: "2026-06-02T12:00:00.000Z",
          endAt: "2026-06-02T13:00:00.000Z",
          timezone: "UTC",
        },
      ]);
      createCalendarEvent(db, LOCAL_USER_ID, {
        calendarId: calendar.id,
        title: "Reminder after migration",
        startAt: "2026-06-02T10:00:00.000Z",
        endAt: "2026-06-02T10:30:00.000Z",
        timezone: "UTC",
        reminders: [{ minutesBefore: 15 }],
      });
      expect(foreignKeyCheck(db)).toEqual([]);
    } finally {
      db.close(false);
    }
  });

  test("schema init repairs legacy foreign-key targets left by prior calendar migration", () => {
    const db = setupMemoryCalendarDb();
    try {
      const { calendar, external } = seedForeignKeySensitiveCalendarRows(db);
      corruptCalendarForeignKeysAsPreviousMigrationDid(db);
      db.query(
        `UPDATE external_ics_calendars SET last_fetched_at = ?, last_error_at = ?, last_error = ?, consecutive_failures = 1 WHERE id = ?`,
      ).run(
        "2026-06-01T12:00:00.000Z",
        "2026-06-01T12:00:00.000Z",
        "no such table: main.external_ics_calendars_legacy",
        external.id,
      );
      expect(foreignKeyTargets(db, "calendar_event_reminders")).toEqual([
        "calendar_events_legacy",
      ]);
      expect(foreignKeyTargets(db, "external_ics_event_cache")).toEqual([
        "external_ics_calendars_legacy",
      ]);

      initCalendarSchema(db);

      expect(foreignKeyTargets(db, "calendar_event_reminders")).toEqual([
        "calendar_events",
      ]);
      expect(foreignKeyTargets(db, "external_ics_event_cache")).toEqual([
        "external_ics_calendars",
      ]);
      expect(
        db
          .query<
            {
              consecutiveFailures: number;
              lastError: string | null;
              lastErrorAt: string | null;
              lastFetchedAt: string | null;
            },
            [number]
          >(
            `SELECT last_fetched_at AS lastFetchedAt, last_error_at AS lastErrorAt, last_error AS lastError, consecutive_failures AS consecutiveFailures FROM external_ics_calendars WHERE id = ?`,
          )
          .get(external.id),
      ).toEqual({
        consecutiveFailures: 0,
        lastError: null,
        lastErrorAt: null,
        lastFetchedAt: null,
      });
      replaceExternalCalendarCache(db, external.id, [
        {
          uid: "external-after-repair",
          title: "External after repair",
          startAt: "2026-06-03T12:00:00.000Z",
          endAt: "2026-06-03T13:00:00.000Z",
          timezone: "UTC",
        },
      ]);
      createCalendarEvent(db, LOCAL_USER_ID, {
        calendarId: calendar.id,
        title: "Reminder after repair",
        startAt: "2026-06-03T10:00:00.000Z",
        endAt: "2026-06-03T10:30:00.000Z",
        timezone: "UTC",
        reminders: [{ minutesBefore: 20 }],
      });
      expect(foreignKeyCheck(db)).toEqual([]);
    } finally {
      db.close(false);
    }
  });

  test("singleton notification settings cleanup clears legacy plaintext secrets", () => {
    const db = setupDb();
    db.query(
      `ALTER TABLE calendar_notification_settings ADD COLUMN ntfy_token TEXT NOT NULL DEFAULT ''`,
    ).run();
    db.query(
      `ALTER TABLE calendar_notification_settings ADD COLUMN ntfy_password TEXT NOT NULL DEFAULT ''`,
    ).run();
    db.query(
      `UPDATE calendar_notification_settings SET ntfy_token = 'token', ntfy_password = 'password' WHERE id = 1`,
    ).run();

    initCalendarSchema(db);

    const row = db
      .query<{ ntfyToken: string; ntfyPassword: string }, []>(
        `SELECT ntfy_token AS ntfyToken, ntfy_password AS ntfyPassword FROM calendar_notification_settings WHERE id = 1`,
      )
      .get();
    expect(row).toEqual({ ntfyToken: "", ntfyPassword: "" });
  });
});
