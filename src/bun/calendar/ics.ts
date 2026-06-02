/**
 * @file src/bun/calendar/ics.ts
 * @description External read-only ICS subscription parsing and refresh helpers.
 */

import type { Database } from "bun:sqlite";
import ICAL from "ical.js";
import { MAX_CALENDAR_REMINDERS_PER_EVENT } from "./store";
import { readLimitedTextResponse } from "../limited-json-response";
import {
  assertSafeOutboundHttpUrl,
  createSafeOutboundHttpFetch,
  isHttpRedirectStatus,
  type ResolveHostname,
  resolveSafeRedirectUrl,
} from "../outbound-url-security";
import {
  DEFAULT_EXTERNAL_ICS_REFRESH_INTERVAL_MINUTES,
  markExternalCalendarFetchError,
  replaceExternalCalendarCache,
} from "./store";
import type { CalendarReminderInput } from "./types";

export type ParsedIcsEvent = {
  uid: string;
  recurrenceId?: string | null;
  title: string;
  description: string;
  location: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
  timezone: string;
  recurrenceRule: string | null;
  exdates: string[];
  reminders: CalendarReminderInput[];
  url: string | null;
  rawJson: string | null;
};

const MAX_EXTERNAL_ICS_REDIRECTS = 5;
const MAX_EXTERNAL_ICS_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_EXTERNAL_ICS_EVENT_COUNT = 5_000;
const MAX_EXTERNAL_ICS_EVENT_RAW_JSON_CHARS = 64 * 1024;
const DEFAULT_EXTERNAL_ICS_REFRESH_TIMEOUT_MS = 30_000;
const DEFAULT_EXTERNAL_ICS_DUE_REFRESH_LIMIT = 10;
const MIN_EXTERNAL_ICS_REFRESH_INTERVAL_MINUTES = 5;
const EXTERNAL_ICS_FAILURE_BACKOFF_MINUTES = [15, 60, 240, 360, 720, 1440];

const ALLOWED_EXTERNAL_ICS_CONTENT_TYPES = new Set([
  "application/calendar",
  "application/ics",
  "application/octet-stream",
  "binary/octet-stream",
  "text/calendar",
  "text/plain",
]);

function looksLikeIcsCalendar(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR\b/i.test(text);
}

function googleCalendarImportGuidance(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "calendar.google.com" &&
      parsed.pathname.startsWith("/calendar/") &&
      parsed.searchParams.has("cid")
    ) {
      return "Google Calendar web pages cannot be imported directly. Use the direct iCal subscription URL from Google Calendar settings: Settings → Integrate calendar → Secret address in iCal format, or make the calendar public and use its public iCal URL.";
    }
    if (parsed.hostname === "accounts.google.com") {
      return "Google Calendar redirected to a Google sign-in page, so Metidos could not fetch calendar data. Use the direct iCal subscription URL from Google Calendar settings: Settings → Integrate calendar → Secret address in iCal format, or make the calendar public and use its public iCal URL.";
    }
  } catch {
    return null;
  }
  return null;
}

function assertIcsResponseContentType(response: Response, url: string): void {
  const contentType = response.headers.get("content-type");
  if (!contentType?.trim()) {
    // Some legitimate static calendar hosts omit Content-Type. Missing type is
    // not treated as trust: the bounded response body must still parse as an ICS
    // document via assertIcsResponseBody before any events are imported.
    return;
  }
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_EXTERNAL_ICS_CONTENT_TYPES.has(mediaType)) {
    return;
  }
  throw new Error(
    googleCalendarImportGuidance(url) ??
      `External ICS URL returned unsupported content type ${mediaType || contentType}. Use a direct .ics/iCal subscription URL.`,
  );
}

function assertIcsResponseBody(text: string, url: string): void {
  if (looksLikeIcsCalendar(text)) {
    return;
  }
  throw new Error(
    googleCalendarImportGuidance(url) ??
      "External ICS URL did not return an iCalendar feed. Use a direct .ics/iCal subscription URL rather than a calendar web page.",
  );
}

function rawJsonForIcsEvent(vevent: ICAL.Component): string | null {
  const rawJson = JSON.stringify(vevent.toJSON());
  return rawJson.length <= MAX_EXTERNAL_ICS_EVENT_RAW_JSON_CHARS
    ? rawJson
    : null;
}

function icalTimeToFields(value: ICAL.Time | null): {
  allDay: boolean;
  iso: string | null;
  date: string | null;
  timezone: string;
} {
  if (!value) {
    return { allDay: false, iso: null, date: null, timezone: "UTC" };
  }
  const timezone = value.zone?.tzid || "UTC";
  if (value.isDate) {
    return {
      allDay: true,
      iso: null,
      date: `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`,
      timezone,
    };
  }
  const jsDate = value.toJSDate();
  if (Number.isNaN(jsDate.getTime())) {
    return { allDay: false, iso: null, date: null, timezone };
  }
  return {
    allDay: false,
    iso: jsDate.toISOString(),
    date: null,
    timezone,
  };
}

function safeTimeToFields(
  valueFactory: () => ICAL.Time | null,
): ReturnType<typeof icalTimeToFields> {
  try {
    return icalTimeToFields(valueFactory());
  } catch {
    return { allDay: false, iso: null, date: null, timezone: "UTC" };
  }
}

function safeDateTimeIso(value: ICAL.Time): string | null {
  try {
    if (value.isDate) {
      return icalTimeToFields(value).date;
    }
    return icalTimeToFields(value).iso;
  } catch {
    return null;
  }
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function timeIdentity(value: ICAL.Time | null): string {
  if (!value) {
    return "";
  }
  return [
    value.isDate ? "date" : "date-time",
    value.zone?.tzid || "UTC",
    value.hour,
    value.minute,
    value.second,
  ].join(":");
}

function fallbackUidForEvent(
  event: ICAL.Event,
  recurrenceId: ICAL.Time | null,
  recurrenceRule: string | null,
  start: ReturnType<typeof icalTimeToFields>,
  end: ReturnType<typeof icalTimeToFields>,
  url: string | null,
): string {
  const recurrenceIdentity =
    recurrenceRule || recurrenceId ? "recurring" : "single";
  const localTimeIdentity =
    recurrenceIdentity === "recurring"
      ? timeIdentity(recurrenceId ?? event.startDate)
      : [start.iso ?? start.date ?? "", end.iso ?? end.date ?? ""].join("/");
  const canonical = [
    recurrenceIdentity,
    localTimeIdentity,
    event.summary || "Untitled event",
    event.location || "",
    event.description || "",
    url || "",
  ].join("\u001f");
  return `uidless-${stableHash(canonical)}`;
}

function parseRRule(event: ICAL.Event): string | null {
  try {
    const rrule = event.component.getFirstPropertyValue(
      "rrule",
    ) as ICAL.Recur | null;
    return rrule ? `RRULE:${rrule.toString()}` : null;
  } catch {
    return null;
  }
}

function parseExdates(event: ICAL.Event): string[] {
  const values: string[] = [];
  for (const property of event.component.getAllProperties("exdate")) {
    let propertyValues: ICAL.Time[];
    try {
      propertyValues = property.getValues() as ICAL.Time[];
    } catch {
      continue;
    }
    for (const value of propertyValues) {
      const normalized = safeDateTimeIso(value);
      if (normalized) {
        values.push(normalized);
      }
    }
  }
  return values;
}

function registerEmbeddedTimezones(component: ICAL.Component): void {
  for (const timezoneComponent of component.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(timezoneComponent);
    } catch {
      // Ignore malformed VTIMEZONE blocks and let ical.js fall back as needed.
    }
  }
}

function parseAlarms(component: ICAL.Component): CalendarReminderInput[] {
  const reminders: CalendarReminderInput[] = [];
  for (const alarmComponent of component.getAllSubcomponents("valarm")) {
    const action = String(
      alarmComponent.getFirstPropertyValue("action") ?? "",
    ).toUpperCase();
    if (action && action !== "DISPLAY" && action !== "AUDIO") {
      continue;
    }
    const trigger = alarmComponent.getFirstPropertyValue("trigger") as
      | ICAL.Duration
      | ICAL.Time
      | null;
    if (!trigger || !(trigger instanceof ICAL.Duration)) {
      continue;
    }
    const seconds = trigger.toSeconds();
    if (seconds <= 0) {
      reminders.push({
        minutesBefore: Math.max(0, Math.round(Math.abs(seconds) / 60)),
      });
      if (reminders.length >= MAX_CALENDAR_REMINDERS_PER_EVENT) {
        break;
      }
    }
  }
  return reminders;
}

function normalizeBareDateProperties(text: string): string {
  return text.replace(
    /^(DTSTART|DTEND|EXDATE|RECURRENCE-ID|RDATE)((?:;[^:\r\n]*)?):(\d{8}(?:,\d{8})*)$/gim,
    (line, name: string, params: string, value: string) => {
      if (/;VALUE=/i.test(params)) {
        return line;
      }
      return `${name};VALUE=DATE${params}:${value}`;
    },
  );
}

export type ExternalIcsCalendarRefreshCandidate = {
  id: number;
  ownerUserId: number;
  refreshIntervalMinutes: number;
  lastFetchedAt: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
};

export type ExternalIcsCalendarRefreshResult = {
  calendarId: number;
  ownerUserId: number;
  ok: boolean;
  refreshed: boolean;
  eventCount: number;
  status: number | null;
  error: string | null;
};

export function parseIcsCalendar(
  text: string,
  options: { maxEvents?: number } = {},
): ParsedIcsEvent[] {
  if (!looksLikeIcsCalendar(text)) {
    throw new Error("Input is not an iCalendar VCALENDAR feed.");
  }
  let jcal: unknown[];
  try {
    jcal = ICAL.parse(normalizeBareDateProperties(text)) as unknown[];
  } catch (error) {
    throw new Error(
      `Invalid iCalendar feed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const component = new ICAL.Component(jcal);
  registerEmbeddedTimezones(component);
  const maxEvents = options.maxEvents ?? MAX_EXTERNAL_ICS_EVENT_COUNT;
  if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) {
    throw new Error(
      "External ICS event limit must be a positive safe integer.",
    );
  }
  const events: ParsedIcsEvent[] = [];
  for (const vevent of component.getAllSubcomponents("vevent")) {
    if (events.length >= maxEvents) {
      throw new Error(
        `External ICS feed contains more than ${maxEvents} events.`,
      );
    }
    const event = new ICAL.Event(vevent);
    const start = safeTimeToFields(() => event.startDate);
    if (!start.iso && !start.date) {
      continue;
    }
    const end = safeTimeToFields(() => event.endDate);
    let recurrenceId: ICAL.Time | null = null;
    try {
      recurrenceId = vevent.getFirstPropertyValue(
        "recurrence-id",
      ) as ICAL.Time | null;
    } catch {
      recurrenceId = null;
    }
    const normalizedRecurrenceId = recurrenceId
      ? safeDateTimeIso(recurrenceId)
      : null;
    let url: string | null = null;
    try {
      url = (vevent.getFirstPropertyValue("url") as string | null) ?? null;
    } catch {
      url = null;
    }
    const recurrenceRule = parseRRule(event);
    events.push({
      uid:
        event.uid ||
        fallbackUidForEvent(
          event,
          recurrenceId,
          recurrenceRule,
          start,
          end,
          url,
        ),
      recurrenceId: normalizedRecurrenceId,
      title: event.summary || "Untitled event",
      description: event.description || "",
      location: event.location || "",
      startAt: start.iso,
      endAt: end.iso,
      startDate: start.date,
      endDate: end.date,
      allDay: start.allDay,
      timezone: start.timezone,
      recurrenceRule,
      exdates: parseExdates(event),
      reminders: parseAlarms(vevent),
      url,
      rawJson: rawJsonForIcsEvent(vevent),
    });
  }
  return events;
}

function refreshIntervalMinutesOrDefault(
  value: number,
  fallback: number,
): number {
  return Number.isFinite(value) && value > 0
    ? Math.max(5, Math.round(value))
    : fallback;
}

function parseIsoTimeMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function failureBackoffMinutes(consecutiveFailures: number): number {
  const index = Math.max(
    0,
    Math.min(consecutiveFailures, EXTERNAL_ICS_FAILURE_BACKOFF_MINUTES.length) -
      1,
  );
  return (
    EXTERNAL_ICS_FAILURE_BACKOFF_MINUTES[index] ??
    EXTERNAL_ICS_FAILURE_BACKOFF_MINUTES.at(-1) ??
    1440
  );
}

export function externalIcsCalendarIsDueForRefresh(
  calendar: Pick<
    ExternalIcsCalendarRefreshCandidate,
    | "id"
    | "refreshIntervalMinutes"
    | "lastFetchedAt"
    | "lastErrorAt"
    | "consecutiveFailures"
  >,
  now: Date = new Date(),
): boolean {
  // Refresh timestamps are stored as UTC ISO-8601 strings. Date.parse handles
  // the historic millisecond precision variants emitted by SQLite and JS, while
  // the elapsed-time comparison below avoids local-timezone/DST interpretation.
  const lastFetchedMs = parseIsoTimeMs(calendar.lastFetchedAt);
  if (lastFetchedMs === null) {
    return true;
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return false;
  }
  const delayMinutes =
    calendar.consecutiveFailures > 0
      ? failureBackoffMinutes(calendar.consecutiveFailures)
      : refreshIntervalMinutesOrDefault(
          calendar.refreshIntervalMinutes,
          DEFAULT_EXTERNAL_ICS_REFRESH_INTERVAL_MINUTES,
        );
  const baseMs =
    calendar.consecutiveFailures > 0
      ? (parseIsoTimeMs(calendar.lastErrorAt) ?? lastFetchedMs)
      : lastFetchedMs;
  // If the host clock moves backward, or persisted timestamps are somehow in
  // the future, the negative elapsed time deliberately leaves the calendar not
  // due until wall time catches up; this avoids a tight retry loop.
  return nowMs - baseMs >= delayMinutes * 60_000;
}

export function listDueExternalIcsCalendarRefreshes(
  database: Database,
  now: Date = new Date(),
  options: { limit?: number } = {},
): ExternalIcsCalendarRefreshCandidate[] {
  const limit =
    Number.isFinite(options.limit) && Number(options.limit) > 0
      ? Math.round(Number(options.limit))
      : DEFAULT_EXTERNAL_ICS_DUE_REFRESH_LIMIT;
  const nowIso = now.toISOString();
  const rows = database
    .query<ExternalIcsCalendarRefreshCandidate, [string, string, number]>(
      `
        SELECT id, 1 AS ownerUserId,
          refresh_interval_minutes AS refreshIntervalMinutes,
          last_fetched_at AS lastFetchedAt,
          last_error_at AS lastErrorAt,
          consecutive_failures AS consecutiveFailures
        FROM external_ics_calendars
        WHERE enabled = 1
          AND (
            last_fetched_at IS NULL
            OR (
              consecutive_failures > 0
              AND COALESCE(last_error_at, last_fetched_at) <= strftime(
                '%Y-%m-%dT%H:%M:%fZ',
                ?,
                '-' || CASE
                  WHEN consecutive_failures <= 1 THEN 15
                  WHEN consecutive_failures = 2 THEN 60
                  WHEN consecutive_failures = 3 THEN 240
                  WHEN consecutive_failures = 4 THEN 360
                  WHEN consecutive_failures = 5 THEN 720
                  ELSE 1440
                END || ' minutes'
              )
            )
            OR (
              consecutive_failures <= 0
              AND last_fetched_at <= strftime(
                '%Y-%m-%dT%H:%M:%fZ',
                ?,
                '-' || MAX(refresh_interval_minutes, ${MIN_EXTERNAL_ICS_REFRESH_INTERVAL_MINUTES}) || ' minutes'
              )
            )
          )
        ORDER BY COALESCE(last_fetched_at, created_at) ASC, id ASC
        LIMIT ?
      `,
    )
    .all(nowIso, nowIso, limit);
  const due: ExternalIcsCalendarRefreshCandidate[] = [];
  for (const row of rows) {
    if (!externalIcsCalendarIsDueForRefresh(row, now)) {
      continue;
    }
    due.push(row);
    if (due.length >= limit) {
      break;
    }
  }
  return due;
}

export async function refreshDueExternalIcsCalendars(
  database: Database,
  options: {
    fetchImpl?: typeof fetch;
    limit?: number;
    now?: Date;
    resolveHostname?: ResolveHostname;
    timeoutMs?: number;
  } = {},
): Promise<ExternalIcsCalendarRefreshResult[]> {
  const dueOptions =
    typeof options.limit === "number" ? { limit: options.limit } : {};
  const dueCalendars = listDueExternalIcsCalendarRefreshes(
    database,
    options.now ?? new Date(),
    dueOptions,
  );
  const results: ExternalIcsCalendarRefreshResult[] = [];
  for (const calendar of dueCalendars) {
    try {
      const result = await refreshExternalIcsCalendar(
        database,
        calendar.id,
        options.fetchImpl ?? fetch,
        {
          ...(options.resolveHostname
            ? { resolveHostname: options.resolveHostname }
            : {}),
          ...(typeof options.timeoutMs === "number"
            ? { timeoutMs: options.timeoutMs }
            : {}),
        },
      );
      results.push({
        calendarId: calendar.id,
        ownerUserId: calendar.ownerUserId,
        ok: true,
        refreshed: result.refreshed,
        eventCount: result.eventCount,
        status: result.status,
        error: null,
      });
    } catch (error) {
      results.push({
        calendarId: calendar.id,
        ownerUserId: calendar.ownerUserId,
        ok: false,
        refreshed: false,
        eventCount: 0,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function refreshExternalIcsCalendar(
  database: Database,
  calendarId: number,
  fetchImpl: typeof fetch = fetch,
  options: {
    resolveHostname?: ResolveHostname;
    timeoutMs?: number;
  } = {},
): Promise<{ refreshed: boolean; eventCount: number; status: number }> {
  const calendar = database
    .query<
      {
        id: number;
        url: string;
        etag: string | null;
        lastModified: string | null;
      },
      [number]
    >(
      `SELECT id, url, etag, last_modified AS lastModified FROM external_ics_calendars WHERE id = ?`,
    )
    .get(calendarId);
  if (!calendar) {
    throw new Error("External calendar not found.");
  }
  const headers = new Headers();
  if (calendar.etag) {
    headers.set("If-None-Match", calendar.etag);
  }
  if (calendar.lastModified) {
    headers.set("If-Modified-Since", calendar.lastModified);
  }
  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? Math.trunc(options.timeoutMs)
      : DEFAULT_EXTERNAL_ICS_REFRESH_TIMEOUT_MS;
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort(
      new Error(`External ICS refresh timed out after ${timeoutMs}ms.`),
    );
  }, timeoutMs);
  try {
    const safeUrlOptions = {
      label: "External ICS URL",
      ...(options.resolveHostname
        ? { resolveHostname: options.resolveHostname }
        : {}),
    };
    let url = await assertSafeOutboundHttpUrl(calendar.url, safeUrlOptions);
    const fetchExternalIcs =
      fetchImpl === fetch
        ? createSafeOutboundHttpFetch(safeUrlOptions)
        : fetchImpl;
    let response: Response | null = null;
    for (
      let redirectCount = 0;
      redirectCount <= MAX_EXTERNAL_ICS_REDIRECTS;
      redirectCount += 1
    ) {
      response = await fetchExternalIcs(url, {
        headers,
        redirect: "manual",
        signal: abortController.signal,
      });
      if (!isHttpRedirectStatus(response.status)) {
        break;
      }
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (redirectCount === MAX_EXTERNAL_ICS_REDIRECTS) {
        throw new Error("External ICS URL redirected too many times.");
      }
      url = await resolveSafeRedirectUrl(url, location, safeUrlOptions);
    }
    if (!response) {
      throw new Error("External ICS URL fetch failed.");
    }
    if (response.status === 304) {
      const now = new Date().toISOString();
      database
        .query(
          `UPDATE external_ics_calendars SET last_fetched_at = ?, last_success_at = ?, last_error_at = NULL, last_error = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, now, calendarId);
      return { refreshed: false, eventCount: 0, status: 304 };
    }
    if (!response.ok) {
      throw new Error(`ICS refresh failed with HTTP ${response.status}`);
    }
    assertIcsResponseContentType(response, String(url));
    const text = await readLimitedTextResponse(response, {
      label: "External ICS response",
      maxBytes: MAX_EXTERNAL_ICS_RESPONSE_BYTES,
    });
    assertIcsResponseBody(text, String(url));
    const events = parseIcsCalendar(text);
    replaceExternalCalendarCache(database, calendarId, events, {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    });
    return {
      refreshed: true,
      eventCount: events.length,
      status: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markExternalCalendarFetchError(database, calendarId, message);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
