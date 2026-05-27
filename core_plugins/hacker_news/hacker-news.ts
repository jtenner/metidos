export type HackerNewsListKind = "top" | "new" | "ask";

export type HackerNewsItem = {
  by?: string;
  dead?: boolean;
  deleted?: boolean;
  descendants?: number;
  id?: number;
  kids?: number[];
  score?: number;
  text?: string;
  time?: number;
  title?: string;
  type?: string;
  url?: string;
};

export type HackerNewsStoryRow = {
  by: string;
  comments: number | null;
  host: string;
  hnUrl: string;
  id: number;
  posted: string;
  score: number | null;
  title: string;
  type: string;
  url: string;
};

export type HackerNewsTableInput = {
  endpoint: string;
  fetchedAt: Date;
  idsReturned: number;
  kind: HackerNewsListKind;
  rows: HackerNewsStoryRow[];
};

export const HACKER_NEWS_API_BASE = "https://hacker-news.firebaseio.com/v0";

export const HACKER_NEWS_LIST_ENDPOINTS: Record<HackerNewsListKind, string> = {
  ask: `${HACKER_NEWS_API_BASE}/askstories.json`,
  new: `${HACKER_NEWS_API_BASE}/newstories.json`,
  top: `${HACKER_NEWS_API_BASE}/topstories.json`,
};

const LIST_TITLES: Record<HackerNewsListKind, string> = {
  ask: "Hacker News Ask HN Stories",
  new: "Hacker News New Stories",
  top: "Hacker News Top Stories",
};

const MAX_CELL_LENGTH = 180;
const MAX_URL_LENGTH = 180;

export function itemUrl(id: number): string {
  return `${HACKER_NEWS_API_BASE}/item/${id}.json`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;|&#39;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&nbsp;/gu, " ");
}

export function escapeMarkdownCell(value: unknown): string {
  const text = decodeHtmlEntities(String(value ?? ""))
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > MAX_CELL_LENGTH
    ? `${text.slice(0, MAX_CELL_LENGTH - 1)}…`
    : text;
}

function escapeMarkdownLinkText(value: string): string {
  return escapeMarkdownCell(value).replace(/[\\[\]]/gu, "\\$&");
}

function safeMarkdownLink(label: string, url: string): string {
  if (!url) return "";
  const trimmed = url.trim().slice(0, MAX_URL_LENGTH);
  if (!/^https?:\/\//iu.test(trimmed)) return escapeMarkdownCell(trimmed);
  const escapedUrl = trimmed.replace(/\)/gu, "%29").replace(/\s/gu, "%20");
  return `[${escapeMarkdownLinkText(label)}](${escapedUrl})`;
}

function hostForUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./iu, "");
  } catch {
    return "";
  }
}

function formatPostedTime(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const millis = seconds * 1000;
  const iso = new Date(millis).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function idsFromResponse(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Hacker News list response was not an array of item IDs.");
  }
  return value.filter(
    (id): id is number =>
      typeof id === "number" && Number.isInteger(id) && id > 0,
  );
}

export function storyRowFromItem(
  item: HackerNewsItem,
): HackerNewsStoryRow | null {
  const id = numberOrNull(item.id);
  if (id === null || item.deleted || item.dead) return null;
  const title = stringValue(item.title).trim();
  if (!title) return null;
  const url = stringValue(item.url).trim();
  return {
    by: stringValue(item.by),
    comments: numberOrNull(item.descendants),
    hnUrl: `https://news.ycombinator.com/item?id=${id}`,
    host: url ? hostForUrl(url) : "news.ycombinator.com",
    id,
    posted: formatPostedTime(item.time),
    score: numberOrNull(item.score),
    title,
    type: stringValue(item.type) || "item",
    url,
  };
}

export function rowsFromItems(items: HackerNewsItem[]): HackerNewsStoryRow[] {
  return items
    .map(storyRowFromItem)
    .filter((row): row is HackerNewsStoryRow => row !== null);
}

export function renderStoryTable(input: HackerNewsTableInput): string {
  const lines = [
    `# ${LIST_TITLES[input.kind]}`,
    "",
    `Fetched: ${input.fetchedAt.toISOString()} · Endpoint: ${input.endpoint} · Items: ${input.rows.length}/${input.idsReturned}`,
    "",
  ];

  if (!input.rows.length) {
    lines.push("No live Hacker News stories were returned.");
    return lines.join("\n");
  }

  lines.push(
    "| # | Title | Site | By | Score | Comments | Posted | Type | Link | HN |",
    "|---:|---|---|---|---:|---:|---|---|---|---|",
  );
  input.rows.forEach((row, index) => {
    const sourceLink = row.url ? safeMarkdownLink("source", row.url) : "";
    const hnLink = safeMarkdownLink("comments", row.hnUrl);
    lines.push(
      `| ${index + 1} | ${escapeMarkdownCell(row.title)} | ${escapeMarkdownCell(
        row.host,
      )} | ${escapeMarkdownCell(row.by)} | ${row.score ?? ""} | ${
        row.comments ?? ""
      } | ${escapeMarkdownCell(row.posted)} | ${escapeMarkdownCell(
        row.type,
      )} | ${sourceLink} | ${hnLink} |`,
    );
  });
  return lines.join("\n");
}
