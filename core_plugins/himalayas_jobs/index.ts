import { definePlugin } from "@metidos/plugin-api";

type JsonRecord = Record<string, unknown>;

type SortOrder =
  | "relevant"
  | "recent"
  | "salaryAsc"
  | "salaryDesc"
  | "nameAToZ"
  | "nameZToA"
  | "jobs";

type SearchRemoteJobsProps = {
  query: string;
  country?: string | undefined;
  worldwide?: boolean | undefined;
  excludeWorldwide?: boolean | undefined;
  seniority?: string | undefined;
  employmentType?: string | undefined;
  company?: string | undefined;
  timezone?: string | undefined;
  sort?: SortOrder | undefined;
  page?: number | undefined;
};

const HIMALAYAS_SEARCH_URL = "https://himalayas.app/jobs/api/search";
const MAX_QUERY_LENGTH = 200;
const MAX_FILTER_LENGTH = 120;
const RESULT_DISPLAY_LIMIT = 20;
const SORT_VALUES = new Set<SortOrder>([
  "relevant",
  "recent",
  "salaryAsc",
  "salaryDesc",
  "nameAToZ",
  "nameZToA",
  "jobs",
]);

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmptyString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim().slice(0, maxLength);
}

function optionalString(
  input: JsonRecord,
  key: string,
  maxLength: number,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  return nonEmptyString(value, key, maxLength);
}

function optionalBoolean(input: JsonRecord, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}

function boundedInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  const integer = Math.trunc(value);
  if (integer < min || integer > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return integer;
}

function validateSearchRemoteJobsProps(input: unknown): SearchRemoteJobsProps {
  const props = record(input);
  const sort = optionalString(props, "sort", 40);
  if (sort && !SORT_VALUES.has(sort as SortOrder)) {
    throw new Error(
      "sort must be one of relevant, recent, salaryAsc, salaryDesc, nameAToZ, nameZToA, or jobs.",
    );
  }
  return {
    query: nonEmptyString(props.query ?? props.q, "query", MAX_QUERY_LENGTH),
    country: optionalString(props, "country", MAX_FILTER_LENGTH),
    worldwide: optionalBoolean(props, "worldwide"),
    excludeWorldwide: optionalBoolean(props, "excludeWorldwide"),
    seniority: optionalString(props, "seniority", MAX_FILTER_LENGTH),
    employmentType: optionalString(props, "employmentType", MAX_FILTER_LENGTH),
    company: optionalString(props, "company", MAX_FILTER_LENGTH),
    timezone: optionalString(props, "timezone", MAX_FILTER_LENGTH),
    sort: sort as SortOrder | undefined,
    page: boundedInteger(props.page, "page", 1, 1000),
  };
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function buildQueryString(params: Array<[string, string]>): string {
  return params
    .map(
      ([key, value]) =>
        `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`,
    )
    .join("&");
}

function buildSearchUrl(props: SearchRemoteJobsProps): string {
  const params: Array<[string, string]> = [["q", props.query]];
  if (props.country) params.push(["country", props.country]);
  if (props.worldwide !== undefined)
    params.push(["worldwide", String(props.worldwide)]);
  if (props.excludeWorldwide !== undefined) {
    params.push(["exclude_worldwide", String(props.excludeWorldwide)]);
  }
  if (props.seniority) params.push(["seniority", props.seniority]);
  if (props.employmentType)
    params.push(["employment_type", props.employmentType]);
  if (props.company) params.push(["company", props.company]);
  if (props.timezone) params.push(["timezone", props.timezone]);
  params.push(["sort", props.sort ?? "recent"]);
  if (props.page !== undefined) params.push(["page", String(props.page)]);
  return `${HIMALAYAS_SEARCH_URL}?${buildQueryString(params)}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function escapeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .slice(0, 700);
}

function formatDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value.slice(0, 30)
      : date.toISOString().slice(0, 10);
  }
  return "";
}

function formatSalary(job: JsonRecord): string {
  const min = numberValue(job.minSalary);
  const max = numberValue(job.maxSalary);
  const currency = stringValue(job.currency);
  if (min === null && max === null) return "";
  const formatter = (value: number) =>
    Math.round(value).toLocaleString("en-US");
  const prefix = currency ? `${currency} ` : "";
  if (min !== null && max !== null)
    return `${prefix}${formatter(min)}-${formatter(max)}`;
  if (min !== null) return `${prefix}${formatter(min)}+`;
  return `${prefix}up to ${formatter(max as number)}`;
}

function formatRestrictions(value: unknown): string {
  const values = arrayValue(value)
    .map((item) => {
      if (typeof item === "string") return item;
      const itemRecord = record(item);
      return (
        stringValue(itemRecord.alpha2) ||
        stringValue(itemRecord.name) ||
        stringValue(itemRecord.slug)
      );
    })
    .filter(Boolean);
  return values.length ? values.join(", ") : "Worldwide";
}

function formatList(value: unknown): string {
  return arrayValue(value)
    .map((item) => stringValue(item).trim())
    .filter(Boolean)
    .join(", ");
}

function stripHtml(value: unknown): string {
  return stringValue(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

async function responseJson(response: {
  text: () => Promise<string>;
}): Promise<unknown> {
  const text = await response.text();
  if (!text.trim())
    throw new Error("Himalayas returned an empty response body.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Himalayas returned a non-JSON response: ${text.slice(0, 200)}`,
    );
  }
}

function summarizeJobs(
  json: unknown,
  requested: SearchRemoteJobsProps,
): string {
  const root = record(json);
  const jobs = arrayValue(root.jobs).map(record);
  const seen = new Set<string>();
  const uniqueJobs = jobs.filter((job) => {
    const guid =
      stringValue(job.guid) ||
      `${stringValue(job.title)}:${stringValue(job.companyName)}`;
    if (seen.has(guid)) return false;
    seen.add(guid);
    return true;
  });
  const totalCount = numberValue(root.totalCount);
  const updatedAt = formatDate(root.updatedAt);
  const lines = [
    `# Himalayas remote jobs for ${requested.query}`,
    "",
    `[Data sourced from Himalayas](https://himalayas.app/). Application links are the canonical Himalayas apply URLs. Do not submit these jobs to third-party job boards.`,
  ];
  const meta: string[] = [];
  if (totalCount !== null) meta.push(`Total matches: ${totalCount}`);
  if (updatedAt) meta.push(`Data refreshed: ${updatedAt}`);
  meta.push(`Sort: ${requested.sort ?? "recent"}`);
  if (requested.page) meta.push(`Page: ${requested.page}`);
  if (meta.length) lines.push("", meta.join(" · "));

  if (!uniqueJobs.length) {
    lines.push("", "No jobs returned.");
    return lines.join("\n");
  }

  lines.push(
    "",
    "| # | Title | Company | Type | Seniority | Location | Timezones | Salary | Posted | Apply | GUID |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  uniqueJobs.slice(0, RESULT_DISPLAY_LIMIT).forEach((job, index) => {
    const title = stringValue(job.applicationLink)
      ? `[${escapeCell(job.title)}](${stringValue(job.applicationLink)})`
      : escapeCell(job.title);
    lines.push(
      `| ${index + 1} | ${title} | ${escapeCell(job.companyName)} | ${escapeCell(job.employmentType)} | ${escapeCell(formatList(job.seniority) || stringValue(job.seniority))} | ${escapeCell(formatRestrictions(job.locationRestrictions))} | ${escapeCell(formatList(job.timezoneRestrictions) || "Any")} | ${escapeCell(formatSalary(job))} | ${escapeCell(formatDate(job.pubDate))} | ${stringValue(job.applicationLink) ? `[Apply](${stringValue(job.applicationLink)})` : ""} | ${escapeCell(job.guid)} |`,
    );
  });

  const excerpts = uniqueJobs
    .slice(0, Math.min(uniqueJobs.length, 5))
    .map((job, index) => {
      const excerpt = stringValue(job.excerpt) || stripHtml(job.description);
      return excerpt
        ? `${index + 1}. **${escapeCell(job.title)}** — ${escapeCell(excerpt)}`
        : "";
    })
    .filter(Boolean);
  if (excerpts.length) lines.push("", "## Short summaries", ...excerpts);
  if (uniqueJobs.length > RESULT_DISPLAY_LIMIT) {
    lines.push(
      "",
      `_Showing ${RESULT_DISPLAY_LIMIT} of ${uniqueJobs.length} jobs returned on this page._`,
    );
  }
  return lines.join("\n");
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "search_remote_jobs",
    name: "Search remote jobs",
    description:
      "Search remote jobs through the Himalayas API and return a markdown table. Required: query (q accepted as alias). Optional filters: country, worldwide, excludeWorldwide, seniority, employmentType, company, timezone, sort, page. Defaults to sort=recent. Includes Himalayas attribution and preserves applicationLink as the canonical apply URL.",
    timeoutMs: 30_000,
    validateProps: validateSearchRemoteJobsProps,
    async action(_context, props) {
      const url = buildSearchUrl(props);
      const response = await metidos.fetch(url, {
        headers: { Accept: "application/json" },
        method: "GET",
      });
      if (response.status === 429) {
        throw new Error(
          "Himalayas API rate limit exceeded. Retry later; the data refreshes every 24 hours, so avoid aggressive polling.",
        );
      }
      if (!response.ok) {
        throw new Error(`Himalayas jobs request failed (${response.status}).`);
      }
      const json = await responseJson(response);
      await metidos.log(
        "info",
        `Himalayas job search completed for ${props.query}`,
      );
      return { markdown: summarizeJobs(json, props), type: "markdown" };
    },
  });
});
