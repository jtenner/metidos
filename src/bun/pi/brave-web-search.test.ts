import { afterEach, describe, expect, it } from "bun:test";

import {
  clampBraveSearchResultCount,
  executeBraveSearch,
  executeWebFetch,
  formatBraveSearchResults,
  normalizeBraveSearchResults,
  summarizeFetchedWebContent,
} from "./brave-web-search";

const originalFetch = globalThis.fetch;
const originalBraveSearchApiKey = process.env.BRAVE_SEARCH_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBraveSearchApiKey === undefined) {
    delete process.env.BRAVE_SEARCH_API_KEY;
  } else {
    process.env.BRAVE_SEARCH_API_KEY = originalBraveSearchApiKey;
  }
});

function installFetchMock(
  handler: (url: string) => Response | Promise<Response>,
): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return urls;
}

function createSafeFetchMock(
  handler: (url: string) => Response | Promise<Response>,
): {
  fetch: (url: URL) => Promise<Response>;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    fetch: async (url) => {
      urls.push(url.toString());
      return handler(url.toString());
    },
    urls,
  };
}

describe("clampBraveSearchResultCount", () => {
  it("defaults and clamps Brave result counts", () => {
    expect(clampBraveSearchResultCount(undefined)).toBe(5);
    expect(clampBraveSearchResultCount(0)).toBe(1);
    expect(clampBraveSearchResultCount(3.9)).toBe(3);
    expect(clampBraveSearchResultCount(99)).toBe(20);
  });
});

describe("normalizeBraveSearchResults", () => {
  it("extracts Brave web results and preserves extra snippets", () => {
    const results = normalizeBraveSearchResults({
      web: {
        results: [
          {
            description: "Primary description",
            extra_snippets: ["Extra snippet", 42, "Second snippet"],
            title: "Example Result",
            url: "https://example.com/article",
          },
          {
            description: "Ignored because the URL is missing",
            title: "Broken Result",
          },
        ],
      },
    });

    expect(results).toEqual([
      {
        description: "Primary description",
        extraSnippets: ["Extra snippet", "Second snippet"],
        title: "Example Result",
        url: "https://example.com/article",
      },
    ]);

    const formatted = formatBraveSearchResults(results);
    expect(formatted).toContain("1. Example Result");
    expect(formatted).toContain("URL: https://example.com/article");
    expect(formatted).toContain("Extra snippet");
  });
});

describe("summarizeFetchedWebContent", () => {
  it("converts fetched HTML into readable content and resolves links", () => {
    const summary = summarizeFetchedWebContent({
      contentType: "text/html; charset=utf-8",
      rawText: `
        <html>
          <head><title>Example &amp; Title</title></head>
          <body>
            <main>
              <h1>Hello</h1>
              <p>Readable <strong>content</strong>.</p>
              <a href="/docs">Docs</a>
              <a href="https://example.com/about">About</a>
            </main>
          </body>
        </html>
      `,
      url: "https://example.com/start",
    });

    expect(summary.title).toBe("Example & Title");
    expect(summary.content).toContain("Hello");
    expect(summary.content).toContain("Readable");
    expect(summary.links).toEqual([
      "https://example.com/docs",
      "https://example.com/about",
    ]);
    expect(summary.truncated).toBeFalse();
  });

  it("pretty-prints fetched JSON content", () => {
    const summary = summarizeFetchedWebContent({
      contentType: "application/json",
      rawText: '{"ok":true,"value":1}',
      url: "https://example.com/data.json",
    });

    expect(summary.title).toBe("https://example.com/data.json");
    expect(summary.content).toContain('"ok": true');
    expect(summary.links).toEqual([]);
  });
});

describe("executeBraveSearch", () => {
  it("rejects oversized Brave Search JSON responses", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";
    const urls = installFetchMock(
      () =>
        new Response("{}", {
          headers: {
            "content-length": String(5 * 1024 * 1024 + 1),
            "content-type": "application/json",
          },
        }),
    );

    await expect(
      executeBraveSearch({
        maxResults: 5,
        query: "metidos",
        signal: undefined,
      }),
    ).rejects.toThrow("Brave Search API response is too large.");
    expect(urls[0]).toStartWith(
      "https://api.search.brave.com/res/v1/web/search?",
    );
  });
});

describe("executeWebFetch", () => {
  it("rejects oversized fetched page responses", async () => {
    const safeFetch = createSafeFetchMock(
      () =>
        new Response("{}", {
          headers: {
            "content-length": String(5 * 1024 * 1024 + 1),
            "content-type": "text/plain",
          },
        }),
    );

    await expect(
      executeWebFetch({
        fetch: safeFetch.fetch,
        signal: undefined,
        url: "https://203.0.113.30/page",
      }),
    ).rejects.toThrow("Web fetch response is too large.");
    expect(safeFetch.urls).toEqual(["https://203.0.113.30/page"]);
  });
});
