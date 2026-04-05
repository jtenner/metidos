/**
 * @file src/bun/db.test.ts
 * @description Test file for db.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encryptAuthSecret, getAuthSecretKeyPath } from "./auth-secrets";
import {
  closeAppDatabase,
  createSecurityAuditEvent,
  getAppDatabasePath,
  initAppDatabase,
  listSecurityAuditEvents,
  resetResolvedAppDataDirectory,
  selectWritableAppDataDirectory,
} from "./db";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "jolt-db-"));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.JOLT_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.JOLT_APP_DATA_DIR;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("app database storage", () => {
  it("falls back only to the default app-data directory when the configured path is unusable", () => {
    const defaultAppDataDir = "/safe/default";
    const result = selectWritableAppDataDirectory({
      configuredAppDataDir: "/broken/configured",
      defaultAppDataDir,
      isWritableDirectory: (path) => path === defaultAppDataDir,
    });

    expect(result).toBe(defaultAppDataDir);
  });

  it("throws without mentioning a temp-directory fallback when no writable app-data directory exists", () => {
    expect(() =>
      selectWritableAppDataDirectory({
        configuredAppDataDir: "/broken/configured",
        defaultAppDataDir: "/broken/default",
        isWritableDirectory: () => false,
      }),
    ).toThrow(
      "Set JOLT_APP_DATA_DIR to an explicit writable per-user directory if the default location is unavailable.",
    );
  });

  it("applies owner-only permissions to the app-data directory, database, and auth key when supported", async () => {
    if (process.platform === "win32") {
      return;
    }

    const appDataDir = createTempDirectory();
    chmodSync(appDataDir, 0o755);
    process.env.JOLT_APP_DATA_DIR = appDataDir;

    initAppDatabase();
    await encryptAuthSecret("totp-secret", {
      appDataDir,
    });

    const databasePath = getAppDatabasePath();
    const authSecretPath = getAuthSecretKeyPath({
      appDataDir,
    });

    expect(existsSync(databasePath)).toBeTrue();
    expect(existsSync(authSecretPath)).toBeTrue();
    expect(statSync(appDataDir).mode & 0o777).toBe(0o700);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    expect(statSync(authSecretPath).mode & 0o777).toBe(0o600);
  });

  it("persists security audit events for dangerous local actions", () => {
    const appDataDir = createTempDirectory();
    process.env.JOLT_APP_DATA_DIR = appDataDir;
    const database = initAppDatabase();

    createSecurityAuditEvent(database, {
      eventType: "unsafe_mode_enabled",
      summaryText:
        "Unsafe mode enabled. This thread can use the danger-full-access sandbox.",
      threadId: 12,
      projectId: 5,
      worktreePath: "/tmp/worktree",
      payloadJson: JSON.stringify({
        source: "toggle",
        unsafeMode: true,
      }),
    });

    expect(listSecurityAuditEvents(database)).toEqual([
      expect.objectContaining({
        eventType: "unsafe_mode_enabled",
        projectId: 5,
        threadId: 12,
        worktreePath: "/tmp/worktree",
      }),
    ]);
    expect(
      listSecurityAuditEvents(database, {
        threadId: 12,
      }),
    ).toHaveLength(1);
  });

  it("clears stale active worktree sync paths instead of storing them", async () => {
    const repoPath = createTempDirectory();
    execFileSync("git", ["init"], {
      cwd: repoPath,
      stdio: "ignore",
    });

    const appDataDir = createTempDirectory();
    process.env.JOLT_APP_DATA_DIR = appDataDir;

    const {
      openProjectProcedure,
      setActiveWorktreeProcedure,
      shutdownProjectPolling,
    } = await import("./project-procedures");

    try {
      const opened = await openProjectProcedure({
        name: "Repo",
        projectPath: repoPath,
      });

      expect(
        await setActiveWorktreeProcedure({
          projectId: opened.project.id,
          worktreePath: repoPath,
        }),
      ).toEqual({
        success: true,
        projectId: opened.project.id,
        worktreePath: repoPath,
      });

      expect(
        await setActiveWorktreeProcedure({
          projectId: opened.project.id,
          worktreePath: join(repoPath, "missing-worktree"),
        }),
      ).toEqual({
        success: true,
        projectId: opened.project.id,
        worktreePath: null,
      });
    } finally {
      shutdownProjectPolling();
    }
  });
});
