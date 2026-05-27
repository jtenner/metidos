/**
 * @file src/bun/pi/metidos/calendar.ts
 * @description Pi-native Metidos calendar tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import type {
  CalendarReminderInput,
  RpcCalendarOccurrence,
} from "../../calendar/types";
import {
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  textToolResult,
  withMetidosToolTelemetry,
} from "./shared";

const CalendarDateTimeString = (description: string) =>
  Type.String({ description, minLength: 1 });

const ListCalendarEventsToolParameters = Type.Object({
  calendarId: Type.Optional(
    Type.Integer({
      description:
        "Optional calendar id filter from list_calendars. Omit this field to list events from all visible calendars; do not pass null.",
      minimum: 1,
    }),
  ),
  end: CalendarDateTimeString(
    "Required inclusive/exclusive window end as an ISO date-time or date string.",
  ),
  start: CalendarDateTimeString(
    "Required window start as an ISO date-time or date string.",
  ),
  timezone: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional IANA timezone such as America/New_York for interpreting date-only windows. Omit or pass null to use the host default.",
      }),
      Type.Null(),
    ]),
  ),
});

const NewCalendarEventToolParameters = Type.Object({
  allDay: Type.Optional(
    Type.Boolean({
      description:
        "Optional all-day flag. Set true for date-only events; omit for timed events.",
    }),
  ),
  calendarId: Type.Integer({
    description:
      "Required writable local calendar id from list_calendars. External/read-only calendars cannot be used.",
    minimum: 1,
  }),
  description: Type.Optional(
    Type.Union([
      Type.String({ description: "Optional event description/notes." }),
      Type.Null(),
    ]),
  ),
  endAt: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional timed-event end timestamp. Use with startAt for non-all-day events; omit or pass null for all-day events.",
      }),
      Type.Null(),
    ]),
  ),
  endDate: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional all-day event end date (YYYY-MM-DD). Use with startDate for all-day events; omit or pass null for timed events.",
      }),
      Type.Null(),
    ]),
  ),
  location: Type.Optional(
    Type.Union([
      Type.String({ description: "Optional event location." }),
      Type.Null(),
    ]),
  ),
  recurrenceRule: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional RFC 5545 RRULE string for recurrence, for example FREQ=WEEKLY;COUNT=4. Omit or pass null for one-time events.",
      }),
      Type.Null(),
    ]),
  ),
  reminders: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Optional(
          Type.Union([Type.Number(), Type.String(), Type.Null()]),
        ),
        minutesBefore: Type.Number({
          description:
            "Required reminder offset in minutes before the event start.",
          minimum: 0,
        }),
      }),
      {
        description:
          "Optional reminders array. Omit for default/no reminders; each item needs minutesBefore.",
      },
    ),
  ),
  startAt: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional timed-event start timestamp. Required with endAt for non-all-day events; omit or pass null for all-day events.",
      }),
      Type.Null(),
    ]),
  ),
  startDate: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional all-day event start date (YYYY-MM-DD). Required with endDate for all-day events; omit or pass null for timed events.",
      }),
      Type.Null(),
    ]),
  ),
  timezone: Type.String({
    description:
      "Required IANA timezone for the event, for example America/New_York.",
    minLength: 1,
  }),
  title: Type.String({ description: "Required event title.", minLength: 1 }),
});

const ModifyCalendarEventToolParameters = Type.Object({
  allDay: Type.Optional(
    Type.Union([
      Type.Boolean({
        description:
          "Optional all-day flag. Set true for date-only events or false for timed events; omit to preserve the current value.",
      }),
      Type.Null(),
    ]),
  ),
  calendarId: Type.Optional(
    Type.Integer({
      description:
        "Optional destination writable local calendar id. Omit to keep the event in its current calendar.",
      minimum: 1,
    }),
  ),
  description: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional event description/notes. Pass an empty string to clear.",
      }),
      Type.Null(),
    ]),
  ),
  endAt: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional timed-event end timestamp. Use with startAt for non-all-day events.",
      }),
      Type.Null(),
    ]),
  ),
  endDate: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional all-day event end date (YYYY-MM-DD). Use with startDate for all-day events.",
      }),
      Type.Null(),
    ]),
  ),
  eventId: Type.Integer({
    description:
      "Required local calendar event id. Use eventId from list_calendar_events or show_calendar_event; external ICS events cannot be modified.",
    minimum: 1,
  }),
  expectedVersion: Type.Optional(
    Type.Union([
      Type.Integer({
        description:
          "Optional optimistic concurrency version from list_calendar_events/show_calendar_event. Omit when the current version is unknown.",
        minimum: 1,
      }),
      Type.Null(),
    ]),
  ),
  location: Type.Optional(
    Type.Union([
      Type.String({
        description: "Optional event location. Pass an empty string to clear.",
      }),
      Type.Null(),
    ]),
  ),
  occurrenceStart: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional original occurrence start for recurring-event scope just_this or after_this. Use originalStart from list_calendar_events/show_calendar_event.",
      }),
      Type.Null(),
    ]),
  ),
  recurrenceRule: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional RFC 5545 RRULE string. Omit to preserve recurrence; pass null to clear recurrence.",
      }),
      Type.Null(),
    ]),
  ),
  reminders: Type.Optional(
    Type.Union([
      Type.Array(
        Type.Object({
          id: Type.Optional(
            Type.Union([Type.Number(), Type.String(), Type.Null()]),
          ),
          minutesBefore: Type.Number({
            description:
              "Required reminder offset in minutes before the event start.",
            minimum: 0,
          }),
        }),
        {
          description:
            "Optional reminders array. Omit or pass null to preserve current reminders; pass [] to clear reminders.",
        },
      ),
      Type.Null(),
    ]),
  ),
  scope: Type.Optional(
    Type.Union([
      Type.Literal("whole_series"),
      Type.Literal("after_this"),
      Type.Literal("just_this"),
      Type.Null(),
    ]),
  ),
  startAt: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional timed-event start timestamp. Use with endAt for non-all-day events.",
      }),
      Type.Null(),
    ]),
  ),
  startDate: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional all-day event start date (YYYY-MM-DD). Use with endDate for all-day events.",
      }),
      Type.Null(),
    ]),
  ),
  timezone: Type.Optional(
    Type.String({
      description:
        "Optional IANA timezone for the event, for example America/New_York. Omit to preserve current timezone.",
      minLength: 1,
    }),
  ),
  title: Type.Optional(
    Type.String({ description: "Optional event title.", minLength: 1 }),
  ),
});

const ShowCalendarEventToolParameters = Type.Object({
  occurrenceId: Type.String({
    description:
      "Required exact occurrence id returned by list_calendar_events.",
    minLength: 1,
  }),
});

function assertCalendarToolsAllowed(scope: PiMetidosToolScope): void {
  if (!scope.calendarAccessEnabled) {
    throw new Error(
      "Calendar tools require Calendar access for the current thread.",
    );
  }
}

function assertCalendarHostTool<T>(tool: T | undefined): T {
  if (!tool) {
    throw new Error("Calendar tools require a Metidos calendar tool host.");
  }
  return tool;
}

function escapeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatEventTime(
  occurrence: RpcCalendarOccurrence,
  field: "start" | "end",
): string {
  if (occurrence.allDay) {
    return field === "start"
      ? (occurrence.startDate ?? "")
      : (occurrence.endDate ?? "");
  }
  return field === "start"
    ? (occurrence.startAt ?? "")
    : (occurrence.endAt ?? "");
}

function calendarRowsMarkdown(
  calendars: Array<{
    id: number;
    permission: string;
    sourceType: string;
    title: string;
  }>,
): string {
  const lines = [
    "| Id | Source type | Title | Permission |",
    "|---:|---|---|---|",
    ...calendars.map(
      (calendar) =>
        `| ${calendar.id} | ${escapeCell(calendar.sourceType)} | ${escapeCell(calendar.title)} | ${escapeCell(calendar.permission)} |`,
    ),
  ];
  return lines.join("\n");
}

function eventRowsMarkdown(events: RpcCalendarOccurrence[]): string {
  const lines = [
    "| Id | Source type | Calendar id | Start | End | Title | Location | Recurring | Permission |",
    "|---|---|---:|---|---|---|---|---|---|",
    ...events.map(
      (event) =>
        `| ${escapeCell(event.occurrenceId)} | ${escapeCell(event.sourceType)} | ${event.calendarId} | ${escapeCell(formatEventTime(event, "start"))} | ${escapeCell(formatEventTime(event, "end"))} | ${escapeCell(event.title)} | ${escapeCell(event.location)} | ${yesNo(event.isRecurring)} | ${escapeCell(event.permission)} |`,
    ),
  ];
  return lines.join("\n");
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function deleteNullishOptionalFields(
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (record[key] === null || typeof record[key] === "undefined") {
      delete record[key];
    }
  }
}

function parseOccurrenceStart(occurrenceId: string): Date {
  const localMatch = /^local:\d+:(.+)$/u.exec(occurrenceId);
  const candidate =
    localMatch?.[1] ??
    occurrenceId.match(
      /(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?)$/u,
    )?.[1];
  if (!candidate) {
    return new Date();
  }
  const parsed = new Date(
    candidate.length === 10 ? `${candidate}T00:00:00.000Z` : candidate,
  );
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function occurrenceLookupWindow(occurrenceId: string): {
  start: string;
  end: string;
} {
  const center = parseOccurrenceStart(occurrenceId);
  const start = new Date(center.getTime() - 36 * 60 * 60 * 1000);
  const end = new Date(center.getTime() + 36 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function createPiMetidosCalendarTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description:
          "List visible Metidos calendars, including read-only external ICS calendars. Requires Calendar access.",
        execute: async () => {
          assertCalendarToolsAllowed(scope);
          const getCalendarBootstrap = assertCalendarHostTool(
            host.getCalendarBootstrap,
          );
          const bootstrap = await getCalendarBootstrap();
          const calendars = [
            ...bootstrap.calendars.map((calendar) => ({
              id: calendar.id,
              permission: calendar.permission,
              sourceType: calendar.sourceType,
              title: calendar.title,
              visible: calendar.visible,
              writable:
                calendar.permission === "owner" ||
                calendar.permission === "write",
            })),
            ...bootstrap.externalCalendars.map((calendar) => ({
              id: calendar.id,
              permission: "read",
              sourceType: calendar.sourceType,
              title: calendar.title,
              visible: calendar.visible,
              writable: false,
            })),
          ];
          return textToolResult(
            calendars.length
              ? `Calendars:\n\n${calendarRowsMarkdown(calendars)}`
              : "No calendars found.",
            { calendars },
          );
        },
        label: "List Calendars",
        name: "list_calendars",
        parameters: Type.Object({}),
        promptSnippet: "List visible local and external Metidos calendars",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "List visible calendar event occurrences in a required start/end window. Optional calendarId filters to one calendar; omit calendarId to search all visible calendars (do not pass null). Requires Calendar access.",
        execute: async (_toolCallId, params) => {
          assertCalendarToolsAllowed(scope);
          const listCalendarOccurrences = assertCalendarHostTool(
            host.listCalendarOccurrences,
          );
          const events = (
            await listCalendarOccurrences({
              end: params.end,
              start: params.start,
              timezone: params.timezone ?? null,
            })
          ).filter((event) =>
            typeof params.calendarId === "number"
              ? event.calendarId === params.calendarId
              : true,
          );
          return textToolResult(
            events.length
              ? `Calendar events from ${params.start} to ${params.end}:\n\n${eventRowsMarkdown(events)}`
              : `No calendar events found from ${params.start} to ${params.end}.`,
            {
              end: params.end,
              events,
              start: params.start,
              timezone: params.timezone ?? null,
            },
          );
        },
        label: "List Calendar Events",
        name: "list_calendar_events",
        parameters: ListCalendarEventsToolParameters,
        prepareArguments: (args) => {
          if (!args || typeof args !== "object") return args as never;
          const next = { ...(args as Record<string, unknown>) };
          deleteNullishOptionalFields(next, ["calendarId", "timezone"]);
          const calendarId = parsePositiveInteger(next.calendarId);
          if (calendarId) next.calendarId = calendarId;
          return next as never;
        },
        promptSnippet:
          "List visible calendar event occurrences in a time window",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Show one visible calendar event occurrence by exact occurrenceId returned from list_calendar_events. Requires Calendar access.",
        execute: async (_toolCallId, params) => {
          assertCalendarToolsAllowed(scope);
          const window = occurrenceLookupWindow(params.occurrenceId);
          const listCalendarOccurrences = assertCalendarHostTool(
            host.listCalendarOccurrences,
          );
          const event = (
            await listCalendarOccurrences({ ...window, timezone: null })
          ).find((candidate) => candidate.occurrenceId === params.occurrenceId);
          if (!event) {
            throw new Error("Calendar event not found or not visible.");
          }
          return textToolResult(
            `Calendar event:\n\n${eventRowsMarkdown([event])}`,
            { event },
          );
        },
        label: "Show Calendar Event",
        name: "show_calendar_event",
        parameters: ShowCalendarEventToolParameters,
        promptSnippet: "Show details for one visible calendar event occurrence",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Create a new local calendar event. Requires calendarId, timezone, title, and either timed startAt/endAt or all-day startDate/endDate. Requires Calendar access and a writable local calendarId.",
        execute: async (_toolCallId, params) => {
          assertCalendarToolsAllowed(scope);
          const createCalendarEvent = assertCalendarHostTool(
            host.createCalendarEvent,
          );
          const event = await createCalendarEvent({
            allDay: params.allDay ?? null,
            calendarId: params.calendarId,
            description: params.description ?? null,
            endAt: params.endAt ?? null,
            endDate: params.endDate ?? null,
            location: params.location ?? null,
            recurrenceRule: params.recurrenceRule ?? null,
            reminders: (params.reminders ?? null) as
              | CalendarReminderInput[]
              | null,
            startAt: params.startAt ?? null,
            startDate: params.startDate ?? null,
            timezone: params.timezone,
            title: params.title,
          });
          return textToolResult(
            `Created calendar event ${event.id}: ${event.title}.`,
            { event },
          );
        },
        label: "New Calendar Event",
        name: "new_calendar_event",
        parameters: NewCalendarEventToolParameters,
        prepareArguments: (args) => {
          if (!args || typeof args !== "object") return args as never;
          const next = { ...(args as Record<string, unknown>) };
          deleteNullishOptionalFields(next, ["allDay", "reminders"]);
          const calendarId = parsePositiveInteger(next.calendarId);
          if (calendarId) next.calendarId = calendarId;
          return next as never;
        },
        promptSnippet: "Create a new local Metidos calendar event",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Modify an existing writable local calendar event. Requires eventId from list_calendar_events or show_calendar_event; external ICS events cannot be modified. Requires Calendar access.",
        execute: async (_toolCallId, params) => {
          assertCalendarToolsAllowed(scope);
          const updateCalendarEvent = assertCalendarHostTool(
            host.updateCalendarEvent,
          );
          const update = { ...params } as Record<string, unknown>;
          for (const [key, value] of Object.entries(update)) {
            if (typeof value === "undefined") {
              delete update[key];
            }
          }
          const event = await updateCalendarEvent(update as never);
          return textToolResult(
            `Modified calendar event ${event.id}: ${event.title}.`,
            { event },
          );
        },
        label: "Modify Calendar Event",
        name: "modify_calendar_event",
        parameters: ModifyCalendarEventToolParameters,
        prepareArguments: (args) => {
          if (!args || typeof args !== "object") return args as never;
          const next = { ...(args as Record<string, unknown>) };
          const eventId = parsePositiveInteger(next.eventId);
          if (eventId) next.eventId = eventId;
          const calendarId = parsePositiveInteger(next.calendarId);
          if (calendarId) next.calendarId = calendarId;
          const expectedVersion = parsePositiveInteger(next.expectedVersion);
          if (expectedVersion) next.expectedVersion = expectedVersion;
          deleteNullishOptionalFields(next, ["calendarId", "expectedVersion"]);
          return next as never;
        },
        promptGuidelines: [
          "Use list_calendar_events or show_calendar_event first, then pass the local numeric eventId and expectedVersion when available.",
          "For recurring events, pass originalStart as occurrenceStart with scope just_this or after_this when changing only one occurrence or future occurrences.",
          "Pass recurrenceRule: null only when the user wants to remove recurrence; omit recurrenceRule to preserve it.",
        ],
        promptSnippet: "Modify an existing local Metidos calendar event",
      }),
    ),
  ];
}
