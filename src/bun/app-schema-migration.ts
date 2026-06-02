/**
 * @file src/bun/app-schema-migration.ts
 * @description App Data schema migration seam, version marker, readiness probes, and DDL helpers.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import { initCalendarSchema } from "./calendar/store";
import { initPluginIngressMessageSchema } from "./plugin/ingress-store";

export const LATEST_APP_SCHEMA_VERSION = 6;

function runStatement(
  database: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): ReturnType<Database["run"]> {
  return bindings.length === 0
    ? database.run(sql)
    : database.run(sql, bindings);
}

export const APP_SCHEMA_TABLE_NAMES = [
  "app_settings",
  "calendar_event_exdates",
  "calendar_event_overrides",
  "calendar_event_reminders",
  "calendar_events",
  "calendar_id_sequence",
  "calendar_notification_settings",
  "calendar_reminder_deliveries",
  "calendar_shares",
  "calendar_snoozes",
  "calendar_user_preferences",
  "calendars",
  "client_log_events",
  "cron_job_runs",
  "cron_jobs",
  "external_ics_calendars",
  "external_ics_event_cache",
  "project_worktrees",
  "projects",
  "plugin_ingress_audit_events",
  "plugin_ingress_cursors",
  "plugin_ingress_external_bindings",
  "plugin_ingress_link_codes",
  "plugin_ingress_messages",
  "plugin_ingress_route_configs",
  "plugin_ingress_rate_limit_markers",
  "plugin_notification_rate_limits",
  "schema_version",
  "security_audit_events",
  "terminal_settings",
  "thread_messages",
  "threads",
  "app_notification_deliveries",
  "auth_recovery_codes",
  "auth_sessions",
  "auth_settings",
  "auth_websocket_tickets",
  "user_settings",
  "users",
  "web_server_share_sessions",
  "web_server_shares",
] as const;

export type AppSchemaTableName = (typeof APP_SCHEMA_TABLE_NAMES)[number];

export function quoteSqliteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(trimmed)) {
    throw new Error("SQLite identifier contains unsupported characters.");
  }
  return `"${trimmed}"`;
}

export function assertSafeSqliteColumnDefinition(
  columnDefinition: string,
): string {
  // This helper is intentionally limited to repository-authored migration DDL,
  // never user input. The migration planner validates the first token as a
  // normal SQLite identifier and rejects statement separators/comments so a
  // single ADD COLUMN fragment cannot become multiple statements. Keep new
  // dynamic DDL sites on quoted identifiers instead of broadening this parser.
  const trimmed = columnDefinition.trim();
  const [columnName] = trimmed.split(/\s+/u);
  if (
    !trimmed ||
    !columnName ||
    trimmed.includes(";") ||
    trimmed.includes("\0") ||
    trimmed.includes("--") ||
    trimmed.includes("/*") ||
    trimmed.includes("*/") ||
    trimmed.includes("`")
  ) {
    throw new Error("SQLite column definition contains unsupported SQL.");
  }
  quoteSqliteIdentifier(columnName);
  return trimmed;
}

/**
 * Performs tableHasColumn operation.
 * @param db - Database connection used for schema introspection.
 * @param tableName - Name of the table being checked for a column.
 * @param columnName - Column name whose existence is being validated.
 */

export function tableHasColumn(
  db: Database,
  tableName: AppSchemaTableName,
  columnName: string,
): boolean {
  /** True when `columnName` is already present in the table schema. */
  return db
    .query<{ name: string }, []>(
      `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`,
    )
    .all()
    .some((column) => column.name === columnName);
}

export function readAppSchemaVersion(db: Database): number | null {
  try {
    const row = db
      .query<{ version: number }, []>(
        "SELECT version FROM schema_version WHERE id = 1",
      )
      .get();
    return typeof row?.version === "number" ? row.version : null;
  } catch {
    return null;
  }
}

const appSchemaMigrationSkipCache = new WeakMap<Database, boolean>();

export const APP_SCHEMA_MIGRATION_REQUIRED_TABLES = [
  "app_settings",
  "app_notification_deliveries",
  "calendar_event_exdates",
  "calendar_event_overrides",
  "calendar_event_reminders",
  "calendar_events",
  "calendar_notification_settings",
  "calendar_reminder_deliveries",
  "calendar_snoozes",
  "calendar_user_preferences",
  "calendars",
  "external_ics_calendars",
  "external_ics_event_cache",
  "plugin_ingress_audit_events",
  "plugin_ingress_cursors",
  "plugin_ingress_external_bindings",
  "plugin_ingress_link_codes",
  "plugin_ingress_messages",
  "plugin_ingress_route_configs",
  "plugin_ingress_rate_limit_markers",
  "plugin_notification_rate_limits",
  "project_worktrees",
  "terminal_settings",
] as const satisfies readonly AppSchemaTableName[];

export const APP_SCHEMA_MIGRATION_REQUIRED_COLUMNS = {
  cron_jobs: ["permissions", "plugin_access_groups"],
  plugin_ingress_audit_events: [
    "id",
    "plugin_id",
    "source_id",
    "decision",
    "external_message_id",
    "external_user_id",
    "conversation_id",
    "thread_id",
    "success",
    "reason",
    "text_preview",
    "text_sha256",
    "metadata",
    "created_at",
  ],
  plugin_ingress_cursors: [
    "plugin_id",
    "source_id",
    "cursor",
    "created_at",
    "updated_at",
  ],
  plugin_ingress_external_bindings: [
    "id",
    "plugin_id",
    "source_id",
    "external_user_id",
    "enabled",
    "created_at",
    "updated_at",
  ],
  plugin_ingress_link_codes: [
    "id",
    "plugin_id",
    "source_id",
    "code_sha256",
    "expires_at",
    "consumed_at",
    "consumed_external_user_id",
    "created_at",
  ],
  plugin_ingress_messages: [
    "id",
    "plugin_id",
    "source_id",
    "external_message_id",
    "external_user_id",
    "conversation_id",
    "message_text",
    "message_text_redacted_at",
    "status",
    "response_handle",
    "routing_metadata",
    "error_metadata",
    "received_at",
    "created_at",
    "updated_at",
  ],
  plugin_ingress_route_configs: [
    "id",
    "plugin_id",
    "source_id",
    "project_id",
    "worktree_path",
    "model",
    "permissions_json",
    "enabled",
    "created_at",
    "updated_at",
  ],
  plugin_ingress_rate_limit_markers: [
    "plugin_id",
    "source_id",
    "external_user_id",
    "conversation_id",
    "window_kind",
    "window_start",
    "first_seen_at",
    "last_seen_at",
    "count",
  ],
  app_settings: [
    "timezone",
    "command_timeout_seconds",
    "embedding_model",
    "updated_at",
  ],
  auth_settings: ["totp_last_used_counter"],
  app_notification_deliveries: [
    "id",
    "plugin_id",
    "title",
    "body",
    "click_url",
    "priority",
    "tags_json",
    "status",
    "sent_at",
    "dismissed_at",
    "created_at",
    "updated_at",
  ],
  projects: ["favicon_data_url"],
  project_worktrees: ["pinned_at"],
  threads: ["permissions", "plugin_access_groups"],
  web_server_shares: [
    "id",
    "claim_token_hash",
    "thread_id",
    "server_id",
    "server_instance_id",
    "target_port",
    "project_id",
    "worktree_path",
    "created_at",
    "updated_at",
    "stopped_at",
    "revoked_at",
  ],
} as const satisfies Partial<Record<AppSchemaTableName, readonly string[]>>;

export const APP_SCHEMA_MIGRATION_REQUIRED_INDEXES = [
  "idx_calendars_deleted_at",
  "idx_calendar_events_deleted_at",
  "idx_plugin_ingress_audit_events_lookup",
  "idx_plugin_ingress_external_bindings_lookup",
  "idx_plugin_ingress_link_codes_lookup",
  "idx_plugin_ingress_messages_retention",
  "idx_plugin_ingress_route_configs_lookup",
] as const;

type AppSchemaColumnInfo = {
  name: string;
  notnull: number;
};

type AppSchemaColumnInfoRow = {
  name: string;
  table_name: string;
  column_notnull: number;
};

function readExistingAppSchemaObjects(
  db: Database,
  objectType: "index" | "table",
  names: readonly string[],
): Set<string> {
  if (names.length === 0) {
    return new Set();
  }
  const placeholders = names.map(() => "?").join(", ");
  return new Set(
    db
      .query<{ name: string }, string[]>(
        `SELECT name FROM sqlite_master WHERE type = ? AND name IN (${placeholders})`,
      )
      .all(objectType, ...names)
      .map((row) => row.name),
  );
}

function readExistingAppSchemaTables(
  db: Database,
  tableNames: readonly AppSchemaTableName[],
): Set<string> {
  return readExistingAppSchemaObjects(db, "table", tableNames);
}

function readExistingAppSchemaIndexes(
  db: Database,
  indexNames: readonly string[],
): Set<string> {
  return readExistingAppSchemaObjects(db, "index", indexNames);
}

export function readAppSchemaColumnInfo(
  db: Database,
  tableName: AppSchemaTableName,
): Map<string, AppSchemaColumnInfo> {
  return new Map(
    db
      .query<AppSchemaColumnInfo, []>(
        `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`,
      )
      .all()
      .map((column) => [column.name, column]),
  );
}

function readAppSchemaColumnsInfo(
  db: Database,
  tableNames: readonly AppSchemaTableName[],
): Map<string, Map<string, AppSchemaColumnInfo>> {
  if (tableNames.length === 0) {
    return new Map();
  }
  const placeholders = tableNames.map(() => "?").join(", ");
  const rows = db
    .query<AppSchemaColumnInfoRow, string[]>(
      `SELECT sqlite_master.name AS table_name,
              pragma_table_info.name AS name,
              pragma_table_info."notnull" AS column_notnull
       FROM sqlite_master
       JOIN pragma_table_info(sqlite_master.name)
       WHERE sqlite_master.type = 'table'
         AND sqlite_master.name IN (${placeholders})`,
    )
    .all(...tableNames);
  const columnInfoByTable = new Map<string, Map<string, AppSchemaColumnInfo>>();
  for (const row of rows) {
    let tableColumns = columnInfoByTable.get(row.table_name);
    if (!tableColumns) {
      tableColumns = new Map();
      columnInfoByTable.set(row.table_name, tableColumns);
    }
    tableColumns.set(row.name, {
      name: row.name,
      notnull: row.column_notnull,
    });
  }
  return columnInfoByTable;
}

function appSchemaTableReferences(
  db: Database,
  tableName: AppSchemaTableName,
  referencedTableName: string,
): boolean {
  return db
    .query<{ table: string }, []>(
      `PRAGMA foreign_key_list(${quoteSqliteIdentifier(tableName)})`,
    )
    .all()
    .some((foreignKey) => foreignKey.table === referencedTableName);
}

function appSchemaHasLegacyCalendarForeignKeyTargets(db: Database): boolean {
  return (
    appSchemaTableReferences(
      db,
      "calendar_event_reminders",
      "calendar_events_legacy",
    ) ||
    appSchemaTableReferences(
      db,
      "external_ics_event_cache",
      "external_ics_calendars_legacy",
    )
  );
}

export function canSkipAppSchemaMigration(db: Database): boolean {
  const cached = appSchemaMigrationSkipCache.get(db);
  if (typeof cached === "boolean") {
    return cached;
  }

  let canSkip = readAppSchemaVersion(db) === LATEST_APP_SCHEMA_VERSION;
  if (canSkip) {
    const existingTables = readExistingAppSchemaTables(
      db,
      APP_SCHEMA_MIGRATION_REQUIRED_TABLES,
    );
    canSkip = APP_SCHEMA_MIGRATION_REQUIRED_TABLES.every((tableName) =>
      existingTables.has(tableName),
    );
  }

  if (canSkip) {
    const columnTableNames = Object.keys(
      APP_SCHEMA_MIGRATION_REQUIRED_COLUMNS,
    ) as AppSchemaTableName[];
    const columnInfoByTable = readAppSchemaColumnsInfo(db, columnTableNames);
    canSkip = Object.entries(APP_SCHEMA_MIGRATION_REQUIRED_COLUMNS).every(
      ([tableName, columnNames]) => {
        const columns = columnInfoByTable.get(tableName);
        return columnNames.every((columnName) => columns?.has(columnName));
      },
    );
    canSkip =
      canSkip &&
      columnInfoByTable.get("project_worktrees")?.get("pinned_at")?.notnull !==
        1;
  }

  if (canSkip) {
    canSkip = !appSchemaHasLegacyCalendarForeignKeyTargets(db);
  }

  if (canSkip) {
    const existingIndexes = readExistingAppSchemaIndexes(
      db,
      APP_SCHEMA_MIGRATION_REQUIRED_INDEXES,
    );
    canSkip = APP_SCHEMA_MIGRATION_REQUIRED_INDEXES.every((indexName) =>
      existingIndexes.has(indexName),
    );
  }

  appSchemaMigrationSkipCache.set(db, canSkip);
  return canSkip;
}

export type AppSchemaMigrationHooks = {
  migrateLegacySingleUserAuth: (database: Database) => void;
  dropLegacySingleUserAuthTables: (database: Database) => void;
  backfillThreadPermissions: (database: Database) => void;
  backfillCronJobPermissions: (database: Database) => void;
};

export type AppSchemaMigrationOptions = {
  defaultCommandTimeoutSeconds: number;
  defaultCommandTimeoutSecondsSql: string;
  defaultThreadModel: string;
  defaultThreadReasoningEffort: string;
};

function tableExists(db: Database, tableName: string): boolean {
  return Boolean(
    db
      .query<{ name: string }, [string]>(
        `
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name = ?
		`,
      )
      .get(tableName),
  );
}

function countRows(db: Database, tableName: string): number {
  const row = db
    .query<{ count: number }, []>(
      `SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(tableName)}`,
    )
    .get();
  return row?.count ?? 0;
}

function tableColumnIsNotNull(
  db: Database,
  tableName: AppSchemaTableName,
  columnName: string,
): boolean {
  const column = db
    .query<{ name: string; notnull: number }, []>(
      `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`,
    )
    .all()
    .find((entry) => entry.name === columnName);
  return column?.notnull === 1;
}

export function ensureAppSchemaColumn(
  db: Database,
  tableName: AppSchemaTableName,
  columnName: string,
  columnDefinition: string,
): void {
  // This helper is intentionally schema-bounded rather than row-bounded: each
  // check reads PRAGMA table_info for one table, never application data. The
  // cold migration path can pay these small metadata queries, while the
  // canSkipAppSchemaMigration() cache avoids this helper on steady-state starts.
  if (!tableHasColumn(db, tableName, columnName)) {
    runStatement(
      db,
      `ALTER TABLE ${quoteSqliteIdentifier(
        tableName,
      )} ADD COLUMN ${assertSafeSqliteColumnDefinition(columnDefinition)}`,
    );
  }
}

function ensureProjectColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  ensureAppSchemaColumn(db, "projects", columnName, columnDefinition);
}

function ensureThreadColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  ensureAppSchemaColumn(db, "threads", columnName, columnDefinition);
}

function ensureThreadMessageColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  ensureAppSchemaColumn(db, "thread_messages", columnName, columnDefinition);
}

function ensureCronJobColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  ensureAppSchemaColumn(db, "cron_jobs", columnName, columnDefinition);
}

const LEGACY_ACCESS_COLUMN_NAMES = [
  "web_search_access",
  "webview_access",
  "github_access",
  "git_access",
  "sqlite_access",
  "web_server_access",
  "agents_access",
  "calendar_access",
  "notifications_access",
  "weather_access",
  "threads_access",
  "crons_access",
  "metidos_access",
  "unsafe_mode",
] as const;

function dropLegacyAccessColumns(
  db: Database,
  tableName: AppSchemaTableName,
): void {
  const columnInfo = readAppSchemaColumnInfo(db, tableName);
  for (const columnName of LEGACY_ACCESS_COLUMN_NAMES) {
    if (columnInfo.has(columnName)) {
      runStatement(
        db,
        `ALTER TABLE ${quoteSqliteIdentifier(tableName)} DROP COLUMN ${quoteSqliteIdentifier(columnName)}`,
      );
    }
  }
}

function dedupeActiveCronJobTitles(database: Database): void {
  const activeJobRows = database
    .query<{ id: number; title: string }, []>(
      `
			SELECT
				id,
				title
			FROM cron_jobs
			WHERE deleted_at IS NULL
			ORDER BY LOWER(TRIM(title)) ASC, created_at ASC, id ASC
		`,
    )
    .all();

  const titleCounts = new Map<string, number>();
  for (const row of activeJobRows) {
    const title = row.title.trim().toLowerCase();
    const currentCount = titleCounts.get(title) ?? 0;
    titleCounts.set(title, currentCount + 1);
    if (currentCount > 0) {
      runStatement(
        database,
        `UPDATE cron_jobs SET title = ? WHERE id = ?`,
        `${row.title}-${currentCount}`,
        row.id,
      );
    }
  }
}

export function initTimezoneSettingsSchema(
  database: Database,
  options: AppSchemaMigrationOptions,
): void {
  runStatement(
    database,
    `CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      timezone TEXT NOT NULL DEFAULT '',
      command_timeout_seconds INTEGER NOT NULL DEFAULT ${options.defaultCommandTimeoutSecondsSql},
      embedding_model TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  );
  ensureAppSchemaColumn(
    database,
    "app_settings",
    "timezone",
    "timezone TEXT NOT NULL DEFAULT ''",
  );
  ensureAppSchemaColumn(
    database,
    "app_settings",
    "command_timeout_seconds",
    `command_timeout_seconds INTEGER NOT NULL DEFAULT ${options.defaultCommandTimeoutSecondsSql}`,
  );
  ensureAppSchemaColumn(
    database,
    "app_settings",
    "embedding_model",
    "embedding_model TEXT NOT NULL DEFAULT ''",
  );
  ensureAppSchemaColumn(
    database,
    "app_settings",
    "updated_at",
    "updated_at TEXT",
  );
  runStatement(
    database,
    `INSERT OR IGNORE INTO app_settings (
      id,
      timezone,
      command_timeout_seconds,
      embedding_model
    ) VALUES (1, '', ?, '')`,
    options.defaultCommandTimeoutSeconds,
  );

  if (tableExists(database, "user_settings")) {
    const legacySettings = database
      .query<
        {
          timezone: string;
        },
        []
      >(
        `
			SELECT timezone
			FROM user_settings
			ORDER BY user_id ASC
			LIMIT 1
		`,
      )
      .get();
    if (legacySettings) {
      runStatement(
        database,
        `
				UPDATE app_settings
				SET timezone = ?,
					command_timeout_seconds = ?,
					embedding_model = ?,
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = 1
			`,
        legacySettings.timezone?.trim() ?? "",
        options.defaultCommandTimeoutSeconds,
        "",
      );
    }
    runStatement(database, `DROP TABLE IF EXISTS user_settings`);
  }
}

function initPluginIngressSchema(database: Database): void {
  runStatement(
    database,
    `CREATE TABLE IF NOT EXISTS plugin_ingress_cursors (
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      cursor TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (plugin_id, source_id)
    )`,
  );
}

function initPluginNotificationSchema(database: Database): void {
  runStatement(
    database,
    `CREATE TABLE IF NOT EXISTS app_notification_deliveries (
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
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  );
  runStatement(
    database,
    `CREATE INDEX IF NOT EXISTS idx_app_notification_deliveries_inbox ON app_notification_deliveries(dismissed_at, sent_at DESC)`,
  );
  runStatement(
    database,
    `CREATE TABLE IF NOT EXISTS plugin_notification_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      sent_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  );
  runStatement(
    database,
    `CREATE INDEX IF NOT EXISTS idx_plugin_notification_rate_limits_window ON plugin_notification_rate_limits(plugin_id, recipient, sent_at_ms)`,
  );
  runStatement(
    database,
    `CREATE INDEX IF NOT EXISTS idx_plugin_notification_rate_limits_cleanup ON plugin_notification_rate_limits(sent_at_ms)`,
  );
}

function rebuildProjectsTableForOwnerless(db: Database): void {
  if (!tableExists(db, "projects")) {
    return;
  }
  if (!tableHasColumn(db, "projects", "owner_user_id")) {
    return;
  }

  runStatement(db, "PRAGMA foreign_keys = OFF");
  try {
    runStatement(
      db,
      `
			CREATE TABLE projects_ownerless (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				path TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				git_remote TEXT,
				is_open INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				deleted_at INTEGER
			);
		`,
    );
    runStatement(
      db,
      `
			INSERT INTO projects_ownerless (
				id,
				path,
				name,
				git_remote,
				is_open,
				created_at,
				updated_at,
				last_opened_at,
				deleted_at
			)
			SELECT
				id,
				path,
				name,
				git_remote,
				is_open,
				created_at,
				updated_at,
				last_opened_at,
				deleted_at
			FROM projects
			GROUP BY path
			ORDER BY id ASC
		`,
    );
    runStatement(db, "DROP TABLE projects");
    runStatement(db, "ALTER TABLE projects_ownerless RENAME TO projects");
  } finally {
    runStatement(db, "PRAGMA foreign_keys = ON");
  }
}

function rebuildAppNotificationDeliveriesForLocalInbox(db: Database): void {
  if (!tableExists(db, "app_notification_deliveries")) {
    return;
  }
  if (!tableHasColumn(db, "app_notification_deliveries", "user_id")) {
    return;
  }

  runStatement(db, "PRAGMA foreign_keys = OFF");
  try {
    runStatement(
      db,
      `
			CREATE TABLE app_notification_deliveries_local (
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
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
    );
    runStatement(
      db,
      `
			INSERT INTO app_notification_deliveries_local (
				id,
				plugin_id,
				title,
				body,
				click_url,
				priority,
				tags_json,
				status,
				sent_at,
				dismissed_at,
				created_at,
				updated_at
			)
			SELECT
				id,
				plugin_id,
				title,
				body,
				click_url,
				priority,
				tags_json,
				status,
				sent_at,
				dismissed_at,
				created_at,
				updated_at
			FROM app_notification_deliveries
		`,
    );
    runStatement(db, "DROP TABLE app_notification_deliveries");
    runStatement(
      db,
      "ALTER TABLE app_notification_deliveries_local RENAME TO app_notification_deliveries",
    );
    runStatement(
      db,
      "DROP INDEX IF EXISTS idx_app_notification_deliveries_inbox",
    );
    runStatement(
      db,
      "CREATE INDEX IF NOT EXISTS idx_app_notification_deliveries_inbox ON app_notification_deliveries(dismissed_at, sent_at DESC)",
    );
  } finally {
    runStatement(db, "PRAGMA foreign_keys = ON");
  }
}

function rebuildWebServerSharesForOwnerless(db: Database): void {
  if (!tableExists(db, "web_server_shares")) {
    return;
  }
  if (!tableHasColumn(db, "web_server_shares", "owner_user_id")) {
    return;
  }

  runStatement(db, "PRAGMA foreign_keys = OFF");
  try {
    runStatement(
      db,
      `
			CREATE TABLE web_server_shares_ownerless (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				claim_token_hash TEXT NOT NULL UNIQUE,
				thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
				server_id INTEGER NOT NULL,
				server_instance_id TEXT NOT NULL UNIQUE,
				target_port INTEGER NOT NULL,
				project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				stopped_at TEXT,
				revoked_at TEXT
			);
		`,
    );
    runStatement(
      db,
      `
			INSERT INTO web_server_shares_ownerless (
				id,
				claim_token_hash,
				thread_id,
				server_id,
				server_instance_id,
				target_port,
				project_id,
				worktree_path,
				created_at,
				updated_at,
				stopped_at,
				revoked_at
			)
			SELECT
				id,
				claim_token_hash,
				thread_id,
				server_id,
				server_instance_id,
				target_port,
				project_id,
				worktree_path,
				created_at,
				updated_at,
				stopped_at,
				revoked_at
			FROM web_server_shares
		`,
    );
    runStatement(db, "DROP TABLE web_server_shares");
    runStatement(
      db,
      "ALTER TABLE web_server_shares_ownerless RENAME TO web_server_shares",
    );
    runStatement(
      db,
      `CREATE INDEX IF NOT EXISTS idx_web_server_shares_thread_server_active
			ON web_server_shares(thread_id, server_id, stopped_at, revoked_at, updated_at DESC, id DESC)`,
    );
    runStatement(
      db,
      `CREATE INDEX IF NOT EXISTS idx_web_server_shares_server_instance_active
			ON web_server_shares(server_instance_id, stopped_at, revoked_at)`,
    );
  } finally {
    runStatement(db, "PRAGMA foreign_keys = ON");
  }
}

function rebuildProjectWorktreesTableForTracking(db: Database): void {
  if (
    !tableExists(db, "project_worktrees") ||
    !tableColumnIsNotNull(db, "project_worktrees", "pinned_at")
  ) {
    return;
  }

  const legacyRowCount = countRows(db, "project_worktrees");

  runStatement(db, "PRAGMA foreign_keys = OFF");
  try {
    runStatement(
      db,
      `
			CREATE TABLE project_worktrees_tracked (
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				pinned_at TEXT,
				PRIMARY KEY (project_id, worktree_path)
			);
		`,
    );
    if (legacyRowCount > 0) {
      runStatement(
        db,
        `
			INSERT INTO project_worktrees_tracked (
				project_id,
				worktree_path,
				pinned_at
			)
			SELECT
				project_id,
				worktree_path,
				pinned_at
			FROM project_worktrees
		`,
      );
    }
    runStatement(db, "DROP TABLE project_worktrees");
    runStatement(
      db,
      "ALTER TABLE project_worktrees_tracked RENAME TO project_worktrees",
    );
  } finally {
    runStatement(db, "PRAGMA foreign_keys = ON");
  }
}

/**
 * Migrate/create schema and apply incremental column backfills on startup.
 * Keeps the on-disk DB in sync with expected runtime shape.
 */
export function migrateAppSchema(
  db: Database,
  options: AppSchemaMigrationOptions,
  hooks: AppSchemaMigrationHooks,
): void {
  if (canSkipAppSchemaMigration(db)) {
    return;
  }

  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS auth_settings (
				id INTEGER PRIMARY KEY CHECK(id = 1),
				primary_factor_type TEXT NOT NULL CHECK(primary_factor_type IN ('pin', 'password')),
				primary_factor_hash TEXT NOT NULL,
				totp_secret_ciphertext TEXT NOT NULL,
				session_lifetime_days INTEGER NOT NULL DEFAULT 7,
				failed_primary_factor_attempts INTEGER NOT NULL DEFAULT 0,
				locked_until TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  ensureAppSchemaColumn(
    db,
    "auth_settings",
    "totp_last_used_counter",
    "totp_last_used_counter INTEGER",
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS auth_sessions (
				id TEXT PRIMARY KEY,
				issued_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				last_used_at TEXT NOT NULL,
				step_up_valid_until TEXT
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS auth_recovery_codes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				code_hash TEXT NOT NULL UNIQUE,
				used_at TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS auth_websocket_tickets (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
				issued_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				consumed_at TEXT
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
			ON auth_sessions(expires_at);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_auth_recovery_codes_used_at
			ON auth_recovery_codes(used_at);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_auth_websocket_tickets_session_id
			ON auth_websocket_tickets(session_id);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_auth_websocket_tickets_expires_at
			ON auth_websocket_tickets(expires_at);
		`,
  );
  hooks.migrateLegacySingleUserAuth(db);
  hooks.dropLegacySingleUserAuthTables(db);
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS terminal_settings (
				id INTEGER PRIMARY KEY CHECK(id = 1),
				default_shell TEXT NOT NULL DEFAULT '',
				replay_buffer_bytes INTEGER NOT NULL DEFAULT 5242880,
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			INSERT OR IGNORE INTO terminal_settings (id, default_shell, replay_buffer_bytes)
			VALUES (1, '', 5242880);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS projects (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				path TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				git_remote TEXT,
				is_open INTEGER NOT NULL DEFAULT 1,
				favicon_data_url TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				deleted_at INTEGER
			);
		`,
  );
  rebuildProjectsTableForOwnerless(db);
  ensureProjectColumn(db, "deleted_at", "deleted_at INTEGER");
  ensureProjectColumn(db, "favicon_data_url", "favicon_data_url TEXT");
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS project_worktrees (
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				pinned_at TEXT,
				PRIMARY KEY (project_id, worktree_path)
			);
		`,
  );
  rebuildProjectWorktreesTableForTracking(db);
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS threads (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				cron_job_id INTEGER,
				title TEXT NOT NULL,
				summary TEXT,
				model TEXT NOT NULL DEFAULT 'gpt-5.4',
				reasoning_effort TEXT NOT NULL DEFAULT 'medium',
				plugin_access_groups TEXT NOT NULL DEFAULT '[]',
				permissions TEXT NOT NULL DEFAULT '[]',
				pi_session_id TEXT,
				pi_session_file TEXT,
				pi_leaf_entry_id TEXT,
				pinned_at TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				deleted_at INTEGER,
				last_run_at TEXT,
				last_input_tokens INTEGER,
				last_cached_input_tokens INTEGER,
				last_output_tokens INTEGER,
				max_input_tokens INTEGER,
				estimated_compaction_trigger_tokens INTEGER,
				compaction_count INTEGER NOT NULL DEFAULT 0,
				last_compaction_at TEXT,
				last_compaction_before_input_tokens INTEGER,
				last_compaction_after_input_tokens INTEGER,
				active_turn_started_at TEXT,
				last_error_at TEXT,
				last_error_seen_at TEXT,
				last_error_message TEXT
			);
		`,
  );
  const hasMetidosThreadAccessColumn = tableHasColumn(
    db,
    "threads",
    "metidos_access",
  );
  const hasThreadsThreadAccessColumn = tableHasColumn(
    db,
    "threads",
    "threads_access",
  );
  const hasCronsThreadAccessColumn = tableHasColumn(
    db,
    "threads",
    "crons_access",
  );
  ensureThreadColumn(db, "deleted_at", "deleted_at INTEGER");
  ensureThreadColumn(db, "last_input_tokens", "last_input_tokens INTEGER");
  ensureThreadColumn(
    db,
    "last_cached_input_tokens",
    "last_cached_input_tokens INTEGER",
  );
  ensureThreadColumn(db, "last_output_tokens", "last_output_tokens INTEGER");
  ensureThreadColumn(db, "max_input_tokens", "max_input_tokens INTEGER");
  ensureThreadColumn(
    db,
    "estimated_compaction_trigger_tokens",
    "estimated_compaction_trigger_tokens INTEGER",
  );
  ensureThreadColumn(
    db,
    "compaction_count",
    "compaction_count INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(db, "last_compaction_at", "last_compaction_at TEXT");
  ensureThreadColumn(
    db,
    "last_compaction_before_input_tokens",
    "last_compaction_before_input_tokens INTEGER",
  );
  ensureThreadColumn(
    db,
    "last_compaction_after_input_tokens",
    "last_compaction_after_input_tokens INTEGER",
  );
  ensureThreadColumn(
    db,
    "active_turn_started_at",
    "active_turn_started_at TEXT",
  );
  ensureThreadColumn(db, "last_error_at", "last_error_at TEXT");
  ensureThreadColumn(db, "last_error_seen_at", "last_error_seen_at TEXT");
  ensureThreadColumn(db, "last_error_message", "last_error_message TEXT");
  ensureThreadColumn(db, "pinned_at", "pinned_at TEXT");
  ensureThreadColumn(db, "summary", "summary TEXT");
  ensureThreadColumn(db, "model", "model TEXT");
  ensureThreadColumn(
    db,
    "reasoning_effort",
    "reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
  );
  ensureThreadColumn(
    db,
    "web_search_access",
    "web_search_access INTEGER NOT NULL DEFAULT 1",
  );
  ensureThreadColumn(
    db,
    "github_access",
    "github_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(db, "git_access", "git_access INTEGER NOT NULL DEFAULT 0");
  ensureThreadColumn(
    db,
    "sqlite_access",
    "sqlite_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(
    db,
    "web_server_access",
    "web_server_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(
    db,
    "agents_access",
    "agents_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(
    db,
    "calendar_access",
    "calendar_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(
    db,
    "notifications_access",
    "notifications_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(
    db,
    "weather_access",
    "weather_access INTEGER NOT NULL DEFAULT 0",
  );
  if (!hasMetidosThreadAccessColumn) {
    ensureThreadColumn(
      db,
      "metidos_access",
      "metidos_access INTEGER NOT NULL DEFAULT 1",
    );
  }
  ensureThreadColumn(
    db,
    "threads_access",
    "threads_access INTEGER NOT NULL DEFAULT 1",
  );
  ensureThreadColumn(
    db,
    "crons_access",
    "crons_access INTEGER NOT NULL DEFAULT 1",
  );
  if (!hasThreadsThreadAccessColumn) {
    runStatement(
      db,
      `
			UPDATE threads
			SET threads_access = COALESCE(metidos_access, 1)
		`,
    );
  }
  if (!hasCronsThreadAccessColumn) {
    runStatement(
      db,
      `
			UPDATE threads
			SET crons_access = COALESCE(metidos_access, 1)
		`,
    );
  }
  ensureThreadColumn(
    db,
    "plugin_access_groups",
    "plugin_access_groups TEXT NOT NULL DEFAULT '[]'",
  );
  ensureThreadColumn(
    db,
    "permissions",
    "permissions TEXT NOT NULL DEFAULT '[]'",
  );
  hooks.backfillThreadPermissions(db);
  ensureThreadColumn(
    db,
    "unsafe_mode",
    "unsafe_mode INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(db, "cron_job_id", "cron_job_id INTEGER");
  ensureThreadColumn(db, "pi_session_id", "pi_session_id TEXT");
  ensureThreadColumn(db, "pi_session_file", "pi_session_file TEXT");
  ensureThreadColumn(db, "pi_leaf_entry_id", "pi_leaf_entry_id TEXT");
  runStatement(
    db,
    `
			UPDATE threads
			SET model = ?
			WHERE model IS NULL OR TRIM(model) = ''
		`,
    options.defaultThreadModel,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET reasoning_effort = ?
			WHERE reasoning_effort IS NULL OR TRIM(reasoning_effort) = ''
		`,
    options.defaultThreadReasoningEffort,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET unsafe_mode = 0
			WHERE unsafe_mode IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET web_search_access = 1
			WHERE web_search_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET github_access = 0
			WHERE github_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET sqlite_access = 0
			WHERE sqlite_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET web_server_access = 0
			WHERE web_server_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET agents_access = 0
			WHERE agents_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET calendar_access = 0
			WHERE calendar_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET notifications_access = 0
			WHERE notifications_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET weather_access = 0
			WHERE weather_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET metidos_access = 1
			WHERE metidos_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET threads_access = COALESCE(metidos_access, 1)
			WHERE threads_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET crons_access = COALESCE(metidos_access, 1)
			WHERE crons_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET metidos_access = CASE WHEN threads_access = 1 OR crons_access = 1 THEN 1 ELSE 0 END
		`,
  );
  dropLegacyAccessColumns(db, "threads");
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS thread_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
				role TEXT NOT NULL CHECK(role IN ('assistant', 'user')),
				kind TEXT NOT NULL DEFAULT 'chat',
				item_id TEXT,
				text TEXT NOT NULL,
				state TEXT,
				payload_json TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  ensureThreadMessageColumn(db, "kind", "kind TEXT NOT NULL DEFAULT 'chat'");
  ensureThreadMessageColumn(db, "item_id", "item_id TEXT");
  ensureThreadMessageColumn(db, "state", "state TEXT");
  ensureThreadMessageColumn(db, "payload_json", "payload_json TEXT");
  ensureThreadMessageColumn(db, "updated_at", "updated_at TEXT");
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_project_worktrees_project_id_pinned_at
			ON project_worktrees(project_id, pinned_at DESC, worktree_path ASC);
		`,
  );
  runStatement(db, `DROP INDEX IF EXISTS idx_projects_last_opened_at_name`);
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_projects_last_opened_at_name
			ON projects(deleted_at, last_opened_at DESC, name ASC);
		`,
  );
  runStatement(db, `DROP INDEX IF EXISTS idx_threads_updated_at`);
  runStatement(db, `DROP INDEX IF EXISTS idx_threads_listing_order`);
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_threads_listing_order
			ON threads(
				deleted_at,
				(pinned_at IS NULL),
				pinned_at DESC,
				updated_at DESC,
				created_at DESC,
				id DESC
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_threads_project_id
			ON threads(project_id);
		`,
  );
  runStatement(db, `DROP INDEX IF EXISTS idx_threads_cron_job_active`);
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_threads_cron_job_active
			ON threads(cron_job_id, deleted_at, active_turn_started_at, id);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_id
			ON thread_messages(thread_id, id);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_item_id
			ON thread_messages(thread_id, item_id);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS security_audit_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				event_type TEXT NOT NULL,
				summary_text TEXT NOT NULL,
				thread_id INTEGER,
				project_id INTEGER,
				worktree_path TEXT,
				payload_json TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_security_audit_events_created_at
			ON security_audit_events(created_at DESC, id DESC);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_security_audit_events_thread_id
			ON security_audit_events(thread_id, created_at DESC, id DESC);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS client_log_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER,
				severity TEXT NOT NULL,
				message TEXT NOT NULL,
				route TEXT,
				context TEXT,
				details_json TEXT,
				client_timestamp TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_client_log_events_created_at
			ON client_log_events(created_at DESC, id DESC);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS cron_jobs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				schedule TEXT NOT NULL,
				prompt TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				model TEXT NOT NULL DEFAULT 'gpt-5.4',
				reasoning_effort TEXT NOT NULL DEFAULT 'medium',
				plugin_access_groups TEXT NOT NULL DEFAULT '[]',
				permissions TEXT NOT NULL DEFAULT '[]',
				last_run_date INTEGER,
				last_run_status TEXT CHECK(last_run_status IN ('InProgress', 'Stopped', 'Errored', 'Completed')),
				enabled INTEGER NOT NULL DEFAULT 1,
				deleted_at INTEGER,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  const hasMetidosCronAccessColumn = tableHasColumn(
    db,
    "cron_jobs",
    "metidos_access",
  );
  const hasThreadsCronAccessColumn = tableHasColumn(
    db,
    "cron_jobs",
    "threads_access",
  );
  const hasCronsCronAccessColumn = tableHasColumn(
    db,
    "cron_jobs",
    "crons_access",
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled
			ON cron_jobs(project_id, enabled, deleted_at, id);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_cron_jobs_schedule
			ON cron_jobs(schedule, enabled, deleted_at, last_run_date);
		`,
  );
  ensureCronJobColumn(db, "title", "title TEXT NOT NULL DEFAULT 'Cron job'");
  ensureCronJobColumn(
    db,
    "description",
    "description TEXT NOT NULL DEFAULT ''",
  );
  ensureCronJobColumn(db, "model", "model TEXT NOT NULL DEFAULT 'gpt-5.4'");
  ensureCronJobColumn(
    db,
    "reasoning_effort",
    "reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
  );
  ensureCronJobColumn(
    db,
    "web_search_access",
    "web_search_access INTEGER NOT NULL DEFAULT 1",
  );
  ensureCronJobColumn(
    db,
    "github_access",
    "github_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "git_access",
    "git_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "sqlite_access",
    "sqlite_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "web_server_access",
    "web_server_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "agents_access",
    "agents_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "calendar_access",
    "calendar_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "notifications_access",
    "notifications_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "weather_access",
    "weather_access INTEGER NOT NULL DEFAULT 0",
  );
  if (!hasMetidosCronAccessColumn) {
    ensureCronJobColumn(
      db,
      "metidos_access",
      "metidos_access INTEGER NOT NULL DEFAULT 1",
    );
  }
  ensureCronJobColumn(
    db,
    "threads_access",
    "threads_access INTEGER NOT NULL DEFAULT 1",
  );
  ensureCronJobColumn(
    db,
    "crons_access",
    "crons_access INTEGER NOT NULL DEFAULT 1",
  );
  if (!hasThreadsCronAccessColumn) {
    runStatement(
      db,
      `
			UPDATE cron_jobs
			SET threads_access = COALESCE(metidos_access, 1)
		`,
    );
  }
  if (!hasCronsCronAccessColumn) {
    runStatement(
      db,
      `
			UPDATE cron_jobs
			SET crons_access = COALESCE(metidos_access, 1)
		`,
    );
  }
  ensureCronJobColumn(
    db,
    "plugin_access_groups",
    "plugin_access_groups TEXT NOT NULL DEFAULT '[]'",
  );
  ensureCronJobColumn(
    db,
    "permissions",
    "permissions TEXT NOT NULL DEFAULT '[]'",
  );
  hooks.backfillCronJobPermissions(db);
  ensureCronJobColumn(
    db,
    "unsafe_mode",
    "unsafe_mode INTEGER NOT NULL DEFAULT 0",
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				title = COALESCE(
					NULLIF(TRIM(substr(prompt, 1, 72)), ''),
					'Cron job ' || id
				)
			WHERE title IS NULL OR TRIM(title) = ''
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				description = COALESCE(NULLIF(TRIM(prompt), ''), schedule)
			WHERE description IS NULL OR TRIM(description) = ''
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				model = ?
			WHERE model IS NULL OR TRIM(model) = ''
		`,
    options.defaultThreadModel,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				reasoning_effort = ?
			WHERE reasoning_effort IS NULL OR TRIM(reasoning_effort) = ''
		`,
    options.defaultThreadReasoningEffort,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				unsafe_mode = 0
			WHERE unsafe_mode IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				web_search_access = 1
			WHERE web_search_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				github_access = 0
			WHERE github_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				sqlite_access = 0
			WHERE sqlite_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				web_server_access = 0
			WHERE web_server_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				agents_access = 0
			WHERE agents_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				notifications_access = 0
			WHERE notifications_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				weather_access = 0
			WHERE weather_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				metidos_access = 1
			WHERE metidos_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				threads_access = COALESCE(metidos_access, 1)
			WHERE threads_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				crons_access = COALESCE(metidos_access, 1)
			WHERE crons_access IS NULL
		`,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				metidos_access = CASE WHEN threads_access = 1 OR crons_access = 1 THEN 1 ELSE 0 END
		`,
  );
  dropLegacyAccessColumns(db, "cron_jobs");
  dedupeActiveCronJobTitles(db);
  runStatement(
    db,
    `
			CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_jobs_title_unique
			ON cron_jobs(title COLLATE NOCASE)
			WHERE deleted_at IS NULL
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS cron_job_runs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				cron_job_id INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
				thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
				run_date INTEGER NOT NULL,
				run_status TEXT NOT NULL CHECK(run_status IN ('InProgress', 'Stopped', 'Errored', 'Completed')),
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job
			ON cron_job_runs(cron_job_id, run_date DESC, id DESC);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS web_server_shares (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				claim_token_hash TEXT NOT NULL UNIQUE,
				thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
				server_id INTEGER NOT NULL,
				server_instance_id TEXT NOT NULL UNIQUE,
				target_port INTEGER NOT NULL,
				project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				stopped_at TEXT,
				revoked_at TEXT
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_web_server_shares_thread_server_active
			ON web_server_shares(thread_id, server_id, stopped_at, revoked_at, updated_at DESC, id DESC);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_web_server_shares_server_instance_active
			ON web_server_shares(server_instance_id, stopped_at, revoked_at);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS web_server_share_sessions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_token_hash TEXT NOT NULL UNIQUE,
				thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
				server_id INTEGER NOT NULL,
				server_instance_id TEXT NOT NULL REFERENCES web_server_shares(server_instance_id) ON DELETE CASCADE,
				expires_at TEXT NOT NULL,
				revoked_at TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_web_server_share_sessions_server_instance
			ON web_server_share_sessions(server_instance_id, revoked_at, expires_at);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_web_server_share_sessions_expires_at
			ON web_server_share_sessions(expires_at);
		`,
  );
  initPluginIngressSchema(db);
  initPluginIngressMessageSchema(db);
  initPluginNotificationSchema(db);
  rebuildAppNotificationDeliveriesForLocalInbox(db);
  initTimezoneSettingsSchema(db, options);
  initCalendarSchema(db);
  rebuildWebServerSharesForOwnerless(db);
  writeAppSchemaVersion(db);
}

export function writeAppSchemaVersion(db: Database): void {
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS schema_version (
				id INTEGER PRIMARY KEY CHECK(id = 1),
				version INTEGER NOT NULL,
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			INSERT INTO schema_version (id, version)
			VALUES (1, ?)
			ON CONFLICT(id) DO UPDATE SET
				version = excluded.version,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		`,
    LATEST_APP_SCHEMA_VERSION,
  );
}
