/**
 * @file src/bun/plugin/fs-path.ts
 * @description Shared virtual path resolution and containment checks for Plugin System v1 metidos.fs operations.
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  type Stats,
  writeSync,
} from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { resolvePluginDataDirectoryPath } from "./data";

const FORBIDDEN_DIRECTORY_NAMES = new Set([".git", ".ssh"]);

export type PluginFsRootKind = "pluginData" | "project" | "thread";

export type PluginFsPathAccess = "delete" | "read" | "write";

export type PluginFsPathErrorCode =
  | "forbidden_directory"
  | "invalid_virtual_path"
  | "missing_project_context"
  | "path_outside_root"
  | "path_unavailable"
  | "plugin_source_denied"
  | "root_unavailable";

export type ResolvePluginFsVirtualPathInput = {
  /**
   * The approved plugin installation directory. Used for ~/ mapping and for
   * denying access to the plugin's own source/manifest files through ./ roots.
   */
  pluginPath: string;
  /**
   * Optional current project/worktree root for ./ paths.
   */
  projectRootPath?: string | null | undefined;
  /**
   * Optional narrower thread root for ./ paths. When present it wins over the
   * project root because a thread context is more specific.
   */
  threadRootPath?: string | null | undefined;
  /**
   * read/delete require the final path to exist. write permits a missing leaf
   * after realpathing the nearest existing parent.
   */
  access?: PluginFsPathAccess;
  /**
   * Plugin-supplied virtual path. ~/ maps to .data; ./ maps to the current
   * thread/project root when available.
   */
  virtualPath: string;
};

export type ResolvedPluginFsPath = {
  absolutePath: string;
  exists: boolean;
  realPath: string;
  rootKind: PluginFsRootKind;
  rootPath: string;
  /**
   * Canonical virtual path used for same-turn revalidation. Callers that keep a
   * resolved path across any async boundary before filesystem access should run
   * revalidateResolvedPluginFsPath() immediately before use so symlink swaps or
   * missing-parent changes are caught by the same containment policy.
   */
  virtualPath: string;
};

export class PluginFsPathError extends Error {
  readonly code: PluginFsPathErrorCode;
  readonly virtualPath: string;

  constructor(input: {
    code: PluginFsPathErrorCode;
    message: string;
    virtualPath: string;
  }) {
    super(input.message);
    this.name = "PluginFsPathError";
    this.code = input.code;
    this.virtualPath = input.virtualPath;
  }
}

function pluginFsPathError(input: {
  code: PluginFsPathErrorCode;
  message: string;
  virtualPath: string;
}): PluginFsPathError {
  return new PluginFsPathError(input);
}

function pathIsContainedByDirectory(
  parentDirectoryPath: string,
  candidatePath: string,
): boolean {
  const relativePath = relative(
    resolve(parentDirectoryPath),
    resolve(candidatePath),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isMissingFileSystemError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function pathExistsOrIsSymlink(path: string): Promise<boolean> {
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

async function nearestExistingPathWithinRoot(
  rootPath: string,
  targetPath: string,
): Promise<string | null> {
  let currentPath = targetPath;
  while (!(await pathExistsOrIsSymlink(currentPath))) {
    if (currentPath === rootPath) {
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

function normalizedVirtualPath(input: {
  rootKind: PluginFsRootKind;
  segments: readonly string[];
}): string {
  if (input.rootKind === "pluginData") {
    return input.segments.length > 0 ? `~/${input.segments.join("/")}` : "~/";
  }
  return input.segments.length > 0 ? `./${input.segments.join("/")}` : "./";
}

function parsePluginFsVirtualPath(input: ResolvePluginFsVirtualPathInput): {
  rootKind: PluginFsRootKind;
  rootPath: string;
  segments: string[];
  virtualPath: string;
} {
  const { virtualPath } = input;
  if (virtualPath.includes("\0")) {
    throw pluginFsPathError({
      code: "invalid_virtual_path",
      message: "Plugin fs virtual paths cannot contain NUL bytes.",
      virtualPath,
    });
  }

  let rootKind: PluginFsRootKind;
  let rootPath: string;
  let remainder: string;
  if (virtualPath === "~" || virtualPath.startsWith("~/")) {
    rootKind = "pluginData";
    rootPath = resolvePluginDataDirectoryPath(input.pluginPath);
    remainder = virtualPath === "~" ? "" : virtualPath.slice(2);
  } else if (virtualPath === "." || virtualPath.startsWith("./")) {
    const contextRootPath = input.threadRootPath ?? input.projectRootPath;
    if (!contextRootPath) {
      throw pluginFsPathError({
        code: "missing_project_context",
        message:
          "Plugin fs ./ paths require a current thread or project context.",
        virtualPath,
      });
    }
    rootKind = input.threadRootPath ? "thread" : "project";
    rootPath = contextRootPath;
    remainder = virtualPath === "." ? "" : virtualPath.slice(2);
  } else {
    throw pluginFsPathError({
      code: "invalid_virtual_path",
      message: "Plugin fs virtual paths must start with ~/ or ./.",
      virtualPath,
    });
  }

  const segments: string[] = [];
  const segmentSource =
    process.platform === "win32"
      ? splitRelativePathSegments(remainder)
      : remainder.split("/");
  for (const segment of segmentSource) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw pluginFsPathError({
        code: "path_outside_root",
        message: "Plugin fs virtual path traversal is denied.",
        virtualPath,
      });
    }
    if (FORBIDDEN_DIRECTORY_NAMES.has(segment)) {
      throw pluginFsPathError({
        code: "forbidden_directory",
        message: "Plugin fs access to .git and .ssh is denied.",
        virtualPath,
      });
    }
    segments.push(segment);
  }

  return {
    rootKind,
    rootPath: resolve(rootPath),
    segments,
    virtualPath: normalizedVirtualPath({ rootKind, segments }),
  };
}

export function splitRelativePathSegments(relativePath: string): string[] {
  if (!relativePath) {
    return [];
  }
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

function relativeSegments(input: {
  rootPath: string;
  targetPath: string;
}): string[] {
  return splitRelativePathSegments(relative(input.rootPath, input.targetPath));
}

function assertNoForbiddenRealPathSegments(input: {
  realRootPath: string;
  realPath: string;
  virtualPath: string;
}): void {
  for (const segment of relativeSegments({
    rootPath: input.realRootPath,
    targetPath: input.realPath,
  })) {
    if (FORBIDDEN_DIRECTORY_NAMES.has(segment)) {
      throw pluginFsPathError({
        code: "forbidden_directory",
        message: "Plugin fs access to .git and .ssh is denied.",
        virtualPath: input.virtualPath,
      });
    }
  }
}

async function realpathExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (process.platform === "win32" || !path.includes("\\")) {
      throw error;
    }
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw error;
    }
    const parentPath = dirname(path);
    if (parentPath === path) {
      throw error;
    }
    return resolve(await realpathExistingPath(parentPath), basename(path));
  }
}

async function realpathRoot(input: {
  rootPath: string;
  virtualPath: string;
}): Promise<string> {
  // Intentionally resolve the fs root on each call. Plugin/worktree roots can
  // disappear or be swapped while a plugin is active, and high-frequency callers
  // should first prove this path is hot before adding lifecycle invalidation for
  // cached realpaths.
  try {
    return await realpathExistingPath(input.rootPath);
  } catch (_error) {
    throw pluginFsPathError({
      code: "root_unavailable",
      message: "Plugin fs root is unavailable.",
      virtualPath: input.virtualPath,
    });
  }
}

async function assertOutsidePluginSource(input: {
  pluginPath: string;
  realPath: string;
  rootKind: PluginFsRootKind;
  virtualPath: string;
}): Promise<void> {
  if (input.rootKind === "pluginData") {
    return;
  }

  let realPluginPath: string;
  try {
    realPluginPath = await realpathExistingPath(input.pluginPath);
  } catch {
    throw pluginFsPathError({
      code: "plugin_source_denied",
      message: "Plugin fs access to plugin source files is denied.",
      virtualPath: input.virtualPath,
    });
  }

  if (pathIsContainedByDirectory(realPluginPath, input.realPath)) {
    throw pluginFsPathError({
      code: "plugin_source_denied",
      message: "Plugin fs access to plugin source files is denied.",
      virtualPath: input.virtualPath,
    });
  }
}

export function toPluginFsVirtualPath(input: {
  absolutePath: string;
  rootKind: PluginFsRootKind;
  rootPath: string;
}): string {
  const relativePath = relative(
    resolve(input.rootPath),
    resolve(input.absolutePath),
  );
  const segments = splitRelativePathSegments(relativePath);
  return normalizedVirtualPath({ rootKind: input.rootKind, segments });
}

export async function resolvePluginFsVirtualPath(
  input: ResolvePluginFsVirtualPathInput,
): Promise<ResolvedPluginFsPath> {
  const access = input.access ?? "read";
  const parsed = parsePluginFsVirtualPath(input);
  const targetPath = resolve(parsed.rootPath, ...parsed.segments);
  if (!pathIsContainedByDirectory(parsed.rootPath, targetPath)) {
    throw pluginFsPathError({
      code: "path_outside_root",
      message: "Plugin fs virtual path escaped its allowed root.",
      virtualPath: input.virtualPath,
    });
  }

  const realRootPath = await realpathRoot({
    rootPath: parsed.rootPath,
    virtualPath: parsed.virtualPath,
  });
  const nearestPath = await nearestExistingPathWithinRoot(
    parsed.rootPath,
    targetPath,
  );
  if (!nearestPath) {
    throw pluginFsPathError({
      code: "root_unavailable",
      message: "Plugin fs root is unavailable.",
      virtualPath: parsed.virtualPath,
    });
  }

  const exists = nearestPath === targetPath;
  if (!exists && access !== "write") {
    throw pluginFsPathError({
      code: "path_unavailable",
      message: "Plugin fs path is unavailable.",
      virtualPath: parsed.virtualPath,
    });
  }

  let realNearestPath: string;
  try {
    realNearestPath = await realpathExistingPath(nearestPath);
  } catch {
    throw pluginFsPathError({
      code: "path_outside_root",
      message: "Plugin fs path could not be safely resolved.",
      virtualPath: parsed.virtualPath,
    });
  }

  if (!pathIsContainedByDirectory(realRootPath, realNearestPath)) {
    throw pluginFsPathError({
      code: "path_outside_root",
      message: "Plugin fs symlink escape is denied.",
      virtualPath: parsed.virtualPath,
    });
  }

  const unresolvedSuffix = relative(nearestPath, targetPath);
  const realPath = unresolvedSuffix
    ? resolve(realNearestPath, unresolvedSuffix)
    : realNearestPath;
  if (!pathIsContainedByDirectory(realRootPath, realPath)) {
    throw pluginFsPathError({
      code: "path_outside_root",
      message: "Plugin fs path escaped its allowed root.",
      virtualPath: parsed.virtualPath,
    });
  }

  assertNoForbiddenRealPathSegments({
    realPath,
    realRootPath,
    virtualPath: parsed.virtualPath,
  });
  await assertOutsidePluginSource({
    pluginPath: input.pluginPath,
    realPath,
    rootKind: parsed.rootKind,
    virtualPath: parsed.virtualPath,
  });

  return {
    absolutePath: targetPath,
    exists,
    realPath,
    rootKind: parsed.rootKind,
    rootPath: parsed.rootPath,
    virtualPath: parsed.virtualPath,
  };
}

export async function revalidateResolvedPluginFsPath(input: {
  access?: PluginFsPathAccess;
  pluginPath: string;
  projectRootPath?: string | null | undefined;
  resolved: ResolvedPluginFsPath;
  threadRootPath?: string | null | undefined;
}): Promise<ResolvedPluginFsPath> {
  const current = await resolvePluginFsVirtualPath({
    ...(input.access === undefined ? {} : { access: input.access }),
    pluginPath: input.pluginPath,
    projectRootPath: input.projectRootPath,
    threadRootPath: input.threadRootPath,
    virtualPath: input.resolved.virtualPath,
  });
  if (
    current.realPath !== input.resolved.realPath ||
    current.rootKind !== input.resolved.rootKind ||
    current.rootPath !== input.resolved.rootPath ||
    current.virtualPath !== input.resolved.virtualPath
  ) {
    throw pluginFsPathError({
      code: "path_outside_root",
      message: "Plugin fs path changed during safety revalidation.",
      virtualPath: input.resolved.virtualPath,
    });
  }
  return current;
}

export function pluginFsVirtualRootForPath(
  rootKind: PluginFsRootKind,
): "~/" | "./" {
  return rootKind === "pluginData" ? "~/" : "./";
}

export function pluginFsReadOpenFlags(): number {
  return process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
}

export function pluginFsWriteOpenFlags(): number {
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC;
  return process.platform === "win32" ? flags : flags | fsConstants.O_NOFOLLOW;
}

function assertPluginFsLstatIsNotSymlink(input: {
  stats: Stats;
  virtualPath: string;
}): void {
  if (input.stats.isSymbolicLink()) {
    throw pluginFsPathError({
      code: "path_outside_root",
      message: "Plugin fs symlink access is denied.",
      virtualPath: input.virtualPath,
    });
  }
}

function pluginFsPathOpenUnavailableError(
  virtualPath: string,
): PluginFsPathError {
  return pluginFsPathError({
    code: "path_unavailable",
    message: "Plugin fs path could not be opened safely.",
    virtualPath,
  });
}

export type OpenValidatedPluginFsPathInput = {
  /**
   * When true, a missing leaf path is permitted before open (write/create).
   */
  createIfMissing?: boolean;
  flags: number;
  resolved: ResolvedPluginFsPath;
};

/**
 * Opens a validated plugin fs path with a synchronous lstat/open pair so the
 * async revalidation window cannot be widened by additional awaits before open.
 * On platforms without O_NOFOLLOW, lstat rejects symlink leaves first.
 */
export function openValidatedPluginFsPathSync(
  input: OpenValidatedPluginFsPathInput,
): number {
  const { realPath, virtualPath } = input.resolved;
  let stats: Stats | undefined;
  try {
    stats = lstatSync(realPath);
    assertPluginFsLstatIsNotSymlink({ stats, virtualPath });
  } catch (error) {
    if (
      input.createIfMissing &&
      isMissingFileSystemError(error) &&
      (input.flags & fsConstants.O_CREAT) !== 0
    ) {
      stats = undefined;
    } else if (error instanceof PluginFsPathError) {
      throw error;
    } else if (isMissingFileSystemError(error)) {
      throw pluginFsPathError({
        code: "path_unavailable",
        message: "Plugin fs path is unavailable.",
        virtualPath,
      });
    } else {
      throw error;
    }
  }

  try {
    return openSync(
      realPath,
      input.flags,
      (input.flags & fsConstants.O_CREAT) !== 0 ? 0o666 : undefined,
    );
  } catch {
    throw pluginFsPathOpenUnavailableError(virtualPath);
  }
}

export function mkdirValidatedPluginFsPathSync(input: {
  options?: { recursive?: boolean | undefined };
  resolved: ResolvedPluginFsPath;
}): void {
  const { realPath, virtualPath } = input.resolved;
  try {
    const stats = lstatSync(realPath);
    assertPluginFsLstatIsNotSymlink({ stats, virtualPath });
    if (stats.isDirectory()) {
      return;
    }
  } catch (error) {
    if (error instanceof PluginFsPathError) {
      throw error;
    }
    if (!isMissingFileSystemError(error)) {
      throw error;
    }
  }

  try {
    mkdirSync(realPath, { recursive: input.options?.recursive ?? false });
  } catch {
    throw pluginFsPathError({
      code: "path_unavailable",
      message: "Plugin fs directory could not be created safely.",
      virtualPath,
    });
  }
}

export function readValidatedPluginFsFileDescriptor(input: {
  fd: number;
  maxBytes: number;
  virtualPath: string;
}): Uint8Array {
  const stats = fstatSync(input.fd);
  if (!stats.isFile()) {
    throw pluginFsPathError({
      code: "path_unavailable",
      message: "Plugin fs read requires a file path.",
      virtualPath: input.virtualPath,
    });
  }
  if (stats.size > input.maxBytes) {
    throw pluginFsPathError({
      code: "path_unavailable",
      message: `Plugin fs read is limited to ${input.maxBytes} bytes.`,
      virtualPath: input.virtualPath,
    });
  }

  const output = new Uint8Array(stats.size);
  let offset = 0;
  while (offset < stats.size) {
    const bytesRead = readSync(
      input.fd,
      output,
      offset,
      Math.min(stats.size - offset, 64 * 1024),
      offset,
    );
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  if (offset > input.maxBytes) {
    throw pluginFsPathError({
      code: "path_unavailable",
      message: `Plugin fs read is limited to ${input.maxBytes} bytes.`,
      virtualPath: input.virtualPath,
    });
  }
  return output.subarray(0, offset);
}

export function writeValidatedPluginFsFileDescriptor(input: {
  contents: Uint8Array;
  fd: number;
  virtualPath: string;
}): void {
  const stats = fstatSync(input.fd);
  if (!stats.isFile()) {
    throw pluginFsPathError({
      code: "path_unavailable",
      message: "Plugin fs write target is not a regular file.",
      virtualPath: input.virtualPath,
    });
  }

  let offset = 0;
  while (offset < input.contents.byteLength) {
    const bytesWritten = writeSync(
      input.fd,
      input.contents,
      offset,
      input.contents.byteLength - offset,
      offset,
    );
    if (bytesWritten <= 0) {
      throw new Error("Plugin fs write made no progress.");
    }
    offset += bytesWritten;
  }
  ftruncateSync(input.fd, input.contents.byteLength);
}

export function closeValidatedPluginFsFileDescriptor(fd: number): void {
  closeSync(fd);
}
