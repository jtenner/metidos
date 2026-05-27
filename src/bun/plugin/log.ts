/**
 * @file src/bun/plugin/log.ts
 * @description Permissioned Plugin System v1 file logging helpers.
 */

import { appendFile, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import { resolvePluginManagedDirectoryPath } from "./inventory";

export const PLUGIN_LOG_WRITE_PERMISSION = "log:write";

export type PluginLogLevel = "debug" | "error" | "info" | "warn";

export type PluginLogSettings = {
  enabled: boolean;
  maxBytes?: number;
  retentionDays?: number;
};

export type PluginLogPruneSummary = {
  deletedBytes: number;
  deletedFiles: number;
  maxBytes: number;
  retainedBytes: number;
  retentionDays: number;
};

export type PluginLogRequest = {
  level: PluginLogLevel;
  message: string;
};

export type PluginLogWriteResult = {
  logged: boolean;
  path: string | null;
  pruning: PluginLogPruneSummary | null;
};

export type PluginLogBatchWriteResult = PluginLogWriteResult & {
  entries: number;
};

export class PluginLogError extends Error {
  readonly code: string;

  constructor(input: { cause?: unknown; code: string; message: string }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginLogError";
    this.code = input.code;
  }
}

export function assertPluginLogPermission(
  permissions: readonly string[],
): void {
  if (!permissions.includes(PLUGIN_LOG_WRITE_PERMISSION)) {
    throw new PluginLogError({
      code: "plugin_permission_error",
      message: "metidos.log requires log:write.",
    });
  }
}

function normalizePluginLogLevel(value: unknown): PluginLogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  throw new PluginLogError({
    code: "invalid_plugin_log_request",
    message: "metidos.log level must be debug, info, warn, or error.",
  });
}

function normalizePluginLogMessage(value: unknown): string {
  if (typeof value !== "string") {
    throw new PluginLogError({
      code: "invalid_plugin_log_request",
      message: "metidos.log message must be a string.",
    });
  }
  return value.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
}

export function normalizePluginLogRequest(value: unknown): PluginLogRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginLogError({
      code: "invalid_plugin_log_request",
      message: "metidos.log request must be an object.",
    });
  }
  const record = value as Record<string, unknown>;
  return {
    level: normalizePluginLogLevel(record.level),
    message: normalizePluginLogMessage(record.message),
  };
}

const DEFAULT_PLUGIN_LOG_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_PLUGIN_LOG_RETENTION_DAYS = 14;
const PLUGIN_LOG_FILE_DATE_PATTERN = /^log-(\d{4})-(\d{2})-(\d{2})\.log$/u;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type PluginLogPruneFile = {
  day: number | null;
  filePath: string;
  mtimeMs: number;
  relativePath: string;
  size: number;
};

function pluginLogFileName(now: Date): string {
  return `log-${now.toISOString().slice(0, 10)}.log`;
}

function normalizedPositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

function utcDayForDate(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      MILLISECONDS_PER_DAY,
  );
}

function utcDayFromPluginLogFileName(filePath: string): number | null {
  const match = basename(filePath).match(PLUGIN_LOG_FILE_DATE_PATTERN);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return Math.floor(timestamp / MILLISECONDS_PER_DAY);
}

async function collectPluginLogPruneFiles(
  directoryPath: string,
  relativePrefix = "",
): Promise<PluginLogPruneFile[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: PluginLogPruneFile[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = join(directoryPath, entry.name);
    const relativePath = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;
    const stat = await lstat(entryPath);
    if (stat.isDirectory()) {
      files.push(
        ...(await collectPluginLogPruneFiles(entryPath, relativePath)),
      );
      continue;
    }
    if (stat.isFile()) {
      files.push({
        day: utcDayFromPluginLogFileName(entry.name),
        filePath: entryPath,
        mtimeMs: stat.mtimeMs,
        relativePath,
        size: stat.size,
      });
    }
  }
  return files;
}

function comparePluginLogPruneFiles(
  left: PluginLogPruneFile,
  right: PluginLogPruneFile,
): number {
  const leftDay = left.day ?? Number.POSITIVE_INFINITY;
  const rightDay = right.day ?? Number.POSITIVE_INFINITY;
  if (leftDay !== rightDay) {
    return leftDay - rightDay;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return left.mtimeMs - right.mtimeMs;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

export async function prunePluginLogs(input: {
  logsPath: string;
  maxBytes?: number | undefined;
  now?: Date | undefined;
  retentionDays?: number | undefined;
}): Promise<PluginLogPruneSummary> {
  const now = input.now ?? new Date();
  const maxBytes = normalizedPositiveInteger(
    input.maxBytes,
    DEFAULT_PLUGIN_LOG_MAX_BYTES,
  );
  const retentionDays = normalizedPositiveInteger(
    input.retentionDays,
    DEFAULT_PLUGIN_LOG_RETENTION_DAYS,
  );
  const cutoffDay = utcDayForDate(now) - retentionDays;
  const files = await collectPluginLogPruneFiles(input.logsPath);
  const deletedPaths = new Set<string>();
  let deletedBytes = 0;
  let deletedFiles = 0;
  let retainedBytes = 0;

  for (const file of files) {
    if (file.day !== null && file.day < cutoffDay) {
      await unlink(file.filePath);
      deletedPaths.add(file.filePath);
      deletedBytes += file.size;
      deletedFiles += 1;
      continue;
    }
    retainedBytes += file.size;
  }

  if (retainedBytes > maxBytes) {
    const retainedFiles = files
      .filter((file) => !deletedPaths.has(file.filePath))
      .sort(comparePluginLogPruneFiles);
    for (const file of retainedFiles) {
      if (retainedBytes <= maxBytes) {
        break;
      }
      await unlink(file.filePath);
      deletedPaths.add(file.filePath);
      deletedBytes += file.size;
      deletedFiles += 1;
      retainedBytes -= file.size;
    }
  }

  return {
    deletedBytes,
    deletedFiles,
    maxBytes,
    retainedBytes,
    retentionDays,
  };
}

export async function executePluginLogBatchOperation(input: {
  now?: Date;
  params: unknown;
  permissions: readonly string[];
  pluginPath: string;
  settings?: PluginLogSettings | null;
}): Promise<PluginLogBatchWriteResult> {
  assertPluginLogPermission(input.permissions);
  const record = input.params;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new PluginLogError({
      code: "invalid_plugin_log_request",
      message: "metidos.log batch request must be an object.",
    });
  }
  const entriesValue = (record as { entries?: unknown }).entries;
  if (!Array.isArray(entriesValue)) {
    throw new PluginLogError({
      code: "invalid_plugin_log_request",
      message: "metidos.log batch entries must be an array.",
    });
  }
  const requests = entriesValue.map((entry) =>
    normalizePluginLogRequest(entry),
  );
  if (requests.length === 0 || input.settings?.enabled !== true) {
    return {
      entries: requests.length,
      logged: false,
      path: null,
      pruning: null,
    };
  }

  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const logsPath = resolvePluginManagedDirectoryPath(input.pluginPath, ".logs");
  await mkdir(logsPath, { recursive: true });
  const logPath = join(logsPath, pluginLogFileName(now));
  await appendFile(
    logPath,
    `${requests
      .map(
        (request) => `[${request.level}] [${timestamp}] : [${request.message}]`,
      )
      .join("\n")}\n`,
    "utf8",
  );
  const pruning = await prunePluginLogs({
    logsPath,
    maxBytes: input.settings.maxBytes,
    now,
    retentionDays: input.settings.retentionDays,
  });
  return { entries: requests.length, logged: true, path: logPath, pruning };
}

export async function executePluginLogOperation(input: {
  now?: Date;
  params: unknown;
  permissions: readonly string[];
  pluginPath: string;
  settings?: PluginLogSettings | null;
}): Promise<PluginLogWriteResult> {
  const result = await executePluginLogBatchOperation({
    ...input,
    params: { entries: [input.params] },
  });
  return { logged: result.logged, path: result.path, pruning: result.pruning };
}
