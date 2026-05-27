import { describe, expect, it } from "bun:test";

import {
  CronConversionError,
  CronParseError,
  cronToUtc,
  normalizeCron,
  offsetHoursToMinutes,
  type ParsedCron,
  parseCron,
} from "./cron-utc";

function cronMatchesUtcDate(cron: ParsedCron, date: Date): boolean {
  if (!cron.minute.values.includes(date.getUTCMinutes())) {
    return false;
  }
  if (!cron.hour.values.includes(date.getUTCHours())) {
    return false;
  }
  if (!cron.month.values.includes(date.getUTCMonth() + 1)) {
    return false;
  }

  const domMatches = cron.dayOfMonth.values.includes(date.getUTCDate());
  const dowMatches = cron.dayOfWeek.values.includes(date.getUTCDay());
  if (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard) {
    return domMatches || dowMatches;
  }
  return domMatches && dowMatches;
}

function fixedOffsetLocalDate(utcDate: Date, offsetMinutes: number): Date {
  return new Date(utcDate.getTime() + offsetMinutes * 60_000);
}

function cronListMatchesUtcDate(
  crons: readonly ParsedCron[],
  date: Date,
): boolean {
  return crons.some((cron) => cronMatchesUtcDate(cron, date));
}

function expectUtcConversionEquivalentOverRange({
  expression,
  offsetMinutes,
  startIso,
  endIso,
}: {
  readonly expression: string;
  readonly offsetMinutes: number;
  readonly startIso: string;
  readonly endIso: string;
}): void {
  const localCron = parseCron(expression);
  const utcCrons = cronToUtc(expression, offsetMinutes).map(parseCron);
  const endMs = Date.parse(endIso);

  for (let timeMs = Date.parse(startIso); timeMs < endMs; timeMs += 60_000) {
    const utcDate = new Date(timeMs);
    const localDate = fixedOffsetLocalDate(utcDate, offsetMinutes);
    expect(cronListMatchesUtcDate(utcCrons, utcDate)).toBe(
      cronMatchesUtcDate(localCron, localDate),
    );
  }
}

describe("cron UTC conversion", () => {
  it("parses a simple five-field cron expression", () => {
    const cron = parseCron("0 9 * * *");
    expect(cron.minute.values).toEqual([0]);
    expect(cron.hour.values).toEqual([9]);
    expect(cron.dayOfMonth.wildcard).toBeTrue();
    expect(cron.month.wildcard).toBeTrue();
    expect(cron.dayOfWeek.wildcard).toBeTrue();
  });

  it("normalizes ranges, lists, steps, and names", () => {
    expect(normalizeCron("*/15 9-17 * JAN,MAR MON-FRI")).toBe(
      "0,15,30,45 9-17 * 1,3 1-5",
    );
  });

  it("normalizes lower-case aliases and unsorted duplicate values", () => {
    expect(normalizeCron("30,0,30 17,9 * mar,jan fri,mon,7")).toBe(
      "0,30 9,17 * 1,3 0-1,5",
    );
  });

  it("normalizes stepped ranges and stepped wildcards", () => {
    expect(normalizeCron("5-10/2 */6 1-10/3 */4 SUN-SAT/2")).toBe(
      "5,7,9 0,6,12,18 1,4,7,10 1,5,9 0,2,4,6",
    );
  });

  it("preserves original raw expression text on the parsed cron", () => {
    const expression = "  0   9   *   *   MON  ";
    expect(parseCron(expression).raw).toBe(expression);
  });

  it("accepts both 0 and 7 as Sunday", () => {
    expect(normalizeCron("0 0 * * SUN,7")).toBe("0 0 * * 0");
  });

  it("deduplicates Sunday when a range includes 0 and 7", () => {
    expect(normalizeCron("0 0 * * 0-7")).toBe("0 0 * * *");
  });

  it("supports a day-of-week range ending in 7", () => {
    expect(normalizeCron("0 0 * * FRI-7")).toBe("0 0 * * 0,5-6");
  });

  it("rejects non-standard field counts", () => {
    expect(() => parseCron("")).toThrow(CronParseError);
    expect(() => parseCron("   ")).toThrow(CronParseError);
    expect(() => parseCron("0 9 * *")).toThrow(CronParseError);
    expect(() => parseCron("0 9 * * * echo hello")).toThrow(CronParseError);
  });

  it("rejects invalid field values", () => {
    expect(() => parseCron("60 9 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 24 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 0 0 * *")).toThrow(CronParseError);
    expect(() => parseCron("0 0 * 13 *")).toThrow(CronParseError);
    expect(() => parseCron("0 0 * * 8")).toThrow(CronParseError);
    expect(() => parseCron("0 0 * FOO *")).toThrow(CronParseError);
    expect(() => parseCron("0 0 * * NOPE")).toThrow(CronParseError);
    expect(() => parseCron("1.5 0 * * *")).toThrow(CronParseError);
    expect(() => parseCron("-1 0 * * *")).toThrow(CronParseError);
  });

  it("rejects invalid ranges and steps", () => {
    expect(() => parseCron("0 10-5 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 5- * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 -5 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 1-2-3 * * *")).toThrow(CronParseError);
    expect(() => parseCron("*/0 9 * * *")).toThrow(CronParseError);
    expect(() => parseCron("*/x 9 * * *")).toThrow(CronParseError);
    expect(() => parseCron("*/1/2 9 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0,,30 9 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0, 9 * * *")).toThrow(CronParseError);
  });

  it("returns immutable parsed field values", () => {
    const cron = parseCron("0 9 * * *");
    expect(() => {
      (cron.minute.values as number[]).push(30);
    }).toThrow(TypeError);
    expect(cron.minute.values).toEqual([0]);
  });

  it("converts UTC-05:00 local schedule by adding five hours", () => {
    expect(cronToUtc("0 9 * * *", -300)).toEqual(["0 14 * * *"]);
  });

  it("converts UTC+02:00 local schedule by subtracting two hours", () => {
    expect(cronToUtc("0 9 * * *", 120)).toEqual(["0 7 * * *"]);
  });

  it("normalizes the input before returning a zero-offset conversion", () => {
    expect(cronToUtc("*/30 17,9 * jan,mar MON-FRI", 0)).toEqual([
      "0,30 9,17 * 1,3 1-5",
    ]);
  });

  it("supports offsetHoursToMinutes helper", () => {
    expect(offsetHoursToMinutes(-5)).toBe(-300);
    expect(offsetHoursToMinutes(5.5)).toBe(330);
    expect(offsetHoursToMinutes(5.999)).toBe(359);
    expect(offsetHoursToMinutes(-5.999)).toBe(-359);
    expect(() => offsetHoursToMinutes(Number.NaN)).toThrow(CronConversionError);
    expect(() => offsetHoursToMinutes(Number.POSITIVE_INFINITY)).toThrow(
      CronConversionError,
    );
  });

  it("keeps a daily schedule daily when the converted time spills into the next day", () => {
    expect(cronToUtc("30 22 * * *", -300)).toEqual(["30 3 * * *"]);
  });

  it("shifts day of week forward when UTC time is the next day", () => {
    expect(cronToUtc("0 23 * * MON-FRI", -120)).toEqual(["0 1 * * 2-6"]);
  });

  it("shifts day of week backward when UTC time is the previous day", () => {
    expect(cronToUtc("0 1 * * MON", 120)).toEqual(["0 23 * * 0"]);
  });

  it("handles extreme positive offset across the previous day", () => {
    expect(cronToUtc("0 0 * * MON", 840)).toEqual(["0 10 * * 0"]);
  });

  it("groups multiple converted hours into one cron when possible", () => {
    expect(cronToUtc("0 9,17 * * *", -300)).toEqual(["0 14,22 * * *"]);
  });

  it("handles minute spill into the next hour and next day", () => {
    expect(cronToUtc("45 23 * * *", -30)).toEqual(["15 0 * * *"]);
  });

  it("handles minute spill into the previous hour and previous day", () => {
    expect(cronToUtc("15 0 * * *", 30)).toEqual(["45 23 * * *"]);
  });

  it("handles near-whole-day negative offsets", () => {
    expect(cronToUtc("0 0 * * *", -1439)).toEqual(["59 23 * * *"]);
  });

  it("handles near-whole-day positive offsets", () => {
    expect(cronToUtc("59 23 * * *", 1439)).toEqual(["0 0 * * *"]);
  });

  it("does not create false cartesian products for shifted minute/hour pairs", () => {
    expect(cronToUtc("0,30 23 * * *", -45)).toEqual([
      "15 0 * * *",
      "45 23 * * *",
    ]);
  });

  it("keeps independent minute and hour sets compact when every pair stays aligned", () => {
    expect(cronToUtc("0,30 9,17 * * *", -60)).toEqual(["0,30 10,18 * * *"]);
  });

  it("splits converted schedules by incompatible minute sets", () => {
    expect(cronToUtc("0,30 0,23 * * *", -45)).toEqual([
      "15,45 0 * * *",
      "15 1 * * *",
      "45 23 * * *",
    ]);
  });

  it("converts day-of-month schedules that spill into the next month", () => {
    expect(cronToUtc("0 23 31 * *", -120)).toEqual(["0 1 1 1-2,4,6,8-9,11 *"]);
  });

  it("converts day-of-month schedules that spill into the previous month", () => {
    expect(cronToUtc("0 1 1 JAN,APR,JUN *", 120)).toEqual(["0 23 31 3,5,12 *"]);
  });

  it("rejects leap-day schedules that would run in common years after shifting", () => {
    expect(() => cronToUtc("0 23 29 FEB *", -120)).toThrow(CronConversionError);
  });

  it("allows intentionally non-strict leap-day conversion into March", () => {
    expect(cronToUtc("0 23 29 FEB *", -120, { strict: false })).toEqual([
      "0 1 1 3 *",
    ]);
  });

  it("splits day-of-month schedules when different months produce different target days", () => {
    expect(cronToUtc("0 23 30 * *", -120)).toEqual([
      "0 1 31 1,3,8 *",
      "0 1 1,31 5,7,10,12 *",
    ]);
  });

  it("converts month-restricted daily schedules crossing into the next month", () => {
    expect(cronToUtc("0 23 * JAN *", -120)).toEqual([
      "0 1 2-31 1 *",
      "0 1 1 2 *",
    ]);
  });

  it("allows exact leap-sensitive conversion when the input contains both Feb 28 and Feb 29", () => {
    expect(cronToUtc("0 23 28,29 FEB *", -120)).toEqual([
      "0 1 29 2 *",
      "0 1 1 3 *",
    ]);
  });

  it("rejects conversion that cannot be represented exactly without a year field", () => {
    expect(() => cronToUtc("0 23 28 FEB *", -120)).toThrow(CronConversionError);
  });

  it("allows intentionally non-strict leap-sensitive conversion", () => {
    expect(cronToUtc("0 23 28 FEB *", -120, { strict: false })).toEqual([
      "0 1 29 2 *",
      "0 1 1 3 *",
    ]);
  });

  it("rejects month-restricted day-of-week schedules that cross a day boundary", () => {
    expect(() => cronToUtc("0 23 * JAN MON", -120)).toThrow(
      CronConversionError,
    );
  });

  it("allows intentionally non-strict month-restricted day-of-week conversion", () => {
    expect(cronToUtc("0 23 * JAN MON", -120, { strict: false })).toEqual([
      "0 1 * * 2",
    ]);
  });

  it("rejects day-of-month plus day-of-week OR schedules that cross a day boundary", () => {
    expect(() => cronToUtc("0 23 15 * MON", -120)).toThrow(CronConversionError);
  });

  it("allows intentionally non-strict day-of-month plus day-of-week conversion", () => {
    expect(cronToUtc("0 23 15 * MON", -120, { strict: false })).toEqual([
      "0 1 15 * 2",
    ]);
  });

  it("keeps restricted day-of-month plus day-of-week schedules unchanged when no day boundary is crossed", () => {
    expect(cronToUtc("0 12 15 * MON", 0)).toEqual(["0 12 15 * 1"]);
  });

  it("rejects non-integer and out-of-range offsets", () => {
    expect(() => cronToUtc("0 9 * * *", -300.5)).toThrow(CronConversionError);
    expect(() => cronToUtc("0 9 * * *", Number.NaN)).toThrow(
      CronConversionError,
    );
    expect(() => cronToUtc("0 9 * * *", Number.POSITIVE_INFINITY)).toThrow(
      CronConversionError,
    );
    expect(() => cronToUtc("0 9 * * *", 1440)).toThrow(CronConversionError);
    expect(() => cronToUtc("0 9 * * *", -1440)).toThrow(CronConversionError);
  });

  it("keeps daily conversion behavior equivalent over a leap-year boundary", () => {
    expectUtcConversionEquivalentOverRange({
      expression: "15,45 0,12,23 * * *",
      offsetMinutes: -330,
      startIso: "2020-02-27T00:00:00.000Z",
      endIso: "2020-03-02T00:00:00.000Z",
    });
  });

  it("keeps weekday conversion behavior equivalent over a week boundary", () => {
    expectUtcConversionEquivalentOverRange({
      expression: "0 23 * * FRI,SAT,SUN,MON",
      offsetMinutes: -120,
      startIso: "2021-01-01T00:00:00.000Z",
      endIso: "2021-01-09T00:00:00.000Z",
    });
  });

  it("keeps day-of-month conversion behavior equivalent over month boundaries", () => {
    expectUtcConversionEquivalentOverRange({
      expression: "0 23 30,31 JAN,MAR,MAY *",
      offsetMinutes: -120,
      startIso: "2021-01-29T00:00:00.000Z",
      endIso: "2021-02-03T00:00:00.000Z",
    });
    expectUtcConversionEquivalentOverRange({
      expression: "0 23 30,31 JAN,MAR,MAY *",
      offsetMinutes: -120,
      startIso: "2021-03-29T00:00:00.000Z",
      endIso: "2021-04-03T00:00:00.000Z",
    });
  });

  it("keeps leap-day conversion behavior equivalent around February 29", () => {
    expectUtcConversionEquivalentOverRange({
      expression: "0 23 28,29 FEB *",
      offsetMinutes: -120,
      startIso: "2020-02-27T00:00:00.000Z",
      endIso: "2020-03-02T00:00:00.000Z",
    });
  });
});
