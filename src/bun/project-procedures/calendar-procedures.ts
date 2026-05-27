import { refreshExternalIcsCalendar as refreshExternalIcsCalendarFetch } from "../calendar/ics";
import { listCurrentCalendarNotifications } from "../calendar/notifications";
import { normalizeCalendarOccurrenceWindow } from "../calendar/occurrence-window";
import {
  createCalendar,
  createCalendarEvent,
  createExternalCalendar,
  deleteCalendar,
  deleteCalendarEvent,
  deleteExternalCalendar,
  dismissCalendarNotification,
  getCalendarBootstrap,
  leaveSharedCalendar,
  listCalendarOccurrences,
  MAX_CALENDAR_OCCURRENCES_PER_REQUEST,
  setCalendarShare,
  snoozeCalendarNotification,
  updateCalendar,
  updateCalendarEvent,
  updateCalendarNotificationSettings,
  updateCalendarPreference,
  updateExternalCalendar,
} from "../calendar/store";
import type {
  RpcCalendar,
  RpcCalendarBootstrap,
  RpcCalendarNotificationSettings,
  RpcCalendarOccurrence,
  RpcCalendarReminderDelivery,
  RpcCalendarShare,
  RpcExternalIcsCalendar,
} from "../calendar/types";
import { initAppDatabase } from "../db";
import type { AppRPCSchema, RpcRequestContext } from "../rpc-schema";
import { requireCalendarOperatorUserId } from "./local-operator";

const db = initAppDatabase();

export async function getCalendarBootstrapProcedure(
  _params: AppRPCSchema["requests"]["getCalendarBootstrap"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendarBootstrap> {
  return getCalendarBootstrap(db, requireCalendarOperatorUserId(context));
}

export async function listCalendarOccurrencesProcedure(
  params: AppRPCSchema["requests"]["listCalendarOccurrences"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendarOccurrence[]> {
  const window = normalizeCalendarOccurrenceWindow(params);
  return listCalendarOccurrences(
    db,
    requireCalendarOperatorUserId(context),
    window.start,
    window.end,
    { maxOccurrences: MAX_CALENDAR_OCCURRENCES_PER_REQUEST },
  );
}

export async function createCalendarProcedure(
  params: AppRPCSchema["requests"]["createCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendar> {
  return createCalendar(db, requireCalendarOperatorUserId(context), params);
}

export async function updateCalendarProcedure(
  params: AppRPCSchema["requests"]["updateCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendar> {
  return updateCalendar(
    db,
    requireCalendarOperatorUserId(context),
    params.calendarId,
    params,
  );
}

export async function deleteCalendarProcedure(
  params: AppRPCSchema["requests"]["deleteCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<{ success: boolean; calendarId: number }> {
  deleteCalendar(db, requireCalendarOperatorUserId(context), params.calendarId);
  return { success: true, calendarId: params.calendarId };
}

export async function leaveSharedCalendarProcedure(
  params: AppRPCSchema["requests"]["leaveSharedCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<{ success: boolean; calendarId: number }> {
  leaveSharedCalendar(
    db,
    requireCalendarOperatorUserId(context),
    params.calendarId,
  );
  return { success: true, calendarId: params.calendarId };
}

export async function updateCalendarPreferenceProcedure(
  params: AppRPCSchema["requests"]["updateCalendarPreference"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendar> {
  return updateCalendarPreference(
    db,
    requireCalendarOperatorUserId(context),
    params.calendarId,
    params,
  );
}

export async function setCalendarShareProcedure(
  params: AppRPCSchema["requests"]["setCalendarShare"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendarShare[]> {
  return setCalendarShare(
    db,
    requireCalendarOperatorUserId(context),
    params.calendarId,
    params.userId,
    params.permission,
  );
}

export async function createCalendarEventProcedure(
  params: AppRPCSchema["requests"]["createCalendarEvent"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["createCalendarEvent"]["response"]> {
  return createCalendarEvent(
    db,
    requireCalendarOperatorUserId(context),
    params,
  );
}

export async function updateCalendarEventProcedure(
  params: AppRPCSchema["requests"]["updateCalendarEvent"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["updateCalendarEvent"]["response"]> {
  return updateCalendarEvent(
    db,
    requireCalendarOperatorUserId(context),
    params,
  );
}

export async function deleteCalendarEventProcedure(
  params: AppRPCSchema["requests"]["deleteCalendarEvent"]["params"],
  context?: RpcRequestContext,
): Promise<{ success: boolean; eventId: number }> {
  deleteCalendarEvent(
    db,
    requireCalendarOperatorUserId(context),
    params.eventId,
    params,
  );
  return { success: true, eventId: params.eventId };
}

export async function createExternalIcsCalendarProcedure(
  params: AppRPCSchema["requests"]["createExternalIcsCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<RpcExternalIcsCalendar> {
  return createExternalCalendar(
    db,
    requireCalendarOperatorUserId(context),
    params,
  );
}

export async function updateExternalIcsCalendarProcedure(
  params: AppRPCSchema["requests"]["updateExternalIcsCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<RpcExternalIcsCalendar> {
  const updateInput: Partial<
    Pick<
      RpcExternalIcsCalendar,
      | "color"
      | "enabled"
      | "notificationMode"
      | "notificationsEnabled"
      | "refreshIntervalMinutes"
      | "title"
      | "url"
      | "visible"
    >
  > = {};
  if (params.title !== undefined && params.title !== null) {
    updateInput.title = params.title;
  }
  if (params.url !== undefined && params.url !== null) {
    updateInput.url = params.url;
  }
  if (params.color !== undefined && params.color !== null) {
    updateInput.color = params.color;
  }
  if (params.visible !== undefined && params.visible !== null) {
    updateInput.visible = params.visible;
  }
  if (params.enabled !== undefined && params.enabled !== null) {
    updateInput.enabled = params.enabled;
  }
  if (
    params.notificationsEnabled !== undefined &&
    params.notificationsEnabled !== null
  ) {
    updateInput.notificationsEnabled = params.notificationsEnabled;
  }
  if (
    params.notificationMode !== undefined &&
    params.notificationMode !== null
  ) {
    updateInput.notificationMode = params.notificationMode;
  }
  if (
    params.refreshIntervalMinutes !== undefined &&
    params.refreshIntervalMinutes !== null &&
    Number.isFinite(params.refreshIntervalMinutes)
  ) {
    updateInput.refreshIntervalMinutes = params.refreshIntervalMinutes;
  }
  return updateExternalCalendar(
    db,
    requireCalendarOperatorUserId(context),
    params.externalCalendarId,
    updateInput,
  );
}

export async function refreshExternalIcsCalendarProcedure(
  params: AppRPCSchema["requests"]["refreshExternalIcsCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["refreshExternalIcsCalendar"]["response"]> {
  const userId = requireCalendarOperatorUserId(context);
  updateExternalCalendar(db, userId, params.externalCalendarId, {});
  return refreshExternalIcsCalendarFetch(db, params.externalCalendarId);
}

export async function deleteExternalIcsCalendarProcedure(
  params: AppRPCSchema["requests"]["deleteExternalIcsCalendar"]["params"],
  context?: RpcRequestContext,
): Promise<{ success: boolean; externalCalendarId: number }> {
  deleteExternalCalendar(
    db,
    requireCalendarOperatorUserId(context),
    params.externalCalendarId,
  );
  return { success: true, externalCalendarId: params.externalCalendarId };
}

export async function updateCalendarNotificationSettingsProcedure(
  params: AppRPCSchema["requests"]["updateCalendarNotificationSettings"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendarNotificationSettings> {
  return updateCalendarNotificationSettings(
    db,
    requireCalendarOperatorUserId(context),
    params,
  );
}

export async function listCalendarNotificationsProcedure(
  _params: AppRPCSchema["requests"]["listCalendarNotifications"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendarReminderDelivery[]> {
  return listCurrentCalendarNotifications(
    db,
    requireCalendarOperatorUserId(context),
  );
}

export async function dismissCalendarNotificationProcedure(
  params: AppRPCSchema["requests"]["dismissCalendarNotification"]["params"],
  context?: RpcRequestContext,
): Promise<{ success: boolean; deliveryId: number }> {
  dismissCalendarNotification(
    db,
    requireCalendarOperatorUserId(context),
    params.deliveryId,
  );
  return { success: true, deliveryId: params.deliveryId };
}

export async function snoozeCalendarNotificationProcedure(
  params: AppRPCSchema["requests"]["snoozeCalendarNotification"]["params"],
  context?: RpcRequestContext,
): Promise<RpcCalendarReminderDelivery> {
  return snoozeCalendarNotification(
    db,
    requireCalendarOperatorUserId(context),
    params.deliveryId,
    params.snoozedUntil,
  );
}
