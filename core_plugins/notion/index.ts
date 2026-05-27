import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type JsonRecord = Record<string, unknown>;
type ToolResult = { type: "markdown"; markdown: string };

type NotionSearchProps = {
  filter?: { object?: "database" | "data_source" | "page" } | undefined;
  page_size?: number | undefined;
  query: string;
  start_cursor?: string | undefined;
};

type SemanticNotionSearchProps = NotionSearchProps & {
  limit?: number | undefined;
};

type LanceDbResult = {
  id: number | string;
  props: JsonRecord;
  score: number;
};

type NotionFetchProps = {
  depth: number;
  format: "blocks" | "markdown" | "page" | "schema" | "summary";
  include_children: boolean;
  page_size: number;
  start_cursor?: string | undefined;
  target: string;
};

type NotionQueryDataSourceProps = {
  data_source_id: string;
  filter?: unknown | undefined;
  filter_properties?: string[] | undefined;
  page_size?: number | undefined;
  sorts?: unknown[] | undefined;
  start_cursor?: string | undefined;
};

type NotionCreatePageProps = {
  children?: unknown[] | undefined;
  cover?: unknown | undefined;
  icon?: unknown | undefined;
  markdown?: string | undefined;
  parent: JsonRecord;
  properties?: JsonRecord | undefined;
  template_id?: string | undefined;
  title?: string | undefined;
};

type NotionUpdatePageProps = {
  content?: JsonRecord | undefined;
  cover?: unknown | undefined;
  icon?: unknown | undefined;
  in_trash?: boolean | undefined;
  page_id: string;
  properties?: JsonRecord | undefined;
};

type NotionCommentProps =
  | {
      action: "list";
      block_id: string;
      page_size?: number | undefined;
      start_cursor?: string | undefined;
    }
  | {
      action: "create";
      parent: JsonRecord;
      rich_text: string;
    };

const BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_MARKDOWN_CHARS = 200_000;
const MAX_JSON_CHARS = 200_000;
const NOTION_VECTOR_PATH = "~/semantic/search";
const MAX_CHILDREN = 1000;
const MAX_PAGE_SIZE = 100;

let requestChain: Promise<unknown> = Promise.resolve();

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
  if (value === undefined || value === null) return undefined;
  return nonEmptyString(value, key, maxLength);
}

function optionalBoolean(input: JsonRecord, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberField(
  input: JsonRecord,
  key: string,
  options: { defaultValue?: number; max: number; min: number },
): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return options.defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number.`);
  }
  if (value < options.min || value > options.max) {
    throw new Error(
      `${key} must be between ${options.min} and ${options.max}.`,
    );
  }
  return Math.trunc(value);
}

function stringList(input: JsonRecord, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${key} must be an array of at most 100 strings.`);
  }
  return value.map((entry) => nonEmptyString(entry, `${key} entry`, 200));
}

function jsonArray(
  input: JsonRecord,
  key: string,
  maxItems: number,
): unknown[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(
      `${key} must be an array with at most ${maxItems} entries.`,
    );
  }
  return value;
}

function optionalRecord(
  input: JsonRecord,
  key: string,
): JsonRecord | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  const result = record(value);
  if (Object.keys(result).length === 0 && typeof value !== "object") {
    throw new Error(`${key} must be an object.`);
  }
  return result;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function apiKey(metidos: MetidosPluginApi): string {
  const configured = firstNonEmptyString(
    metidos.settings.get("api_key"),
    metidos.env.get("NOTION_API_KEY"),
  );
  if (configured) return configured;
  throw new Error(
    "Configure the Notion api_key setting or NOTION_API_KEY env var.",
  );
}

function notionHeaders(metidos: MetidosPluginApi): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey(metidos)}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = requestChain.then(operation, operation);
  requestChain = run.catch(() => undefined);
  return run;
}

async function notionRequest(
  metidos: MetidosPluginApi,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  return enqueue(async () => {
    const response = await metidos.fetch(`${BASE_URL}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: notionHeaders(metidos),
      method,
    });
    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const retryAfter =
        response.headers["Retry-After"] ?? response.headers["retry-after"];
      const suffix = retryAfter ? ` Retry-After: ${retryAfter}s.` : "";
      throw new Error(
        `Notion request failed (${response.status}) for ${method} ${path}.${suffix} ${String(text).slice(0, 800)}`,
      );
    }
    return data;
  });
}

function jsonMarkdown(title: string, value: unknown): ToolResult {
  let json = JSON.stringify(value, null, 2);
  if (json.length > MAX_JSON_CHARS) {
    json = `${json.slice(0, MAX_JSON_CHARS)}\n... truncated ...`;
  }
  return {
    type: "markdown",
    markdown: `# ${title}\n\n\`\`\`json\n${json}\n\`\`\``,
  };
}

function markdownResult(markdown: string): ToolResult {
  const output =
    markdown.length > MAX_MARKDOWN_CHARS
      ? `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n... truncated ...`
      : markdown;
  return { type: "markdown", markdown: output };
}

function queryString(
  params: Record<string, number | string | string[] | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`,
      );
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function dashedUuid(value: string): string {
  const raw = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(raw)) {
    throw new Error(
      "Notion IDs must be UUIDs or Notion URLs containing a UUID.",
    );
  }
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function notionIdFromTarget(target: string): string {
  const value = target.trim();
  const uuid =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.exec(
      value,
    );
  if (uuid) return dashedUuid(uuid[0]);
  const compact = /[0-9a-f]{32}/iu.exec(value);
  if (compact) return dashedUuid(compact[0]);
  return dashedUuid(value);
}

function titleProperties(
  title?: string,
  properties?: JsonRecord,
): JsonRecord | undefined {
  const output = properties ? { ...properties } : {};
  if (title && !("title" in output) && !("Name" in output)) {
    output.title = { title: [{ text: { content: title } }] };
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function validateSemanticSearch(input: unknown): SemanticNotionSearchProps {
  const props = validateSearch(input) as SemanticNotionSearchProps;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const limit = (input as JsonRecord).limit;
    if (limit !== undefined) {
      props.limit = numberField(input as JsonRecord, "limit", {
        max: 50,
        min: 1,
      });
    }
  }
  return props;
}

function validateSearch(input: unknown): NotionSearchProps {
  const source = record(input);
  const filter = optionalRecord(source, "filter");
  const object = filter?.object;
  if (
    object !== undefined &&
    object !== "page" &&
    object !== "database" &&
    object !== "data_source"
  ) {
    throw new Error("filter.object must be page, database, or data_source.");
  }
  return {
    filter: object ? { object } : undefined,
    page_size: numberField(source, "page_size", { max: MAX_PAGE_SIZE, min: 1 }),
    query: nonEmptyString(source.query, "query", 500),
    start_cursor: optionalString(source, "start_cursor", 300),
  };
}

function validateFetch(input: unknown): NotionFetchProps {
  const source = record(input);
  const rawFormat = optionalString(source, "format", 20) ?? "markdown";
  if (
    !["summary", "markdown", "page", "blocks", "schema"].includes(rawFormat)
  ) {
    throw new Error(
      "format must be summary, markdown, page, blocks, or schema.",
    );
  }
  return {
    depth:
      numberField(source, "depth", { defaultValue: 1, max: 5, min: 0 }) ?? 1,
    format: rawFormat as NotionFetchProps["format"],
    include_children: optionalBoolean(source, "include_children") ?? false,
    page_size:
      numberField(source, "page_size", {
        defaultValue: 100,
        max: MAX_PAGE_SIZE,
        min: 1,
      }) ?? 100,
    start_cursor: optionalString(source, "start_cursor", 300),
    target: nonEmptyString(source.target, "target", 2000),
  };
}

function validateQueryDataSource(input: unknown): NotionQueryDataSourceProps {
  const source = record(input);
  return {
    data_source_id: notionIdFromTarget(
      nonEmptyString(source.data_source_id, "data_source_id", 2000),
    ),
    filter: source.filter,
    filter_properties: stringList(source, "filter_properties"),
    page_size: numberField(source, "page_size", { max: MAX_PAGE_SIZE, min: 1 }),
    sorts: jsonArray(source, "sorts", 100),
    start_cursor: optionalString(source, "start_cursor", 300),
  };
}

function validateParent(value: unknown): JsonRecord {
  const parent = record(value);
  const type = parent.type;
  if (type === "page_id")
    return {
      page_id: notionIdFromTarget(
        nonEmptyString(parent.page_id, "parent.page_id", 2000),
      ),
      type,
    };
  if (type === "data_source_id")
    return {
      data_source_id: notionIdFromTarget(
        nonEmptyString(parent.data_source_id, "parent.data_source_id", 2000),
      ),
      type,
    };
  if (type === "workspace") return { type: "workspace", workspace: true };
  throw new Error("parent.type must be page_id, data_source_id, or workspace.");
}

function validateCreatePage(input: unknown): NotionCreatePageProps {
  const source = record(input);
  const markdown = optionalString(source, "markdown", MAX_MARKDOWN_CHARS);
  return {
    children: jsonArray(source, "children", MAX_CHILDREN),
    cover: source.cover ?? undefined,
    icon: source.icon ?? undefined,
    markdown,
    parent: validateParent(source.parent),
    properties: optionalRecord(source, "properties"),
    template_id: optionalString(source, "template_id", 300),
    title: optionalString(source, "title", 500),
  };
}

function validateUpdatePage(input: unknown): NotionUpdatePageProps {
  const source = record(input);
  const content = optionalRecord(source, "content");
  if (content) {
    const mode = content.mode;
    if (
      ![
        "append_markdown",
        "replace_markdown",
        "patch_markdown",
        "append_blocks",
      ].includes(String(mode))
    ) {
      throw new Error(
        "content.mode must be append_markdown, replace_markdown, patch_markdown, or append_blocks.",
      );
    }
    if (
      (mode === "append_markdown" || mode === "replace_markdown") &&
      typeof content.markdown !== "string"
    ) {
      throw new Error(
        "content.markdown is required for append_markdown and replace_markdown.",
      );
    }
    if (mode === "append_blocks") jsonArray(content, "blocks", MAX_CHILDREN);
  }
  return {
    content,
    cover: "cover" in source ? source.cover : undefined,
    icon: "icon" in source ? source.icon : undefined,
    in_trash: optionalBoolean(source, "in_trash"),
    page_id: notionIdFromTarget(
      nonEmptyString(source.page_id, "page_id", 2000),
    ),
    properties: optionalRecord(source, "properties"),
  };
}

function validateComment(input: unknown): NotionCommentProps {
  const source = record(input);
  if (source.action === "list") {
    return {
      action: "list",
      block_id: notionIdFromTarget(
        nonEmptyString(source.block_id, "block_id", 2000),
      ),
      page_size: numberField(source, "page_size", {
        max: MAX_PAGE_SIZE,
        min: 1,
      }),
      start_cursor: optionalString(source, "start_cursor", 300),
    };
  }
  if (source.action === "create") {
    return {
      action: "create",
      parent: validateCommentParent(source.parent),
      rich_text: nonEmptyString(source.rich_text, "rich_text", 2000),
    };
  }
  throw new Error("action must be list or create.");
}

function validateCommentParent(value: unknown): JsonRecord {
  const parent = record(value);
  if (parent.type === "page_id")
    return {
      page_id: notionIdFromTarget(
        nonEmptyString(parent.page_id, "parent.page_id", 2000),
      ),
    };
  if (parent.type === "block_id")
    return {
      block_id: notionIdFromTarget(
        nonEmptyString(parent.block_id, "parent.block_id", 2000),
      ),
    };
  if (parent.type === "discussion_id")
    return {
      discussion_id: nonEmptyString(
        parent.discussion_id,
        "parent.discussion_id",
        300,
      ),
    };
  throw new Error(
    "comment parent.type must be page_id, block_id, or discussion_id.",
  );
}

async function retrieveChildren(
  metidos: MetidosPluginApi,
  blockId: string,
  pageSize: number,
  startCursor?: string,
): Promise<unknown> {
  return notionRequest(
    metidos,
    "GET",
    `/blocks/${blockId}/children${queryString({ page_size: pageSize, start_cursor: startCursor })}`,
  );
}

async function retrieveBlockTree(
  metidos: MetidosPluginApi,
  blockId: string,
  depth: number,
  pageSize: number,
  startCursor?: string,
): Promise<unknown> {
  const block = await notionRequest(metidos, "GET", `/blocks/${blockId}`);
  if (depth <= 0) return block;
  const childrenPage = await retrieveChildren(
    metidos,
    blockId,
    pageSize,
    startCursor,
  );
  const children = Array.isArray(record(childrenPage).results)
    ? (record(childrenPage).results as unknown[])
    : [];
  const nested = [];
  for (const child of children) {
    const childId =
      typeof record(child).id === "string" ? String(record(child).id) : "";
    const hasChildren = record(child).has_children === true;
    if (childId && hasChildren && depth > 1) {
      nested.push({
        ...record(child),
        children: await retrieveBlockTree(
          metidos,
          childId,
          depth - 1,
          pageSize,
        ),
      });
    } else {
      nested.push(child);
    }
  }
  return { block, children: { ...record(childrenPage), results: nested } };
}

async function fetchByFormat(
  metidos: MetidosPluginApi,
  props: NotionFetchProps,
): Promise<ToolResult> {
  const id = notionIdFromTarget(props.target);
  if (props.format === "markdown") {
    const markdown = await notionRequest(
      metidos,
      "GET",
      `/pages/${id}/markdown`,
    );
    const content = record(markdown).markdown;
    return markdownResult(
      typeof content === "string"
        ? content
        : typeof markdown === "string"
          ? markdown
          : JSON.stringify(markdown, null, 2),
    );
  }
  if (props.format === "page") {
    const page = await notionRequest(metidos, "GET", `/pages/${id}`);
    if (props.include_children) {
      return jsonMarkdown("Notion page", {
        page,
        children: await retrieveChildren(
          metidos,
          id,
          props.page_size,
          props.start_cursor,
        ),
      });
    }
    return jsonMarkdown("Notion page", page);
  }
  if (props.format === "blocks") {
    return jsonMarkdown(
      "Notion blocks",
      await retrieveBlockTree(
        metidos,
        id,
        props.depth,
        props.page_size,
        props.start_cursor,
      ),
    );
  }
  if (props.format === "schema") {
    try {
      return jsonMarkdown(
        "Notion data source",
        await notionRequest(metidos, "GET", `/data_sources/${id}`),
      );
    } catch {
      return jsonMarkdown(
        "Notion database",
        await notionRequest(metidos, "GET", `/databases/${id}`),
      );
    }
  }
  try {
    const page = await notionRequest(metidos, "GET", `/pages/${id}`);
    return jsonMarkdown("Notion summary", summarizeNotionObject(page));
  } catch {
    try {
      const dataSource = await notionRequest(
        metidos,
        "GET",
        `/data_sources/${id}`,
      );
      return jsonMarkdown("Notion summary", summarizeNotionObject(dataSource));
    } catch {
      const database = await notionRequest(metidos, "GET", `/databases/${id}`);
      return jsonMarkdown("Notion summary", summarizeNotionObject(database));
    }
  }
}

function semanticNotionSummary(value: unknown): JsonRecord {
  const source = record(value);
  return {
    archived: source.archived,
    created_time: source.created_time,
    id: source.id,
    last_edited_time: source.last_edited_time,
    object: source.object,
    properties: source.properties,
    title: source.title,
    type: source.type,
    url: source.url,
  };
}

function semanticNotionRowsMarkdown(rows: readonly LanceDbResult[]): string {
  if (rows.length === 0) {
    return "# Semantic Notion search\n\nNo matching Notion objects found.";
  }
  const lines = [
    "# Semantic Notion search",
    "",
    "| Score | Object | Type | URL |",
    "| ---: | --- | --- | --- |",
  ];
  for (const row of rows) {
    const url = typeof row.props.url === "string" ? row.props.url : "";
    lines.push(
      `| ${row.score.toFixed(3)} | ${String(row.id)} | ${String(row.props.object ?? row.props.type ?? "")} | ${url ? `[Open](${url})` : ""} |`,
    );
  }
  lines.push("", "```json", JSON.stringify(rows, null, 2), "```");
  return lines.join("\n");
}

async function semanticNotionSearch(
  metidos: MetidosPluginApi,
  props: SemanticNotionSearchProps,
): Promise<ToolResult> {
  const result = await notionRequest(metidos, "POST", "/search", {
    ...props,
    page_size: Math.min(props.page_size ?? 25, 50),
  });
  const results = record(result).results;
  const items = Array.isArray(results) ? results : [];
  const db = await metidos.lancedb.open(NOTION_VECTOR_PATH);
  const rows = [];
  for (const item of items) {
    const summary = semanticNotionSummary(item);
    const id =
      typeof summary.id === "string" ? summary.id : JSON.stringify(summary);
    rows.push({
      ...summary,
      id,
      indexedAt: new Date().toISOString(),
      vector: await metidos.embeddings.embed(JSON.stringify(summary), {
        notionObjectId: id,
        purpose: "notion.semantic_search.index",
      }),
    });
  }
  if (rows.length > 0) {
    await db.upsert(rows);
  }
  const queryVector = await metidos.embeddings.embed(props.query, {
    purpose: "notion.semantic_search.query",
  });
  const matches = (await db.query(queryVector, {
    limit: props.limit ?? 10,
  })) as readonly LanceDbResult[];
  return markdownResult(semanticNotionRowsMarkdown(matches));
}

function summarizeNotionObject(value: unknown): unknown {
  const source = record(value);
  return {
    archived: source.archived,
    created_time: source.created_time,
    id: source.id,
    in_trash: source.in_trash,
    last_edited_time: source.last_edited_time,
    object: source.object,
    parent: source.parent,
    properties: source.properties,
    title: source.title,
    type: source.type,
    url: source.url,
  };
}

function markdownUpdateBody(
  _props: NotionUpdatePageProps,
  content: JsonRecord,
): unknown {
  const mode = content.mode;
  if (mode === "append_markdown") {
    return {
      insert_content: { content: content.markdown },
      type: "insert_content",
    };
  }
  if (mode === "replace_markdown") {
    return {
      replace_content: {
        allow_deleting_content: content.allow_deleting_content === true,
        new_str: content.markdown,
      },
      type: "replace_content",
    };
  }
  if (mode === "patch_markdown") {
    const updates = content.content_updates ?? content.updates;
    if (!Array.isArray(updates)) {
      throw new Error(
        "patch_markdown requires content.content_updates (or content.updates) per Notion markdown update_content.",
      );
    }
    return {
      type: "update_content",
      update_content: {
        allow_deleting_content: content.allow_deleting_content === true,
        content_updates: updates,
      },
    };
  }
  throw new Error("Unsupported markdown content mode.");
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "search",
    name: "Search Notion",
    description:
      "Search Notion pages, databases, and data sources by title/content.",
    timeoutMs: 30_000,
    validateProps: validateSearch,
    async action(_context, props) {
      const result = await notionRequest(metidos, "POST", "/search", props);
      return jsonMarkdown("Notion search", result);
    },
  });

  metidos.addAgentTool({
    tool: "semantic_search",
    name: "Semantic Notion search",
    description:
      "Search Notion, embed returned object summaries, and rank cached results semantically. Requires a configured embedding model.",
    timeoutMs: 60_000,
    validateProps: validateSemanticSearch,
    async action(_context, props) {
      return semanticNotionSearch(metidos, props);
    },
  });

  metidos.addAgentTool({
    tool: "fetch",
    name: "Fetch Notion object",
    description:
      "Fetch a Notion page, database, data source, or block by URL or ID.",
    timeoutMs: 30_000,
    validateProps: validateFetch,
    async action(_context, props) {
      return fetchByFormat(metidos, props);
    },
  });

  metidos.addAgentTool({
    tool: "query_data_source",
    name: "Query Notion data source",
    description:
      "Query a Notion data source with optional filter, sorts, filter_properties, page_size, and start_cursor.",
    timeoutMs: 30_000,
    validateProps: validateQueryDataSource,
    async action(_context, props) {
      const query = queryString({
        filter_properties: props.filter_properties,
      });
      const result = await notionRequest(
        metidos,
        "POST",
        `/data_sources/${props.data_source_id}/query${query}`,
        {
          filter: props.filter,
          page_size: props.page_size,
          sorts: props.sorts,
          start_cursor: props.start_cursor,
        },
      );
      return jsonMarkdown("Notion data source query", result);
    },
  });

  metidos.addAgentTool({
    tool: "create_page",
    name: "Create Notion page",
    description:
      "Create a page under a Notion page, data source, or workspace.",
    timeoutMs: 60_000,
    validateProps: validateCreatePage,
    async action(_context, props) {
      const body: JsonRecord = {
        parent: props.parent,
      };
      const properties = titleProperties(props.title, props.properties);
      if (properties) body.properties = properties;
      if (props.children) body.children = props.children;
      if (props.template_id) body.template_id = props.template_id;
      if (props.icon !== undefined) body.icon = props.icon;
      if (props.cover !== undefined) body.cover = props.cover;

      const page = await notionRequest(metidos, "POST", "/pages", body);
      if (props.markdown) {
        const pageId = String(record(page).id || "");
        if (!pageId)
          throw new Error("Notion create page response was missing page id.");
        const markdownUpdate = await notionRequest(
          metidos,
          "PATCH",
          `/pages/${pageId}/markdown`,
          {
            insert_content: { content: props.markdown },
            type: "insert_content",
          },
        );
        return jsonMarkdown("Notion page created", { page, markdownUpdate });
      }
      return jsonMarkdown("Notion page created", page);
    },
  });

  metidos.addAgentTool({
    tool: "update_page",
    name: "Update Notion page",
    description:
      "Update Notion page properties, content, icon, cover, or in_trash state.",
    timeoutMs: 60_000,
    validateProps: validateUpdatePage,
    async action(_context, props) {
      const updates: JsonRecord = {};
      if (props.properties) updates.properties = props.properties;
      if (props.icon !== undefined) updates.icon = props.icon;
      if (props.cover !== undefined) updates.cover = props.cover;
      if (props.in_trash !== undefined) updates.in_trash = props.in_trash;

      const results: JsonRecord = {};
      if (Object.keys(updates).length > 0) {
        results.page = await notionRequest(
          metidos,
          "PATCH",
          `/pages/${props.page_id}`,
          updates,
        );
      }
      const content = props.content;
      if (content) {
        if (content.mode === "append_blocks") {
          results.content = await notionRequest(
            metidos,
            "PATCH",
            `/blocks/${props.page_id}/children`,
            {
              children: content.blocks,
              position: content.position ?? { type: "end" },
            },
          );
        } else {
          results.content = await notionRequest(
            metidos,
            "PATCH",
            `/pages/${props.page_id}/markdown`,
            markdownUpdateBody(props, content),
          );
        }
      }
      return jsonMarkdown("Notion page updated", results);
    },
  });

  metidos.addAgentTool({
    tool: "comment",
    name: "Notion comments",
    description: "List or create Notion comments.",
    timeoutMs: 30_000,
    validateProps: validateComment,
    async action(_context, props) {
      if (props.action === "list") {
        const result = await notionRequest(
          metidos,
          "GET",
          `/comments${queryString({ block_id: props.block_id, page_size: props.page_size, start_cursor: props.start_cursor })}`,
        );
        return jsonMarkdown("Notion comments", result);
      }
      const result = await notionRequest(metidos, "POST", "/comments", {
        parent: props.parent,
        rich_text: [{ text: { content: props.rich_text } }],
      });
      return jsonMarkdown("Notion comment created", result);
    },
  });
});
