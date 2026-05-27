/**
 * @file src/bun/plugin/lancedb.ts
 * @description Plugin System v1 host operations for metidos.lancedb.
 */

import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  deleteLanceDbRecord,
  queryLanceDbRecords,
  upsertLanceDbRecords,
  type LanceDbRecordId,
} from "../pi/lancedb-store";
import { PluginPermissionError } from "./context";
import {
  calculatePluginDataQuotaUsage,
  PluginDataQuotaError,
  type PluginDataQuotaSettings,
} from "./data";
import { resolvePluginFsVirtualPath } from "./fs-path";

export const PLUGIN_LANCEDB_PERMISSION = "metidos:lancedb";
export const PLUGIN_LANCEDB_STORAGE_WRITE_PERMISSION = "storage:write";
export const PLUGIN_LANCEDB_STORE_FILE_NAME = "metidos-lancedb.json";

const MAX_PLUGIN_LANCEDB_NUMERIC_ID = Number.MAX_SAFE_INTEGER - 1;
const MAX_PLUGIN_LANCEDB_SNAPSHOT_BYTES = 10 * 1024 * 1024;

const DEFAULT_PLUGIN_LANCEDB_QUOTA: PluginDataQuotaSettings = {
  maxDataBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 10_000,
};

export type PluginLanceDbOperation =
  | "lancedb.delete"
  | "lancedb.query"
  | "lancedb.upsert";

export function isPluginLanceDbOperation(
  value: string,
): value is PluginLanceDbOperation {
  return (
    value === "lancedb.delete" ||
    value === "lancedb.query" ||
    value === "lancedb.upsert"
  );
}

export function assertPluginLanceDbPermission(
  permissions: readonly string[],
): void {
  for (const permission of [
    PLUGIN_LANCEDB_PERMISSION,
    PLUGIN_LANCEDB_STORAGE_WRITE_PERMISSION,
  ]) {
    if (!permissions.includes(permission)) {
      throw new PluginPermissionError({
        message: `metidos.lancedb requires ${permission}.`,
        permission,
      });
    }
  }
}

function objectParam(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LanceDB request must be an object.");
  }
  return value as Record<string, unknown>;
}

function stringParam(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`LanceDB ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function idParam(value: unknown): LanceDbRecordId {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PLUGIN_LANCEDB_NUMERIC_ID
  ) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new Error(
    "LanceDB id must be a safe positive integer or non-empty string.",
  );
}

async function pluginLanceDbStoreFile(input: {
  path: string;
  pluginPath: string;
}): Promise<string> {
  if (!input.path.startsWith("~/")) {
    throw new Error("metidos.lancedb is scoped to plugin data ~/ paths.");
  }
  const resolved = await resolvePluginFsVirtualPath({
    access: "write",
    pluginPath: input.pluginPath,
    virtualPath: input.path,
  });
  return join(resolved.absolutePath, PLUGIN_LANCEDB_STORE_FILE_NAME);
}

type PluginLanceDbStoreSnapshot =
  | { contents: string; existed: true }
  | { existed: false };

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function snapshotPluginLanceDbStoreFile(
  filePath: string,
): Promise<PluginLanceDbStoreSnapshot> {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Plugin LanceDB store file must not be a symbolic link.");
    }
    if (stat.size > MAX_PLUGIN_LANCEDB_SNAPSHOT_BYTES) {
      throw new Error(
        `Plugin LanceDB store snapshots are limited to ${MAX_PLUGIN_LANCEDB_SNAPSHOT_BYTES} bytes.`,
      );
    }
    return { contents: await readFile(filePath, "utf8"), existed: true };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { existed: false };
    }
    throw error;
  }
}

async function restorePluginLanceDbStoreFile(input: {
  filePath: string;
  snapshot: PluginLanceDbStoreSnapshot;
}): Promise<void> {
  if (input.snapshot.existed) {
    try {
      const stat = await lstat(input.filePath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          "Plugin LanceDB store file must not be a symbolic link.",
        );
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    await writeFile(input.filePath, input.snapshot.contents, "utf8");
    return;
  }
  await rm(input.filePath, { force: true });
}

async function assertPluginLanceDbQuota(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
}): Promise<void> {
  const usage = await calculatePluginDataQuotaUsage({
    pluginPath: input.pluginPath,
  });
  if (
    usage.bytes > input.quota.maxDataBytes ||
    usage.files > input.quota.maxFiles ||
    usage.largestFileBytes > input.quota.maxFileBytes
  ) {
    throw new PluginDataQuotaError({
      attempted: Math.max(usage.bytes, usage.files, usage.largestFileBytes),
      code: "plugin_data_quota_exceeded",
      limit: Math.max(
        input.quota.maxDataBytes,
        input.quota.maxFiles,
        input.quota.maxFileBytes,
      ),
      message: "Plugin LanceDB operation exceeds the plugin data quota.",
    });
  }
}

export async function executePluginLanceDbOperation(input: {
  operation: PluginLanceDbOperation;
  params: unknown;
  permissions: readonly string[];
  pluginPath: string;
  quota?: PluginDataQuotaSettings;
}): Promise<unknown> {
  assertPluginLanceDbPermission(input.permissions);
  const params = objectParam(input.params);
  const filePath = await pluginLanceDbStoreFile({
    path: stringParam(params.path, "path"),
    pluginPath: input.pluginPath,
  });
  if (input.operation === "lancedb.upsert") {
    const rows = Array.isArray(params.rows)
      ? params.rows
      : params.props === undefined
        ? []
        : [params.props];
    const snapshot = await snapshotPluginLanceDbStoreFile(filePath);
    const result = await upsertLanceDbRecords({ filePath, rows });
    try {
      await assertPluginLanceDbQuota({
        pluginPath: input.pluginPath,
        quota: input.quota ?? DEFAULT_PLUGIN_LANCEDB_QUOTA,
      });
    } catch (error) {
      await restorePluginLanceDbStoreFile({ filePath, snapshot }).catch(
        () => undefined,
      );
      throw error;
    }
    return result;
  }
  if (input.operation === "lancedb.query") {
    return queryLanceDbRecords({
      filePath,
      ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      vector: params.vector,
    });
  }
  return deleteLanceDbRecord({
    filePath,
    id: idParam(params.id),
  });
}
