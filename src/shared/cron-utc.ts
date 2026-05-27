export type CronFieldName =
  | "minute"
  | "hour"
  | "dayOfMonth"
  | "month"
  | "dayOfWeek";

export interface ParsedCronField {
  readonly name: CronFieldName;
  readonly raw: string;
  readonly min: number;
  readonly max: number;
  readonly values: readonly number[];
  readonly wildcard: boolean;
}

export interface ParsedCron {
  readonly raw: string;
  readonly minute: ParsedCronField;
  readonly hour: ParsedCronField;
  readonly dayOfMonth: ParsedCronField;
  readonly month: ParsedCronField;
  readonly dayOfWeek: ParsedCronField;
}

export interface CronToUtcOptions {
  /**
   * Keep this true for production use. Standard 5-field cron cannot exactly
   * represent every date-shifted schedule, especially around leap years or
   * month-restricted day-of-week schedules.
   */
  readonly strict?: boolean;
}

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

export class CronConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronConversionError";
  }
}

type DateSpec = Readonly<{
  dom: readonly number[];
  month: readonly number[];
  dow: readonly number[];
}>;

const MONTH_ALIASES: Readonly<Record<string, number>> = Object.freeze({
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
});

const DOW_ALIASES: Readonly<Record<string, number>> = Object.freeze({
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
});

const FULL_MINUTES = range(0, 59);
const FULL_HOURS = range(0, 23);
const FULL_DOM = range(1, 31);
const FULL_MONTHS = range(1, 12);
const FULL_DOW = range(0, 6);

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/u);
  if (parts.length !== 5) {
    throw new CronParseError(
      `Expected a standard 5-field cron expression, got ${parts.length} field(s): ${JSON.stringify(expression)}`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  return {
    raw: expression,
    minute: parseField("minute", minute, 0, 59),
    hour: parseField("hour", hour, 0, 23),
    dayOfMonth: parseField("dayOfMonth", dayOfMonth, 1, 31),
    month: parseField("month", month, 1, 12, MONTH_ALIASES),
    dayOfWeek: parseField(
      "dayOfWeek",
      dayOfWeek,
      0,
      7,
      DOW_ALIASES,
      normalizeDayOfWeek,
    ),
  };
}

export function normalizeCron(expression: string): string {
  return formatCron(parseCron(expression));
}

export function formatCron(cron: ParsedCron): string {
  return [
    formatValues(cron.minute.values, FULL_MINUTES),
    formatValues(cron.hour.values, FULL_HOURS),
    formatValues(cron.dayOfMonth.values, FULL_DOM),
    formatValues(cron.month.values, FULL_MONTHS),
    formatValues(cron.dayOfWeek.values, FULL_DOW),
  ].join(" ");
}

/**
 * Convert a fixed-local-offset cron expression to UTC.
 *
 * @param expression standard 5-field crontab schedule
 * @param offsetMinutes local offset from UTC, e.g. UTC-05:00 is -300
 * @returns one or more equivalent UTC crontab schedules
 */
export function cronToUtc(
  expression: string,
  offsetMinutes: number,
  options: CronToUtcOptions = {},
): string[] {
  if (!Number.isInteger(offsetMinutes)) {
    throw new CronConversionError(
      `offsetMinutes must be an integer number of minutes, got ${offsetMinutes}`,
    );
  }
  if (offsetMinutes <= -1440 || offsetMinutes >= 1440) {
    throw new CronConversionError(
      "offsetMinutes must be greater than -1440 and less than 1440",
    );
  }

  const strict = options.strict ?? true;
  const cron = parseCron(expression);

  const pairsByDateSpec = new Map<
    string,
    { spec: DateSpec; pairs: Map<number, Set<number>> }
  >();

  for (const localHour of cron.hour.values) {
    for (const localMinute of cron.minute.values) {
      const shifted = shiftLocalTimeToUtc(
        localHour,
        localMinute,
        offsetMinutes,
      );
      const dateSpecs = convertDateSpec(cron, shifted.dayDelta, strict);

      for (const spec of dateSpecs) {
        const key = dateSpecKey(spec);
        let bucket = pairsByDateSpec.get(key);
        if (!bucket) {
          bucket = { spec, pairs: new Map() };
          pairsByDateSpec.set(key, bucket);
        }
        let minutesForHour = bucket.pairs.get(shifted.hour);
        if (!minutesForHour) {
          minutesForHour = new Set<number>();
          bucket.pairs.set(shifted.hour, minutesForHour);
        }
        minutesForHour.add(shifted.minute);
      }
    }
  }

  const output = new Set<string>();
  for (const bucket of pairsByDateSpec.values()) {
    for (const timeSpec of compactTimePairs(bucket.pairs)) {
      output.add(
        [
          formatValues(timeSpec.minutes, FULL_MINUTES),
          formatValues(timeSpec.hours, FULL_HOURS),
          formatValues(bucket.spec.dom, FULL_DOM),
          formatValues(bucket.spec.month, FULL_MONTHS),
          formatValues(bucket.spec.dow, FULL_DOW),
        ].join(" "),
      );
    }
  }

  return [...output].sort(compareCronStrings);
}

export function offsetHoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours)) {
    throw new CronConversionError(`Invalid UTC offset hour value: ${hours}`);
  }
  return Math.trunc(hours * 60);
}

function parseField(
  name: CronFieldName,
  raw: string,
  min: number,
  max: number,
  aliases: Readonly<Record<string, number>> = {},
  normalize: (value: number) => number = (value) => value,
): ParsedCronField {
  if (raw.trim() === "") {
    throw new CronParseError(`${name} field cannot be empty`);
  }

  const values = new Set<number>();

  for (const token of raw.split(",")) {
    if (token === "") {
      throw new CronParseError(
        `${name} field contains an empty list item: ${JSON.stringify(raw)}`,
      );
    }

    const [base, stepRaw, extra] = token.split("/") as [
      string,
      string | undefined,
      string | undefined,
    ];
    if (extra !== undefined) {
      throw new CronParseError(
        `${name} field contains too many '/' separators: ${JSON.stringify(token)}`,
      );
    }

    const step = stepRaw === undefined ? 1 : parseStep(name, token, stepRaw);
    const baseValues = expandBase(name, base, min, max, aliases, normalize);

    for (let i = 0; i < baseValues.length; i += step) {
      values.add(baseValues[i] as number);
    }
  }

  const sorted = [...values].sort((a, b) => a - b);
  const full = name === "dayOfWeek" ? FULL_DOW : range(min, max);
  const wildcard = arraysEqual(sorted, full);

  return Object.freeze({
    name,
    raw,
    min,
    max,
    values: Object.freeze(sorted),
    wildcard,
  });
}

function expandBase(
  name: CronFieldName,
  base: string,
  min: number,
  max: number,
  aliases: Readonly<Record<string, number>>,
  normalize: (value: number) => number,
): number[] {
  if (base === "*") {
    const rawRange = range(min, max);
    return uniqueSorted(rawRange.map(normalize));
  }

  const rangeParts = base.split("-");
  if (rangeParts.length === 1) {
    return [
      parseValue(name, rangeParts[0] as string, min, max, aliases, normalize),
    ];
  }
  if (rangeParts.length !== 2 || rangeParts[0] === "" || rangeParts[1] === "") {
    throw new CronParseError(
      `${name} field has an invalid range: ${JSON.stringify(base)}`,
    );
  }

  const [rangeStart, rangeEnd] = rangeParts as [string, string];
  const rawStart = parseRawValue(name, rangeStart, min, max, aliases);
  const rawEnd = parseRawValue(name, rangeEnd, min, max, aliases);
  if (rawStart > rawEnd) {
    throw new CronParseError(
      `${name} field range start cannot be greater than range end: ${JSON.stringify(base)}`,
    );
  }

  return uniqueSorted(range(rawStart, rawEnd).map(normalize));
}

function parseStep(
  name: CronFieldName,
  token: string,
  stepRaw: string,
): number {
  if (!/^\d+$/u.test(stepRaw)) {
    throw new CronParseError(
      `${name} field has an invalid step value: ${JSON.stringify(token)}`,
    );
  }
  const step = Number(stepRaw);
  if (step <= 0) {
    throw new CronParseError(
      `${name} field step must be greater than zero: ${JSON.stringify(token)}`,
    );
  }
  return step;
}

function parseValue(
  name: CronFieldName,
  raw: string,
  min: number,
  max: number,
  aliases: Readonly<Record<string, number>>,
  normalize: (value: number) => number,
): number {
  return normalize(parseRawValue(name, raw, min, max, aliases));
}

function parseRawValue(
  name: CronFieldName,
  raw: string,
  min: number,
  max: number,
  aliases: Readonly<Record<string, number>>,
): number {
  const upper = raw.toUpperCase();
  const aliased = aliases[upper];
  const value = aliased ?? (/^\d+$/u.test(raw) ? Number(raw) : Number.NaN);

  if (!Number.isInteger(value)) {
    throw new CronParseError(
      `${name} field has an invalid value: ${JSON.stringify(raw)}`,
    );
  }
  if (value < min || value > max) {
    throw new CronParseError(
      `${name} field value ${value} is outside allowed range ${min}-${max}`,
    );
  }

  return value;
}

function normalizeDayOfWeek(value: number): number {
  return value === 7 ? 0 : value;
}

function shiftLocalTimeToUtc(
  hour: number,
  minute: number,
  offsetMinutes: number,
): {
  readonly hour: number;
  readonly minute: number;
  readonly dayDelta: number;
} {
  const localTotal = hour * 60 + minute;
  const utcTotal = localTotal - offsetMinutes;
  const dayDelta = floorDiv(utcTotal, 1440);
  const normalized = mod(utcTotal, 1440);
  return {
    hour: Math.floor(normalized / 60),
    minute: normalized % 60,
    dayDelta,
  };
}

function convertDateSpec(
  cron: ParsedCron,
  dayDelta: number,
  strict: boolean,
): DateSpec[] {
  const original: DateSpec = {
    dom: cron.dayOfMonth.values,
    month: cron.month.values,
    dow: cron.dayOfWeek.values,
  };

  if (dayDelta === 0) {
    return [original];
  }

  const domWildcard = cron.dayOfMonth.wildcard;
  const monthWildcard = cron.month.wildcard;
  const dowWildcard = cron.dayOfWeek.wildcard;

  if (!domWildcard && !dowWildcard) {
    if (strict) {
      throw new CronConversionError(
        "Cannot exactly shift a cron expression with both day-of-month and day-of-week restricted when the time crosses a day boundary. Standard cron uses OR semantics for those fields.",
      );
    }
    return [
      {
        dom: cron.dayOfMonth.values,
        month: cron.month.values,
        dow: shiftDayOfWeekSet(cron.dayOfWeek.values, dayDelta),
      },
    ];
  }

  if (!dowWildcard) {
    if (!monthWildcard && strict) {
      throw new CronConversionError(
        "Cannot exactly shift a month-restricted day-of-week schedule across a day boundary with standard 5-field cron.",
      );
    }

    return [
      {
        dom: FULL_DOM,
        month: FULL_MONTHS,
        dow: shiftDayOfWeekSet(cron.dayOfWeek.values, dayDelta),
      },
    ];
  }

  // DOW is wildcard, so the schedule is representable as month/day-of-month pairs.
  return convertMonthDayPairs(
    cron.month.values,
    cron.dayOfMonth.values,
    dayDelta,
    strict,
  );
}

function shiftDayOfWeekSet(
  values: readonly number[],
  dayDelta: number,
): number[] {
  return uniqueSorted(values.map((value) => mod(value + dayDelta, 7)));
}

function convertMonthDayPairs(
  months: readonly number[],
  daysOfMonth: readonly number[],
  dayDelta: number,
  strict: boolean,
): DateSpec[] {
  const commonTargets = targetMonthDayPairsForYear(
    2021,
    months,
    daysOfMonth,
    dayDelta,
  );
  const leapTargets = targetMonthDayPairsForYear(
    2020,
    months,
    daysOfMonth,
    dayDelta,
  );
  const union = new Set([...commonTargets, ...leapTargets]);

  if (strict) {
    for (const pair of union) {
      const [month, dom] = parsePairKey(pair);
      const validInCommon = isValidDate(2021, month, dom);
      const inCommon = commonTargets.has(pair);
      const inLeap = leapTargets.has(pair);

      // A standard 5-field cron can naturally represent Feb 29 because it is
      // invalid in common years. Any other year-dependent membership would
      // require a year field or last-day-of-month syntax.
      if (validInCommon && inCommon !== inLeap) {
        throw new CronConversionError(
          `Cannot exactly represent shifted date ${month}/${dom} because it differs between common and leap years.`,
        );
      }
    }
  }

  return groupMonthDayPairs([...union]);
}

function targetMonthDayPairsForYear(
  year: number,
  months: readonly number[],
  daysOfMonth: readonly number[],
  dayDelta: number,
): Set<string> {
  const out = new Set<string>();

  for (const month of months) {
    for (const dom of daysOfMonth) {
      if (!isValidDate(year, month, dom)) {
        continue;
      }
      const date = new Date(Date.UTC(year, month - 1, dom));
      date.setUTCDate(date.getUTCDate() + dayDelta);
      const targetMonth = date.getUTCMonth() + 1;
      const targetDom = date.getUTCDate();
      out.add(pairKey(targetMonth, targetDom));
    }
  }

  return out;
}

function groupMonthDayPairs(pairs: readonly string[]): DateSpec[] {
  const daysByMonth = new Map<number, Set<number>>();
  for (const pair of pairs) {
    const [month, dom] = parsePairKey(pair);
    let days = daysByMonth.get(month);
    if (!days) {
      days = new Set<number>();
      daysByMonth.set(month, days);
    }
    days.add(dom);
  }

  const monthsByDomSet = new Map<string, { dom: number[]; months: number[] }>();
  for (const [month, days] of daysByMonth) {
    let dom = [...days].sort((a, b) => a - b);
    if (arraysEqual(dom, allPossibleValidDaysForMonth(month))) {
      dom = FULL_DOM;
    }
    const key = dom.join(",");
    let group = monthsByDomSet.get(key);
    if (!group) {
      group = { dom, months: [] };
      monthsByDomSet.set(key, group);
    }
    group.months.push(month);
  }

  return [...monthsByDomSet.values()]
    .map((group) => ({
      dom: Object.freeze(group.dom),
      month: Object.freeze(group.months.sort((a, b) => a - b)),
      dow: FULL_DOW,
    }))
    .sort(compareDateSpecs);
}

function compactTimePairs(
  pairs: ReadonlyMap<number, ReadonlySet<number>>,
): Array<{
  readonly hours: readonly number[];
  readonly minutes: readonly number[];
}> {
  const hoursByMinuteSet = new Map<
    string,
    { minutes: number[]; hours: number[] }
  >();

  for (const [hour, minutes] of pairs) {
    const sortedMinutes = [...minutes].sort((a, b) => a - b);
    const key = sortedMinutes.join(",");
    let group = hoursByMinuteSet.get(key);
    if (!group) {
      group = { minutes: sortedMinutes, hours: [] };
      hoursByMinuteSet.set(key, group);
    }
    group.hours.push(hour);
  }

  return [...hoursByMinuteSet.values()]
    .map((group) => ({
      minutes: Object.freeze(group.minutes),
      hours: Object.freeze(group.hours.sort((a, b) => a - b)),
    }))
    .sort(
      (a, b) =>
        (a.hours[0] ?? 0) - (b.hours[0] ?? 0) ||
        (a.minutes[0] ?? 0) - (b.minutes[0] ?? 0),
    );
}

function formatValues(
  values: readonly number[],
  full: readonly number[],
): string {
  const sorted = uniqueSorted(values);
  if (arraysEqual(sorted, full)) {
    return "*";
  }

  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  if (start === undefined || prev === undefined) {
    return "";
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i] as number;
    if (current === prev + 1) {
      prev = current;
      continue;
    }

    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = current;
    prev = current;
  }

  parts.push(start === prev ? String(start) : `${start}-${prev}`);

  return parts.join(",");
}

function compareCronStrings(a: string, b: string): number {
  const pa = parseCron(a);
  const pb = parseCron(b);
  return (
    (pa.hour.values[0] ?? 0) - (pb.hour.values[0] ?? 0) ||
    (pa.minute.values[0] ?? 0) - (pb.minute.values[0] ?? 0) ||
    compareNumberArrays(pa.month.values, pb.month.values) ||
    compareNumberArrays(pa.dayOfMonth.values, pb.dayOfMonth.values) ||
    compareNumberArrays(pa.dayOfWeek.values, pb.dayOfWeek.values) ||
    a.localeCompare(b)
  );
}

function compareDateSpecs(a: DateSpec, b: DateSpec): number {
  return (
    compareNumberArrays(a.month, b.month) ||
    compareNumberArrays(a.dom, b.dom) ||
    compareNumberArrays(a.dow, b.dow)
  );
}

function compareNumberArrays(
  a: readonly number[],
  b: readonly number[],
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return a.length - b.length;
}

function dateSpecKey(spec: DateSpec): string {
  return `${spec.dom.join(",")}|${spec.month.join(",")}|${spec.dow.join(",")}`;
}

function pairKey(month: number, dom: number): string {
  return `${month}/${dom}`;
}

function parsePairKey(pair: string): [month: number, dom: number] {
  const [month, dom] = pair.split("/").map(Number);
  if (month === undefined || dom === undefined) {
    throw new CronConversionError(`Invalid month/day pair: ${pair}`);
  }
  return [month, dom];
}

function isValidDate(year: number, month: number, dom: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, dom));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === dom
  );
}

function allPossibleValidDaysForMonth(month: number): number[] {
  if (month === 2) {
    return range(1, 29);
  }
  if ([4, 6, 9, 11].includes(month)) {
    return range(1, 30);
  }
  return range(1, 31);
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
