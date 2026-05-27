/**
 * @file src/bun/plugin/calendar-events.test.ts
 * @description Tests for Plugin System v1 calendar and events host API permissions and context rules.
 */

import { describe, expect, it } from "bun:test";
import {
  executePluginCalendarEventsOperation,
  type PluginCalendarEventsHost,
} from "./calendar-events";
import { PluginContextError, PluginPermissionError } from "./context";

function makeHost(calls: unknown[] = []): PluginCalendarEventsHost {
  return {
    createCalendar(userId, params) {
      calls.push({ operation: "calendar.create", params, userId });
      return { id: 1, title: String(params.title ?? "Untitled") } as never;
    },
    createEvent(userId, params) {
      calls.push({ operation: "events.create", params, userId });
      return { id: 2, ...params } as never;
    },
    deleteCalendar(userId, calendarId) {
      calls.push({ calendarId, operation: "calendar.delete", userId });
      return { calendarId, success: true };
    },
    deleteEvent(userId, params) {
      calls.push({ operation: "events.delete", params, userId });
      return { eventId: params.eventId, success: true };
    },
    getEvent(userId, eventId) {
      calls.push({ eventId, operation: "events.get", userId });
      return { id: eventId } as never;
    },
    listCalendars(userId, params) {
      calls.push({ operation: "calendar.list", params, userId });
      return [{ id: 1, title: "Personal" }] as never;
    },
    listEvents(userId, params) {
      calls.push({ operation: "events.list", params, userId });
      return [{ eventId: 2, occurrenceId: "2:2026" }] as never;
    },
    updateCalendar(userId, calendarId, params) {
      calls.push({ calendarId, operation: "calendar.modify", params, userId });
      return { id: calendarId, ...params } as never;
    },
    updateEvent(userId, params) {
      calls.push({ operation: "events.modify", params, userId });
      return { id: params.eventId, ...params } as never;
    },
  };
}

describe("executePluginCalendarEventsOperation", () => {
  it("routes calendar and event operations with matching permissions", async () => {
    const calls: unknown[] = [];
    const host = makeHost(calls);
    const context = { contextKind: "threadTool", ownerUserId: 7 };

    await expect(
      executePluginCalendarEventsOperation({
        context,
        host,
        operation: "calendar.list",
        permissions: ["calendar:list"],
      }),
    ).resolves.toEqual([{ id: 1, title: "Personal" }]);

    await expect(
      executePluginCalendarEventsOperation({
        context,
        host,
        operation: "events.list",
        params: {
          end: "2026-06-02T00:00:00Z",
          start: "2026-06-01T00:00:00Z",
        },
        permissions: ["events:list"],
      }),
    ).resolves.toEqual([{ eventId: 2, occurrenceId: "2:2026" }]);

    expect(calls).toEqual([
      {
        operation: "calendar.list",
        params: { includeExternal: false },
        userId: 1,
      },
      {
        operation: "events.list",
        params: {
          end: "2026-06-02T00:00:00.000Z",
          start: "2026-06-01T00:00:00.000Z",
        },
        userId: 1,
      },
    ]);
  });

  it("rejects missing permissions before reaching the host", async () => {
    const calls: unknown[] = [];
    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "threadTool", ownerUserId: 7 },
        host: makeHost(calls),
        operation: "events.create",
        params: { calendarId: 1, title: "Nope", timezone: "UTC" },
        permissions: ["events:list"],
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "threadTool", ownerUserId: 7 },
        host: makeHost(calls),
        operation: "events.create",
        params: { calendarId: 1, title: "Nope", timezone: "UTC" },
        permissions: ["events:list"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_permission_error",
      message: "metidos.events.create requires events:create.",
      permission: "events:create",
    });
    expect(calls).toEqual([]);
  });

  it("requires local callback context", async () => {
    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "global" },
        host: makeHost(),
        operation: "calendar.create",
        params: { title: "Work" },
        permissions: ["calendar:create"],
      }),
    ).rejects.toBeInstanceOf(PluginContextError);
    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "global" },
        host: makeHost(),
        operation: "calendar.create",
        params: { title: "Work" },
        permissions: ["calendar:create"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_context_error",
      contextKind: "global",
    });
  });

  it("uses the local operator for callback kinds without an explicit owner", async () => {
    const calls: unknown[] = [];
    const host = makeHost(calls);

    for (const contextKind of ["threadTool", "cron"] as const) {
      await expect(
        executePluginCalendarEventsOperation({
          context: { contextKind },
          host,
          operation: "events.get",
          params: { eventId: 2 },
          permissions: ["events:get"],
        }),
      ).resolves.toEqual({ id: 2 });
    }

    expect(calls).toEqual([
      { eventId: 2, operation: "events.get", userId: 1 },
      { eventId: 2, operation: "events.get", userId: 1 },
    ]);
  });

  it("requires delete confirmation and reports cron confirmation unavailability", async () => {
    const calls: unknown[] = [];
    const host = makeHost(calls);

    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "threadTool", ownerUserId: 7 },
        host,
        operation: "calendar.delete",
        params: { calendarId: 1 },
        permissions: ["calendar:delete"],
      }),
    ).rejects.toMatchObject({ code: "plugin_confirmation_required" });

    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "cron", ownerUserId: 7 },
        host,
        operation: "events.delete",
        params: { confirmation: true, eventId: 2 },
        permissions: ["events:delete"],
      }),
    ).rejects.toBeInstanceOf(PluginContextError);
    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "cron", ownerUserId: 7 },
        host,
        operation: "events.delete",
        params: { confirmation: true, eventId: 2 },
        permissions: ["events:delete"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_confirmation_unavailable",
      contextKind: "cron",
    });

    await expect(
      executePluginCalendarEventsOperation({
        context: { contextKind: "threadTool", ownerUserId: 7 },
        host,
        operation: "calendar.delete",
        params: { calendarId: 1, confirmation: true },
        permissions: ["calendar:delete"],
      }),
    ).resolves.toEqual({ calendarId: 1, success: true });

    expect(calls).toEqual([
      { calendarId: 1, operation: "calendar.delete", userId: 1 },
    ]);
  });
});
