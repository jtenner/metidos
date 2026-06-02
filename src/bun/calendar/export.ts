/**
 * @file src/bun/calendar/export.ts
 * @description Public iCalendar export for local Metidos calendars.
 */

import type { Database } from "bun:sqlite";
import ICAL from "ical.js";
import {
  getPublicCalendarBySlug,
  listEventsForCalendarExport,
  listExdatesForEventExport,
} from "./store";
import type { RpcCalendarEvent } from "./types";

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STRICT_UTC_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const MAX_PUBLIC_CALENDAR_EXPORT_EVENTS = 5_000;
const MAX_PUBLIC_CALENDAR_EXPORT_EXDATES_PER_EVENT = 5_000;
const MAX_PUBLIC_CALENDAR_ICS_BYTES = 5 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();

function parseUtcIso(value: string, context: string): ICAL.Time {
  const match = STRICT_UTC_ISO_RE.exec(value);
  if (!match) {
    throw new Error(
      `Calendar export has invalid ${context}; expected strict UTC ISO timestamp, got ${value}`,
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Calendar export has invalid ${context}: ${value}`);
  }
  const [
    ,
    yearValue,
    monthValue,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
  ] = match;
  const millisecondValue = match[7] ?? "0";
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const millisecond = Number(millisecondValue.padEnd(3, "0"));
  // JavaScript Date parsing accepts lenient inputs and can normalize impossible
  // dates (for example 2026-02-30). Public ICS export treats stored UTC
  // timestamps as canonical data, so require every parsed UTC component to
  // round-trip exactly before handing it to ical.js.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    throw new Error(
      `Calendar export has invalid ${context}; expected real UTC calendar date/time, got ${value}`,
    );
  }
  return ICAL.Time.fromJSDate(date, true);
}

function parseLocalIso(
  value: string,
  timezone: string,
  context: string,
): ICAL.Time {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Calendar export has invalid ${context}: ${value}`);
  }
  let parts: Record<string, number>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  } catch (error) {
    throw new Error(
      `Calendar export has invalid timezone for ${context}: ${timezone}`,
      { cause: error },
    );
  }
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour;
  const minute = parts.minute;
  const second = parts.second;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new Error(
      `Calendar export could not derive local time for ${context} in ${timezone}`,
    );
  }
  return ICAL.Time.fromData(
    { year, month, day, hour, minute, second, isDate: false },
    ICAL.Timezone.fromData({ tzid: timezone }),
  );
}

function parseEventDateTime(
  value: string,
  event: RpcCalendarEvent,
  context: string,
): ICAL.Time {
  return event.timezone === "UTC"
    ? parseUtcIso(value, context)
    : parseLocalIso(value, event.timezone, context);
}

function allDayTime(value: string, context: string): ICAL.Time {
  if (!STRICT_DATE_RE.test(value)) {
    throw new Error(
      `Calendar export has invalid ${context}; expected YYYY-MM-DD, got ${value}`,
    );
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(
      `Calendar export has invalid ${context}; expected real calendar date, got ${value}`,
    );
  }
  return ICAL.Time.fromData({ year, month, day, isDate: true });
}

function addTimeProperty(
  component: ICAL.Component,
  name: string,
  value: ICAL.Time,
): void {
  const property = component.addPropertyWithValue(name, value);
  if (!value.isDate && value.zone?.tzid && value.zone.tzid !== "UTC") {
    property.setParameter("tzid", value.zone.tzid);
  }
}

function addTextProperty(
  component: ICAL.Component,
  name: string,
  value: string | null | undefined,
): void {
  if (value?.trim()) {
    component.addPropertyWithValue(name, value);
  }
}

function addEvent(
  component: ICAL.Component,
  event: RpcCalendarEvent,
  exdates: string[],
): void {
  const vevent = new ICAL.Component("vevent");
  vevent.addPropertyWithValue("uid", `metidos-${event.id}@local`);
  vevent.addPropertyWithValue("summary", event.title);
  addTextProperty(vevent, "description", event.description);
  addTextProperty(vevent, "location", event.location);
  vevent.addPropertyWithValue("dtstamp", ICAL.Time.now());
  vevent.addPropertyWithValue(
    "created",
    parseUtcIso(event.createdAt, `event ${event.id} createdAt`),
  );
  vevent.addPropertyWithValue(
    "last-modified",
    parseUtcIso(event.updatedAt, `event ${event.id} updatedAt`),
  );
  if (event.allDay) {
    if (event.startDate) {
      addTimeProperty(
        vevent,
        "dtstart",
        allDayTime(event.startDate, `event ${event.id} startDate`),
      );
    }
    if (event.endDate) {
      addTimeProperty(
        vevent,
        "dtend",
        allDayTime(event.endDate, `event ${event.id} endDate`),
      );
    }
  } else {
    if (event.startAt) {
      addTimeProperty(
        vevent,
        "dtstart",
        parseEventDateTime(event.startAt, event, `event ${event.id} startAt`),
      );
    }
    if (event.endAt) {
      addTimeProperty(
        vevent,
        "dtend",
        parseEventDateTime(event.endAt, event, `event ${event.id} endAt`),
      );
    }
  }
  if (event.recurrenceRule) {
    const recur = ICAL.Recur.fromString(
      event.recurrenceRule.replace(/^RRULE:/i, ""),
    );
    vevent.addPropertyWithValue("rrule", recur);
  }
  for (const exdate of exdates) {
    addTimeProperty(
      vevent,
      "exdate",
      event.allDay
        ? allDayTime(exdate, `event ${event.id} exdate`)
        : parseEventDateTime(exdate, event, `event ${event.id} exdate`),
    );
  }
  component.addSubcomponent(vevent);
}

export function exportPublicCalendarIcs(
  database: Database,
  slug: string,
): string | null {
  const calendar = getPublicCalendarBySlug(database, slug);
  if (!calendar?.isPublic) {
    return null;
  }
  const component = new ICAL.Component(["vcalendar", [], []]);
  component.addPropertyWithValue("prodid", "-//Metidos//Calendar//EN");
  component.addPropertyWithValue("version", "2.0");
  component.addPropertyWithValue("calscale", "GREGORIAN");
  component.addPropertyWithValue("x-wr-calname", calendar.title);
  const events = listEventsForCalendarExport(database, calendar.id, {
    maxEvents: MAX_PUBLIC_CALENDAR_EXPORT_EVENTS + 1,
  });
  if (events.length > MAX_PUBLIC_CALENDAR_EXPORT_EVENTS) {
    throw new Error(
      `Public calendar ICS export is limited to ${MAX_PUBLIC_CALENDAR_EXPORT_EVENTS} events.`,
    );
  }
  for (const event of events) {
    const exdates = listExdatesForEventExport(database, event.id, {
      maxExdates: MAX_PUBLIC_CALENDAR_EXPORT_EXDATES_PER_EVENT + 1,
    });
    if (exdates.length > MAX_PUBLIC_CALENDAR_EXPORT_EXDATES_PER_EVENT) {
      throw new Error(
        `Public calendar ICS export is limited to ${MAX_PUBLIC_CALENDAR_EXPORT_EXDATES_PER_EVENT} EXDATEs per event.`,
      );
    }
    try {
      addEvent(component, event, exdates);
    } catch (error) {
      console.warn(
        `Skipping invalid calendar event ${event.id} during public ICS export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const serialized = component.toString();
  if (
    TEXT_ENCODER.encode(serialized).byteLength > MAX_PUBLIC_CALENDAR_ICS_BYTES
  ) {
    throw new Error(
      `Public calendar ICS export is limited to ${MAX_PUBLIC_CALENDAR_ICS_BYTES} bytes.`,
    );
  }
  return serialized;
}
