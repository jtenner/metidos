/**
 * @file src/bun/calendar/recurrence.test.ts
 * @description Focused recurrence tests for calendar RRULE expansion and scoped deletes.
 */

import { describe, expect, test } from "bun:test";
import {
  adjustRRuleCountAfterSplit,
  expandCalendarOccurrences,
  truncateRRuleBeforeOccurrence,
  validateRRuleString,
} from "./recurrence";

describe("calendar recurrence", () => {
  test("expands RRULE occurrences and applies EXDATE exclusions", () => {
    const occurrences = expandCalendarOccurrences(
      {
        eventId: 1,
        startAt: "2026-05-01T15:00:00.000Z",
        endAt: "2026-05-01T16:00:00.000Z",
        startDate: null,
        endDate: null,
        allDay: false,
        recurrenceRule: "RRULE:FREQ=DAILY;COUNT=4",
        exdates: ["2026-05-02T15:00:00.000Z"],
      },
      "2026-05-01T00:00:00.000Z",
      "2026-05-06T00:00:00.000Z",
    );
    expect(occurrences.map((item) => item.originalStart)).toEqual([
      "2026-05-01T15:00:00.000Z",
      "2026-05-03T15:00:00.000Z",
      "2026-05-04T15:00:00.000Z",
    ]);
  });

  test("keeps timed recurrences at the event timezone wall-clock time across DST", () => {
    const occurrences = expandCalendarOccurrences(
      {
        eventId: 1,
        startAt: "2026-03-07T14:00:00.000Z",
        endAt: "2026-03-07T15:00:00.000Z",
        startDate: null,
        endDate: null,
        allDay: false,
        timezone: "America/New_York",
        recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
      },
      "2026-03-07T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
    );
    expect(occurrences.map((item) => item.startAt)).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
    ]);
    const localHours = occurrences.map((item) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(item.startAt as string)),
    );
    expect(localHours).toEqual(["09:00", "09:00", "09:00"]);
  });

  test("signals when a zoned occurrence lands in a DST gap", () => {
    expect(() =>
      expandCalendarOccurrences(
        {
          eventId: 1,
          startAt: "2026-03-07T07:30:00.000Z",
          endAt: "2026-03-07T08:30:00.000Z",
          startDate: null,
          endDate: null,
          allDay: false,
          timezone: "America/New_York",
          recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
        },
        "2026-03-07T00:00:00.000Z",
        "2026-03-10T00:00:00.000Z",
      ),
    ).toThrow(/DST gap/);
  });

  test("signals when a zoned occurrence is ambiguous during fall-back", () => {
    expect(() =>
      expandCalendarOccurrences(
        {
          eventId: 1,
          startAt: "2026-10-31T05:30:00.000Z",
          endAt: "2026-10-31T06:30:00.000Z",
          startDate: null,
          endDate: null,
          allDay: false,
          timezone: "America/New_York",
          recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
        },
        "2026-10-31T00:00:00.000Z",
        "2026-11-03T00:00:00.000Z",
      ),
    ).toThrow(/ambiguous/);
  });

  test("keeps UTC recurrence expansion unchanged", () => {
    const occurrences = expandCalendarOccurrences(
      {
        eventId: 1,
        startAt: "2026-03-07T14:00:00.000Z",
        endAt: "2026-03-07T15:00:00.000Z",
        startDate: null,
        endDate: null,
        allDay: false,
        timezone: "UTC",
        recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
      },
      "2026-03-07T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
    );
    expect(occurrences.map((item) => item.startAt)).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T14:00:00.000Z",
      "2026-03-09T14:00:00.000Z",
    ]);
  });

  test("rejects recurrence rules that are too dense to expand safely", () => {
    expect(() => validateRRuleString("RRULE:FREQ=MINUTELY;COUNT=10")).toThrow(
      "too dense",
    );
    expect(() =>
      validateRRuleString("RRULE:FREQ=DAILY;BYMINUTE=0,1;COUNT=10"),
    ).toThrow("BYSECOND and BYMINUTE");
    expect(() => validateRRuleString("RRULE:FREQ=DAILY;COUNT=10001")).toThrow(
      "COUNT must be at most 10000",
    );
  });

  test("adjusts count after a split without materializing every occurrence", () => {
    const adjusted = adjustRRuleCountAfterSplit(
      "RRULE:FREQ=DAILY;COUNT=50000",
      "2026-05-01T15:00:00.000Z",
      "2026-05-03T15:00:00.000Z",
    );
    expect(adjusted).toContain("COUNT=49998");
  });

  test("rejects count adjustment when finding the split requires too many scans", () => {
    expect(() =>
      adjustRRuleCountAfterSplit(
        "RRULE:FREQ=DAILY;COUNT=50000",
        "2026-05-01T15:00:00.000Z",
        "2056-05-01T15:00:00.000Z",
      ),
    ).toThrow(/Refusing to scan more than 10000 occurrences/);
  });

  test("truncates an all-day series on the previous calendar day", () => {
    const truncated = truncateRRuleBeforeOccurrence(
      "RRULE:FREQ=DAILY;COUNT=10",
      "2026-05-04",
      true,
    );
    expect(truncated).toContain("UNTIL=20260503T000000Z");
    const occurrences = expandCalendarOccurrences(
      {
        eventId: 1,
        startAt: null,
        endAt: null,
        startDate: "2026-05-01",
        endDate: "2026-05-02",
        allDay: true,
        recurrenceRule: truncated,
      },
      "2026-05-01T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
    );
    expect(occurrences.map((item) => item.originalStart)).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
  });

  test("truncates a series before a selected occurrence", () => {
    const truncated = truncateRRuleBeforeOccurrence(
      "RRULE:FREQ=DAILY;COUNT=10",
      "2026-05-04T15:00:00.000Z",
    );
    const occurrences = expandCalendarOccurrences(
      {
        eventId: 1,
        startAt: "2026-05-01T15:00:00.000Z",
        endAt: "2026-05-01T16:00:00.000Z",
        startDate: null,
        endDate: null,
        allDay: false,
        recurrenceRule: truncated,
      },
      "2026-05-01T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
    );
    expect(occurrences.map((item) => item.originalStart)).toEqual([
      "2026-05-01T15:00:00.000Z",
      "2026-05-02T15:00:00.000Z",
      "2026-05-03T15:00:00.000Z",
    ]);
  });
});
