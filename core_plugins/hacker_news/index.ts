import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";
import {
  HACKER_NEWS_LIST_ENDPOINTS,
  idsFromResponse,
  itemUrl,
  renderStoryTable,
  rowsFromItems,
  type HackerNewsItem,
  type HackerNewsListKind,
} from "./hacker-news";

type CacheEntry = {
  expiresAt: number;
  markdown: string;
};

const CACHE_TTL_MS = 60 * 1000;
const FETCH_BATCH_SIZE = 25;
const cache = new Map<HackerNewsListKind, CacheEntry>();

async function fetchJson(
  metidosFetch: MetidosPluginApi["fetch"],
  url: string,
): Promise<unknown> {
  const response = await metidosFetch(url, {
    headers: { Accept: "application/json" },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Hacker News request failed (${response.status}) for ${url}`,
    );
  }
  return response.json();
}

async function fetchItems(
  metidosFetch: MetidosPluginApi["fetch"],
  ids: number[],
): Promise<HackerNewsItem[]> {
  const items: HackerNewsItem[] = [];
  for (let index = 0; index < ids.length; index += FETCH_BATCH_SIZE) {
    const batch = ids.slice(index, index + FETCH_BATCH_SIZE);
    const batchItems = await Promise.all(
      batch.map(async (id) => {
        const value = await fetchJson(metidosFetch, itemUrl(id));
        return value && typeof value === "object"
          ? (value as HackerNewsItem)
          : null;
      }),
    );
    for (const item of batchItems) {
      if (item) items.push(item);
    }
  }
  return items;
}

async function hackerNewsTable(
  metidosFetch: MetidosPluginApi["fetch"],
  kind: HackerNewsListKind,
): Promise<string> {
  const cached = cache.get(kind);
  if (cached && cached.expiresAt > Date.now()) return cached.markdown;

  const endpoint = HACKER_NEWS_LIST_ENDPOINTS[kind];
  const ids = idsFromResponse(await fetchJson(metidosFetch, endpoint));
  const items = await fetchItems(metidosFetch, ids);
  const markdown = renderStoryTable({
    endpoint,
    fetchedAt: new Date(),
    idsReturned: ids.length,
    kind,
    rows: rowsFromItems(items),
  });
  cache.set(kind, { expiresAt: Date.now() + CACHE_TTL_MS, markdown });
  return markdown;
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "top_stories",
    name: "Hacker News top stories",
    description:
      "Fetch every current Hacker News top story ID, load item metadata, and return a markdown table.",
    timeoutMs: 60_000,
    validateProps() {
      return {};
    },
    async action() {
      return {
        markdown: await hackerNewsTable(metidos.fetch, "top"),
        type: "markdown",
      };
    },
  });

  metidos.addAgentTool({
    tool: "new_stores",
    name: "Hacker News new stories",
    description:
      "Fetch every current Hacker News new story ID, load item metadata, and return a markdown table. The tool id keeps the requested new_stores spelling.",
    timeoutMs: 60_000,
    validateProps() {
      return {};
    },
    async action() {
      return {
        markdown: await hackerNewsTable(metidos.fetch, "new"),
        type: "markdown",
      };
    },
  });

  metidos.addAgentTool({
    tool: "ask_stories",
    name: "Hacker News Ask HN stories",
    description:
      "Fetch every current Hacker News Ask HN story ID, load item metadata, and return a markdown table.",
    timeoutMs: 60_000,
    validateProps() {
      return {};
    },
    async action() {
      return {
        markdown: await hackerNewsTable(metidos.fetch, "ask"),
        type: "markdown",
      };
    },
  });
});
