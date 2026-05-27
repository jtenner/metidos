/**
 * @file src/bun/calendar/occurrence-window.test.ts
 * @description Calendar occurrence request window validation tests.
 */

import { describe, expect, test } from "bun:test";
import { normalizeCalendarOccurrenceWindow } from "./occurrence-window";

describe("calendar occurrence window validation", () => {
  test("normalizes valid request windows", () => {
    expect(
      normalizeCalendarOccurrenceWindow({
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
      }),
    ).toEqual({
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-02T00:00:00.000Z",
    });
  });

  test("rejects invalid, reversed, and excessive request windows", () => {
    expect(() =>
      normalizeCalendarOccurrenceWindow({ start: "nope", end: "2026-06-02" }),
    ).toThrow("start must be a valid date");
    expect(() =>
      normalizeCalendarOccurrenceWindow({
        start: "2026-06-02T00:00:00.000Z",
        end: "2026-06-02T00:00:00.000Z",
      }),
    ).toThrow("end must be after start");
    expect(() =>
      normalizeCalendarOccurrenceWindow({
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-05-01T00:00:00.000Z",
      }),
    ).toThrow("cannot exceed 90 days");
  });
});
