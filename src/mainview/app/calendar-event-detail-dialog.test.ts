/**
 * @file src/mainview/app/calendar-event-detail-dialog.test.ts
 * @description Tests for calendar event detail URL safety helpers.
 */

import { describe, expect, it } from "bun:test";

import { safeExternalCalendarUrl } from "./calendar-event-detail-dialog";

describe("safeExternalCalendarUrl", () => {
  it("allows only absolute http and https event URLs", () => {
    expect(safeExternalCalendarUrl("https://example.com/event?id=1")).toBe(
      "https://example.com/event?id=1",
    );
    expect(safeExternalCalendarUrl("http://example.com/event")).toBe(
      "http://example.com/event",
    );
  });

  it("drops unsafe or malformed external calendar URLs", () => {
    expect(safeExternalCalendarUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalCalendarUrl("data:text/html,hi")).toBeNull();
    expect(safeExternalCalendarUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalCalendarUrl("/relative/event")).toBeNull();
    expect(safeExternalCalendarUrl("not a url")).toBeNull();
    expect(safeExternalCalendarUrl(null)).toBeNull();
  });
});
