/**
 * @file src/mainview/app/calendar-workspace.tsx
 * @description Metidos-native global calendar workspace.
 */

import {
  type JSX,
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  CalendarViewMode,
  RpcCalendar,
  RpcCalendarBootstrap,
  RpcCalendarOccurrence,
  RpcCalendarReminderDelivery,
  RpcExternalIcsCalendar,
} from "../../bun/calendar/types";
import type { ProjectProcedures } from "../../bun/rpc-schema";
import { AppButton } from "../controls/button";
import { ConfirmDialog } from "../controls/confirm-dialog";
import { ChoiceDropdownControl } from "../controls/choice-dropdown-control";
import { materialSymbol } from "../controls/icons";
import {
  createPointReference,
  ModalDialogSurface,
  PopoverSurface,
} from "../controls/popover";
import { TintedCheckboxRow } from "../controls/tinted-checkbox-row";
import { ToolbarDateInput } from "../controls/toolbar-date-input";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { mergeClassNames } from "../dynamic-styles";

import {
  addDays,
  addMonthsClamped,
  formatCalendarColumnHeader,
  formatCalendarRangeLabel,
  groupOccurrencesByDay,
  layoutTimedOccurrences,
  monthGridDays,
  startOfLocalDay,
  toDateInputValue,
  viewWindow,
  weekDays,
} from "./calendar-layout";

import { initialCalendarState, reduceCalendarState } from "./calendar-state";

const CalendarEditDialog = lazy(async () => {
  const module = await import("./calendar-edit-dialog");
  return { default: module.CalendarEditDialog };
});

const CalendarEventDetailDialog = lazy(async () => {
  const module = await import("./calendar-event-detail-dialog");
  return { default: module.CalendarEventDetailDialog };
});

const CalendarEventDialog = lazy(async () => {
  const module = await import("./calendar-event-dialog");
  return { default: module.CalendarEventDialog };
});

const CalendarIcsEditDialog = lazy(async () => {
  const module = await import("./calendar-ics-edit-dialog");
  return { default: module.CalendarIcsEditDialog };
});

const CALENDAR_CHANGED_EVENT_NAME = "metidos:calendar-changed";

const CALENDAR_VIEW_OPTIONS: { label: string; value: CalendarViewMode }[] = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
  { label: "Day", value: "day" },
  { label: "Agenda", value: "agenda" },
];

const CALENDAR_VISIBILITY_FALLBACK_COLOR = "var(--color-warning-text)";

export function shouldCommitCalendarLoad({
  currentRequestId,
  requestId,
}: {
  currentRequestId: number;
  requestId: number;
}): boolean {
  return currentRequestId === requestId;
}

export function getCalendarActionAvailability(
  permission: RpcCalendar["permission"],
): {
  canEdit: boolean;
  canDelete: boolean;
} {
  return {
    canEdit: permission !== "read",
    canDelete: permission === "owner",
  };
}

function CalendarColorSwatch({
  color,
  className = "",
}: {
  color: string;
  className?: string;
}): JSX.Element {
  const swatchClassName = useDynamicCssVariablesClassName(
    {
      "--calendar-swatch-color": color,
    },
    {
      className: mergeClassNames("calendar-color-swatch", className),
      prefix: "calendar-swatch-vars",
    },
  );
  return <span className={swatchClassName} />;
}

function CalendarEventButton({
  ariaLabel,
  children,
  color,
  onClick,
  onContextMenu,
  onKeyDown,
}: {
  ariaLabel: string;
  children: ReactNode;
  color: string;
  onClick: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  const className = useDynamicCssVariablesClassName(
    {
      "--calendar-event-border-color": color,
    },
    {
      className:
        "calendar-event-button block h-auto w-full truncate justify-start border-l-2 bg-surface-2 px-2 py-1 text-left text-[11px] font-normal text-text-secondary outline-none hover:bg-hover-surface focus:ring-2 focus:ring-focus-ring",
      prefix: "calendar-event-button-vars",
    },
  );
  return (
    <AppButton
      buttonStyle="muted"
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {children}
    </AppButton>
  );
}

function CalendarTimedLayout({
  children,
  column,
  columnCount,
  heightPercent,
  topPercent,
}: {
  children: ReactNode;
  column: number;
  columnCount: number;
  heightPercent: number;
  topPercent: number;
}): JSX.Element {
  const className = useDynamicCssVariablesClassName(
    {
      "--calendar-timed-top": `${topPercent}%`,
      "--calendar-timed-height": `${heightPercent}%`,
      "--calendar-timed-left": `${(column / columnCount) * 100}%`,
      "--calendar-timed-width": `${100 / columnCount}%`,
    },
    {
      className: "calendar-timed-layout absolute z-10 px-1",
      prefix: "calendar-timed-layout-vars",
    },
  );
  return <div className={className}>{children}</div>;
}

export function CalendarWorkspace({
  procedures,
  variant,
  openNotificationEvent,
}: {
  procedures: ProjectProcedures;
  variant: "desktop" | "mobile";
  openNotificationEvent?: RpcCalendarReminderDelivery | null;
}): JSX.Element {
  const [state, dispatch] = useReducer(
    (
      current: ReturnType<typeof initialCalendarState>,
      action: Parameters<typeof reduceCalendarState>[1],
    ) => reduceCalendarState(current, action),
    initialCalendarState(),
  );
  const [bootstrap, setBootstrap] = useState<RpcCalendarBootstrap | null>(null);
  const [occurrences, setOccurrences] = useState<RpcCalendarOccurrence[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<RpcCalendar | null>(
    null,
  );
  const [editingExternalCalendar, setEditingExternalCalendar] =
    useState<RpcExternalIcsCalendar | null>(null);
  const [calendarMenu, setCalendarMenu] = useState<{
    calendarId: number;
    x: number;
    y: number;
  } | null>(null);
  const [externalCalendarMenu, setExternalCalendarMenu] = useState<{
    calendarId: number;
    x: number;
    y: number;
  } | null>(null);
  const [pendingCalendarDelete, setPendingCalendarDelete] =
    useState<RpcCalendar | null>(null);
  const [pendingExternalCalendarDelete, setPendingExternalCalendarDelete] =
    useState<RpcExternalIcsCalendar | null>(null);
  const [focusedCalendarDateValue, setFocusedCalendarDateValue] = useState(() =>
    toDateInputValue(new Date()),
  );
  const calendarDayButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const calendarLoadRequestIdRef = useRef(0);
  const eventSaveInFlightRef = useRef(false);
  const pendingCalendarGridFocusRef = useRef<string | null>(null);
  const deleteScopeCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteScopeTitleId = useId();
  const openedNotificationDeliveryIdRef = useRef<number | null>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const windowRange = useMemo(
    () => viewWindow(state.view, state.anchorDate),
    [state.anchorDate, state.view],
  );
  const isMobile = variant === "mobile";

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++calendarLoadRequestIdRef.current;
    setBusy(true);
    setError("");
    try {
      const [nextBootstrap, nextOccurrences] = await Promise.all([
        procedures.getCalendarBootstrap(undefined, { priority: "foreground" }),
        procedures.listCalendarOccurrences(
          { ...windowRange, timezone },
          { priority: "foreground" },
        ),
      ]);
      if (
        !shouldCommitCalendarLoad({
          currentRequestId: calendarLoadRequestIdRef.current,
          requestId,
        })
      ) {
        return;
      }
      setBootstrap(nextBootstrap);
      setOccurrences(nextOccurrences);
    } catch (loadError) {
      if (
        shouldCommitCalendarLoad({
          currentRequestId: calendarLoadRequestIdRef.current,
          requestId,
        })
      ) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      }
    } finally {
      if (
        shouldCommitCalendarLoad({
          currentRequestId: calendarLoadRequestIdRef.current,
          requestId,
        })
      ) {
        setBusy(false);
      }
    }
  }, [procedures, timezone, windowRange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleCalendarChanged = (): void => {
      void load();
    };
    window.addEventListener(CALENDAR_CHANGED_EVENT_NAME, handleCalendarChanged);
    return () => {
      window.removeEventListener(
        CALENDAR_CHANGED_EVENT_NAME,
        handleCalendarChanged,
      );
    };
  }, [load]);

  useEffect(() => {
    if (!openNotificationEvent?.openEventPayloadJson) {
      return;
    }
    if (openedNotificationDeliveryIdRef.current === openNotificationEvent.id) {
      return;
    }
    try {
      const payload = JSON.parse(
        openNotificationEvent.openEventPayloadJson,
      ) as { occurrenceId?: string };
      const occurrence = occurrences.find(
        (item) => item.occurrenceId === payload.occurrenceId,
      );
      if (occurrence) {
        openedNotificationDeliveryIdRef.current = openNotificationEvent.id;
        dispatch({
          type: "open-dialog",
          dialog: { kind: "detail", occurrence },
        });
      }
    } catch {
      openedNotificationDeliveryIdRef.current = openNotificationEvent.id;
      // Ignore malformed persisted notification payloads.
    }
  }, [occurrences, openNotificationEvent]);

  const calendars = bootstrap?.calendars ?? [];
  const externalCalendars = bootstrap?.externalCalendars ?? [];
  const calendarMenuTarget = calendarMenu
    ? (calendars.find((calendar) => calendar.id === calendarMenu.calendarId) ??
      null)
    : null;
  const calendarMenuActionAvailability = calendarMenuTarget
    ? getCalendarActionAvailability(calendarMenuTarget.permission)
    : null;
  const externalCalendarMenuTarget = externalCalendarMenu
    ? (externalCalendars.find(
        (calendar) => calendar.id === externalCalendarMenu.calendarId,
      ) ?? null)
    : null;
  const grouped = useMemo(
    () => groupOccurrencesByDay(occurrences),
    [occurrences],
  );
  const closeDialog = useCallback(() => {
    dispatch({ type: "close-dialog" });
  }, []);

  const openCreateForAllDayDate = useCallback((day: Date): void => {
    const startDate = toDateInputValue(day);
    const endDate = toDateInputValue(addDays(day, 1));
    dispatch({
      type: "open-dialog",
      dialog: { kind: "create", allDay: true, startDate, endDate },
    });
  }, []);

  const openCreateForTimeSlot = useCallback((day: Date, hour: number): void => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1, 0, 0, 0);
    dispatch({
      type: "open-dialog",
      dialog: {
        kind: "create",
        allDay: false,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      },
    });
  }, []);

  const focusCalendarDate = useCallback((day: Date): void => {
    const key = toDateInputValue(day);
    setFocusedCalendarDateValue(key);
    pendingCalendarGridFocusRef.current = key;
    dispatch({ type: "jump", date: startOfLocalDay(day) });
  }, []);

  const handleCalendarGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, day: Date): void => {
      let nextDay: Date | null = null;
      switch (event.key) {
        case "ArrowLeft":
          nextDay = addDays(day, -1);
          break;
        case "ArrowRight":
          nextDay = addDays(day, 1);
          break;
        case "ArrowUp":
          nextDay = addDays(day, -7);
          break;
        case "ArrowDown":
          nextDay = addDays(day, 7);
          break;
        case "Home":
          nextDay = addDays(day, -day.getDay());
          break;
        case "End":
          nextDay = addDays(day, 6 - day.getDay());
          break;
        case "PageUp":
          nextDay = addMonthsClamped(day, -1);
          break;
        case "PageDown":
          nextDay = addMonthsClamped(day, 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          openCreateForAllDayDate(day);
          return;
        default:
          return;
      }

      if (!nextDay) {
        return;
      }
      event.preventDefault();
      focusCalendarDate(nextDay);
    },
    [focusCalendarDate, openCreateForAllDayDate],
  );

  useEffect(() => {
    const pendingDate = pendingCalendarGridFocusRef.current;
    if (!pendingDate) {
      return;
    }
    pendingCalendarGridFocusRef.current = null;
    window.requestAnimationFrame(() => {
      calendarDayButtonRefs.current.get(pendingDate)?.focus({
        preventScroll: true,
      });
    });
  });

  const openCalendarMenuAtElement = useCallback(
    (calendarId: number, element: HTMLElement): void => {
      const rect = element.getBoundingClientRect();
      setExternalCalendarMenu(null);
      setCalendarMenu({
        calendarId,
        x: rect.right + 8,
        y: rect.bottom + 6,
      });
    },
    [],
  );

  const openExternalCalendarMenuAtElement = useCallback(
    (calendarId: number, element: HTMLElement): void => {
      const rect = element.getBoundingClientRect();
      setCalendarMenu(null);
      setExternalCalendarMenu({
        calendarId,
        x: rect.right + 8,
        y: rect.bottom + 6,
      });
    },
    [],
  );

  const saveEvent = useCallback(
    async (
      input: Parameters<ProjectProcedures["createCalendarEvent"]>[0] & {
        eventId?: number;
        expectedVersion?: number | null;
      },
    ) => {
      if (eventSaveInFlightRef.current) {
        return;
      }
      eventSaveInFlightRef.current = true;
      try {
        if (typeof input.eventId === "number") {
          await procedures.updateCalendarEvent(
            input as Parameters<ProjectProcedures["updateCalendarEvent"]>[0],
          );
        } else {
          await procedures.createCalendarEvent(input);
        }
        dispatch({ type: "close-dialog" });
        await load();
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
      } finally {
        eventSaveInFlightRef.current = false;
      }
    },
    [load, procedures],
  );

  const deleteOccurrence = useCallback(
    async (
      occurrence: RpcCalendarOccurrence,
      scope: "whole_series" | "after_this" | "just_this" = "whole_series",
    ) => {
      try {
        if (
          occurrence.sourceType !== "local" ||
          typeof occurrence.eventId !== "number"
        ) {
          return;
        }
        await procedures.deleteCalendarEvent({
          eventId: occurrence.eventId,
          scope,
          occurrenceStart: occurrence.originalStart,
          expectedVersion: occurrence.version,
        });
        dispatch({ type: "close-dialog" });
        await load();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
      }
    },
    [load, procedures],
  );

  const createCalendar = useCallback(async (): Promise<void> => {
    const title = prompt("Calendar name", "New calendar");
    if (!title) return;
    try {
      await procedures.createCalendar({ title });
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
    }
  }, [load, procedures]);

  const addExternal = useCallback(async (): Promise<void> => {
    const url = prompt("ICS subscription URL");
    if (!url) return;
    try {
      const created = await procedures.createExternalIcsCalendar({
        title: "External calendar",
        url,
      });
      let refreshErrorMessage = "";
      try {
        await procedures.refreshExternalIcsCalendar({
          externalCalendarId: created.id,
        });
      } catch (refreshError) {
        refreshErrorMessage =
          refreshError instanceof Error
            ? refreshError.message
            : String(refreshError);
      }
      await load();
      if (refreshErrorMessage) {
        setError(
          `ICS subscription was saved, but refresh failed: ${refreshErrorMessage}`,
        );
      }
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    }
  }, [load, procedures]);

  const saveCalendar = useCallback(
    async (
      input: Parameters<ProjectProcedures["updateCalendar"]>[0],
    ): Promise<void> => {
      try {
        await procedures.updateCalendar(input);
        await load();
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
        throw saveError;
      }
    },
    [load, procedures],
  );

  const deleteCalendar = useCallback(
    async (calendar: RpcCalendar): Promise<void> => {
      try {
        await procedures.deleteCalendar({ calendarId: calendar.id });
        setCalendarMenu(null);
        setEditingCalendar(null);
        await load();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
        throw deleteError;
      }
    },
    [load, procedures],
  );

  const saveExternalCalendar = useCallback(
    async (
      input: Parameters<ProjectProcedures["updateExternalIcsCalendar"]>[0],
      options: { urlChanged: boolean },
    ): Promise<void> => {
      try {
        await procedures.updateExternalIcsCalendar(input);
        let refreshErrorMessage = "";
        if (options.urlChanged) {
          try {
            await procedures.refreshExternalIcsCalendar({
              externalCalendarId: input.externalCalendarId,
            });
          } catch (refreshError) {
            refreshErrorMessage =
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError);
          }
        }
        await load();
        if (refreshErrorMessage) {
          setError(
            `ICS subscription was saved, but refresh failed: ${refreshErrorMessage}`,
          );
        }
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
        throw saveError;
      }
    },
    [load, procedures],
  );

  const deleteExternalCalendar = useCallback(
    async (calendar: RpcExternalIcsCalendar): Promise<void> => {
      try {
        await procedures.deleteExternalIcsCalendar({
          externalCalendarId: calendar.id,
        });
        setExternalCalendarMenu(null);
        setEditingExternalCalendar(null);
        await load();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
        throw deleteError;
      }
    },
    [load, procedures],
  );

  const describeOccurrenceButton = (
    occurrence: RpcCalendarOccurrence,
  ): string => {
    const when = occurrence.allDay
      ? `all day ${occurrence.startDate ?? "date unavailable"}${occurrence.endDate ? ` to ${occurrence.endDate}` : ""}`
      : `${occurrence.startAt ? new Date(occurrence.startAt).toLocaleString() : "start time unavailable"}${occurrence.endAt ? ` to ${new Date(occurrence.endAt).toLocaleString()}` : ""}`;
    const source =
      occurrence.sourceType === "local" ? "local calendar" : "external ICS";
    const writable = occurrence.writable ? "Editable." : "Read only.";
    return `${occurrence.title}. ${when}. ${source}. ${writable}`;
  };

  const renderEventButton = (
    occurrence: RpcCalendarOccurrence,
  ): JSX.Element => (
    <CalendarEventButton
      key={occurrence.occurrenceId}
      color={occurrence.color}
      ariaLabel={describeOccurrenceButton(occurrence)}
      onClick={() =>
        dispatch({
          type: "open-dialog",
          dialog: { kind: "detail", occurrence },
        })
      }
      onKeyDown={(event) => {
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          occurrence.writable
        ) {
          event.preventDefault();
          if (occurrence.isRecurring)
            dispatch({
              type: "open-dialog",
              dialog: { kind: "delete-scope", occurrence },
            });
          else void deleteOccurrence(occurrence);
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          dispatch({
            type: "open-dialog",
            dialog: { kind: "detail", occurrence },
          });
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        dispatch({
          type: "open-dialog",
          dialog: { kind: "detail", occurrence },
        });
      }}
    >
      {occurrence.title}
    </CalendarEventButton>
  );

  const renderMonth = (): JSX.Element => {
    const days = monthGridDays(state.anchorDate);
    const rows = Array.from({ length: 6 }, (_, rowIndex) =>
      days.slice(rowIndex * 7, rowIndex * 7 + 7),
    );
    const todayKey = toDateInputValue(new Date());
    return (
      <table
        aria-label={`${formatCalendarRangeLabel("month", state.anchorDate)} month calendar`}
        className="w-full flex-1 table-fixed border-l border-t border-border-subtle text-xs"
      >
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.map(toDateInputValue).join(":")}>
              {row.map((day) => {
                const key = toDateInputValue(day);
                const items = grouped.get(key) ?? [];
                const isFocused = focusedCalendarDateValue === key;
                const inCurrentMonth =
                  day.getMonth() === state.anchorDate.getMonth();
                return (
                  <td
                    className="min-h-24 border-b border-r border-border-subtle p-1 align-top"
                    key={key}
                  >
                    <AppButton
                      unstyled
                      ref={(element) => {
                        if (element) {
                          calendarDayButtonRefs.current.set(key, element);
                        } else {
                          calendarDayButtonRefs.current.delete(key);
                        }
                      }}
                      aria-current={key === todayKey ? "date" : undefined}
                      aria-label={`${formatCalendarColumnHeader(day)}, ${items.length} event${items.length === 1 ? "" : "s"}. Press Enter to create an all-day event.`}
                      className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center border px-1 text-[10px] transition-colors focus-visible:border-focus-ring focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 ${
                        isFocused
                          ? "border-accent bg-surface-2 text-text-primary"
                          : "border-transparent text-text-faint hover:bg-surface-1"
                      } ${inCurrentMonth ? "" : "opacity-60"}`}
                      onClick={() => {
                        setFocusedCalendarDateValue(key);
                        dispatch({ type: "jump", date: startOfLocalDay(day) });
                      }}
                      onDoubleClick={() => openCreateForAllDayDate(day)}
                      onFocus={() => setFocusedCalendarDateValue(key)}
                      onKeyDown={(event) =>
                        handleCalendarGridKeyDown(event, day)
                      }
                      tabIndex={
                        isFocused ||
                        (rowIndex === 0 &&
                          key === toDateInputValue(days[0] ?? day) &&
                          !days.some(
                            (candidate) =>
                              toDateInputValue(candidate) ===
                              focusedCalendarDateValue,
                          ))
                          ? 0
                          : -1
                      }
                      type="button"
                    >
                      {day.getDate()}
                    </AppButton>
                    <div className="space-y-1">
                      {items.slice(0, 3).map(renderEventButton)}
                      {items.length > 3 ? (
                        <AppButton
                          unstyled
                          aria-label={`Show all ${items.length} events for ${formatCalendarColumnHeader(day)}`}
                          className="text-left text-[10px] text-text-faint underline-offset-2 hover:text-text-secondary hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1"
                          onClick={() => {
                            setFocusedCalendarDateValue(key);
                            dispatch({
                              type: "jump",
                              date: startOfLocalDay(day),
                            });
                            dispatch({ type: "set-view", view: "day" });
                          }}
                          type="button"
                        >
                          +{items.length - 3} more
                        </AppButton>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderDayColumn = (day: Date, dayIndex: number): JSX.Element => {
    const key = toDateInputValue(day);
    const dayOccurrences = grouped.get(key) ?? [];
    const timed = layoutTimedOccurrences(dayOccurrences, day);
    return (
      <div
        key={key}
        className="relative min-h-[960px] min-w-0 border-r border-border-subtle bg-bg-app"
      >
        <AppButton
          unstyled
          aria-label={`${formatCalendarColumnHeader(day)}. Press Enter to create an all-day event.`}
          className={`sticky ${
            isMobile ? "top-14" : "top-0"
          } z-30 w-full truncate border-b border-border-subtle bg-surface-1 px-2 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px]`}
          onClick={() => openCreateForAllDayDate(day)}
          onKeyDown={(event) => handleCalendarGridKeyDown(event, day)}
          type="button"
        >
          {formatCalendarColumnHeader(day)}
        </AppButton>
        <div className="relative min-h-[960px]">
          {Array.from({ length: 24 }, (_, hour) => `hour-${hour}`).map(
            (hourKey) => {
              const hour = Number(hourKey.slice("hour-".length));
              const label = new Date(2000, 0, 1, hour).toLocaleTimeString(
                undefined,
                { hour: "numeric" },
              );
              return (
                <div
                  key={hourKey}
                  className={`relative h-10 border-b border-border-subtle text-[10px] ${hour < 7 || hour >= 19 ? "bg-surface-1/60" : ""}`}
                >
                  <AppButton
                    unstyled
                    aria-label={`Create event on ${formatCalendarColumnHeader(day)} at ${label}`}
                    className="absolute inset-0 text-left transition-colors hover:bg-surface-2/50 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px]"
                    onClick={() => openCreateForTimeSlot(day, hour)}
                    type="button"
                  >
                    {dayIndex === 0 ? (
                      <span className="pointer-events-none absolute bottom-0.5 left-1 text-text-faint">
                        {label}
                      </span>
                    ) : null}
                  </AppButton>
                </div>
              );
            },
          )}
          <div className="pointer-events-none absolute left-1 right-1 top-1 z-20 space-y-1">
            {dayOccurrences
              .filter((item) => item.allDay)
              .map((occurrence) => (
                <div
                  key={occurrence.occurrenceId}
                  className="pointer-events-auto"
                >
                  {renderEventButton(occurrence)}
                </div>
              ))}
          </div>
          {timed.map((layout) => (
            <CalendarTimedLayout
              key={layout.occurrence.occurrenceId}
              column={layout.column}
              columnCount={layout.columnCount}
              heightPercent={layout.heightPercent}
              topPercent={layout.topPercent}
            >
              {renderEventButton(layout.occurrence)}
            </CalendarTimedLayout>
          ))}
        </div>
      </div>
    );
  };

  const renderTimed = (): JSX.Element => {
    const days =
      state.view === "day" ? [state.anchorDate] : weekDays(state.anchorDate);
    return (
      <fieldset
        className={`grid auto-cols-fr grid-flow-col border border-border-subtle p-0 ${
          isMobile ? "min-h-[960px]" : "min-h-0 flex-1 overflow-y-auto"
        }`}
      >
        <legend className="sr-only">
          {formatCalendarRangeLabel(state.view, state.anchorDate)} timed
          calendar grid
        </legend>
        {days.map((day, dayIndex) => renderDayColumn(day, dayIndex))}
      </fieldset>
    );
  };

  const renderAgenda = (): JSX.Element => (
    <div
      className={`border border-border-subtle ${isMobile ? "" : "flex-1 overflow-y-auto"}`}
    >
      {occurrences.length === 0 ? (
        <div className="p-4 text-sm text-text-muted">No upcoming events.</div>
      ) : (
        occurrences.map((occurrence) => (
          <div
            key={occurrence.occurrenceId}
            className="border-b border-border-subtle px-3 py-2"
          >
            {renderEventButton(occurrence)}
            <div className="mt-1 text-[11px] text-text-faint">
              {occurrence.allDay
                ? occurrence.startDate
                : occurrence.startAt
                  ? new Date(occurrence.startAt).toLocaleString()
                  : ""}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div
      className={`flex ${
        isMobile ? "min-h-full flex-none flex-col" : "min-h-0 flex-1 flex-row"
      } bg-bg-app text-text-primary`}
    >
      <aside
        className={`${
          isMobile ? "border-b" : "w-72 overflow-y-auto border-r"
        } border-border-subtle bg-surface-1 p-3 text-xs`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-label uppercase tracking-[0.1em] text-accent">
            Calendars
          </div>
          <AppButton
            aria-label="Create calendar"
            buttonStyle="muted"
            iconOnly
            onClick={createCalendar}
          >
            {materialSymbol("plus", "text-[15px]")}
          </AppButton>
        </div>
        <div className="space-y-1">
          {calendars.map((calendar) => (
            <TintedCheckboxRow
              key={calendar.id}
              checked={calendar.visible}
              checkboxLabel={
                calendar.visible
                  ? `Hide calendar ${calendar.title}`
                  : `Show calendar ${calendar.title}`
              }
              onChange={async () => {
                try {
                  await procedures.updateCalendarPreference({
                    calendarId: calendar.id,
                    visible: !calendar.visible,
                  });
                  await load();
                } catch (preferenceError) {
                  setError(
                    preferenceError instanceof Error
                      ? preferenceError.message
                      : String(preferenceError),
                  );
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setExternalCalendarMenu(null);
                setCalendarMenu({
                  calendarId: calendar.id,
                  x: event.clientX + 6,
                  y: event.clientY + 6,
                });
              }}
              tintColor={
                calendar.effectiveColor || CALENDAR_VISIBILITY_FALLBACK_COLOR
              }
              trailing={
                <AppButton
                  aria-label={`Calendar actions for ${calendar.title}`}
                  aria-haspopup="dialog"
                  buttonStyle="muted"
                  className="h-6 w-6 min-w-0"
                  iconOnly
                  onClick={(event) => {
                    openCalendarMenuAtElement(calendar.id, event.currentTarget);
                  }}
                >
                  {materialSymbol("menu", "text-[15px]")}
                </AppButton>
              }
            >
              <CalendarColorSwatch
                className="h-3 w-3 shrink-0"
                color={calendar.effectiveColor}
              />
              <span className="min-w-0 flex-1 truncate">{calendar.title}</span>
            </TintedCheckboxRow>
          ))}
        </div>
        {externalCalendars.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 font-label uppercase tracking-[0.1em] text-accent">
              ICS subscriptions
            </div>
            <div className="space-y-1">
              {externalCalendars.map((calendar) => (
                <TintedCheckboxRow
                  key={calendar.id}
                  checked={calendar.visible}
                  checkboxLabel={
                    calendar.visible
                      ? `Hide ICS subscription ${calendar.title}`
                      : `Show ICS subscription ${calendar.title}`
                  }
                  onChange={async () => {
                    try {
                      await procedures.updateExternalIcsCalendar({
                        externalCalendarId: calendar.id,
                        visible: !calendar.visible,
                      });
                      await load();
                    } catch (preferenceError) {
                      setError(
                        preferenceError instanceof Error
                          ? preferenceError.message
                          : String(preferenceError),
                      );
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setCalendarMenu(null);
                    setExternalCalendarMenu({
                      calendarId: calendar.id,
                      x: event.clientX + 6,
                      y: event.clientY + 6,
                    });
                  }}
                  tintColor={
                    calendar.color || CALENDAR_VISIBILITY_FALLBACK_COLOR
                  }
                  trailing={
                    <AppButton
                      aria-label={`ICS subscription actions for ${calendar.title}`}
                      aria-haspopup="dialog"
                      buttonStyle="muted"
                      className="h-6 w-6 min-w-0"
                      iconOnly
                      onClick={(event) => {
                        openExternalCalendarMenuAtElement(
                          calendar.id,
                          event.currentTarget,
                        );
                      }}
                    >
                      {materialSymbol("menu", "text-[15px]")}
                    </AppButton>
                  }
                >
                  <CalendarColorSwatch
                    className="h-3 w-3 shrink-0"
                    color={calendar.color}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{calendar.title}</span>
                    {calendar.lastError ? (
                      <span className="mt-1 block truncate text-[10px] text-danger-text">
                        {calendar.lastError}
                      </span>
                    ) : null}
                  </span>
                </TintedCheckboxRow>
              ))}
            </div>
          </div>
        ) : null}
        <AppButton
          buttonStyle="muted"
          className="mt-3 justify-start text-left"
          fullWidth
          onClick={addExternal}
        >
          {materialSymbol("plus", "text-[15px]")}
          ICS subscription
        </AppButton>
      </aside>
      <section
        aria-busy={busy}
        className={`flex flex-col p-3 ${isMobile ? "" : "min-h-0 flex-1"}`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChoiceDropdownControl
            iconName="schedule"
            label="Calendar View"
            onChange={(view) => dispatch({ type: "set-view", view })}
            options={CALENDAR_VIEW_OPTIONS}
            panelPlacement="bottom-start"
            title="Calendar view"
            value={state.view}
          />
          <AppButton
            aria-label="Previous calendar range"
            buttonStyle="muted"
            iconOnly
            onClick={() => dispatch({ type: "previous" })}
          >
            {materialSymbol("chevron_right", "rotate-180 text-[15px]")}
          </AppButton>
          <AppButton
            buttonStyle="secondary"
            onClick={() => dispatch({ type: "today" })}
          >
            <span className="font-label text-[11px] uppercase tracking-[0.1em]">
              Today
            </span>
          </AppButton>
          <AppButton
            aria-label="Next calendar range"
            buttonStyle="muted"
            iconOnly
            onClick={() => dispatch({ type: "next" })}
          >
            {materialSymbol("chevron_right", "text-[15px]")}
          </AppButton>
          <div className="text-sm font-semibold text-text-secondary">
            {formatCalendarRangeLabel(state.view, state.anchorDate)}
          </div>
          <ToolbarDateInput
            aria-label="Jump to calendar date"
            className="ml-auto"
            name="calendar-anchor-date"
            value={toDateInputValue(state.anchorDate)}
            onChange={(event) =>
              dispatch({
                type: "jump",
                date: new Date(`${event.target.value}T00:00:00`),
              })
            }
          />
          <AppButton
            buttonStyle="primary"
            onClick={() =>
              dispatch({ type: "open-dialog", dialog: { kind: "create" } })
            }
          >
            <span className="font-label text-[11px] uppercase tracking-[0.1em]">
              New Event
            </span>
          </AppButton>
        </div>
        {error ? (
          <div className="mb-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
            {error}
          </div>
        ) : null}
        {busy ? (
          <div className="sr-only" role="status">
            Loading calendar…
          </div>
        ) : null}
        {state.view === "month"
          ? renderMonth()
          : state.view === "agenda"
            ? renderAgenda()
            : renderTimed()}
      </section>
      {calendarMenu && calendarMenuTarget ? (
        <PopoverSurface
          aria-label={`Calendar actions for ${calendarMenuTarget.title}`}
          className="z-[180] w-52 border border-border-default bg-surface-overlay p-1 text-xs shadow-overlay"
          offsetPx={0}
          onRequestClose={() => setCalendarMenu(null)}
          open
          placement="bottom-start"
          reference={createPointReference({
            x: calendarMenu.x,
            y: calendarMenu.y,
          })}
          surfaceMode="nonmodal-dialog"
        >
          <AppButton
            buttonStyle="muted"
            className="justify-start"
            disabled={!calendarMenuActionAvailability?.canEdit}
            fullWidth
            onClick={() => {
              setEditingCalendar(calendarMenuTarget);
              setCalendarMenu(null);
            }}
          >
            Edit
          </AppButton>
          <AppButton
            buttonStyle="error"
            className="justify-start"
            disabled={!calendarMenuActionAvailability?.canDelete}
            fullWidth
            onClick={() => {
              setCalendarMenu(null);
              setPendingCalendarDelete(calendarMenuTarget);
            }}
          >
            Delete
          </AppButton>
        </PopoverSurface>
      ) : null}
      {externalCalendarMenu && externalCalendarMenuTarget ? (
        <PopoverSurface
          aria-label={`ICS subscription actions for ${externalCalendarMenuTarget.title}`}
          className="z-[180] w-52 border border-border-default bg-surface-overlay p-1 text-xs shadow-overlay"
          offsetPx={0}
          onRequestClose={() => setExternalCalendarMenu(null)}
          open
          placement="bottom-start"
          reference={createPointReference({
            x: externalCalendarMenu.x,
            y: externalCalendarMenu.y,
          })}
          surfaceMode="nonmodal-dialog"
        >
          <AppButton
            buttonStyle="muted"
            className="justify-start"
            fullWidth
            onClick={() => {
              setEditingExternalCalendar(externalCalendarMenuTarget);
              setExternalCalendarMenu(null);
            }}
          >
            Edit
          </AppButton>
          <AppButton
            buttonStyle="muted"
            className="justify-start"
            fullWidth
            onClick={async () => {
              try {
                await procedures.refreshExternalIcsCalendar({
                  externalCalendarId: externalCalendarMenuTarget.id,
                });
                setExternalCalendarMenu(null);
                await load();
              } catch (refreshError) {
                setExternalCalendarMenu(null);
                setError(
                  refreshError instanceof Error
                    ? refreshError.message
                    : String(refreshError),
                );
              }
            }}
          >
            Refresh
          </AppButton>
          <AppButton
            buttonStyle="error"
            className="justify-start"
            fullWidth
            onClick={() => {
              setExternalCalendarMenu(null);
              setPendingExternalCalendarDelete(externalCalendarMenuTarget);
            }}
          >
            Delete subscription
          </AppButton>
        </PopoverSurface>
      ) : null}
      {(state.dialog.kind === "create" || state.dialog.kind === "edit") &&
      bootstrap ? (
        <Suspense fallback={null}>
          <CalendarEventDialog
            calendars={calendars}
            createDefaults={
              state.dialog.kind === "create" ? state.dialog : null
            }
            occurrence={
              state.dialog.kind === "edit" ? state.dialog.occurrence : null
            }
            timezone={timezone}
            onClose={closeDialog}
            onSave={saveEvent}
          />
        </Suspense>
      ) : null}
      {state.dialog.kind === "detail" ? (
        <Suspense fallback={null}>
          <CalendarEventDetailDialog
            occurrence={state.dialog.occurrence}
            onClose={closeDialog}
            onEdit={() => {
              if (state.dialog.kind === "detail") {
                dispatch({
                  type: "open-dialog",
                  dialog: { kind: "edit", occurrence: state.dialog.occurrence },
                });
              }
            }}
            onDelete={() => {
              const occurrence =
                state.dialog.kind === "detail" ? state.dialog.occurrence : null;
              if (!occurrence) return;
              if (occurrence.isRecurring)
                dispatch({
                  type: "open-dialog",
                  dialog: { kind: "delete-scope", occurrence },
                });
              else void deleteOccurrence(occurrence);
            }}
          />
        </Suspense>
      ) : null}
      {state.dialog.kind === "delete-scope" ? (
        <ModalDialogSurface
          aria-labelledby={deleteScopeTitleId}
          backdropLabel="Cancel recurring event deletion"
          className="border border-border-default bg-surface-1 p-4 text-text-primary shadow-overlay"
          initialFocusRef={deleteScopeCancelButtonRef}
          onRequestClose={closeDialog}
          open
          overlayClassName="fixed inset-0 z-[180] flex items-center justify-center px-4 py-6"
        >
          <div className="mb-3 text-sm font-semibold" id={deleteScopeTitleId}>
            Delete what?
          </div>
          <div className="flex flex-wrap gap-2">
            {(["whole_series", "after_this", "just_this"] as const).map(
              (scope) => (
                <AppButton
                  key={scope}
                  buttonStyle="secondary"
                  onClick={() => {
                    if (state.dialog.kind === "delete-scope") {
                      void deleteOccurrence(state.dialog.occurrence, scope);
                    }
                  }}
                >
                  {scope === "whole_series"
                    ? "Whole series"
                    : scope === "after_this"
                      ? "After this"
                      : "Just this event"}
                </AppButton>
              ),
            )}
            <AppButton
              buttonStyle="muted"
              onClick={closeDialog}
              ref={deleteScopeCancelButtonRef}
            >
              Cancel
            </AppButton>
          </div>
        </ModalDialogSurface>
      ) : null}
      {editingCalendar ? (
        <Suspense fallback={null}>
          <CalendarEditDialog
            calendar={editingCalendar}
            onClose={() => setEditingCalendar(null)}
            onDelete={() => deleteCalendar(editingCalendar)}
            onSave={saveCalendar}
          />
        </Suspense>
      ) : null}
      {editingExternalCalendar ? (
        <Suspense fallback={null}>
          <CalendarIcsEditDialog
            calendar={editingExternalCalendar}
            onClose={() => setEditingExternalCalendar(null)}
            onDelete={() => deleteExternalCalendar(editingExternalCalendar)}
            onSave={saveExternalCalendar}
          />
        </Suspense>
      ) : null}
      <ConfirmDialog
        confirmLabel="Delete"
        details={pendingCalendarDelete?.title}
        message="Delete calendar?"
        onCancel={() => setPendingCalendarDelete(null)}
        onConfirm={() => {
          const calendar = pendingCalendarDelete;
          setPendingCalendarDelete(null);
          if (calendar) {
            void deleteCalendar(calendar);
          }
        }}
        open={pendingCalendarDelete !== null}
        title="Delete Calendar"
      />
      <ConfirmDialog
        confirmLabel="Delete"
        details={pendingExternalCalendarDelete?.title}
        message="Delete ICS subscription?"
        onCancel={() => setPendingExternalCalendarDelete(null)}
        onConfirm={() => {
          const calendar = pendingExternalCalendarDelete;
          setPendingExternalCalendarDelete(null);
          if (calendar) {
            void deleteExternalCalendar(calendar);
          }
        }}
        open={pendingExternalCalendarDelete !== null}
        title="Delete ICS Subscription"
      />
    </div>
  );
}
