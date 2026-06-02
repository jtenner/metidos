import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { exportPublicCalendarIcs } from "./export";
import { initCalendarSchema } from "./store";

const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);

afterEach(() => {
  warnSpy.mockClear();
});

function createCalendarDatabase(): { database: Database; calendarId: number } {
  const database = new Database(":memory:");
  initCalendarSchema(database);
  database
    .query(
      `INSERT INTO calendars (title, color, is_public, public_slug)
       VALUES ('Public Test Calendar', '#7aa5c4', 1, 'public-test')`,
    )
    .run();
  const row = database
    .query<{ id: number }, []>(
      `SELECT id FROM calendars WHERE public_slug = 'public-test'`,
    )
    .get();
  if (!row) {
    throw new Error("Failed to create public test calendar.");
  }
  return { database, calendarId: row.id };
}

function insertTimedUtcEvent(
  database: Database,
  calendarId: number,
  values: {
    title: string;
    startAt?: string;
    endAt?: string;
    createdAt?: string;
    updatedAt?: string;
  },
): void {
  database
    .query(
      `INSERT INTO calendar_events (
        calendar_id, title, start_at, end_at, all_day, timezone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 'UTC', ?, ?)`,
    )
    .run(
      calendarId,
      values.title,
      values.startAt ?? "2026-01-01T10:00:00.000Z",
      values.endAt ?? "2026-01-01T11:00:00.000Z",
      values.createdAt ?? "2025-12-31T20:00:00.000Z",
      values.updatedAt ?? "2025-12-31T20:30:00.000Z",
    );
}

describe("public calendar ICS export", () => {
  it("exports strict UTC ISO timestamps", () => {
    const { database, calendarId } = createCalendarDatabase();
    try {
      insertTimedUtcEvent(database, calendarId, { title: "Strict UTC Event" });

      const ics = exportPublicCalendarIcs(database, "public-test");

      expect(ics).toContain("SUMMARY:Strict UTC Event");
      expect(ics).toContain("DTSTART:20260101T100000Z");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("rejects lenient UTC timestamp strings instead of allowing JavaScript Date normalization", () => {
    const { database, calendarId } = createCalendarDatabase();
    try {
      insertTimedUtcEvent(database, calendarId, {
        title: "Bare Date Created At",
        createdAt: "2026-01-01",
      });
      insertTimedUtcEvent(database, calendarId, {
        title: "Normalized Invalid Day",
        createdAt: "2026-02-30T10:00:00.000Z",
      });

      const ics = exportPublicCalendarIcs(database, "public-test");

      expect(ics).not.toContain("Bare Date Created At");
      expect(ics).not.toContain("Normalized Invalid Day");
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(
        "invalid event 1 createdAt; expected strict UTC ISO timestamp",
      );
      expect(warnSpy.mock.calls[1]?.[0]).toContain(
        "invalid event 2 createdAt; expected real UTC calendar date/time",
      );
    } finally {
      database.close();
    }
  });
});
