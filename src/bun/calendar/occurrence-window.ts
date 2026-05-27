/**
 * @file src/bun/calendar/occurrence-window.ts
 * @description Validates client-requested calendar occurrence windows.
 */

export const MAX_CALENDAR_OCCURRENCE_WINDOW_DAYS = 90;
export const MAX_CALENDAR_OCCURRENCE_WINDOW_MS =
  MAX_CALENDAR_OCCURRENCE_WINDOW_DAYS * 24 * 60 * 60_000;

function calendarWindowError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function parseWindowDate(value: string, field: "start" | "end"): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw calendarWindowError(
      `Calendar occurrence ${field} must be a valid date.`,
      "calendar_invalid_occurrence_window",
    );
  }
  return date;
}

export function normalizeCalendarOccurrenceWindow(input: {
  start: string;
  end: string;
}): { start: string; end: string } {
  const start = parseWindowDate(input.start, "start");
  const end = parseWindowDate(input.end, "end");
  const durationMs = end.getTime() - start.getTime();

  if (durationMs <= 0) {
    throw calendarWindowError(
      "Calendar occurrence window end must be after start.",
      "calendar_invalid_occurrence_window",
    );
  }

  if (durationMs > MAX_CALENDAR_OCCURRENCE_WINDOW_MS) {
    throw calendarWindowError(
      `Calendar occurrence window cannot exceed ${MAX_CALENDAR_OCCURRENCE_WINDOW_DAYS} days.`,
      "calendar_occurrence_window_too_large",
    );
  }

  return { start: start.toISOString(), end: end.toISOString() };
}
