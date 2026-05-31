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
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canSkipAppSchemaMigration,
  LATEST_APP_SCHEMA_VERSION,
  readAppSchemaVersion,
} from "./app-schema-migration";
import { encryptAuthSecret, getAuthSecretKeyPath } from "./auth/secrets";
import {
  listUserNotificationDeliveries,
  recordUserNotificationDelivery,
} from "./user-notifications";
import {
  APP_DATABASE_JOURNAL_MODE,
  applyAppDatabasePragmas,
  assertSafeSqliteColumnDefinition,
  closeAppDatabase,
  createCronJob,
  createSecurityAuditEvent,
  createThread,
  createWebServerShare,
  createThreadMessage,
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  deleteAppDatabaseFiles,
  deleteProject,
  deleteThread,
  ensureProjectWorktreeVisible,
  getAppDatabasePath,
  getPluginExternalIdentityBinding,
  getPluginIngressCursor,
  getProjectById,
  getAuthSettings,
  getThreadById,
  getTimezoneSettings,
  getUserRuntimeSettings,
  initAppDatabase,
  isAppDatabaseOpen,
  listActiveCronJobs,
  listProjects,
  listProjectWorktreesMetadata,
  listSecurityAuditEvents,
  listThreads,
  listThreadsByIds,
  listUsersWithSetupStatus,
  migrateDatabase,
  quoteSqliteIdentifier,
  resetResolvedAppDataDirectory,
  resolveEnabledPluginExternalIdentityBinding,
  selectWritableAppDataDirectory,
  setPluginExternalIdentityBindingEnabled,
  setProjectWorktreePinned,
  setThreadAccess,
  setThreadUnsafeMode,
  SQL_BUSY_TIMEOUT_MS,
  updateCronJob,
  updateTerminalSettings,
  updateThreadPiSessionState,
  updateUserRuntimeSettings,
  upsertAuthSettings,
  upsertPluginExternalIdentityBinding,
  upsertPluginIngressCursor,
  upsertProject,
} from "./db";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalAllowCustomTerminalShell =
  process.env.METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL;

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

function tableExists(database: Database, tableName: string): boolean {
  return (
    database
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(tableName)?.name === tableName
  );
}

function indexExists(database: Database, indexName: string): boolean {
  return (
    database
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
      .get(indexName)?.name === indexName
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

function createLegacyUsersTable(database: Database): void {
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      email TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

function createLegacyPluginExternalIdentityBindingsTable(
  database: Database,
): void {
  database.exec(`
    CREATE TABLE plugin_external_identity_bindings (
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      metidos_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      verified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      verified_by TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (plugin_id, source_id, external_user_id)
    );
    CREATE INDEX idx_plugin_external_identity_bindings_user
      ON plugin_external_identity_bindings(metidos_user_id, enabled);
  `);
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
  if (typeof originalAllowCustomTerminalShell === "string") {
    process.env.METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL =
      originalAllowCustomTerminalShell;
  } else {
    delete process.env.METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("terminal settings", () => {
  it("rejects arbitrary default shell paths unless explicitly allowed", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    try {
      expect(() =>
        updateTerminalSettings(database, {
          defaultShell: "/tmp/metidos-not-a-shell",
        }),
      ).toThrow(
        "Terminal default shell must be a known shell unless METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL=true.",
      );

      process.env.METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL = "true";
      expect(() =>
        updateTerminalSettings(database, {
          defaultShell: "/tmp/metidos-not-a-shell",
        }),
      ).toThrow("Terminal default shell must point to a file.");

      const customShell = join(createTempDirectory(), "custom-shell");
      writeFileSync(customShell, "#!/bin/sh\nexit 0\n");
      chmodSync(customShell, 0o700);
      expect(
        updateTerminalSettings(database, {
          defaultShell: customShell,
        }).defaultShell,
      ).toBe(customShell);
    } finally {
      database.close(false);
    }
  });
});

describe("user runtime settings", () => {
  it("defaults command timeouts to ten minutes and persists local overrides", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    try {
      expect(getUserRuntimeSettings(database, 1).commandTimeoutSeconds).toBe(
        DEFAULT_COMMAND_TIMEOUT_SECONDS,
      );
      expect(
        updateUserRuntimeSettings(database, 1, {
          commandTimeoutSeconds: 120,
        }).commandTimeoutSeconds,
      ).toBe(120);
      expect(getUserRuntimeSettings(database, 1).commandTimeoutSeconds).toBe(
        120,
      );
      expect(
        database
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'user_settings') ORDER BY name ASC",
          )
          .all(),
      ).toEqual([]);
    } finally {
      database.close(false);
    }
  });

  it("migrates existing user settings tables without command timeout columns", () => {
    const database = new Database(":memory:");
    database.run(`
      CREATE TABLE user_settings (
        user_id INTEGER PRIMARY KEY,
        timezone TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    database.run(
      "INSERT INTO user_settings (user_id, timezone) VALUES (7, 'America/New_York')",
    );
    try {
      migrateDatabase(database);
      expect(getTimezoneSettings(database, 1)).toMatchObject({
        timezone: "America/New_York",
        effectiveTimezone: "America/New_York",
      });
      expect(getUserRuntimeSettings(database, 1).commandTimeoutSeconds).toBe(
        DEFAULT_COMMAND_TIMEOUT_SECONDS,
      );
      expect(
        database
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_settings'",
          )
          .all(),
      ).toEqual([]);
    } finally {
      database.close(false);
    }
  });
});

describe("ownerless notifications and web shares", () => {
  it("stores app notifications in a singleton local inbox without a users table", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    try {
      const delivery = recordUserNotificationDelivery(database, {
        body: "Watch the deploy",
        pluginId: "ops",
        priority: "high",
        title: "Deploy",
      });
      expect(delivery.userId).toBe(1);
      expect(listUserNotificationDeliveries(database)).toHaveLength(1);
      expect(
        database
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
          )
          .get(),
      ).toBeNull();
      expect(
        database
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_external_identity_bindings'",
          )
          .get(),
      ).toBeNull();
      expect(
        database
          .query<{ sql: string | null }, []>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%REFERENCES users(%' ORDER BY name ASC",
          )
          .all(),
      ).toEqual([]);
      expect(
        database
          .query<{ name: string }, []>(
            "PRAGMA table_info(app_notification_deliveries)",
          )
          .all()
          .map((column) => column.name),
      ).not.toContain("user_id");
    } finally {
      database.close(false);
    }
  });

  it("migrates legacy app notifications and web shares away from user foreign keys", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE
      );
      INSERT INTO users (id, username) VALUES (1, 'local');
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        git_remote TEXT,
        is_open INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        deleted_at INTEGER,
        owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO projects (id, path, name, owner_user_id)
      VALUES (1, '/tmp/project', 'Project', 1);
      CREATE TABLE threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        worktree_path TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO threads (id, project_id, worktree_path, title)
      VALUES (1, 1, '/tmp/project', 'Thread');
      CREATE TABLE app_notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plugin_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        click_url TEXT,
        priority TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        dismissed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO app_notification_deliveries (user_id, plugin_id, title, body)
      VALUES (1, 'ops', 'Deploy', 'Watch the deploy');
      CREATE INDEX idx_app_notification_deliveries_inbox
        ON app_notification_deliveries(user_id, dismissed_at, sent_at DESC);
      CREATE TABLE web_server_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        claim_token_hash TEXT NOT NULL UNIQUE,
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL,
        server_instance_id TEXT NOT NULL UNIQUE,
        target_port INTEGER NOT NULL,
        owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        worktree_path TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        stopped_at TEXT,
        revoked_at TEXT
      );
      INSERT INTO web_server_shares (
        claim_token_hash, thread_id, server_id, server_instance_id, target_port, owner_user_id, project_id, worktree_path
      ) VALUES (
        'claim', 1, 7, 'instance-1', 4321, 1, 1, '/tmp/project'
      );
    `);
    try {
      migrateDatabase(database);
      expect(listUserNotificationDeliveries(database)[0]).toMatchObject({
        pluginId: "ops",
        title: "Deploy",
        userId: 1,
      });
      const notificationColumns = database
        .query<{ name: string }, []>(
          "PRAGMA table_info(app_notification_deliveries)",
        )
        .all()
        .map((column) => column.name);
      expect(notificationColumns).not.toContain("user_id");
      const shareColumns = database
        .query<{ name: string }, []>("PRAGMA table_info(web_server_shares)")
        .all()
        .map((column) => column.name);
      expect(shareColumns).not.toContain("owner_user_id");
      const foreignKeyViolations = database
        .query<Record<string, unknown>, []>("PRAGMA foreign_key_check")
        .all();
      expect(foreignKeyViolations).toEqual([]);
      const share = createWebServerShare(database, {
        claimTokenHash: "claim-2",
        projectId: 1,
        serverId: 8,
        serverInstanceId: "instance-2",
        targetPort: 4322,
        threadId: 1,
        worktreePath: "/tmp/project",
      });
      expect(share.projectId).toBe(1);
    } finally {
      database.close(false);
    }
  });
});

describe("app database storage", () => {
  it("quotes SQLite identifiers and rejects unsafe names", () => {
    expect(quoteSqliteIdentifier("runtime_stats_snapshots")).toBe(
      '"runtime_stats_snapshots"',
    );
    expect(() => quoteSqliteIdentifier('column"name')).toThrow(
      "SQLite identifier contains unsupported characters.",
    );
    expect(() => quoteSqliteIdentifier("users); DROP TABLE users; --")).toThrow(
      "SQLite identifier contains unsupported characters.",
    );
  });

  it("accepts additive column definitions without statement controls", () => {
    expect(
      assertSafeSqliteColumnDefinition(
        "reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
      ),
    ).toBe("reasoning_effort TEXT NOT NULL DEFAULT 'medium'");
    expect(() =>
      assertSafeSqliteColumnDefinition("safe_name TEXT; DROP TABLE users"),
    ).toThrow("SQLite column definition contains unsupported SQL.");
    expect(() => assertSafeSqliteColumnDefinition("unsafe-name TEXT")).toThrow(
      "SQLite identifier contains unsupported characters.",
    );
    expect(() =>
      assertSafeSqliteColumnDefinition("safe_name TEXT `x`"),
    ).toThrow("SQLite column definition contains unsupported SQL.");
  });

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
      "Set METIDOS_APP_DATA_DIR to an explicit writable application data directory if the default location is unavailable.",
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

  it("applies owner-only permissions to newly created app-data directory trees", () => {
    if (process.platform === "win32") {
      return;
    }

    const appDataRoot = createTempDirectory();
    chmodSync(appDataRoot, 0o755);
    const appDataParent = join(appDataRoot, "parent");
    const appDataDir = join(appDataParent, "child");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    initAppDatabase();

    expect(statSync(appDataParent).mode & 0o777).toBe(0o700);
    expect(statSync(appDataDir).mode & 0o777).toBe(0o700);
  });

  it("refuses symlinked app database files before opening SQLite", () => {
    const appDataDir = createTempDirectory();
    const outsideDatabasePath = join(createTempDirectory(), "outside.db");
    writeFileSync(outsideDatabasePath, "not a metidos database");
    symlinkSync(outsideDatabasePath, join(appDataDir, "app.db"));
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    expect(() => initAppDatabase()).toThrow(
      "Refusing to use App Data file because it is not a regular file",
    );
    expect(readFileSync(outsideDatabasePath, "utf8")).toBe(
      "not a metidos database",
    );
  });

  it("persists plugin external identity bindings by plugin, source, and external user", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    createLegacyUsersTable(database);
    createLegacyPluginExternalIdentityBindingsTable(database);
    database.run(
      "INSERT INTO users (id, username, is_admin) VALUES (7, 'ingress-user', 0)",
    );
    const user = { id: 7 };

    expect(
      getPluginExternalIdentityBinding(
        database,
        "chat-plugin",
        "dm",
        "external-1",
      ),
    ).toBeNull();

    const binding = upsertPluginExternalIdentityBinding(database, {
      pluginId: "chat-plugin",
      sourceId: "dm",
      externalUserId: "external-1",
      metidosUserId: user.id,
      verifiedBy: "link-code",
    });

    expect(binding).toMatchObject({
      pluginId: "chat-plugin",
      sourceId: "dm",
      externalUserId: "external-1",
      metidosUserId: user.id,
      verifiedBy: "link-code",
      enabled: true,
    });
    expect(
      resolveEnabledPluginExternalIdentityBinding(
        database,
        "chat-plugin",
        "dm",
        "external-1",
      )?.metidosUserId,
    ).toBe(user.id);

    upsertPluginExternalIdentityBinding(database, {
      pluginId: "chat-plugin",
      sourceId: "mentions",
      externalUserId: "external-1",
      metidosUserId: user.id,
      verifiedBy: "link-code",
    });
    expect(
      getPluginExternalIdentityBinding(
        database,
        "chat-plugin",
        "mentions",
        "external-1",
      )?.metidosUserId,
    ).toBe(user.id);

    setPluginExternalIdentityBindingEnabled(
      database,
      "chat-plugin",
      "dm",
      "external-1",
      false,
    );
    expect(
      resolveEnabledPluginExternalIdentityBinding(
        database,
        "chat-plugin",
        "dm",
        "external-1",
      ),
    ).toBeNull();
  });

  it("requires external identity bindings to point at enabled Metidos users", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    createLegacyUsersTable(database);
    createLegacyPluginExternalIdentityBindingsTable(database);
    database.run(
      "INSERT INTO users (id, username, enabled, is_admin) VALUES (8, 'disabled-user', 0, 0)",
    );
    const user = { id: 8 };

    expect(() =>
      upsertPluginExternalIdentityBinding(database, {
        pluginId: "chat-plugin",
        sourceId: "dm",
        externalUserId: "external-1",
        metidosUserId: user.id,
        verifiedBy: "link-code",
      }),
    ).toThrow("missing or disabled Metidos user");
    expect(() =>
      upsertPluginExternalIdentityBinding(database, {
        pluginId: "chat-plugin",
        sourceId: "dm",
        externalUserId: "external-2",
        metidosUserId: 999999,
        verifiedBy: "link-code",
      }),
    ).toThrow("missing or disabled Metidos user");
  });

  it("persists plugin ingress cursors by plugin and source", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();

    expect(getPluginIngressCursor(database, "chat-plugin", "dm")).toBeNull();

    const first = upsertPluginIngressCursor(database, {
      pluginId: "chat-plugin",
      sourceId: "dm",
      cursor: "opaque-cursor-1",
    });
    expect(first).toMatchObject({
      pluginId: "chat-plugin",
      sourceId: "dm",
      cursor: "opaque-cursor-1",
    });

    upsertPluginIngressCursor(database, {
      pluginId: "chat-plugin",
      sourceId: "mentions",
      cursor: "other-source-cursor",
    });
    const updated = upsertPluginIngressCursor(database, {
      pluginId: "chat-plugin",
      sourceId: "dm",
      cursor: "opaque-cursor-2",
    });

    expect(updated.cursor).toBe("opaque-cursor-2");
    expect(
      getPluginIngressCursor(database, "chat-plugin", "mentions")?.cursor,
    ).toBe("other-source-cursor");

    closeAppDatabase();
    const reopened = initAppDatabase();
    expect(getPluginIngressCursor(reopened, "chat-plugin", "dm")?.cursor).toBe(
      "opaque-cursor-2",
    );
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
          WHERE deleted_at IS NULL
          ORDER BY last_opened_at DESC, name ASC
        `,
        [],
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
            AND deleted_at IS NULL
          ORDER BY last_opened_at DESC
        `,
        [],
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
            permissions,
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
          WHERE deleted_at IS NULL
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

  it("loads targeted thread summaries without returning unrequested rows or duplicate ids", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Targeted Threads",
      projectPath: join(appDataDir, "targeted-threads"),
    });
    const firstThread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "First",
      unsafeMode: false,
      worktreePath: project.path,
    });
    const secondThread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Second",
      unsafeMode: false,
      worktreePath: project.path,
    });

    const loaded = listThreadsByIds(database, [
      secondThread.id,
      secondThread.id,
      999_999,
    ]);
    expect(loaded.map((thread) => thread.id)).toEqual([secondThread.id]);

    const loadedByIds = listThreadsByIds(database, [
      firstThread.id,
      secondThread.id,
    ]);
    expect(
      loadedByIds.map((thread) => thread.id).sort((a, b) => a - b),
    ).toEqual([firstThread.id, secondThread.id]);
  });

  it("soft-deletes threads and hides them from thread listings", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const project = upsertProject(database, {
        name: "Thread Delete Project",
        projectPath: "/tmp/thread-delete-project",
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Delete Me",
        unsafeMode: false,
        worktreePath: project.path,
      });

      deleteThread(database, thread.id);

      expect(getThreadById(database, thread.id)).toBeNull();
      expect(listThreads(database)).toHaveLength(0);
      expect(
        database
          .query<{ deletedAt: number | null }, [number]>(
            "SELECT deleted_at AS deletedAt FROM threads WHERE id = ?",
          )
          .get(thread.id)?.deletedAt,
      ).toEqual(expect.any(Number));
    } finally {
      database.close(false);
    }
  });

  it("migrates and drops legacy single-user auth tables", () => {
    const database = new Database(":memory:");
    database.run(
      `CREATE TABLE auth_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        primary_factor_type TEXT NOT NULL,
        primary_factor_hash TEXT NOT NULL,
        totp_secret_ciphertext TEXT NOT NULL,
        session_lifetime_days INTEGER NOT NULL DEFAULT 7,
        failed_primary_factor_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    database.run(
      `CREATE TABLE auth_recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code_hash TEXT NOT NULL UNIQUE,
        used_at TEXT,
        created_at TEXT NOT NULL
      )`,
    );
    database
      .query(
        `INSERT INTO auth_settings (
          id,
          primary_factor_type,
          primary_factor_hash,
          totp_secret_ciphertext,
          session_lifetime_days,
          failed_primary_factor_attempts,
          locked_until,
          created_at,
          updated_at
        ) VALUES (1, 'password', 'hash', 'totp-secret', 14, 2, NULL, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
      )
      .run();
    database
      .query(
        `INSERT INTO auth_recovery_codes (code_hash, used_at, created_at)
         VALUES ('code-hash', NULL, '2026-01-01T00:00:00.000Z')`,
      )
      .run();

    try {
      migrateDatabase(database);

      expect(tableExists(database, "auth_settings")).toBe(true);
      expect(tableExists(database, "auth_recovery_codes")).toBe(true);
      expect(tableExists(database, "auth_sessions")).toBe(true);
      expect(tableExists(database, "auth_websocket_tickets")).toBe(true);
      expect(tableExists(database, "user_auth_settings")).toBe(false);
      expect(tableExists(database, "user_auth_recovery_codes")).toBe(false);
      expect(
        database
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM auth_settings",
          )
          .get()?.count,
      ).toBe(1);
      expect(
        database
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM auth_recovery_codes",
          )
          .get()?.count,
      ).toBe(1);
    } finally {
      database.close(false);
    }
  });

  it("soft-deletes projects and their threads instead of removing rows", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const project = upsertProject(database, {
        name: "Project Delete Project",
        projectPath: "/tmp/project-delete-project",
      });
      const threadA = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Thread A",
        unsafeMode: false,
        worktreePath: project.path,
      });
      const threadB = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Thread B",
        unsafeMode: false,
        worktreePath: project.path,
      });

      deleteProject(database, project.id);

      expect(getProjectById(database, project.id)).toBeNull();
      expect(listProjects(database)).toHaveLength(0);
      expect(listThreads(database)).toHaveLength(0);
      expect(
        database
          .query<{ deletedAt: number | null }, [number]>(
            "SELECT deleted_at AS deletedAt FROM projects WHERE id = ?",
          )
          .get(project.id)?.deletedAt,
      ).toEqual(expect.any(Number));
      expect(
        database
          .query<{ deletedAt: number | null }, [number]>(
            "SELECT deleted_at AS deletedAt FROM threads WHERE id = ?",
          )
          .get(threadA.id)?.deletedAt,
      ).toEqual(expect.any(Number));
      expect(
        database
          .query<{ deletedAt: number | null }, [number]>(
            "SELECT deleted_at AS deletedAt FROM threads WHERE id = ?",
          )
          .get(threadB.id)?.deletedAt,
      ).toEqual(expect.any(Number));
    } finally {
      database.close(false);
    }
  });

  it("deletes the app database files and reopens as an empty database", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    expect(isAppDatabaseOpen()).toBeTrue();
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
    expect(isAppDatabaseOpen()).toBeFalse();

    const freshDatabase = initAppDatabase();
    expect(listProjects(freshDatabase)).toHaveLength(0);
    expect(listThreads(freshDatabase)).toHaveLength(0);
    expect(listSecurityAuditEvents(freshDatabase)).toHaveLength(0);
  });

  it("exposes app schema readiness through the schema plan module", () => {
    const tempDirectory = createTempDirectory();
    const databasePath = join(tempDirectory, "app.db");
    const setupDatabase = new Database(databasePath);
    migrateDatabase(setupDatabase);
    setupDatabase.close(false);

    const database = new Database(databasePath);
    try {
      expect(readAppSchemaVersion(database)).toBe(LATEST_APP_SCHEMA_VERSION);
      expect(canSkipAppSchemaMigration(database)).toBe(true);
    } finally {
      database.close(false);
    }
  });

  it("uses batched schema introspection when app migrations are already current", () => {
    const tempDirectory = createTempDirectory();
    const databasePath = join(tempDirectory, "app.db");
    const setupDatabase = new Database(databasePath);
    migrateDatabase(setupDatabase);
    setupDatabase.close(false);

    const database = new Database(databasePath);
    const originalQuery = Database.prototype.query;
    let schemaIntrospectionQueryCount = 0;
    Database.prototype.query = function countedQuery(
      this: Database,
      sql: string,
      ...params: Parameters<Database["query"]> extends [string, ...infer Rest]
        ? Rest
        : never
    ): ReturnType<Database["query"]> {
      if (sql.includes("sqlite_master") || sql.includes("PRAGMA table_info")) {
        schemaIntrospectionQueryCount += 1;
      }
      return originalQuery.call(this, sql, ...params);
    } as Database["query"];

    try {
      migrateDatabase(database);

      expect(schemaIntrospectionQueryCount).toBeLessThanOrEqual(6);
    } finally {
      Database.prototype.query = originalQuery;
      database.close(false);
    }
  });

  it("re-runs app migrations when calendar tables are missing despite a current schema marker", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const calendarTablesToDrop = [
        "calendar_snoozes",
        "calendar_reminder_deliveries",
        "calendar_notification_settings",
        "external_ics_event_cache",
        "external_ics_calendars",
        "calendar_event_reminders",
        "calendar_event_overrides",
        "calendar_event_exdates",
        "calendar_events",
        "calendar_user_preferences",
        "calendar_shares",
        "calendars",
      ] as const;
      for (const tableName of calendarTablesToDrop) {
        database.run(
          `DROP TABLE IF EXISTS ${quoteSqliteIdentifier(tableName)}`,
        );
      }

      migrateDatabase(database);

      expect(
        database
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calendars'",
          )
          .get()?.name,
      ).toBe("calendars");
      expect(
        database
          .query<{ title: string }, []>(
            "SELECT title FROM calendars ORDER BY id ASC LIMIT 1",
          )
          .get()?.title,
      ).toBe("Personal");
    } finally {
      database.close(false);
    }
  });

  it("re-runs app migrations when calendar foreign keys target dropped legacy tables", () => {
    const tempDirectory = createTempDirectory();
    const databasePath = join(tempDirectory, "app.db");
    const setupDatabase = new Database(databasePath);
    const tableSql = (db: Database, tableName: string): string => {
      const row = db
        .query<{ sql: string | null }, [string]>(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(tableName);
      if (!row?.sql) {
        throw new Error(`Missing create SQL for ${tableName}`);
      }
      return row.sql;
    };
    const foreignKeyTargets = (db: Database, tableName: string): string[] =>
      db
        .query<{ table: string }, []>(
          `PRAGMA foreign_key_list(${quoteSqliteIdentifier(tableName)})`,
        )
        .all()
        .map((foreignKey) => foreignKey.table);

    try {
      migrateDatabase(setupDatabase);
      const calendarEventsSql = tableSql(setupDatabase, "calendar_events");
      const calendarEventExdatesSql = tableSql(
        setupDatabase,
        "calendar_event_exdates",
      );
      const calendarEventOverridesSql = tableSql(
        setupDatabase,
        "calendar_event_overrides",
      );
      const externalCalendarsSql = tableSql(
        setupDatabase,
        "external_ics_calendars",
      );

      setupDatabase.run("PRAGMA foreign_keys = OFF");
      setupDatabase.run("BEGIN IMMEDIATE");
      setupDatabase.run(
        "ALTER TABLE calendar_events RENAME TO calendar_events_legacy",
      );
      setupDatabase.run(calendarEventsSql);
      setupDatabase.run(
        "INSERT INTO calendar_events SELECT * FROM calendar_events_legacy",
      );
      setupDatabase.run(
        "ALTER TABLE calendar_event_exdates RENAME TO calendar_event_exdates_legacy",
      );
      setupDatabase.run(calendarEventExdatesSql);
      setupDatabase.run(
        "INSERT INTO calendar_event_exdates SELECT * FROM calendar_event_exdates_legacy",
      );
      setupDatabase.run("DROP TABLE calendar_event_exdates_legacy");
      setupDatabase.run(
        "ALTER TABLE calendar_event_overrides RENAME TO calendar_event_overrides_legacy",
      );
      setupDatabase.run(calendarEventOverridesSql);
      setupDatabase.run(
        "INSERT INTO calendar_event_overrides SELECT * FROM calendar_event_overrides_legacy",
      );
      setupDatabase.run("DROP TABLE calendar_event_overrides_legacy");
      setupDatabase.run("DROP TABLE calendar_events_legacy");
      setupDatabase.run(
        "ALTER TABLE external_ics_calendars RENAME TO external_ics_calendars_legacy",
      );
      setupDatabase.run(externalCalendarsSql);
      setupDatabase.run(
        "INSERT INTO external_ics_calendars SELECT * FROM external_ics_calendars_legacy",
      );
      setupDatabase.run("DROP TABLE external_ics_calendars_legacy");
      setupDatabase.run("COMMIT");
      setupDatabase.run("PRAGMA foreign_keys = ON");
      expect(
        foreignKeyTargets(setupDatabase, "calendar_event_reminders"),
      ).toEqual(["calendar_events_legacy"]);
      expect(
        foreignKeyTargets(setupDatabase, "external_ics_event_cache"),
      ).toEqual(["external_ics_calendars_legacy"]);
    } finally {
      setupDatabase.close(false);
    }

    const upgradedDatabase = new Database(databasePath);
    try {
      migrateDatabase(upgradedDatabase);

      expect(
        foreignKeyTargets(upgradedDatabase, "calendar_event_reminders"),
      ).toEqual(["calendar_events"]);
      expect(
        foreignKeyTargets(upgradedDatabase, "external_ics_event_cache"),
      ).toEqual(["external_ics_calendars"]);
      expect(
        upgradedDatabase
          .query<Record<string, unknown>, []>("PRAGMA foreign_key_check")
          .all(),
      ).toEqual([]);
    } finally {
      upgradedDatabase.close(false);
    }
  });

  it("repairs missing ingress tables despite a current schema marker", () => {
    const tempDirectory = createTempDirectory();
    const databasePath = join(tempDirectory, "app.db");
    const setupDatabase = new Database(databasePath);
    const ingressTablesToDrop = [
      "plugin_ingress_audit_events",
      "plugin_ingress_cursors",
      "plugin_ingress_external_bindings",
      "plugin_ingress_link_codes",
      "plugin_ingress_messages",
      "plugin_ingress_rate_limit_markers",
    ] as const;

    try {
      migrateDatabase(setupDatabase);
      for (const tableName of ingressTablesToDrop) {
        setupDatabase.run(
          `DROP TABLE IF EXISTS ${quoteSqliteIdentifier(tableName)}`,
        );
      }
    } finally {
      setupDatabase.close(false);
    }

    const upgradedDatabase = new Database(databasePath);
    try {
      migrateDatabase(upgradedDatabase);

      for (const tableName of ingressTablesToDrop) {
        expect(tableExists(upgradedDatabase, tableName)).toBe(true);
      }
      expect(
        indexExists(upgradedDatabase, "idx_plugin_ingress_messages_retention"),
      ).toBe(true);
      expect(
        indexExists(upgradedDatabase, "idx_plugin_ingress_audit_events_lookup"),
      ).toBe(true);
      expect(
        indexExists(upgradedDatabase, "idx_plugin_ingress_link_codes_lookup"),
      ).toBe(true);
      expect(
        indexExists(
          upgradedDatabase,
          "idx_plugin_ingress_external_bindings_lookup",
        ),
      ).toBe(true);
      expect(
        upgradedDatabase
          .query<{ name: string }, []>(
            "PRAGMA table_info(plugin_ingress_messages)",
          )
          .all()
          .map((column) => column.name),
      ).toEqual(
        expect.arrayContaining([
          "external_message_id",
          "message_text_redacted_at",
          "response_handle",
          "routing_metadata",
        ]),
      );
    } finally {
      upgradedDatabase.close(false);
    }
  });

  it("keeps legacy access flag columns out of the migrated schema", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const threadColumns = database
        .query<{ name: string }, []>("PRAGMA table_info(threads)")
        .all()
        .map((column) => column.name);
      const cronColumns = database
        .query<{ name: string }, []>("PRAGMA table_info(cron_jobs)")
        .all()
        .map((column) => column.name);

      expect(threadColumns).toContain("permissions");
      expect(cronColumns).toContain("permissions");
      expect(threadColumns).not.toContain("calendar_access");
      expect(cronColumns).not.toContain("calendar_access");
    } finally {
      database.close(false);
    }
  });

  it("re-runs app migrations when auth replay counter column is missing despite a current schema marker", () => {
    const tempDirectory = createTempDirectory();
    const databasePath = join(tempDirectory, "app.db");
    const setupDatabase = new Database(databasePath);
    migrateDatabase(setupDatabase);

    try {
      upsertAuthSettings(setupDatabase, {
        primaryFactorHash: "hash",
        primaryFactorType: "password",
        sessionLifetimeDays: 14,
        totpSecretCiphertext: "totp-secret",
        userId: null,
      });
      setupDatabase.run(
        "ALTER TABLE auth_settings DROP COLUMN totp_last_used_counter",
      );
    } finally {
      setupDatabase.close(false);
    }

    const upgradedDatabase = new Database(databasePath);
    try {
      migrateDatabase(upgradedDatabase);

      const settings = getAuthSettings(upgradedDatabase);
      const authColumns = upgradedDatabase
        .query<{ name: string }, []>("PRAGMA table_info(auth_settings)")
        .all()
        .map((column) => column.name);
      expect(settings?.totpLastUsedCounter).toBeNull();
      expect(authColumns).toContain("totp_last_used_counter");
    } finally {
      upgradedDatabase.close(false);
    }
  });

  it("derives split Metidos access from stored permission strings", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const project = upsertProject(database, {
        name: "Split Metidos Permission Upgrade",
        projectPath: "/tmp/split-metidos-permission-upgrade",
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: false,
        model: DEFAULT_THREAD_MODEL,
        permissions: ["metidos:threads", "metidos:crons"],
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Permission Metidos thread",
        unsafeMode: false,
        worktreePath: project.path,
      });

      const upgradedThread = getThreadById(database, thread.id);

      expect(upgradedThread?.threadsAccess).toBe(true);
      expect(upgradedThread?.cronsAccess).toBe(true);
      expect(upgradedThread?.metidosAccess).toBe(true);
    } finally {
      database.close(false);
    }
  });

  it("re-runs app migrations when plugin access group columns are missing despite a current schema marker", () => {
    const tempDirectory = createTempDirectory();
    const databasePath = join(tempDirectory, "app.db");
    const setupDatabase = new Database(databasePath);
    migrateDatabase(setupDatabase);

    try {
      const project = upsertProject(setupDatabase, {
        name: "Plugin Access Upgrade",
        projectPath: "/tmp/plugin-access-upgrade",
      });
      createThread(setupDatabase, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Plugin access thread",
        unsafeMode: false,
        worktreePath: project.path,
      });
      createCronJob(setupDatabase, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Plugin access cron",
        description: "Cron with plugin access groups",
        schedule: "0 0 * * *",
        prompt: "Run plugin access migration check.",
        unsafeMode: false,
        worktreePath: project.path,
      });

      setupDatabase.run("ALTER TABLE threads DROP COLUMN plugin_access_groups");
      setupDatabase.run(
        "ALTER TABLE cron_jobs DROP COLUMN plugin_access_groups",
      );
    } finally {
      setupDatabase.close(false);
    }

    const upgradedDatabase = new Database(databasePath);
    try {
      migrateDatabase(upgradedDatabase);

      expect(listThreads(upgradedDatabase)[0]?.pluginAccessGroups).toEqual([]);
      expect(
        listActiveCronJobs(upgradedDatabase)[0]?.pluginAccessGroups,
      ).toEqual([]);
    } finally {
      upgradedDatabase.close(false);
    }
  });

  it("tracks visible subprojects separately from optional pin state", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const project = upsertProject(database, {
        name: "Tracked Project",
        projectPath: "/tmp/tracked-project",
      });

      expect(listProjectWorktreesMetadata(database, project.id)).toEqual([]);

      ensureProjectWorktreeVisible(
        database,
        project.id,
        "/tmp/tracked-project-feature",
      );

      expect(listProjectWorktreesMetadata(database, project.id)).toEqual([
        {
          pinnedAt: null,
          projectId: project.id,
          worktreePath: "/tmp/tracked-project-feature",
        },
      ]);

      setProjectWorktreePinned(
        database,
        project.id,
        "/tmp/tracked-project-feature",
        true,
      );
      setProjectWorktreePinned(
        database,
        project.id,
        "/tmp/tracked-project-release",
        true,
      );

      const pinnedRecords = listProjectWorktreesMetadata(database, project.id);
      expect(pinnedRecords).toHaveLength(2);
      expect(pinnedRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: project.id,
            worktreePath: "/tmp/tracked-project-feature",
          }),
          expect.objectContaining({
            projectId: project.id,
            worktreePath: "/tmp/tracked-project-release",
          }),
        ]),
      );
      expect(
        pinnedRecords.every((record) => typeof record.pinnedAt === "string"),
      ).toBeTrue();

      setProjectWorktreePinned(
        database,
        project.id,
        "/tmp/tracked-project-feature",
        false,
      );

      expect(listProjectWorktreesMetadata(database, project.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pinnedAt: null,
            projectId: project.id,
            worktreePath: "/tmp/tracked-project-feature",
          }),
          expect.objectContaining({
            projectId: project.id,
            worktreePath: "/tmp/tracked-project-release",
          }),
        ]),
      );
    } finally {
      database.close(false);
    }
  });

  it("migrates legacy pinned worktree rows into tracked subprojects", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const project = upsertProject(database, {
        name: "Legacy Worktree Project",
        projectPath: "/tmp/legacy-worktree-project",
      });

      database.run("DROP TABLE project_worktrees");
      database.run(`
        CREATE TABLE project_worktrees (
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          worktree_path TEXT NOT NULL,
          pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          PRIMARY KEY (project_id, worktree_path)
        )
      `);
      database.run(
        `
          INSERT INTO project_worktrees (
            project_id,
            worktree_path,
            pinned_at
          )
          VALUES (?, ?, ?)
        `,
        [
          project.id,
          "/tmp/legacy-worktree-project-feature",
          "2026-04-12T12:00:00.000Z",
        ],
      );

      migrateDatabase(database);
      ensureProjectWorktreeVisible(
        database,
        project.id,
        "/tmp/legacy-worktree-project-release",
      );

      expect(listProjectWorktreesMetadata(database, project.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pinnedAt: "2026-04-12T12:00:00.000Z",
            projectId: project.id,
            worktreePath: "/tmp/legacy-worktree-project-feature",
          }),
          expect.objectContaining({
            pinnedAt: null,
            projectId: project.id,
            worktreePath: "/tmp/legacy-worktree-project-release",
          }),
        ]),
      );
    } finally {
      database.close(false);
    }
  });

  it("treats users without a stored TOTP secret as pending setup", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      createLegacyUsersTable(database);
      database.run(
        "INSERT INTO users (id, username, is_admin) VALUES (9, 'legacy-local-operator', 0)",
      );
      upsertAuthSettings(database, {
        primaryFactorHash: "primary-factor-hash",
        primaryFactorType: "pin",
        sessionLifetimeDays: 7,
        totpSecretCiphertext: "",
        userId: 9,
      });

      expect(listUsersWithSetupStatus(database)).toEqual([
        expect.objectContaining({
          configured: false,
          username: "legacy-local-operator",
        }),
      ]);
    } finally {
      database.close(false);
    }
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
      pluginAccessGroups: ["beta_plugin/tools", "alpha_plugin/alpha_tools"],
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
        permissions: [
          "alpha_plugin:alpha_tools",
          "beta_plugin:tools",
          "metidos:agents",
          "metidos:crons",
          "metidos:threads",
          "metidos:web-search",
        ],
        pluginAccessGroups: ["alpha_plugin/alpha_tools", "beta_plugin/tools"],
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
        pluginAccessGroups: ["alpha_plugin/alpha_tools", "beta_plugin/tools"],
      }),
    );
  });

  it("persists explicit thread and cron permission arrays", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Permissions Repo",
      projectPath: join(appDataDir, "project"),
    });

    const thread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      permissions: [
        "weather:forecast",
        "metidos:git",
        "metidos:git",
        "metidos:web-search",
      ],
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Permission Thread",
      unsafeMode: false,
      worktreePath: project.path,
    });
    expect(thread.permissions).toEqual([
      "metidos:git",
      "metidos:web-search",
      "weather:forecast",
    ]);
    const persistedThread = getThreadById(database, thread.id);
    expect(persistedThread?.permissions).toEqual([
      "metidos:git",
      "metidos:web-search",
      "weather:forecast",
    ]);
    expect(persistedThread?.webServerAccess).toBe(false);

    setThreadAccess(database, thread.id, {
      agentsAccess: false,
      calendarAccess: false,
      cronsAccess: false,
      githubAccess: false,
      gitAccess: true,
      metidosAccess: true,
      notificationsAccess: false,
      permissions: ["metidos:git", "metidos:web-search", "weather:forecast"],
      pluginAccessGroups: [],
      sqliteAccess: false,
      threadsAccess: true,
      unsafeMode: false,
      weatherAccess: false,
      webSearchAccess: false,
      webServerAccess: false,
    });
    expect(getThreadById(database, thread.id)?.permissions).toEqual([
      "metidos:git",
      "metidos:web-search",
      "weather:forecast",
    ]);

    setThreadUnsafeMode(database, thread.id, true);
    expect(getThreadById(database, thread.id)?.permissions).toContain(
      "metidos:unsafe",
    );
    setThreadUnsafeMode(database, thread.id, false);
    expect(getThreadById(database, thread.id)?.permissions).not.toContain(
      "metidos:unsafe",
    );

    const cron = createCronJob(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      permissions: ["metidos:crons", "weather:forecast"],
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Permission Cron",
      description: "Cron with permission strings",
      schedule: "0 0 * * *",
      prompt: "Run permission check.",
      unsafeMode: false,
      worktreePath: project.path,
    });
    expect(cron.permissions).toEqual(["metidos:crons", "weather:forecast"]);
    expect(cron.webServerAccess).toBe(false);

    const updatedCron = updateCronJob(database, cron.id, {
      permissions: ["metidos:threads", "weather:forecast"],
    });
    expect(updatedCron.permissions).toEqual([
      "metidos:threads",
      "weather:forecast",
    ]);
  });

  it("updates cron job execution project and worktree", () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const database = initAppDatabase();
    const firstProject = upsertProject(database, {
      name: "First Repo",
      projectPath: join(appDataDir, "first"),
    });
    const secondProject = upsertProject(database, {
      name: "Second Repo",
      projectPath: join(appDataDir, "second"),
    });

    const cron = createCronJob(database, {
      agentsAccess: false,
      description: "Cron that moves folders",
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      permissions: ["metidos:threads"],
      projectId: firstProject.id,
      prompt: "Run in a folder.",
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      schedule: "0 0 * * *",
      title: "Folder Cron",
      unsafeMode: false,
      worktreePath: firstProject.path,
    });

    const updatedCron = updateCronJob(database, cron.id, {
      projectId: secondProject.id,
      worktreePath: secondProject.path,
    });

    expect(updatedCron.projectId).toBe(secondProject.id);
    expect(updatedCron.worktreePath).toBe(secondProject.path);
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
