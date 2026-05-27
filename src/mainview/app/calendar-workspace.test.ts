/**
 * @file src/mainview/app/calendar-workspace.test.ts
 * @description Focused tests for calendar workspace request guards.
 */

import { describe, expect, it } from "bun:test";
import {
  getCalendarActionAvailability,
  shouldCommitCalendarLoad,
} from "./calendar-workspace";

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
