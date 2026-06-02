/**
 * @file src/bun/plugin/sqlite.ts
 * @description Permissioned Plugin System v1 SQLite host API scoped to plugin .data.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PluginPermissionError } from "./context";
import { splitTopLevelSqlStatements } from "../sql-statement-split";
import {
  calculatePluginDataQuotaUsage,
  PluginDataQuotaError,
  type PluginDataQuotaSettings,
  withPluginDataQuotaLock,
} from "./data";
import {
  pruneLruMapToMaxEntries,
  readLruMapValue,
  writeLruMapValue,
} from "../lru-map";
import { resolvePluginFsVirtualPath } from "./fs-path";

export const PLUGIN_SQLITE_PERMISSION = "sqlite";
export const PLUGIN_SQLITE_STORAGE_WRITE_PERMISSION = "storage:write";
export const PLUGIN_SQLITE_NATIVE_SECURITY_MODE_ENV =
  "METIDOS_PLUGIN_SQLITE_SECURITY_EXTENSION";

const DEFAULT_PLUGIN_SQLITE_QUOTA: PluginDataQuotaSettings = {
  maxDataBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 10_000,
};
const MAX_PLUGIN_SQLITE_ALL_ROWS = 1_000;
const MAX_PLUGIN_SQLITE_ALL_RESULT_BYTES = 1024 * 1024;
const MAX_PLUGIN_SQLITE_GET_RESULT_BYTES = 1024 * 1024;
const PLUGIN_SQLITE_CONNECTION_IDLE_MS = 30_000;
const MAX_PLUGIN_SQLITE_CONNECTIONS = 64;
const PLUGIN_SQLITE_QUOTA_SAVEPOINT_NAME = "metidos_plugin_quota_guard";
const PLUGIN_SQLITE_QUOTA_FULL_SCAN_WRITE_INTERVAL = 8;

const pluginSqliteModuleDirectory = dirname(fileURLToPath(import.meta.url));

export type PluginSqliteNativeSecurityStatus =
  | "disabled"
  | "failed"
  | "loaded"
  | "missing";

export type PluginSqliteNativeSecurityDiagnostic = {
  action: string | null;
  arch: NodeJS.Architecture;
  checkedAt: string;
  extensionPath: string | null;
  message: string;
  mode: "disabled" | "optional";
  platform: NodeJS.Platform;
  severity: "info" | "warning";
  status: PluginSqliteNativeSecurityStatus;
  target: string | null;
};

type PluginSqliteNativeSecurityTarget = {
  extension: "dll" | "dylib" | "so";
  triple: string;
};

let pluginSqliteNativeSecurityDiagnostic: PluginSqliteNativeSecurityDiagnostic | null =
  null;

export type PluginSqliteOperation = "sqlite.all" | "sqlite.get" | "sqlite.run";

export type PluginSqliteBindings =
  | readonly PluginSqliteBindingValue[]
  | Readonly<Record<string, PluginSqliteBindingValue>>;

export type PluginSqliteBindingValue = boolean | null | number | string;

export type PluginSqliteRunResult = {
  changes: number;
  lastInsertRowid: number | string;
};

export type PluginSqliteAllResult = {
  rows: Array<Record<string, PluginSqliteResultValue>>;
};

export type PluginSqliteGetResult = {
  row: Record<string, PluginSqliteResultValue> | null;
};

export type PluginSqliteResultValue =
  | boolean
  | null
  | number
  | string
  | { bytes: number[]; type: "blob" };

export class PluginSqliteError extends Error {
  readonly code: string;
  readonly virtualPath: string | null;

  constructor(input: {
    cause?: unknown;
    code: string;
    message: string;
    virtualPath?: string | null;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginSqliteError";
    this.code = input.code;
    this.virtualPath = input.virtualPath ?? null;
  }
}

export function isPluginSqliteOperation(
  value: string,
): value is PluginSqliteOperation {
  return (
    value === "sqlite.all" || value === "sqlite.get" || value === "sqlite.run"
  );
}

export function assertPluginSqlitePermission(input: {
  permissions: readonly string[];
  virtualPath?: string | null;
}): void {
  if (!input.permissions.includes(PLUGIN_SQLITE_PERMISSION)) {
    throw new PluginPermissionError({
      code: "plugin_permission_error",
      message: "metidos.sqlite requires sqlite permission.",
      permission: PLUGIN_SQLITE_PERMISSION,
    });
  }
  if (!input.permissions.includes(PLUGIN_SQLITE_STORAGE_WRITE_PERMISSION)) {
    throw new PluginPermissionError({
      code: "plugin_permission_error",
      message: "metidos.sqlite requires storage:write permission.",
      permission: PLUGIN_SQLITE_STORAGE_WRITE_PERMISSION,
    });
  }
}

function sqliteError(input: {
  cause?: unknown;
  code: string;
  message: string;
  virtualPath?: string | null;
}): PluginSqliteError {
  return new PluginSqliteError(input);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw sqliteError({
      code: "invalid_plugin_sqlite_request",
      message: `${label} must be an object.`,
    });
  }
  return value as Record<string, unknown>;
}

function optionalRecordValue(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  return recordValue(value, "Plugin SQLite request");
}

function requiredStringField(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw sqliteError({
    code: "invalid_plugin_sqlite_request",
    message: `Plugin SQLite request requires a non-empty ${key} string.`,
  });
}

function isBindingValue(value: unknown): value is PluginSqliteBindingValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function normalizeBindings(value: unknown): SQLQueryBindings[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    for (const [index, binding] of value.entries()) {
      if (!isBindingValue(binding)) {
        throw sqliteError({
          code: "invalid_plugin_sqlite_request",
          message: `Plugin SQLite binding at index ${index} must be a string, number, boolean, or null.`,
        });
      }
    }
    return value as SQLQueryBindings[];
  }
  if (typeof value === "object") {
    const normalized: Record<string, PluginSqliteBindingValue> = {};
    for (const [key, binding] of Object.entries(value)) {
      if (!isBindingValue(binding)) {
        throw sqliteError({
          code: "invalid_plugin_sqlite_request",
          message: `Plugin SQLite binding ${key} must be a string, number, boolean, or null.`,
        });
      }
      normalized[key] = binding;
    }
    return [normalized as SQLQueryBindings];
  }
  throw sqliteError({
    code: "invalid_plugin_sqlite_request",
    message: "Plugin SQLite bindings must be an array or object when provided.",
  });
}

function requireSingleStatement(statement: string): string {
  const statements = splitTopLevelSqlStatements(statement);
  if (statements.length === 0) {
    throw sqliteError({
      code: "invalid_plugin_sqlite_statement",
      message: "Plugin SQLite statement is required.",
    });
  }
  if (statements.length > 1) {
    throw sqliteError({
      code: "invalid_plugin_sqlite_statement",
      message: "Plugin SQLite accepts exactly one statement per operation.",
    });
  }
  return statements[0] ?? "";
}

function pluginSqliteNativeSecurityMode(): "disabled" | "optional" {
  const value = process.env[PLUGIN_SQLITE_NATIVE_SECURITY_MODE_ENV]
    ?.trim()
    .toLowerCase();
  return value === "0" ||
    value === "disabled" ||
    value === "false" ||
    value === "off"
    ? "disabled"
    : "optional";
}

function getPluginSqliteSecurityTarget(): PluginSqliteNativeSecurityTarget | null {
  if (process.platform === "linux") {
    return process.arch === "arm64"
      ? { extension: "so", triple: "aarch64-linux-gnu" }
      : { extension: "so", triple: "x86_64-linux-gnu" };
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? { extension: "dylib", triple: "aarch64-macos" }
      : { extension: "dylib", triple: "x86_64-macos" };
  }
  if (process.platform === "win32") {
    return { extension: "dll", triple: "x86_64-windows-gnu" };
  }
  return null;
}

function getPluginSqliteSecurityExtensionPath(
  target: PluginSqliteNativeSecurityTarget,
): string {
  return join(
    pluginSqliteModuleDirectory,
    "..",
    "..",
    "..",
    "native",
    "sqlite-security-extension",
    "dist",
    target.triple,
    `metidos_sqlite_security.${target.extension}`,
  );
}

function describePluginSqliteNativeSecurityStatus(input: {
  mode: "disabled" | "optional";
  status: PluginSqliteNativeSecurityStatus;
}): { action: string | null; severity: "info" | "warning" } {
  if (input.status === "loaded") {
    return { action: null, severity: "info" };
  }
  if (input.status === "disabled") {
    return {
      action:
        "No action required when this deployment intentionally disables the native extension; TypeScript SQL guards remain active.",
      severity: "info",
    };
  }
  if (input.status === "failed") {
    return {
      action:
        "Rebuild or reinstall the native plugin SQLite security extension for this platform, or disable it explicitly if the degraded posture is intentional.",
      severity: "warning",
    };
  }
  return {
    action:
      "Build or install the native plugin SQLite security extension for this platform, or disable it explicitly if the degraded posture is intentional.",
    severity: input.mode === "disabled" ? "info" : "warning",
  };
}

export function createPluginSqliteNativeSecurityDiagnostic(input: {
  arch?: NodeJS.Architecture;
  checkedAt?: string;
  extensionPath: string | null;
  message: string;
  mode: "disabled" | "optional";
  platform?: NodeJS.Platform;
  status: PluginSqliteNativeSecurityStatus;
  target: PluginSqliteNativeSecurityTarget | string | null;
}): PluginSqliteNativeSecurityDiagnostic {
  const posture = describePluginSqliteNativeSecurityStatus(input);
  return {
    action: posture.action,
    arch: input.arch ?? process.arch,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    extensionPath: input.extensionPath,
    message: input.message,
    mode: input.mode,
    platform: input.platform ?? process.platform,
    severity: posture.severity,
    status: input.status,
    target:
      typeof input.target === "string"
        ? input.target
        : (input.target?.triple ?? null),
  };
}

function setPluginSqliteNativeSecurityDiagnostic(input: {
  extensionPath: string | null;
  message: string;
  mode: "disabled" | "optional";
  status: PluginSqliteNativeSecurityStatus;
  target: PluginSqliteNativeSecurityTarget | null;
}): PluginSqliteNativeSecurityDiagnostic {
  pluginSqliteNativeSecurityDiagnostic =
    createPluginSqliteNativeSecurityDiagnostic(input);
  return pluginSqliteNativeSecurityDiagnostic;
}

export function resetPluginSqliteNativeSecurityDiagnosticForTest(): void {
  pluginSqliteNativeSecurityDiagnostic = null;
}

export function getPluginSqliteNativeSecurityDiagnostic(): PluginSqliteNativeSecurityDiagnostic {
  if (pluginSqliteNativeSecurityDiagnostic) {
    return pluginSqliteNativeSecurityDiagnostic;
  }

  const mode = pluginSqliteNativeSecurityMode();
  const target = getPluginSqliteSecurityTarget();
  if (mode === "disabled") {
    return setPluginSqliteNativeSecurityDiagnostic({
      extensionPath: null,
      message: `${PLUGIN_SQLITE_NATIVE_SECURITY_MODE_ENV} disables the native plugin SQLite security extension. TypeScript SQL guards remain active.`,
      mode,
      status: "disabled",
      target,
    });
  }

  if (!target) {
    return setPluginSqliteNativeSecurityDiagnostic({
      extensionPath: null,
      message: `No native plugin SQLite security extension target is available for ${process.platform}/${process.arch}. TypeScript SQL guards remain active.`,
      mode,
      status: "missing",
      target,
    });
  }

  const extensionPath = getPluginSqliteSecurityExtensionPath(target);
  if (!existsSync(extensionPath)) {
    return setPluginSqliteNativeSecurityDiagnostic({
      extensionPath,
      message:
        "Native plugin SQLite security extension artifact is missing. TypeScript SQL guards remain active.",
      mode,
      status: "missing",
      target,
    });
  }

  return setPluginSqliteNativeSecurityDiagnostic({
    extensionPath,
    message:
      "Native plugin SQLite security extension artifact is present but has not been loaded yet.",
    mode,
    status: "missing",
    target,
  });
}

export function refreshPluginSqliteNativeSecurityDiagnostic(): PluginSqliteNativeSecurityDiagnostic {
  const current = getPluginSqliteNativeSecurityDiagnostic();
  if (current.status === "disabled" || current.status === "loaded") {
    return current;
  }
  if (!current.extensionPath || !existsSync(current.extensionPath)) {
    pluginSqliteNativeSecurityDiagnostic = null;
    return getPluginSqliteNativeSecurityDiagnostic();
  }

  const database = new Database(":memory:");
  try {
    database.loadExtension(
      current.extensionPath,
      "sqlite3_metidossqlitesecurity_init",
    );
    return setPluginSqliteNativeSecurityDiagnostic({
      extensionPath: current.extensionPath,
      message: "Native plugin SQLite security extension loaded successfully.",
      mode: current.mode,
      status: "loaded",
      target: getPluginSqliteSecurityTarget(),
    });
  } catch (error) {
    return setPluginSqliteNativeSecurityDiagnostic({
      extensionPath: current.extensionPath,
      message: `Native plugin SQLite security extension failed to load: ${error instanceof Error ? error.message : String(error)}`,
      mode: current.mode,
      status: "failed",
      target: getPluginSqliteSecurityTarget(),
    });
  } finally {
    database.close(false);
  }
}

function loadPluginSqliteSecurityExtension(database: Database): void {
  const diagnostic = getPluginSqliteNativeSecurityDiagnostic();
  if (diagnostic.status === "disabled") {
    return;
  }
  if (!diagnostic.extensionPath || !existsSync(diagnostic.extensionPath)) {
    return;
  }

  try {
    database.loadExtension(
      diagnostic.extensionPath,
      "sqlite3_metidossqlitesecurity_init",
    );
    setPluginSqliteNativeSecurityDiagnostic({
      extensionPath: diagnostic.extensionPath,
      message: "Native plugin SQLite security extension loaded successfully.",
      mode: diagnostic.mode,
      status: "loaded",
      target: getPluginSqliteSecurityTarget(),
    });
  } catch (error) {
    setPluginSqliteNativeSecurityDiagnostic({
      extensionPath: diagnostic.extensionPath,
      message: `Native plugin SQLite security extension failed to load: ${error instanceof Error ? error.message : String(error)}`,
      mode: diagnostic.mode,
      status: "failed",
      target: getPluginSqliteSecurityTarget(),
    });
    throw sqliteError({
      cause: error,
      code: "plugin_sqlite_security_extension_failed",
      message: "Plugin SQLite security extension could not be loaded.",
    });
  }
}

function isSqlIdentifierStart(character: string): boolean {
  return /[A-Za-z_]/u.test(character);
}

function isSqlIdentifierPart(character: string): boolean {
  return /[0-9A-Za-z_$]/u.test(character);
}

function skipSqlWhitespaceAndComments(sql: string, startIndex: number): number {
  let index = startIndex;

  while (index < sql.length) {
    const character = sql[index] ?? "";
    const nextCharacter = sql[index + 1] ?? "";

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      const newlineIndex = sql.indexOf("\n", index + 2);
      index = newlineIndex === -1 ? sql.length : newlineIndex + 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const endIndex = sql.indexOf("*/", index + 2);
      index = endIndex === -1 ? sql.length : endIndex + 2;
      continue;
    }

    break;
  }

  return index;
}

function readSqlIdentifier(
  sql: string,
  startIndex: number,
): { nextIndex: number; value: string } | null {
  const firstCharacter = sql[startIndex] ?? "";
  if (!isSqlIdentifierStart(firstCharacter)) {
    return null;
  }

  let index = startIndex + 1;
  while (index < sql.length && isSqlIdentifierPart(sql[index] ?? "")) {
    index += 1;
  }

  return { nextIndex: index, value: sql.slice(startIndex, index) };
}

function getFirstSqlIdentifier(
  sql: string,
): { nextIndex: number; value: string } | null {
  const index = skipSqlWhitespaceAndComments(sql, 0);
  return readSqlIdentifier(sql, index);
}

function skipSqlQuotedToken(sql: string, startIndex: number): number {
  const quote = sql[startIndex] ?? "";
  const closingQuote = quote === "[" ? "]" : quote;
  let index = startIndex + 1;

  while (index < sql.length) {
    const character = sql[index] ?? "";
    const nextCharacter = sql[index + 1] ?? "";
    if (character === closingQuote) {
      if (
        closingQuote !== "]" &&
        closingQuote !== "`" &&
        nextCharacter === closingQuote
      ) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }

  return index;
}

function readSqlQuotedIdentifier(
  sql: string,
  startIndex: number,
): { nextIndex: number; value: string } | null {
  const quote = sql[startIndex] ?? "";
  if (quote !== '"' && quote !== "`" && quote !== "[") {
    return null;
  }

  const closingQuote = quote === "[" ? "]" : quote;
  const nextIndex = skipSqlQuotedToken(sql, startIndex);
  if (nextIndex > sql.length || sql[nextIndex - 1] !== closingQuote) {
    return null;
  }

  const quotedValue = sql.slice(startIndex + 1, nextIndex - 1);
  const escapedClosingQuote = `${closingQuote}${closingQuote}`;
  const value =
    closingQuote === "]"
      ? quotedValue
      : quotedValue.replaceAll(escapedClosingQuote, closingQuote);
  return { nextIndex, value };
}

function findSqlIdentifier(
  sql: string,
  startIndex: number,
  expectedIdentifier: string,
): { nextIndex: number } | null {
  let index = startIndex;

  while (index < sql.length) {
    index = skipSqlWhitespaceAndComments(sql, index);
    const character = sql[index] ?? "";

    if (character === "'") {
      index = skipSqlQuotedToken(sql, index);
      continue;
    }

    const quotedIdentifier = readSqlQuotedIdentifier(sql, index);
    if (quotedIdentifier) {
      if (quotedIdentifier.value.toLowerCase() === expectedIdentifier) {
        return { nextIndex: quotedIdentifier.nextIndex };
      }
      index = quotedIdentifier.nextIndex;
      continue;
    }

    const identifier = readSqlIdentifier(sql, index);
    if (identifier) {
      if (identifier.value.toLowerCase() === expectedIdentifier) {
        return { nextIndex: identifier.nextIndex };
      }
      index = identifier.nextIndex;
      continue;
    }

    index += 1;
  }

  return null;
}

function containsSqlFunctionCall(sql: string, functionName: string): boolean {
  let searchIndex = 0;

  while (true) {
    const match = findSqlIdentifier(sql, searchIndex, functionName);
    if (!match) {
      return false;
    }
    const nextIndex = skipSqlWhitespaceAndComments(sql, match.nextIndex);
    if ((sql[nextIndex] ?? "") === "(") {
      return true;
    }
    searchIndex = match.nextIndex;
  }
}

function assertSqliteStatementAllowed(statementText: string): void {
  // sqlite.run intentionally lets plugins own the schema and contents of their
  // own ~/ SQLite database, including CREATE TRIGGER, CREATE VIRTUAL TABLE, and
  // DROP. The guard below blocks statements that can escape that database,
  // affect host-controlled transaction/quota boundaries, or load native code.
  const firstIdentifier = getFirstSqlIdentifier(statementText);
  const firstKeyword = firstIdentifier?.value.toLowerCase() ?? "";

  if (firstKeyword === "attach") {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: "ATTACH is not allowed in plugin SQLite.",
    });
  }

  if (firstKeyword === "detach") {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: "DETACH is not allowed in plugin SQLite.",
    });
  }

  if (
    firstKeyword === "begin" ||
    firstKeyword === "commit" ||
    firstKeyword === "rollback" ||
    firstKeyword === "savepoint" ||
    firstKeyword === "release"
  ) {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message:
        "Transaction-control statements are not allowed in plugin SQLite.",
    });
  }

  if (
    firstKeyword === "vacuum" &&
    firstIdentifier &&
    findSqlIdentifier(statementText, firstIdentifier.nextIndex, "into")
  ) {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: "VACUUM INTO is not allowed in plugin SQLite.",
    });
  }

  if (containsSqlFunctionCall(statementText, "load_extension")) {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: "load_extension() is not allowed in plugin SQLite.",
    });
  }

  if (firstKeyword === "pragma") {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: "PRAGMA is not allowed in plugin SQLite run statements.",
    });
  }
}

async function resolvePluginSqliteDatabasePath(input: {
  pluginPath: string;
  virtualPath: string;
}): Promise<{ realPath: string; virtualPath: string }> {
  if (
    input.virtualPath === ":memory:" ||
    input.virtualPath.startsWith("file:")
  ) {
    throw sqliteError({
      code: "invalid_plugin_sqlite_path",
      message: "Plugin SQLite paths must use plugin ~/ data paths.",
      virtualPath: input.virtualPath,
    });
  }
  if (input.virtualPath === "~" || input.virtualPath === "~/") {
    throw sqliteError({
      code: "invalid_plugin_sqlite_path",
      message: "Plugin SQLite path must name a database file under ~/.",
      virtualPath: input.virtualPath,
    });
  }

  try {
    const resolved = await resolvePluginFsVirtualPath({
      access: "write",
      pluginPath: input.pluginPath,
      virtualPath: input.virtualPath,
    });
    if (resolved.rootKind !== "pluginData") {
      throw sqliteError({
        code: "invalid_plugin_sqlite_path",
        message:
          "Plugin SQLite paths must use plugin ~/ data paths, not ./ project paths.",
        virtualPath: resolved.virtualPath,
      });
    }
    return { realPath: resolved.realPath, virtualPath: resolved.virtualPath };
  } catch (error) {
    if (error instanceof PluginSqliteError) {
      throw error;
    }
    throw sqliteError({
      code:
        error instanceof Error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "invalid_plugin_sqlite_path",
      message:
        error instanceof Error
          ? error.message.replaceAll(input.pluginPath, "<plugin>")
          : "Plugin SQLite path could not be resolved.",
      virtualPath: input.virtualPath,
    });
  }
}

function assertPluginSqliteResultValueWithinLimit(input: {
  byteLength: number;
  limitBytes: number;
  operation: "sqlite.all" | "sqlite.get";
  virtualPath: string;
}): void {
  if (input.byteLength <= input.limitBytes) {
    return;
  }
  throw sqliteError({
    code: "plugin_sqlite_result_limit_exceeded",
    message: `Plugin SQLite ${input.operation} result is too large.`,
    virtualPath: input.virtualPath,
  });
}

type PluginSqliteResultSizeTracker = {
  addJsonValue(value: PluginSqliteResultValue): void;
  addRawJsonBytes(byteLength: number): void;
};

function createPluginSqliteResultSizeTracker(input: {
  limitBytes: number;
  operation: "sqlite.all" | "sqlite.get";
  virtualPath: string;
}): PluginSqliteResultSizeTracker {
  let byteLength = 0;
  const addRawJsonBytes = (nextBytes: number): void => {
    byteLength += nextBytes;
    assertPluginSqliteResultValueWithinLimit({
      byteLength,
      limitBytes: input.limitBytes,
      operation: input.operation,
      virtualPath: input.virtualPath,
    });
  };
  return {
    addJsonValue(value) {
      addRawJsonBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
    },
    addRawJsonBytes,
  };
}

function normalizeResultValue(
  value: unknown,
  input: {
    limitBytes: number;
    operation: "sqlite.all" | "sqlite.get";
    virtualPath: string;
  },
): PluginSqliteResultValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    assertPluginSqliteResultValueWithinLimit({
      byteLength: Buffer.byteLength(value, "utf8"),
      limitBytes: input.limitBytes,
      operation: input.operation,
      virtualPath: input.virtualPath,
    });
    return value;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value instanceof Uint8Array) {
    assertPluginSqliteResultValueWithinLimit({
      byteLength: value.byteLength,
      limitBytes: input.limitBytes,
      operation: input.operation,
      virtualPath: input.virtualPath,
    });
    return { bytes: Array.from(value), type: "blob" };
  }
  if (value instanceof ArrayBuffer) {
    assertPluginSqliteResultValueWithinLimit({
      byteLength: value.byteLength,
      limitBytes: input.limitBytes,
      operation: input.operation,
      virtualPath: input.virtualPath,
    });
    return { bytes: Array.from(new Uint8Array(value)), type: "blob" };
  }
  const stringValue = String(value);
  assertPluginSqliteResultValueWithinLimit({
    byteLength: Buffer.byteLength(stringValue, "utf8"),
    limitBytes: input.limitBytes,
    operation: input.operation,
    virtualPath: input.virtualPath,
  });
  return stringValue;
}

function normalizeRow(
  row: Record<string, unknown>,
  input: {
    limitBytes: number;
    operation: "sqlite.all" | "sqlite.get";
    sizeTracker?: PluginSqliteResultSizeTracker;
    virtualPath: string;
  },
): Record<string, PluginSqliteResultValue> {
  const normalized: Record<string, PluginSqliteResultValue> = {};
  input.sizeTracker?.addRawJsonBytes(1); // {
  let firstColumn = true;
  for (const [key, value] of Object.entries(row)) {
    const normalizedValue = normalizeResultValue(value, input);
    normalized[key] = normalizedValue;
    if (!firstColumn) {
      input.sizeTracker?.addRawJsonBytes(1); // ,
    }
    input.sizeTracker?.addRawJsonBytes(
      Buffer.byteLength(JSON.stringify(key), "utf8") + 1,
    ); // key:
    input.sizeTracker?.addJsonValue(normalizedValue);
    firstColumn = false;
  }
  input.sizeTracker?.addRawJsonBytes(1); // }
  return normalized;
}

function normalizeRunLastInsertRowid(value: unknown): number | string {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : String(value ?? "0");
}

const READ_QUERY_DISALLOWED_IDENTIFIERS = new Set([
  "alter",
  "attach",
  "begin",
  "commit",
  "create",
  "delete",
  "detach",
  "drop",
  "insert",
  "pragma",
  "reindex",
  "release",
  "replace",
  "rollback",
  "savepoint",
  "update",
  "vacuum",
]);

function containsSqlIdentifierFromSet(
  sql: string,
  identifiers: ReadonlySet<string>,
): boolean {
  let index = 0;
  while (index < sql.length) {
    index = skipSqlWhitespaceAndComments(sql, index);
    const character = sql[index] ?? "";
    if (
      character === "'" ||
      character === '"' ||
      character === "`" ||
      character === "["
    ) {
      index = skipSqlQuotedToken(sql, index);
      continue;
    }

    const identifier = readSqlIdentifier(sql, index);
    if (identifier) {
      if (identifiers.has(identifier.value.toLowerCase())) {
        return true;
      }
      index = identifier.nextIndex;
      continue;
    }
    index += 1;
  }
  return false;
}

function assertReadStatement(
  statementText: string,
  operation: "sqlite.all" | "sqlite.get",
): void {
  // The read guard intentionally keeps the first-keyword check and disallowed
  // identifier scan separate. This path only runs once per plugin SQLite call,
  // and separate helpers keep diagnostics focused; consolidate tokenization only
  // if profiling shows SQL validation becoming hot. The identifier scan skips
  // strings, comments, and quoted identifiers so plugins may read their own
  // quoted schema names, while unquoted mutating tokens in CTEs/subqueries are
  // rejected before SQLite can execute a side effect.
  const firstKeyword =
    getFirstSqlIdentifier(statementText)?.value.toLowerCase() ?? "";
  if (firstKeyword !== "select" && firstKeyword !== "with") {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: `${operation} only supports SELECT statements.`,
    });
  }
  if (
    containsSqlIdentifierFromSet(
      statementText,
      READ_QUERY_DISALLOWED_IDENTIFIERS,
    )
  ) {
    throw sqliteError({
      code: "disallowed_plugin_sqlite_statement",
      message: `${operation} only supports read-only SELECT statements.`,
    });
  }
}

function cappedAllStatementText(statementText: string): string {
  return `SELECT * FROM (${statementText}) LIMIT ${MAX_PLUGIN_SQLITE_ALL_ROWS + 1}`;
}

function normalizeCappedRows(
  rows: Array<Record<string, unknown>>,
  virtualPath: string,
): Array<Record<string, PluginSqliteResultValue>> {
  if (rows.length > MAX_PLUGIN_SQLITE_ALL_ROWS) {
    throw sqliteError({
      code: "plugin_sqlite_result_limit_exceeded",
      message: `Plugin SQLite sqlite.all is limited to ${MAX_PLUGIN_SQLITE_ALL_ROWS} rows.`,
      virtualPath,
    });
  }
  const sizeTracker = createPluginSqliteResultSizeTracker({
    limitBytes: MAX_PLUGIN_SQLITE_ALL_RESULT_BYTES,
    operation: "sqlite.all",
    virtualPath,
  });
  const normalizedRows: Array<Record<string, PluginSqliteResultValue>> = [];
  sizeTracker.addRawJsonBytes(1); // [
  for (const row of rows) {
    if (normalizedRows.length > 0) {
      sizeTracker.addRawJsonBytes(1); // ,
    }
    normalizedRows.push(
      normalizeRow(row, {
        limitBytes: MAX_PLUGIN_SQLITE_ALL_RESULT_BYTES,
        operation: "sqlite.all",
        sizeTracker,
        virtualPath,
      }),
    );
  }
  sizeTracker.addRawJsonBytes(1); // ]
  return normalizedRows;
}

function assertPluginSqliteQuotaNumber(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PluginDataQuotaError({
      code: "plugin_data_quota_unavailable",
      message: `Plugin SQLite ${label} quota is invalid.`,
    });
  }
  return value;
}

function configurePluginSqliteQuota(
  database: Database,
  quota: PluginDataQuotaSettings,
): void {
  const maxDataBytes = assertPluginSqliteQuotaNumber(
    quota.maxDataBytes,
    "total storage",
  );
  const pageSizeRow = database
    .query<{ page_size: number }, []>("PRAGMA page_size")
    .get();
  const pageSize = Math.max(1, Number(pageSizeRow?.page_size ?? 4096));
  const maxPages = Math.max(1, Math.floor(maxDataBytes / pageSize));
  // SQLite PRAGMA assignments do not accept bound parameters here. maxPages is
  // derived only from validated numeric quota settings and SQLite's page_size.
  database.run(`PRAGMA max_page_count = ${maxPages}`);
}

type PluginSqliteConnectionCacheEntry = {
  database: Database;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastUsedAt: number;
  hasCompletedQuotaScan: boolean;
  pluginPath: string;
  realPath: string;
  runQueue: Promise<void>;
  writesSinceQuotaScan: number;
};

const pluginSqliteConnectionCache = new Map<
  string,
  PluginSqliteConnectionCacheEntry
>();

function pluginSqliteConnectionCacheKey(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  realPath: string;
}): string {
  const { quota } = input;
  return [
    input.pluginPath,
    input.realPath,
    String(quota.maxDataBytes),
    String(quota.maxFileBytes),
    String(quota.maxFiles),
  ].join("\0");
}

function closePluginSqliteCacheEntry(key: string): void {
  const entry = pluginSqliteConnectionCache.get(key);
  if (!entry) return;
  pluginSqliteConnectionCache.delete(key);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.database.close(false);
}

function schedulePluginSqliteIdleClose(key: string): void {
  const entry = pluginSqliteConnectionCache.get(key);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    closePluginSqliteCacheEntry(key);
  }, PLUGIN_SQLITE_CONNECTION_IDLE_MS);
  entry.idleTimer.unref?.();
}

function prunePluginSqliteConnectionCache(): void {
  while (pluginSqliteConnectionCache.size > MAX_PLUGIN_SQLITE_CONNECTIONS) {
    const oldestKey = pluginSqliteConnectionCache.keys().next();
    if (oldestKey.done) {
      return;
    }
    closePluginSqliteCacheEntry(oldestKey.value);
  }
  pruneLruMapToMaxEntries(
    pluginSqliteConnectionCache,
    MAX_PLUGIN_SQLITE_CONNECTIONS,
  );
}

function getPluginSqliteConnection(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  realPath: string;
}): { database: Database; key: string } {
  const key = pluginSqliteConnectionCacheKey(input);
  const now = Date.now();
  const cached = readLruMapValue(pluginSqliteConnectionCache, key);
  if (cached) {
    cached.lastUsedAt = now;
    return { database: cached.database, key };
  }
  const database = new Database(input.realPath, {
    create: true,
    strict: false,
  });
  loadPluginSqliteSecurityExtension(database);
  database.exec("PRAGMA foreign_keys = ON");
  configurePluginSqliteQuota(database, input.quota);
  writeLruMapValue(pluginSqliteConnectionCache, key, {
    database,
    idleTimer: null,
    hasCompletedQuotaScan: false,
    lastUsedAt: now,
    pluginPath: input.pluginPath,
    realPath: input.realPath,
    runQueue: Promise.resolve(),
    writesSinceQuotaScan: 0,
  });
  prunePluginSqliteConnectionCache();
  return { database, key };
}

export function closePluginSqliteConnections(pluginPath?: string): void {
  for (const [key, entry] of [...pluginSqliteConnectionCache.entries()]) {
    if (!pluginPath || entry.pluginPath === pluginPath) {
      closePluginSqliteCacheEntry(key);
    }
  }
}

async function runWithPluginSqliteConnectionMutex<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const entry = pluginSqliteConnectionCache.get(key);
  if (!entry) {
    return operation();
  }

  const previous = entry.runQueue.catch(() => undefined);
  const current = previous.then(operation);
  entry.runQueue = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

export function getPluginSqliteConnectionCacheStats(): {
  entries: number;
  keys: string[];
} {
  return {
    entries: pluginSqliteConnectionCache.size,
    keys: [...pluginSqliteConnectionCache.keys()],
  };
}

async function assertPluginSqliteQuota(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  virtualPath: string;
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
      message: "Plugin SQLite operation exceeds the plugin data quota.",
    });
  }
}

function shouldRunPluginSqliteFullQuotaScan(cacheKey: string): boolean {
  const entry = pluginSqliteConnectionCache.get(cacheKey);
  if (!entry) {
    return true;
  }
  if (!entry.hasCompletedQuotaScan) {
    return true;
  }
  entry.writesSinceQuotaScan += 1;
  return (
    entry.writesSinceQuotaScan >= PLUGIN_SQLITE_QUOTA_FULL_SCAN_WRITE_INTERVAL
  );
}

function markPluginSqliteFullQuotaScanComplete(cacheKey: string): void {
  const entry = pluginSqliteConnectionCache.get(cacheKey);
  if (!entry) {
    return;
  }
  entry.hasCompletedQuotaScan = true;
  entry.writesSinceQuotaScan = 0;
}

async function maybeAssertPluginSqliteQuotaAfterWrite(input: {
  cacheKey: string;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  virtualPath: string;
}): Promise<void> {
  if (!shouldRunPluginSqliteFullQuotaScan(input.cacheKey)) {
    return;
  }
  await assertPluginSqliteQuota(input);
  markPluginSqliteFullQuotaScanComplete(input.cacheKey);
}

async function runPluginSqliteStatementWithQuotaGuard(input: {
  bindings: SQLQueryBindings[];
  cacheKey: string;
  database: Database;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  statement: ReturnType<Database["prepare"]>;
  virtualPath: string;
}): Promise<ReturnType<ReturnType<Database["prepare"]>["run"]>> {
  return withPluginDataQuotaLock(input.pluginPath, async () => {
    input.database.run(`SAVEPOINT ${PLUGIN_SQLITE_QUOTA_SAVEPOINT_NAME}`);
    let savepointOpen = true;
    try {
      const runResult = input.statement.run(...input.bindings);
      await maybeAssertPluginSqliteQuotaAfterWrite({
        cacheKey: input.cacheKey,
        pluginPath: input.pluginPath,
        quota: input.quota,
        virtualPath: input.virtualPath,
      });
      input.database.run(
        `RELEASE SAVEPOINT ${PLUGIN_SQLITE_QUOTA_SAVEPOINT_NAME}`,
      );
      savepointOpen = false;
      return runResult;
    } catch (error) {
      if (savepointOpen) {
        try {
          input.database.run(
            `ROLLBACK TO SAVEPOINT ${PLUGIN_SQLITE_QUOTA_SAVEPOINT_NAME}`,
          );
        } finally {
          input.database.run(
            `RELEASE SAVEPOINT ${PLUGIN_SQLITE_QUOTA_SAVEPOINT_NAME}`,
          );
        }
      }
      throw error;
    }
  });
}

export async function executePluginSqliteOperation(input: {
  operation: PluginSqliteOperation;
  params?: unknown;
  permissions: readonly string[];
  pluginPath: string;
  quota?: PluginDataQuotaSettings;
}): Promise<
  PluginSqliteAllResult | PluginSqliteGetResult | PluginSqliteRunResult
> {
  const params = optionalRecordValue(input.params);
  const virtualPath = requiredStringField(params, "path");
  assertPluginSqlitePermission({
    permissions: input.permissions,
    virtualPath,
  });
  const statementText = requireSingleStatement(
    requiredStringField(params, "statement"),
  );
  assertSqliteStatementAllowed(statementText);
  const bindings = normalizeBindings(params.bindings);
  const { realPath, virtualPath: normalizedVirtualPath } =
    await resolvePluginSqliteDatabasePath({
      pluginPath: input.pluginPath,
      virtualPath,
    });
  const quota = input.quota ?? DEFAULT_PLUGIN_SQLITE_QUOTA;

  let cacheKey: string | null = null;
  try {
    const connection = getPluginSqliteConnection({
      pluginPath: input.pluginPath,
      quota,
      realPath,
    });
    const database = connection.database;
    cacheKey = connection.key;
    let result:
      | PluginSqliteAllResult
      | PluginSqliteGetResult
      | PluginSqliteRunResult;
    switch (input.operation) {
      case "sqlite.all": {
        assertReadStatement(statementText, "sqlite.all");
        const statement = database.prepare(
          cappedAllStatementText(statementText),
        );
        const rows = statement.all(...bindings) as Array<
          Record<string, unknown>
        >;
        result = {
          rows: normalizeCappedRows(rows, normalizedVirtualPath),
        };
        break;
      }
      case "sqlite.get": {
        assertReadStatement(statementText, "sqlite.get");
        const statement = database.prepare(statementText);
        const row = statement.get(...bindings) as Record<
          string,
          unknown
        > | null;
        const normalizedRow = row
          ? normalizeRow(row, {
              limitBytes: MAX_PLUGIN_SQLITE_GET_RESULT_BYTES,
              operation: "sqlite.get",
              sizeTracker: createPluginSqliteResultSizeTracker({
                limitBytes: MAX_PLUGIN_SQLITE_GET_RESULT_BYTES,
                operation: "sqlite.get",
                virtualPath: normalizedVirtualPath,
              }),
              virtualPath: normalizedVirtualPath,
            })
          : null;
        result = { row: normalizedRow };
        break;
      }
      case "sqlite.run": {
        const statement = database.prepare(statementText);
        const runResult = await runWithPluginSqliteConnectionMutex(
          connection.key,
          () =>
            runPluginSqliteStatementWithQuotaGuard({
              bindings,
              cacheKey: connection.key,
              database,
              pluginPath: input.pluginPath,
              quota,
              statement,
              virtualPath: normalizedVirtualPath,
            }),
        );
        result = {
          changes: runResult.changes,
          lastInsertRowid: normalizeRunLastInsertRowid(
            runResult.lastInsertRowid,
          ),
        };
        break;
      }
    }
    if (!result) {
      throw sqliteError({
        code: "unsupported_plugin_sqlite_operation",
        message: `Plugin SQLite operation ${input.operation} is not supported.`,
        virtualPath: normalizedVirtualPath,
      });
    }
    if (input.operation !== "sqlite.run") {
      await assertPluginSqliteQuota({
        pluginPath: input.pluginPath,
        quota,
        virtualPath: normalizedVirtualPath,
      });
      if (cacheKey) markPluginSqliteFullQuotaScanComplete(cacheKey);
    }
    if (cacheKey) schedulePluginSqliteIdleClose(cacheKey);
    return result;
  } catch (error) {
    if (
      error instanceof PluginSqliteError ||
      error instanceof PluginDataQuotaError
    ) {
      if (cacheKey) closePluginSqliteCacheEntry(cacheKey);
      throw error;
    }
    if (cacheKey) closePluginSqliteCacheEntry(cacheKey);
    throw sqliteError({
      code: "plugin_sqlite_failed",
      message: `Plugin SQLite operation failed for ${normalizedVirtualPath}.`,
      virtualPath: normalizedVirtualPath,
    });
  }
}
