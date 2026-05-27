/**
 * @file src/bun/pi/brave-web-search.ts
 * @description Brave-backed web-search tools for non-native Pi runtimes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  readLimitedJsonResponse,
  readLimitedTextResponse,
} from "../limited-json-response";
import {
  assertSafeOutboundHttpUrl,
  createSafeOutboundHttpFetch,
  isHttpRedirectStatus,
  resolveSafeRedirectUrl,
  type SafeOutboundFetch,
} from "../outbound-url-security";
import { convertHtmlToMarkdown } from "../html-to-markdown";

const BRAVE_SEARCH_API_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_BRAVE_SEARCH_RESULT_COUNT = 5;
const MAX_BRAVE_SEARCH_RESULT_COUNT = 20;
const DEFAULT_WEB_FETCH_MAX_CHARS = 40_000;
const DEFAULT_WEB_FETCH_LINK_LIMIT = 10;
const NOTE_TRUNCATED = "[truncated]";
const MAX_WEB_FETCH_REDIRECTS = 5;
const MAX_BRAVE_SEARCH_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_WEB_FETCH_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_OUTBOUND_ERROR_RESPONSE_BYTES = 16 * 1024;

type BraveSearchApiResponse = {
  web?: {
    results?: unknown;
  };
};

export type BraveSearchResultSummary = {
  description: string;
  extraSnippets: string[];
  title: string;
  url: string;
};

export type FetchedWebPageSummary = {
  content: string;
  contentType: string;
  links: string[];
  title: string;
  truncated: boolean;
  url: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/giu,
    (match, entity: string) => {
      switch (entity.toLowerCase()) {
        case "amp":
          return "&";
        case "apos":
          return "'";
        case "gt":
          return ">";
        case "lt":
          return "<";
        case "nbsp":
          return " ";
        case "quot":
          return '"';
        default:
          break;
      }

      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const codePoint = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      if (entity.startsWith("#")) {
        const codePoint = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return match;
    },
  );
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function stripHtmlTags(html: string): string {
  return collapseWhitespace(html.replace(/<[^>]+>/gu, " "));
}

function truncateText(
  text: string,
  maxChars: number,
): {
  text: string;
  truncated: boolean;
} {
  const normalized = text.trim();
  if (normalized.length <= maxChars) {
    return {
      text: normalized,
      truncated: false,
    };
  }
  return {
    text: `${normalized.slice(0, maxChars).trimEnd()}\n\n${NOTE_TRUNCATED}`,
    truncated: true,
  };
}

function readBraveSearchApiKey(): string {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error(
      "BRAVE_SEARCH_API_KEY is required to use fallback web_search.",
    );
  }
  return apiKey;
}

export function clampBraveSearchResultCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BRAVE_SEARCH_RESULT_COUNT;
  }
  return Math.min(
    MAX_BRAVE_SEARCH_RESULT_COUNT,
    Math.max(1, Math.trunc(value)),
  );
}

export function normalizeBraveSearchResults(
  payload: unknown,
): BraveSearchResultSummary[] {
  const results = (payload as BraveSearchApiResponse | null)?.web?.results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map((result) => {
      const candidate = result as Record<string, unknown>;
      const url = normalizeString(candidate.url);
      if (!url) {
        return null;
      }
      const extraSnippets = Array.isArray(candidate.extra_snippets)
        ? candidate.extra_snippets
            .map((snippet) => normalizeString(snippet))
            .filter(Boolean)
        : [];
      return {
        description: normalizeString(candidate.description),
        extraSnippets,
        title: normalizeString(candidate.title) || url,
        url,
      } satisfies BraveSearchResultSummary;
    })
    .filter((result): result is BraveSearchResultSummary => result !== null);
}

export function formatBraveSearchResults(
  results: readonly BraveSearchResultSummary[],
): string {
  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map((result, index) => {
      const snippets = [result.description, ...result.extraSnippets].filter(
        Boolean,
      );
      return [
        `${index + 1}. ${result.title}`,
        `   URL: ${result.url}`,
        ...snippets.map((snippet) => `   ${snippet}`),
      ].join("\n");
    })
    .join("\n\n");
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  if (!match) {
    return "";
  }
  return collapseWhitespace(decodeHtmlEntities(stripHtmlTags(match[1] ?? "")));
}

function extractHtmlLinks(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const hrefPattern = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/giu;

  for (const match of html.matchAll(hrefPattern)) {
    const rawHref = normalizeString(match[1] ?? match[2] ?? match[3] ?? "");
    if (!rawHref) {
      continue;
    }

    let resolvedHref = rawHref;
    try {
      resolvedHref = new URL(rawHref, pageUrl).toString();
    } catch {
      continue;
    }

    const protocol = new URL(resolvedHref).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      continue;
    }
    if (seen.has(resolvedHref)) {
      continue;
    }

    seen.add(resolvedHref);
    links.push(resolvedHref);
  }

  return links;
}

export function summarizeFetchedWebContent(input: {
  contentType: string | null | undefined;
  rawText: string;
  url: string;
}): FetchedWebPageSummary {
  const contentType = normalizeString(input.contentType).toLowerCase();
  const rawText = input.rawText.trim();

  if (contentType.includes("application/json")) {
    let normalizedJson = rawText;
    try {
      normalizedJson = JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      normalizedJson = rawText;
    }
    const truncated = truncateText(normalizedJson, DEFAULT_WEB_FETCH_MAX_CHARS);
    return {
      content: truncated.text,
      contentType,
      links: [],
      title: input.url,
      truncated: truncated.truncated,
      url: input.url,
    };
  }

  if (
    contentType.includes("html") ||
    contentType.includes("xml") ||
    contentType === ""
  ) {
    const title = extractHtmlTitle(rawText) || input.url;
    const markdown = convertHtmlToMarkdown(rawText);
    const fallbackText = stripHtmlTags(decodeHtmlEntities(rawText));
    const readableContent = markdown || fallbackText;
    const truncated = truncateText(
      readableContent,
      DEFAULT_WEB_FETCH_MAX_CHARS,
    );
    return {
      content: truncated.text,
      contentType,
      links: extractHtmlLinks(rawText, input.url).slice(
        0,
        DEFAULT_WEB_FETCH_LINK_LIMIT,
      ),
      title,
      truncated: truncated.truncated,
      url: input.url,
    };
  }

  const truncated = truncateText(rawText, DEFAULT_WEB_FETCH_MAX_CHARS);
  return {
    content: truncated.text,
    contentType,
    links: [],
    title: input.url,
    truncated: truncated.truncated,
    url: input.url,
  };
}

export async function executeBraveSearch(input: {
  maxResults: number;
  query: string;
  signal: AbortSignal | undefined;
}): Promise<BraveSearchResultSummary[]> {
  const apiKey = readBraveSearchApiKey();
  const url = new URL(BRAVE_SEARCH_API_URL);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.maxResults));
  url.searchParams.set("extra_snippets", "true");
  url.searchParams.set("text_decorations", "false");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: input.signal ?? null,
  });

  if (!response.ok) {
    const errorText = await readLimitedTextResponse(response, {
      label: "Brave Search API error response",
      maxBytes: MAX_OUTBOUND_ERROR_RESPONSE_BYTES,
    }).catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Brave Search API rejected the request. Check BRAVE_SEARCH_API_KEY.",
      );
    }
    throw new Error(
      `Brave Search API error (status ${response.status}): ${errorText || response.statusText}`,
    );
  }

  const payload = (await readLimitedJsonResponse(response, {
    label: "Brave Search API response",
    maxBytes: MAX_BRAVE_SEARCH_RESPONSE_BYTES,
  })) as BraveSearchApiResponse;
  return normalizeBraveSearchResults(payload);
}

export async function executeWebFetch(input: {
  fetch?: SafeOutboundFetch;
  signal: AbortSignal | undefined;
  url: string;
}): Promise<FetchedWebPageSummary> {
  let pageUrl = await assertSafeOutboundHttpUrl(input.url, {
    label: "Web fetch URL",
  });
  const safeFetch =
    input.fetch ?? createSafeOutboundHttpFetch({ label: "Web fetch URL" });
  let response: Response | null = null;

  for (
    let redirectCount = 0;
    redirectCount <= MAX_WEB_FETCH_REDIRECTS;
    redirectCount += 1
  ) {
    response = await safeFetch(pageUrl, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
      signal: input.signal ?? null,
    });

    if (!isHttpRedirectStatus(response.status)) {
      break;
    }
    if (redirectCount === MAX_WEB_FETCH_REDIRECTS) {
      throw new Error("Web fetch URL redirected too many times.");
    }
    pageUrl = await resolveSafeRedirectUrl(
      pageUrl,
      response.headers.get("location"),
      {
        label: "Web fetch URL",
      },
    );
  }

  if (!response) {
    throw new Error("Web fetch failed.");
  }
  if (!response.ok) {
    const errorText = await readLimitedTextResponse(response, {
      label: "Web fetch error response",
      maxBytes: MAX_OUTBOUND_ERROR_RESPONSE_BYTES,
    }).catch(() => "");
    throw new Error(
      `Web fetch error (status ${response.status}): ${errorText || response.statusText}`,
    );
  }

  return summarizeFetchedWebContent({
    contentType: response.headers.get("content-type"),
    rawText: await readLimitedTextResponse(response, {
      label: "Web fetch response",
      maxBytes: MAX_WEB_FETCH_RESPONSE_BYTES,
    }),
    url: response.url || pageUrl.toString(),
  });
}

export default function registerBravePiWebSearchTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. For providers without native web search, this tool uses the Brave Search API and requires BRAVE_SEARCH_API_KEY.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query to execute" }),
      max_results: Type.Optional(
        Type.Number({
          default: DEFAULT_BRAVE_SEARCH_RESULT_COUNT,
          description:
            "Maximum number of search results to return (default: 5, max: 20).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const query = normalizeString(params.query);
      if (!query) {
        throw new Error("query is required for web_search.");
      }
      const results = await executeBraveSearch({
        maxResults: clampBraveSearchResultCount(params.max_results),
        query,
        signal,
      });
      return {
        content: [
          {
            text: formatBraveSearchResults(results),
            type: "text",
          },
        ],
        details: {
          results,
        },
      };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract readable content from a specific URL through a direct HTTP request.",
    parameters: Type.Object({
      url: Type.String({
        description: "URL to fetch and extract content from",
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const summary = await executeWebFetch({
        signal,
        url: params.url,
      });
      const lines = [
        `URL: ${summary.url}`,
        `Content-Type: ${summary.contentType || "unknown"}`,
        `Title: ${summary.title}`,
        "",
        "Content:",
        summary.content || "No readable content extracted.",
      ];
      if (summary.links.length > 0) {
        lines.push(
          "",
          `Links found: ${summary.links.length}`,
          ...summary.links.map((link) => `  - ${link}`),
        );
      }
      if (summary.truncated) {
        lines.push("", "Note: fetched content was truncated.");
      }
      return {
        content: [
          {
            text: lines.join("\n"),
            type: "text",
          },
        ],
        details: summary,
      };
    },
  });
}
