import { afterEach, describe, expect, it } from "bun:test";

import { computeNextRunDateForLocalCronSchedule } from "./cron-schedules";

const originalBunCron = Bun.cron;

afterEach(() => {
  (Bun as { cron: typeof Bun.cron }).cron = originalBunCron;
});

describe("cron schedule helpers", () => {
  it("computes the next run from the UTC-expanded scheduler schedule", () => {
    const parsedSchedules: string[] = [];
    const parseResults = new Map<string, Date>([
      ["0 10 * * 1,3,5", new Date("2026-05-20T10:00:00.000Z")],
      ["0 14 * * 1,3,5", new Date("2026-05-20T14:00:00.000Z")],
    ]);
    const cron = (() => ({
      stop: () => undefined,
    })) as unknown as typeof Bun.cron;
    (cron as unknown as { parse: (schedule: string) => Date }).parse = (
      schedule,
    ) => {
      parsedSchedules.push(schedule);
      return parseResults.get(schedule) ?? new Date(Number.NaN);
    };
    (Bun as { cron: typeof Bun.cron }).cron = cron;

    expect(
      computeNextRunDateForLocalCronSchedule("0 10 * * 1,3,5", "Etc/GMT+4"),
    ).toBe(Date.parse("2026-05-20T14:00:00.000Z"));
    expect(parsedSchedules).toEqual(["0 14 * * 1,3,5"]);
  });

  it("uses the earliest next run when local schedule expansion produces multiple UTC schedules", () => {
    const parsedSchedules: string[] = [];
    const parseResults = new Map<string, Date>([
      ["30 18 * * *", new Date("2026-05-21T18:30:00.000Z")],
      ["0 19 * * *", new Date("2026-05-20T19:00:00.000Z")],
    ]);
    const cron = (() => ({
      stop: () => undefined,
    })) as unknown as typeof Bun.cron;
    (cron as unknown as { parse: (schedule: string) => Date }).parse = (
      schedule,
    ) => {
      parsedSchedules.push(schedule);
      return parseResults.get(schedule) ?? new Date(Number.NaN);
    };
    (Bun as { cron: typeof Bun.cron }).cron = cron;

    expect(
      computeNextRunDateForLocalCronSchedule("0,30 0 * * *", "Asia/Kolkata"),
    ).toBe(Date.parse("2026-05-20T19:00:00.000Z"));
    expect(parsedSchedules).toEqual(["30 18 * * *", "0 19 * * *"]);
  });
});
