/**
 * @file src/mainview/app/calendar-event-dialog.tsx
 * @description Event create/edit form dialog for the Metidos calendar workspace.
 */

import {
  type FormEvent,
  type JSX,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CalendarEventInput,
  RpcCalendar,
  RpcCalendarOccurrence,
} from "../../bun/calendar/types";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";
import {
  datetimeLocalInputToIso,
  type RepeatOption,
  recurrenceRuleForEventForm,
  repeatOptionFromRRule,
  toDatetimeLocalInputValue,
} from "./calendar-event-form-helpers";

export function CalendarEventDialog({
  calendars,
  createDefaults,
  occurrence,
  onClose,
  onSave,
  timezone,
}: {
  calendars: RpcCalendar[];
  createDefaults?: {
    allDay?: boolean;
    endAt?: string | null;
    endDate?: string | null;
    startAt?: string | null;
    startDate?: string | null;
  } | null;
  occurrence?: RpcCalendarOccurrence | null;
  timezone: string;
  onClose: () => void;
  onSave: (
    input: CalendarEventInput & {
      eventId?: number;
      expectedVersion?: number | null;
    },
  ) => void;
}): JSX.Element {
  const dialogId = useId();
  const dialogTitleId = `${dialogId}-title`;
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const startDateId = `${dialogId}-start-date`;
  const endDateId = `${dialogId}-end-date`;
  const startDateTimeId = `${dialogId}-start-datetime`;
  const endDateTimeId = `${dialogId}-end-datetime`;
  const locationId = `${dialogId}-location`;
  const notesId = `${dialogId}-notes`;
  const writableCalendars = calendars.filter(
    (calendar) =>
      calendar.permission === "owner" || calendar.permission === "write",
  );
  const initialCalendarId =
    occurrence?.sourceType === "local"
      ? occurrence.calendarId
      : writableCalendars[0]?.id;
  const [calendarId, setCalendarId] = useState(initialCalendarId ?? 0);
  const [title, setTitle] = useState(occurrence?.title ?? "");
  const [description, setDescription] = useState(occurrence?.description ?? "");
  const [location, setLocation] = useState(occurrence?.location ?? "");
  const [allDay, setAllDay] = useState(
    occurrence?.allDay ?? createDefaults?.allDay ?? false,
  );
  const [start, setStart] = useState(() =>
    toDatetimeLocalInputValue(
      occurrence?.startAt ?? createDefaults?.startAt,
      new Date(),
    ),
  );
  const [end, setEnd] = useState(() =>
    toDatetimeLocalInputValue(
      occurrence?.endAt ?? createDefaults?.endAt,
      new Date(Date.now() + 60 * 60_000),
    ),
  );
  const [startDate, setStartDate] = useState(
    () =>
      occurrence?.startDate ??
      createDefaults?.startDate ??
      new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState(
    () =>
      occurrence?.endDate ??
      createDefaults?.endDate ??
      new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10),
  );
  const initialRepeat = repeatOptionFromRRule(occurrence?.recurrenceRule);
  const [repeat, setRepeat] = useState<RepeatOption>(initialRepeat);
  const [repeatTouched, setRepeatTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const cannotSave = writableCalendars.length === 0 || !calendarId;
  const notice = useMemo(() => {
    if (writableCalendars.length === 0) {
      return "Create or select a writable calendar before adding events.";
    }
    return "";
  }, [writableCalendars.length]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (cannotSave) {
      return;
    }
    setFormError("");
    const recurrenceRule = recurrenceRuleForEventForm({
      occurrence: occurrence ?? null,
      repeat,
      repeatTouched,
    });
    let startAt: string | null = null;
    let endAt: string | null = null;
    if (allDay) {
      if (!startDate || !endDate) {
        setFormError("Choose a start and end date before saving.");
        return;
      }
      if (endDate < startDate) {
        setFormError("End date must be the same as or after the start date.");
        return;
      }
    } else {
      try {
        startAt = datetimeLocalInputToIso(start);
        endAt = datetimeLocalInputToIso(end);
      } catch (dateError) {
        setFormError(
          dateError instanceof Error ? dateError.message : String(dateError),
        );
        return;
      }
      if (Date.parse(endAt) < Date.parse(startAt)) {
        setFormError("End time must be the same as or after the start time.");
        return;
      }
    }
    onSave({
      ...(occurrence?.sourceType === "local" &&
      typeof occurrence.eventId === "number"
        ? { eventId: occurrence.eventId, expectedVersion: occurrence.version }
        : {}),
      calendarId,
      title: title.trim() || "Untitled event",
      description,
      location,
      allDay,
      startAt,
      endAt,
      startDate: allDay ? startDate : null,
      endDate: allDay ? endDate : null,
      timezone,
      recurrenceRule,
    });
  };

  return (
    <ModalDialogSurface
      aria-labelledby={dialogTitleId}
      backdropLabel="Close event editor"
      className="w-full max-w-2xl border border-border-default bg-surface-1 text-text-primary shadow-overlay"
      initialFocusRef={titleInputRef}
      onRequestClose={onClose}
      open
    >
      <form onSubmit={submit}>
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="text-sm font-semibold" id={dialogTitleId}>
            {occurrence ? "Edit event" : "New event"}
          </div>
          <AppButton
            aria-label="Close event editor"
            buttonStyle="muted"
            iconOnly
            onClick={onClose}
          >
            {materialSymbol("close", "text-[15px]")}
          </AppButton>
        </div>
        <div className="space-y-3 p-4 text-sm">
          {notice ? (
            <div className="border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
              {notice}
            </div>
          ) : null}
          {formError ? (
            <div
              className="border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text"
              role="alert"
            >
              {formError}
            </div>
          ) : null}
          <label className="block space-y-1">
            <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
              Calendar
            </span>
            <select
              className="w-full border border-border-default bg-surface-2 px-3 py-2"
              name="calendar-id"
              value={calendarId}
              onChange={(event) => setCalendarId(Number(event.target.value))}
            >
              {writableCalendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
              Title
            </span>
            <input
              aria-label="Event title"
              className="w-full border border-border-default bg-surface-2 px-3 py-2"
              name="calendar-event-title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              name="calendar-event-all-day"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />{" "}
            All-day
          </label>
          {allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1" htmlFor={startDateId}>
                <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                  Start date
                </span>
                <input
                  id={startDateId}
                  type="date"
                  className="w-full border border-border-default bg-surface-2 px-3 py-2"
                  name="calendar-event-start-date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label className="block space-y-1" htmlFor={endDateId}>
                <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                  End date
                </span>
                <input
                  id={endDateId}
                  type="date"
                  className="w-full border border-border-default bg-surface-2 px-3 py-2"
                  name="calendar-event-end-date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1" htmlFor={startDateTimeId}>
                <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                  Start time
                </span>
                <input
                  id={startDateTimeId}
                  type="datetime-local"
                  className="w-full border border-border-default bg-surface-2 px-3 py-2"
                  name="calendar-event-start"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label className="block space-y-1" htmlFor={endDateTimeId}>
                <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
                  End time
                </span>
                <input
                  id={endDateTimeId}
                  type="datetime-local"
                  className="w-full border border-border-default bg-surface-2 px-3 py-2"
                  name="calendar-event-end"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
            </div>
          )}
          <label className="block space-y-1">
            <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
              Repeat
            </span>
            <select
              className="w-full border border-border-default bg-surface-2 px-3 py-2"
              name="calendar-event-repeat"
              value={repeat}
              onChange={(event) => {
                setRepeatTouched(true);
                setRepeat(event.target.value as RepeatOption);
              }}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              {repeat === "custom" ? (
                <option value="custom">Custom repeat (preserved)</option>
              ) : null}
            </select>
          </label>
          <label className="block space-y-1" htmlFor={locationId}>
            <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
              Location
            </span>
            <input
              id={locationId}
              placeholder="Location"
              className="w-full border border-border-default bg-surface-2 px-3 py-2"
              name="calendar-event-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
          <label className="block space-y-1" htmlFor={notesId}>
            <span className="font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
              Notes
            </span>
            <textarea
              id={notesId}
              placeholder="Notes"
              className="min-h-20 w-full resize-y border border-border-default bg-surface-2 px-3 py-2"
              name="calendar-event-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <AppButton buttonStyle="muted" onClick={onClose}>
            Cancel
          </AppButton>
          <AppButton buttonStyle="primary" disabled={cannotSave} type="submit">
            Save
          </AppButton>
        </div>
      </form>
    </ModalDialogSurface>
  );
}
