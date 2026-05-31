/**
 * @file src/bun/calendar/store.ts
 * @description SQLite persistence layer for Metidos calendar data.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import {
  assertCalendarOwner,
  assertCalendarReadable,
  assertCalendarWritable,
  getLocalCalendarPermission,
  permissionCanWrite,
} from "./permissions";
import {
  adjustRRuleCountAfterSplit,
  expandCalendarOccurrences,
  summarizeRecurrence,
  truncateRRuleBeforeOccurrence,
  validateRRuleString,
} from "./recurrence";
import type {
  CalendarEventInput,
  CalendarEventUpdateInput,
  CalendarNotificationChannel,
  CalendarReminderInput,
  CalendarReminderScope,
  CalendarSharePermission,
  RpcCalendar,
  RpcCalendarBootstrap,
  RpcCalendarEvent,
  RpcCalendarNotificationSettings,
  RpcCalendarOccurrence,
  RpcCalendarReminderDelivery,
  RpcCalendarShare,
  RpcCalendarUser,
  RpcExternalIcsCalendar,
} from "./types";

export const DEFAULT_CALENDAR_COLOR = "#7aa5c4";
export const DEFAULT_EXTERNAL_CALENDAR_COLOR = "#9a86d1";
export const DEFAULT_EXTERNAL_ICS_REFRESH_INTERVAL_MINUTES = 4 * 60;
export const DEFAULT_REMINDER_MINUTES = 10;
export const MAX_CALENDAR_OCCURRENCES_PER_REQUEST = 5_000;
export const MAX_CALENDAR_REMINDERS_PER_EVENT = 20;
const LOCAL_CALENDAR_COMPAT_USER_ID = 1;
const LOCAL_CALENDAR_COMPAT_USERNAME = "Local Operator";
export const CALENDAR_PUBLIC_SLUG_RESERVED_WORDS = new Set([
  "admin",
  "all",
  "api",
  "assets",
  "auth",
  "calendar",
  "health",
  "index",
  "public",
  "rpc",
  "share",
  "static",
  "terminal",
]);

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

const DEFAULT_NOTIFICATION_CHANNELS: CalendarNotificationChannel[] =
  Object.freeze(["in_app"]) as CalendarNotificationChannel[];
const CHANNEL_SET = new Set<CalendarNotificationChannel>([
  "in_app",
  "browser",
  "ntfy",
]);
const NTFY_AUTH_TYPES: ReadonlySet<
  RpcCalendarNotificationSettings["ntfyAuthType"]
> = new Set(["none", "bearer", "basic"]);
const NTFY_PRIORITIES: ReadonlySet<
  RpcCalendarNotificationSettings["ntfyPriority"]
> = new Set(["min", "low", "default", "high", "urgent"]);

function nowIso(): string {
  return new Date().toISOString();
}

function calendarOccurrenceLimitError(maxOccurrences: number): Error {
  return Object.assign(
    new Error(
      `Calendar occurrence request returned more than ${maxOccurrences} occurrences. Narrow the date range.`,
    ),
    { code: "calendar_occurrence_limit_exceeded" },
  );
}

function assertCalendarOccurrenceLimit(
  count: number,
  maxOccurrences: number | null | undefined,
): void {
  if (typeof maxOccurrences === "number" && count > maxOccurrences) {
    throw calendarOccurrenceLimitError(maxOccurrences);
  }
}

function run(
  database: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): void {
  database.query(sql).run(...bindings);
}

function boolFromSql(value: unknown): boolean {
  return value === 1 || value === true;
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStrictCalendarDate(value: string, fieldName: string): number {
  if (!STRICT_DATE_RE.test(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} must be a real calendar date.`);
  }
  return date.getTime();
}

function normalizeNtfyAuthType(
  value: string,
): RpcCalendarNotificationSettings["ntfyAuthType"] {
  if (
    NTFY_AUTH_TYPES.has(
      value as RpcCalendarNotificationSettings["ntfyAuthType"],
    )
  ) {
    return value as RpcCalendarNotificationSettings["ntfyAuthType"];
  }
  throw new Error("Calendar ntfy auth type is invalid.");
}

function normalizeNtfyPriority(
  value: string,
): RpcCalendarNotificationSettings["ntfyPriority"] {
  if (
    NTFY_PRIORITIES.has(
      value as RpcCalendarNotificationSettings["ntfyPriority"],
    )
  ) {
    return value as RpcCalendarNotificationSettings["ntfyPriority"];
  }
  throw new Error("Calendar ntfy priority is invalid.");
}

function normalizeExternalIcsUrl(input: string): string {
  const rawUrl = normalizeText(input);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("External ICS subscriptions require a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("External ICS subscriptions require a valid http(s) URL.");
  }
  if (url.username || url.password) {
    throw new Error("External ICS subscriptions must not include credentials.");
  }
  return url.toString();
}

function calendarNotificationSettingsColumnNames(
  database: Database,
): Set<string> {
  return new Set(
    database
      .query<{ name: string }, []>(
        `PRAGMA table_info(calendar_notification_settings)`,
      )
      .all()
      .map((column) => column.name),
  );
}

function clearLegacyNtfyNotificationSecrets(database: Database): void {
  const columns = calendarNotificationSettingsColumnNames(database);
  if (columns.has("ntfy_token")) {
    run(
      database,
      `UPDATE calendar_notification_settings SET ntfy_token = '' WHERE ntfy_token <> ''`,
    );
  }
  if (columns.has("ntfy_password")) {
    run(
      database,
      `UPDATE calendar_notification_settings SET ntfy_password = '' WHERE ntfy_password <> ''`,
    );
  }
}

function normalizeChannels(
  value: string | null | undefined,
): CalendarNotificationChannel[] {
  if (!value) {
    return DEFAULT_NOTIFICATION_CHANNELS;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_NOTIFICATION_CHANNELS;
    }
    const channels = parsed.filter(
      (item): item is CalendarNotificationChannel => CHANNEL_SET.has(item),
    );
    return channels.length > 0 ? channels : DEFAULT_NOTIFICATION_CHANNELS;
  } catch {
    return DEFAULT_NOTIFICATION_CHANNELS;
  }
}

function serializeChannels(
  channels: readonly CalendarNotificationChannel[] | null | undefined,
): string {
  const normalized = (channels ?? DEFAULT_NOTIFICATION_CHANNELS).filter(
    (channel) => CHANNEL_SET.has(channel),
  );
  return JSON.stringify(
    normalized.length > 0 ? normalized : DEFAULT_NOTIFICATION_CHANNELS,
  );
}

function parseRemindersJson(
  value: string | null | undefined,
): CalendarReminderInput[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .slice(0, MAX_CALENDAR_REMINDERS_PER_EVENT)
      .map((item) => {
        if (typeof item === "number") {
          return { minutesBefore: item } satisfies CalendarReminderInput;
        }
        if (
          typeof item === "object" &&
          item !== null &&
          "minutesBefore" in item
        ) {
          const minutesBefore = Number(
            (item as { minutesBefore?: unknown }).minutesBefore,
          );
          return Number.isFinite(minutesBefore)
            ? ({
                id: (item as { id?: string | number | null }).id ?? null,
                minutesBefore: Math.max(0, Math.floor(minutesBefore)),
              } satisfies CalendarReminderInput)
            : null;
        }
        return null;
      })
      .filter((item): item is CalendarReminderInput => item !== null);
  } catch {
    return [];
  }
}

function normalizeReminders(
  reminders: CalendarReminderInput[] | null | undefined,
): CalendarReminderInput[] {
  if (!Array.isArray(reminders)) {
    return [];
  }
  if (reminders.length > MAX_CALENDAR_REMINDERS_PER_EVENT) {
    throw new Error(
      `Calendar events support at most ${MAX_CALENDAR_REMINDERS_PER_EVENT} reminders.`,
    );
  }
  return reminders
    .map((reminder) => ({
      id: reminder.id ?? null,
      minutesBefore: Math.max(0, Math.floor(Number(reminder.minutesBefore))),
    }))
    .filter((reminder) => Number.isFinite(reminder.minutesBefore));
}

function serializeReminders(
  reminders: CalendarReminderInput[] | null | undefined,
): string {
  return JSON.stringify(normalizeReminders(reminders));
}

export function normalizePublicSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) {
    throw new Error(
      "Public slug must use 3-80 lowercase letters, numbers, or hyphens.",
    );
  }
  if (slug.includes("--")) {
    throw new Error("Public slug cannot contain repeated hyphens.");
  }
  if (CALENDAR_PUBLIC_SLUG_RESERVED_WORDS.has(slug)) {
    throw new Error("That public slug is reserved.");
  }
  return slug;
}

function makeSlugBase(title: string, fallback: string): string {
  const base = (title || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length >= 3 && !CALENDAR_PUBLIC_SLUG_RESERVED_WORDS.has(base)
    ? base
    : fallback;
}

export function createUniqueCalendarSlug(
  database: Database,
  title: string,
): string {
  const base = makeSlugBase(title, "calendar-local");
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = normalizePublicSlug(`${base}${suffix}`.slice(0, 80));
    const existing = database
      .query<{ id: number }, [string]>(
        "SELECT id FROM calendars WHERE public_slug = ? LIMIT 1",
      )
      .get(candidate);
    if (!existing) {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique calendar slug.");
}

function allocateCalendarId(database: Database): number {
  run(database, `INSERT INTO calendar_id_sequence DEFAULT VALUES`);
  return Number(
    database.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()
      ?.id ?? 0,
  );
}

function seedCalendarIdSequence(database: Database): void {
  const maxId = Number(
    database
      .query<{ maxId: number | null }, []>(
        `
          SELECT MAX(id) AS maxId FROM (
            SELECT id FROM calendars
            UNION ALL
            SELECT id FROM external_ics_calendars
          )
        `,
      )
      .get()?.maxId ?? 0,
  );
  const current = Number(
    database
      .query<{ seq: number | null }, []>(
        `SELECT seq FROM sqlite_sequence WHERE name = 'calendar_id_sequence'`,
      )
      .get()?.seq ?? 0,
  );
  run(
    database,
    `INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('calendar_id_sequence', ?)`,
    Math.max(current, maxId),
  );
}

function migrateExternalCalendarIdsToGlobalSpace(database: Database): void {
  const conflicts = database
    .query<{ id: number }, []>(
      `
        SELECT external_ics_calendars.id AS id
        FROM external_ics_calendars
        INNER JOIN calendars ON calendars.id = external_ics_calendars.id
        ORDER BY external_ics_calendars.id ASC
      `,
    )
    .all();
  if (conflicts.length === 0) {
    return;
  }

  if (database.inTransaction) {
    throw new Error(
      "External calendar id migration cannot run inside an active transaction.",
    );
  }

  seedCalendarIdSequence(database);
  run(database, `PRAGMA foreign_keys = OFF`);
  run(database, `BEGIN IMMEDIATE`);
  try {
    for (const conflict of conflicts) {
      const nextId = allocateCalendarId(database);
      run(
        database,
        `UPDATE external_ics_event_cache SET external_calendar_id = ? WHERE external_calendar_id = ?`,
        nextId,
        conflict.id,
      );
      run(
        database,
        `UPDATE calendar_reminder_deliveries SET calendar_id = ? WHERE source_type = 'external_ics' AND calendar_id = ?`,
        nextId,
        conflict.id,
      );
      run(
        database,
        `UPDATE external_ics_calendars SET id = ? WHERE id = ?`,
        nextId,
        conflict.id,
      );
    }
    run(database, `COMMIT`);
  } catch (error) {
    run(database, `ROLLBACK`);
    throw error;
  } finally {
    run(database, `PRAGMA foreign_keys = ON`);
  }
}

function tableHasColumn(
  database: Database,
  tableName: string,
  columnName: string,
): boolean {
  return database
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function tableReferencesTable(
  database: Database,
  tableName: string,
  referencedTableName: string,
): boolean {
  return database
    .query<{ table: string }, []>(`PRAGMA foreign_key_list(${tableName})`)
    .all()
    .some((foreignKey) => foreignKey.table === referencedTableName);
}

function createCalendarEventRemindersTable(
  database: Database,
  options: { ifNotExists?: boolean } = {},
): void {
  run(
    database,
    `CREATE TABLE ${options.ifNotExists ? "IF NOT EXISTS " : ""}calendar_event_reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE, minutes_before INTEGER NOT NULL CHECK(minutes_before >= 0), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
  );
}

function copyCalendarEventRemindersFromTable(
  database: Database,
  sourceTableName: string,
): void {
  run(
    database,
    `INSERT INTO calendar_event_reminders (id, event_id, minutes_before, created_at) SELECT id, event_id, minutes_before, created_at FROM ${sourceTableName}`,
  );
}

function createExternalIcsEventCacheTable(
  database: Database,
  options: { ifNotExists?: boolean } = {},
): void {
  run(
    database,
    `CREATE TABLE ${options.ifNotExists ? "IF NOT EXISTS " : ""}external_ics_event_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, external_calendar_id INTEGER NOT NULL REFERENCES external_ics_calendars(id) ON DELETE CASCADE, uid TEXT NOT NULL, recurrence_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', start_at TEXT, end_at TEXT, start_date TEXT, end_date TEXT, all_day INTEGER NOT NULL DEFAULT 0, timezone TEXT NOT NULL DEFAULT 'UTC', recurrence_rule TEXT, exdates_json TEXT NOT NULL DEFAULT '[]', reminders_json TEXT NOT NULL DEFAULT '[]', url TEXT, raw_json TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), UNIQUE(external_calendar_id, uid, recurrence_id))`,
  );
}

function copyExternalIcsEventCacheFromTable(
  database: Database,
  sourceTableName: string,
): void {
  run(
    database,
    `INSERT INTO external_ics_event_cache (id, external_calendar_id, uid, recurrence_id, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone, recurrence_rule, exdates_json, reminders_json, url, raw_json, updated_at) SELECT id, external_calendar_id, uid, recurrence_id, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone, recurrence_rule, exdates_json, reminders_json, url, raw_json, updated_at FROM ${sourceTableName}`,
  );
}

function rebuildCalendarEventRemindersTableFrom(
  database: Database,
  sourceTableName: string,
): void {
  createCalendarEventRemindersTable(database);
  copyCalendarEventRemindersFromTable(database, sourceTableName);
}

function rebuildExternalIcsEventCacheTableFrom(
  database: Database,
  sourceTableName: string,
): void {
  createExternalIcsEventCacheTable(database);
  copyExternalIcsEventCacheFromTable(database, sourceTableName);
}

function repairLegacyCalendarForeignKeyTargets(database: Database): void {
  const repairEventReminders = tableReferencesTable(
    database,
    "calendar_event_reminders",
    "calendar_events_legacy",
  );
  const repairExternalIcsCache = tableReferencesTable(
    database,
    "external_ics_event_cache",
    "external_ics_calendars_legacy",
  );
  if (!repairEventReminders && !repairExternalIcsCache) {
    return;
  }

  run(database, `PRAGMA foreign_keys = OFF`);
  run(database, `BEGIN IMMEDIATE`);
  try {
    if (repairEventReminders) {
      run(database, `DROP TABLE IF EXISTS calendar_event_reminders_fk_repair`);
      run(
        database,
        `ALTER TABLE calendar_event_reminders RENAME TO calendar_event_reminders_fk_repair`,
      );
      rebuildCalendarEventRemindersTableFrom(
        database,
        "calendar_event_reminders_fk_repair",
      );
      run(database, `DROP TABLE calendar_event_reminders_fk_repair`);
    }
    if (repairExternalIcsCache) {
      run(database, `DROP TABLE IF EXISTS external_ics_event_cache_fk_repair`);
      run(
        database,
        `ALTER TABLE external_ics_event_cache RENAME TO external_ics_event_cache_fk_repair`,
      );
      rebuildExternalIcsEventCacheTableFrom(
        database,
        "external_ics_event_cache_fk_repair",
      );
      run(database, `DROP TABLE external_ics_event_cache_fk_repair`);
      run(
        database,
        `UPDATE external_ics_calendars SET last_fetched_at = NULL, last_error_at = NULL, last_error = NULL, consecutive_failures = 0, updated_at = ? WHERE last_error LIKE 'no such table: main.external_ics_calendars_legacy%'`,
        nowIso(),
      );
    }
    run(database, `COMMIT`);
  } catch (error) {
    run(database, `ROLLBACK`);
    throw error;
  } finally {
    run(database, `PRAGMA foreign_keys = ON`);
  }
}

function rebuildCalendarTablesForLocalOperator(database: Database): void {
  const needsRebuild =
    tableHasColumn(database, "calendars", "owner_user_id") ||
    tableHasColumn(database, "calendar_user_preferences", "user_id") ||
    tableHasColumn(database, "calendar_events", "created_by_user_id") ||
    tableHasColumn(database, "calendar_event_exdates", "created_by_user_id") ||
    tableHasColumn(
      database,
      "calendar_event_overrides",
      "created_by_user_id",
    ) ||
    tableHasColumn(database, "external_ics_calendars", "owner_user_id") ||
    tableHasColumn(database, "calendar_notification_settings", "user_id") ||
    tableHasColumn(database, "calendar_reminder_deliveries", "user_id") ||
    tableHasColumn(database, "calendar_snoozes", "user_id") ||
    database
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calendar_shares'`,
      )
      .get() !== null;
  if (!needsRebuild) {
    return;
  }

  run(database, `PRAGMA foreign_keys = OFF`);
  run(database, `BEGIN IMMEDIATE`);
  try {
    run(database, `DROP TABLE IF EXISTS calendar_shares`);
    run(database, `ALTER TABLE calendars RENAME TO calendars_legacy`);
    run(
      database,
      `ALTER TABLE calendar_user_preferences RENAME TO calendar_user_preferences_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_events RENAME TO calendar_events_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_event_exdates RENAME TO calendar_event_exdates_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_event_overrides RENAME TO calendar_event_overrides_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_event_reminders RENAME TO calendar_event_reminders_legacy`,
    );
    run(
      database,
      `ALTER TABLE external_ics_calendars RENAME TO external_ics_calendars_legacy`,
    );
    run(
      database,
      `ALTER TABLE external_ics_event_cache RENAME TO external_ics_event_cache_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_notification_settings RENAME TO calendar_notification_settings_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_reminder_deliveries RENAME TO calendar_reminder_deliveries_legacy`,
    );
    run(
      database,
      `ALTER TABLE calendar_snoozes RENAME TO calendar_snoozes_legacy`,
    );

    run(
      database,
      `CREATE TABLE calendars (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '${DEFAULT_CALENDAR_COLOR}', is_public INTEGER NOT NULL DEFAULT 0, public_slug TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT)`,
    );
    run(
      database,
      `INSERT INTO calendars (id, title, color, is_public, public_slug, created_at, updated_at, deleted_at) SELECT id, title, color, is_public, public_slug, created_at, updated_at, deleted_at FROM calendars_legacy`,
    );

    run(
      database,
      `CREATE TABLE calendar_user_preferences (calendar_id INTEGER PRIMARY KEY REFERENCES calendars(id) ON DELETE CASCADE, visible INTEGER NOT NULL DEFAULT 1, color_override TEXT, notifications_enabled INTEGER NOT NULL DEFAULT 0, notification_channels_json TEXT NOT NULL DEFAULT '["in_app"]', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    );
    run(
      database,
      `INSERT INTO calendar_user_preferences (calendar_id, visible, color_override, notifications_enabled, notification_channels_json, created_at, updated_at) SELECT calendar_id, visible, color_override, notifications_enabled, notification_channels_json, MIN(created_at), MAX(updated_at) FROM calendar_user_preferences_legacy GROUP BY calendar_id`,
    );

    run(
      database,
      `CREATE TABLE calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', start_at TEXT, end_at TEXT, start_date TEXT, end_date TEXT, all_day INTEGER NOT NULL DEFAULT 0, timezone TEXT NOT NULL, recurrence_rule TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT)`,
    );
    run(
      database,
      `INSERT INTO calendar_events (id, calendar_id, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone, recurrence_rule, version, created_at, updated_at, deleted_at) SELECT id, calendar_id, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone, recurrence_rule, version, created_at, updated_at, deleted_at FROM calendar_events_legacy`,
    );

    run(
      database,
      `CREATE TABLE calendar_event_exdates (event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE, original_start TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), PRIMARY KEY(event_id, original_start))`,
    );
    run(
      database,
      `INSERT INTO calendar_event_exdates (event_id, original_start, created_at) SELECT event_id, original_start, created_at FROM calendar_event_exdates_legacy`,
    );

    run(
      database,
      `CREATE TABLE calendar_event_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE, original_start TEXT NOT NULL, title TEXT, description TEXT, location TEXT, start_at TEXT, end_at TEXT, start_date TEXT, end_date TEXT, all_day INTEGER, timezone TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), UNIQUE(event_id, original_start))`,
    );
    run(
      database,
      `INSERT INTO calendar_event_overrides (id, event_id, original_start, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone, version, created_at, updated_at) SELECT id, event_id, original_start, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone, version, created_at, updated_at FROM calendar_event_overrides_legacy`,
    );

    rebuildCalendarEventRemindersTableFrom(
      database,
      "calendar_event_reminders_legacy",
    );

    run(
      database,
      `CREATE TABLE external_ics_calendars (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL, color TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_CALENDAR_COLOR}', enabled INTEGER NOT NULL DEFAULT 1, visible INTEGER NOT NULL DEFAULT 1, notifications_enabled INTEGER NOT NULL DEFAULT 0, notification_mode TEXT NOT NULL DEFAULT 'default' CHECK(notification_mode IN ('source', 'default')), etag TEXT, last_modified TEXT, refresh_interval_minutes INTEGER NOT NULL DEFAULT 240, last_fetched_at TEXT, last_success_at TEXT, last_error_at TEXT, last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    );
    run(
      database,
      `INSERT INTO external_ics_calendars (id, title, url, color, enabled, visible, notifications_enabled, notification_mode, etag, last_modified, refresh_interval_minutes, last_fetched_at, last_success_at, last_error_at, last_error, consecutive_failures, created_at, updated_at) SELECT id, title, url, color, enabled, visible, notifications_enabled, notification_mode, etag, last_modified, refresh_interval_minutes, last_fetched_at, last_success_at, last_error_at, last_error, consecutive_failures, created_at, updated_at FROM external_ics_calendars_legacy`,
    );

    rebuildExternalIcsEventCacheTableFrom(
      database,
      "external_ics_event_cache_legacy",
    );

    run(
      database,
      `CREATE TABLE calendar_notification_settings (id INTEGER PRIMARY KEY CHECK(id = 1), default_reminders_json TEXT NOT NULL DEFAULT '[{"minutesBefore":10}]', in_app_enabled INTEGER NOT NULL DEFAULT 1, browser_enabled INTEGER NOT NULL DEFAULT 0, ntfy_enabled INTEGER NOT NULL DEFAULT 0, ntfy_server_url TEXT NOT NULL DEFAULT 'https://ntfy.sh', ntfy_topic TEXT NOT NULL DEFAULT '', ntfy_auth_type TEXT NOT NULL DEFAULT 'none' CHECK(ntfy_auth_type IN ('none', 'bearer', 'basic')), ntfy_username TEXT NOT NULL DEFAULT '', ntfy_priority TEXT NOT NULL DEFAULT 'default' CHECK(ntfy_priority IN ('min', 'low', 'default', 'high', 'urgent')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    );
    run(
      database,
      `INSERT INTO calendar_notification_settings (id, default_reminders_json, in_app_enabled, browser_enabled, ntfy_enabled, ntfy_server_url, ntfy_topic, ntfy_auth_type, ntfy_username, ntfy_priority, updated_at) SELECT 1, default_reminders_json, in_app_enabled, browser_enabled, ntfy_enabled, ntfy_server_url, ntfy_topic, ntfy_auth_type, ntfy_username, ntfy_priority, updated_at FROM calendar_notification_settings_legacy ORDER BY rowid ASC LIMIT 1`,
    );

    run(
      database,
      `CREATE TABLE calendar_reminder_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL CHECK(source_type IN ('local', 'external_ics')), calendar_id INTEGER, event_id TEXT NOT NULL, occurrence_start TEXT NOT NULL, occurrence_timezone TEXT NOT NULL, reminder_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('in_app', 'browser', 'ntfy')), scheduled_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled', 'delivered', 'dismissed', 'failed', 'expired', 'snoozed')), delivered_at TEXT, dismissed_at TEXT, read_at TEXT, title TEXT NOT NULL, body TEXT NOT NULL, open_event_payload_json TEXT, retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), UNIQUE(source_type, event_id, occurrence_start, occurrence_timezone, reminder_id, channel))`,
    );
    run(
      database,
      `INSERT OR IGNORE INTO calendar_reminder_deliveries (id, source_type, calendar_id, event_id, occurrence_start, occurrence_timezone, reminder_id, channel, scheduled_at, status, delivered_at, dismissed_at, read_at, title, body, open_event_payload_json, retry_count, last_error, created_at, updated_at) SELECT id, source_type, calendar_id, event_id, occurrence_start, occurrence_timezone, reminder_id, channel, scheduled_at, status, delivered_at, dismissed_at, read_at, title, body, open_event_payload_json, retry_count, last_error, created_at, updated_at FROM calendar_reminder_deliveries_legacy`,
    );

    run(
      database,
      `CREATE TABLE calendar_snoozes (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER NOT NULL REFERENCES calendar_reminder_deliveries(id) ON DELETE CASCADE, snoozed_until TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    );
    run(
      database,
      `INSERT INTO calendar_snoozes (id, delivery_id, snoozed_until, created_at) SELECT id, delivery_id, snoozed_until, created_at FROM calendar_snoozes_legacy`,
    );

    run(database, `DROP TABLE calendars_legacy`);
    run(database, `DROP TABLE calendar_user_preferences_legacy`);
    run(database, `DROP TABLE calendar_event_reminders_legacy`);
    run(database, `DROP TABLE calendar_events_legacy`);
    run(database, `DROP TABLE calendar_event_exdates_legacy`);
    run(database, `DROP TABLE calendar_event_overrides_legacy`);
    run(database, `DROP TABLE external_ics_event_cache_legacy`);
    run(database, `DROP TABLE external_ics_calendars_legacy`);
    run(database, `DROP TABLE calendar_notification_settings_legacy`);
    run(database, `DROP TABLE calendar_reminder_deliveries_legacy`);
    run(database, `DROP TABLE calendar_snoozes_legacy`);

    run(database, `COMMIT`);
  } catch (error) {
    run(database, `ROLLBACK`);
    throw error;
  } finally {
    run(database, `PRAGMA foreign_keys = ON`);
  }
}

export function initCalendarSchema(database: Database): void {
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_id_sequence (id INTEGER PRIMARY KEY AUTOINCREMENT)`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendars (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '${DEFAULT_CALENDAR_COLOR}', is_public INTEGER NOT NULL DEFAULT 0, public_slug TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT)`,
  );
  run(
    database,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_public_slug_unique ON calendars(public_slug) WHERE public_slug IS NOT NULL`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendars_deleted_at ON calendars(deleted_at)`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_user_preferences (calendar_id INTEGER PRIMARY KEY REFERENCES calendars(id) ON DELETE CASCADE, visible INTEGER NOT NULL DEFAULT 1, color_override TEXT, notifications_enabled INTEGER NOT NULL DEFAULT 0, notification_channels_json TEXT NOT NULL DEFAULT '["in_app"]', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', start_at TEXT, end_at TEXT, start_date TEXT, end_date TEXT, all_day INTEGER NOT NULL DEFAULT 0, timezone TEXT NOT NULL, recurrence_rule TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT)`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id, deleted_at, start_at, start_date)`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted_at ON calendar_events(deleted_at)`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_event_exdates (event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE, original_start TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), PRIMARY KEY(event_id, original_start))`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_event_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE, original_start TEXT NOT NULL, title TEXT, description TEXT, location TEXT, start_at TEXT, end_at TEXT, start_date TEXT, end_date TEXT, all_day INTEGER, timezone TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), UNIQUE(event_id, original_start))`,
  );
  createCalendarEventRemindersTable(database, { ifNotExists: true });
  run(
    database,
    `CREATE TABLE IF NOT EXISTS external_ics_calendars (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL, color TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_CALENDAR_COLOR}', enabled INTEGER NOT NULL DEFAULT 1, visible INTEGER NOT NULL DEFAULT 1, notifications_enabled INTEGER NOT NULL DEFAULT 0, notification_mode TEXT NOT NULL DEFAULT 'default' CHECK(notification_mode IN ('source', 'default')), etag TEXT, last_modified TEXT, refresh_interval_minutes INTEGER NOT NULL DEFAULT 240, last_fetched_at TEXT, last_success_at TEXT, last_error_at TEXT, last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_external_ics_enabled ON external_ics_calendars(enabled, visible)`,
  );
  createExternalIcsEventCacheTable(database, { ifNotExists: true });
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_notification_settings (id INTEGER PRIMARY KEY CHECK(id = 1), default_reminders_json TEXT NOT NULL DEFAULT '[{"minutesBefore":10}]', in_app_enabled INTEGER NOT NULL DEFAULT 1, browser_enabled INTEGER NOT NULL DEFAULT 0, ntfy_enabled INTEGER NOT NULL DEFAULT 0, ntfy_server_url TEXT NOT NULL DEFAULT 'https://ntfy.sh', ntfy_topic TEXT NOT NULL DEFAULT '', ntfy_auth_type TEXT NOT NULL DEFAULT 'none' CHECK(ntfy_auth_type IN ('none', 'bearer', 'basic')), ntfy_username TEXT NOT NULL DEFAULT '', ntfy_priority TEXT NOT NULL DEFAULT 'default' CHECK(ntfy_priority IN ('min', 'low', 'default', 'high', 'urgent')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_reminder_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL CHECK(source_type IN ('local', 'external_ics')), calendar_id INTEGER, event_id TEXT NOT NULL, occurrence_start TEXT NOT NULL, occurrence_timezone TEXT NOT NULL, reminder_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('in_app', 'browser', 'ntfy')), scheduled_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled', 'delivered', 'dismissed', 'failed', 'expired', 'snoozed')), delivered_at TEXT, dismissed_at TEXT, read_at TEXT, title TEXT NOT NULL, body TEXT NOT NULL, open_event_payload_json TEXT, retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), UNIQUE(source_type, event_id, occurrence_start, occurrence_timezone, reminder_id, channel))`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendar_deliveries_due ON calendar_reminder_deliveries(status, scheduled_at)`,
  );
  run(
    database,
    `CREATE TABLE IF NOT EXISTS calendar_snoozes (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER NOT NULL REFERENCES calendar_reminder_deliveries(id) ON DELETE CASCADE, snoozed_until TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
  );

  rebuildCalendarTablesForLocalOperator(database);
  run(
    database,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_public_slug_unique ON calendars(public_slug) WHERE public_slug IS NOT NULL`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendars_deleted_at ON calendars(deleted_at)`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id, deleted_at, start_at, start_date)`,
  );
  run(
    database,
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted_at ON calendar_events(deleted_at)`,
  );
  repairLegacyCalendarForeignKeyTargets(database);
  clearLegacyNtfyNotificationSecrets(database);
  migrateExternalCalendarIdsToGlobalSpace(database);
  seedCalendarIdSequence(database);
  ensureDefaultCalendarsForAllUsers(database);
}

export function listCalendarUsers(_database: Database): RpcCalendarUser[] {
  return [];
}

export function firstCalendarUserId(_database: Database): number | null {
  return LOCAL_CALENDAR_COMPAT_USER_ID;
}

export function ensureDefaultCalendarForUser(
  database: Database,
  userId: number,
): RpcCalendar | null {
  const existing = database
    .query<{ id: number }, []>(
      `SELECT id FROM calendars WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    )
    .get();
  if (!existing) {
    const slug = createUniqueCalendarSlug(
      database,
      `personal-${randomBytes(6).toString("hex")}`,
    );
    run(
      database,
      `INSERT INTO calendars (id, title, color, is_public, public_slug) VALUES (?, 'Personal', ?, 0, ?)`,
      allocateCalendarId(database),
      DEFAULT_CALENDAR_COLOR,
      slug,
    );
  }
  const calendar = database
    .query<{ id: number }, []>(
      `SELECT id FROM calendars WHERE title = 'Personal' AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    )
    .get();
  if (calendar) {
    const preference = database
      .query<{ calendarId: number }, [number]>(
        `SELECT calendar_id AS calendarId FROM calendar_user_preferences WHERE calendar_id = ?`,
      )
      .get(calendar.id);
    if (!preference) {
      upsertCalendarPreference(database, userId, calendar.id, {
        visible: true,
        notificationsEnabled: true,
        notificationChannels: DEFAULT_NOTIFICATION_CHANNELS,
      });
    }
  }
  ensureNotificationSettings(database, userId);
  return (
    listVisibleCalendars(database, userId).find(
      (item) => item.id === calendar?.id,
    ) ?? null
  );
}

export function ensureDefaultCalendarsForAllUsers(database: Database): void {
  ensureDefaultCalendarForUser(database, LOCAL_CALENDAR_COMPAT_USER_ID);
}

export function ensureNotificationSettings(
  database: Database,
  userId: number,
): RpcCalendarNotificationSettings {
  run(
    database,
    `INSERT OR IGNORE INTO calendar_notification_settings (id) VALUES (1)`,
  );
  const row = database
    .query<
      {
        defaultRemindersJson: string;
        inAppEnabled: 0 | 1;
        browserEnabled: 0 | 1;
        ntfyEnabled: 0 | 1;
        ntfyServerUrl: string;
        ntfyTopic: string;
        ntfyAuthType: "none" | "bearer" | "basic";
        ntfyUsername: string;
        ntfyPriority: "min" | "low" | "default" | "high" | "urgent";
        updatedAt: string;
      },
      []
    >(
      `
        SELECT
          default_reminders_json AS defaultRemindersJson,
          in_app_enabled AS inAppEnabled,
          browser_enabled AS browserEnabled,
          ntfy_enabled AS ntfyEnabled,
          ntfy_server_url AS ntfyServerUrl,
          ntfy_topic AS ntfyTopic,
          ntfy_auth_type AS ntfyAuthType,
          ntfy_username AS ntfyUsername,
          ntfy_priority AS ntfyPriority,
          updated_at AS updatedAt
        FROM calendar_notification_settings
        WHERE id = 1
      `,
    )
    .get();
  if (!row) {
    throw new Error("Could not initialize calendar notification settings.");
  }
  return {
    userId,
    defaultReminders: parseRemindersJson(row.defaultRemindersJson),
    inAppEnabled: boolFromSql(row.inAppEnabled),
    browserEnabled: boolFromSql(row.browserEnabled),
    browserPermission: "unknown",
    ntfyEnabled: boolFromSql(row.ntfyEnabled),
    ntfyServerUrl: row.ntfyServerUrl,
    ntfyTopic: row.ntfyTopic,
    ntfyAuthType: row.ntfyAuthType,
    ntfyUsername: row.ntfyUsername,
    ntfyPriority: row.ntfyPriority,
    updatedAt: row.updatedAt,
  };
}

export function updateCalendarNotificationSettings(
  database: Database,
  userId: number,
  input: Partial<
    Omit<
      RpcCalendarNotificationSettings,
      "userId" | "updatedAt" | "browserPermission"
    >
  >,
): RpcCalendarNotificationSettings {
  ensureNotificationSettings(database, userId);
  const current = ensureNotificationSettings(database, userId);
  run(
    database,
    `
      UPDATE calendar_notification_settings
      SET
        default_reminders_json = ?,
        in_app_enabled = ?,
        browser_enabled = ?,
        ntfy_enabled = ?,
        ntfy_server_url = ?,
        ntfy_topic = ?,
        ntfy_auth_type = ?,
        ntfy_username = ?,
        ntfy_priority = ?,
        updated_at = ?
      WHERE id = 1
    `,
    serializeReminders(input.defaultReminders ?? current.defaultReminders),
    (input.inAppEnabled ?? current.inAppEnabled) ? 1 : 0,
    (input.browserEnabled ?? current.browserEnabled) ? 1 : 0,
    (input.ntfyEnabled ?? current.ntfyEnabled) ? 1 : 0,
    normalizeText(input.ntfyServerUrl ?? current.ntfyServerUrl) ||
      "https://ntfy.sh",
    normalizeText(input.ntfyTopic ?? current.ntfyTopic),
    normalizeNtfyAuthType(input.ntfyAuthType ?? current.ntfyAuthType),
    normalizeText(input.ntfyUsername ?? current.ntfyUsername),
    normalizeNtfyPriority(input.ntfyPriority ?? current.ntfyPriority),
    nowIso(),
  );
  run(database, `DELETE FROM calendar_reminder_deliveries`);
  return ensureNotificationSettings(database, userId);
}

export function upsertCalendarPreference(
  database: Database,
  _userId: number,
  calendarId: number,
  input: {
    visible?: boolean | null;
    colorOverride?: string | null;
    notificationsEnabled?: boolean | null;
    notificationChannels?: CalendarNotificationChannel[] | null;
  },
): void {
  const now = nowIso();
  run(
    database,
    `
      INSERT INTO calendar_user_preferences (
        calendar_id,
        visible,
        color_override,
        notifications_enabled,
        notification_channels_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(calendar_id) DO UPDATE SET
        visible = excluded.visible,
        color_override = excluded.color_override,
        notifications_enabled = excluded.notifications_enabled,
        notification_channels_json = excluded.notification_channels_json,
        updated_at = excluded.updated_at
    `,
    calendarId,
    (input.visible ?? true) ? 1 : 0,
    input.colorOverride ?? null,
    (input.notificationsEnabled ?? false) ? 1 : 0,
    serializeChannels(input.notificationChannels),
    now,
    now,
  );
}

type CalendarSqlRow = {
  id: number;
  ownerUserId: number;
  ownerUsername: string;
  title: string;
  color: string;
  effectiveColor: string | null;
  visible: 0 | 1 | null;
  notificationsEnabled: 0 | 1 | null;
  notificationChannelsJson: string | null;
  permission: "owner" | "read" | "write";
  isPublic: 0 | 1;
  publicSlug: string | null;
  createdAt: string;
  updatedAt: string;
};

function hydrateCalendar(row: CalendarSqlRow): RpcCalendar {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    ownerUsername: row.ownerUsername,
    sourceType: "local",
    title: row.title,
    color: row.color,
    effectiveColor: row.effectiveColor || row.color,
    visible: row.visible === null ? true : boolFromSql(row.visible),
    notificationsEnabled:
      row.notificationsEnabled === null
        ? row.permission === "owner"
        : boolFromSql(row.notificationsEnabled),
    notificationChannels: normalizeChannels(row.notificationChannelsJson),
    permission: row.permission,
    isPublic: boolFromSql(row.isPublic),
    publicSlug: row.publicSlug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listVisibleCalendars(
  database: Database,
  _userId: number,
): RpcCalendar[] {
  const rows = database
    .query<CalendarSqlRow, []>(
      `
        SELECT
          calendars.id AS id,
          ${LOCAL_CALENDAR_COMPAT_USER_ID} AS ownerUserId,
          '${LOCAL_CALENDAR_COMPAT_USERNAME}' AS ownerUsername,
          calendars.title AS title,
          calendars.color AS color,
          calendar_user_preferences.color_override AS effectiveColor,
          calendar_user_preferences.visible AS visible,
          calendar_user_preferences.notifications_enabled AS notificationsEnabled,
          calendar_user_preferences.notification_channels_json AS notificationChannelsJson,
          'owner' AS permission,
          calendars.is_public AS isPublic,
          calendars.public_slug AS publicSlug,
          calendars.created_at AS createdAt,
          calendars.updated_at AS updatedAt
        FROM calendars
        LEFT JOIN calendar_user_preferences
          ON calendar_user_preferences.calendar_id = calendars.id
        WHERE calendars.deleted_at IS NULL
        ORDER BY LOWER(calendars.title) ASC, calendars.id ASC
      `,
    )
    .all();
  return rows.map(hydrateCalendar);
}

export function listCalendarShares(
  _database: Database,
  _userId: number,
): RpcCalendarShare[] {
  return [];
}

export function createCalendar(
  database: Database,
  userId: number,
  input: {
    title: string;
    color?: string | null;
    isPublic?: boolean | null;
    publicSlug?: string | null;
  },
): RpcCalendar {
  const title = normalizeText(input.title) || "Untitled calendar";
  const color = normalizeText(input.color) || DEFAULT_CALENDAR_COLOR;
  const publicSlug = input.publicSlug
    ? normalizePublicSlug(input.publicSlug)
    : createUniqueCalendarSlug(database, title);
  run(
    database,
    `INSERT INTO calendars (id, title, color, is_public, public_slug) VALUES (?, ?, ?, ?, ?)`,
    allocateCalendarId(database),
    title,
    color,
    input.isPublic ? 1 : 0,
    publicSlug,
  );
  const id = Number(
    database.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()
      ?.id ?? 0,
  );
  upsertCalendarPreference(database, userId, id, {
    visible: true,
    notificationsEnabled: true,
    notificationChannels: DEFAULT_NOTIFICATION_CHANNELS,
  });
  return listVisibleCalendars(database, userId).find(
    (calendar) => calendar.id === id,
  ) as RpcCalendar;
}

export function updateCalendar(
  database: Database,
  userId: number,
  calendarId: number,
  input: {
    title?: string | null;
    color?: string | null;
    isPublic?: boolean | null;
    publicSlug?: string | null;
  },
): RpcCalendar {
  const permission = getLocalCalendarPermission(database, calendarId, userId);
  if (!permission) {
    throw new Error("Calendar not found or not visible.");
  }
  const current = database
    .query<
      {
        title: string;
        color: string;
        isPublic: 0 | 1;
        publicSlug: string | null;
      },
      [number]
    >(
      `SELECT title, color, is_public AS isPublic, public_slug AS publicSlug FROM calendars WHERE id = ?`,
    )
    .get(calendarId);
  if (!current) {
    throw new Error("Calendar not found.");
  }
  const ownerOnlyChange =
    input.isPublic !== undefined || input.publicSlug !== undefined;
  if (ownerOnlyChange && permission.permission !== "owner") {
    throw new Error(
      "Only the calendar owner can change public calendar settings.",
    );
  }
  if (input.title !== undefined || input.color !== undefined) {
    assertCalendarWritable(database, calendarId, userId);
  }
  const title =
    input.title !== undefined
      ? normalizeText(input.title) || current.title
      : current.title;
  const color =
    input.color !== undefined
      ? normalizeText(input.color) || current.color
      : current.color;
  const publicSlug =
    input.publicSlug !== undefined
      ? input.publicSlug
        ? normalizePublicSlug(input.publicSlug)
        : null
      : current.publicSlug;
  run(
    database,
    `UPDATE calendars SET title = ?, color = ?, is_public = ?, public_slug = ?, updated_at = ? WHERE id = ?`,
    title,
    color,
    (input.isPublic ?? boolFromSql(current.isPublic)) ? 1 : 0,
    publicSlug,
    nowIso(),
    calendarId,
  );
  return listVisibleCalendars(database, userId).find(
    (calendar) => calendar.id === calendarId,
  ) as RpcCalendar;
}

export function deleteCalendar(
  database: Database,
  userId: number,
  calendarId: number,
): void {
  assertCalendarOwner(database, calendarId, userId);
  run(
    database,
    `UPDATE calendars SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    calendarId,
  );
  cancelCalendarNotifications(database, calendarId);
}

export function leaveSharedCalendar(
  _database: Database,
  _userId: number,
  _calendarId: number,
): void {
  throw new Error("Calendar sharing is no longer supported.");
}

export function setCalendarShare(
  _database: Database,
  _ownerUserId: number,
  _calendarId: number,
  _targetUserId: number,
  _permission: CalendarSharePermission | null,
): RpcCalendarShare[] {
  return [];
}

export function updateCalendarPreference(
  database: Database,
  userId: number,
  calendarId: number,
  input: {
    visible?: boolean | null;
    colorOverride?: string | null;
    notificationsEnabled?: boolean | null;
    notificationChannels?: CalendarNotificationChannel[] | null;
  },
): RpcCalendar {
  assertCalendarReadable(database, calendarId, userId);
  const current = database
    .query<
      {
        visible: 0 | 1;
        colorOverride: string | null;
        notificationsEnabled: 0 | 1;
        notificationChannelsJson: string;
      },
      [number]
    >(
      `
        SELECT visible, color_override AS colorOverride, notifications_enabled AS notificationsEnabled, notification_channels_json AS notificationChannelsJson
        FROM calendar_user_preferences
        WHERE calendar_id = ?
      `,
    )
    .get(calendarId);
  upsertCalendarPreference(database, userId, calendarId, {
    visible: input.visible ?? (current ? boolFromSql(current.visible) : true),
    colorOverride:
      input.colorOverride !== undefined
        ? input.colorOverride
        : (current?.colorOverride ?? null),
    notificationsEnabled:
      input.notificationsEnabled ??
      (current ? boolFromSql(current.notificationsEnabled) : false),
    notificationChannels:
      input.notificationChannels ??
      normalizeChannels(current?.notificationChannelsJson),
  });
  run(
    database,
    `DELETE FROM calendar_reminder_deliveries WHERE source_type = 'local' AND calendar_id = ?`,
    calendarId,
  );
  return listVisibleCalendars(database, userId).find(
    (calendar) => calendar.id === calendarId,
  ) as RpcCalendar;
}

function validateEventInput(
  input: CalendarEventInput,
): Required<CalendarEventInput> {
  const allDay = input.allDay === true;
  const title = normalizeText(input.title) || "Untitled event";
  const timezone = normalizeText(input.timezone) || "UTC";
  if (allDay) {
    if (!input.startDate || !input.endDate) {
      throw new Error("All-day events require startDate and endDate.");
    }
    const startMs = parseStrictCalendarDate(input.startDate, "startDate");
    const endMs = parseStrictCalendarDate(input.endDate, "endDate");
    if (endMs <= startMs) {
      throw new Error("All-day events require endDate after startDate.");
    }
  } else if (!input.startAt || !input.endAt) {
    throw new Error("Timed events require startAt and endAt.");
  } else {
    const startMs = new Date(input.startAt).getTime();
    const endMs = new Date(input.endAt).getTime();
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      throw new Error("Timed events require endAt after startAt.");
    }
  }
  const recurrenceRule = validateRRuleString(input.recurrenceRule);
  return {
    calendarId: input.calendarId,
    title,
    description: input.description ?? "",
    location: input.location ?? "",
    startAt: allDay ? null : (input.startAt ?? null),
    endAt: allDay ? null : (input.endAt ?? null),
    startDate: allDay ? (input.startDate ?? null) : null,
    endDate: allDay ? (input.endDate ?? null) : null,
    allDay,
    timezone,
    recurrenceRule,
    reminders: normalizeReminders(
      input.reminders ?? [{ minutesBefore: DEFAULT_REMINDER_MINUTES }],
    ),
  };
}

export function createCalendarEvent(
  database: Database,
  userId: number,
  input: CalendarEventInput,
): RpcCalendarEvent {
  assertCalendarWritable(database, input.calendarId, userId);
  const event = validateEventInput(input);
  run(
    database,
    `
      INSERT INTO calendar_events (
        calendar_id, title, description, location, start_at, end_at, start_date, end_date,
        all_day, timezone, recurrence_rule
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    event.calendarId,
    event.title,
    event.description,
    event.location,
    event.startAt,
    event.endAt,
    event.startDate,
    event.endDate,
    event.allDay ? 1 : 0,
    event.timezone,
    event.recurrenceRule,
  );
  const id = Number(
    database.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()
      ?.id ?? 0,
  );
  replaceEventReminders(database, id, event.reminders ?? []);
  return getCalendarEvent(database, userId, id) as RpcCalendarEvent;
}

function deleteLocalEventNotificationDeliveries(
  database: Database,
  eventId: number,
  occurrenceStart?: string | null,
): void {
  if (occurrenceStart) {
    run(
      database,
      `DELETE FROM calendar_reminder_deliveries WHERE source_type = 'local' AND event_id = ? AND occurrence_start = ?`,
      String(eventId),
      occurrenceStart,
    );
    return;
  }
  run(
    database,
    `DELETE FROM calendar_reminder_deliveries WHERE source_type = 'local' AND event_id = ?`,
    String(eventId),
  );
}

function replaceEventReminders(
  database: Database,
  eventId: number,
  reminders: CalendarReminderInput[],
): void {
  run(
    database,
    `DELETE FROM calendar_event_reminders WHERE event_id = ?`,
    eventId,
  );
  for (const reminder of normalizeReminders(reminders)) {
    run(
      database,
      `INSERT INTO calendar_event_reminders (event_id, minutes_before) VALUES (?, ?)`,
      eventId,
      reminder.minutesBefore,
    );
  }
}

type EventSqlRow = {
  id: number;
  calendarId: number;
  title: string;
  description: string;
  location: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: 0 | 1;
  timezone: string;
  recurrenceRule: string | null;
  createdByUserId: number;
  createdByUsername: string;
  updatedByUserId: number;
  updatedByUsername: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

function eventReminders(
  database: Database,
  eventId: number,
): CalendarReminderInput[] {
  return database
    .query<{ id: number; minutesBefore: number }, [number]>(
      `SELECT id, minutes_before AS minutesBefore FROM calendar_event_reminders WHERE event_id = ? ORDER BY minutes_before ASC, id ASC`,
    )
    .all(eventId);
}

function hydrateEvent(database: Database, row: EventSqlRow): RpcCalendarEvent {
  return {
    id: row.id,
    calendarId: row.calendarId,
    sourceType: "local",
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.startAt,
    endAt: row.endAt,
    startDate: row.startDate,
    endDate: row.endDate,
    allDay: boolFromSql(row.allDay),
    timezone: row.timezone,
    recurrenceRule: row.recurrenceRule,
    recurrenceSummary: summarizeRecurrence(row.recurrenceRule),
    reminders: eventReminders(database, row.id),
    createdByUserId: row.createdByUserId,
    createdByUsername: row.createdByUsername,
    updatedByUserId: row.updatedByUserId,
    updatedByUsername: row.updatedByUsername,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function getCalendarEvent(
  database: Database,
  userId: number,
  eventId: number,
): RpcCalendarEvent | null {
  const row = database
    .query<EventSqlRow, [number]>(
      `
        SELECT
          calendar_events.id AS id,
          calendar_events.calendar_id AS calendarId,
          calendar_events.title AS title,
          calendar_events.description AS description,
          calendar_events.location AS location,
          calendar_events.start_at AS startAt,
          calendar_events.end_at AS endAt,
          calendar_events.start_date AS startDate,
          calendar_events.end_date AS endDate,
          calendar_events.all_day AS allDay,
          calendar_events.timezone AS timezone,
          calendar_events.recurrence_rule AS recurrenceRule,
          1 AS createdByUserId,
          'Local Operator' AS createdByUsername,
          1 AS updatedByUserId,
          'Local Operator' AS updatedByUsername,
          calendar_events.version AS version,
          calendar_events.created_at AS createdAt,
          calendar_events.updated_at AS updatedAt,
          calendar_events.deleted_at AS deletedAt
        FROM calendar_events
        WHERE calendar_events.id = ? AND calendar_events.deleted_at IS NULL
      `,
    )
    .get(eventId);
  if (!row) {
    return null;
  }
  assertCalendarReadable(database, row.calendarId, userId);
  return hydrateEvent(database, row);
}

function currentEventRow(database: Database, eventId: number): EventSqlRow {
  const row = database
    .query<EventSqlRow, [number]>(
      `
        SELECT
          calendar_events.id AS id,
          calendar_events.calendar_id AS calendarId,
          calendar_events.title AS title,
          calendar_events.description AS description,
          calendar_events.location AS location,
          calendar_events.start_at AS startAt,
          calendar_events.end_at AS endAt,
          calendar_events.start_date AS startDate,
          calendar_events.end_date AS endDate,
          calendar_events.all_day AS allDay,
          calendar_events.timezone AS timezone,
          calendar_events.recurrence_rule AS recurrenceRule,
          1 AS createdByUserId,
          'Local Operator' AS createdByUsername,
          1 AS updatedByUserId,
          'Local Operator' AS updatedByUsername,
          calendar_events.version AS version,
          calendar_events.created_at AS createdAt,
          calendar_events.updated_at AS updatedAt,
          calendar_events.deleted_at AS deletedAt
        FROM calendar_events
        WHERE calendar_events.id = ? AND calendar_events.deleted_at IS NULL
      `,
    )
    .get(eventId);
  if (!row) {
    throw new Error("Event not found.");
  }
  return row;
}

function assertVersion(
  row: EventSqlRow,
  expectedVersion: number | null | undefined,
): void {
  if (typeof expectedVersion === "number" && row.version !== expectedVersion) {
    throw Object.assign(new Error("Event changed"), {
      code: "calendar_conflict",
    });
  }
}

function expandRowOccurrences(
  row: EventSqlRow,
  windowStartIso: string,
  windowEndIso: string,
  exdates: string[] = [],
  options: { maxOccurrences?: number | null } = {},
) {
  return expandCalendarOccurrences(
    {
      eventId: row.id,
      startAt: row.startAt,
      endAt: row.endAt,
      startDate: row.startDate,
      endDate: row.endDate,
      allDay: boolFromSql(row.allDay),
      recurrenceRule: row.recurrenceRule,
      exdates,
      timezone: row.timezone,
    },
    windowStartIso,
    windowEndIso,
    options,
  );
}

function findOccurrenceTimeForStart(row: EventSqlRow, occurrenceStart: string) {
  if (!row.recurrenceRule) {
    const base = boolFromSql(row.allDay)
      ? new Date(`${row.startDate ?? occurrenceStart}T00:00:00.000Z`)
      : new Date(row.startAt ?? occurrenceStart);
    if (Number.isNaN(base.getTime())) {
      return null;
    }
    return expandRowOccurrences(
      row,
      new Date(base.getTime() - 24 * 60 * 60_000).toISOString(),
      new Date(base.getTime() + 24 * 60 * 60_000).toISOString(),
    )[0];
  }
  const center = boolFromSql(row.allDay)
    ? new Date(`${occurrenceStart}T00:00:00.000Z`)
    : new Date(occurrenceStart);
  if (Number.isNaN(center.getTime())) {
    return null;
  }
  const windowStart = new Date(center.getTime() - 2 * 24 * 60 * 60_000);
  const windowEnd = new Date(center.getTime() + 2 * 24 * 60 * 60_000);
  return (
    expandRowOccurrences(
      row,
      windowStart.toISOString(),
      windowEnd.toISOString(),
    ).find((item) => item.originalStart === occurrenceStart) ?? null
  );
}

export function updateCalendarEvent(
  database: Database,
  userId: number,
  input: CalendarEventUpdateInput,
): RpcCalendarEvent {
  const row = currentEventRow(database, input.eventId);
  assertCalendarWritable(database, row.calendarId, userId);
  assertVersion(row, input.expectedVersion);
  const scope = input.scope ?? "whole_series";
  const occurrenceStart =
    input.occurrenceStart ?? row.startAt ?? row.startDate ?? "";
  if (scope === "just_this") {
    const selected = findOccurrenceTimeForStart(row, occurrenceStart);
    if (!selected) {
      throw new Error("Occurrence not found for update.");
    }
    createOrUpdateOccurrenceOverride(
      database,
      userId,
      row,
      input,
      occurrenceStart,
      selected,
    );
    run(
      database,
      `INSERT OR IGNORE INTO calendar_event_exdates (event_id, original_start) VALUES (?, ?)`,
      row.id,
      occurrenceStart,
    );
    deleteLocalEventNotificationDeliveries(database, row.id, occurrenceStart);
    return getCalendarEvent(database, userId, row.id) as RpcCalendarEvent;
  }
  if (scope === "after_this" && row.recurrenceRule) {
    const selected = findOccurrenceTimeForStart(row, occurrenceStart);
    if (!selected) {
      throw new Error("Occurrence not found for split.");
    }
    const truncated = truncateRRuleBeforeOccurrence(
      row.recurrenceRule,
      occurrenceStart,
      boolFromSql(row.allDay),
    );
    run(
      database,
      `UPDATE calendar_events SET recurrence_rule = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      truncated,
      nowIso(),
      row.id,
    );
    deleteLocalEventNotificationDeliveries(database, row.id);
    const adjustedFutureRule =
      input.recurrenceRule === undefined
        ? adjustRRuleCountAfterSplit(
            row.recurrenceRule,
            row.startAt ?? row.startDate ?? occurrenceStart,
            occurrenceStart,
            boolFromSql(row.allDay),
          )
        : input.recurrenceRule;
    if (input.recurrenceRule === undefined && adjustedFutureRule === null) {
      return getCalendarEvent(database, userId, row.id) as RpcCalendarEvent;
    }
    const newInput: CalendarEventInput = {
      calendarId: row.calendarId,
      title: input.title ?? row.title,
      description: input.description ?? row.description,
      location: input.location ?? row.location,
      startAt: input.startAt ?? selected.startAt,
      endAt: input.endAt ?? selected.endAt,
      startDate: input.startDate ?? selected.startDate,
      endDate: input.endDate ?? selected.endDate,
      allDay: input.allDay ?? boolFromSql(row.allDay),
      timezone: input.timezone ?? row.timezone,
      recurrenceRule: adjustedFutureRule,
      reminders: input.reminders ?? eventReminders(database, row.id),
    };
    return createCalendarEvent(database, userId, newInput);
  }
  const next: CalendarEventInput = {
    calendarId: input.calendarId ?? row.calendarId,
    title: input.title ?? row.title,
    description: input.description ?? row.description,
    location: input.location ?? row.location,
    startAt: input.startAt ?? row.startAt,
    endAt: input.endAt ?? row.endAt,
    startDate: input.startDate ?? row.startDate,
    endDate: input.endDate ?? row.endDate,
    allDay: input.allDay ?? boolFromSql(row.allDay),
    timezone: input.timezone ?? row.timezone,
    recurrenceRule:
      input.recurrenceRule === undefined
        ? row.recurrenceRule
        : input.recurrenceRule,
    reminders: input.reminders ?? eventReminders(database, row.id),
  };
  const normalized = validateEventInput(next);
  if (normalized.calendarId !== row.calendarId) {
    assertCalendarWritable(database, normalized.calendarId, userId);
  }
  deleteLocalEventNotificationDeliveries(database, row.id);
  run(
    database,
    `
      UPDATE calendar_events
      SET calendar_id = ?, title = ?, description = ?, location = ?, start_at = ?, end_at = ?, start_date = ?, end_date = ?,
        all_day = ?, timezone = ?, recurrence_rule = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `,
    normalized.calendarId,
    normalized.title,
    normalized.description,
    normalized.location,
    normalized.startAt,
    normalized.endAt,
    normalized.startDate,
    normalized.endDate,
    normalized.allDay ? 1 : 0,
    normalized.timezone,
    normalized.recurrenceRule,
    nowIso(),
    row.id,
  );
  replaceEventReminders(database, row.id, normalized.reminders ?? []);
  return getCalendarEvent(database, userId, row.id) as RpcCalendarEvent;
}

function createOrUpdateOccurrenceOverride(
  database: Database,
  _userId: number,
  row: EventSqlRow,
  input: CalendarEventUpdateInput,
  originalStart: string,
  selected: ReturnType<typeof findOccurrenceTimeForStart>,
): void {
  const normalized = validateEventInput({
    calendarId: row.calendarId,
    title: input.title ?? row.title,
    description: input.description ?? row.description,
    location: input.location ?? row.location,
    startAt: input.startAt ?? selected?.startAt ?? row.startAt,
    endAt: input.endAt ?? selected?.endAt ?? row.endAt,
    startDate: input.startDate ?? selected?.startDate ?? row.startDate,
    endDate: input.endDate ?? selected?.endDate ?? row.endDate,
    allDay: input.allDay ?? boolFromSql(row.allDay),
    timezone: input.timezone ?? row.timezone,
    recurrenceRule: row.recurrenceRule,
    reminders: [],
  });
  run(
    database,
    `
      INSERT INTO calendar_event_overrides (
        event_id, original_start, title, description, location, start_at, end_at, start_date, end_date, all_day, timezone,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(event_id, original_start) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        location = excluded.location,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        all_day = excluded.all_day,
        timezone = excluded.timezone,
        version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `,
    row.id,
    originalStart,
    normalized.title,
    normalized.description,
    normalized.location,
    normalized.startAt,
    normalized.endAt,
    normalized.startDate,
    normalized.endDate,
    normalized.allDay ? 1 : 0,
    normalized.timezone,
  );
}

export function deleteCalendarEvent(
  database: Database,
  userId: number,
  eventId: number,
  input: {
    scope?: CalendarReminderScope | null;
    occurrenceStart?: string | null;
    expectedVersion?: number | null;
  } = {},
): void {
  const row = currentEventRow(database, eventId);
  assertCalendarWritable(database, row.calendarId, userId);
  assertVersion(row, input.expectedVersion);
  const scope = input.scope ?? "whole_series";
  const occurrenceStart =
    input.occurrenceStart ?? row.startAt ?? row.startDate ?? "";
  if (scope === "just_this" && row.recurrenceRule) {
    run(
      database,
      `INSERT OR IGNORE INTO calendar_event_exdates (event_id, original_start) VALUES (?, ?)`,
      row.id,
      occurrenceStart,
    );
    deleteLocalEventNotificationDeliveries(database, row.id, occurrenceStart);
    return;
  }
  if (scope === "after_this" && row.recurrenceRule) {
    const truncated = truncateRRuleBeforeOccurrence(
      row.recurrenceRule,
      occurrenceStart,
      boolFromSql(row.allDay),
    );
    run(
      database,
      `UPDATE calendar_events SET recurrence_rule = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      truncated,
      nowIso(),
      row.id,
    );
    deleteLocalEventNotificationDeliveries(database, row.id);
    return;
  }
  deleteLocalEventNotificationDeliveries(database, row.id);
  run(
    database,
    `UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    eventId,
  );
}

function listEventExdates(database: Database, eventId: number): string[] {
  return database
    .query<{ originalStart: string }, [number]>(
      `SELECT original_start AS originalStart FROM calendar_event_exdates WHERE event_id = ?`,
    )
    .all(eventId)
    .map((row) => row.originalStart);
}

type OverrideRow = {
  originalStart: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: 0 | 1 | null;
  timezone: string | null;
  version: number;
};

function listEventOverrides(
  database: Database,
  eventId: number,
): Map<string, OverrideRow> {
  return new Map(
    database
      .query<OverrideRow, [number]>(
        `SELECT original_start AS originalStart, title, description, location, start_at AS startAt, end_at AS endAt, start_date AS startDate, end_date AS endDate, all_day AS allDay, timezone, version FROM calendar_event_overrides WHERE event_id = ?`,
      )
      .all(eventId)
      .map((row) => [row.originalStart, row]),
  );
}

function localOverrideToOccurrence(
  row: EventSqlRow,
  calendar: RpcCalendar,
  override: OverrideRow,
  reminders: CalendarReminderInput[],
  windowStartIso: string,
  windowEndIso: string,
): RpcCalendarOccurrence | null {
  const allDay =
    override.allDay === null || override.allDay === undefined
      ? boolFromSql(row.allDay)
      : boolFromSql(override.allDay);
  const startAt = allDay ? null : override.startAt;
  const endAt = allDay ? null : (override.endAt ?? override.startAt);
  const startDate = allDay ? override.startDate : null;
  const endDate = allDay ? (override.endDate ?? override.startDate) : null;
  if ((!allDay && !startAt) || (allDay && !startDate)) {
    return null;
  }
  const comparableStart = allDay
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(startAt as string);
  const comparableEnd = allDay
    ? new Date(`${endDate ?? startDate}T00:00:00.000Z`)
    : new Date((endAt ?? startAt) as string);
  const windowStart = new Date(windowStartIso);
  const windowEnd = new Date(windowEndIso);
  if (!(comparableEnd > windowStart && comparableStart < windowEnd)) {
    return null;
  }
  return {
    occurrenceId: `local:${row.id}:${override.originalStart}`,
    sourceType: "local",
    calendarId: row.calendarId,
    eventId: row.id,
    title: override.title ?? row.title,
    description: override.description ?? row.description,
    location: override.location ?? row.location,
    startAt,
    endAt,
    startDate,
    endDate,
    allDay,
    timezone: override.timezone ?? row.timezone,
    color: calendar.effectiveColor,
    permission: calendar.permission,
    writable: permissionCanWrite(calendar.permission),
    isRecurring: Boolean(row.recurrenceRule),
    recurrenceRule: row.recurrenceRule,
    recurrenceSummary: summarizeRecurrence(row.recurrenceRule),
    originalStart: override.originalStart,
    externalUrl: null,
    createdByUserId: row.createdByUserId,
    createdByUsername: row.createdByUsername,
    version: override.version,
    deletedAt: row.deletedAt,
    reminders,
  };
}

export function listCalendarOccurrences(
  database: Database,
  userId: number,
  windowStartIso: string,
  windowEndIso: string,
  options: { maxOccurrences?: number | null } = {},
): RpcCalendarOccurrence[] {
  const calendars = listVisibleCalendars(database, userId).filter(
    (calendar) => calendar.visible,
  );
  const calendarById = new Map(
    calendars.map((calendar) => [calendar.id, calendar]),
  );
  const calendarIds = calendars.map((calendar) => calendar.id);
  const localOccurrences: RpcCalendarOccurrence[] = [];
  if (calendarIds.length > 0) {
    const rows = database
      .query<EventSqlRow, SQLQueryBindings[]>(
        `
          SELECT
            calendar_events.id AS id,
            calendar_events.calendar_id AS calendarId,
            calendar_events.title AS title,
            calendar_events.description AS description,
            calendar_events.location AS location,
            calendar_events.start_at AS startAt,
            calendar_events.end_at AS endAt,
            calendar_events.start_date AS startDate,
            calendar_events.end_date AS endDate,
            calendar_events.all_day AS allDay,
            calendar_events.timezone AS timezone,
            calendar_events.recurrence_rule AS recurrenceRule,
            1 AS createdByUserId,
            'Local Operator' AS createdByUsername,
            1 AS updatedByUserId,
            'Local Operator' AS updatedByUsername,
            calendar_events.version AS version,
            calendar_events.created_at AS createdAt,
            calendar_events.updated_at AS updatedAt,
            calendar_events.deleted_at AS deletedAt
          FROM calendar_events
          WHERE calendar_events.deleted_at IS NULL
            AND calendar_events.calendar_id IN (${calendarIds.map(() => "?").join(",")})
        `,
      )
      .all(...calendarIds);
    for (const row of rows) {
      const calendar = calendarById.get(row.calendarId);
      if (!calendar) {
        continue;
      }
      const overrides = listEventOverrides(database, row.id);
      const reminders = eventReminders(database, row.id);
      const renderedOverrideOriginalStarts = new Set<string>();
      const occurrenceTimes = expandRowOccurrences(
        row,
        windowStartIso,
        windowEndIso,
        listEventExdates(database, row.id),
        {
          maxOccurrences:
            options.maxOccurrences === null ||
            options.maxOccurrences === undefined
              ? null
              : Math.max(options.maxOccurrences - localOccurrences.length, 0),
        },
      );
      assertCalendarOccurrenceLimit(
        localOccurrences.length + occurrenceTimes.length,
        options.maxOccurrences,
      );
      for (const time of occurrenceTimes) {
        const override = overrides.get(time.originalStart);
        if (override) {
          renderedOverrideOriginalStarts.add(time.originalStart);
        }
        const allDay =
          override?.allDay === null || override?.allDay === undefined
            ? boolFromSql(row.allDay)
            : boolFromSql(override.allDay);
        localOccurrences.push({
          occurrenceId: `local:${row.id}:${time.originalStart}`,
          sourceType: "local",
          calendarId: row.calendarId,
          eventId: row.id,
          title: override?.title ?? row.title,
          description: override?.description ?? row.description,
          location: override?.location ?? row.location,
          startAt: allDay ? null : (override?.startAt ?? time.startAt),
          endAt: allDay ? null : (override?.endAt ?? time.endAt),
          startDate: allDay ? (override?.startDate ?? time.startDate) : null,
          endDate: allDay ? (override?.endDate ?? time.endDate) : null,
          allDay,
          timezone: override?.timezone ?? row.timezone,
          color: calendar.effectiveColor,
          permission: calendar.permission,
          writable: permissionCanWrite(calendar.permission),
          isRecurring: Boolean(row.recurrenceRule),
          recurrenceRule: row.recurrenceRule,
          recurrenceSummary: summarizeRecurrence(row.recurrenceRule),
          originalStart: time.originalStart,
          externalUrl: null,
          createdByUserId: row.createdByUserId,
          createdByUsername: row.createdByUsername,
          version: override?.version ?? row.version,
          deletedAt: row.deletedAt,
          reminders,
        });
      }
      for (const override of overrides.values()) {
        if (renderedOverrideOriginalStarts.has(override.originalStart)) {
          continue;
        }
        const occurrence = localOverrideToOccurrence(
          row,
          calendar,
          override,
          reminders,
          windowStartIso,
          windowEndIso,
        );
        if (occurrence) {
          localOccurrences.push(occurrence);
          assertCalendarOccurrenceLimit(
            localOccurrences.length,
            options.maxOccurrences,
          );
        }
      }
    }
  }
  const externalOccurrences = listExternalOccurrences(
    database,
    userId,
    windowStartIso,
    windowEndIso,
    options.maxOccurrences === null || options.maxOccurrences === undefined
      ? undefined
      : Math.max(options.maxOccurrences - localOccurrences.length, 0),
  );
  const occurrences = [...localOccurrences, ...externalOccurrences];
  assertCalendarOccurrenceLimit(occurrences.length, options.maxOccurrences);
  return occurrences.sort((left, right) => {
    const leftStart = left.startAt ?? `${left.startDate}T00:00:00.000Z`;
    const rightStart = right.startAt ?? `${right.startDate}T00:00:00.000Z`;
    return (
      leftStart.localeCompare(rightStart) ||
      left.title.localeCompare(right.title)
    );
  });
}

type ExternalCalendarSqlRow = {
  id: number;
  ownerUserId: number;
  title: string;
  url: string;
  color: string;
  visible: 0 | 1;
  enabled: 0 | 1;
  notificationsEnabled: 0 | 1;
  notificationMode: "source" | "default";
  refreshIntervalMinutes: number;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
};

function hydrateExternalCalendar(
  row: ExternalCalendarSqlRow,
): RpcExternalIcsCalendar {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    sourceType: "external_ics",
    title: row.title,
    url: row.url,
    color: row.color,
    visible: boolFromSql(row.visible),
    enabled: boolFromSql(row.enabled),
    notificationsEnabled: boolFromSql(row.notificationsEnabled),
    notificationMode: row.notificationMode,
    refreshIntervalMinutes: row.refreshIntervalMinutes,
    lastFetchedAt: row.lastFetchedAt,
    lastSuccessAt: row.lastSuccessAt,
    lastErrorAt: row.lastErrorAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listExternalCalendars(
  database: Database,
  _userId: number,
): RpcExternalIcsCalendar[] {
  return database
    .query<ExternalCalendarSqlRow, []>(
      `
        SELECT id, 1 AS ownerUserId, title, url, color, visible, enabled,
          notifications_enabled AS notificationsEnabled, notification_mode AS notificationMode,
          refresh_interval_minutes AS refreshIntervalMinutes, last_fetched_at AS lastFetchedAt,
          last_success_at AS lastSuccessAt, last_error_at AS lastErrorAt, last_error AS lastError,
          consecutive_failures AS consecutiveFailures, created_at AS createdAt, updated_at AS updatedAt
        FROM external_ics_calendars
        ORDER BY LOWER(title) ASC, id ASC
      `,
    )
    .all()
    .map(hydrateExternalCalendar);
}

export function createExternalCalendar(
  database: Database,
  userId: number,
  input: { title: string; url: string; color?: string | null },
): RpcExternalIcsCalendar {
  const title = normalizeText(input.title) || "External calendar";
  const url = normalizeExternalIcsUrl(input.url);
  run(
    database,
    `INSERT INTO external_ics_calendars (id, title, url, color, refresh_interval_minutes) VALUES (?, ?, ?, ?, ?)`,
    allocateCalendarId(database),
    title,
    url,
    normalizeText(input.color) || DEFAULT_EXTERNAL_CALENDAR_COLOR,
    DEFAULT_EXTERNAL_ICS_REFRESH_INTERVAL_MINUTES,
  );
  const id = Number(
    database.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()
      ?.id ?? 0,
  );
  return listExternalCalendars(database, userId).find(
    (calendar) => calendar.id === id,
  ) as RpcExternalIcsCalendar;
}

export function updateExternalCalendar(
  database: Database,
  userId: number,
  externalCalendarId: number,
  input: Partial<
    Pick<
      RpcExternalIcsCalendar,
      | "title"
      | "url"
      | "color"
      | "visible"
      | "enabled"
      | "notificationsEnabled"
      | "notificationMode"
      | "refreshIntervalMinutes"
    >
  >,
): RpcExternalIcsCalendar {
  const current = database
    .query<ExternalCalendarSqlRow, [number]>(
      `SELECT id, 1 AS ownerUserId, title, url, color, visible, enabled, notifications_enabled AS notificationsEnabled, notification_mode AS notificationMode, refresh_interval_minutes AS refreshIntervalMinutes, last_fetched_at AS lastFetchedAt, last_success_at AS lastSuccessAt, last_error_at AS lastErrorAt, last_error AS lastError, consecutive_failures AS consecutiveFailures, created_at AS createdAt, updated_at AS updatedAt FROM external_ics_calendars WHERE id = ?`,
    )
    .get(externalCalendarId);
  if (!current) {
    throw new Error("External calendar not found.");
  }
  const url =
    input.url !== undefined ? normalizeExternalIcsUrl(input.url) : current.url;
  const refreshIntervalMinutes =
    input.refreshIntervalMinutes !== undefined
      ? Math.max(5, Math.round(input.refreshIntervalMinutes))
      : current.refreshIntervalMinutes;
  run(
    database,
    `UPDATE external_ics_calendars SET title = ?, url = ?, color = ?, visible = ?, enabled = ?, notifications_enabled = ?, notification_mode = ?, refresh_interval_minutes = ?, updated_at = ? WHERE id = ?`,
    input.title !== undefined
      ? normalizeText(input.title) || current.title
      : current.title,
    url,
    input.color !== undefined
      ? normalizeText(input.color) || current.color
      : current.color,
    (input.visible ?? boolFromSql(current.visible)) ? 1 : 0,
    (input.enabled ?? boolFromSql(current.enabled)) ? 1 : 0,
    (input.notificationsEnabled ?? boolFromSql(current.notificationsEnabled))
      ? 1
      : 0,
    input.notificationMode ?? current.notificationMode,
    refreshIntervalMinutes,
    nowIso(),
    externalCalendarId,
  );
  run(
    database,
    `DELETE FROM calendar_reminder_deliveries WHERE source_type = 'external_ics' AND calendar_id = ?`,
    externalCalendarId,
  );
  return listExternalCalendars(database, userId).find(
    (calendar) => calendar.id === externalCalendarId,
  ) as RpcExternalIcsCalendar;
}

export function deleteExternalCalendar(
  database: Database,
  _userId: number,
  externalCalendarId: number,
): void {
  const existing = database
    .query<{ id: number }, [number]>(
      `SELECT id FROM external_ics_calendars WHERE id = ?`,
    )
    .get(externalCalendarId);
  if (!existing) {
    throw new Error("External calendar not found.");
  }
  run(
    database,
    `DELETE FROM calendar_reminder_deliveries WHERE source_type = 'external_ics' AND calendar_id = ?`,
    externalCalendarId,
  );
  run(
    database,
    `DELETE FROM external_ics_calendars WHERE id = ?`,
    externalCalendarId,
  );
}

export function replaceExternalCalendarCache(
  database: Database,
  externalCalendarId: number,
  events: Array<{
    uid: string;
    recurrenceId?: string | null;
    title: string;
    description?: string | null;
    location?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    allDay?: boolean;
    timezone?: string | null;
    recurrenceRule?: string | null;
    exdates?: string[] | null;
    reminders?: CalendarReminderInput[] | null;
    url?: string | null;
    rawJson?: string | null;
  }>,
  cacheHeaders: { etag?: string | null; lastModified?: string | null } = {},
): void {
  run(
    database,
    `DELETE FROM calendar_reminder_deliveries WHERE source_type = 'external_ics' AND calendar_id = ?`,
    externalCalendarId,
  );
  run(
    database,
    `DELETE FROM external_ics_event_cache WHERE external_calendar_id = ?`,
    externalCalendarId,
  );
  for (const event of events) {
    run(
      database,
      `
        INSERT INTO external_ics_event_cache (
          external_calendar_id, uid, recurrence_id, title, description, location, start_at, end_at, start_date, end_date,
          all_day, timezone, recurrence_rule, exdates_json, reminders_json, url, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      externalCalendarId,
      event.uid,
      event.recurrenceId ?? null,
      event.title,
      event.description ?? "",
      event.location ?? "",
      event.startAt ?? null,
      event.endAt ?? null,
      event.startDate ?? null,
      event.endDate ?? null,
      event.allDay ? 1 : 0,
      event.timezone ?? "UTC",
      validateRRuleString(event.recurrenceRule) ?? null,
      JSON.stringify(event.exdates ?? []),
      serializeReminders(event.reminders ?? []),
      event.url ?? null,
      event.rawJson ?? null,
    );
  }
  run(
    database,
    `
      UPDATE external_ics_calendars
      SET etag = ?, last_modified = ?, last_fetched_at = ?, last_success_at = ?, last_error_at = NULL, last_error = NULL, consecutive_failures = 0, updated_at = ?
      WHERE id = ?
    `,
    cacheHeaders.etag ?? null,
    cacheHeaders.lastModified ?? null,
    nowIso(),
    nowIso(),
    nowIso(),
    externalCalendarId,
  );
}

export function markExternalCalendarFetchError(
  database: Database,
  externalCalendarId: number,
  error: string,
): void {
  run(
    database,
    `UPDATE external_ics_calendars SET last_fetched_at = ?, last_error_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    error,
    nowIso(),
    externalCalendarId,
  );
}

function listExternalOccurrences(
  database: Database,
  userId: number,
  windowStartIso: string,
  windowEndIso: string,
  maxOccurrences?: number,
): RpcCalendarOccurrence[] {
  const calendars = listExternalCalendars(database, userId).filter(
    (calendar) => calendar.enabled && calendar.visible,
  );
  const calendarById = new Map(
    calendars.map((calendar) => [calendar.id, calendar]),
  );
  if (calendars.length === 0) {
    return [];
  }
  const ids = calendars.map((calendar) => calendar.id);
  const rows = database
    .query<
      {
        id: number;
        externalCalendarId: number;
        uid: string;
        recurrenceId: string | null;
        title: string;
        description: string;
        location: string;
        startAt: string | null;
        endAt: string | null;
        startDate: string | null;
        endDate: string | null;
        allDay: 0 | 1;
        timezone: string;
        recurrenceRule: string | null;
        exdatesJson: string;
        remindersJson: string;
        url: string | null;
      },
      SQLQueryBindings[]
    >(
      `
        SELECT id, external_calendar_id AS externalCalendarId, uid, recurrence_id AS recurrenceId, title, description, location,
          start_at AS startAt, end_at AS endAt, start_date AS startDate, end_date AS endDate,
          all_day AS allDay, timezone, recurrence_rule AS recurrenceRule, exdates_json AS exdatesJson, reminders_json AS remindersJson, url
        FROM external_ics_event_cache
        WHERE external_calendar_id IN (${ids.map(() => "?").join(",")})
      `,
    )
    .all(...ids);
  const overrideOriginalStartsByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.recurrenceId) {
      continue;
    }
    const key = `${row.externalCalendarId}\0${row.uid}`;
    const set = overrideOriginalStartsByKey.get(key) ?? new Set<string>();
    set.add(row.recurrenceId);
    overrideOriginalStartsByKey.set(key, set);
  }
  const occurrences: RpcCalendarOccurrence[] = [];
  for (const row of rows) {
    const calendar = calendarById.get(row.externalCalendarId);
    if (!calendar) {
      continue;
    }
    const exdates = (() => {
      try {
        const parsed = JSON.parse(row.exdatesJson) as unknown;
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === "string")
          : [];
      } catch {
        return [];
      }
    })();
    const overrideExdates = row.recurrenceId
      ? []
      : [
          ...(overrideOriginalStartsByKey.get(
            `${row.externalCalendarId}\0${row.uid}`,
          ) ?? []),
        ];
    const reminders = parseRemindersJson(row.remindersJson);
    const times = expandCalendarOccurrences(
      {
        eventId: row.id,
        startAt: row.startAt,
        endAt: row.endAt,
        startDate: row.startDate,
        endDate: row.endDate,
        allDay: boolFromSql(row.allDay),
        recurrenceRule: row.recurrenceRule,
        exdates: [...exdates, ...overrideExdates],
        timezone: row.timezone,
      },
      windowStartIso,
      windowEndIso,
      {
        maxOccurrences: Math.max(
          (maxOccurrences ?? Number.MAX_SAFE_INTEGER) - occurrences.length,
          0,
        ),
      },
    );
    assertCalendarOccurrenceLimit(
      occurrences.length + times.length,
      maxOccurrences,
    );
    for (const time of times) {
      const originalStart = row.recurrenceId ?? time.originalStart;
      occurrences.push({
        occurrenceId: `external_ics:${row.externalCalendarId}:${row.uid}:${row.recurrenceId ?? time.originalStart}:${time.originalStart}`,
        sourceType: "external_ics",
        calendarId: row.externalCalendarId,
        eventId: row.uid,
        title: row.title,
        description: row.description,
        location: row.location,
        startAt: time.startAt,
        endAt: time.endAt,
        startDate: time.startDate,
        endDate: time.endDate,
        allDay: boolFromSql(row.allDay),
        timezone: row.timezone,
        color: calendar.color,
        permission: "read",
        writable: false,
        isRecurring: Boolean(row.recurrenceRule),
        recurrenceRule: row.recurrenceRule,
        recurrenceSummary: summarizeRecurrence(row.recurrenceRule),
        originalStart,
        externalUrl: row.url,
        createdByUserId: null,
        createdByUsername: null,
        version: null,
        deletedAt: null,
        reminders,
      });
    }
  }
  return occurrences;
}

export function getCalendarBootstrap(
  database: Database,
  userId: number,
): RpcCalendarBootstrap {
  ensureDefaultCalendarForUser(database, userId);
  return {
    calendars: listVisibleCalendars(database, userId),
    externalCalendars: listExternalCalendars(database, userId),
    shares: listCalendarShares(database, userId),
    users: listCalendarUsers(database),
    notificationSettings: ensureNotificationSettings(database, userId),
    notifications: listCalendarNotifications(database, userId),
  };
}

export function getPublicCalendarBySlug(
  database: Database,
  slug: string,
): RpcCalendar | null {
  let normalized: string;
  try {
    normalized = normalizePublicSlug(slug);
  } catch {
    return null;
  }
  const row = database
    .query<CalendarSqlRow, [string]>(
      `
        SELECT calendars.id AS id, 1 AS ownerUserId, 'Local Operator' AS ownerUsername,
          calendars.title AS title, calendars.color AS color, NULL AS effectiveColor, 1 AS visible,
          0 AS notificationsEnabled, '["in_app"]' AS notificationChannelsJson,
          'read' AS permission, calendars.is_public AS isPublic, calendars.public_slug AS publicSlug,
          calendars.created_at AS createdAt, calendars.updated_at AS updatedAt
        FROM calendars
        WHERE calendars.public_slug = ? AND calendars.is_public = 1 AND calendars.deleted_at IS NULL
      `,
    )
    .get(normalized);
  return row ? hydrateCalendar(row) : null;
}

export function listEventsForCalendarExport(
  database: Database,
  calendarId: number,
  options: { maxEvents?: number | null } = {},
): RpcCalendarEvent[] {
  const rows = database
    .query<EventSqlRow, SQLQueryBindings[]>(
      `
        SELECT calendar_events.id AS id, calendar_events.calendar_id AS calendarId, calendar_events.title AS title,
          calendar_events.description AS description, calendar_events.location AS location, calendar_events.start_at AS startAt,
          calendar_events.end_at AS endAt, calendar_events.start_date AS startDate, calendar_events.end_date AS endDate,
          calendar_events.all_day AS allDay, calendar_events.timezone AS timezone, calendar_events.recurrence_rule AS recurrenceRule,
          1 AS createdByUserId, 'Local Operator' AS createdByUsername,
          1 AS updatedByUserId, 'Local Operator' AS updatedByUsername,
          calendar_events.version AS version, calendar_events.created_at AS createdAt, calendar_events.updated_at AS updatedAt,
          calendar_events.deleted_at AS deletedAt
        FROM calendar_events
        WHERE calendar_events.calendar_id = ? AND calendar_events.deleted_at IS NULL
        ORDER BY COALESCE(calendar_events.start_at, calendar_events.start_date) ASC
        ${typeof options.maxEvents === "number" ? "LIMIT ?" : ""}
      `,
    )
    .all(
      ...(typeof options.maxEvents === "number"
        ? [calendarId, Math.max(0, Math.trunc(options.maxEvents))]
        : [calendarId]),
    );
  return rows.map((row) => hydrateEvent(database, row));
}

export function listExdatesForEventExport(
  database: Database,
  eventId: number,
  options: { maxExdates?: number | null } = {},
): string[] {
  if (typeof options.maxExdates === "number") {
    return database
      .query<{ originalStart: string }, [number, number]>(
        `SELECT original_start AS originalStart FROM calendar_event_exdates WHERE event_id = ? LIMIT ?`,
      )
      .all(eventId, Math.max(0, Math.trunc(options.maxExdates)))
      .map((row) => row.originalStart);
  }
  return listEventExdates(database, eventId);
}

function hydrateDelivery(row: {
  id: number;
  userId: number;
  sourceType: "local" | "external_ics";
  calendarId: number | null;
  eventId: string;
  occurrenceStart: string;
  occurrenceTimezone: string;
  reminderId: string;
  channel: CalendarNotificationChannel;
  scheduledAt: string;
  status: RpcCalendarReminderDelivery["status"];
  deliveredAt: string | null;
  dismissedAt: string | null;
  readAt: string | null;
  title: string;
  body: string;
  openEventPayloadJson: string | null;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}): RpcCalendarReminderDelivery {
  return row;
}

export function listCalendarNotifications(
  database: Database,
  userId: number,
): RpcCalendarReminderDelivery[] {
  return database
    .query<Parameters<typeof hydrateDelivery>[0], []>(
      `
        SELECT id, ${LOCAL_CALENDAR_COMPAT_USER_ID} AS userId, source_type AS sourceType, calendar_id AS calendarId, event_id AS eventId,
          occurrence_start AS occurrenceStart, occurrence_timezone AS occurrenceTimezone, reminder_id AS reminderId,
          channel, scheduled_at AS scheduledAt, status, delivered_at AS deliveredAt, dismissed_at AS dismissedAt,
          read_at AS readAt, title, body, open_event_payload_json AS openEventPayloadJson,
          retry_count AS retryCount, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
        FROM calendar_reminder_deliveries
        WHERE status IN ('delivered', 'snoozed', 'failed')
        ORDER BY scheduled_at DESC, id DESC
        LIMIT 100
      `,
    )
    .all()
    .map((row) => ({ ...hydrateDelivery(row), userId }));
}

export function upsertReminderDelivery(
  database: Database,
  input: Omit<
    RpcCalendarReminderDelivery,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "deliveredAt"
    | "dismissedAt"
    | "readAt"
    | "retryCount"
    | "lastError"
  >,
): void {
  run(
    database,
    `
      INSERT OR IGNORE INTO calendar_reminder_deliveries (
        source_type, calendar_id, event_id, occurrence_start, occurrence_timezone, reminder_id, channel,
        scheduled_at, status, title, body, open_event_payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.sourceType,
    input.calendarId,
    input.eventId,
    input.occurrenceStart,
    input.occurrenceTimezone,
    input.reminderId,
    input.channel,
    input.scheduledAt,
    input.status,
    input.title,
    input.body,
    input.openEventPayloadJson,
  );
}

export function markDeliveryDelivered(
  database: Database,
  deliveryId: number,
): void {
  run(
    database,
    `UPDATE calendar_reminder_deliveries SET status = 'delivered', delivered_at = COALESCE(delivered_at, ?), updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    deliveryId,
  );
}

export function dismissCalendarNotification(
  database: Database,
  _userId: number,
  deliveryId: number,
): void {
  run(
    database,
    `UPDATE calendar_reminder_deliveries SET status = 'dismissed', dismissed_at = ?, updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    deliveryId,
  );
}

export function snoozeCalendarNotification(
  database: Database,
  _userId: number,
  deliveryId: number,
  snoozedUntil: string,
): RpcCalendarReminderDelivery {
  const row = database
    .query<Parameters<typeof hydrateDelivery>[0], [number]>(
      `SELECT id, ${LOCAL_CALENDAR_COMPAT_USER_ID} AS userId, source_type AS sourceType, calendar_id AS calendarId, event_id AS eventId, occurrence_start AS occurrenceStart, occurrence_timezone AS occurrenceTimezone, reminder_id AS reminderId, channel, scheduled_at AS scheduledAt, status, delivered_at AS deliveredAt, dismissed_at AS dismissedAt, read_at AS readAt, title, body, open_event_payload_json AS openEventPayloadJson, retry_count AS retryCount, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt FROM calendar_reminder_deliveries WHERE id = ?`,
    )
    .get(deliveryId);
  if (!row) {
    throw new Error("Notification not found.");
  }
  run(
    database,
    `INSERT INTO calendar_snoozes (delivery_id, snoozed_until) VALUES (?, ?)`,
    deliveryId,
    snoozedUntil,
  );
  run(
    database,
    `UPDATE calendar_reminder_deliveries SET status = 'snoozed', scheduled_at = ?, updated_at = ? WHERE id = ?`,
    snoozedUntil,
    nowIso(),
    deliveryId,
  );
  return {
    ...hydrateDelivery(row),
    status: "snoozed",
    scheduledAt: snoozedUntil,
  };
}

export function cancelCalendarNotifications(
  database: Database,
  calendarId: number,
): void {
  run(
    database,
    `UPDATE calendar_reminder_deliveries SET status = 'dismissed', dismissed_at = COALESCE(dismissed_at, ?), updated_at = ? WHERE calendar_id = ? AND status IN ('scheduled', 'delivered', 'snoozed')`,
    nowIso(),
    nowIso(),
    calendarId,
  );
}

export function dismissCalendarNotificationsForUser(
  database: Database,
  calendarId: number,
  _userId: number,
): void {
  run(
    database,
    `UPDATE calendar_reminder_deliveries SET status = 'dismissed', dismissed_at = COALESCE(dismissed_at, ?), updated_at = ? WHERE calendar_id = ? AND status IN ('scheduled', 'delivered', 'snoozed')`,
    nowIso(),
    nowIso(),
    calendarId,
  );
}

export function pruneDismissedCalendarNotifications(
  database: Database,
  olderThanIso: string,
): void {
  run(
    database,
    `DELETE FROM calendar_reminder_deliveries WHERE status IN ('dismissed', 'expired') AND COALESCE(dismissed_at, updated_at) < ?`,
    olderThanIso,
  );
}
