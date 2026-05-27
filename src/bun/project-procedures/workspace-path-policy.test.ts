/**
 * @file src/bun/project-procedures/workspace-path-policy.test.ts
 * @description Characterization tests for the Backend Workspace path policy seam.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "../db";
import {
  adminWorkspacePathScopeForInternalCall,
  assertWorkspaceDirectory,
  assertWorkspacePathAllowed,
  ensureWorkspaceDirectory,
  formatWorkspacePathForUser,
  isWorkspacePathAllowed,
  nearestExistingPath,
  normalizeRequestedWorkspacePath,
  RESTRICTED_WORKSPACE_ERROR_MESSAGE,
  restrictedWorkspacePathScope,
  workspaceDirectorySuggestionOptions,
  workspacePathScopeForLocalOperator,
} from "./workspace-path-policy";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-workspace-policy-"));
  tempDirectories.add(path);
  return path;
}

beforeEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory();
});

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("workspace path policy", () => {
  it("builds restricted local-operator scopes inside app data", () => {
    const appDataDirectory = process.env.METIDOS_APP_DATA_DIR ?? "";
    const scope = workspacePathScopeForLocalOperator({
      canManageApp: false,
      profile: {
        userId: 1,
        username: "alice",
      },
    });

    expect(scope).toEqual({
      homeDirectory: resolve(appDataDirectory, "users", "alice"),
      restrictedRoot: resolve(appDataDirectory, "users", "alice"),
      supportsTildePath: true,
    });
    expect(existsSync(scope.homeDirectory)).toBe(true);
  });

  it("fails closed when restricted local-operator identity is unresolved", () => {
    expect(() =>
      workspacePathScopeForLocalOperator({
        canManageApp: false,
        profile: {
          userId: null,
          username: "alice",
        },
      }),
    ).toThrow(
      "A valid authenticated session is required to access workspace paths.",
    );
    expect(() =>
      workspacePathScopeForLocalOperator({
        canManageApp: false,
        profile: {
          userId: 1,
          username: null,
        },
      }),
    ).toThrow(
      "A valid authenticated session is required to access workspace paths.",
    );
  });

  it("rejects unsafe private workspace-home username segments", () => {
    expect(() => restrictedWorkspacePathScope("../alice")).toThrow(
      "The current local-operator name cannot be mapped to a private workspace home.",
    );
  });

  it("normalizes and formats tilde paths for restricted scopes", () => {
    const scope = restrictedWorkspacePathScope("alice");

    expect(normalizeRequestedWorkspacePath("~/project", scope)).toBe(
      resolve(scope.homeDirectory, "project"),
    );
    expect(formatWorkspacePathForUser(scope.homeDirectory, scope)).toBe("~");
    expect(
      formatWorkspacePathForUser(join(scope.homeDirectory, "project"), scope),
    ).toBe("~/project");

    const outsidePath = resolve(createTempDirectory(), "project");
    expect(formatWorkspacePathForUser(outsidePath, scope)).toBe(outsidePath);
  });

  it("allows unrestricted admin scopes without a restricted root", () => {
    const scope = adminWorkspacePathScopeForInternalCall();
    const outsidePath = resolve(createTempDirectory(), "project");

    expect(scope.restrictedRoot).toBeNull();
    expect(isWorkspacePathAllowed(outsidePath, scope)).toBe(true);
    expect(workspaceDirectorySuggestionOptions(scope)).toEqual({
      homeDirectory: scope.homeDirectory,
      rootDirectory: null,
      supportsTildePath: scope.supportsTildePath,
    });
  });

  it("allows missing descendants whose nearest existing ancestor stays inside the restricted root", () => {
    const scope = restrictedWorkspacePathScope("alice");
    const missingDescendant = join(scope.homeDirectory, "new", "project");

    expect(nearestExistingPath(missingDescendant)).toBe(scope.homeDirectory);
    expect(isWorkspacePathAllowed(missingDescendant, scope)).toBe(true);
    expect(() =>
      assertWorkspacePathAllowed(missingDescendant, scope),
    ).not.toThrow();
    expect(workspaceDirectorySuggestionOptions(scope)).toEqual({
      homeDirectory: scope.homeDirectory,
      rootDirectory: scope.restrictedRoot,
      supportsTildePath: true,
    });
  });

  it("builds user-facing directory errors with restricted tilde formatting", () => {
    const scope = restrictedWorkspacePathScope("alice");
    const missingPath = join(scope.homeDirectory, "missing-project");
    const filePath = join(scope.homeDirectory, "not-a-directory");
    writeFileSync(filePath, "not a directory\n");

    expect(() =>
      assertWorkspaceDirectory(missingPath, scope, { label: "Project path" }),
    ).toThrow("Project path does not exist: ~/missing-project");
    expect(() =>
      assertWorkspaceDirectory(filePath, scope, { label: "Project path" }),
    ).toThrow("Project path must be a directory: ~/not-a-directory");
  });

  it("creates allowed missing workspace directories before asserting they exist", () => {
    const scope = restrictedWorkspacePathScope("alice");
    const projectPath = join(scope.homeDirectory, "new-project");

    ensureWorkspaceDirectory(projectPath, scope, {
      createIfMissing: true,
      label: "Project path",
    });

    expect(existsSync(projectPath)).toBe(true);
    expect(isWorkspacePathAllowed(projectPath, scope)).toBe(true);
  });

  it("rejects paths outside the restricted root", () => {
    const scope = restrictedWorkspacePathScope("alice");
    const outsidePath = resolve(createTempDirectory(), "project");

    expect(isWorkspacePathAllowed(outsidePath, scope)).toBe(false);
    expect(() => assertWorkspacePathAllowed(outsidePath, scope)).toThrow(
      RESTRICTED_WORKSPACE_ERROR_MESSAGE,
    );
  });

  it("rejects restricted-root symlink ancestors that escape through realpath", () => {
    const scope = restrictedWorkspacePathScope("alice");
    const outsideDirectory = createTempDirectory();
    const symlinkPath = join(scope.homeDirectory, "escape");
    mkdirSync(scope.homeDirectory, { recursive: true });
    symlinkSync(outsideDirectory, symlinkPath, "dir");

    const escapedDescendant = join(symlinkPath, "project");

    expect(isWorkspacePathAllowed(escapedDescendant, scope)).toBe(false);
    expect(() => assertWorkspacePathAllowed(escapedDescendant, scope)).toThrow(
      RESTRICTED_WORKSPACE_ERROR_MESSAGE,
    );
  });
});
