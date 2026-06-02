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

function insertAllDayEvent(
  database: Database,
  calendarId: number,
  values: {
    title: string;
    startDate?: string;
    endDate?: string;
  },
): void {
  database
    .query(
      `INSERT INTO calendar_events (
        calendar_id, title, start_date, end_date, all_day, timezone,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 'UTC', '2025-12-31T20:00:00.000Z', '2025-12-31T20:30:00.000Z')`,
    )
    .run(
      calendarId,
      values.title,
      values.startDate ?? "2026-01-01",
      values.endDate ?? "2026-01-02",
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

  it("rejects invalid all-day dates instead of normalizing impossible calendar days", () => {
    const { database, calendarId } = createCalendarDatabase();
    try {
      insertAllDayEvent(database, calendarId, { title: "Valid All Day" });
      insertAllDayEvent(database, calendarId, {
        title: "Datetime Start Date",
        startDate: "2026-01-01T00:00:00Z",
      });
      insertAllDayEvent(database, calendarId, {
        title: "Impossible End Date",
        endDate: "2026-02-30",
      });

      const ics = exportPublicCalendarIcs(database, "public-test");

      expect(ics).toContain("SUMMARY:Valid All Day");
      expect(ics).toContain("DTSTART;VALUE=DATE:20260101");
      expect(ics).not.toContain("Datetime Start Date");
      expect(ics).not.toContain("Impossible End Date");
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(warnings).toContainEqual(
        expect.stringContaining(
          "invalid event 2 startDate; expected YYYY-MM-DD",
        ),
      );
      expect(warnings).toContainEqual(
        expect.stringContaining(
          "invalid event 3 endDate; expected real calendar date",
        ),
      );
    } finally {
      database.close();
    }
  });
});
