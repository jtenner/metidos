import { isAbsolute, resolve } from "node:path";

type CanonicalizePathOptions = {
  baseDirectory?: string;
  platform?: NodeJS.Platform;
};

type SidecarScopeOptions = CanonicalizePathOptions & {
  allowCrossProject?: boolean;
  projectIdContext?: number | null;
  targetProjectId: number;
  targetWorktreePath: string;
  worktreePathContext?: string | null;
};

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

export function enforceTargetScope(options: SidecarScopeOptions): void {
  if (options.allowCrossProject) {
    return;
  }

  if (
    typeof options.projectIdContext === "number" &&
    options.targetProjectId !== options.projectIdContext
  ) {
    throw new Error(
      `Cross-project access requires allowCrossProject=true. Bound project: ${options.projectIdContext}.`,
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
      `Cross-worktree access requires allowCrossProject=true. Bound worktree: ${options.worktreePathContext}.`,
    );
  }
}
