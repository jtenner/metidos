/**
 * @file src/bun/thread-tool-scope.ts
 * @description Shared thread-scoping helpers for Jolt-owned tool packs.
 */

import { isAbsolute, resolve } from "node:path";

type CanonicalizePathOptions = {
  baseDirectory?: string;
  platform?: NodeJS.Platform;
};

type ThreadToolScopeOptions = CanonicalizePathOptions & {
  projectIdContext?: number | null;
  targetProjectId: number;
  targetWorktreePath: string;
  worktreePathContext?: string | null;
};

/**
 * Resolve and normalize a path to a canonical, cross-platform string.
 */
export function canonicalizeThreadToolPath(
  value: string,
  options: CanonicalizePathOptions = {},
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }

  const baseDirectory = options.baseDirectory ?? process.cwd();
  const resolvedPath = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(baseDirectory, trimmed);
  const normalized = resolvedPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const platform = options.platform ?? process.platform;
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Compare two user-provided paths for equality after canonicalization.
 */
export function threadToolPathsEqual(
  left: string,
  right: string,
  options: CanonicalizePathOptions = {},
): boolean {
  return (
    canonicalizeThreadToolPath(left, options) ===
    canonicalizeThreadToolPath(right, options)
  );
}

/**
 * Enforce optional thread binding from the current tool context.
 */
export function enforceBoundThreadScope(
  threadId: number,
  boundThreadId?: number | null,
): void {
  if (typeof boundThreadId === "number" && threadId !== boundThreadId) {
    throw new Error(
      `Thread ${threadId} is outside the bound thread ${boundThreadId}.`,
    );
  }
}

/**
 * Enforce optional project/worktree scoping restrictions from the current tool context.
 */
export function enforceTargetScope(options: ThreadToolScopeOptions): void {
  if (
    typeof options.projectIdContext === "number" &&
    options.targetProjectId !== options.projectIdContext
  ) {
    throw new Error(
      `Cross-project access is not allowed from bound project ${options.projectIdContext}.`,
    );
  }

  if (
    options.worktreePathContext &&
    !threadToolPathsEqual(
      options.targetWorktreePath,
      options.worktreePathContext,
      {
        ...(typeof options.baseDirectory === "string"
          ? {
              baseDirectory: options.baseDirectory,
            }
          : {}),
        ...(typeof options.platform === "string"
          ? {
              platform: options.platform,
            }
          : {}),
      },
    )
  ) {
    throw new Error(
      `Cross-worktree access is not allowed from bound worktree ${options.worktreePathContext}.`,
    );
  }
}
