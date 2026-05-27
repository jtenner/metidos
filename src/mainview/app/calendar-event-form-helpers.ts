/**
 * @file src/mainview/app/calendar-event-form-helpers.ts
 * @description Pure calendar event form serialization helpers.
 */

export type RepeatOption = "none" | "daily" | "weekly" | "monthly" | "yearly";

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
  const upper = rule?.toUpperCase() ?? "";
  if (!upper.trim()) return "none";
  if (upper.includes("FREQ=DAILY")) return "daily";
  if (upper.includes("FREQ=WEEKLY")) return "weekly";
  if (upper.includes("FREQ=MONTHLY")) return "monthly";
  if (upper.includes("FREQ=YEARLY")) return "yearly";
  return "none";
}

export function basicRRuleForRepeatOption(option: RepeatOption): string | null {
  if (option === "none") return null;
  return `RRULE:FREQ=${option.toUpperCase()}`;
}

export function recurrenceRuleForEventForm(input: {
  occurrence?: { recurrenceRule: string | null | undefined } | null;
  repeat: RepeatOption;
  repeatTouched: boolean;
}): string | null {
  return input.occurrence && !input.repeatTouched
    ? (input.occurrence.recurrenceRule ?? null)
    : basicRRuleForRepeatOption(input.repeat);
}
