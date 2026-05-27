/**
 * @file src/mainview/app/date-format.ts
 * @description Shared mainview date/time formatting helpers.
 */

const THREAD_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: true,
  minute: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const GIT_HISTORY_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function partsToRecord(
  parts: Intl.DateTimeFormatPart[],
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const partByType: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    partByType[part.type] = part.value;
  }
  return partByType;
}

export function formatThreadTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  const partByType = partsToRecord(
    THREAD_TIMESTAMP_FORMATTER.formatToParts(timestamp),
  );
  const month = partByType.month ?? "";
  const day = partByType.day ?? "";
  const year = partByType.year ?? "";
  const hour = partByType.hour ?? "";
  const minute = partByType.minute ?? "";
  const dayPeriod = partByType.dayPeriod ?? "";

  return `${month}/${day}/${year} ${hour}:${minute} ${dayPeriod}`.trim();
}

export function formatGitHistoryTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return GIT_HISTORY_TIMESTAMP_FORMATTER.format(timestamp);
}
