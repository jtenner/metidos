/**
 * @file src/bun/app-schema-migration.test.ts
 * @description Regression coverage for App Data schema readiness and legacy migration seams.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canSkipAppSchemaMigration,
  LATEST_APP_SCHEMA_VERSION,
  readAppSchemaVersion,
} from "./app-schema-migration";
import { migrateDatabase, quoteSqliteIdentifier } from "./db";

const tempDirectories = new Set<string>();

type DatabaseMutator = (database: Database) => void;
type DatabaseVerifier = (database: Database) => void;

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-app-schema-"));
  tempDirectories.add(path);
  return path;
}

function createTempDatabasePath(): string {
  return join(createTempDirectory(), "app.db");
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

function columnNames(database: Database, tableName: string): string[] {
  return database
    .query<{ name: string }, []>(
      `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`,
    )
    .all()
    .map((column) => column.name);
}

function columnNotNull(
  database: Database,
  tableName: string,
  columnName: string,
): number | null {
  return (
    database
      .query<{ name: string; notnull: number }, []>(
        `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`,
      )
      .all()
      .find((column) => column.name === columnName)?.notnull ?? null
  );
}

function tableSql(database: Database, tableName: string): string {
  const sql = database
    .query<{ sql: string | null }, [string]>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName)?.sql;
  if (!sql) {
    throw new Error(`Missing create SQL for ${tableName}`);
  }
  return sql;
}

function foreignKeyTargets(database: Database, tableName: string): string[] {
  return database
    .query<{ table: string }, []>(
      `PRAGMA foreign_key_list(${quoteSqliteIdentifier(tableName)})`,
    )
    .all()
    .map((foreignKey) => foreignKey.table);
}

function expectCurrentMarkerDriftIsRepaired(
  mutate: DatabaseMutator,
  verify: DatabaseVerifier,
): void {
  const databasePath = createTempDatabasePath();
  const setupDatabase = new Database(databasePath);
  migrateDatabase(setupDatabase);
  setupDatabase.close(false);

  const driftDatabase = new Database(databasePath);
  mutate(driftDatabase);
  driftDatabase.close(false);

  const detectionDatabase = new Database(databasePath);
  expect(readAppSchemaVersion(detectionDatabase)).toBe(
    LATEST_APP_SCHEMA_VERSION,
  );
  expect(canSkipAppSchemaMigration(detectionDatabase)).toBe(false);
  detectionDatabase.close(false);

  const upgradeDatabase = new Database(databasePath);
  migrateDatabase(upgradeDatabase);
  upgradeDatabase.close(false);

  const verifiedDatabase = new Database(databasePath);
  try {
    expect(readAppSchemaVersion(verifiedDatabase)).toBe(
      LATEST_APP_SCHEMA_VERSION,
    );
    expect(canSkipAppSchemaMigration(verifiedDatabase)).toBe(true);
    verify(verifiedDatabase);
  } finally {
    verifiedDatabase.close(false);
  }
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("app schema migration", () => {
  it("skips migration for a current initialized database", () => {
    const databasePath = createTempDatabasePath();
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

  it("detects and repairs representative current-marker schema drift", () => {
    const scenarios: Array<{
      name: string;
      mutate: DatabaseMutator;
      verify: DatabaseVerifier;
    }> = [
      {
        name: "legacy project worktree pin ownership shape",
        mutate(database) {
          database.run("DROP TABLE project_worktrees");
          database.run(`
            CREATE TABLE project_worktrees (
              project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              worktree_path TEXT NOT NULL,
              pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              PRIMARY KEY (project_id, worktree_path)
            )
          `);
        },
        verify(database) {
          expect(
            columnNotNull(database, "project_worktrees", "pinned_at"),
          ).toBe(0);
        },
      },
      {
        name: "missing plugin ingress schema objects",
        mutate(database) {
          database.run("DROP TABLE plugin_ingress_messages");
        },
        verify(database) {
          expect(tableExists(database, "plugin_ingress_messages")).toBe(true);
          expect(
            indexExists(database, "idx_plugin_ingress_messages_retention"),
          ).toBe(true);
          expect(columnNames(database, "plugin_ingress_messages")).toEqual(
            expect.arrayContaining([
              "message_text_redacted_at",
              "response_handle",
              "routing_metadata",
            ]),
          );
        },
      },
      {
        name: "legacy calendar foreign-key targets",
        mutate(database) {
          const calendarEventsSql = tableSql(database, "calendar_events");
          const calendarEventExdatesSql = tableSql(
            database,
            "calendar_event_exdates",
          );
          const calendarEventOverridesSql = tableSql(
            database,
            "calendar_event_overrides",
          );
          const externalCalendarsSql = tableSql(
            database,
            "external_ics_calendars",
          );

          database.run("PRAGMA foreign_keys = OFF");
          database.run("BEGIN IMMEDIATE");
          database.run(
            "ALTER TABLE calendar_events RENAME TO calendar_events_legacy",
          );
          database.run(calendarEventsSql);
          database.run(
            "INSERT INTO calendar_events SELECT * FROM calendar_events_legacy",
          );
          database.run(
            "ALTER TABLE calendar_event_exdates RENAME TO calendar_event_exdates_legacy",
          );
          database.run(calendarEventExdatesSql);
          database.run(
            "INSERT INTO calendar_event_exdates SELECT * FROM calendar_event_exdates_legacy",
          );
          database.run("DROP TABLE calendar_event_exdates_legacy");
          database.run(
            "ALTER TABLE calendar_event_overrides RENAME TO calendar_event_overrides_legacy",
          );
          database.run(calendarEventOverridesSql);
          database.run(
            "INSERT INTO calendar_event_overrides SELECT * FROM calendar_event_overrides_legacy",
          );
          database.run("DROP TABLE calendar_event_overrides_legacy");
          database.run("DROP TABLE calendar_events_legacy");
          database.run(
            "ALTER TABLE external_ics_calendars RENAME TO external_ics_calendars_legacy",
          );
          database.run(externalCalendarsSql);
          database.run(
            "INSERT INTO external_ics_calendars SELECT * FROM external_ics_calendars_legacy",
          );
          database.run("DROP TABLE external_ics_calendars_legacy");
          database.run("COMMIT");
          database.run("PRAGMA foreign_keys = ON");
        },
        verify(database) {
          expect(
            foreignKeyTargets(database, "calendar_event_reminders"),
          ).toEqual(["calendar_events"]);
          expect(
            foreignKeyTargets(database, "external_ics_event_cache"),
          ).toEqual(["external_ics_calendars"]);
        },
      },
      {
        name: "missing project favicon column",
        mutate(database) {
          database.run("ALTER TABLE projects DROP COLUMN favicon_data_url");
        },
        verify(database) {
          expect(columnNames(database, "projects")).toContain(
            "favicon_data_url",
          );
        },
      },
      {
        name: "missing thread and cron permission columns",
        mutate(database) {
          database.run("ALTER TABLE threads DROP COLUMN permissions");
          database.run("ALTER TABLE cron_jobs DROP COLUMN permissions");
        },
        verify(database) {
          expect(columnNames(database, "threads")).toContain("permissions");
          expect(columnNames(database, "cron_jobs")).toContain("permissions");
        },
      },
    ];

    for (const scenario of scenarios) {
      try {
        expectCurrentMarkerDriftIsRepaired(scenario.mutate, scenario.verify);
      } catch (error) {
        throw new Error(`Scenario failed: ${scenario.name}`, {
          cause: error,
        });
      }
    }
  });

  it("migrates legacy local-operator auth through the app schema entrypoint", () => {
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
      VALUES (1, '/tmp/legacy-app-schema', 'Legacy App Schema', 1);
      CREATE TABLE threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        worktree_path TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO threads (id, project_id, worktree_path, title)
      VALUES (1, 1, '/tmp/legacy-app-schema', 'Legacy Thread');
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
        claim_token_hash,
        thread_id,
        server_id,
        server_instance_id,
        target_port,
        owner_user_id,
        project_id,
        worktree_path
      ) VALUES ('claim', 1, 7, 'instance-1', 4321, 1, 1, '/tmp/legacy-app-schema');
      CREATE TABLE app_notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        click_url TEXT,
        priority TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        dismissed_at TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO app_notification_deliveries (
        id,
        plugin_id,
        title,
        body,
        click_url,
        priority,
        tags_json,
        status,
        user_id
      ) VALUES (1, 'weather', 'Legacy Notice', 'Rain soon', 'metidos://notice', 'high', '["forecast"]', 'sent', 1);
      CREATE TABLE user_auth_settings (
        user_id INTEGER PRIMARY KEY,
        primary_factor_type TEXT NOT NULL,
        primary_factor_hash TEXT NOT NULL,
        totp_secret_ciphertext TEXT NOT NULL,
        session_lifetime_days INTEGER NOT NULL DEFAULT 7,
        failed_primary_factor_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE user_auth_recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO user_auth_settings (
        user_id,
        primary_factor_type,
        primary_factor_hash,
        totp_secret_ciphertext,
        session_lifetime_days
      ) VALUES (1, 'pin', 'primary-hash', 'totp-ciphertext', 14);
      INSERT INTO user_auth_recovery_codes (user_id, code_hash)
      VALUES (1, 'recovery-hash');
    `);

    try {
      migrateDatabase(database);

      expect(tableExists(database, "user_auth_settings")).toBe(false);
      expect(tableExists(database, "user_auth_recovery_codes")).toBe(false);
      expect(columnNames(database, "projects")).not.toContain("owner_user_id");
      expect(columnNames(database, "web_server_shares")).toEqual(
        expect.arrayContaining(["project_id", "worktree_path"]),
      );
      expect(columnNames(database, "web_server_shares")).not.toContain(
        "owner_user_id",
      );
      expect(
        columnNames(database, "app_notification_deliveries"),
      ).not.toContain("user_id");
      expect(
        database
          .query<
            {
              body: string;
              plugin_id: string;
              priority: string;
              tags_json: string;
              title: string;
            },
            []
          >(
            `SELECT plugin_id, title, body, priority, tags_json
             FROM app_notification_deliveries
             WHERE id = 1`,
          )
          .get(),
      ).toEqual({
        body: "Rain soon",
        plugin_id: "weather",
        priority: "high",
        tags_json: '["forecast"]',
        title: "Legacy Notice",
      });
      expect(
        database
          .query<
            {
              primary_factor_hash: string;
              session_lifetime_days: number;
              totp_secret_ciphertext: string;
            },
            []
          >(
            `SELECT primary_factor_hash,
                    session_lifetime_days,
                    totp_secret_ciphertext
             FROM auth_settings
             WHERE id = 1`,
          )
          .get(),
      ).toEqual({
        primary_factor_hash: "primary-hash",
        session_lifetime_days: 14,
        totp_secret_ciphertext: "totp-ciphertext",
      });
      expect(
        database
          .query<{ code_hash: string }, []>(
            "SELECT code_hash FROM auth_recovery_codes",
          )
          .get()?.code_hash,
      ).toBe("recovery-hash");
    } finally {
      database.close(false);
    }
  });
});
