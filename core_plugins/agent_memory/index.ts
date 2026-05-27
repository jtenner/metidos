import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type PluginFsApi = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readText(path: string): Promise<string>;
  rm(path: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
};

type RememberProps = {
  payload: string;
  title?: string;
  source?: string;
};

type RememberFileProps = {
  path: string;
  title?: string;
};

type RecallProps = {
  limit?: number;
  query: string;
};

type ForgetProps = {
  file: string;
};

type ModifyProps = {
  file: string;
  payload: string;
  title?: string;
  source?: string;
};

type MemoryInput = {
  content: string;
  id?: string;
  indexContent: string;
  indexTruncated: boolean;
  memoryTruncated: boolean;
  source: string;
  title?: string;
};

type StoredMemoryMetadata = {
  chunkCount: number | null;
  createdAt: string | null;
  id: string;
  indexTruncated: boolean | null;
  memoryTruncated: boolean | null;
  source: string | null;
  title: string | null;
};

type StoredMemoryRef = {
  filePath: string;
  memoryId: string;
};

type MemoryRecord = {
  chunk: string;
  chunkCount: number;
  chunkIndex: number;
  createdAt: string;
  filePath: string;
  id: string;
  memoryId: string;
  source: string;
  title: string;
  vector: readonly number[];
};

type LanceDbResult = {
  id?: number | string;
  props?: Record<string, unknown>;
  score?: number;
};

const CHUNK_OVERLAP_CHARS = 200;
const CHUNK_SIZE_CHARS = 2_000;
const MAX_INDEX_CHARS = 100_000;
const MAX_MEMORY_CHARS = 1_000_000;
const MAX_QUERY_CHARS = 2_000;
const MAX_RECALL_LIMIT = 20;
const MEMORY_FILES_DIRECTORY = "~/memory/files";
const MEMORY_ID_PATTERN = /^mem-[a-z0-9]+-[a-z0-9]+$/u;
const MEMORY_VECTOR_PATH = "~/memory/chunks";
const MAX_CHUNK_DELETE_COUNT =
  Math.ceil(MAX_INDEX_CHARS / (CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS)) + 5;
const RECALL_GUIDANCE =
  "When Agent Memory is available, treat recall as part of orientation: at the start of each turn, run a couple Agent Memory recalls about the current user prompt/task before deciding what to do; recall again before meaningful decisions or tool/file/code actions when prior context could affect the outcome.";
const REMEMBER_GUIDANCE =
  "Use Agent Memory liberally whenever important information arises that could help future agents, or when information should be researched from the web and persisted; use forget or modify when a memory becomes stale or contradictory.";

function fsApi(metidos: unknown): PluginFsApi {
  const maybeFs = (metidos as { fs?: unknown }).fs;
  if (!maybeFs || typeof maybeFs !== "object") {
    throw new Error("metidos.fs is required for Agent Memory storage.");
  }
  return maybeFs as PluginFsApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  options: { maxChars?: number } = {},
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (options.maxChars && trimmed.length > options.maxChars) {
    throw new Error(`${key} must be at most ${options.maxChars} characters.`);
  }
  return trimmed;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maxChars: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxChars) : undefined;
}

function optionalLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(MAX_RECALL_LIMIT, Math.trunc(value));
}

function validateRememberProps(input: unknown): RememberProps {
  if (!isRecord(input)) {
    throw new Error("remember props must be an object.");
  }
  const payload = requiredString(input, "payload", {
    maxChars: MAX_MEMORY_CHARS,
  });
  const title = optionalString(input, "title", 120);
  const source = optionalString(input, "source", 240);
  return {
    payload,
    ...(title ? { title } : {}),
    ...(source ? { source } : {}),
  };
}

function validateRememberFileProps(input: unknown): RememberFileProps {
  if (!isRecord(input)) {
    throw new Error("remember_file props must be an object.");
  }
  const path = requiredString(input, "path", { maxChars: 1_000 });
  if (!path.startsWith("./")) {
    throw new Error("path must be a project-relative path starting with ./.");
  }
  if (path.includes("\0")) {
    throw new Error("path must not contain NUL bytes.");
  }
  const title = optionalString(input, "title", 120);
  return { path, ...(title ? { title } : {}) };
}

function validateRecallProps(input: unknown): RecallProps {
  if (!isRecord(input)) {
    throw new Error("recall props must be an object.");
  }
  const query = requiredString(input, "query", { maxChars: MAX_QUERY_CHARS });
  const limit = optionalLimit(input.limit);
  return { query, ...(limit ? { limit } : {}) };
}

function validateForgetProps(input: unknown): ForgetProps {
  if (!isRecord(input)) {
    throw new Error("forget props must be an object.");
  }
  return { file: requiredString(input, "file", { maxChars: 1_000 }) };
}

function validateModifyProps(input: unknown): ModifyProps {
  if (!isRecord(input)) {
    throw new Error("modify props must be an object.");
  }
  const file = requiredString(input, "file", { maxChars: 1_000 });
  const payload = requiredString(input, "payload", {
    maxChars: MAX_MEMORY_CHARS,
  });
  const title = optionalString(input, "title", 120);
  const source = optionalString(input, "source", 240);
  return {
    file,
    payload,
    ...(title ? { title } : {}),
    ...(source ? { source } : {}),
  };
}

function memoryId(): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `mem-${Date.now().toString(36)}-${random}`;
}

function memoryRefFromFile(file: string): StoredMemoryRef {
  const trimmed = file.trim();
  let name = trimmed;
  if (trimmed.startsWith(`${MEMORY_FILES_DIRECTORY}/`)) {
    name = trimmed.slice(MEMORY_FILES_DIRECTORY.length + 1);
  } else if (trimmed.startsWith("~/")) {
    throw new Error(
      `file must be a memory id, file name, or ${MEMORY_FILES_DIRECTORY}/ file path.`,
    );
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(
      "file must not contain path traversal or nested path segments.",
    );
  }
  const memoryId = name.endsWith(".md") ? name.slice(0, -3) : name;
  if (!MEMORY_ID_PATTERN.test(memoryId)) {
    throw new Error(
      "file must identify an Agent Memory file such as mem-abc123-def456.md.",
    );
  }
  return { filePath: `${MEMORY_FILES_DIRECTORY}/${memoryId}.md`, memoryId };
}

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
}

function oneLine(value: unknown, maxChars = 160): string {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + CHUNK_SIZE_CHARS);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n\n", end);
      if (breakAt > offset + Math.floor(CHUNK_SIZE_CHARS / 2)) {
        end = breakAt + 2;
      }
    }
    const chunk = text.slice(offset, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (end >= text.length) {
      break;
    }
    offset = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks.length > 0 ? chunks : [text.trim()];
}

function boundedContent(
  content: string,
  maxChars: number,
): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  return { content: content.slice(0, maxChars), truncated: true };
}

function memoryFileBody(input: {
  chunkCount: number;
  content: string;
  createdAt: string;
  id: string;
  indexTruncated: boolean;
  memoryTruncated: boolean;
  source: string;
  title: string;
}): string {
  const metadata = [
    `id: ${input.id}`,
    `created_at: ${input.createdAt}`,
    `title: ${input.title}`,
    `source: ${input.source}`,
    `chunk_count: ${input.chunkCount}`,
    `memory_truncated: ${input.memoryTruncated ? "true" : "false"}`,
    `index_truncated: ${input.indexTruncated ? "true" : "false"}`,
  ].join("\n");
  return `# ${input.title}\n\n${metadata}\n\n---\n\n${input.content}`;
}

function parseBooleanMetadata(value: string | undefined): boolean | null {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function parseMemoryMetadata(
  fileContent: string,
  fallbackId: string,
): StoredMemoryMetadata {
  const metadataBlock = fileContent.split(/\n---\n/u, 1)[0] ?? "";
  const metadata: Record<string, string> = {};
  for (const line of metadataBlock.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    metadata[key] = value;
  }
  const chunkCount = Number(metadata.chunk_count);
  const id =
    metadata.id && MEMORY_ID_PATTERN.test(metadata.id)
      ? metadata.id
      : fallbackId;
  return {
    chunkCount:
      Number.isInteger(chunkCount) && chunkCount >= 0 ? chunkCount : null,
    createdAt: metadata.created_at ?? null,
    id,
    indexTruncated: parseBooleanMetadata(metadata.index_truncated),
    memoryTruncated: parseBooleanMetadata(metadata.memory_truncated),
    source: metadata.source ?? null,
    title: metadata.title ?? null,
  };
}

async function readStoredMemoryMetadata(
  metidos: MetidosPluginApi,
  ref: StoredMemoryRef,
): Promise<StoredMemoryMetadata> {
  const content = await fsApi(metidos).readText(ref.filePath);
  const metadata = parseMemoryMetadata(content, ref.memoryId);
  if (metadata.id !== ref.memoryId) {
    throw new Error(
      "Memory file metadata does not match the requested memory id.",
    );
  }
  return metadata;
}

async function writeAndIndexMemory(
  metidos: MetidosPluginApi,
  input: MemoryInput,
): Promise<{
  chunkCount: number;
  filePath: string;
  id: string;
  title: string;
}> {
  const id = input.id ?? memoryId();
  const createdAt = new Date().toISOString();
  const title = input.title ?? (oneLine(input.content, 80) || id);
  const filePath = `${MEMORY_FILES_DIRECTORY}/${id}.md`;
  const chunks = chunkText(input.indexContent);

  const fs = fsApi(metidos);
  await fs.mkdir(MEMORY_FILES_DIRECTORY, { recursive: true });
  await fs.writeText(
    filePath,
    memoryFileBody({
      chunkCount: chunks.length,
      content: input.content,
      createdAt,
      id,
      indexTruncated: input.indexTruncated,
      memoryTruncated: input.memoryTruncated,
      source: input.source,
      title,
    }),
  );

  const rows: MemoryRecord[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex] ?? "";
    rows.push({
      chunk,
      chunkCount: chunks.length,
      chunkIndex,
      createdAt,
      filePath,
      id: `${id}:chunk:${chunkIndex}`,
      memoryId: id,
      source: input.source,
      title,
      vector: await metidos.embeddings.embed(chunk, {
        chunkIndex,
        memoryId: id,
        purpose: "agent_memory.remember.chunk",
        source: input.source,
      }),
    });
  }

  const db = await metidos.lancedb.open(MEMORY_VECTOR_PATH);
  await db.upsert(rows);
  await metidos.log(
    "info",
    `Stored Agent Memory item ${id} with ${rows.length} chunk(s).`,
  );
  return { chunkCount: rows.length, filePath, id, title };
}

async function removeMemoryChunks(
  metidos: MetidosPluginApi,
  memoryId: string,
  chunkCount: number | null,
): Promise<{ attempted: number; deleted: number }> {
  const attempts = Math.max(
    0,
    Math.min(chunkCount ?? MAX_CHUNK_DELETE_COUNT, MAX_CHUNK_DELETE_COUNT),
  );
  const db = await metidos.lancedb.open(MEMORY_VECTOR_PATH);
  let deleted = 0;
  for (let chunkIndex = 0; chunkIndex < attempts; chunkIndex += 1) {
    const result = await db.remove(`${memoryId}:chunk:${chunkIndex}`);
    if (result.deleted) {
      deleted += 1;
    }
  }
  return { attempted: attempts, deleted };
}

async function forgetMemory(
  metidos: MetidosPluginApi,
  file: string,
): Promise<{
  deletedChunks: number;
  filePath: string;
  memoryId: string;
}> {
  const ref = memoryRefFromFile(file);
  const metadata = await readStoredMemoryMetadata(metidos, ref);
  const result = await removeMemoryChunks(
    metidos,
    ref.memoryId,
    metadata.chunkCount,
  );
  await fsApi(metidos).rm(ref.filePath);
  await metidos.log("info", `Forgot Agent Memory item ${ref.memoryId}.`);
  return {
    deletedChunks: result.deleted,
    filePath: ref.filePath,
    memoryId: ref.memoryId,
  };
}

function preparedMemoryInput(input: {
  content: string;
  id?: string;
  source: string;
  title?: string;
}): MemoryInput {
  const memoryContent = boundedContent(input.content, MAX_MEMORY_CHARS);
  const indexContent = boundedContent(memoryContent.content, MAX_INDEX_CHARS);
  return {
    content: memoryContent.content,
    ...(input.id ? { id: input.id } : {}),
    indexContent: indexContent.content,
    indexTruncated: indexContent.truncated,
    memoryTruncated: memoryContent.truncated,
    source: input.source,
    ...(input.title ? { title: input.title } : {}),
  };
}

function resultProps(row: LanceDbResult): Record<string, unknown> {
  return isRecord(row.props) ? row.props : (row as Record<string, unknown>);
}

function recallMarkdown(rows: readonly LanceDbResult[]): string {
  if (rows.length === 0) {
    return "No relevant Agent Memory chunks found.";
  }

  const sections = ["# Recalled Agent Memory chunks"];
  for (const [index, row] of rows.entries()) {
    const props = resultProps(row);
    const chunk = String(props.chunk ?? "").trim();
    const score = typeof row.score === "number" ? row.score.toFixed(3) : "n/a";
    sections.push(
      [
        `## ${index + 1}. ${markdownEscape(props.title ?? props.memoryId ?? row.id)}`,
        "",
        `- Score: ${score}`,
        `- Memory file: \`${markdownEscape(props.filePath)}\``,
        `- Memory id: \`${markdownEscape(props.memoryId ?? row.id)}\``,
        `- Chunk: ${Number(props.chunkIndex ?? 0) + 1}/${markdownEscape(props.chunkCount ?? "?")}`,
        `- Source: ${markdownEscape(props.source ?? "unknown")}`,
        "",
        "```text",
        chunk.length > 1_500 ? `${chunk.slice(0, 1_499)}…` : chunk,
        "```",
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export default definePlugin((metidos) => {
  metidos.addAgentTool<RememberProps, { type: "markdown"; markdown: string }>({
    tool: "remember",
    name: "Remember",
    description: `${RECALL_GUIDANCE} ${REMEMBER_GUIDANCE} Store a text memory. Props: payload (required), title, source. Writes the full memory file and indexes embedded chunks.`,
    timeoutMs: 120_000,
    validateProps: validateRememberProps,
    async action(_context, props) {
      const result = await writeAndIndexMemory(
        metidos,
        preparedMemoryInput({
          content: props.payload,
          source: props.source ?? "direct payload",
          ...(props.title ? { title: props.title } : {}),
        }),
      );
      return {
        type: "markdown",
        markdown: `Stored Agent Memory \`${result.id}\` (${result.chunkCount} chunk(s)) in \`${result.filePath}\`.`,
      };
    },
  });

  metidos.addAgentTool<
    RememberFileProps,
    { type: "markdown"; markdown: string }
  >({
    tool: "remember_file",
    name: "Remember file",
    description: `${RECALL_GUIDANCE} ${REMEMBER_GUIDANCE} Read an allowed project file and store it as Agent Memory. Props: path (required, starts with ./), title.`,
    timeoutMs: 120_000,
    validateProps: validateRememberFileProps,
    async action(_context, props) {
      const rawContent = await fsApi(metidos).readText(props.path);
      const prepared = preparedMemoryInput({
        content: rawContent,
        source: props.path,
        title: props.title ?? props.path,
      });
      const result = await writeAndIndexMemory(metidos, prepared);
      const truncationNote = prepared.memoryTruncated
        ? ` The source file exceeded ${MAX_MEMORY_CHARS} characters and was truncated before storage.`
        : prepared.indexTruncated
          ? ` The stored memory exceeded ${MAX_INDEX_CHARS} characters and was truncated before embedding.`
          : "";
      return {
        type: "markdown",
        markdown: `Stored Agent Memory \`${result.id}\` from \`${props.path}\` (${result.chunkCount} chunk(s)) in \`${result.filePath}\`.${truncationNote}`,
      };
    },
  });

  metidos.addAgentTool<RecallProps, { type: "markdown"; markdown: string }>({
    tool: "recall",
    name: "Recall",
    description: `${RECALL_GUIDANCE} Search Agent Memory. Props: query (required), limit. Returns relevant chunks and the plugin-owned memory file that contains the full memory.`,
    timeoutMs: 30_000,
    validateProps: validateRecallProps,
    async action(_context, props) {
      const vector = await metidos.embeddings.embed(props.query, {
        purpose: "agent_memory.recall.query",
      });
      const db = await metidos.lancedb.open(MEMORY_VECTOR_PATH);
      const rows = (await db.query(vector, {
        limit: props.limit ?? 8,
      })) as readonly LanceDbResult[];
      return { type: "markdown", markdown: recallMarkdown(rows) };
    },
  });

  metidos.addAgentTool<ForgetProps, { type: "markdown"; markdown: string }>({
    tool: "forget",
    name: "Forget",
    description: `${RECALL_GUIDANCE} ${REMEMBER_GUIDANCE} Delete a stale or contradictory memory by memory id, file name, or ${MEMORY_FILES_DIRECTORY}/ file path. Props: file (required). Removes both the full memory file and its indexed chunks.`,
    timeoutMs: 30_000,
    validateProps: validateForgetProps,
    async action(_context, props) {
      const result = await forgetMemory(metidos, props.file);
      return {
        type: "markdown",
        markdown: `Forgot Agent Memory \`${result.memoryId}\`; removed file \`${result.filePath}\` and ${result.deletedChunks} indexed chunk(s).`,
      };
    },
  });

  metidos.addAgentTool<ModifyProps, { type: "markdown"; markdown: string }>({
    tool: "modify",
    name: "Modify memory",
    description: `${RECALL_GUIDANCE} ${REMEMBER_GUIDANCE} Replace an existing memory by memory id, file name, or ${MEMORY_FILES_DIRECTORY}/ file path. Props: file (required), payload (required), title, source. Rewrites the memory file and re-embeds fresh chunks under the same memory id.`,
    timeoutMs: 120_000,
    validateProps: validateModifyProps,
    async action(_context, props) {
      const ref = memoryRefFromFile(props.file);
      const metadata = await readStoredMemoryMetadata(metidos, ref);
      await removeMemoryChunks(metidos, ref.memoryId, metadata.chunkCount);
      const result = await writeAndIndexMemory(
        metidos,
        preparedMemoryInput({
          content: props.payload,
          id: ref.memoryId,
          source: props.source ?? metadata.source ?? "modified memory",
          title: props.title ?? metadata.title ?? ref.memoryId,
        }),
      );
      return {
        type: "markdown",
        markdown: `Modified Agent Memory \`${result.id}\`; rewrote \`${result.filePath}\` and indexed ${result.chunkCount} fresh chunk(s).`,
      };
    },
  });
});
