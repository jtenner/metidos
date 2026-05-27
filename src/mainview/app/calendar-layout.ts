/**
 * @file src/mainview/app/calendar-layout.ts
 * @description Pure calendar layout helpers for month/week/day/agenda rendering.
 */

import type { RpcCalendarOccurrence } from "../../bun/calendar/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonthsClamped(date: Date, months: number): Date {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const daysInTargetMonth = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  next.setDate(Math.min(originalDay, daysInTargetMonth));
  return next;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateOnlyUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthGridDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function weekDays(anchor: Date): Date[] {
  const start = addDays(startOfLocalDay(anchor), -anchor.getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function viewWindow(
  view: "month" | "week" | "day" | "agenda",
  anchor: Date,
): { start: string; end: string } {
  if (view === "month") {
    const days = monthGridDays(anchor);
    const firstDay = days[0] ?? anchor;
    const lastDay = days[41] ?? firstDay;
    return {
      start: firstDay.toISOString(),
      end: addDays(lastDay, 1).toISOString(),
    };
  }
  if (view === "week") {
    const days = weekDays(anchor);
    const firstDay = days[0] ?? anchor;
    const lastDay = days[6] ?? firstDay;
    return {
      start: firstDay.toISOString(),
      end: addDays(lastDay, 1).toISOString(),
    };
  }
  if (view === "agenda") {
    const start = startOfLocalDay(anchor);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }
  const start = startOfLocalDay(anchor);
  return { start: start.toISOString(), end: addDays(start, 1).toISOString() };
}

export function occurrenceDayKey(occurrence: RpcCalendarOccurrence): string {
  if (occurrence.allDay && occurrence.startDate) {
    return occurrence.startDate;
  }
  const date = new Date(occurrence.startAt ?? occurrence.originalStart);
  return toDateInputValue(date);
}

function pushGroupedOccurrence(
  grouped: Map<string, RpcCalendarOccurrence[]>,
  key: string,
  occurrence: RpcCalendarOccurrence,
): void {
  const list = grouped.get(key) ?? [];
  list.push(occurrence);
  grouped.set(key, list);
}

export function groupOccurrencesByDay(
  occurrences: RpcCalendarOccurrence[],
): Map<string, RpcCalendarOccurrence[]> {
  const grouped = new Map<string, RpcCalendarOccurrence[]>();
  for (const occurrence of occurrences) {
    if (occurrence.allDay && occurrence.startDate) {
      const start = new Date(`${occurrence.startDate}T00:00:00.000Z`);
      const end = new Date(
        `${occurrence.endDate ?? occurrence.startDate}T00:00:00.000Z`,
      );
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
        const finalDay = new Date(
          Math.max(start.getTime(), end.getTime() - DAY_MS),
        );
        for (
          let day = start;
          day.getTime() <= finalDay.getTime();
          day = new Date(day.getTime() + DAY_MS)
        ) {
          pushGroupedOccurrence(grouped, formatDateOnlyUtc(day), occurrence);
        }
        continue;
      }
    }
    if (!occurrence.allDay && occurrence.startAt && occurrence.endAt) {
      const start = new Date(occurrence.startAt);
      const end = new Date(occurrence.endAt);
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
        const finalInstant = new Date(
          Math.max(start.getTime(), end.getTime() - 1),
        );
        for (
          let day = startOfLocalDay(start);
          day.getTime() <= startOfLocalDay(finalInstant).getTime();
          day = addDays(day, 1)
        ) {
          pushGroupedOccurrence(grouped, toDateInputValue(day), occurrence);
        }
        continue;
      }
    }
    pushGroupedOccurrence(grouped, occurrenceDayKey(occurrence), occurrence);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) =>
      (left.startAt ?? left.startDate ?? "").localeCompare(
        right.startAt ?? right.startDate ?? "",
      ),
    );
  }
  return grouped;
}

export type TimedOccurrenceLayout = {
  occurrence: RpcCalendarOccurrence;
  topPercent: number;
  heightPercent: number;
  column: number;
  columnCount: number;
};

type TimedLayoutInput = {
  occurrence: RpcCalendarOccurrence;
  start: number;
  end: number;
};

function buildTimedLayout(
  item: TimedLayoutInput,
  column: number,
): TimedOccurrenceLayout {
  const startDate = new Date(item.start);
  const minutes = startDate.getHours() * 60 + startDate.getMinutes();
  const duration = Math.max(15 * 60 * 1000, item.end - item.start);
  return {
    occurrence: item.occurrence,
    topPercent: (minutes / (24 * 60)) * 100,
    heightPercent: (duration / DAY_MS) * 100,
    column,
    columnCount: 1,
  };
}

export function layoutTimedOccurrences(
  occurrences: RpcCalendarOccurrence[],
  displayedDay?: Date,
): TimedOccurrenceLayout[] {
  const dayStart = displayedDay
    ? startOfLocalDay(displayedDay).getTime()
    : null;
  const dayEnd = dayStart === null ? null : dayStart + DAY_MS;
  const timed = occurrences
    .flatMap((occurrence): TimedLayoutInput[] => {
      if (occurrence.allDay || !occurrence.startAt || !occurrence.endAt) {
        return [];
      }
      const rawStart = new Date(occurrence.startAt).getTime();
      const rawEnd = new Date(occurrence.endAt).getTime();
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
        return [];
      }
      const start = dayStart === null ? rawStart : Math.max(rawStart, dayStart);
      const end = dayEnd === null ? rawEnd : Math.min(rawEnd, dayEnd);
      if (end <= start) {
        return [];
      }
      return [{ occurrence, start, end }];
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const layouts: TimedOccurrenceLayout[] = [];
  let cluster: TimedLayoutInput[] = [];
  let clusterEnd = 0;

  const flushCluster = (): void => {
    if (cluster.length === 0) return;
    const activeColumns: number[] = [];
    const clusterLayouts: TimedOccurrenceLayout[] = [];
    let columnCount = 0;
    for (const item of cluster) {
      let column = 0;
      while ((activeColumns[column] ?? -Infinity) > item.start) {
        column += 1;
      }
      activeColumns[column] = item.end;
      columnCount = Math.max(columnCount, column + 1);
      clusterLayouts.push(buildTimedLayout(item, column));
    }
    for (const layout of clusterLayouts) {
      layout.columnCount = columnCount;
    }
    layouts.push(...clusterLayouts);
    cluster = [];
    clusterEnd = 0;
  };

  for (const item of timed) {
    if (cluster.length > 0 && item.start >= clusterEnd) {
      flushCluster();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flushCluster();
  return layouts;
}

export function formatCalendarColumnHeader(
  day: Date,
  locale?: Intl.LocalesArgument,
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(day);
}

export function formatCalendarRangeLabel(
  view: "month" | "week" | "day" | "agenda",
  anchor: Date,
): string {
  if (view === "month") {
    return anchor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const window = viewWindow(view, anchor);
  const start = new Date(window.start);
  const end = new Date(new Date(window.end).getTime() - DAY_MS);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
