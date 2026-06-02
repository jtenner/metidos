/**
 * @file src/bun/project-procedures/workspace-path-policy.ts
 * @description Backend-owned Workspace path policy helpers for Project and Worktree procedures.
 */

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { AuthServiceError } from "../auth/service";
import { normalizeWorkspaceHomeUsername } from "../auth/usernames";
import { getAppDataDirectoryPath } from "../db";
import { normalizePath, pathIsWithinRoot, safeIsDirectory } from "./shared";

export type WorkspacePathScope = {
  homeDirectory: string;
  restrictedRoot: string | null;
  supportsTildePath: boolean;
};

export type WorkspacePathOperatorState = {
  canManageApp: boolean;
  profile: {
    userId: number | null;
    username: string | null;
  };
};

export type WorkspaceDirectorySuggestionOptions = {
  homeDirectory: string;
  rootDirectory: string | null;
  supportsTildePath: boolean;
};

export type WorkspacePathErrorCode =
  | "workspace_path_missing"
  | "workspace_path_not_directory"
  | "workspace_path_restricted";

export class WorkspacePathError extends Error {
  constructor(
    message: string,
    readonly code: WorkspacePathErrorCode,
  ) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export const RESTRICTED_WORKSPACE_ERROR_MESSAGE =
  "Workspace access is limited to the configured local workspace root.";

export function defaultWorkspaceSupportsTildePath(): boolean {
  return process.platform === "darwin" || process.platform === "linux";
}

export function normalizeWorkspaceUsernameSegment(username: string): string {
  try {
    return normalizeWorkspaceHomeUsername(username);
  } catch {
    throw new Error(
      "The current local-operator name cannot be mapped to a private workspace home.",
    );
  }
}

export function restrictedWorkspacePathScope(
  username: string,
): WorkspacePathScope {
  const homeDirectory = resolve(
    getAppDataDirectoryPath(),
    "users",
    normalizeWorkspaceUsernameSegment(username),
  );
  mkdirSync(homeDirectory, {
    recursive: true,
  });
  return {
    homeDirectory,
    restrictedRoot: homeDirectory,
    supportsTildePath: true,
  };
}

export function adminWorkspacePathScopeForInternalCall(): WorkspacePathScope {
  return {
    homeDirectory: homedir(),
    restrictedRoot: null,
    supportsTildePath: defaultWorkspaceSupportsTildePath(),
  };
}

export function workspacePathScopeForLocalOperator(
  operator: WorkspacePathOperatorState,
): WorkspacePathScope {
  if (operator.canManageApp) {
    return adminWorkspacePathScopeForInternalCall();
  }

  const { userId, username } = operator.profile;
  if (userId === null || !username) {
    throw new AuthServiceError(
      "session_required",
      "A valid authenticated session is required to access workspace paths.",
      401,
    );
  }

  return restrictedWorkspacePathScope(username);
}

export function workspacePathScopeForProject(
  _project: unknown,
): WorkspacePathScope {
  return adminWorkspacePathScopeForInternalCall();
}

export function isProjectPathVisibleToOperator(
  projectPath: string,
  operator: WorkspacePathOperatorState,
): boolean {
  if (operator.canManageApp) {
    return true;
  }
  return isWorkspacePathAllowed(
    projectPath,
    workspacePathScopeForLocalOperator(operator),
  );
}

export function normalizeRequestedWorkspacePath(
  value: string,
  scope: WorkspacePathScope,
): string {
  return normalizePath(value, {
    homeDirectory: scope.homeDirectory,
    supportsTildePath: scope.supportsTildePath,
  });
}

export function formatWorkspacePathForUser(
  path: string,
  scope: WorkspacePathScope,
): string {
  const normalizedPath = resolve(path);
  if (!scope.supportsTildePath || !scope.restrictedRoot) {
    return normalizedPath;
  }
  if (!pathIsWithinRoot(scope.restrictedRoot, normalizedPath)) {
    return normalizedPath;
  }

  const suffix = normalizedPath.slice(scope.restrictedRoot.length);
  return suffix ? `~${suffix}` : "~";
}

export function nearestExistingPath(path: string): string | null {
  let currentPath = resolve(path);
  for (;;) {
    if (existsSync(currentPath)) {
      return currentPath;
    }
    const parentPath = resolve(currentPath, "..");
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

export function isWorkspacePathAllowed(
  path: string,
  scope: WorkspacePathScope,
): boolean {
  const normalizedPath = resolve(path);
  if (!scope.restrictedRoot) {
    return true;
  }
  if (!pathIsWithinRoot(scope.restrictedRoot, normalizedPath)) {
    return false;
  }

  const existingPath = nearestExistingPath(normalizedPath);
  if (!existingPath) {
    return false;
  }

  try {
    return pathIsWithinRoot(scope.restrictedRoot, realpathSync(existingPath));
  } catch {
    return false;
  }
}

export function assertWorkspacePathAllowed(
  path: string,
  scope: WorkspacePathScope,
): void {
  if (isWorkspacePathAllowed(path, scope)) {
    return;
  }
  throw new WorkspacePathError(
    RESTRICTED_WORKSPACE_ERROR_MESSAGE,
    "workspace_path_restricted",
  );
}

export function buildMissingWorkspaceDirectoryMessage(
  path: string,
  scope: WorkspacePathScope,
  label = "Workspace path",
): string {
  return `${label} does not exist: ${formatWorkspacePathForUser(path, scope)}`;
}

export function buildNonDirectoryWorkspacePathMessage(
  path: string,
  scope: WorkspacePathScope,
  label = "Workspace path",
): string {
  return `${label} must be a directory: ${formatWorkspacePathForUser(path, scope)}`;
}

export function assertWorkspaceDirectory(
  path: string,
  scope: WorkspacePathScope,
  options: { label?: string } = {},
): void {
  const label = options.label ?? "Workspace path";
  if (!existsSync(path)) {
    throw new WorkspacePathError(
      buildMissingWorkspaceDirectoryMessage(path, scope, label),
      "workspace_path_missing",
    );
  }
  if (!safeIsDirectory(path)) {
    throw new WorkspacePathError(
      buildNonDirectoryWorkspacePathMessage(path, scope, label),
      "workspace_path_not_directory",
    );
  }
}

export function ensureWorkspaceDirectory(
  path: string,
  scope: WorkspacePathScope,
  options: { createIfMissing: boolean; label?: string },
): void {
  if (options.createIfMissing && !existsSync(path)) {
    assertWorkspacePathAllowed(path, scope);
    mkdirSync(path, {
      recursive: true,
    });
  }
  assertWorkspacePathAllowed(path, scope);
  assertWorkspaceDirectory(
    path,
    scope,
    typeof options.label === "string" ? { label: options.label } : {},
  );
}

export function workspaceDirectorySuggestionOptions(
  scope: WorkspacePathScope,
): WorkspaceDirectorySuggestionOptions {
  return {
    homeDirectory: scope.homeDirectory,
    rootDirectory: scope.restrictedRoot,
    supportsTildePath: scope.supportsTildePath,
  };
}
