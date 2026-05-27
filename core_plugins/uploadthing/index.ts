import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type ListFilesProps = {
  limit: number;
  offset: number;
};

type GetFileProps = {
  customId?: string | null | undefined;
  expiresIn?: number;
  fileKey?: string | undefined;
  fileName?: string | undefined;
  path?: string | undefined;
};

type UploadFileProps = {
  acl: "public-read" | "private";
  contentDisposition: "inline" | "attachment";
  customId?: string | null | undefined;
  expiresIn?: number | undefined;
  metadata?: unknown;
  path: string;
  slug?: string | undefined;
  type?: string | undefined;
};

type DeleteFileProps = {
  customIds?: string[] | undefined;
  fileKeys?: string[] | undefined;
  files?: string[] | undefined;
};

type PluginFsStat = {
  isFile?: boolean;
  kind?: "directory" | "file" | "other" | "symlink";
  size?: number;
};

type PluginFsApi = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<PluginFsStat>;
  write(path: string, bytes: Uint8Array): Promise<void>;
};

type PresignedUpload = {
  fields?: Record<string, string>;
  key?: string | undefined;
  url: string;
};

const API_BASE_URL = "https://api.uploadthing.com";
const SDK_VERSION = "7.0.0";
const BACKEND_ADAPTER = "metidos-plugin";
const MAX_TOOL_UPLOAD_BYTES = 700_000;
const MAX_TEXT_DOWNLOAD_CHARS = 200_000;

const MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  css: "text/css",
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  m4a: "audio/mp4",
  md: "text/markdown",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webm: "video/webm",
  webp: "image/webp",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
};

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
}

function stringField(
  input: Record<string, unknown>,
  key: string,
  options: {
    defaultValue?: string;
    maxLength?: number;
    required?: boolean;
  } = {},
): string | undefined {
  const raw = input[key];
  if (typeof raw !== "string" || !raw.trim()) {
    if (options.required) throw new Error(`${key} must be a non-empty string.`);
    return options.defaultValue;
  }
  const value = raw.trim();
  return options.maxLength ? value.slice(0, options.maxLength) : value;
}

function numberField(
  input: Record<string, unknown>,
  key: string,
  options: { defaultValue: number; max: number; min: number },
): number {
  const raw = input[key];
  const value = typeof raw === "number" ? raw : options.defaultValue;
  if (!Number.isFinite(value) || value < options.min || value > options.max) {
    throw new Error(
      `${key} must be a number between ${options.min} and ${options.max}.`,
    );
  }
  return Math.trunc(value);
}

function optionalNumberField(
  input: Record<string, unknown>,
  key: string,
  options: { max: number; min: number },
): number | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < options.min ||
    raw > options.max
  ) {
    throw new Error(
      `${key} must be a number between ${options.min} and ${options.max}.`,
    );
  }
  return Math.trunc(raw);
}

function stringList(
  input: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const raw = input[key];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    throw new Error(
      `${key} must be a non-empty string array with at most 100 entries.`,
    );
  }
  return raw.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${key} entries must be non-empty strings.`);
    }
    return value.trim().slice(0, 300);
  });
}

function normalizedProjectPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("path must be a non-empty project-relative string.");
  }
  const path = value.trim();
  if (!path.startsWith("./")) {
    throw new Error(
      "path must start with ./ and refer to the current project.",
    );
  }
  if (path.includes("\0")) {
    throw new Error("path must not contain null bytes.");
  }
  return path.slice(0, 2048);
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  const slash = trimmed.lastIndexOf("/");
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).slice(0, 300);
}

function extensionForName(name: string): string {
  const dot = basename(name).lastIndexOf(".");
  return dot >= 0
    ? basename(name)
        .slice(dot + 1)
        .toLowerCase()
    : "";
}

function fileTypeFor(path: string, override?: string): string {
  if (override && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(override)) {
    return override.slice(0, 120);
  }
  return MIME_TYPES[extensionForName(path)] ?? "application/octet-stream";
}

function isImageName(name: string): boolean {
  return fileTypeFor(name).startsWith("image/");
}

function isTextName(name: string): boolean {
  const type = fileTypeFor(name);
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/yaml" ||
    type === "image/svg+xml"
  );
}

function fsApi(metidos: unknown): PluginFsApi {
  const maybeFs = (metidos as { fs?: unknown }).fs;
  if (!maybeFs || typeof maybeFs !== "object") {
    throw new Error("metidos.fs is required for project file metadata.");
  }
  return maybeFs as PluginFsApi;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function apiKey(metidos: MetidosPluginApi): string {
  const configured = firstNonEmptyString(
    metidos.settings.get("api_key"),
    metidos.env.get("UPLOADTHING_API_KEY"),
  );
  if (configured) return configured;
  throw new Error(
    "Configure the UploadThing api_key setting or UPLOADTHING_API_KEY env var.",
  );
}

function uploadThingHeaders(metidos: MetidosPluginApi): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Uploadthing-Api-Key": apiKey(metidos),
    "X-Uploadthing-Be-Adapter": BACKEND_ADAPTER,
    "X-Uploadthing-Version": SDK_VERSION,
  };
}

async function uploadThingPost(
  metidos: MetidosPluginApi,
  path: string,
  body: unknown,
) {
  const response = await metidos.fetch(`${API_BASE_URL}${path}`, {
    body: JSON.stringify(body ?? {}),
    headers: uploadThingHeaders(metidos),
    method: "POST",
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
    throw new Error(
      `UploadThing request failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return { data, status: response.status, url: response.url };
}

function jsonResult(value: unknown) {
  return {
    type: "markdown" as const,
    markdown: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
  };
}

function fileAccessUrl(value: unknown): string {
  const data = record(record(value).data);
  const url = firstNonEmptyString(data.url, data.ufsUrl);
  if (!url) {
    throw new Error("UploadThing file access response is missing url.");
  }
  return url;
}

type UploadThingListedFile = {
  customId?: string | null;
  key?: string | undefined;
  name?: string | undefined;
};

function listedFiles(value: unknown): UploadThingListedFile[] {
  const files = record(record(value).data).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    const source = record(file);
    const key = typeof source.key === "string" ? source.key : undefined;
    const name = typeof source.name === "string" ? source.name : undefined;
    const customId =
      typeof source.customId === "string" ? source.customId : null;
    return key || name || customId ? [{ customId, key, name }] : [];
  });
}

async function getFileNameForResult(
  metidos: MetidosPluginApi,
  props: GetFileProps,
): Promise<string> {
  const listed = listedFiles(
    await uploadThingPost(metidos, "/v6/listFiles", {
      limit: 1000,
      offset: 0,
    }),
  );
  const match = listed.find(
    (file) =>
      (props.fileKey && file.key === props.fileKey) ||
      (props.customId && file.customId === props.customId),
  );
  return (
    firstNonEmptyString(match?.name, props.customId, props.fileKey) ?? "file"
  );
}

function safeDataFileName(name: string): string {
  return basename(name).replace(/[^A-Za-z0-9._-]/g, "_") || "file";
}

function defaultProjectDownloadPath(name: string): string {
  return `./${safeDataFileName(name)}`;
}

function projectDownloadPath(input: {
  fileName?: string | undefined;
  name: string;
  path?: string | undefined;
}): string {
  if (input.path) return input.path;
  return defaultProjectDownloadPath(input.fileName ?? input.name);
}

async function fileContentResult(input: {
  metidos: MetidosPluginApi;
  name: string;
  fileName?: string | undefined;
  path?: string | undefined;
  url: string;
}) {
  const response = await input.metidos.fetch(input.url, { method: "GET" });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(
      `UploadThing file download failed (${response.status}): ${new TextDecoder().decode(bytes.slice(0, 500))}`,
    );
  }

  const outputPath = projectDownloadPath(input);
  await fsApi(input.metidos).write(outputPath, bytes);

  const downloaded = {
    name: input.name,
    path: outputPath,
    size: bytes.byteLength,
    type: fileTypeFor(input.name),
  };

  if (isTextName(input.name)) {
    const text = new TextDecoder().decode(bytes);
    if (text.length > MAX_TEXT_DOWNLOAD_CHARS) {
      return jsonResult({
        downloaded,
        message: `${input.name} was downloaded, but is too large to return as text (${text.length} characters; max ${MAX_TEXT_DOWNLOAD_CHARS}).`,
      });
    }
    return jsonResult({ downloaded, text });
  }

  if (isImageName(input.name)) {
    return {
      alt: `${input.name} downloaded to ${outputPath}`,
      mimeType: fileTypeFor(input.name) as `image/${string}`,
      path: outputPath,
      type: "image:file" as const,
    };
  }

  return jsonResult({ downloaded });
}

function presignedUploadFromPrepareResponse(value: unknown): PresignedUpload {
  const outer = record(value);
  const data = record(outer.data);
  const key = typeof data.key === "string" ? data.key : undefined;
  const url = typeof data.url === "string" ? data.url : "";
  if (!url) {
    throw new Error("UploadThing prepareUpload response is missing url.");
  }
  return { key, url };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function asciiBytes(value: string): Uint8Array {
  const output = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = value.charCodeAt(index) & 255;
  }
  return output;
}

function safeMultipartText(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
}

function multipartBody(input: {
  boundary: string;
  fields: Record<string, string>;
  fileBytes: Uint8Array;
  fileName: string;
  fileType: string;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [key, value] of Object.entries(input.fields)) {
    parts.push(
      asciiBytes(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${safeMultipartText(key)}"\r\n\r\n${safeMultipartText(value)}\r\n`,
      ),
    );
  }
  parts.push(
    asciiBytes(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeMultipartText(input.fileName)}"\r\nContent-Type: ${input.fileType}\r\n\r\n`,
    ),
    input.fileBytes,
    asciiBytes(`\r\n--${input.boundary}--\r\n`),
  );
  return concatBytes(parts);
}

async function uploadToPresignedUrl(
  metidos: MetidosPluginApi,
  presigned: PresignedUpload,
  file: { bytes: Uint8Array; name: string; type: string },
) {
  const boundary = `metidos-uploadthing-${Date.now().toString(36)}`;
  const response = await metidos.fetch(presigned.url, {
    body: multipartBody({
      boundary,
      fields: presigned.fields ?? {},
      fileBytes: file.bytes,
      fileName: file.name,
      fileType: file.type,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    method: "PUT",
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
    throw new Error(
      `UploadThing storage upload failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return { data, status: response.status, url: response.url };
}

function validateListFiles(input: unknown): ListFilesProps {
  const source = record(input);
  return {
    limit: numberField(source, "limit", {
      defaultValue: 500,
      min: 0,
      max: 100000,
    }),
    offset: numberField(source, "offset", {
      defaultValue: 0,
      min: 0,
      max: 1000000000,
    }),
  };
}

function validateGetFile(input: unknown): GetFileProps {
  const source = record(input);
  const fileKey = stringField(source, "fileKey", { maxLength: 300 });
  const customId =
    source.customId === null
      ? null
      : stringField(source, "customId", { maxLength: 128 });
  if (!fileKey && !customId) throw new Error("Provide fileKey or customId.");
  const fileName = stringField(source, "fileName", { maxLength: 300 });
  if (fileName && fileName !== basename(fileName)) {
    throw new Error(
      "fileName must be a file name, not a path. Use path for project-relative destinations.",
    );
  }
  return {
    customId,
    expiresIn: numberField(source, "expiresIn", {
      defaultValue: 3600,
      min: 1,
      max: 604800,
    }),
    fileKey,
    fileName,
    path:
      source.path === undefined || source.path === null
        ? undefined
        : normalizedProjectPath(source.path),
  };
}

function validateUploadFile(input: unknown): UploadFileProps {
  const source = record(input);
  const acl = stringField(source, "acl", {
    defaultValue: "public-read",
    maxLength: 20,
  });
  if (acl !== "public-read" && acl !== "private")
    throw new Error("acl must be public-read or private.");
  const contentDisposition = stringField(source, "contentDisposition", {
    defaultValue: "inline",
    maxLength: 20,
  });
  if (contentDisposition !== "inline" && contentDisposition !== "attachment") {
    throw new Error("contentDisposition must be inline or attachment.");
  }
  return {
    acl,
    contentDisposition,
    customId:
      source.customId === null
        ? null
        : stringField(source, "customId", { maxLength: 128 }),
    expiresIn: optionalNumberField(source, "expiresIn", {
      max: 604800,
      min: 1,
    }),
    metadata: source.metadata ?? null,
    path: normalizedProjectPath(source.path),
    slug: stringField(source, "slug", { maxLength: 128 }),
    type: stringField(source, "type", { maxLength: 120 }),
  };
}

function validateDeleteFile(input: unknown): DeleteFileProps {
  const source = record(input);
  const result = {
    customIds: stringList(source, "customIds"),
    fileKeys: stringList(source, "fileKeys"),
    files: stringList(source, "files"),
  };
  if (!result.customIds && !result.fileKeys && !result.files) {
    throw new Error(
      "Provide fileKeys, customIds, or deprecated files ids to delete.",
    );
  }
  return result;
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "list_files",
    name: "List UploadThing files",
    description:
      "List files in the configured UploadThing app. Parameters: optional limit number (default 500, max 100000) and optional offset number (default 0).",
    timeoutMs: 30_000,
    validateProps: validateListFiles,
    async action(_context, props) {
      const result = await uploadThingPost(metidos, "/v6/listFiles", props);
      return jsonResult(result);
    },
  });

  metidos.addAgentTool({
    tool: "get_file",
    name: "Download UploadThing file",
    description:
      "Download an UploadThing file into the current project. Parameters: provide fileKey string or customId string; optional fileName for a root-level output file, optional path project output path (defaults to ./<UploadThing filename>), and expiresIn number in seconds (default 3600, max 604800).",
    timeoutMs: 30_000,
    validateProps: validateGetFile,
    async action(_context, props) {
      const result = await uploadThingPost(
        metidos,
        "/v6/requestFileAccess",
        props,
      );
      const url = fileAccessUrl(result);
      const name = await getFileNameForResult(metidos, props);
      return await fileContentResult({
        fileName: props.fileName,
        metidos,
        name,
        path: props.path,
        url,
      });
    },
  });

  metidos.addAgentTool({
    tool: "upload_file",
    name: "Upload project file to UploadThing",
    description:
      "Upload a readable project file to UploadThing. Parameters: required path string starting with ./; optional acl (public-read or private), contentDisposition (inline or attachment), customId string, slug string, expiresIn number, metadata JSON value, and type MIME string.",
    timeoutMs: 30_000,
    validateProps: validateUploadFile,
    async action(_context, props) {
      const fs = fsApi(metidos);
      const stat = await fs.stat(props.path);
      const isFile = stat.kind === "file" || stat.isFile === true;
      if (!isFile || typeof stat.size !== "number" || stat.size < 0) {
        throw new Error(`${props.path} is not a readable file.`);
      }
      if (stat.size > MAX_TOOL_UPLOAD_BYTES) {
        throw new Error(
          `${props.path} is ${stat.size} bytes; this tool currently supports files up to ${MAX_TOOL_UPLOAD_BYTES} bytes because project bytes cross the Plugin System v1 RPC boundary before upload.`,
        );
      }
      const fileName = basename(props.path);
      const fileType = fileTypeFor(props.path, props.type);
      const prepared = await uploadThingPost(metidos, "/v7/prepareUpload", {
        acl: props.acl,
        contentDisposition: props.contentDisposition,
        customId: props.customId ?? undefined,
        expiresIn: props.expiresIn,
        fileName,
        fileSize: stat.size,
        fileType,
        slug: props.slug,
      });
      const fileBytes = await fs.read(props.path);
      const presigned = presignedUploadFromPrepareResponse(prepared);
      const uploaded = await uploadToPresignedUrl(metidos, presigned, {
        bytes: fileBytes,
        name: fileName,
        type: fileType,
      });
      return jsonResult({
        localFile: {
          name: fileName,
          path: props.path,
          size: stat.size,
          type: fileType,
        },
        prepared,
        presigned: { key: presigned.key, url: presigned.url },
        uploaded,
      });
    },
  });

  metidos.addAgentTool({
    tool: "delete_file",
    name: "Delete UploadThing file",
    description:
      "Delete UploadThing files. Parameters: provide at least one non-empty string array: fileKeys, customIds, or deprecated files legacy IDs.",
    timeoutMs: 30_000,
    validateProps: validateDeleteFile,
    async action(_context, props) {
      const result = await uploadThingPost(metidos, "/v6/deleteFiles", props);
      return jsonResult(result);
    },
  });
});
