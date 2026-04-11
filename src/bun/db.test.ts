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
  createThreadMessage,
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  deleteAppDatabaseFiles,
  getAppDatabasePath,
  getThreadById,
  initAppDatabase,
  listProjects,
  listSecurityAuditEvents,
  listThreads,
  migrateDatabase,
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

function explainQueryPlan(
  database: Database,
  sql: string,
  params: Array<number | string> = [],
): string[] {
  return database
    .query(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => String((row as { detail?: unknown }).detail ?? ""));
}

function createQueryPlanAuditDatabase(): {
  database: Database;
  primaryThreadId: number;
} {
  const database = new Database(":memory:");
  migrateDatabase(database);

  let primaryThreadId: number | null = null;
  for (let projectIndex = 0; projectIndex < 12; projectIndex += 1) {
    const project = upsertProject(database, {
      name: `Project ${String(projectIndex).padStart(2, "0")}`,
      projectPath: `/tmp/query-plan-project-${projectIndex}`,
    });
    if (projectIndex % 4 === 0) {
      database.run("UPDATE projects SET is_open = 0 WHERE id = ?", [
        project.id,
      ]);
    }
    database.run(
      "UPDATE projects SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds') WHERE id = ?",
      [String(-projectIndex * 60), String(-projectIndex * 60), project.id],
    );

    for (let threadIndex = 0; threadIndex < 18; threadIndex += 1) {
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: `Thread ${projectIndex}-${threadIndex}`,
        unsafeMode: false,
        worktreePath: project.path,
      });
      primaryThreadId ??= thread.id;
      if (threadIndex % 5 === 0) {
        database.run(
          "UPDATE threads SET pinned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds') WHERE id = ?",
          [String(-(projectIndex * 18 + threadIndex)), thread.id],
        );
      }
      database.run(
        "UPDATE threads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds'), created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds') WHERE id = ?",
        [
          String(-(projectIndex * 18 + threadIndex)),
          String(-(projectIndex * 18 + threadIndex + 30)),
          thread.id,
        ],
      );
      for (let messageIndex = 0; messageIndex < 4; messageIndex += 1) {
        createThreadMessage(database, {
          role: messageIndex % 2 === 0 ? "user" : "assistant",
          text: `Message ${messageIndex}`,
          threadId: thread.id,
        });
      }
    }
  }

  if (primaryThreadId === null) {
    throw new Error("Expected query-plan audit seed data to create a thread");
  }

  database.run(
    "INSERT INTO thread_messages (thread_id, role, kind, item_id, text, state, payload_json, created_at, updated_at) VALUES (?, 'assistant', 'tool_call', 'activity-item', 'Activity', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    [primaryThreadId],
  );
  database.run("ANALYZE");

  return {
    database,
    primaryThreadId,
  };
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
    const childSource = `
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

  it("uses query-plan-aligned indexes for project and thread listings without adding new thread-message indexes", () => {
    const { database, primaryThreadId } = createQueryPlanAuditDatabase();

    try {
      const listProjectsPlan = explainQueryPlan(
        database,
        `
          SELECT
            id,
            path,
            name,
            git_remote AS gitRemote,
            is_open AS isOpen,
            created_at AS createdAt,
            updated_at AS updatedAt,
            last_opened_at AS lastOpenedAt
          FROM projects
          ORDER BY last_opened_at DESC, name ASC
        `,
      );
      expect(listProjectsPlan).toEqual(
        expect.arrayContaining([
          expect.stringContaining("idx_projects_last_opened_at_name"),
        ]),
      );
      expect(
        listProjectsPlan.some((detail) => detail.includes("USE TEMP B-TREE")),
      ).toBeFalse();

      const listOpenProjectsPlan = explainQueryPlan(
        database,
        `
          SELECT
            id,
            path,
            name,
            git_remote AS gitRemote,
            is_open AS isOpen,
            created_at AS createdAt,
            updated_at AS updatedAt,
            last_opened_at AS lastOpenedAt
          FROM projects
          WHERE is_open = 1
          ORDER BY last_opened_at DESC
        `,
      );
      expect(listOpenProjectsPlan).toEqual(
        expect.arrayContaining([
          expect.stringContaining("idx_projects_last_opened_at_name"),
        ]),
      );
      expect(
        listOpenProjectsPlan.some((detail) =>
          detail.includes("USE TEMP B-TREE"),
        ),
      ).toBeFalse();

      const listThreadsPlan = explainQueryPlan(
        database,
        `
          SELECT
            id,
            project_id AS projectId,
            worktree_path AS worktreePath,
            title,
            summary,
            model,
            reasoning_effort AS reasoningEffort,
            github_access AS githubAccess,
            agents_access AS agentsAccess,
            metidos_access AS metidosAccess,
            unsafe_mode AS unsafeMode,
            pi_session_id AS piSessionId,
            pi_session_file AS piSessionFile,
            pi_leaf_entry_id AS piLeafEntryId,
            pinned_at AS pinnedAt,
            created_at AS createdAt,
            updated_at AS updatedAt,
            last_run_at AS lastRunAt,
            last_input_tokens AS lastInputTokens,
            last_cached_input_tokens AS lastCachedInputTokens,
            last_output_tokens AS lastOutputTokens,
            max_input_tokens AS maxInputTokens,
            estimated_compaction_trigger_tokens AS estimatedCompactionTriggerTokens,
            compaction_count AS compactionCount,
            last_compaction_at AS lastCompactionAt,
            last_compaction_before_input_tokens AS lastCompactionBeforeInputTokens,
            last_compaction_after_input_tokens AS lastCompactionAfterInputTokens,
            active_turn_started_at AS activeTurnStartedAt,
            last_error_at AS lastErrorAt,
            last_error_seen_at AS lastErrorSeenAt,
            last_error_message AS lastErrorMessage
          FROM threads
          ORDER BY
            (pinned_at IS NULL) ASC,
            pinned_at DESC,
            updated_at DESC,
            created_at DESC,
            id DESC
        `,
      );
      expect(listThreadsPlan).toEqual(
        expect.arrayContaining([
          expect.stringContaining("idx_threads_listing_order"),
        ]),
      );
      expect(
        listThreadsPlan.some((detail) => detail.includes("USE TEMP B-TREE")),
      ).toBeFalse();

      const listThreadMessagesPagePlan = explainQueryPlan(
        database,
        `
          SELECT
            id,
            thread_id AS threadId,
            role,
            kind,
            item_id AS itemId,
            text,
            state,
            payload_json AS payloadJson,
            created_at AS createdAt,
            COALESCE(updated_at, created_at) AS updatedAt
          FROM thread_messages
          WHERE thread_id = ?
          ORDER BY id DESC
          LIMIT ?
        `,
        [primaryThreadId, 101],
      );
      expect(listThreadMessagesPagePlan).toEqual(
        expect.arrayContaining([
          expect.stringContaining("idx_thread_messages_thread_id"),
        ]),
      );

      const threadActivityLookupPlan = explainQueryPlan(
        database,
        `
          SELECT id
          FROM thread_messages
          WHERE thread_id = ? AND item_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
        [primaryThreadId, "activity-item"],
      );
      expect(threadActivityLookupPlan).toEqual(
        expect.arrayContaining([
          expect.stringContaining("idx_thread_messages_thread_item_id"),
        ]),
      );
    } finally {
      database.close(false);
    }
  });

  it("keeps pinned threads ahead of unpinned threads while preserving recency inside each group", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Ordered Threads",
      projectPath: join(appDataDir, "ordered-project"),
    });
    const pinnedOlder = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Pinned Older",
      unsafeMode: false,
      worktreePath: project.path,
    });
    const pinnedNewer = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Pinned Newer",
      unsafeMode: false,
      worktreePath: project.path,
    });
    const unpinnedNewer = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Unpinned Newer",
      unsafeMode: false,
      worktreePath: project.path,
    });
    const unpinnedOlder = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Unpinned Older",
      unsafeMode: false,
      worktreePath: project.path,
    });

    database.run(
      "UPDATE threads SET pinned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 seconds'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 seconds') WHERE id = ?",
      [pinnedOlder.id],
    );
    database.run(
      "UPDATE threads SET pinned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 seconds'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 seconds') WHERE id = ?",
      [pinnedNewer.id],
    );
    database.run(
      "UPDATE threads SET pinned_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 seconds') WHERE id = ?",
      [unpinnedNewer.id],
    );
    database.run(
      "UPDATE threads SET pinned_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 seconds') WHERE id = ?",
      [unpinnedOlder.id],
    );

    expect(listThreads(database).map((thread) => thread.id)).toEqual([
      pinnedNewer.id,
      pinnedOlder.id,
      unpinnedNewer.id,
      unpinnedOlder.id,
    ]);
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
