import {
  definePlugin,
  type MetidosPluginApi,
  type MetidosXmlElement,
} from "@metidos/plugin-api";

type QueryOptions = {
  endDate?: string | undefined;
  q?: string | undefined;
  startDate?: string | undefined;
};

type FeedSource = {
  title?: string | undefined;
  url: string;
};

type FeedItem = {
  content: string;
  feedTitle?: string | undefined;
  feedUrl: string;
  guid?: string | undefined;
  id: string;
  link?: string | undefined;
  publishedAt?: string | undefined;
  summary?: string | undefined;
  title: string;
};

type CatalogItem = Omit<FeedItem, "content"> & {
  hash: string;
  indexedAt: string;
};

type Catalog = {
  items: CatalogItem[];
  updatedAt?: string | undefined;
  version: 1;
};

type RefreshResult = {
  changed: number;
  failedUrls: string[];
  indexed: number;
  skipped: boolean;
  sourceUrls: number;
};

const CATALOG_VERSION = 1;
const DEFAULT_SOURCE_LIMIT = 100;
const ITEM_LIMIT_PER_FEED = 100;
const MAX_CATALOG_ITEMS = 10_000;
const MAX_CHANGED_PER_RUN = 500;
const MAX_QUERY_ROWS = 50;
const SEMANTIC_CANDIDATES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireCallbackContext(context: unknown): void {
  if (!isRecord(context) || typeof context.contextKind !== "string") {
    throw new Error("rss_query requires a Metidos callback context.");
  }
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncate(value: string | undefined, max: number): string | undefined {
  const trimmed = compactWhitespace(value ?? "");
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function looksLikeHttpUrl(value: string): boolean {
  return (
    /^https:\/\/[^\s]+$/iu.test(value) && !/^https:\/\/[^/?#]*@/iu.test(value)
  );
}

function settingUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const url = entry.trim();
    if (!looksLikeHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= DEFAULT_SOURCE_LIMIT) break;
  }
  return urls;
}

function parseDateBound(
  value: string | undefined,
  field: string,
  endOfDay: boolean,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(trimmed);
  const candidate = dateOnly
    ? `${trimmed}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : trimmed;
  const millis = Date.parse(candidate);
  if (!Number.isFinite(millis)) {
    throw new Error(`${field} must be an ISO date or date-time string.`);
  }
  return millis;
}

function normalizeDate(value: string | undefined): string | undefined {
  const raw = truncate(value, 120);
  if (!raw) return undefined;
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) return undefined;
  return new Date(millis).toISOString();
}

function itemMillis(item: {
  publishedAt?: string | undefined;
}): number | undefined {
  if (!item.publishedAt) return undefined;
  const millis = Date.parse(item.publishedAt);
  return Number.isFinite(millis) ? millis : undefined;
}

function withinDateBounds(
  item: { publishedAt?: string | undefined },
  start?: number,
  end?: number,
): boolean {
  if (start === undefined && end === undefined) return true;
  const millis = itemMillis(item);
  if (millis === undefined) return false;
  if (start !== undefined && millis < start) return false;
  if (end !== undefined && millis > end) return false;
  return true;
}

function validateQueryOptions(input: unknown): QueryOptions {
  if (!isRecord(input)) {
    throw new Error("rss_query options must be an object.");
  }
  const props: QueryOptions = {};
  if (typeof input.startDate === "string" && input.startDate.trim()) {
    props.startDate = input.startDate.trim().slice(0, 80);
    parseDateBound(props.startDate, "startDate", false);
  }
  if (typeof input.endDate === "string" && input.endDate.trim()) {
    props.endDate = input.endDate.trim().slice(0, 80);
    parseDateBound(props.endDate, "endDate", true);
  }
  if (typeof input.q === "string" && input.q.trim()) {
    props.q = input.q.trim().slice(0, 500);
  }
  if (!props.startDate && !props.endDate && !props.q) {
    throw new Error("At least one of startDate, endDate, or q must be set.");
  }
  const start = parseDateBound(props.startDate, "startDate", false);
  const end = parseDateBound(props.endDate, "endDate", true);
  if (start !== undefined && end !== undefined && start > end) {
    throw new Error("startDate must be earlier than or equal to endDate.");
  }
  return props;
}

function hashString(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

function localRssDir(): string {
  return "~/rss/local";
}

function catalogPath(): string {
  return `${localRssDir()}/catalog.json`;
}

function lancePath(): string {
  return `${localRssDir()}/items`;
}

async function safeLog(
  metidos: MetidosPluginApi,
  level: "debug" | "error" | "info" | "warn",
  message: string,
): Promise<void> {
  try {
    await metidos.log(level, message.slice(0, 2000));
  } catch {
    // Logging is diagnostic only.
  }
}

function textContent(element: MetidosXmlElement | undefined): string {
  if (!element) return "";
  const parts = [element.text];
  for (const child of element.children) {
    parts.push(textContent(child));
  }
  return compactWhitespace(parts.join(" "));
}

function child(
  element: MetidosXmlElement | undefined,
  name: string,
): MetidosXmlElement | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

function children(
  element: MetidosXmlElement | undefined,
  name: string,
): MetidosXmlElement[] {
  return element?.children.filter((candidate) => candidate.name === name) ?? [];
}

function descendantItems(element: MetidosXmlElement): MetidosXmlElement[] {
  const found: MetidosXmlElement[] = [];
  for (const candidate of element.children) {
    if (candidate.name === "item") found.push(candidate);
    found.push(...descendantItems(candidate));
  }
  return found;
}

function resolveUrl(
  baseUrl: string,
  rawHref: string | undefined,
): string | undefined {
  const href = truncate(rawHref, 2000);
  if (!href) return undefined;
  if (/^https:\/\//iu.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) return undefined;
  if (href.startsWith("//")) return `https:${href}`;
  const base = /^(https:\/\/[^/]+)(\/.*)?$/iu.exec(baseUrl);
  if (!base) return undefined;
  if (href.startsWith("/")) return `${base[1]}${href}`;
  const basePath = base[2] ?? "/";
  const dir = basePath.endsWith("/")
    ? basePath
    : basePath.replace(/\/[^/]*$/u, "/");
  return `${base[1]}${dir}${href}`;
}

function opmlSources(root: MetidosXmlElement, opmlUrl: string): FeedSource[] {
  const sources: FeedSource[] = [];
  const visit = (element: MetidosXmlElement) => {
    if (element.name === "outline") {
      const url = resolveUrl(
        opmlUrl,
        element.attributes.xmlurl ?? element.attributes.url,
      );
      if (url && looksLikeHttpUrl(url)) {
        sources.push({
          title: truncate(
            element.attributes.title ?? element.attributes.text,
            200,
          ),
          url,
        });
      }
    }
    for (const nested of element.children) visit(nested);
  };
  visit(root);
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function rssItems(root: MetidosXmlElement, feedUrl: string): FeedItem[] {
  const feedTitle =
    root.name === "feed"
      ? truncate(textContent(child(root, "title")), 200)
      : truncate(textContent(child(child(root, "channel"), "title")), 200);
  const rawItems =
    root.name === "feed"
      ? children(root, "entry")
      : root.name === "rss"
        ? children(child(root, "channel"), "item")
        : descendantItems(root);
  const items: FeedItem[] = [];
  for (const entry of rawItems.slice(0, ITEM_LIMIT_PER_FEED)) {
    const atomLink =
      entry.name === "entry"
        ? children(entry, "link").find((link) => link.attributes.href)
            ?.attributes.href
        : undefined;
    const guid = truncate(
      textContent(child(entry, "guid")) || textContent(child(entry, "id")),
      500,
    );
    const link = resolveUrl(
      feedUrl,
      truncate(textContent(child(entry, "link")) || atomLink, 2000),
    );
    const title =
      truncate(textContent(child(entry, "title")), 300) ?? "Untitled feed item";
    const summary = truncate(
      textContent(child(entry, "description")) ||
        textContent(child(entry, "summary")) ||
        textContent(child(entry, "content")) ||
        textContent(child(entry, "encoded")),
      1200,
    );
    const publishedAt = normalizeDate(
      textContent(child(entry, "pubdate")) ||
        textContent(child(entry, "published")) ||
        textContent(child(entry, "updated")) ||
        textContent(child(entry, "dc:date")),
    );
    const identity = guid ?? link ?? `${title}\n${publishedAt ?? ""}`;
    const id = `rss_${hashString(`${feedUrl}\n${identity}`)}`;
    const content = [title, summary, feedTitle]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 6000);
    items.push({
      content,
      feedTitle,
      feedUrl,
      guid,
      id,
      link,
      publishedAt,
      summary,
      title,
    });
  }
  return items;
}

async function fetchXml(
  metidos: MetidosPluginApi,
  url: string,
): Promise<MetidosXmlElement> {
  const response = await metidos.fetch(url, {
    headers: {
      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}.`);
  }
  return metidos.xml.parse(await response.text(), {
    loose: true,
    lowercaseNames: true,
    maxBytes: 10 * 1024 * 1024,
    maxDepth: 128,
    maxNodes: 50_000,
    maxTextChars: 1_500_000,
    trimText: true,
  });
}

async function readCatalog(metidos: MetidosPluginApi): Promise<Catalog> {
  try {
    if (!(await metidos.fs.exists(catalogPath()))) {
      return { items: [], version: CATALOG_VERSION };
    }
    const parsed = JSON.parse(
      await metidos.fs.readText(catalogPath()),
    ) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
      return { items: [], version: CATALOG_VERSION };
    }
    const items = parsed.items.filter(
      (item): item is CatalogItem =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.hash === "string",
    );
    return {
      items,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      version: CATALOG_VERSION,
    };
  } catch {
    return { items: [], version: CATALOG_VERSION };
  }
}

async function writeCatalog(
  metidos: MetidosPluginApi,
  catalog: Catalog,
): Promise<void> {
  await metidos.fs.mkdir(localRssDir(), { recursive: true });
  const sorted = [...catalog.items]
    .sort((a, b) => (itemMillis(b) ?? 0) - (itemMillis(a) ?? 0))
    .slice(0, MAX_CATALOG_ITEMS);
  await metidos.fs.writeText(
    catalogPath(),
    JSON.stringify(
      {
        items: sorted,
        updatedAt: new Date().toISOString(),
        version: CATALOG_VERSION,
      },
      null,
      2,
    ),
  );
}

async function discoverFeedSources(
  metidos: MetidosPluginApi,
  urls: string[],
  failedUrls: string[],
): Promise<FeedSource[]> {
  const sources: FeedSource[] = [];
  for (const url of urls) {
    try {
      const root = await fetchXml(metidos, url);
      if (root.name === "opml") {
        sources.push(...opmlSources(root, url));
      } else {
        sources.push({
          title: truncate(
            textContent(child(child(root, "channel"), "title")) ||
              textContent(child(root, "title")),
            200,
          ),
          url,
        });
      }
    } catch (error) {
      const urlHash = hashString(url);
      failedUrls.push(urlHash);
      await safeLog(
        metidos,
        "warn",
        `RSS Feed Indexer could not discover URL ${urlHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (sources.length >= DEFAULT_SOURCE_LIMIT) break;
  }
  const seen = new Set<string>();
  return sources
    .filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .slice(0, DEFAULT_SOURCE_LIMIT);
}

async function refreshLocalFeeds(
  metidos: MetidosPluginApi,
  urls: string[],
): Promise<RefreshResult> {
  if (urls.length === 0) {
    return {
      changed: 0,
      failedUrls: [],
      indexed: 0,
      skipped: true,
      sourceUrls: 0,
    };
  }
  const failedUrls: string[] = [];
  const sources = await discoverFeedSources(metidos, urls, failedUrls);
  const catalog = await readCatalog(metidos);
  const existing = new Map(catalog.items.map((item) => [item.id, item]));
  const nextItems = new Map(existing);
  const rows: Array<
    Record<string, unknown> & { id: string; vector: readonly number[] }
  > = [];
  let indexed = 0;

  for (const source of sources) {
    try {
      const root = await fetchXml(metidos, source.url);
      const items = rssItems(root, source.url);
      for (const item of items) {
        const hash = hashString(
          JSON.stringify([
            item.title,
            item.link,
            item.publishedAt,
            item.summary,
            item.content,
          ]),
        );
        const previous = existing.get(item.id);
        if (previous?.hash === hash) {
          continue;
        }
        if (rows.length >= MAX_CHANGED_PER_RUN) break;
        const vector = await metidos.embeddings.embed(item.content, {
          itemId: item.id,
          purpose: "rss_feed_indexer.index",
          sourceUrlHash: hashString(source.url),
        });
        rows.push({
          id: item.id,
          excerpt: item.summary ?? "",
          feedTitle: item.feedTitle ?? source.title ?? "",
          feedUrl: item.feedUrl,
          guid: item.guid ?? "",
          indexedAt: new Date().toISOString(),
          link: item.link ?? "",
          publishedAt: item.publishedAt ?? "",
          title: item.title,
          vector,
        });
        nextItems.set(item.id, {
          feedTitle: item.feedTitle,
          feedUrl: item.feedUrl,
          guid: item.guid,
          hash,
          id: item.id,
          indexedAt: new Date().toISOString(),
          link: item.link,
          publishedAt: item.publishedAt,
          summary: item.summary,
          title: item.title,
        });
        indexed += 1;
      }
    } catch (error) {
      const urlHash = hashString(source.url);
      failedUrls.push(urlHash);
      await safeLog(
        metidos,
        "warn",
        `RSS Feed Indexer could not index URL ${urlHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (rows.length >= MAX_CHANGED_PER_RUN) break;
  }

  if (rows.length > 0) {
    const db = await metidos.lancedb.open(lancePath());
    for (let offset = 0; offset < rows.length; offset += 25) {
      await db.upsert(rows.slice(offset, offset + 25));
    }
  }
  await writeCatalog(metidos, {
    items: [...nextItems.values()],
    version: CATALOG_VERSION,
  });
  return {
    changed: rows.length,
    failedUrls,
    indexed,
    skipped: false,
    sourceUrls: sources.length,
  };
}

function mergeSemanticRowsWithCatalog(
  rows: readonly Record<string, unknown>[],
  catalog: Catalog,
): CatalogItem[] {
  const catalogById = new Map(catalog.items.map((item) => [item.id, item]));
  const results: CatalogItem[] = [];
  for (const row of rows) {
    const id =
      typeof row.id === "string" || typeof row.id === "number"
        ? String(row.id)
        : undefined;
    if (!id) continue;
    const props = isRecord(row.props) ? row.props : {};
    const catalogItem = catalogById.get(id);
    if (catalogItem) {
      results.push(catalogItem);
      continue;
    }
    const title =
      typeof props.title === "string" ? props.title : "Untitled feed item";
    results.push({
      feedUrl: typeof props.feedUrl === "string" ? props.feedUrl : "",
      hash: "",
      id,
      indexedAt: typeof props.indexedAt === "string" ? props.indexedAt : "",
      link: typeof props.link === "string" ? props.link : undefined,
      publishedAt:
        typeof props.publishedAt === "string" ? props.publishedAt : undefined,
      summary: typeof props.excerpt === "string" ? props.excerpt : undefined,
      title,
    });
  }
  return results;
}

function markdownResults(
  items: readonly CatalogItem[],
  scores?: ReadonlyMap<string, number>,
): string {
  if (items.length === 0) {
    return "No matching RSS items found.";
  }
  const lines = [
    "| Published | Score | Title | Source | Link |",
    "| --- | ---: | --- | --- | --- |",
  ];
  for (const item of items.slice(0, MAX_QUERY_ROWS)) {
    const score = scores?.get(item.id);
    const link = item.link ? `[link](${item.link})` : "";
    lines.push(
      `| ${markdownEscape(item.publishedAt ? item.publishedAt.slice(0, 10) : "")} | ${typeof score === "number" ? score.toFixed(3) : ""} | ${markdownEscape(item.title)} | ${markdownEscape(item.feedTitle ?? item.feedUrl)} | ${link} |`,
    );
  }
  return lines.join("\n");
}

function lexicalCatalogSearch(
  catalog: Catalog,
  query: string,
  start?: number,
  end?: number,
): CatalogItem[] {
  const terms = compactWhitespace(query.toLocaleLowerCase())
    .split(" ")
    .filter(Boolean)
    .slice(0, 20);
  if (terms.length === 0) return [];
  return catalog.items
    .filter((item) => withinDateBounds(item, start, end))
    .map((item) => {
      const haystack = compactWhitespace(
        [item.title, item.summary, item.feedTitle, item.feedUrl]
          .filter(Boolean)
          .join(" "),
      ).toLocaleLowerCase();
      const score = terms.reduce(
        (total, term) => total + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (itemMillis(right.item) ?? 0) - (itemMillis(left.item) ?? 0);
    })
    .map(({ item }) => item);
}

function semanticUnavailableMarkdown(items: readonly CatalogItem[]): string {
  return [
    "Semantic RSS search is unavailable right now, so I searched indexed RSS metadata by text instead.",
    "",
    markdownResults(items),
  ].join("\n");
}

export default definePlugin((metidos) => {
  metidos.cron({
    key: "refresh_feeds",
    schedule: "0 3 * * *",
    timeoutMs: 600_000,
    async action(_context): Promise<RefreshResult> {
      const urls = settingUrlList(metidos.settings.get("list_url"));
      const result = await refreshLocalFeeds(metidos, urls);
      if (result.skipped) {
        await safeLog(
          metidos,
          "info",
          "RSS Feed Indexer skipped local refresh; no feed URLs configured.",
        );
      } else {
        await safeLog(
          metidos,
          "info",
          `RSS Feed Indexer refreshed local feeds: ${result.changed} changed item(s), ${result.failedUrls.length} failed URL(s).`,
        );
      }
      return result;
    },
  });

  metidos.addAgentTool<QueryOptions, { markdown: string; type: "markdown" }>({
    tool: "rss_query",
    name: "RSS query",
    description:
      "Search the locally indexed RSS items. Props: optional startDate, endDate, q; at least one is required.",
    timeoutMs: 15_000,
    validateProps: validateQueryOptions,
    async action(context, props) {
      requireCallbackContext(context);
      const catalog = await readCatalog(metidos);
      const start = parseDateBound(props.startDate, "startDate", false);
      const end = parseDateBound(props.endDate, "endDate", true);

      if (props.q) {
        if (catalog.items.length === 0) {
          return { markdown: markdownResults([]), type: "markdown" };
        }
        try {
          const db = await metidos.lancedb.open(lancePath());
          const vector = await metidos.embeddings.embed(props.q, {
            purpose: "rss_feed_indexer.query",
          });
          const rows = (await db.query(vector, {
            limit: SEMANTIC_CANDIDATES,
          })) as readonly Record<string, unknown>[];
          const scores = new Map<string, number>();
          for (const row of rows) {
            const id =
              typeof row.id === "string" || typeof row.id === "number"
                ? String(row.id)
                : undefined;
            if (id && typeof row.score === "number") scores.set(id, row.score);
          }
          const filtered = mergeSemanticRowsWithCatalog(rows, catalog).filter(
            (item) => withinDateBounds(item, start, end),
          );
          return {
            markdown: markdownResults(filtered, scores),
            type: "markdown",
          };
        } catch (error) {
          await safeLog(
            metidos,
            "warn",
            `RSS Feed Indexer semantic query failed; falling back to text metadata search: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            markdown: semanticUnavailableMarkdown(
              lexicalCatalogSearch(catalog, props.q, start, end),
            ),
            type: "markdown",
          };
        }
      }

      const filtered = catalog.items
        .filter((item) => withinDateBounds(item, start, end))
        .sort((a, b) => (itemMillis(b) ?? 0) - (itemMillis(a) ?? 0));
      return { markdown: markdownResults(filtered), type: "markdown" };
    },
  });
});
