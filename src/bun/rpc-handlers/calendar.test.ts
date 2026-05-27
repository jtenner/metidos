import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createCalendarRpcHandlers,
  type CalendarRpcHandlerDependencies,
  type CalendarRpcHandlerMap,
} from "./calendar";

const requestContext = {} as RpcRequestContext;

const calendarMethodNames = [
  "getCalendarBootstrap",
  "listCalendarOccurrences",
  "createCalendar",
  "updateCalendar",
  "deleteCalendar",
  "leaveSharedCalendar",
  "updateCalendarPreference",
  "setCalendarShare",
  "createCalendarEvent",
  "updateCalendarEvent",
  "deleteCalendarEvent",
  "createExternalIcsCalendar",
  "updateExternalIcsCalendar",
  "refreshExternalIcsCalendar",
  "deleteExternalIcsCalendar",
  "updateCalendarNotificationSettings",
  "listCalendarNotifications",
  "listUserNotifications",
  "dismissUserNotification",
  "dismissCalendarNotification",
  "snoozeCalendarNotification",
] as const satisfies readonly (keyof CalendarRpcHandlerMap)[];

function toProcedureName(methodName: keyof CalendarRpcHandlerMap) {
  return `${methodName}Procedure` as keyof CalendarRpcHandlerDependencies;
}

describe("createCalendarRpcHandlers", () => {
  it("delegates calendar procedures through the calendar handler map", async () => {
    const calls: string[] = [];
    const expectedResults = new Map<keyof CalendarRpcHandlerMap, unknown>();
    const dependencies = {} as CalendarRpcHandlerDependencies;

    for (const methodName of calendarMethodNames) {
      const result = { methodName };
      expectedResults.set(methodName, result);
      dependencies[toProcedureName(methodName)] = (async () => {
        calls.push(methodName);
        return result;
      }) as never;
    }

    const handlers = createCalendarRpcHandlers(dependencies);

    for (const methodName of calendarMethodNames) {
      await expect(
        handlers[methodName]({} as never, requestContext),
      ).resolves.toBe(expectedResults.get(methodName) as never);
    }

    expect(calls).toEqual([...calendarMethodNames]);
  });
});
