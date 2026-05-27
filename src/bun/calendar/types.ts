/**
 * @file src/bun/calendar/types.ts
 * @description Shared calendar domain types for the Metidos Backend and Mainview RPC contract.
 */

export type CalendarPermission = "owner" | "read" | "write";
export type CalendarSharePermission = "read" | "write";
export type CalendarSourceType = "local" | "external_ics";
export type CalendarViewMode = "month" | "week" | "day" | "agenda";
export type CalendarNotificationChannel = "in_app" | "browser" | "ntfy";
export type CalendarNotificationDeliveryStatus =
  | "scheduled"
  | "delivered"
  | "dismissed"
  | "failed"
  | "expired"
  | "snoozed";
export type CalendarReminderScope = "whole_series" | "after_this" | "just_this";

export type CalendarReminderInput = {
  id?: number | string | null;
  minutesBefore: number;
};

export type RpcCalendarUser = {
  id: number;
  username: string;
  isAdmin: boolean;
};

export type RpcCalendar = {
  id: number;
  ownerUserId: number;
  ownerUsername: string;
  sourceType: "local";
  title: string;
  color: string;
  effectiveColor: string;
  visible: boolean;
  notificationsEnabled: boolean;
  notificationChannels: CalendarNotificationChannel[];
  permission: CalendarPermission;
  isPublic: boolean;
  publicSlug: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RpcExternalIcsCalendar = {
  id: number;
  ownerUserId: number;
  sourceType: "external_ics";
  title: string;
  url: string;
  color: string;
  visible: boolean;
  enabled: boolean;
  notificationsEnabled: boolean;
  notificationMode: "source" | "default";
  refreshIntervalMinutes: number;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
};

export type RpcCalendarShare = {
  calendarId: number;
  userId: number;
  username: string;
  permission: CalendarSharePermission;
};

export type RpcCalendarEvent = {
  id: number;
  calendarId: number;
  sourceType: "local";
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
  recurrenceSummary: string;
  reminders: CalendarReminderInput[];
  createdByUserId: number;
  createdByUsername: string;
  updatedByUserId: number;
  updatedByUsername: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RpcCalendarOccurrence = {
  occurrenceId: string;
  sourceType: CalendarSourceType;
  calendarId: number;
  eventId: number | string;
  title: string;
  description: string;
  location: string;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
  timezone: string;
  color: string;
  permission: CalendarPermission | "read";
  writable: boolean;
  isRecurring: boolean;
  recurrenceRule: string | null;
  recurrenceSummary: string;
  originalStart: string;
  externalUrl: string | null;
  createdByUserId: number | null;
  createdByUsername: string | null;
  version: number | null;
  deletedAt: string | null;
  reminders?: CalendarReminderInput[];
};

export type RpcCalendarNotificationSettings = {
  userId: number;
  defaultReminders: CalendarReminderInput[];
  inAppEnabled: boolean;
  browserEnabled: boolean;
  browserPermission: NotificationPermission | "unsupported" | "unknown";
  ntfyEnabled: boolean;
  ntfyServerUrl: string;
  ntfyTopic: string;
  ntfyAuthType: "none" | "bearer" | "basic";
  ntfyUsername: string;
  ntfyPriority: "min" | "low" | "default" | "high" | "urgent";
  updatedAt: string;
};

export type RpcCalendarReminderDelivery = {
  id: number;
  userId: number;
  sourceType: CalendarSourceType;
  calendarId: number | null;
  eventId: string;
  occurrenceStart: string;
  occurrenceTimezone: string;
  reminderId: string;
  channel: CalendarNotificationChannel;
  scheduledAt: string;
  status: CalendarNotificationDeliveryStatus;
  deliveredAt: string | null;
  dismissedAt: string | null;
  readAt: string | null;
  title: string;
  body: string;
  openEventPayloadJson: string | null;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RpcCalendarBootstrap = {
  calendars: RpcCalendar[];
  externalCalendars: RpcExternalIcsCalendar[];
  shares: RpcCalendarShare[];
  users: RpcCalendarUser[];
  notificationSettings: RpcCalendarNotificationSettings;
  notifications: RpcCalendarReminderDelivery[];
};

export type CalendarEventInput = {
  calendarId: number;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  allDay?: boolean | null;
  timezone: string;
  recurrenceRule?: string | null;
  reminders?: CalendarReminderInput[] | null;
};

export type CalendarEventUpdateInput = Partial<CalendarEventInput> & {
  eventId: number;
  expectedVersion?: number | null;
  scope?: CalendarReminderScope | null;
  occurrenceStart?: string | null;
};
