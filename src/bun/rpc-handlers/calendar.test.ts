import { describe, expect, it } from "bun:test";

import { AuthServiceError } from "../auth/service";
import type { RpcRequestContext } from "../rpc-schema";
import {
  createCalendarRpcHandlers,
  type CalendarRpcHandlerDependencies,
  type CalendarRpcHandlerMap,
} from "./calendar";

function createRegularUserContext(): RpcRequestContext {
  return {
    auth: {
      isAdmin: false,
      sessionId: "calendar-rpc-regular-session",
      userId: 23,
      username: "calendar-rpc-regular-user",
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

function createDefaultDependencies(
  overrides: Partial<CalendarRpcHandlerDependencies> = {},
): CalendarRpcHandlerDependencies {
  return {
    createCalendarEventProcedure: async () => ({ id: 0 }) as never,
    createCalendarProcedure: async () => ({ id: 0 }) as never,
    createExternalIcsCalendarProcedure: async () => ({ id: 0 }) as never,
    deleteCalendarEventProcedure: async () => ({ success: true, eventId: 0 }),
    deleteCalendarProcedure: async () => ({ success: true, calendarId: 0 }),
    deleteExternalIcsCalendarProcedure: async () => ({
      success: true,
      externalCalendarId: 0,
    }),
    dismissCalendarNotificationProcedure: async () => ({
      success: true,
      deliveryId: 0,
    }),
    dismissUserNotificationProcedure: async () => ({
      success: true,
      deliveryId: 0,
    }),
    getCalendarBootstrapProcedure: async () => ({}) as never,
    leaveSharedCalendarProcedure: async () => ({
      success: true,
      calendarId: 0,
    }),
    listCalendarNotificationsProcedure: async () => [] as never,
    listCalendarOccurrencesProcedure: async () => [],
    listUserNotificationsProcedure: async () => [] as never,
    refreshExternalIcsCalendarProcedure: async () => ({
      refreshed: true,
      eventCount: 0,
      status: 200,
    }),
    setCalendarShareProcedure: async () => [],
    snoozeCalendarNotificationProcedure: async () => ({ id: 0 }) as never,
    updateCalendarEventProcedure: async () => ({ id: 0 }) as never,
    updateCalendarNotificationSettingsProcedure: async () => ({}) as never,
    updateCalendarPreferenceProcedure: async () => ({ id: 0 }) as never,
    updateCalendarProcedure: async () => ({ id: 0 }) as never,
    updateExternalIcsCalendarProcedure: async () => ({ id: 0 }) as never,
    ...overrides,
  };
}

describe("createCalendarRpcHandlers", () => {
  it("passes caller context and project-sensitive params into calendar procedures", async () => {
    const context = createRegularUserContext();
    const calls: Array<{
      name: keyof CalendarRpcHandlerMap;
      params: unknown;
      context: RpcRequestContext;
    }> = [];
    const handlers = createCalendarRpcHandlers(
      createDefaultDependencies({
        createCalendarEventProcedure: async (params, procedureContext) => {
          calls.push({
            name: "createCalendarEvent",
            params,
            context: procedureContext,
          });
          return { id: 11 } as never;
        },
        getCalendarBootstrapProcedure: async (params, procedureContext) => {
          calls.push({
            name: "getCalendarBootstrap",
            params,
            context: procedureContext,
          });
          return {} as never;
        },
        listCalendarOccurrencesProcedure: async (params, procedureContext) => {
          calls.push({
            name: "listCalendarOccurrences",
            params,
            context: procedureContext,
          });
          return [];
        },
        setCalendarShareProcedure: async (params, procedureContext) => {
          calls.push({
            name: "setCalendarShare",
            params,
            context: procedureContext,
          });
          return [];
        },
        updateCalendarPreferenceProcedure: async (params, procedureContext) => {
          calls.push({
            name: "updateCalendarPreference",
            params,
            context: procedureContext,
          });
          return { id: 12 } as never;
        },
      }),
    );

    await handlers.getCalendarBootstrap(undefined, context);
    await handlers.listCalendarOccurrences(
      { start: "2026-06-02T00:00:00.000Z", end: "2026-06-03T00:00:00.000Z" },
      context,
    );
    await handlers.updateCalendarPreference(
      { calendarId: 5, visible: false, notificationsEnabled: false },
      context,
    );
    await handlers.setCalendarShare(
      { calendarId: 5, userId: 24, permission: "write" },
      context,
    );
    await handlers.createCalendarEvent(
      {
        calendarId: 5,
        title: "RPC event",
        startAt: "2026-06-02T14:00:00.000Z",
        endAt: "2026-06-02T14:30:00.000Z",
        timezone: "UTC",
      },
      context,
    );

    expect(calls).toEqual([
      { name: "getCalendarBootstrap", params: undefined, context },
      {
        name: "listCalendarOccurrences",
        params: {
          start: "2026-06-02T00:00:00.000Z",
          end: "2026-06-03T00:00:00.000Z",
        },
        context,
      },
      {
        name: "updateCalendarPreference",
        params: { calendarId: 5, visible: false, notificationsEnabled: false },
        context,
      },
      {
        name: "setCalendarShare",
        params: { calendarId: 5, userId: 24, permission: "write" },
        context,
      },
      {
        name: "createCalendarEvent",
        params: {
          calendarId: 5,
          title: "RPC event",
          startAt: "2026-06-02T14:00:00.000Z",
          endAt: "2026-06-02T14:30:00.000Z",
          timezone: "UTC",
        },
        context,
      },
    ]);
  });

  it("surfaces authenticated-operator failures from calendar procedures", async () => {
    const authError = new AuthServiceError(
      "session_required",
      "A valid authenticated session is required for calendar access.",
      401,
    );
    const handlers = createCalendarRpcHandlers(
      createDefaultDependencies({
        updateCalendarProcedure: async () => {
          throw authError;
        },
      }),
    );

    await expect(
      handlers.updateCalendar(
        { calendarId: 7, title: "Blocked without local operator" },
        createRegularUserContext(),
      ),
    ).rejects.toBe(authError);
  });
});
