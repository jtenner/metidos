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
 * Performs canonicalizeSidecarPath operation.
 * @param value - Input value.
 * @param options - Configuration options used by this operation.
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
 * Performs sidecarPathsEqual operation.
 * @param left - left argument for sidecarPathsEqual.
 * @param right - right argument for sidecarPathsEqual.
 * @param options - Configuration options used by this operation.
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
 * Performs enforceBoundThreadScope operation.
 * @param threadId - Thread identifier.
 * @param boundThreadId - boundThreadId identifier.
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
 * Performs enforceTargetScope operation.
 * @param options - Configuration options used by this operation.
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
