/**
 * @file src/bun/plugin/data.ts
 * @description Plugin System v1 .data root mapping, first-activation seeding, and reset helpers.
 */

import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  cp,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { relative, join, resolve } from "node:path";

import {
  isPathContainedByDirectory,
  resolvePluginManagedDirectoryPath,
} from "./inventory";

export const PLUGIN_DATA_DIRECTORY_NAME = ".data";
export const PLUGIN_SEED_DIRECTORY_NAME = "seed";
const MAX_PLUGIN_DATA_QUOTA_SCAN_FILES = 50_000;
const MAX_PLUGIN_DATA_QUOTA_SCAN_ENTRIES = 100_000;
const MAX_PLUGIN_DATA_QUOTA_SCAN_BYTES = 512 * 1024 * 1024;
const pluginDataQuotaQueues = new Map<string, Promise<void>>();

export async function withPluginDataQuotaLock<T>(
  pluginPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = resolve(pluginPath);
  const previous = pluginDataQuotaQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  pluginDataQuotaQueues.set(
    key,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}
const MAX_PLUGIN_DATA_QUOTA_SCAN_DEPTH = 64;

export type PluginDataProvisionResult = {
  dataPath: string;
  seedPath: string;
  seeded: boolean;
  skippedBecauseActivatedOnce: boolean;
};

export type PluginDataResetResult = {
  backupPath: string | null;
  dataPath: string;
  seedPath: string;
  seeded: boolean;
};

export type PluginDataQuotaSettings = {
  maxDataBytes: number;
  maxFileBytes: number;
  maxFiles: number;
};

export type PluginDataQuotaUsage = {
  bytes: number;
  files: number;
  largestFileBytes: number;
};

export type PluginDataQuotaErrorCode =
  | "plugin_data_quota_exceeded"
  | "plugin_data_quota_unavailable";

export type PluginDataGcReason = "admin_action" | "quota_preflight";

export type PluginDataGcRequest = {
  pluginPath: string;
  reason: PluginDataGcReason;
  virtualRoot: "~/";
};

export type PluginDataGcRunner = (
  request: PluginDataGcRequest,
) => Promise<void> | void;

export class PluginGcError extends Error {
  readonly code: string;

  constructor(input: { cause?: unknown; code?: string; message?: string }) {
    super(input.message ?? "Plugin GC failed.", {
      ...(input.cause === undefined ? {} : { cause: input.cause }),
    });
    this.name = "PluginGcError";
    this.code = input.code ?? "plugin_gc_failed";
  }
}

export class PluginDataQuotaError extends Error {
  readonly attempted: number | null;
  readonly code: PluginDataQuotaErrorCode;
  readonly limit: number | null;

  constructor(input: {
    attempted?: number;
    code: PluginDataQuotaErrorCode;
    limit?: number;
    message: string;
  }) {
    super(input.message);
    this.name = "PluginDataQuotaError";
    this.attempted = input.attempted ?? null;
    this.code = input.code;
    this.limit = input.limit ?? null;
  }
}

function isMissingFileSystemError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function resolveContainedChildPath(
  rootPath: string,
  childName: string,
): string {
  const childPath = resolve(rootPath, childName);
  if (!isPathContainedByDirectory(rootPath, childPath)) {
    throw new Error("Plugin data copy target escaped its containing root.");
  }
  return childPath;
}

export function resolvePluginDataDirectoryPath(pluginPath: string): string {
  return resolvePluginManagedDirectoryPath(
    pluginPath,
    PLUGIN_DATA_DIRECTORY_NAME,
  );
}

export function resolvePluginSeedDirectoryPath(pluginPath: string): string {
  const resolvedPluginPath = resolve(pluginPath);
  const seedPath = resolve(resolvedPluginPath, PLUGIN_SEED_DIRECTORY_NAME);
  if (!isPathContainedByDirectory(resolvedPluginPath, seedPath)) {
    throw new Error("Plugin seed directory escaped its plugin root.");
  }
  return seedPath;
}

export function resolvePluginDataVirtualPath(
  pluginPath: string,
  virtualPath: string,
): string {
  if (virtualPath.includes("\0")) {
    throw new Error("Plugin data virtual path cannot contain NUL bytes.");
  }
  if (virtualPath !== "~" && !virtualPath.startsWith("~/")) {
    throw new Error("Plugin data virtual paths must start with ~/.");
  }
  const dataPath = resolvePluginDataDirectoryPath(pluginPath);
  const relativePath = virtualPath === "~" ? "" : virtualPath.slice(2);
  const targetPath = resolve(dataPath, relativePath);
  if (!isPathContainedByDirectory(dataPath, targetPath)) {
    throw new Error("Plugin data virtual path escaped the plugin .data root.");
  }
  return targetPath;
}

function emptyQuotaUsage(): PluginDataQuotaUsage {
  return {
    bytes: 0,
    files: 0,
    largestFileBytes: 0,
  };
}

function assertValidQuotaSettings(quota: PluginDataQuotaSettings): void {
  for (const [label, value] of [
    ["total storage", quota.maxDataBytes],
    ["per-file", quota.maxFileBytes],
    ["file-count", quota.maxFiles],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PluginDataQuotaError({
        code: "plugin_data_quota_unavailable",
        message: `Plugin data ${label} quota is invalid.`,
      });
    }
  }
}

function toQuotaUnavailableError(): PluginDataQuotaError {
  return new PluginDataQuotaError({
    code: "plugin_data_quota_unavailable",
    message: "Plugin data quota could not be calculated.",
  });
}

function assertQuotaLimit(input: {
  attempted: number;
  code: PluginDataQuotaErrorCode;
  limit: number;
  message: string;
}): never {
  throw new PluginDataQuotaError(input);
}

function combineQuotaUsage(
  left: PluginDataQuotaUsage,
  right: PluginDataQuotaUsage,
): PluginDataQuotaUsage {
  return {
    bytes: left.bytes + right.bytes,
    files: left.files + right.files,
    largestFileBytes: Math.max(left.largestFileBytes, right.largestFileBytes),
  };
}

async function collectPathQuotaUsage(
  path: string,
  state: { bytes: number; entries: number; files: number } = {
    bytes: 0,
    entries: 0,
    files: 0,
  },
  depth = 0,
): Promise<PluginDataQuotaUsage> {
  if (depth > MAX_PLUGIN_DATA_QUOTA_SCAN_DEPTH) {
    throw toQuotaUnavailableError();
  }
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    let usage = emptyQuotaUsage();
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      state.entries += 1;
      if (state.entries > MAX_PLUGIN_DATA_QUOTA_SCAN_ENTRIES) {
        throw toQuotaUnavailableError();
      }
      usage = combineQuotaUsage(
        usage,
        await collectPathQuotaUsage(join(path, entry.name), state, depth + 1),
      );
    }
    return usage;
  }
  if (stat.isFile()) {
    state.files += 1;
    state.bytes += stat.size;
    if (
      state.files > MAX_PLUGIN_DATA_QUOTA_SCAN_FILES ||
      state.bytes > MAX_PLUGIN_DATA_QUOTA_SCAN_BYTES
    ) {
      throw toQuotaUnavailableError();
    }
    return {
      bytes: stat.size,
      files: 1,
      largestFileBytes: stat.size,
    };
  }
  throw toQuotaUnavailableError();
}

async function existingPathQuotaUsage(
  path: string,
): Promise<PluginDataQuotaUsage> {
  try {
    return await collectPathQuotaUsage(path);
  } catch (error) {
    if (isMissingFileSystemError(error)) {
      return emptyQuotaUsage();
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFileSystemError(error)) {
      return false;
    }
    throw error;
  }
}

async function nearestExistingPluginDataPath(input: {
  dataPath: string;
  targetPath: string;
}): Promise<string | null> {
  let currentPath = input.targetPath;
  while (!(await pathExists(currentPath))) {
    if (currentPath === input.dataPath) {
      return null;
    }
    const parentPath = resolve(currentPath, "..");
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
  return currentPath;
}

async function resolvePluginDataOperationRealPath(input: {
  pluginPath: string;
  targetPath: string;
}): Promise<string> {
  const dataPath = resolvePluginDataDirectoryPath(input.pluginPath);
  let realDataPath: string;
  try {
    realDataPath = await realpath(dataPath);
  } catch {
    throw toQuotaUnavailableError();
  }
  const nearestPath = await nearestExistingPluginDataPath({
    dataPath,
    targetPath: input.targetPath,
  });
  if (!nearestPath) {
    throw toQuotaUnavailableError();
  }
  let realNearestPath: string;
  try {
    realNearestPath = await realpath(nearestPath);
  } catch {
    throw toQuotaUnavailableError();
  }
  if (!isPathContainedByDirectory(realDataPath, realNearestPath)) {
    throw new Error("Plugin data symlink escape is denied.");
  }
  const unresolvedSuffix = relative(nearestPath, input.targetPath);
  const realTargetPath = unresolvedSuffix
    ? resolve(realNearestPath, unresolvedSuffix)
    : realNearestPath;
  if (!isPathContainedByDirectory(realDataPath, realTargetPath)) {
    throw new Error("Plugin data path escaped its allowed root.");
  }
  return realTargetPath;
}

function pluginDataWriteOpenFlags(): number {
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC;
  return process.platform === "win32" ? flags : flags | fsConstants.O_NOFOLLOW;
}

async function writeAllToFileHandle(
  handle: FileHandle,
  contents: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < contents.byteLength) {
    const { bytesWritten } = await handle.write(
      contents,
      offset,
      contents.byteLength - offset,
      offset,
    );
    if (bytesWritten <= 0) {
      throw new Error("Plugin data file write made no progress.");
    }
    offset += bytesWritten;
  }
}

async function writePluginDataFileNoFollow(
  targetPath: string,
  contents: string | Uint8Array,
): Promise<void> {
  const bytes =
    typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : contents;
  const handle = await open(targetPath, pluginDataWriteOpenFlags(), 0o666);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error("Plugin data write target is not a regular file.");
    }
    await handle.truncate(0);
    await writeAllToFileHandle(handle, bytes);
  } finally {
    await handle.close();
  }
}

export async function calculatePluginDataQuotaUsage(input: {
  pluginPath: string;
}): Promise<PluginDataQuotaUsage> {
  const dataPath = resolvePluginDataDirectoryPath(input.pluginPath);
  try {
    const stat = await lstat(dataPath);
    if (!stat.isDirectory()) {
      throw toQuotaUnavailableError();
    }
    return await collectPathQuotaUsage(dataPath);
  } catch (error) {
    if (isMissingFileSystemError(error)) {
      return emptyQuotaUsage();
    }
    if (error instanceof PluginDataQuotaError) {
      throw error;
    }
    throw toQuotaUnavailableError();
  }
}

async function assertQuotaForPlannedStorageChange(input: {
  addedUsage: PluginDataQuotaUsage;
  operationLargestFileBytes: number;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  replacedUsage: PluginDataQuotaUsage;
}): Promise<void> {
  assertValidQuotaSettings(input.quota);
  const currentUsage = await calculatePluginDataQuotaUsage({
    pluginPath: input.pluginPath,
  });
  if (input.operationLargestFileBytes > input.quota.maxFileBytes) {
    assertQuotaLimit({
      attempted: input.operationLargestFileBytes,
      code: "plugin_data_quota_exceeded",
      limit: input.quota.maxFileBytes,
      message: "Plugin data operation exceeds the per-file quota.",
    });
  }

  const resultingBytes =
    currentUsage.bytes + input.addedUsage.bytes - input.replacedUsage.bytes;
  if (resultingBytes > input.quota.maxDataBytes) {
    assertQuotaLimit({
      attempted: resultingBytes,
      code: "plugin_data_quota_exceeded",
      limit: input.quota.maxDataBytes,
      message: "Plugin data operation exceeds the total storage quota.",
    });
  }

  const resultingFiles =
    currentUsage.files + input.addedUsage.files - input.replacedUsage.files;
  if (resultingFiles > input.quota.maxFiles) {
    assertQuotaLimit({
      attempted: resultingFiles,
      code: "plugin_data_quota_exceeded",
      limit: input.quota.maxFiles,
      message: "Plugin data operation exceeds the file-count quota.",
    });
  }
}

export async function runPluginDataGc(input: {
  pluginPath: string;
  reason?: PluginDataGcReason;
  runGc: PluginDataGcRunner;
}): Promise<void> {
  try {
    await input.runGc({
      pluginPath: resolve(input.pluginPath),
      reason: input.reason ?? "admin_action",
      virtualRoot: "~/",
    });
  } catch (error) {
    if (error instanceof PluginGcError) {
      throw error;
    }
    throw new PluginGcError({ cause: error });
  }
}

async function enforceQuotaForPlannedStorageChange(input: {
  addedUsage: PluginDataQuotaUsage;
  operationLargestFileBytes: number;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  replacedUsage: PluginDataQuotaUsage;
  runGc?: PluginDataGcRunner | undefined;
}): Promise<void> {
  return withPluginDataQuotaLock(input.pluginPath, async () => {
    try {
      await assertQuotaForPlannedStorageChange(input);
    } catch (error) {
      if (
        !(error instanceof PluginDataQuotaError) ||
        error.code !== "plugin_data_quota_exceeded" ||
        !input.runGc
      ) {
        throw error;
      }
      await runPluginDataGc({
        pluginPath: input.pluginPath,
        reason: "quota_preflight",
        runGc: input.runGc,
      });
      await assertQuotaForPlannedStorageChange(input);
    }
  });
}

function byteLengthOfContents(contents: string | Uint8Array): number {
  return typeof contents === "string"
    ? Buffer.byteLength(contents)
    : contents.byteLength;
}

function assertPathInsidePluginData(input: {
  path: string;
  pluginPath: string;
}): void {
  const dataPath = resolvePluginDataDirectoryPath(input.pluginPath);
  if (!isPathContainedByDirectory(dataPath, input.path)) {
    throw new PluginDataQuotaError({
      code: "plugin_data_quota_unavailable",
      message: "Plugin data quota path is outside the plugin data root.",
    });
  }
}

export async function enforcePluginDataQuotaForFileWrite(input: {
  contents: string | Uint8Array;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  targetPath: string;
}): Promise<void> {
  assertPathInsidePluginData({
    path: input.targetPath,
    pluginPath: input.pluginPath,
  });
  const writeBytes = byteLengthOfContents(input.contents);
  const replacedUsage = await existingPathQuotaUsage(input.targetPath);
  await enforceQuotaForPlannedStorageChange({
    addedUsage: {
      bytes: writeBytes,
      files: 1,
      largestFileBytes: writeBytes,
    },
    operationLargestFileBytes: writeBytes,
    pluginPath: input.pluginPath,
    quota: input.quota,
    replacedUsage,
    runGc: input.runGc,
  });
}

export async function enforcePluginDataQuotaForDirectoryCreate(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  targetPath: string;
}): Promise<void> {
  assertPathInsidePluginData({
    path: input.targetPath,
    pluginPath: input.pluginPath,
  });
  await enforceQuotaForPlannedStorageChange({
    addedUsage: emptyQuotaUsage(),
    operationLargestFileBytes: 0,
    pluginPath: input.pluginPath,
    quota: input.quota,
    replacedUsage: emptyQuotaUsage(),
    runGc: input.runGc,
  });
}

export async function enforcePluginDataQuotaForPathCopy(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  sourcePath: string;
  targetPath: string;
}): Promise<void> {
  assertPathInsidePluginData({
    path: input.targetPath,
    pluginPath: input.pluginPath,
  });
  const sourceStat = await lstat(input.sourcePath);
  const sourceUsage = await collectPathQuotaUsage(input.sourcePath);
  const targetExists = await pathExists(input.targetPath);
  if (sourceStat.isDirectory() && targetExists) {
    throw new PluginDataQuotaError({
      code: "plugin_data_quota_unavailable",
      message:
        "Plugin data quota cannot be preflighted for copying into an existing directory.",
    });
  }
  const replacedUsage = targetExists
    ? await collectPathQuotaUsage(input.targetPath)
    : emptyQuotaUsage();
  await enforceQuotaForPlannedStorageChange({
    addedUsage: sourceUsage,
    operationLargestFileBytes: sourceUsage.largestFileBytes,
    pluginPath: input.pluginPath,
    quota: input.quota,
    replacedUsage,
    runGc: input.runGc,
  });
}

export async function enforcePluginDataQuotaForPathMove(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  sourceCountsAgainstPluginDataUsage: boolean;
  sourcePath: string;
  targetPath: string;
}): Promise<void> {
  assertPathInsidePluginData({
    path: input.targetPath,
    pluginPath: input.pluginPath,
  });
  const sourceUsage = await collectPathQuotaUsage(input.sourcePath);
  const replacedUsage = isPathContainedByDirectory(
    input.sourcePath,
    input.targetPath,
  )
    ? emptyQuotaUsage()
    : await existingPathQuotaUsage(input.targetPath);
  await enforceQuotaForPlannedStorageChange({
    addedUsage: input.sourceCountsAgainstPluginDataUsage
      ? emptyQuotaUsage()
      : sourceUsage,
    operationLargestFileBytes: sourceUsage.largestFileBytes,
    pluginPath: input.pluginPath,
    quota: input.quota,
    replacedUsage,
    runGc: input.runGc,
  });
}

export async function writePluginDataFile(input: {
  contents: string | Uint8Array;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  virtualPath: string;
}): Promise<void> {
  const targetPath = resolvePluginDataVirtualPath(
    input.pluginPath,
    input.virtualPath,
  );
  await enforcePluginDataQuotaForFileWrite({
    contents: input.contents,
    pluginPath: input.pluginPath,
    quota: input.quota,
    runGc: input.runGc,
    targetPath,
  });
  const realTargetPath = await resolvePluginDataOperationRealPath({
    pluginPath: input.pluginPath,
    targetPath,
  });
  await writePluginDataFileNoFollow(realTargetPath, input.contents);
}

export async function makePluginDataDirectory(input: {
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  virtualPath: string;
}): Promise<void> {
  const targetPath = resolvePluginDataVirtualPath(
    input.pluginPath,
    input.virtualPath,
  );
  await enforcePluginDataQuotaForDirectoryCreate({
    pluginPath: input.pluginPath,
    quota: input.quota,
    runGc: input.runGc,
    targetPath,
  });
  const realTargetPath = await resolvePluginDataOperationRealPath({
    pluginPath: input.pluginPath,
    targetPath,
  });
  await mkdir(realTargetPath, { recursive: true });
}

export async function copyPluginDataPath(input: {
  fromVirtualPath: string;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  toVirtualPath: string;
}): Promise<void> {
  const sourcePath = resolvePluginDataVirtualPath(
    input.pluginPath,
    input.fromVirtualPath,
  );
  const targetPath = resolvePluginDataVirtualPath(
    input.pluginPath,
    input.toVirtualPath,
  );
  const sourceStat = await lstat(sourcePath);
  await enforcePluginDataQuotaForPathCopy({
    pluginPath: input.pluginPath,
    quota: input.quota,
    runGc: input.runGc,
    sourcePath,
    targetPath,
  });
  const realSourcePath = await resolvePluginDataOperationRealPath({
    pluginPath: input.pluginPath,
    targetPath: sourcePath,
  });
  const realTargetPath = await resolvePluginDataOperationRealPath({
    pluginPath: input.pluginPath,
    targetPath,
  });
  await cp(realSourcePath, realTargetPath, {
    force: true,
    recursive: sourceStat.isDirectory(),
  });
}

export async function movePluginDataPath(input: {
  fromVirtualPath: string;
  pluginPath: string;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  toVirtualPath: string;
}): Promise<void> {
  const sourcePath = resolvePluginDataVirtualPath(
    input.pluginPath,
    input.fromVirtualPath,
  );
  const targetPath = resolvePluginDataVirtualPath(
    input.pluginPath,
    input.toVirtualPath,
  );
  if (resolve(sourcePath) === resolve(targetPath)) {
    return;
  }
  await enforcePluginDataQuotaForPathMove({
    pluginPath: input.pluginPath,
    quota: input.quota,
    runGc: input.runGc,
    sourceCountsAgainstPluginDataUsage: true,
    sourcePath,
    targetPath,
  });
  const realSourcePath = await resolvePluginDataOperationRealPath({
    pluginPath: input.pluginPath,
    targetPath: sourcePath,
  });
  const realTargetPath = await resolvePluginDataOperationRealPath({
    pluginPath: input.pluginPath,
    targetPath,
  });
  await rename(realSourcePath, realTargetPath);
}

async function copySeedDirectoryContents(
  sourceDirectoryPath: string,
  targetDirectoryPath: string,
  dataRootPath: string,
): Promise<void> {
  await mkdir(targetDirectoryPath, { recursive: true });
  const entries = await readdir(sourceDirectoryPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const sourcePath = join(sourceDirectoryPath, entry.name);
    const targetPath = resolveContainedChildPath(
      targetDirectoryPath,
      entry.name,
    );
    if (!isPathContainedByDirectory(dataRootPath, targetPath)) {
      throw new Error("Plugin seed copy escaped the plugin .data root.");
    }
    const stat = await lstat(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Plugin seed entry ${sourcePath} is a symlink; seed entries must be regular files or directories.`,
      );
    }
    if (stat.isDirectory()) {
      await copySeedDirectoryContents(sourcePath, targetPath, dataRootPath);
      continue;
    }
    if (stat.isFile()) {
      await copyFile(sourcePath, targetPath);
      continue;
    }
    throw new Error(
      `Plugin seed entry ${sourcePath} must be a regular file or directory.`,
    );
  }
}

async function copyPluginSeedToDataRoot(input: {
  dataPath: string;
  seedPath: string;
}): Promise<boolean> {
  let seedStat: Awaited<ReturnType<typeof lstat>>;
  try {
    seedStat = await lstat(input.seedPath);
  } catch (error) {
    if (isMissingFileSystemError(error)) {
      return false;
    }
    throw error;
  }
  if (!seedStat.isDirectory()) {
    throw new Error("Plugin seed must be a directory when present.");
  }
  await copySeedDirectoryContents(
    input.seedPath,
    input.dataPath,
    input.dataPath,
  );
  return true;
}

export async function ensurePluginDataRootForActivation(input: {
  activatedOnce: boolean;
  pluginPath: string;
}): Promise<PluginDataProvisionResult> {
  const dataPath = resolvePluginDataDirectoryPath(input.pluginPath);
  const seedPath = resolvePluginSeedDirectoryPath(input.pluginPath);
  if (input.activatedOnce) {
    return {
      dataPath,
      seedPath,
      seeded: false,
      skippedBecauseActivatedOnce: true,
    };
  }

  await mkdir(dataPath, { recursive: true });
  const seeded = await copyPluginSeedToDataRoot({
    dataPath,
    seedPath,
  });
  return {
    dataPath,
    seedPath,
    seeded,
    skippedBecauseActivatedOnce: false,
  };
}

async function nextAvailableBackupPath(
  pluginPath: string,
  timestamp: string,
): Promise<string> {
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const basePath = resolve(pluginPath, `.data-bak-${safeTimestamp}`);
  if (!isPathContainedByDirectory(pluginPath, basePath)) {
    throw new Error("Plugin data backup path escaped its plugin root.");
  }
  if (!(await pathExists(basePath))) {
    return basePath;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidatePath = `${basePath}-${index}`;
    if (!isPathContainedByDirectory(pluginPath, candidatePath)) {
      throw new Error("Plugin data backup path escaped its plugin root.");
    }
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }
  throw new Error("Could not allocate a unique plugin data backup path.");
}

export async function resetPluginDataRoot(input: {
  now?: () => Date;
  pluginPath: string;
}): Promise<PluginDataResetResult> {
  const pluginPath = resolve(input.pluginPath);
  const dataPath = resolvePluginDataDirectoryPath(pluginPath);
  const seedPath = resolvePluginSeedDirectoryPath(pluginPath);
  let backupPath: string | null = null;

  try {
    const dataStat = await lstat(dataPath);
    if (!dataStat.isDirectory()) {
      await rm(dataPath, { force: true, recursive: true });
    } else {
      backupPath = await nextAvailableBackupPath(
        pluginPath,
        (input.now?.() ?? new Date()).toISOString(),
      );
      await rename(dataPath, backupPath);
    }
  } catch (error) {
    if (!isMissingFileSystemError(error)) {
      throw error;
    }
  }

  await mkdir(dataPath, { recursive: true });
  const seeded = await copyPluginSeedToDataRoot({
    dataPath,
    seedPath,
  });

  return {
    backupPath,
    dataPath,
    seedPath,
    seeded,
  };
}
