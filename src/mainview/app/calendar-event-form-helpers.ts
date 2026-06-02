/**
 * @file src/mainview/app/calendar-event-form-helpers.ts
 * @description Pure calendar event form serialization helpers.
 */

export type RepeatOption =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export function toDatetimeLocalInputValue(
  iso: string | null | undefined,
  fallback = new Date(),
): string {
  const date = iso ? new Date(iso) : fallback;
  if (Number.isNaN(date.getTime())) {
    return toDatetimeLocalInputValue(null, fallback);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function datetimeLocalInputToIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid event date/time.");
  }
  return date.toISOString();
}

export function repeatOptionFromRRule(
  rule: string | null | undefined,
): RepeatOption {
  const trimmed = rule?.trim() ?? "";
  if (!trimmed) return "none";

  const match = /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/i.exec(trimmed);
  if (!match) return "custom";

  const frequency = match[1];
  if (!frequency) return "custom";

  return frequency.toLowerCase() as RepeatOption;
}

export function basicRRuleForRepeatOption(option: RepeatOption): string | null {
  if (option === "none" || option === "custom") return null;
  return `RRULE:FREQ=${option.toUpperCase()}`;
}

export function recurrenceRuleForEventForm(input: {
  occurrence?: { recurrenceRule: string | null | undefined } | null;
  repeat: RepeatOption;
  repeatTouched: boolean;
}): string | null {
  if (input.occurrence && (!input.repeatTouched || input.repeat === "custom")) {
    return input.occurrence.recurrenceRule ?? null;
  }
  return basicRRuleForRepeatOption(input.repeat);
}
