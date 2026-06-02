/**
 * @file src/mainview/app/calendar-workspace.test.ts
 * @description Focused tests for calendar workspace request guards.
 */

import { describe, expect, it } from "bun:test";
import {
  getCalendarActionAvailability,
  getCalendarRangeNavigationDate,
  shouldCommitCalendarLoad,
} from "./calendar-workspace";
import { toDateInputValue } from "./calendar-layout";

describe("calendar workspace load guards", () => {
  it("commits only the latest calendar load request", () => {
    expect(
      shouldCommitCalendarLoad({ currentRequestId: 2, requestId: 1 }),
    ).toBe(false);
    expect(
      shouldCommitCalendarLoad({ currentRequestId: 2, requestId: 2 }),
    ).toBe(true);
  });
});

describe("calendar workspace action availability", () => {
  it("never exposes a share action and only allows editing/deleting by permission", () => {
    expect(getCalendarActionAvailability("owner")).toEqual({
      canDelete: true,
      canEdit: true,
    });
    expect(getCalendarActionAvailability("write")).toEqual({
      canDelete: false,
      canEdit: true,
    });
    expect(getCalendarActionAvailability("read")).toEqual({
      canDelete: false,
      canEdit: false,
    });
  });
});

describe("calendar workspace range navigation", () => {
  it("uses month steps for month toolbar navigation", () => {
    const anchorDate = new Date("2026-01-31T12:00:00");

    expect(
      toDateInputValue(
        getCalendarRangeNavigationDate({
          anchorDate,
          direction: "previous",
          view: "month",
        }),
      ),
    ).toBe("2025-12-31");
    expect(
      toDateInputValue(
        getCalendarRangeNavigationDate({
          anchorDate,
          direction: "next",
          view: "month",
        }),
      ),
    ).toBe("2026-02-28");
  });

  it("uses visible range steps for non-month toolbar navigation", () => {
    const anchorDate = new Date("2026-06-02T12:00:00");

    expect(
      toDateInputValue(
        getCalendarRangeNavigationDate({
          anchorDate,
          direction: "next",
          view: "day",
        }),
      ),
    ).toBe("2026-06-03");
    expect(
      toDateInputValue(
        getCalendarRangeNavigationDate({
          anchorDate,
          direction: "previous",
          view: "week",
        }),
      ),
    ).toBe("2026-05-26");
    expect(
      toDateInputValue(
        getCalendarRangeNavigationDate({
          anchorDate,
          direction: "next",
          view: "agenda",
        }),
      ),
    ).toBe("2026-06-09");
  });

  it("uses the supplied current date for today navigation", () => {
    expect(
      toDateInputValue(
        getCalendarRangeNavigationDate({
          anchorDate: new Date("2026-01-01T12:00:00"),
          direction: "today",
          now: new Date("2026-06-02T08:30:00"),
          view: "month",
        }),
      ),
    ).toBe("2026-06-02");
  });
});
