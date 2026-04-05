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
 * Function of canonicalizeSidecarPath.
 * @param value - The value of `value`.
 * @param options - The value of `options`.
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
 * Function of sidecarPathsEqual.
 * @param left - The value of `left`.
 * @param right - The value of `right`.
 * @param options - The value of `options`.
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
 * Function of enforceBoundThreadScope.
 * @param threadId - The value of `threadId`.
 * @param boundThreadId - The value of `boundThreadId`.
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
 * Function of enforceTargetScope.
 * @param options - The value of `options`.
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
