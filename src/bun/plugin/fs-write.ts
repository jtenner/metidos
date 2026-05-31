/**
 * @file src/bun/plugin/fs-write.ts
 * @description Safe Plugin System v1 metidos.fs write, copy, move, and delete operations.
 */

import { fstatSync, ftruncateSync, readSync, writeSync } from "node:fs";
import {
  cp,
  lstat,
  readdir,
  rmdir as removeDirectory,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { evaluatePluginCapability } from "./capability-gate";
import { containsGlobPattern, globSegmentsMatch } from "./glob-match";
import {
  assertPluginProjectRootContext,
  type PluginCallbackContextKind,
  PluginContextError,
} from "./context";
import {
  enforcePluginDataQuotaForDirectoryCreate,
  enforcePluginDataQuotaForFileWrite,
  enforcePluginDataQuotaForPathCopy,
  enforcePluginDataQuotaForPathMove,
  type PluginDataGcRunner,
  type PluginDataQuotaSettings,
} from "./data";
import {
  closeValidatedPluginFsFileDescriptor,
  mkdirValidatedPluginFsPathSync,
  openValidatedPluginFsPathSync,
  pluginFsReadOpenFlags,
  pluginFsWriteOpenFlags,
  type ResolvedPluginFsPath,
  revalidateResolvedPluginFsPath,
  toPluginFsVirtualPath,
  writeValidatedPluginFsFileDescriptor,
} from "./fs-path";

const REQUIRED_STORAGE_READ_PERMISSION = "storage:read";
const REQUIRED_STORAGE_WRITE_PERMISSION = "storage:write";
const REQUIRED_STORAGE_DELETE_PERMISSION = "storage:delete";
const REQUIRED_PROJECT_READ_PERMISSION = "files:read";
const REQUIRED_PROJECT_WRITE_PERMISSION = "files:write";
const REQUIRED_PROJECT_DELETE_PERMISSION = "files:delete";
const PLUGIN_FS_COPY_CHUNK_BYTES = 64 * 1024;

export type PluginFsWriteContextKind = PluginCallbackContextKind;

export type PluginFsWriteContext = {
  contextKind: PluginFsWriteContextKind;
  filesDeleteAllowlist?: readonly string[];
  filesDeleteDenylist?: readonly string[];
  filesReadAllowlist?: readonly string[];
  filesReadDenylist?: readonly string[];
  filesWriteAllowlist?: readonly string[];
  filesWriteDenylist?: readonly string[];
  permissions: readonly string[];
  pluginPath: string;
  projectRootPath?: string | null;
  quota: PluginDataQuotaSettings;
  runGc?: PluginDataGcRunner | undefined;
  threadRootPath?: string | null;
};

export type PluginFsWriteErrorCode =
  | "copy_failed"
  | "delete_failed"
  | "mkdir_failed"
  | "move_failed"
  | "not_a_directory"
  | "permission_denied"
  | "write_failed";

export class PluginFsWriteError extends Error {
  readonly code: PluginFsWriteErrorCode;
  readonly virtualPath: string;

  constructor(input: {
    cause?: unknown;
    code: PluginFsWriteErrorCode;
    message: string;
    virtualPath: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginFsWriteError";
    this.code = input.code;
    this.virtualPath = input.virtualPath;
  }
}

function writeError(input: {
  cause?: unknown;
  code: PluginFsWriteErrorCode;
  message: string;
  virtualPath: string;
}): PluginFsWriteError {
  return new PluginFsWriteError(input);
}

function hasPermission(
  context: PluginFsWriteContext,
  permission: string,
): boolean {
  return context.permissions.includes(permission);
}

function isProjectVirtualPath(virtualPath: string): boolean {
  return virtualPath === "." || virtualPath.startsWith("./");
}

function normalizeVirtualPathForMatch(virtualPath: string): string {
  if (virtualPath === "~") {
    return "~/";
  }
  if (virtualPath === ".") {
    return "./";
  }
  return virtualPath;
}

function virtualPathSegments(virtualPath: string): string[] {
  const normalized = normalizeVirtualPathForMatch(virtualPath);
  if (normalized === "~/" || normalized === "./") {
    return [];
  }
  return normalized.slice(2).split("/").filter(Boolean);
}

function virtualPathMatchesPattern(
  pattern: string,
  virtualPath: string,
): boolean {
  const normalizedPattern = normalizeVirtualPathForMatch(pattern);
  const normalizedVirtualPath = normalizeVirtualPathForMatch(virtualPath);
  if (normalizedPattern.slice(0, 2) !== normalizedVirtualPath.slice(0, 2)) {
    return false;
  }
  return globSegmentsMatch(
    virtualPathSegments(normalizedPattern),
    virtualPathSegments(normalizedVirtualPath),
  );
}

function pathMatchesAllowlist(
  allowlist: readonly string[] | undefined,
  virtualPath: string,
): boolean {
  return (allowlist ?? []).some(
    (pattern) =>
      typeof pattern === "string" &&
      virtualPathMatchesPattern(pattern, virtualPath),
  );
}

function pathMatchesDenylist(
  denylist: readonly string[] | undefined,
  virtualPath: string,
): boolean {
  return (denylist ?? []).some(
    (pattern) =>
      typeof pattern === "string" &&
      virtualPathMatchesPattern(pattern, virtualPath),
  );
}

function literalStaticPrefixSegments(pattern: string): string[] {
  const segments: string[] = [];
  for (const segment of virtualPathSegments(pattern)) {
    if (containsGlobPattern(segment)) {
      break;
    }
    segments.push(segment);
  }
  return segments;
}

function segmentsStartWith(
  candidateSegments: readonly string[],
  prefixSegments: readonly string[],
): boolean {
  return prefixSegments.every(
    (segment, index) => candidateSegments[index] === segment,
  );
}

function pathMayContainAllowlistedPath(
  allowlist: readonly string[] | undefined,
  virtualPath: string,
): boolean {
  if (pathMatchesAllowlist(allowlist, virtualPath)) {
    return true;
  }
  const candidateSegments = virtualPathSegments(virtualPath);
  return (allowlist ?? []).some((pattern) => {
    if (typeof pattern !== "string") {
      return false;
    }
    const prefixSegments = literalStaticPrefixSegments(pattern);
    return segmentsStartWith(prefixSegments, candidateSegments);
  });
}

type PluginFsOperationKind = "delete" | "read" | "write";

function operationStoragePermission(operation: PluginFsOperationKind): string {
  if (operation === "delete") {
    return REQUIRED_STORAGE_DELETE_PERMISSION;
  }
  if (operation === "write") {
    return REQUIRED_STORAGE_WRITE_PERMISSION;
  }
  return REQUIRED_STORAGE_READ_PERMISSION;
}

function operationProjectPermission(operation: PluginFsOperationKind): string {
  if (operation === "delete") {
    return REQUIRED_PROJECT_DELETE_PERMISSION;
  }
  if (operation === "write") {
    return REQUIRED_PROJECT_WRITE_PERMISSION;
  }
  return REQUIRED_PROJECT_READ_PERMISSION;
}

function operationProjectAllowlist(
  context: PluginFsWriteContext,
  operation: PluginFsOperationKind,
): readonly string[] | undefined {
  if (operation === "delete") {
    return context.filesDeleteAllowlist;
  }
  if (operation === "write") {
    return context.filesWriteAllowlist;
  }
  return context.filesReadAllowlist;
}

function operationProjectDenylist(
  context: PluginFsWriteContext,
  operation: PluginFsOperationKind,
): readonly string[] | undefined {
  if (operation === "delete") {
    return context.filesDeleteDenylist;
  }
  if (operation === "write") {
    return context.filesWriteDenylist;
  }
  return context.filesReadDenylist;
}

function operationDescription(operation: PluginFsOperationKind): string {
  if (operation === "delete") {
    return "deletes";
  }
  if (operation === "write") {
    return "writes";
  }
  return "reads";
}

function operationAllowlistName(operation: PluginFsOperationKind): string {
  if (operation === "delete") {
    return "files.allow.delete";
  }
  if (operation === "write") {
    return "files.allow.write";
  }
  return "files.allow.read";
}

function operationDenylistName(operation: PluginFsOperationKind): string {
  if (operation === "delete") {
    return "files.deny.delete";
  }
  if (operation === "write") {
    return "files.deny.write";
  }
  return "files.deny.read";
}

function operationNoun(operation: PluginFsOperationKind): string {
  if (operation === "delete") {
    return "delete";
  }
  if (operation === "write") {
    return "write";
  }
  return "read";
}

function assertContextAllowsPath(input: {
  allowDirectoryPrefix?: boolean;
  context: PluginFsWriteContext;
  operation: PluginFsOperationKind;
  virtualPath: string;
}): void {
  const { context, operation, virtualPath } = input;
  const storagePermission = operationStoragePermission(operation);
  if (!hasPermission(context, storagePermission)) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ${operationDescription(operation)} require ${storagePermission} permission.`,
      virtualPath,
    });
  }

  if (!isProjectVirtualPath(virtualPath)) {
    return;
  }

  assertPluginProjectRootContext({
    contextKind: context.contextKind,
    feature: `fs ./ ${operationDescription(operation)}`,
    projectRootPath: context.projectRootPath,
    threadRootPath: context.threadRootPath,
    virtualPath,
  });

  const projectPermission = operationProjectPermission(operation);
  if (!hasPermission(context, projectPermission)) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ./ ${operationDescription(operation)} require ${projectPermission} permission.`,
      virtualPath,
    });
  }

  const allowlist = operationProjectAllowlist(context, operation);
  if (
    !(input.allowDirectoryPrefix
      ? pathMayContainAllowlistedPath(allowlist, virtualPath)
      : pathMatchesAllowlist(allowlist, virtualPath))
  ) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ./ ${operationNoun(operation)} path is not covered by ${operationAllowlistName(operation)}.`,
      virtualPath,
    });
  }
  if (
    !input.allowDirectoryPrefix &&
    pathMatchesDenylist(
      operationProjectDenylist(context, operation),
      virtualPath,
    )
  ) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ./ ${operationNoun(operation)} path is denied by ${operationDenylistName(operation)}.`,
      virtualPath,
    });
  }
}

function resolvedRealVirtualPath(resolved: ResolvedPluginFsPath): string {
  return toPluginFsVirtualPath({
    absolutePath: resolved.realPath,
    rootKind: resolved.rootKind,
    rootPath: resolved.rootPath,
  });
}

function assertResolvedProjectPathAllowed(input: {
  allowDirectoryPrefix?: boolean;
  context: PluginFsWriteContext;
  operation: PluginFsOperationKind;
  resolved: ResolvedPluginFsPath;
}): void {
  if (input.resolved.rootKind === "pluginData") {
    return;
  }
  const allowlist = operationProjectAllowlist(input.context, input.operation);
  const realVirtualPath = resolvedRealVirtualPath(input.resolved);
  if (
    input.allowDirectoryPrefix
      ? !pathMayContainAllowlistedPath(allowlist, realVirtualPath)
      : !pathMatchesAllowlist(allowlist, realVirtualPath)
  ) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ./ ${input.operation} path is not covered by ${operationAllowlistName(input.operation)}.`,
      virtualPath: input.resolved.virtualPath,
    });
  }
  if (
    !input.allowDirectoryPrefix &&
    pathMatchesDenylist(
      operationProjectDenylist(input.context, input.operation),
      realVirtualPath,
    )
  ) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ./ ${input.operation} path is denied by ${operationDenylistName(input.operation)}.`,
      virtualPath: input.resolved.virtualPath,
    });
  }
}

async function resolvePathForOperation(input: {
  allowDirectoryPrefix?: boolean;
  context: PluginFsWriteContext;
  operation: PluginFsOperationKind;
  pathAccess: "delete" | "read" | "write";
  virtualPath: string;
}): Promise<ResolvedPluginFsPath> {
  assertContextAllowsPath({
    allowDirectoryPrefix: input.allowDirectoryPrefix ?? false,
    context: input.context,
    operation: input.operation,
    virtualPath: input.virtualPath,
  });
  // evaluatePluginCapability is an in-process typed gate; unexpected failures
  // intentionally propagate instead of being converted into allow/deny defaults.
  const decision = await evaluatePluginCapability({
    context: input.context,
    request: {
      access: input.operation,
      kind: "fs",
      pathAccess: input.pathAccess,
      virtualPath: input.virtualPath,
    },
  });
  if (!decision.allowed) {
    if (decision.code === "plugin_permission_error") {
      throw writeError({
        code: "permission_denied",
        message: `Plugin fs ${operationDescription(input.operation)} require ${operationStoragePermission(input.operation)} permission.`,
        virtualPath: input.virtualPath,
      });
    }
    throw new PluginContextError({
      code:
        decision.code === "project_context_unavailable"
          ? "project_context_unavailable"
          : "plugin_context_error",
      contextKind: input.context.contextKind,
      message: decision.message,
      virtualPath: input.virtualPath,
    });
  }
  if (!decision.resolvedPath) {
    throw writeError({
      code: `${input.operation}_failed` as PluginFsWriteErrorCode,
      message: "Plugin fs path could not be resolved.",
      virtualPath: input.virtualPath,
    });
  }
  const resolved = decision.resolvedPath;
  assertResolvedProjectPathAllowed({
    allowDirectoryPrefix: input.allowDirectoryPrefix ?? false,
    context: input.context,
    operation: input.operation,
    resolved,
  });
  return resolved;
}

async function revalidatePathForOperation(input: {
  context: PluginFsWriteContext;
  pathAccess: "delete" | "read" | "write";
  resolved: ResolvedPluginFsPath;
}): Promise<ResolvedPluginFsPath> {
  return await revalidateResolvedPluginFsPath({
    access: input.pathAccess,
    pluginPath: input.context.pluginPath,
    projectRootPath: input.context.projectRootPath,
    resolved: input.resolved,
    threadRootPath: input.context.threadRootPath,
  });
}

async function assertProjectSubtreeContainsNoDeniedPaths(input: {
  context: PluginFsWriteContext;
  operation: PluginFsOperationKind;
  resolved: ResolvedPluginFsPath;
}): Promise<void> {
  if (input.resolved.rootKind === "pluginData" || !input.resolved.exists) {
    return;
  }
  const denylist = operationProjectDenylist(input.context, input.operation);
  if (!denylist || denylist.length === 0) {
    return;
  }

  async function visit(absolutePath: string): Promise<void> {
    const virtualPath = toPluginFsVirtualPath({
      absolutePath,
      rootKind: input.resolved.rootKind,
      rootPath: input.resolved.rootPath,
    });
    if (pathMatchesDenylist(denylist, virtualPath)) {
      throw writeError({
        code: "permission_denied",
        message: `Plugin fs ./ ${input.operation} path is denied by ${operationDenylistName(input.operation)}.`,
        virtualPath,
      });
    }
    const stats = await lstat(absolutePath);
    if (!stats.isDirectory()) {
      return;
    }
    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      await visit(join(absolutePath, entry.name));
    }
  }

  await visit(input.resolved.realPath);
}

async function enforcePluginDataFileWriteQuota(input: {
  contents: string | Uint8Array;
  context: PluginFsWriteContext;
  resolved: ResolvedPluginFsPath;
}): Promise<void> {
  if (input.resolved.rootKind !== "pluginData") {
    return;
  }
  await enforcePluginDataQuotaForFileWrite({
    contents: input.contents,
    pluginPath: input.context.pluginPath,
    quota: input.context.quota,
    runGc: input.context.runGc,
    targetPath: input.resolved.realPath,
  });
}

async function enforcePluginDataDirectoryQuota(input: {
  context: PluginFsWriteContext;
  resolved: ResolvedPluginFsPath;
}): Promise<void> {
  if (input.resolved.rootKind !== "pluginData") {
    return;
  }
  await enforcePluginDataQuotaForDirectoryCreate({
    pluginPath: input.context.pluginPath,
    quota: input.context.quota,
    runGc: input.context.runGc,
    targetPath: input.resolved.realPath,
  });
}

async function assertProjectPathNotDenied(input: {
  absolutePath: string;
  context: PluginFsWriteContext;
  operation: PluginFsOperationKind;
  resolved: ResolvedPluginFsPath;
}): Promise<string> {
  const virtualPath = toPluginFsVirtualPath({
    absolutePath: input.absolutePath,
    rootKind: input.resolved.rootKind,
    rootPath: input.resolved.rootPath,
  });
  const denylist = operationProjectDenylist(input.context, input.operation);
  if (denylist && pathMatchesDenylist(denylist, virtualPath)) {
    throw writeError({
      code: "permission_denied",
      message: `Plugin fs ./ ${input.operation} path is denied by ${operationDenylistName(input.operation)}.`,
      virtualPath,
    });
  }
  return virtualPath;
}

function resolvedPathAtAbsolutePath(input: {
  absolutePath: string;
  resolved: ResolvedPluginFsPath;
}): ResolvedPluginFsPath {
  return {
    ...input.resolved,
    absolutePath: input.absolutePath,
    exists: true,
    realPath: input.absolutePath,
    virtualPath: toPluginFsVirtualPath({
      absolutePath: input.absolutePath,
      rootKind: input.resolved.rootKind,
      rootPath: input.resolved.rootPath,
    }),
  };
}

function writeValidatedPluginFsFile(
  resolved: ResolvedPluginFsPath,
  contents: string | Uint8Array,
): void {
  const bytes =
    typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : contents;
  const fd = openValidatedPluginFsPathSync({
    createIfMissing: true,
    flags: pluginFsWriteOpenFlags(),
    resolved,
  });
  try {
    writeValidatedPluginFsFileDescriptor({
      contents: bytes,
      fd,
      virtualPath: resolved.virtualPath,
    });
  } finally {
    closeValidatedPluginFsFileDescriptor(fd);
  }
}

function copyRegularFileNoFollow(
  source: ResolvedPluginFsPath,
  target: ResolvedPluginFsPath,
): void {
  const sourceFd = openValidatedPluginFsPathSync({
    flags: pluginFsReadOpenFlags(),
    resolved: source,
  });
  let targetFd: number | null = null;
  try {
    const sourceStats = fstatSync(sourceFd);
    if (!sourceStats.isFile()) {
      throw new Error("Plugin fs copy source is not a regular file.");
    }
    targetFd = openValidatedPluginFsPathSync({
      createIfMissing: true,
      flags: pluginFsWriteOpenFlags(),
      resolved: target,
    });
    const targetStats = fstatSync(targetFd);
    if (!targetStats.isFile()) {
      throw new Error("Plugin fs copy target is not a regular file.");
    }
    const buffer = Buffer.allocUnsafe(PLUGIN_FS_COPY_CHUNK_BYTES);
    let offset = 0;
    while (offset < sourceStats.size) {
      const bytesRead = readSync(
        sourceFd,
        buffer,
        0,
        Math.min(buffer.byteLength, sourceStats.size - offset),
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      writeSync(targetFd, buffer.subarray(0, bytesRead), 0, bytesRead, offset);
      offset += bytesRead;
    }
    ftruncateSync(targetFd, offset);
  } finally {
    closeValidatedPluginFsFileDescriptor(sourceFd);
    if (targetFd !== null) {
      closeValidatedPluginFsFileDescriptor(targetFd);
    }
  }
}

async function copyProjectSubtreeSafely(input: {
  context: PluginFsWriteContext;
  source: ResolvedPluginFsPath;
  sourcePath: string;
  targetPath: string;
}): Promise<void> {
  const virtualPath = await assertProjectPathNotDenied({
    absolutePath: input.sourcePath,
    context: input.context,
    operation: "read",
    resolved: input.source,
  });
  const stats = await lstat(input.sourcePath);
  if (stats.isSymbolicLink()) {
    throw writeError({
      code: "permission_denied",
      message:
        "Plugin fs recursive copy does not allow symlinks in project subtrees.",
      virtualPath,
    });
  }
  if (!stats.isDirectory()) {
    copyRegularFileNoFollow(
      resolvedPathAtAbsolutePath({
        absolutePath: input.sourcePath,
        resolved: input.source,
      }),
      resolvedPathAtAbsolutePath({
        absolutePath: input.targetPath,
        resolved: input.source,
      }),
    );
    return;
  }
  mkdirValidatedPluginFsPathSync({
    options: { recursive: true },
    resolved: resolvedPathAtAbsolutePath({
      absolutePath: input.targetPath,
      resolved: input.source,
    }),
  });
  for (const entry of await readdir(input.sourcePath, {
    withFileTypes: true,
  })) {
    await copyProjectSubtreeSafely({
      context: input.context,
      source: input.source,
      sourcePath: join(input.sourcePath, entry.name),
      targetPath: join(input.targetPath, entry.name),
    });
  }
}

async function removeProjectSubtreeSafely(input: {
  context: PluginFsWriteContext;
  resolved: ResolvedPluginFsPath;
  targetPath: string;
}): Promise<void> {
  const virtualPath = await assertProjectPathNotDenied({
    absolutePath: input.targetPath,
    context: input.context,
    operation: "delete",
    resolved: input.resolved,
  });
  const stats = await lstat(input.targetPath);
  if (stats.isSymbolicLink()) {
    throw writeError({
      code: "permission_denied",
      message:
        "Plugin fs recursive delete does not allow symlinks in project subtrees.",
      virtualPath,
    });
  }
  if (!stats.isDirectory()) {
    await unlink(input.targetPath);
    return;
  }
  for (const entry of await readdir(input.targetPath, {
    withFileTypes: true,
  })) {
    await removeProjectSubtreeSafely({
      context: input.context,
      resolved: input.resolved,
      targetPath: join(input.targetPath, entry.name),
    });
  }
  await removeDirectory(input.targetPath);
}

async function enforcePluginDataCopyQuota(input: {
  context: PluginFsWriteContext;
  source: ResolvedPluginFsPath;
  target: ResolvedPluginFsPath;
}): Promise<void> {
  if (input.target.rootKind !== "pluginData") {
    return;
  }
  await enforcePluginDataQuotaForPathCopy({
    pluginPath: input.context.pluginPath,
    quota: input.context.quota,
    runGc: input.context.runGc,
    sourcePath: input.source.realPath,
    targetPath: input.target.realPath,
  });
}

async function enforcePluginDataMoveQuota(input: {
  context: PluginFsWriteContext;
  source: ResolvedPluginFsPath;
  target: ResolvedPluginFsPath;
}): Promise<void> {
  if (input.target.rootKind !== "pluginData") {
    return;
  }
  await enforcePluginDataQuotaForPathMove({
    pluginPath: input.context.pluginPath,
    quota: input.context.quota,
    runGc: input.context.runGc,
    sourceCountsAgainstPluginDataUsage: input.source.rootKind === "pluginData",
    sourcePath: input.source.realPath,
    targetPath: input.target.realPath,
  });
}

export async function pluginFsWrite(
  context: PluginFsWriteContext,
  virtualPath: string,
  contents: string | Uint8Array,
): Promise<void> {
  const resolved = await resolvePathForOperation({
    context,
    operation: "write",
    pathAccess: "write",
    virtualPath,
  });
  await enforcePluginDataFileWriteQuota({ contents, context, resolved });
  const revalidated = await revalidatePathForOperation({
    context,
    pathAccess: "write",
    resolved,
  });
  try {
    writeValidatedPluginFsFile(revalidated, contents);
  } catch (error) {
    throw writeError({
      cause: error,
      code: "write_failed",
      message: "Plugin fs file could not be written.",
      virtualPath: resolved.virtualPath,
    });
  }
}

export async function pluginFsWriteText(
  context: PluginFsWriteContext,
  virtualPath: string,
  contents: string,
): Promise<void> {
  await pluginFsWrite(context, virtualPath, contents);
}

export async function pluginFsMkdir(
  context: PluginFsWriteContext,
  virtualPath: string,
  options?: { recursive?: boolean | undefined },
): Promise<void> {
  const resolved = await resolvePathForOperation({
    context,
    operation: "write",
    pathAccess: "write",
    virtualPath,
  });
  await enforcePluginDataDirectoryQuota({ context, resolved });
  const revalidated = await revalidatePathForOperation({
    context,
    pathAccess: "write",
    resolved,
  });
  try {
    mkdirValidatedPluginFsPathSync({
      options: { recursive: options?.recursive ?? false },
      resolved: revalidated,
    });
  } catch (error) {
    throw writeError({
      cause: error,
      code: "mkdir_failed",
      message: "Plugin fs directory could not be created.",
      virtualPath: resolved.virtualPath,
    });
  }
}

export async function pluginFsRm(
  context: PluginFsWriteContext,
  virtualPath: string,
  options?: { force?: boolean | undefined; recursive?: boolean | undefined },
): Promise<void> {
  const resolved = await resolvePathForOperation({
    context,
    operation: "delete",
    pathAccess: "delete",
    virtualPath,
  });
  const revalidated = await revalidatePathForOperation({
    context,
    pathAccess: "delete",
    resolved,
  });
  try {
    if (options?.recursive && revalidated.rootKind !== "pluginData") {
      await removeProjectSubtreeSafely({
        context,
        resolved: revalidated,
        targetPath: revalidated.realPath,
      });
      return;
    }
    await rm(revalidated.realPath, {
      force: options?.force ?? false,
      recursive: options?.recursive ?? false,
    });
  } catch (error) {
    if (error instanceof PluginFsWriteError) {
      throw error;
    }
    throw writeError({
      cause: error,
      code: "delete_failed",
      message: "Plugin fs path could not be removed.",
      virtualPath: resolved.virtualPath,
    });
  }
}

export async function pluginFsRmdir(
  context: PluginFsWriteContext,
  virtualPath: string,
): Promise<void> {
  const resolved = await resolvePathForOperation({
    context,
    operation: "delete",
    pathAccess: "delete",
    virtualPath,
  });
  const revalidated = await revalidatePathForOperation({
    context,
    pathAccess: "delete",
    resolved,
  });
  const stats = await lstat(revalidated.realPath);
  if (!stats.isDirectory()) {
    throw writeError({
      code: "not_a_directory",
      message: "Plugin fs rmdir requires a directory path.",
      virtualPath: resolved.virtualPath,
    });
  }
  try {
    await removeDirectory(revalidated.realPath);
  } catch (error) {
    if (error instanceof PluginFsWriteError) {
      throw error;
    }
    throw writeError({
      cause: error,
      code: "delete_failed",
      message: "Plugin fs directory could not be removed.",
      virtualPath: resolved.virtualPath,
    });
  }
}

export async function pluginFsCopy(
  context: PluginFsWriteContext,
  fromVirtualPath: string,
  toVirtualPath: string,
): Promise<void> {
  const source = await resolvePathForOperation({
    context,
    operation: "read",
    pathAccess: "read",
    virtualPath: fromVirtualPath,
  });
  const target = await resolvePathForOperation({
    context,
    operation: "write",
    pathAccess: "write",
    virtualPath: toVirtualPath,
  });
  await enforcePluginDataCopyQuota({ context, source, target });
  const revalidatedSource = await revalidatePathForOperation({
    context,
    pathAccess: "read",
    resolved: source,
  });
  const revalidatedTarget = await revalidatePathForOperation({
    context,
    pathAccess: "write",
    resolved: target,
  });
  const stats = await lstat(revalidatedSource.realPath);
  if (stats.isDirectory()) {
    await assertProjectSubtreeContainsNoDeniedPaths({
      context,
      operation: "read",
      resolved: revalidatedSource,
    });
    await assertProjectSubtreeContainsNoDeniedPaths({
      context,
      operation: "write",
      resolved: revalidatedTarget,
    });
  }
  try {
    if (stats.isDirectory()) {
      if (revalidatedSource.rootKind !== "pluginData") {
        await copyProjectSubtreeSafely({
          context,
          source: revalidatedSource,
          sourcePath: revalidatedSource.realPath,
          targetPath: revalidatedTarget.realPath,
        });
        return;
      }
      await cp(revalidatedSource.realPath, revalidatedTarget.realPath, {
        force: true,
        recursive: true,
      });
      return;
    }
    await copyRegularFileNoFollow(revalidatedSource, revalidatedTarget);
  } catch (error) {
    if (error instanceof PluginFsWriteError) {
      throw error;
    }
    throw writeError({
      cause: error,
      code: "copy_failed",
      message: "Plugin fs path could not be copied.",
      virtualPath: toVirtualPath,
    });
  }
}

export async function pluginFsMove(
  context: PluginFsWriteContext,
  fromVirtualPath: string,
  toVirtualPath: string,
): Promise<void> {
  const source = await resolvePathForOperation({
    context,
    operation: "read",
    pathAccess: "read",
    virtualPath: fromVirtualPath,
  });
  await resolvePathForOperation({
    context,
    operation: "delete",
    pathAccess: "delete",
    virtualPath: fromVirtualPath,
  });
  const target = await resolvePathForOperation({
    context,
    operation: "write",
    pathAccess: "write",
    virtualPath: toVirtualPath,
  });
  await enforcePluginDataMoveQuota({ context, source, target });
  const revalidatedSource = await revalidatePathForOperation({
    context,
    pathAccess: "delete",
    resolved: source,
  });
  const revalidatedTarget = await revalidatePathForOperation({
    context,
    pathAccess: "write",
    resolved: target,
  });
  const sourceStats = await lstat(revalidatedSource.realPath);
  if (sourceStats.isDirectory()) {
    await assertProjectSubtreeContainsNoDeniedPaths({
      context,
      operation: "delete",
      resolved: revalidatedSource,
    });
    await assertProjectSubtreeContainsNoDeniedPaths({
      context,
      operation: "write",
      resolved: revalidatedTarget,
    });
  }
  try {
    if (
      sourceStats.isDirectory() &&
      revalidatedSource.rootKind !== "pluginData"
    ) {
      await copyProjectSubtreeSafely({
        context,
        source: revalidatedSource,
        sourcePath: revalidatedSource.realPath,
        targetPath: revalidatedTarget.realPath,
      });
      await removeProjectSubtreeSafely({
        context,
        resolved: revalidatedSource,
        targetPath: revalidatedSource.realPath,
      });
      return;
    }
    await rename(revalidatedSource.realPath, revalidatedTarget.realPath);
  } catch (error) {
    if (error instanceof PluginFsWriteError) {
      throw error;
    }
    throw writeError({
      cause: error,
      code: "move_failed",
      message: "Plugin fs path could not be moved.",
      virtualPath: toVirtualPath,
    });
  }
}
