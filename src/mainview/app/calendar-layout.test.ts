/**
 * @file src/mainview/app/calendar-layout.test.ts
 * @description Calendar Mainview reducer/layout helper coverage.
 */

import { describe, expect, test } from "bun:test";
import type { RpcCalendarOccurrence } from "../../bun/calendar/types";
import {
  datetimeLocalInputToIso,
  recurrenceRuleForEventForm,
  repeatOptionFromRRule,
  toDatetimeLocalInputValue,
} from "./calendar-event-form-helpers";
import {
  formatCalendarColumnHeader,
  groupOccurrencesByDay,
  layoutTimedOccurrences,
  monthGridDays,
  toDateInputValue,
  viewWindow,
} from "./calendar-layout";
import {
  initialCalendarState,
  quickSnoozeDate,
  reduceCalendarState,
} from "./calendar-state";

function occurrence(
  id: string,
  start: string,
  end: string,
): RpcCalendarOccurrence {
  return {
    occurrenceId: id,
    sourceType: "local",
    calendarId: 1,
    eventId: 1,
    title: id,
    description: "",
    location: "",
    startAt: start,
    endAt: end,
    startDate: null,
    endDate: null,
    allDay: false,
    timezone: "UTC",
    color: "#fff",
    permission: "owner",
    writable: true,
    isRecurring: false,
    recurrenceRule: null,
    recurrenceSummary: "Does not repeat",
    originalStart: start,
    externalUrl: null,
    createdByUserId: 1,
    createdByUsername: "u",
    version: 1,
    deletedAt: null,
  };
}

function allDayOccurrence(
  id: string,
  startDate: string,
  endDate: string,
): RpcCalendarOccurrence {
  return {
    ...occurrence(id, `${startDate}T00:00:00.000Z`, `${endDate}T00:00:00.000Z`),
    startAt: null,
    endAt: null,
    startDate,
    endDate,
    allDay: true,
    originalStart: startDate,
  };
}

describe("calendar layout helpers", () => {
  test("builds a stable 42-day month grid", () => {
    expect(monthGridDays(new Date("2026-04-15T00:00:00Z"))).toHaveLength(42);
  });

  test("returns expected view windows", () => {
    const window = viewWindow("day", new Date("2026-04-15T12:00:00"));
    expect(
      new Date(window.end).getTime() - new Date(window.start).getTime(),
    ).toBe(24 * 60 * 60 * 1000);
  });

  test("formats timed view column headers as short localized dates", () => {
    expect(formatCalendarColumnHeader(new Date(2026, 3, 30), "en-US")).toBe(
      "4/30/26",
    );
    expect(formatCalendarColumnHeader(new Date(2026, 3, 30), "en-GB")).toBe(
      "30/04/2026",
    );
  });

  test("groups occurrences by rendered day", () => {
    const grouped = groupOccurrencesByDay([
      occurrence("a", "2026-04-15T10:00:00.000Z", "2026-04-15T11:00:00.000Z"),
    ]);
    expect([...grouped.keys()]).toEqual(["2026-04-15"]);
  });

  test("stacks overlapping timed events into columns", () => {
    const layouts = layoutTimedOccurrences([
      occurrence("a", "2026-04-15T10:00:00.000Z", "2026-04-15T11:00:00.000Z"),
      occurrence("b", "2026-04-15T10:30:00.000Z", "2026-04-15T11:30:00.000Z"),
    ]);
    expect(layouts.map((layout) => layout.columnCount)).toEqual([2, 2]);
  });

  test("uses the final cluster column count for earlier timed events", () => {
    const layouts = layoutTimedOccurrences([
      occurrence("a", "2026-04-15T09:00:00.000Z", "2026-04-15T10:00:00.000Z"),
      occurrence("b", "2026-04-15T09:30:00.000Z", "2026-04-15T11:00:00.000Z"),
      occurrence("c", "2026-04-15T10:30:00.000Z", "2026-04-15T12:00:00.000Z"),
      occurrence("d", "2026-04-15T10:45:00.000Z", "2026-04-15T11:15:00.000Z"),
    ]);
    expect(layouts.map((layout) => layout.columnCount)).toEqual([3, 3, 3, 3]);
  });

  test("clips timed event layout to the displayed day", () => {
    const [layout] = layoutTimedOccurrences(
      [
        occurrence(
          "overnight",
          new Date(2026, 3, 14, 22).toISOString(),
          new Date(2026, 3, 15, 2).toISOString(),
        ),
      ],
      new Date(2026, 3, 15, 12),
    );
    expect(layout?.topPercent).toBe(0);
    expect(layout?.heightPercent).toBeCloseTo((2 / 24) * 100);
  });

  test("groups timed multi-day occurrences on each rendered day", () => {
    const grouped = groupOccurrencesByDay([
      occurrence(
        "overnight",
        new Date(2026, 3, 14, 22).toISOString(),
        new Date(2026, 3, 15, 2).toISOString(),
      ),
    ]);
    expect([...grouped.keys()]).toEqual(["2026-04-14", "2026-04-15"]);
  });

  test("groups all-day multi-day occurrences on each rendered day", () => {
    const grouped = groupOccurrencesByDay([
      allDayOccurrence("conference", "2026-04-14", "2026-04-17"),
    ]);
    expect([...grouped.keys()]).toEqual([
      "2026-04-14",
      "2026-04-15",
      "2026-04-16",
    ]);
  });
});

describe("calendar event form helpers", () => {
  test("round trips datetime-local values in the runtime's local timezone", () => {
    const iso = "2026-06-01T10:00:00.000Z";
    const localValue = toDatetimeLocalInputValue(iso);
    expect(localValue).toMatch(/^2026-06-01T\d{2}:\d{2}$/);
    expect(datetimeLocalInputToIso(localValue)).toBe(iso);
  });

  test("maps basic recurrence rules exactly", () => {
    expect(repeatOptionFromRRule("RRULE:FREQ=WEEKLY")).toBe("weekly");
    expect(repeatOptionFromRRule("rrule:freq=monthly")).toBe("monthly");
    expect(repeatOptionFromRRule("RRULE:FREQ=WEEKLY;COUNT=4")).toBe("custom");
    expect(repeatOptionFromRRule("RRULE:FREQ=DAILY;BYDAY=MO")).toBe("custom");
    expect(repeatOptionFromRRule("EXDATE:20260601T100000Z")).toBe("custom");
  });

  test("preserves custom or untouched recurrence rules unless a preset is selected", () => {
    expect(
      recurrenceRuleForEventForm({
        occurrence: { recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=4" },
        repeat: "custom",
        repeatTouched: false,
      }),
    ).toBe("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(
      recurrenceRuleForEventForm({
        occurrence: { recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=4" },
        repeat: "custom",
        repeatTouched: true,
      }),
    ).toBe("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(
      recurrenceRuleForEventForm({
        occurrence: { recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=4" },
        repeat: "monthly",
        repeatTouched: true,
      }),
    ).toBe("RRULE:FREQ=MONTHLY");
  });
});

describe("calendar state reducer", () => {
  test("navigates by active view", () => {
    const state = {
      ...initialCalendarState(new Date("2026-04-15T00:00:00Z")),
      view: "day" as const,
    };
    const next = reduceCalendarState(state, { type: "next" });
    expect(next.anchorDate.toISOString().slice(0, 10)).toBe("2026-04-16");
  });

  test("uses month arithmetic for month navigation", () => {
    const jan = reduceCalendarState(
      {
        ...initialCalendarState(new Date(2026, 0, 31)),
        view: "month",
      },
      { type: "next" },
    );
    expect(toDateInputValue(jan.anchorDate)).toBe("2026-02-28");

    const mar = reduceCalendarState(
      {
        ...initialCalendarState(new Date(2026, 2, 31)),
        view: "month",
      },
      { type: "previous" },
    );
    expect(toDateInputValue(mar.anchorDate)).toBe("2026-02-28");

    const apr = reduceCalendarState(
      {
        ...initialCalendarState(new Date(2026, 3, 15)),
        view: "month",
      },
      { type: "next" },
    );
    expect(toDateInputValue(apr.anchorDate)).toBe("2026-05-15");
  });

  test("computes quick snooze options", () => {
    expect(
      quickSnoozeDate("10m", new Date("2026-04-15T10:00:00Z")).toISOString(),
    ).toBe("2026-04-15T10:10:00.000Z");
    expect(
      quickSnoozeDate("tomorrow8", new Date("2026-04-15T10:00:00Z")).getHours(),
    ).toBe(8);
  });
});
