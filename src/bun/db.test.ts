/**
 * @file src/bun/db.test.ts
 * @description Test file for db.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encryptAuthSecret, getAuthSecretKeyPath } from "./auth-secrets";
import {
  APP_DATABASE_JOURNAL_MODE,
  applyAppDatabasePragmas,
  closeAppDatabase,
  createSecurityAuditEvent,
  createThread,
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  deleteAppDatabaseFiles,
  getAppDatabasePath,
  getThreadById,
  initAppDatabase,
  listProjects,
  listSecurityAuditEvents,
  listThreads,
  resetResolvedAppDataDirectory,
  SQL_BUSY_TIMEOUT_MS,
  selectWritableAppDataDirectory,
  updateThreadPiSessionState,
  upsertProject,
} from "./db";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-db-"));
  tempDirectories.add(path);
  return path;
}

function readJournalMode(database: Database): string {
  return (
    database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()
      ?.journal_mode ?? ""
  );
}

function readSynchronousMode(database: Database): number {
  return (
    database.query<{ synchronous: number }, []>("PRAGMA synchronous").get()
      ?.synchronous ?? -1
  );
}

function readBusyTimeout(database: Database): number {
  return (
    database.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()
      ?.timeout ?? -1
  );
}

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
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
      "Set METIDOS_APP_DATA_DIR to an explicit writable per-user directory if the default location is unavailable.",
    );
  });

  it("applies owner-only permissions to the app-data directory, database, and auth key when supported", async () => {
    if (process.platform === "win32") {
      return;
    }

    const appDataDir = createTempDirectory();
    chmodSync(appDataDir, 0o755);
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

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

  it("keeps the bun:test process on rollback-journal mode while preserving shared busy-timeout pragmas", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    const databasePath = getAppDatabasePath();

    expect(readJournalMode(database)).toBe("delete");
    expect(readSynchronousMode(database)).toBe(2);
    expect(readBusyTimeout(database)).toBe(SQL_BUSY_TIMEOUT_MS);

    const secondary = new Database(databasePath);
    try {
      applyAppDatabasePragmas(secondary, {
        busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
      });
      expect(readJournalMode(secondary)).toBe("delete");
      expect(readSynchronousMode(secondary)).toBe(2);
      expect(readBusyTimeout(secondary)).toBe(SQL_BUSY_TIMEOUT_MS);
    } finally {
      secondary.close(false);
    }
  });

  it("validates wal-mode pragmas and reader-writer concurrency in a child process", () => {
    const childSource = String.raw`
      import { Database } from "bun:sqlite";
      import { mkdtempSync, rmSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      import {
        APP_DATABASE_JOURNAL_MODE,
        SQL_BUSY_TIMEOUT_MS,
        applyAppDatabasePragmas,
      } from "./src/bun/db";

      function readJournalMode(database) {
        return database.query("PRAGMA journal_mode").get()?.journal_mode ?? "";
      }
      function readSynchronous(database) {
        return database.query("PRAGMA synchronous").get()?.synchronous ?? -1;
      }
      const appDataDir = mkdtempSync(join(tmpdir(), "metidos-db-child-"));
      const databasePath = join(appDataDir, "child.db");
      try {
        const setup = new Database(databasePath);
        applyAppDatabasePragmas(setup, { busyTimeoutMs: SQL_BUSY_TIMEOUT_MS });
        setup.run("CREATE TABLE test_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
        setup.run("INSERT INTO test_rows (value) VALUES ('before')");
        setup.close(false);

        const reader = new Database(databasePath);
        const writer = new Database(databasePath);
        applyAppDatabasePragmas(reader, { busyTimeoutMs: SQL_BUSY_TIMEOUT_MS });
        applyAppDatabasePragmas(writer, { busyTimeoutMs: SQL_BUSY_TIMEOUT_MS });
        reader.run("BEGIN");
        reader.query("SELECT COUNT(*) AS count FROM test_rows").get();
        const startedAt = performance.now();
        writer.run("BEGIN IMMEDIATE");
        writer.run("UPDATE test_rows SET value = 'after' WHERE id = 1");
        writer.run("COMMIT");
        const durationMs = Math.max(0, performance.now() - startedAt);
        reader.run("COMMIT");
        const finalValue =
          writer.query("SELECT value FROM test_rows WHERE id = 1").get()?.value ??
          null;
        reader.close(false);
        writer.close(false);

        const verification = new Database(databasePath);
        applyAppDatabasePragmas(verification, {
          busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
        });
        const journalMode = readJournalMode(verification);
        const synchronous = readSynchronous(verification);
        verification.close(false);

        console.log(JSON.stringify({
          durationMs,
          finalValue,
          journalMode,
          synchronous,
          targetJournalMode: APP_DATABASE_JOURNAL_MODE,
        }));
      } finally {
        rmSync(appDataDir, { force: true, recursive: true });
      }
    `;

    const stdout = execFileSync("bun", ["-e", childSource], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = JSON.parse(stdout.trim()) as {
      durationMs: number;
      finalValue: string | null;
      journalMode: string;
      synchronous: number;
      targetJournalMode: string;
    };

    expect(result.targetJournalMode).toBe(APP_DATABASE_JOURNAL_MODE);
    expect(result.journalMode).toBe(APP_DATABASE_JOURNAL_MODE);
    expect(result.synchronous).toBe(1);
    expect(result.finalValue).toBe("after");
    expect(result.durationMs).toBeLessThan(1000);
  });

  it("deletes the app database files and reopens as an empty database", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    const databasePath = getAppDatabasePath();
    const project = upsertProject(database, {
      name: "Project",
      projectPath: join(appDataDir, "project"),
    });
    createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Thread",
      unsafeMode: false,
      worktreePath: project.path,
    });
    createSecurityAuditEvent(database, {
      eventType: "test_event",
      projectId: project.id,
      summaryText: "Test event",
    });

    writeFileSync(`${databasePath}-journal`, "");
    writeFileSync(`${databasePath}-shm`, "");
    writeFileSync(`${databasePath}-wal`, "");

    const deletedPaths = deleteAppDatabaseFiles();

    expect(deletedPaths).toEqual(
      expect.arrayContaining([
        databasePath,
        `${databasePath}-journal`,
        `${databasePath}-shm`,
        `${databasePath}-wal`,
      ]),
    );
    expect(existsSync(databasePath)).toBeFalse();
    expect(existsSync(`${databasePath}-journal`)).toBeFalse();
    expect(existsSync(`${databasePath}-shm`)).toBeFalse();
    expect(existsSync(`${databasePath}-wal`)).toBeFalse();

    const freshDatabase = initAppDatabase();
    expect(listProjects(freshDatabase)).toHaveLength(0);
    expect(listThreads(freshDatabase)).toHaveLength(0);
    expect(listSecurityAuditEvents(freshDatabase)).toHaveLength(0);
  });

  it("persists security audit events for dangerous local actions", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const database = initAppDatabase();

    createSecurityAuditEvent(database, {
      eventType: "unsafe_mode_enabled",
      summaryText:
        "Unsafe mode enabled. Bash access and unsafe child thread or cron creation are allowed for this thread.",
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

  it("persists first-class Pi session identity on thread rows", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Pi Repo",
      projectPath: join(appDataDir, "project"),
    });
    const thread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Pi Thread",
      unsafeMode: false,
      worktreePath: project.path,
    });

    updateThreadPiSessionState(database, thread.id, {
      piSessionId: "pi-session-1",
      piSessionFile: "/tmp/pi-session-1.jsonl",
      piLeafEntryId: "leaf-1",
    });

    const persistedThread = getThreadById(database, thread.id);

    expect(persistedThread).toEqual(
      expect.objectContaining({
        id: thread.id,
        piSessionId: "pi-session-1",
        piSessionFile: "/tmp/pi-session-1.jsonl",
        piLeafEntryId: "leaf-1",
      }),
    );
    expect(listThreads(database)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: thread.id,
          piSessionId: "pi-session-1",
          piSessionFile: "/tmp/pi-session-1.jsonl",
          piLeafEntryId: "leaf-1",
        }),
      ]),
    );
  });

  it("hydrates persisted thread access flags as booleans", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Flags Repo",
      projectPath: join(appDataDir, "project"),
    });
    const thread = createThread(database, {
      agentsAccess: true,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Access Flags",
      unsafeMode: false,
      worktreePath: project.path,
    });

    const persistedThread = getThreadById(database, thread.id);
    const listedThread = listThreads(database).find(
      (entry) => entry.id === thread.id,
    );

    expect(persistedThread).toEqual(
      expect.objectContaining({
        agentsAccess: true,
        githubAccess: false,
        metidosAccess: true,
      }),
    );
    expect(typeof persistedThread?.agentsAccess).toBe("boolean");
    expect(typeof persistedThread?.githubAccess).toBe("boolean");
    expect(typeof persistedThread?.metidosAccess).toBe("boolean");
    expect(listedThread).toEqual(
      expect.objectContaining({
        agentsAccess: true,
        githubAccess: false,
        metidosAccess: true,
      }),
    );
  });

  it("clears stale active worktree sync paths instead of storing them", async () => {
    const repoPath = createTempDirectory();
    execFileSync("git", ["init"], {
      cwd: repoPath,
      stdio: "ignore",
    });

    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

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
