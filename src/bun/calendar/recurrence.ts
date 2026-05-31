/**
 * @file src/bun/calendar/recurrence.ts
 * @description RRULE-backed recurrence helpers for Metidos calendars.
 */

import { RRule, rrulestr, type Weekday } from "rrule";

export type RecurrenceExpansionInput = {
  eventId: number | string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
  recurrenceRule: string | null;
  exdates?: string[];
  timezone?: string | null;
};

export type ExpandedOccurrenceTime = {
  originalStart: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_SPLIT_COUNT_SCAN = 10_000;
const MAX_RECURRENCE_RULE_COUNT = 10_000;
const UNSUPPORTED_DENSE_RECURRENCE_FREQUENCIES = new Set([
  "SECONDLY",
  "MINUTELY",
  "HOURLY",
]);

function parseIsoDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return date;
}

function parseAllDayDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid all-day date value: ${value}`);
  }
  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeRRule(rule: string): string {
  return rule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && !line.toUpperCase().startsWith("DTSTART"),
    )
    .join("\n")
    .replace(/^RRULE:/i, "RRULE:");
}

export function validateRRuleString(
  rule: string | null | undefined,
): string | null {
  const trimmed = rule?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeRRule(trimmed);
  try {
    rrulestr(normalized);
  } catch (error) {
    throw new Error(
      `Invalid recurrence rule: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const frequency = /(?:^|[;\n])(?:RRULE:)?FREQ=([^;\r\n]+)/iu.exec(
    normalized,
  )?.[1];
  if (
    frequency &&
    UNSUPPORTED_DENSE_RECURRENCE_FREQUENCIES.has(frequency.toUpperCase())
  ) {
    throw new Error(
      `Invalid recurrence rule: FREQ=${frequency.toUpperCase()} is too dense for calendar expansion.`,
    );
  }
  if (/(?:^|[;\n])BY(?:SECOND|MINUTE)=/iu.test(normalized)) {
    throw new Error(
      "Invalid recurrence rule: BYSECOND and BYMINUTE are too dense for calendar expansion.",
    );
  }
  const countText = /(?:^|[;\n])COUNT=(\d+)/iu.exec(normalized)?.[1];
  if (countText && Number.parseInt(countText, 10) > MAX_RECURRENCE_RULE_COUNT) {
    throw new Error(
      `Invalid recurrence rule: COUNT must be at most ${MAX_RECURRENCE_RULE_COUNT}.`,
    );
  }
  return normalized;
}

export function summarizeRecurrence(rule: string | null | undefined): string {
  const normalized = rule?.trim();
  if (!normalized) {
    return "Does not repeat";
  }
  try {
    const parsed = rrulestr(normalizeRRule(normalized));
    const text = parsed.toText();
    return text ? text[0]?.toUpperCase() + text.slice(1) : normalized;
  } catch {
    return normalized;
  }
}

function occurrenceDurationMs(input: RecurrenceExpansionInput): number {
  if (input.allDay) {
    const start = parseAllDayDate(input.startDate ?? "");
    const end = parseAllDayDate(input.endDate ?? input.startDate ?? "");
    return Math.max(MS_PER_DAY, end.getTime() - start.getTime());
  }
  const start = parseIsoDate(input.startAt ?? "");
  const end = parseIsoDate(input.endAt ?? input.startAt ?? "");
  return Math.max(0, end.getTime() - start.getTime());
}

function occurrenceFromStart(
  input: RecurrenceExpansionInput,
  start: Date,
): ExpandedOccurrenceTime {
  const duration = occurrenceDurationMs(input);
  if (input.allDay) {
    const end = new Date(start.getTime() + duration);
    const originalStart = formatDateOnly(start);
    return {
      originalStart,
      startAt: null,
      endAt: null,
      startDate: originalStart,
      endDate: formatDateOnly(end),
    };
  }
  const end = new Date(start.getTime() + duration);
  return {
    originalStart: start.toISOString(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    startDate: null,
    endDate: null,
  };
}

function baseStartDate(input: RecurrenceExpansionInput): Date {
  return input.allDay
    ? parseAllDayDate(input.startDate ?? "")
    : parseIsoDate(input.startAt ?? "");
}

function occurrenceOverlapsWindow(
  input: RecurrenceExpansionInput,
  occurrence: ExpandedOccurrenceTime,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  const comparableStart = input.allDay
    ? parseAllDayDate(occurrence.startDate ?? "")
    : parseIsoDate(occurrence.startAt ?? "");
  const comparableEnd = input.allDay
    ? parseAllDayDate(occurrence.endDate ?? occurrence.startDate ?? "")
    : parseIsoDate(occurrence.endAt ?? occurrence.startAt ?? "");
  return comparableEnd > windowStart && comparableStart < windowEnd;
}

function validTimezone(timezone: string | null | undefined): string {
  const value = timezone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "UTC";
  }
}

function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMinutesForZone(utcDate: Date, timeZone: string): number {
  const parts = zonedParts(utcDate, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUtc - utcDate.getTime()) / 60_000;
}

function formatWallTimeParts(parts: ReturnType<typeof zonedParts>): string {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function zonedPartsEqual(
  left: ReturnType<typeof zonedParts>,
  right: ReturnType<typeof zonedParts>,
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function localWallTimeToUtc(
  parts: ReturnType<typeof zonedParts>,
  timeZone: string,
): Date {
  const guess = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
  const offsets = new Set(
    [
      guess,
      new Date(guess.getTime() - MS_PER_DAY),
      new Date(guess.getTime() + MS_PER_DAY),
    ].map((date) => offsetMinutesForZone(date, timeZone)),
  );
  const candidates = [...offsets]
    .map((offset) => new Date(guess.getTime() - offset * 60_000))
    .filter((candidate) =>
      zonedPartsEqual(zonedParts(candidate, timeZone), parts),
    );

  if (candidates.length === 0) {
    throw new Error(
      `Recurring occurrence falls in a DST gap for ${timeZone}: ${formatWallTimeParts(parts)}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Recurring occurrence is ambiguous during a DST transition for ${timeZone}: ${formatWallTimeParts(parts)}`,
    );
  }
  return candidates[0] as Date;
}

function floatingDateFromParts(parts: ReturnType<typeof zonedParts>): Date {
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
}

function floatingParts(date: Date): ReturnType<typeof zonedParts> {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function occurrenceFromZonedFloatingStart(
  input: RecurrenceExpansionInput,
  floatingStart: Date,
  timezone: string,
): ExpandedOccurrenceTime {
  return occurrenceFromStart(
    input,
    localWallTimeToUtc(floatingParts(floatingStart), timezone),
  );
}

function recurrenceExpansionLimitError(maxOccurrences: number): Error {
  return Object.assign(
    new Error(
      `Calendar occurrence request returned more than ${maxOccurrences} occurrences. Narrow the date range.`,
    ),
    { code: "calendar_occurrence_limit_exceeded" },
  );
}

function collectRRuleBetween(
  rule: ReturnType<typeof rrulestr>,
  after: Date,
  before: Date,
): Date[] {
  const output: Date[] = [];
  const withIterator = rule as unknown as {
    between: (
      after: Date,
      before: Date,
      inclusive: boolean,
      iterator: (date: Date, index: number) => boolean,
    ) => Date[];
  };
  withIterator.between(after, before, true, (date) => {
    output.push(date);
    return true;
  });
  return output;
}

function enforceExpandedOccurrenceLimit<T>(
  occurrences: T[],
  maxOccurrences: number | null | undefined,
): T[] {
  if (
    typeof maxOccurrences === "number" &&
    occurrences.length > maxOccurrences
  ) {
    throw recurrenceExpansionLimitError(maxOccurrences);
  }
  return occurrences;
}

export function expandCalendarOccurrences(
  input: RecurrenceExpansionInput,
  windowStartIso: string,
  windowEndIso: string,
  options: { maxOccurrences?: number | null } = {},
): ExpandedOccurrenceTime[] {
  const windowStart = parseIsoDate(windowStartIso);
  const windowEnd = parseIsoDate(windowEndIso);
  const baseStart = baseStartDate(input);
  const exclusionSet = new Set(input.exdates ?? []);

  if (!input.recurrenceRule) {
    const occurrence = occurrenceFromStart(input, baseStart);
    const comparableStart = input.allDay
      ? parseAllDayDate(occurrence.startDate ?? "")
      : parseIsoDate(occurrence.startAt ?? "");
    const comparableEnd = input.allDay
      ? parseAllDayDate(occurrence.endDate ?? occurrence.startDate ?? "")
      : parseIsoDate(occurrence.endAt ?? occurrence.startAt ?? "");
    return comparableEnd > windowStart && comparableStart < windowEnd
      ? [occurrence]
      : [];
  }

  const recurrenceRule = validateRRuleString(input.recurrenceRule);
  if (!recurrenceRule) {
    return [];
  }
  const timezone = validTimezone(input.timezone);
  if (!input.allDay && timezone !== "UTC") {
    const rule = rrulestr(recurrenceRule, {
      dtstart: floatingDateFromParts(zonedParts(baseStart, timezone)),
    });
    const duration = Math.max(MS_PER_DAY, occurrenceDurationMs(input));
    const floatingWindowStart = floatingDateFromParts(
      zonedParts(windowStart, timezone),
    );
    const floatingWindowEnd = floatingDateFromParts(
      zonedParts(windowEnd, timezone),
    );
    const between = collectRRuleBetween(
      rule,
      new Date(floatingWindowStart.getTime() - duration),
      floatingWindowEnd,
    );
    return enforceExpandedOccurrenceLimit(
      between
        .map((start) =>
          occurrenceFromZonedFloatingStart(input, start, timezone),
        )
        .filter(
          (occurrence) =>
            !exclusionSet.has(occurrence.originalStart) &&
            occurrenceOverlapsWindow(input, occurrence, windowStart, windowEnd),
        ),
      options.maxOccurrences,
    );
  }

  const rule = rrulestr(recurrenceRule, {
    dtstart: baseStart,
  });
  const between = collectRRuleBetween(
    rule,
    new Date(
      windowStart.getTime() - Math.max(MS_PER_DAY, occurrenceDurationMs(input)),
    ),
    windowEnd,
  );
  return enforceExpandedOccurrenceLimit(
    between
      .map((start) => occurrenceFromStart(input, start))
      .filter(
        (occurrence) =>
          !exclusionSet.has(occurrence.originalStart) &&
          occurrenceOverlapsWindow(input, occurrence, windowStart, windowEnd),
      ),
    options.maxOccurrences,
  );
}

export function buildRRuleFromUi(input: {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number | null;
  weekdays?: number[] | null;
  until?: string | null;
  count?: number | null;
}): string {
  const weekdayMap = [
    RRule.SU,
    RRule.MO,
    RRule.TU,
    RRule.WE,
    RRule.TH,
    RRule.FR,
    RRule.SA,
  ];
  const options = {
    freq:
      input.frequency === "daily"
        ? RRule.DAILY
        : input.frequency === "weekly"
          ? RRule.WEEKLY
          : input.frequency === "monthly"
            ? RRule.MONTHLY
            : RRule.YEARLY,
    interval: Math.max(1, Math.floor(input.interval ?? 1)),
    ...(input.frequency === "weekly" && input.weekdays?.length
      ? {
          byweekday: input.weekdays.map(
            (day) => weekdayMap[Math.max(0, Math.min(6, day))] as Weekday,
          ),
        }
      : {}),
    ...(input.until ? { until: parseIsoDate(input.until) } : {}),
    ...(input.count ? { count: Math.max(1, Math.floor(input.count)) } : {}),
  };
  return new RRule(options).toString();
}

export function truncateRRuleBeforeOccurrence(
  rule: string,
  occurrenceStart: string,
  allDay = false,
): string {
  const parsed = rrulestr(normalizeRRule(rule));
  const options = { ...parsed.origOptions };
  const occurrence = allDay
    ? parseAllDayDate(occurrenceStart)
    : parseIsoDate(occurrenceStart);
  options.until = allDay
    ? new Date(occurrence.getTime() - MS_PER_DAY)
    : new Date(occurrence.getTime() - 1000);
  delete options.count;
  return new RRule(options).toString();
}

export function adjustRRuleCountAfterSplit(
  rule: string,
  originalStart: string,
  splitStart: string,
  allDay = false,
): string | null {
  const dtstart = allDay
    ? parseAllDayDate(originalStart)
    : parseIsoDate(originalStart);
  const parsed = rrulestr(normalizeRRule(rule), { dtstart });
  const options = { ...parsed.origOptions };
  if (!options.count) {
    return normalizeRRule(rule);
  }
  const originalCount = Math.max(0, Math.floor(Number(options.count)));
  let scanned = 0;
  let occurrencesBeforeSplit = 0;
  let foundSplitStart = false;

  parsed.all((date) => {
    scanned += 1;
    if (scanned > MAX_SPLIT_COUNT_SCAN) {
      throw new Error(
        `Refusing to scan more than ${MAX_SPLIT_COUNT_SCAN} occurrences while splitting recurrence count.`,
      );
    }

    const start = allDay ? formatDateOnly(date) : date.toISOString();
    if (start >= splitStart) {
      foundSplitStart = true;
      return false;
    }

    occurrencesBeforeSplit += 1;
    return true;
  });

  if (!foundSplitStart) {
    return null;
  }

  const remaining = originalCount - occurrencesBeforeSplit;
  if (remaining <= 0) {
    return null;
  }
  options.count = remaining;
  delete options.until;
  return new RRule(options).toString();
}
