/**
 * @file src/bun/rpc-authz.ts
 * @description Module for rpc authz.
 */

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import type { AppRPCSchema } from "./rpc-schema";

type CreateThreadParams = AppRPCSchema["requests"]["createThread"]["params"];

function canonicalWorkspacePath(path: string): string | null {
  const resolved = resolve(path);
  try {
    if (!existsSync(resolved)) {
      return null;
    }
    return realpathSync(resolved);
  } catch {
    return null;
  }
}

/**
 * Checks whether thread creation targets a different workspace than the current one.
 * @param params - Parameters object.
 */

export function createThreadTargetsDifferentWorkspace(
  params: CreateThreadParams,
): boolean {
  if (
    typeof params.currentProjectId !== "number" ||
    typeof params.currentWorktreePath !== "string" ||
    params.currentWorktreePath.trim().length === 0
  ) {
    return true;
  }

  const targetPath = canonicalWorkspacePath(params.worktreePath);
  const currentPath = canonicalWorkspacePath(params.currentWorktreePath);
  if (!targetPath || !currentPath) {
    return true;
  }

  return (
    params.projectId !== params.currentProjectId || targetPath !== currentPath
  );
}
