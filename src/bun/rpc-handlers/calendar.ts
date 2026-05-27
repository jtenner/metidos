import type { RpcRequestHandlerMap } from "../rpc-transport";

export type CalendarRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  | "getCalendarBootstrap"
  | "listCalendarOccurrences"
  | "createCalendar"
  | "updateCalendar"
  | "deleteCalendar"
  | "leaveSharedCalendar"
  | "updateCalendarPreference"
  | "setCalendarShare"
  | "createCalendarEvent"
  | "updateCalendarEvent"
  | "deleteCalendarEvent"
  | "createExternalIcsCalendar"
  | "updateExternalIcsCalendar"
  | "refreshExternalIcsCalendar"
  | "deleteExternalIcsCalendar"
  | "updateCalendarNotificationSettings"
  | "listCalendarNotifications"
  | "listUserNotifications"
  | "dismissUserNotification"
  | "dismissCalendarNotification"
  | "snoozeCalendarNotification"
>;

export type CalendarRpcHandlerDependencies = {
  [Method in keyof CalendarRpcHandlerMap as `${Method}Procedure`]: CalendarRpcHandlerMap[Method];
};

export function createCalendarRpcHandlers({
  getCalendarBootstrapProcedure,
  listCalendarOccurrencesProcedure,
  createCalendarProcedure,
  updateCalendarProcedure,
  deleteCalendarProcedure,
  leaveSharedCalendarProcedure,
  updateCalendarPreferenceProcedure,
  setCalendarShareProcedure,
  createCalendarEventProcedure,
  updateCalendarEventProcedure,
  deleteCalendarEventProcedure,
  createExternalIcsCalendarProcedure,
  updateExternalIcsCalendarProcedure,
  refreshExternalIcsCalendarProcedure,
  deleteExternalIcsCalendarProcedure,
  updateCalendarNotificationSettingsProcedure,
  listCalendarNotificationsProcedure,
  listUserNotificationsProcedure,
  dismissUserNotificationProcedure,
  dismissCalendarNotificationProcedure,
  snoozeCalendarNotificationProcedure,
}: CalendarRpcHandlerDependencies): CalendarRpcHandlerMap {
  return {
    getCalendarBootstrap: (params, context) =>
      getCalendarBootstrapProcedure(params, context),
    listCalendarOccurrences: (params, context) =>
      listCalendarOccurrencesProcedure(params, context),
    createCalendar: (params, context) =>
      createCalendarProcedure(params, context),
    updateCalendar: (params, context) =>
      updateCalendarProcedure(params, context),
    deleteCalendar: (params, context) =>
      deleteCalendarProcedure(params, context),
    leaveSharedCalendar: (params, context) =>
      leaveSharedCalendarProcedure(params, context),
    updateCalendarPreference: (params, context) =>
      updateCalendarPreferenceProcedure(params, context),
    setCalendarShare: (params, context) =>
      setCalendarShareProcedure(params, context),
    createCalendarEvent: (params, context) =>
      createCalendarEventProcedure(params, context),
    updateCalendarEvent: (params, context) =>
      updateCalendarEventProcedure(params, context),
    deleteCalendarEvent: (params, context) =>
      deleteCalendarEventProcedure(params, context),
    createExternalIcsCalendar: (params, context) =>
      createExternalIcsCalendarProcedure(params, context),
    updateExternalIcsCalendar: (params, context) =>
      updateExternalIcsCalendarProcedure(params, context),
    refreshExternalIcsCalendar: (params, context) =>
      refreshExternalIcsCalendarProcedure(params, context),
    deleteExternalIcsCalendar: (params, context) =>
      deleteExternalIcsCalendarProcedure(params, context),
    updateCalendarNotificationSettings: (params, context) =>
      updateCalendarNotificationSettingsProcedure(params, context),
    listCalendarNotifications: (params, context) =>
      listCalendarNotificationsProcedure(params, context),
    listUserNotifications: (params, context) =>
      listUserNotificationsProcedure(params, context),
    dismissUserNotification: (params, context) =>
      dismissUserNotificationProcedure(params, context),
    dismissCalendarNotification: (params, context) =>
      dismissCalendarNotificationProcedure(params, context),
    snoozeCalendarNotification: (params, context) =>
      snoozeCalendarNotificationProcedure(params, context),
  };
}
