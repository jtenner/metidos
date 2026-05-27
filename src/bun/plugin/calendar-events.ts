/**
 * @file src/bun/plugin/calendar-events.ts
 * @description Permissioned Plugin System v1 calendar and event host API helpers.
 */

import { normalizeCalendarOccurrenceWindow } from "../calendar/occurrence-window";
import type {
  CalendarEventInput,
  CalendarEventUpdateInput,
  RpcCalendar,
  RpcCalendarEvent,
  RpcCalendarOccurrence,
} from "../calendar/types";
import { resolveSingletonLocalSettingsUserId } from "../db";
import { PluginContextError, PluginPermissionError } from "./context";

export const PLUGIN_CALENDAR_LIST_PERMISSION = "calendar:list";
export const PLUGIN_CALENDAR_CREATE_PERMISSION = "calendar:create";
export const PLUGIN_CALENDAR_MODIFY_PERMISSION = "calendar:modify";
export const PLUGIN_CALENDAR_DELETE_PERMISSION = "calendar:delete";
export const PLUGIN_EVENTS_LIST_PERMISSION = "events:list";
export const PLUGIN_EVENTS_GET_PERMISSION = "events:get";
export const PLUGIN_EVENTS_CREATE_PERMISSION = "events:create";
export const PLUGIN_EVENTS_MODIFY_PERMISSION = "events:modify";
export const PLUGIN_EVENTS_DELETE_PERMISSION = "events:delete";

export type PluginCalendarEventsOperation =
  | "calendar.create"
  | "calendar.delete"
  | "calendar.list"
  | "calendar.modify"
  | "events.create"
  | "events.delete"
  | "events.get"
  | "events.list"
  | "events.modify";

export type PluginCalendarEventsContext = {
  contextKind?: string | null;
  ownerUserId?: number | null;
};

export type PluginCalendarListParams = {
  includeExternal?: boolean | null;
};

export type PluginCalendarEventsHost = {
  createCalendar(
    userId: number,
    params: Record<string, unknown>,
  ): Promise<RpcCalendar> | RpcCalendar;
  createEvent(
    userId: number,
    params: CalendarEventInput,
  ): Promise<RpcCalendarEvent> | RpcCalendarEvent;
  deleteCalendar(
    userId: number,
    calendarId: number,
  ):
    | Promise<{ calendarId: number; success: boolean }>
    | {
        calendarId: number;
        success: boolean;
      };
  deleteEvent(
    userId: number,
    params: CalendarEventUpdateInput,
  ):
    | Promise<{ eventId: number; success: boolean }>
    | {
        eventId: number;
        success: boolean;
      };
  getEvent(
    userId: number,
    eventId: number,
  ): Promise<RpcCalendarEvent | null> | RpcCalendarEvent | null;
  listCalendars(
    userId: number,
    params?: PluginCalendarListParams,
  ):
    | Promise<readonly (Record<string, unknown> | RpcCalendar)[]>
    | readonly (Record<string, unknown> | RpcCalendar)[];
  listEvents(
    userId: number,
    params: { end: string; start: string; timezone?: string | null },
  ): Promise<RpcCalendarOccurrence[]> | RpcCalendarOccurrence[];
  updateCalendar(
    userId: number,
    calendarId: number,
    params: Record<string, unknown>,
  ): Promise<RpcCalendar> | RpcCalendar;
  updateEvent(
    userId: number,
    params: CalendarEventUpdateInput,
  ): Promise<RpcCalendarEvent> | RpcCalendarEvent;
};

export class PluginCalendarEventsError extends Error {
  readonly code: string;

  constructor(input: { cause?: unknown; code: string; message: string }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginCalendarEventsError";
    this.code = input.code;
  }
}

const OPERATION_PERMISSIONS: Record<PluginCalendarEventsOperation, string> = {
  "calendar.create": PLUGIN_CALENDAR_CREATE_PERMISSION,
  "calendar.delete": PLUGIN_CALENDAR_DELETE_PERMISSION,
  "calendar.list": PLUGIN_CALENDAR_LIST_PERMISSION,
  "calendar.modify": PLUGIN_CALENDAR_MODIFY_PERMISSION,
  "events.create": PLUGIN_EVENTS_CREATE_PERMISSION,
  "events.delete": PLUGIN_EVENTS_DELETE_PERMISSION,
  "events.get": PLUGIN_EVENTS_GET_PERMISSION,
  "events.list": PLUGIN_EVENTS_LIST_PERMISSION,
  "events.modify": PLUGIN_EVENTS_MODIFY_PERMISSION,
};

export function isPluginCalendarEventsOperation(
  value: string,
): value is PluginCalendarEventsOperation {
  return Object.hasOwn(OPERATION_PERMISSIONS, value);
}

export function permissionForPluginCalendarEventsOperation(
  operation: PluginCalendarEventsOperation,
): string {
  return OPERATION_PERMISSIONS[operation];
}

export function assertPluginCalendarEventsPermission(input: {
  operation: PluginCalendarEventsOperation;
  permissions: readonly string[];
}): void {
  const permission = permissionForPluginCalendarEventsOperation(
    input.operation,
  );
  if (!input.permissions.includes(permission)) {
    throw new PluginPermissionError({
      code: "plugin_permission_error",
      message: `metidos.${input.operation} requires ${permission}.`,
      permission,
    });
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginCalendarEventsError({
      code: "invalid_plugin_calendar_request",
      message: `${label} must be an object.`,
    });
  }
  return value as Record<string, unknown>;
}

function optionalRecordValue(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  return recordValue(value, "Plugin calendar/events request");
}

function integerField(
  record: Record<string, unknown>,
  primaryKey: string,
  fallbackKey: string,
): number {
  const value = record[primaryKey] ?? record[fallbackKey];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new PluginCalendarEventsError({
    code: "invalid_plugin_calendar_request",
    message: `Plugin calendar/events request requires a positive integer ${primaryKey}.`,
  });
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new PluginCalendarEventsError({
    code: "invalid_plugin_calendar_request",
    message: `Plugin calendar/events request requires a non-empty ${key}.`,
  });
}

function pluginCalendarUserId(input: {
  context?: PluginCalendarEventsContext | null | undefined;
  operation: PluginCalendarEventsOperation;
}): number {
  const contextKind = input.context?.contextKind ?? null;
  if (
    contextKind !== "threadTool" &&
    contextKind !== "cron" &&
    contextKind !== "userCron"
  ) {
    throw new PluginContextError({
      code: "plugin_context_error",
      contextKind,
      message: `metidos.${input.operation} requires an authenticated local-operator plugin callback context.`,
    });
  }
  return resolveSingletonLocalSettingsUserId();
}

function assertDeleteConfirmation(input: {
  context?: PluginCalendarEventsContext | null | undefined;
  operation: "calendar.delete" | "events.delete";
  params: Record<string, unknown>;
}): void {
  if (input.context?.contextKind === "cron") {
    throw new PluginContextError({
      code: "plugin_confirmation_unavailable",
      contextKind: input.context?.contextKind ?? null,
      message: `metidos.${input.operation} cannot run in cron because confirmation is unavailable.`,
    });
  }
  if (input.params.confirmed === true || input.params.confirmation === true) {
    return;
  }
  throw new PluginCalendarEventsError({
    code: "plugin_confirmation_required",
    message: `metidos.${input.operation} requires confirmation: true.`,
  });
}

function calendarListParams(
  params: Record<string, unknown>,
): PluginCalendarListParams {
  return {
    includeExternal: params.includeExternal === true,
  };
}

function eventListParams(params: Record<string, unknown>): {
  end: string;
  start: string;
  timezone?: string | null;
} {
  const timezone = params.timezone;
  const window = normalizeCalendarOccurrenceWindow({
    end: stringField(params, "end"),
    start: stringField(params, "start"),
  });
  return {
    ...window,
    ...(typeof timezone === "string" || timezone === null ? { timezone } : {}),
  };
}

function calendarEventInput(
  params: Record<string, unknown>,
): CalendarEventInput {
  return params as CalendarEventInput;
}

function calendarEventUpdateInput(
  params: Record<string, unknown>,
): CalendarEventUpdateInput {
  return {
    ...params,
    eventId: integerField(params, "eventId", "id"),
  } as CalendarEventUpdateInput;
}

export async function executePluginCalendarEventsOperation(input: {
  context?: PluginCalendarEventsContext | null;
  host: PluginCalendarEventsHost;
  operation: PluginCalendarEventsOperation;
  params?: unknown;
  permissions: readonly string[];
}): Promise<unknown> {
  assertPluginCalendarEventsPermission({
    operation: input.operation,
    permissions: input.permissions,
  });

  const params = optionalRecordValue(input.params);
  if (
    input.operation === "calendar.delete" ||
    input.operation === "events.delete"
  ) {
    assertDeleteConfirmation({
      context: input.context,
      operation: input.operation,
      params,
    });
  }
  const userId = pluginCalendarUserId({
    context: input.context,
    operation: input.operation,
  });

  switch (input.operation) {
    case "calendar.list":
      return await input.host.listCalendars(userId, calendarListParams(params));
    case "calendar.create":
      return await input.host.createCalendar(userId, params);
    case "calendar.modify": {
      const calendarId = integerField(params, "calendarId", "id");
      return await input.host.updateCalendar(userId, calendarId, {
        ...params,
        calendarId,
      });
    }
    case "calendar.delete":
      return await input.host.deleteCalendar(
        userId,
        integerField(params, "calendarId", "id"),
      );
    case "events.list":
      return await input.host.listEvents(userId, eventListParams(params));
    case "events.get":
      return await input.host.getEvent(
        userId,
        integerField(params, "eventId", "id"),
      );
    case "events.create":
      return await input.host.createEvent(userId, calendarEventInput(params));
    case "events.modify":
      return await input.host.updateEvent(
        userId,
        calendarEventUpdateInput(params),
      );
    case "events.delete":
      return await input.host.deleteEvent(
        userId,
        calendarEventUpdateInput(params),
      );
  }
}
