/**
 * @file src/bun/calendar/permissions.test.ts
 * @description Calendar permission seam tests for the local-operator calendar model.
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
import {
  assertCalendarOwner,
  assertCalendarReadable,
  assertCalendarWritable,
  getLocalCalendarPermission,
  permissionCanWrite,
} from "./permissions";
import { createCalendar, deleteCalendar } from "./store";

const tempDirs = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "metidos-calendar-permissions-"));
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

describe("calendar permission seams", () => {
  test("treats visible local calendars as owner-accessible to the local operator", () => {
    const db = setupDb();
    const owner = createUser(db, { username: "owner", isAdmin: true });
    const other = createUser(db, { username: "other", isAdmin: false });
    const calendar = createCalendar(db, owner.id, { title: "Shared runtime" });

    expect(getLocalCalendarPermission(db, calendar.id, owner.id)).toEqual({
      calendarId: calendar.id,
      ownerUserId: 1,
      permission: "owner",
    });
    expect(getLocalCalendarPermission(db, calendar.id, other.id)).toEqual({
      calendarId: calendar.id,
      ownerUserId: 1,
      permission: "owner",
    });
    expect(getLocalCalendarPermission(db, calendar.id, null)).toEqual({
      calendarId: calendar.id,
      ownerUserId: 1,
      permission: "owner",
    });
  });

  test("uses the same visibility gate for read, write, and owner assertions", () => {
    const db = setupDb();
    const user = createUser(db, { username: "operator", isAdmin: false });
    const calendar = createCalendar(db, user.id, { title: "Assertions" });

    expect(assertCalendarReadable(db, calendar.id, user.id).permission).toBe(
      "owner",
    );
    expect(assertCalendarWritable(db, calendar.id, user.id).permission).toBe(
      "owner",
    );
    expect(assertCalendarOwner(db, calendar.id, user.id).permission).toBe(
      "owner",
    );

    deleteCalendar(db, user.id, calendar.id);

    expect(getLocalCalendarPermission(db, calendar.id, user.id)).toBeNull();
    expect(() => assertCalendarReadable(db, calendar.id, user.id)).toThrow(
      "Calendar not found or not visible.",
    );
    expect(() => assertCalendarWritable(db, calendar.id, user.id)).toThrow(
      "Calendar not found or not visible.",
    );
    expect(() => assertCalendarOwner(db, calendar.id, user.id)).toThrow(
      "Calendar not found or not visible.",
    );
  });

  test("maps read/write/owner labels to writable affordances", () => {
    expect(permissionCanWrite("read")).toBeFalse();
    expect(permissionCanWrite("write")).toBeTrue();
    expect(permissionCanWrite("owner")).toBeTrue();
  });
});
