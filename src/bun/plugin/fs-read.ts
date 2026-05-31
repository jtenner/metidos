/**
 * @file src/bun/plugin/fs-read.ts
 * @description Safe Plugin System v1 metidos.fs read operations.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { evaluatePluginCapability } from "./capability-gate";
import { containsGlobPattern, globSegmentsMatch } from "./glob-match";
import {
  assertPluginProjectRootContext,
  type PluginCallbackContextKind,
  PluginContextError,
} from "./context";
import {
  closeValidatedPluginFsFileDescriptor,
  openValidatedPluginFsPathSync,
  PluginFsPathError,
  type PluginFsRootKind,
  pluginFsReadOpenFlags,
  pluginFsVirtualRootForPath,
  type ResolvedPluginFsPath,
  readValidatedPluginFsFileDescriptor,
  resolvePluginFsVirtualPath,
  revalidateResolvedPluginFsPath,
  toPluginFsVirtualPath,
} from "./fs-path";

const REQUIRED_STORAGE_READ_PERMISSION = "storage:read";
const REQUIRED_PROJECT_READ_PERMISSION = "files:read";
const FORBIDDEN_DIRECTORY_NAMES = new Set([".git", ".ssh"]);
export const MAX_PLUGIN_FS_READ_BYTES = 5 * 1024 * 1024;
export const MAX_PLUGIN_FS_GLOB_CANDIDATES = 10_000;
export const MAX_PLUGIN_FS_GLOB_RESULTS = 2_000;
const MAX_PLUGIN_FS_GLOB_RECURSION_DEPTH = 64;

export type PluginFsReadContextKind = PluginCallbackContextKind;

export type PluginFsReadContext = {
  contextKind: PluginFsReadContextKind;
  filesReadAllowlist?: readonly string[];
  filesReadDenylist?: readonly string[];
  permissions: readonly string[];
  pluginPath: string;
  projectRootPath?: string | null;
  threadRootPath?: string | null;
};

export type PluginFsEntryKind = "directory" | "file" | "other" | "symlink";

export type PluginFsDirectoryEntry = {
  kind: PluginFsEntryKind;
  name: string;
  virtualPath: string;
};

export type PluginFsStat = {
  kind: PluginFsEntryKind;
  mtimeMs: number;
  size: number;
  virtualPath: string;
};

export type PluginFsReadErrorCode =
  | "invalid_glob_pattern"
  | "not_a_directory"
  | "not_a_file"
  | "permission_denied"
  | "read_failed";

export class PluginFsReadError extends Error {
  readonly code: PluginFsReadErrorCode;
  readonly virtualPath: string;

  constructor(input: {
    cause?: unknown;
    code: PluginFsReadErrorCode;
    message: string;
    virtualPath: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginFsReadError";
    this.code = input.code;
    this.virtualPath = input.virtualPath;
  }
}

function readError(input: {
  cause?: unknown;
  code: PluginFsReadErrorCode;
  message: string;
  virtualPath: string;
}): PluginFsReadError {
  return new PluginFsReadError(input);
}

function hasPermission(
  context: PluginFsReadContext,
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

function projectPathMatchesReadAllowlist(
  context: PluginFsReadContext,
  virtualPath: string,
): boolean {
  return (context.filesReadAllowlist ?? []).some(
    (pattern) =>
      typeof pattern === "string" &&
      virtualPathMatchesPattern(pattern, virtualPath),
  );
}

function projectPathMatchesReadDenylist(
  context: PluginFsReadContext,
  virtualPath: string,
): boolean {
  return (context.filesReadDenylist ?? []).some(
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

function projectPathMayContainAllowedRead(
  context: PluginFsReadContext,
  virtualPath: string,
): boolean {
  if (projectPathMatchesReadAllowlist(context, virtualPath)) {
    return true;
  }
  const candidateSegments = virtualPathSegments(virtualPath);
  return (context.filesReadAllowlist ?? []).some((pattern) => {
    if (typeof pattern !== "string") {
      return false;
    }
    const prefixSegments = literalStaticPrefixSegments(pattern);
    return segmentsStartWith(prefixSegments, candidateSegments);
  });
}

async function assertReadContextAllowsPath(input: {
  access?: "read" | "write";
  allowDirectoryPrefix?: boolean;
  context: PluginFsReadContext;
  virtualPath: string;
}): Promise<ResolvedPluginFsPath> {
  const { context, virtualPath } = input;
  if (!hasPermission(context, REQUIRED_STORAGE_READ_PERMISSION)) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs reads require storage:read permission.",
      virtualPath,
    });
  }

  // evaluatePluginCapability is an in-process typed gate; unexpected failures
  // intentionally propagate instead of being converted into allow/deny defaults.
  const decision = await evaluatePluginCapability({
    context,
    request: {
      access: "read",
      kind: "fs",
      pathAccess: input.access ?? "read",
      virtualPath,
    },
  });
  if (!decision.allowed) {
    if (decision.code === "plugin_permission_error") {
      throw readError({
        code: "permission_denied",
        message: "Plugin fs ./ reads require files:read permission.",
        virtualPath,
      });
    }
    throw new PluginContextError({
      code:
        decision.code === "project_context_unavailable"
          ? "project_context_unavailable"
          : "plugin_context_error",
      contextKind: context.contextKind,
      message: decision.message,
      virtualPath,
    });
  }

  if (!decision.resolvedPath) {
    throw readError({
      code: "read_failed",
      message: "Plugin fs path could not be resolved.",
      virtualPath,
    });
  }

  if (!isProjectVirtualPath(virtualPath)) {
    return decision.resolvedPath;
  }
  if (
    !(input.allowDirectoryPrefix
      ? projectPathMayContainAllowedRead(context, virtualPath)
      : projectPathMatchesReadAllowlist(context, virtualPath))
  ) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs ./ read path is not covered by files.allow.read.",
      virtualPath,
    });
  }
  if (
    !input.allowDirectoryPrefix &&
    projectPathMatchesReadDenylist(context, virtualPath)
  ) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs ./ read path is denied by files.deny.read.",
      virtualPath,
    });
  }
  return decision.resolvedPath;
}

function assertReadContextAllowsGlob(
  context: PluginFsReadContext,
  virtualPath: string,
): void {
  if (!hasPermission(context, REQUIRED_STORAGE_READ_PERMISSION)) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs reads require storage:read permission.",
      virtualPath,
    });
  }
  if (!isProjectVirtualPath(virtualPath)) {
    return;
  }
  assertPluginProjectRootContext({
    contextKind: context.contextKind,
    feature: "fs ./ reads",
    projectRootPath: context.projectRootPath,
    threadRootPath: context.threadRootPath,
    virtualPath,
  });
  if (!hasPermission(context, REQUIRED_PROJECT_READ_PERMISSION)) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs ./ reads require files:read permission.",
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
  context: PluginFsReadContext;
  resolved: ResolvedPluginFsPath;
}): void {
  if (input.resolved.rootKind === "pluginData") {
    return;
  }
  const realVirtualPath = resolvedRealVirtualPath(input.resolved);
  if (
    input.allowDirectoryPrefix
      ? !projectPathMayContainAllowedRead(input.context, realVirtualPath)
      : !projectPathMatchesReadAllowlist(input.context, realVirtualPath)
  ) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs ./ read path is not covered by files.allow.read.",
      virtualPath: input.resolved.virtualPath,
    });
  }
  if (
    !input.allowDirectoryPrefix &&
    projectPathMatchesReadDenylist(input.context, realVirtualPath)
  ) {
    throw readError({
      code: "permission_denied",
      message: "Plugin fs ./ read path is denied by files.deny.read.",
      virtualPath: input.resolved.virtualPath,
    });
  }
}

async function resolveReadablePath(
  context: PluginFsReadContext,
  virtualPath: string,
  access: "read" | "write" = "read",
): Promise<ResolvedPluginFsPath> {
  const resolved = await assertReadContextAllowsPath({
    access,
    context,
    virtualPath,
  });
  assertResolvedProjectPathAllowed({ context, resolved });
  return resolved;
}

async function revalidateReadablePath(input: {
  access?: "read" | "write";
  context: PluginFsReadContext;
  resolved: ResolvedPluginFsPath;
}): Promise<ResolvedPluginFsPath> {
  return await revalidateResolvedPluginFsPath({
    ...(input.access === undefined ? {} : { access: input.access }),
    pluginPath: input.context.pluginPath,
    projectRootPath: input.context.projectRootPath,
    resolved: input.resolved,
    threadRootPath: input.context.threadRootPath,
  });
}

function fileSystemKind(stats: {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}): PluginFsEntryKind {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  if (stats.isFile()) {
    return "file";
  }
  return "other";
}

async function statReadableResolvedPath(
  resolved: ResolvedPluginFsPath,
): Promise<PluginFsStat> {
  const stats = await stat(resolved.realPath);
  return {
    kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    virtualPath: resolved.virtualPath,
  };
}

function isForbiddenDirectoryName(name: string): boolean {
  return FORBIDDEN_DIRECTORY_NAMES.has(name);
}

function parseGlobVirtualPath(input: {
  context: PluginFsReadContext;
  virtualPath: string;
}): {
  patternSegments: string[];
  rootKind: PluginFsRootKind;
  rootVirtualPath: "~/" | "./";
  staticPrefixVirtualPath: string;
} {
  const { virtualPath } = input;
  if (virtualPath.includes("\0")) {
    throw readError({
      code: "invalid_glob_pattern",
      message: "Plugin fs glob patterns cannot contain NUL bytes.",
      virtualPath,
    });
  }

  let rootKind: PluginFsRootKind;
  let rootVirtualPath: "~/" | "./";
  let remainder: string;
  if (virtualPath === "~" || virtualPath.startsWith("~/")) {
    rootKind = "pluginData";
    rootVirtualPath = "~/";
    remainder = virtualPath === "~" ? "" : virtualPath.slice(2);
  } else if (virtualPath === "." || virtualPath.startsWith("./")) {
    rootKind = input.context.threadRootPath ? "thread" : "project";
    rootVirtualPath = "./";
    remainder = virtualPath === "." ? "" : virtualPath.slice(2);
  } else {
    throw readError({
      code: "invalid_glob_pattern",
      message: "Plugin fs glob patterns must start with ~/ or ./.",
      virtualPath,
    });
  }

  const patternSegments: string[] = [];
  const staticPrefixSegments: string[] = [];
  let sawGlob = false;
  for (const segment of remainder.split(/[\\/]+/)) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw readError({
        code: "invalid_glob_pattern",
        message: "Plugin fs glob traversal is denied.",
        virtualPath,
      });
    }
    if (isForbiddenDirectoryName(segment)) {
      throw readError({
        code: "invalid_glob_pattern",
        message: "Plugin fs access to .git and .ssh is denied.",
        virtualPath,
      });
    }
    patternSegments.push(segment);
    if (!sawGlob && !containsGlobPattern(segment)) {
      staticPrefixSegments.push(segment);
    } else {
      sawGlob = true;
    }
  }

  return {
    patternSegments,
    rootKind,
    rootVirtualPath,
    staticPrefixVirtualPath:
      staticPrefixSegments.length > 0
        ? `${rootVirtualPath}${staticPrefixSegments.join("/")}`
        : rootVirtualPath,
  };
}

async function collectGlobCandidates(input: {
  context: PluginFsReadContext;
  root: ResolvedPluginFsPath;
}): Promise<string[]> {
  const candidates: string[] = [];

  const pushCandidate = (virtualPath: string): void => {
    candidates.push(virtualPath);
    if (candidates.length > MAX_PLUGIN_FS_GLOB_CANDIDATES) {
      throw readError({
        code: "read_failed",
        message: `Plugin fs glob traversal is limited to ${MAX_PLUGIN_FS_GLOB_CANDIDATES} candidate paths.`,
        virtualPath: input.root.virtualPath,
      });
    }
  };

  async function visit(
    resolvedDirectory: ResolvedPluginFsPath,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_PLUGIN_FS_GLOB_RECURSION_DEPTH) {
      throw readError({
        code: "read_failed",
        message: `Plugin fs glob traversal is limited to ${MAX_PLUGIN_FS_GLOB_RECURSION_DEPTH} directory levels.`,
        virtualPath: resolvedDirectory.virtualPath,
      });
    }
    const entries = await readdir(resolvedDirectory.realPath, {
      withFileTypes: true,
    });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (isForbiddenDirectoryName(entry.name)) {
        continue;
      }
      const absolutePath = join(resolvedDirectory.absolutePath, entry.name);
      const virtualPath = toPluginFsVirtualPath({
        absolutePath,
        rootKind: resolvedDirectory.rootKind,
        rootPath: resolvedDirectory.rootPath,
      });
      let childResolved: ResolvedPluginFsPath;
      try {
        childResolved = await resolvePluginFsVirtualPath({
          pluginPath: input.context.pluginPath,
          projectRootPath: input.context.projectRootPath,
          threadRootPath: input.context.threadRootPath,
          virtualPath,
        });
      } catch (error) {
        if (error instanceof PluginFsPathError) {
          continue;
        }
        throw error;
      }
      try {
        assertResolvedProjectPathAllowed({
          context: input.context,
          resolved: childResolved,
        });
      } catch (error) {
        if (error instanceof PluginFsReadError) {
          continue;
        }
        throw error;
      }
      pushCandidate(childResolved.virtualPath);
      // Dirent#isDirectory is based on lstat data from readdir and does not
      // recurse into symlink leaves; child resolution above still validates
      // containment before any directory traversal.
      if (entry.isDirectory()) {
        await visit(childResolved, depth + 1);
      }
    }
  }

  const rootStats = await stat(input.root.realPath);
  if (rootStats.isDirectory()) {
    pushCandidate(input.root.virtualPath);
    await visit(input.root, 0);
  } else {
    pushCandidate(input.root.virtualPath);
  }
  return candidates;
}

function filterProjectCandidate(input: {
  context: PluginFsReadContext;
  isDirectory?: boolean;
  virtualPath: string;
}): boolean {
  return (
    !isProjectVirtualPath(input.virtualPath) ||
    ((input.isDirectory
      ? projectPathMayContainAllowedRead(input.context, input.virtualPath)
      : projectPathMatchesReadAllowlist(input.context, input.virtualPath)) &&
      !projectPathMatchesReadDenylist(input.context, input.virtualPath))
  );
}

export async function pluginFsExists(
  context: PluginFsReadContext,
  virtualPath: string,
): Promise<boolean> {
  const resolved = await resolveReadablePath(context, virtualPath, "write");
  if (!resolved.exists) {
    return false;
  }
  await revalidateReadablePath({
    context,
    resolved,
  });
  return true;
}

export async function pluginFsStat(
  context: PluginFsReadContext,
  virtualPath: string,
): Promise<PluginFsStat> {
  const resolved = await revalidateReadablePath({
    context,
    resolved: await resolveReadablePath(context, virtualPath),
  });
  return await statReadableResolvedPath(resolved);
}

async function readResolvedRegularFileWithLimit(input: {
  access?: "read" | "write";
  context: PluginFsReadContext;
  resolved: ResolvedPluginFsPath;
}): Promise<Uint8Array> {
  const resolved = await revalidateReadablePath({
    ...(input.access === undefined ? {} : { access: input.access }),
    context: input.context,
    resolved: input.resolved,
  });

  let fd: number;
  try {
    fd = openValidatedPluginFsPathSync({
      flags: pluginFsReadOpenFlags(),
      resolved,
    });
  } catch (error) {
    if (error instanceof PluginFsPathError) {
      throw readError({
        code: error.message.includes("requires a file")
          ? "not_a_file"
          : "read_failed",
        message: error.message,
        virtualPath: resolved.virtualPath,
      });
    }
    throw readError({
      cause: error,
      code: "read_failed",
      message: "Plugin fs file could not be opened for reading.",
      virtualPath: resolved.virtualPath,
    });
  }

  try {
    return readValidatedPluginFsFileDescriptor({
      fd,
      maxBytes: MAX_PLUGIN_FS_READ_BYTES,
      virtualPath: resolved.virtualPath,
    });
  } catch (error) {
    if (error instanceof PluginFsPathError) {
      throw readError({
        code: error.message.includes("requires a file")
          ? "not_a_file"
          : "read_failed",
        message: error.message,
        virtualPath: resolved.virtualPath,
      });
    }
    throw readError({
      cause: error,
      code: "read_failed",
      message: "Plugin fs file could not be read.",
      virtualPath: resolved.virtualPath,
    });
  } finally {
    closeValidatedPluginFsFileDescriptor(fd);
  }
}

export async function pluginFsRead(
  context: PluginFsReadContext,
  virtualPath: string,
): Promise<Uint8Array> {
  return await readResolvedRegularFileWithLimit({
    context,
    resolved: await resolveReadablePath(context, virtualPath),
  });
}

export async function pluginFsReadText(
  context: PluginFsReadContext,
  virtualPath: string,
): Promise<string> {
  return new TextDecoder().decode(await pluginFsRead(context, virtualPath));
}

export async function pluginFsLs(
  context: PluginFsReadContext,
  virtualPath: string,
): Promise<PluginFsDirectoryEntry[]> {
  const resolved = await revalidateReadablePath({
    context,
    resolved: await assertReadContextAllowsPath({
      allowDirectoryPrefix: true,
      context,
      virtualPath,
    }),
  });
  const stats = await stat(resolved.realPath);
  if (!stats.isDirectory()) {
    throw readError({
      code: "not_a_directory",
      message: "Plugin fs ls requires a directory path.",
      virtualPath: resolved.virtualPath,
    });
  }

  const entries = await readdir(resolved.realPath, { withFileTypes: true });
  const output: PluginFsDirectoryEntry[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (isForbiddenDirectoryName(entry.name)) {
      continue;
    }
    const childVirtualPath = toPluginFsVirtualPath({
      absolutePath: join(resolved.absolutePath, entry.name),
      rootKind: resolved.rootKind,
      rootPath: resolved.rootPath,
    });
    if (
      !filterProjectCandidate({
        context,
        isDirectory: entry.isDirectory(),
        virtualPath: childVirtualPath,
      })
    ) {
      continue;
    }
    try {
      const childResolved = await resolvePluginFsVirtualPath({
        pluginPath: context.pluginPath,
        projectRootPath: context.projectRootPath,
        threadRootPath: context.threadRootPath,
        virtualPath: childVirtualPath,
      });
      assertResolvedProjectPathAllowed({
        allowDirectoryPrefix: entry.isDirectory(),
        context,
        resolved: childResolved,
      });
    } catch (error) {
      if (error instanceof PluginFsPathError) {
        continue;
      }
      throw error;
    }
    output.push({
      kind: fileSystemKind(entry),
      name: basename(entry.name),
      virtualPath: childVirtualPath,
    });
  }
  return output;
}

export async function pluginFsGlob(
  context: PluginFsReadContext,
  virtualPathPattern: string,
): Promise<string[]> {
  assertReadContextAllowsGlob(context, virtualPathPattern);
  const parsed = parseGlobVirtualPath({
    context,
    virtualPath: virtualPathPattern,
  });
  const staticPrefix = await assertReadContextAllowsPath({
    allowDirectoryPrefix: true,
    context,
    virtualPath: parsed.staticPrefixVirtualPath,
  }).catch((error: unknown) => {
    if (
      error instanceof PluginFsPathError &&
      error.code === "path_unavailable"
    ) {
      return null;
    }
    throw error;
  });
  if (!staticPrefix) {
    return [];
  }
  assertResolvedProjectPathAllowed({
    allowDirectoryPrefix: true,
    context,
    resolved: staticPrefix,
  });
  const revalidatedStaticPrefix = await revalidateReadablePath({
    context,
    resolved: staticPrefix,
  });

  const candidates = await collectGlobCandidates({
    context,
    root: revalidatedStaticPrefix,
  });
  const rootVirtualPath = pluginFsVirtualRootForPath(parsed.rootKind);
  const seenMatches = new Set<string>();
  const matches: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.startsWith(rootVirtualPath)) {
      continue;
    }
    if (
      !globSegmentsMatch(parsed.patternSegments, virtualPathSegments(candidate))
    ) {
      continue;
    }
    if (!filterProjectCandidate({ context, virtualPath: candidate })) {
      continue;
    }
    if (seenMatches.has(candidate)) {
      continue;
    }
    seenMatches.add(candidate);
    matches.push(candidate);
    if (matches.length > MAX_PLUGIN_FS_GLOB_RESULTS) {
      throw readError({
        code: "read_failed",
        message: `Plugin fs glob results are limited to ${MAX_PLUGIN_FS_GLOB_RESULTS} paths.`,
        virtualPath: virtualPathPattern,
      });
    }
  }
  return matches.sort((left, right) => left.localeCompare(right));
}
