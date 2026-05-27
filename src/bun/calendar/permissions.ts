/**
 * @file src/bun/calendar/permissions.ts
 * @description Calendar access-control helpers for the single local-operator model.
 */

import type { Database } from "bun:sqlite";
import type { CalendarPermission } from "./types";

export type CalendarPermissionRecord = {
  calendarId: number;
  ownerUserId: number;
  permission: CalendarPermission;
};

const LOCAL_CALENDAR_COMPAT_USER_ID = 1;

export function getLocalCalendarPermission(
  database: Database,
  calendarId: number,
  _userId: number | null,
): CalendarPermissionRecord | null {
  const row = database
    .query<{ id: number }, [number]>(
      `
        SELECT id
        FROM calendars
        WHERE id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .get(calendarId);
  if (!row) {
    return null;
  }
  return {
    calendarId: row.id,
    ownerUserId: LOCAL_CALENDAR_COMPAT_USER_ID,
    permission: "owner",
  };
}

export function assertCalendarReadable(
  database: Database,
  calendarId: number,
  userId: number | null,
): CalendarPermissionRecord {
  const permission = getLocalCalendarPermission(database, calendarId, userId);
  if (!permission) {
    throw new Error("Calendar not found or not visible.");
  }
  return permission;
}

export function assertCalendarWritable(
  database: Database,
  calendarId: number,
  userId: number | null,
): CalendarPermissionRecord {
  return assertCalendarReadable(database, calendarId, userId);
}

export function assertCalendarOwner(
  database: Database,
  calendarId: number,
  userId: number | null,
): CalendarPermissionRecord {
  return assertCalendarReadable(database, calendarId, userId);
}

export function permissionCanWrite(
  permission: CalendarPermission | "read",
): boolean {
  return permission === "owner" || permission === "write";
}
