/**
 * @file src/bun/cron-schedules.ts
 * @description Helpers for adapting Metidos local cron schedules to Bun.cron.
 */

import { cronToUtc, normalizeCron } from "../shared/cron-utc";

const MAX_CRON_SCHEDULE_BYTES = 256;

function assertCronScheduleInputBound(schedule: string): void {
  if (new TextEncoder().encode(schedule).byteLength > MAX_CRON_SCHEDULE_BYTES) {
    throw new Error(
      `Cron schedule must be at most ${MAX_CRON_SCHEDULE_BYTES} bytes.`,
    );
  }
}

/**
 * Return the current offset from UTC in minutes for an IANA timezone.
 */
export function getCurrentTimezoneUtcOffsetMinutes(timezone: string): number {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;

  if (!timeZoneName || timeZoneName === "GMT" || timeZoneName === "UTC") {
    return 0;
  }

  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u.exec(timeZoneName);
  if (!match) {
    throw new Error(`Unable to resolve UTC offset for timezone: ${timezone}`);
  }

  const [, sign, hourText, minuteText] = match;
  const hours = Number.parseInt(hourText ?? "0", 10);
  const minutes = Number.parseInt(minuteText ?? "0", 10);
  const offset = hours * 60 + minutes;
  return sign === "-" ? -offset : offset;
}

/**
 * Convert a persisted local cron expression into the UTC cron expressions that
 * Bun.cron needs in this runtime.
 */
export function expandCronScheduleForBun(
  schedule: string,
  timezone: string,
): string[] {
  assertCronScheduleInputBound(schedule);
  const schedules = cronToUtc(
    schedule,
    getCurrentTimezoneUtcOffsetMinutes(timezone),
  );
  if (schedules.length === 1 && schedules[0] === normalizeCron(schedule)) {
    return [schedule];
  }
  return schedules;
}

/**
 * Return the next runtime instant for a persisted local cron schedule.
 *
 * Bun.cron.parse interprets crontab fields in the runtime schedule timezone
 * (UTC for Metidos cron registration), so parse the same UTC-expanded
 * schedules that the scheduler registers instead of parsing the local schedule
 * directly. The returned timestamp is an absolute instant; clients can format
 * it in the user's local timezone.
 */
export function computeNextRunDateForLocalCronSchedule(
  schedule: string,
  timezone: string,
): number | null {
  if (
    typeof Bun === "undefined" ||
    !Bun.cron ||
    typeof Bun.cron.parse !== "function" ||
    typeof schedule !== "string" ||
    schedule.trim().length === 0
  ) {
    return null;
  }

  assertCronScheduleInputBound(schedule);

  let nextRunDateMs: number | null = null;
  for (const expandedSchedule of expandCronScheduleForBun(schedule, timezone)) {
    const parsedDate = Bun.cron.parse(expandedSchedule);
    if (!(parsedDate instanceof Date)) {
      continue;
    }
    const parsedDateMs = parsedDate.getTime();
    if (Number.isNaN(parsedDateMs)) {
      continue;
    }
    nextRunDateMs =
      nextRunDateMs === null
        ? parsedDateMs
        : Math.min(nextRunDateMs, parsedDateMs);
  }
  return nextRunDateMs;
}
