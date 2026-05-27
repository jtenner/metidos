/**
 * @file src/mainview/app/calendar-state.ts
 * @description Pure reducer helpers for Mainview calendar workspace state.
 */

import type {
  CalendarViewMode,
  RpcCalendarOccurrence,
} from "../../bun/calendar/types";
import { addDays, addMonthsClamped } from "./calendar-layout";

export type CalendarDialogState =
  | { kind: "none" }
  | {
      kind: "create";
      startAt?: string | null;
      endAt?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      allDay?: boolean;
    }
  | { kind: "detail"; occurrence: RpcCalendarOccurrence }
  | { kind: "edit"; occurrence: RpcCalendarOccurrence }
  | { kind: "delete-scope"; occurrence: RpcCalendarOccurrence };

export type CalendarWorkspaceState = {
  view: CalendarViewMode;
  anchorDate: Date;
  agendaRange: "today" | "next7";
  dialog: CalendarDialogState;
};

export type CalendarWorkspaceAction =
  | { type: "set-view"; view: CalendarViewMode }
  | { type: "previous" }
  | { type: "today" }
  | { type: "next" }
  | { type: "jump"; date: Date }
  | { type: "set-agenda-range"; range: "today" | "next7" }
  | { type: "open-dialog"; dialog: CalendarDialogState }
  | { type: "close-dialog" };

export function initialCalendarState(now = new Date()): CalendarWorkspaceState {
  return {
    view: "month",
    anchorDate: now,
    agendaRange: "next7",
    dialog: { kind: "none" },
  };
}

function stepDaysForView(view: CalendarViewMode): number {
  if (view === "week" || view === "agenda") {
    return 7;
  }
  return 1;
}

export function reduceCalendarState(
  state: CalendarWorkspaceState,
  action: CalendarWorkspaceAction,
  now = new Date(),
): CalendarWorkspaceState {
  switch (action.type) {
    case "set-view":
      return { ...state, view: action.view };
    case "previous":
      return {
        ...state,
        anchorDate:
          state.view === "month"
            ? addMonthsClamped(state.anchorDate, -1)
            : addDays(state.anchorDate, -stepDaysForView(state.view)),
      };
    case "today":
      return { ...state, anchorDate: now };
    case "next":
      return {
        ...state,
        anchorDate:
          state.view === "month"
            ? addMonthsClamped(state.anchorDate, 1)
            : addDays(state.anchorDate, stepDaysForView(state.view)),
      };
    case "jump":
      return { ...state, anchorDate: action.date };
    case "set-agenda-range":
      return { ...state, agendaRange: action.range };
    case "open-dialog":
      return { ...state, dialog: action.dialog };
    case "close-dialog":
      return { ...state, dialog: { kind: "none" } };
  }
}

export function quickSnoozeDate(
  option: "5m" | "10m" | "30m" | "1h" | "tomorrow8",
  now = new Date(),
): Date {
  if (option === "tomorrow8") {
    const date = addDays(now, 1);
    date.setHours(8, 0, 0, 0);
    return date;
  }
  const minutes =
    option === "5m" ? 5 : option === "10m" ? 10 : option === "30m" ? 30 : 60;
  return new Date(now.getTime() + minutes * 60_000);
}
