/**
 * @file src/bun/codex-sidecar-scope.ts
 * @description Module for codex sidecar scope.
 */

import { isAbsolute, resolve } from "node:path";

type CanonicalizePathOptions = {
  baseDirectory?: string;
  platform?: NodeJS.Platform;
};

type SidecarScopeOptions = CanonicalizePathOptions & {
  projectIdContext?: number | null;
  targetProjectId: number;
  targetWorktreePath: string;
  worktreePathContext?: string | null;
};

/**
 * Resolve and normalize a path to a canonical, cross-platform string.
 */
export function canonicalizeSidecarPath(
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
export function sidecarPathsEqual(
  left: string,
  right: string,
  options: CanonicalizePathOptions = {},
): boolean {
  return (
    canonicalizeSidecarPath(left, options) ===
    canonicalizeSidecarPath(right, options)
  );
}

/**
 * Enforce optional thread binding from sidecar environment context.
 */
export function enforceBoundThreadScope(
  threadId: number,
  boundThreadId?: number | null,
): void {
  if (typeof boundThreadId === "number" && threadId !== boundThreadId) {
    throw new Error(
      `Thread ${threadId} is outside the bound sidecar thread ${boundThreadId}.`,
    );
  }
}

/**
 * Enforce optional project/worktree scoping restrictions from sidecar environment.
 */
export function enforceTargetScope(options: SidecarScopeOptions): void {
  if (
    typeof options.projectIdContext === "number" &&
    options.targetProjectId !== options.projectIdContext
  ) {
    throw new Error(
      `Cross-project access is not allowed from bound sidecar project ${options.projectIdContext}.`,
    );
  }

  if (
    options.worktreePathContext &&
    !sidecarPathsEqual(
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
      `Cross-worktree access is not allowed from bound sidecar worktree ${options.worktreePathContext}.`,
    );
  }
}
