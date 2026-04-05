/**
 * @file src/bun/db.ts
 * @description Module for db.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const APP_NAME = ".jolt";
/** Database filename under the app data directory. */
const DB_FILE_NAME = "app.db";
/** Default thread model used when no explicit model is provided. */

export const DEFAULT_THREAD_MODEL = "gpt-5.4";
/** Default reasoning effort used for thread creation and migration repair. */
export const DEFAULT_THREAD_REASONING_EFFORT = "medium";
/** Lazily-initialized singleton db handle for the process lifetime. */

let appDatabase: Database | null = null;

type ProjectInput = {
  projectPath: string;
  name?: string | null;
};

/** Input used when inserting a thread row. */
type ThreadInput = {
  projectId: number;
  worktreePath: string;
  title: string;
  model: string;
  reasoningEffort: string;
  unsafeMode: boolean;
  codexThreadId?: string | null;
};

type ThreadUsageInput = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

/** Input for compaction metric updates persisted with token usage. */

type ThreadCompactionStatsInput = {
  maxInputTokens: number;
  estimatedCompactionTriggerTokens: number | null;
  compactionCount: number;
  lastCompactionAt: string | null;
  lastCompactionBeforeInputTokens: number | null;
  lastCompactionAfterInputTokens: number | null;
};

type ThreadMessageInput = {
  threadId: number;
  role: "assistant" | "user";
  text: string;
};

type ThreadActivityKind =
  | "chat"
  | "reasoning"
  | "command"
  | "file_change"
  | "tool_call"
  | "web_search"
  | "error";

export type ThreadActivityInput = {
  threadId: number;
  itemId: string;
  role?: "assistant" | "user";
  kind: ThreadActivityKind;
  text: string;
  state: string | null;
  payloadJson?: string | null;
};

type ThreadActivityPersistInput = ThreadActivityInput & {
  messageId?: number | null;
};

export type AuthPrimaryFactorType = "pin" | "password";

type AuthSettingsInput = {
  primaryFactorType: AuthPrimaryFactorType;
  primaryFactorHash: string;
  totpSecretCiphertext: string;
  sessionLifetimeDays: number;
};

type AuthSessionInput = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string;
  stepUpValidUntil?: string | null;
};

type AuthWebSocketTicketInput = {
  id: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
};

type SecurityAuditEventInput = {
  eventType: string;
  summaryText: string;
  threadId?: number | null;
  projectId?: number | null;
  worktreePath?: string | null;
  payloadJson?: string | null;
};

/** Public DB shape for project rows returned from queries. */
export type ProjectRecord = {
  id: number;
  path: string;
  name: string;
  gitRemote: string | null;
  isOpen: 1 | 0;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

/** Public DB shape for thread rows returned from queries. */

export type ThreadRecord = {
  id: number;
  projectId: number;
  worktreePath: string;
  title: string;
  summary: string | null;
  model: string;
  reasoningEffort: string;
  unsafeMode: 0 | 1;
  codexThreadId: string | null;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastInputTokens: number | null;
  lastCachedInputTokens: number | null;
  lastOutputTokens: number | null;
  maxInputTokens: number | null;
  estimatedCompactionTriggerTokens: number | null;
  compactionCount: number;
  lastCompactionAt: string | null;
  lastCompactionBeforeInputTokens: number | null;
  lastCompactionAfterInputTokens: number | null;
  activeTurnStartedAt: string | null;
  lastErrorAt: string | null;
  lastErrorSeenAt: string | null;
  lastErrorMessage: string | null;
};

/** Public DB shape for thread_messages rows returned from queries. */
export type ThreadMessageRecord = {
  id: number;
  threadId: number;
  role: "assistant" | "user";
  kind: ThreadActivityKind;
  itemId: string | null;
  text: string;
  state: string | null;
  payloadJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectWorktreePinRecord = {
  projectId: number;
  worktreePath: string;
  pinnedAt: string;
};

export type InProgressThreadMessageRecord = {
  threadId: number;
  lastUpdatedAt: string;
};

export type AuthSettingsRecord = {
  id: number;
  primaryFactorType: AuthPrimaryFactorType;
  primaryFactorHash: string;
  totpSecretCiphertext: string;
  sessionLifetimeDays: number;
  failedPrimaryFactorAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionRecord = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string;
  stepUpValidUntil: string | null;
};

export type AuthRecoveryCodeRecord = {
  id: number;
  codeHash: string;
  usedAt: string | null;
  createdAt: string;
};

export type AuthWebSocketTicketRecord = {
  id: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type SecurityAuditEventRecord = {
  id: number;
  eventType: string;
  summaryText: string;
  threadId: number | null;
  projectId: number | null;
  worktreePath: string | null;
  payloadJson: string | null;
  createdAt: string;
};

const DEFAULT_APP_DATA_DIR =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", APP_NAME)
    : process.platform === "win32"
      ? join(
          process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
          APP_NAME,
        )
      : join(
          process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
          APP_NAME,
        );
/** Cached app-data directory path resolved for this process. */

let resolvedAppDataDir: string | null = null;

export type AppDataPathOptions = {
  appDataDir?: string;
};

/** Execute a SQL statement with optional positional bindings. */
function runStatement(
  database: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): ReturnType<Database["run"]> {
  return bindings.length === 0
    ? database.run(sql)
    : database.run(sql, bindings);
}

/**
 * Run operations inside a transaction and rollback on exceptions.
 */

function runInTransaction<T>(database: Database, callback: () => T): T {
  runStatement(database, "BEGIN IMMEDIATE");
  try {
    const result = callback();
    runStatement(database, "COMMIT");
    return result;
  } catch (error) {
    try {
      // Keep caller's original error as primary even if rollback fails.
      runStatement(database, "ROLLBACK");
    } catch {
      // Ignore rollback errors so the original failure surfaces.
    }
    throw error;
  }
}

/** Create folder if it doesn't exist before opening DB files. */
function ensureAppDirectory(appDataPath: string): void {
  if (!existsSync(appDataPath)) {
    mkdirSync(appDataPath, {
      recursive: true,
      mode: 0o700,
    });
  }
  try {
    chmodSync(appDataPath, 0o700);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}

/**
 * Probe directory by writing and deleting a temp file.
 * @param path - The value of `path`.
 */
function isWritableDirectory(path: string): boolean {
  try {
    ensureAppDirectory(path);
    const testFilePath = join(
      path,
      `.write-test-${process.pid}-${Date.now().toString(36)}`,
    );
    writeFileSync(testFilePath, "");
    unlinkSync(testFilePath);
    return true;
  } catch {
    return false;
  }
}
/**
 * Function of applyOwnerOnlyFilePermissions.
 * @param path - The value of `path`.
 */

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Function of selectWritableAppDataDirectory.
 * @param options - The value of `options`.
 */

export function selectWritableAppDataDirectory(options: {
  configuredAppDataDir?: string | null | undefined;
  defaultAppDataDir: string;
  isWritableDirectory?: (path: string) => boolean;
}): string {
  const isWritable = options.isWritableDirectory ?? isWritableDirectory;
  const candidates = [
    options.configuredAppDataDir || null,
    options.defaultAppDataDir,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!isWritable(candidate)) {
      continue;
    }
    return candidate;
  }

  const checkedPaths = options.configuredAppDataDir
    ? `Checked JOLT_APP_DATA_DIR=${options.configuredAppDataDir} and ${options.defaultAppDataDir}.`
    : `Checked ${options.defaultAppDataDir}.`;
  throw new Error(
    [
      "Unable to find a writable application data directory.",
      checkedPaths,
      "Set JOLT_APP_DATA_DIR to an explicit writable per-user directory if the default location is unavailable.",
    ].join(" "),
  );
}

/**
 * Resolve an existing writable app-data directory using env and platform defaults.
 */

function resolveAppDataDirectory(): string {
  if (resolvedAppDataDir) {
    return resolvedAppDataDir;
  }

  const configuredAppDataDir = process.env.JOLT_APP_DATA_DIR?.trim();
  resolvedAppDataDir = selectWritableAppDataDirectory({
    configuredAppDataDir,
    defaultAppDataDir: DEFAULT_APP_DATA_DIR,
  });
  return resolvedAppDataDir;
}
/**
 * Function of getAppDataDirectoryPath.
 * @param options - The value of `options`.
 */

export function getAppDataDirectoryPath(options?: AppDataPathOptions): string {
  return options?.appDataDir ?? resolveAppDataDirectory();
}
/**
 * Function of applyAppDatabasePermissions.
 * @param dbPath - The value of `dbPath`.
 */

function applyAppDatabasePermissions(dbPath: string): void {
  if (existsSync(dbPath)) {
    applyOwnerOnlyFilePermissions(dbPath);
  }
  const journalingSidecars = [`${dbPath}-shm`, `${dbPath}-wal`];
  for (const sidecarPath of journalingSidecars) {
    if (!existsSync(sidecarPath)) {
      continue;
    }
    applyOwnerOnlyFilePermissions(sidecarPath);
  }
}
/**
 * Function of tableHasColumn.
 * @param db - The value of `db`.
 * @param tableName - The value of `tableName`.
 * @param columnName - The value of `columnName`.
 */

function tableHasColumn(
  db: Database,
  tableName: string,
  columnName: string,
): boolean {
  /** True when `columnName` is already present in the table schema. */
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

/**
 * Ensure `threads` has a column for evolving schema versions.
 * This lets older databases safely add newer nullable/default fields.
 */

function ensureThreadColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  // Column addition is additive and preserves existing row data.
  if (!tableHasColumn(db, "threads", columnName)) {
    runStatement(db, `ALTER TABLE threads ADD COLUMN ${columnDefinition}`);
  }
}

/**
 * Ensure `thread_messages` has a column for evolving schema versions.
 * This is used for backfills and zero-downtime schema updates.
 */

function ensureThreadMessageColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  // Column addition is additive and preserves existing row data.
  if (!tableHasColumn(db, "thread_messages", columnName)) {
    runStatement(
      db,
      `ALTER TABLE thread_messages ADD COLUMN ${columnDefinition}`,
    );
  }
}

/**
 * Migrate/create schema and apply incremental column backfills on startup.
 * Keeps the on-disk DB in sync with expected runtime shape.
 * @param db - The value of `db`.
 */
export function migrateDatabase(db: Database): void {
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS projects (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
			path TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			git_remote TEXT,
			is_open INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS project_worktrees (
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				PRIMARY KEY (project_id, worktree_path)
			);
		`,
  );
  runStatement(
    db,
    `
			CREATE TABLE IF NOT EXISTS threads (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				title TEXT NOT NULL,
				summary TEXT,
				model TEXT NOT NULL DEFAULT 'gpt-5.4',
				reasoning_effort TEXT NOT NULL DEFAULT 'medium',
				unsafe_mode INTEGER NOT NULL DEFAULT 0,
				codex_thread_id TEXT,
				pinned_at TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
    "unsafe_mode",
    "unsafe_mode INTEGER NOT NULL DEFAULT 0",
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET model = ?
			WHERE model IS NULL OR TRIM(model) = ''
		`,
    DEFAULT_THREAD_MODEL,
  );
  runStatement(
    db,
    `
			UPDATE threads
			SET reasoning_effort = ?
			WHERE reasoning_effort IS NULL OR TRIM(reasoning_effort) = ''
		`,
    DEFAULT_THREAD_REASONING_EFFORT,
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
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_threads_updated_at
			ON threads(updated_at DESC, id DESC);
		`,
  );
  runStatement(
    db,
    `
			CREATE INDEX IF NOT EXISTS idx_threads_project_id
			ON threads(project_id);
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
}
/**
 * Function of getAppDatabasePath.
 * @param options - The value of `options`.
 */

export function getAppDatabasePath(options?: AppDataPathOptions): string {
  /** Full path to the SQLite file in the resolved application data directory. */
  return resolve(getAppDataDirectoryPath(options), DB_FILE_NAME);
}

export function closeAppDatabase(): void {
  /** Close the singleton database handle so maintenance/reset flows can remove the file safely. */

  if (!appDatabase) {
    return;
  }
  appDatabase.close(false);
  appDatabase = null;
}

export function resetResolvedAppDataDirectory(): void {
  /** Clear the cached app-data path so follow-up operations re-resolve it from env/defaults. */
  resolvedAppDataDir = null;
}

/**
 * Initialize and cache the singleton app database handle.
 * Applies migrations to repair/upgrade user data stores in place.
 */

export function initAppDatabase(): Database {
  if (appDatabase) {
    return appDatabase;
  }

  const dbPath = getAppDatabasePath();
  const appDataPath = dirname(dbPath);
  ensureAppDirectory(appDataPath);

  const db = new Database(dbPath);
  runStatement(db, "PRAGMA foreign_keys = ON");
  migrateDatabase(db);
  applyAppDatabasePermissions(dbPath);
  appDatabase = db;
  return db;
}
/**
 * Function of getAuthSettings.
 * @param database - The value of `database`.
 */

export function getAuthSettings(database: Database): AuthSettingsRecord | null {
  /** Read the singleton auth-settings row if setup has been completed. */
  return database
    .query<AuthSettingsRecord, []>(
      `
			SELECT
				id,
				primary_factor_type AS primaryFactorType,
				primary_factor_hash AS primaryFactorHash,
				totp_secret_ciphertext AS totpSecretCiphertext,
				session_lifetime_days AS sessionLifetimeDays,
				failed_primary_factor_attempts AS failedPrimaryFactorAttempts,
				locked_until AS lockedUntil,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM auth_settings
			WHERE id = 1
		`,
    )
    .get();
}
/**
 * Function of upsertAuthSettings.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function upsertAuthSettings(
  database: Database,
  input: AuthSettingsInput,
): AuthSettingsRecord {
  /** Create or replace the singleton auth configuration row. */

  runStatement(
    database,
    `
			INSERT INTO auth_settings (
				id,
				primary_factor_type,
				primary_factor_hash,
				totp_secret_ciphertext,
				session_lifetime_days,
				failed_primary_factor_attempts,
				locked_until,
				updated_at
			)
			VALUES (
				1,
				?,
				?,
				?,
				?,
				0,
				NULL,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			)
			ON CONFLICT(id) DO UPDATE SET
				primary_factor_type = excluded.primary_factor_type,
				primary_factor_hash = excluded.primary_factor_hash,
				totp_secret_ciphertext = excluded.totp_secret_ciphertext,
				session_lifetime_days = excluded.session_lifetime_days,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		`,
    input.primaryFactorType,
    input.primaryFactorHash,
    input.totpSecretCiphertext,
    input.sessionLifetimeDays,
  );

  const settings = getAuthSettings(database);
  if (!settings) {
    throw new Error("Failed to upsert auth settings.");
  }
  return settings;
}
/**
 * Function of setAuthFailureState.
 * @param database - The value of `database`.
 * @param failedPrimaryFactorAttempts - The value of `failedPrimaryFactorAttempts`.
 * @param lockedUntil - The value of `lockedUntil`.
 */

export function setAuthFailureState(
  database: Database,
  failedPrimaryFactorAttempts: number,
  lockedUntil: string | null,
): void {
  /** Persist login failure counters and optional lockout expiry on the singleton row. */
  runStatement(
    database,
    `
			UPDATE auth_settings
			SET
				failed_primary_factor_attempts = ?,
				locked_until = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = 1
		`,
    failedPrimaryFactorAttempts,
    lockedUntil,
  );
}
/**
 * Function of resetAuthFailureState.
 * @param database - The value of `database`.
 */

export function resetAuthFailureState(database: Database): void {
  /** Clear any stored failed-attempt counters and lockout state. */

  setAuthFailureState(database, 0, null);
}
/**
 * Function of listAuthRecoveryCodes.
 * @param database - The value of `database`.
 */

export function listAuthRecoveryCodes(
  database: Database,
): AuthRecoveryCodeRecord[] {
  /** List all stored recovery-code hashes and whether they have been consumed. */
  return database
    .query<AuthRecoveryCodeRecord, []>(
      `
			SELECT
				id,
				code_hash AS codeHash,
				used_at AS usedAt,
				created_at AS createdAt
			FROM auth_recovery_codes
			ORDER BY id ASC
		`,
    )
    .all();
}
/**
 * Function of replaceAuthRecoveryCodeHashes.
 * @param database - The value of `database`.
 * @param codeHashes - The value of `codeHashes`.
 */

export function replaceAuthRecoveryCodeHashes(
  database: Database,
  codeHashes: readonly string[],
): AuthRecoveryCodeRecord[] {
  /**
   * Replace the full recovery-code set atomically so setup/regeneration never leaves
   * a partial code list behind.
   */

  return runInTransaction(database, () => {
    runStatement(database, "DELETE FROM auth_recovery_codes");
    for (const codeHash of codeHashes) {
      runStatement(
        database,
        `
				INSERT INTO auth_recovery_codes (code_hash)
				VALUES (?)
			`,
        codeHash,
      );
    }

    return listAuthRecoveryCodes(database);
  });
}
/**
 * Function of markAuthRecoveryCodeUsed.
 * @param database - The value of `database`.
 * @param codeHash - The value of `codeHash`.
 * @param usedAt - The value of `usedAt`.
 */

export function markAuthRecoveryCodeUsed(
  database: Database,
  codeHash: string,
  usedAt: string,
): boolean {
  /** Consume one recovery code exactly once. */
  const result = runStatement(
    database,
    `
			UPDATE auth_recovery_codes
			SET used_at = ?
			WHERE code_hash = ?
				AND used_at IS NULL
		`,
    usedAt,
    codeHash,
  );
  return Number(result.changes) > 0;
}
/**
 * Function of createAuthSession.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function createAuthSession(
  database: Database,
  input: AuthSessionInput,
): AuthSessionRecord {
  /** Insert one authenticated session row and return the stored record. */

  runStatement(
    database,
    `
			INSERT INTO auth_sessions (
				id,
				issued_at,
				expires_at,
				last_used_at,
				step_up_valid_until
			)
			VALUES (?, ?, ?, ?, ?)
		`,
    input.id,
    input.issuedAt,
    input.expiresAt,
    input.lastUsedAt,
    input.stepUpValidUntil ?? null,
  );

  const session = getAuthSession(database, input.id);
  if (!session) {
    throw new Error(`Failed to create auth session ${input.id}.`);
  }
  return session;
}
/**
 * Function of getAuthSession.
 * @param database - The value of `database`.
 * @param sessionId - The value of `sessionId`.
 */

export function getAuthSession(
  database: Database,
  sessionId: string,
): AuthSessionRecord | null {
  /** Fetch one session row by opaque session token. */
  return database
    .query<AuthSessionRecord, [string]>(
      `
			SELECT
				id,
				issued_at AS issuedAt,
				expires_at AS expiresAt,
				last_used_at AS lastUsedAt,
				step_up_valid_until AS stepUpValidUntil
			FROM auth_sessions
			WHERE id = ?
		`,
    )
    .get(sessionId);
}
/**
 * Function of touchAuthSession.
 * @param database - The value of `database`.
 * @param sessionId - The value of `sessionId`.
 * @param lastUsedAt - The value of `lastUsedAt`.
 * @param expiresAt - The value of `expiresAt`.
 */

export function touchAuthSession(
  database: Database,
  sessionId: string,
  lastUsedAt: string,
  expiresAt?: string,
): void {
  /** Refresh session activity and optionally extend its expiry. */

  if (typeof expiresAt === "string") {
    runStatement(
      database,
      `
				UPDATE auth_sessions
				SET
					last_used_at = ?,
					expires_at = ?
				WHERE id = ?
			`,
      lastUsedAt,
      expiresAt,
      sessionId,
    );
    return;
  }

  runStatement(
    database,
    `
			UPDATE auth_sessions
			SET last_used_at = ?
			WHERE id = ?
		`,
    lastUsedAt,
    sessionId,
  );
}
/**
 * Function of setAuthSessionStepUpValidUntil.
 * @param database - The value of `database`.
 * @param sessionId - The value of `sessionId`.
 * @param stepUpValidUntil - The value of `stepUpValidUntil`.
 */

export function setAuthSessionStepUpValidUntil(
  database: Database,
  sessionId: string,
  stepUpValidUntil: string | null,
): void {
  /** Store the current step-up freshness window for a session. */
  runStatement(
    database,
    `
			UPDATE auth_sessions
			SET step_up_valid_until = ?
			WHERE id = ?
		`,
    stepUpValidUntil,
    sessionId,
  );
}
/**
 * Function of deleteAuthSession.
 * @param database - The value of `database`.
 * @param sessionId - The value of `sessionId`.
 */

export function deleteAuthSession(database: Database, sessionId: string): void {
  /** Remove one session and cascade any dependent websocket tickets. */

  runStatement(database, "DELETE FROM auth_sessions WHERE id = ?", sessionId);
}
/**
 * Function of deleteAllAuthSessions.
 * @param database - The value of `database`.
 */

export function deleteAllAuthSessions(database: Database): number {
  /** Revoke every authenticated session and cascade dependent websocket tickets. */
  const result = runStatement(database, "DELETE FROM auth_sessions");
  return Number(result.changes);
}
/**
 * Function of deleteExpiredAuthSessions.
 * @param database - The value of `database`.
 * @param now - The value of `now`.
 */

export function deleteExpiredAuthSessions(
  database: Database,
  now: string,
): number {
  /** Remove sessions that are already past their expiry. */

  const result = runStatement(
    database,
    `
			DELETE FROM auth_sessions
			WHERE expires_at <= ?
		`,
    now,
  );
  return Number(result.changes);
}
/**
 * Function of createAuthWebSocketTicket.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function createAuthWebSocketTicket(
  database: Database,
  input: AuthWebSocketTicketInput,
): AuthWebSocketTicketRecord {
  /** Insert one short-lived websocket ticket bound to an authenticated session. */
  runStatement(
    database,
    `
			INSERT INTO auth_websocket_tickets (
				id,
				session_id,
				issued_at,
				expires_at,
				consumed_at
			)
			VALUES (?, ?, ?, ?, NULL)
		`,
    input.id,
    input.sessionId,
    input.issuedAt,
    input.expiresAt,
  );

  const ticket = getAuthWebSocketTicket(database, input.id);
  if (!ticket) {
    throw new Error(`Failed to create websocket ticket ${input.id}.`);
  }
  return ticket;
}
/**
 * Function of getAuthWebSocketTicket.
 * @param database - The value of `database`.
 * @param ticketId - The value of `ticketId`.
 */

export function getAuthWebSocketTicket(
  database: Database,
  ticketId: string,
): AuthWebSocketTicketRecord | null {
  /** Fetch one websocket ticket row by opaque ticket id. */

  return database
    .query<AuthWebSocketTicketRecord, [string]>(
      `
			SELECT
				id,
				session_id AS sessionId,
				issued_at AS issuedAt,
				expires_at AS expiresAt,
				consumed_at AS consumedAt
			FROM auth_websocket_tickets
			WHERE id = ?
		`,
    )
    .get(ticketId);
}
/**
 * Function of consumeAuthWebSocketTicket.
 * @param database - The value of `database`.
 * @param ticketId - The value of `ticketId`.
 * @param consumedAt - The value of `consumedAt`.
 */

export function consumeAuthWebSocketTicket(
  database: Database,
  ticketId: string,
  consumedAt: string,
): AuthWebSocketTicketRecord | null {
  /** Consume a websocket ticket only if it has not been consumed before. */
  const result = runStatement(
    database,
    `
			UPDATE auth_websocket_tickets
			SET consumed_at = ?
			WHERE id = ?
				AND consumed_at IS NULL
		`,
    consumedAt,
    ticketId,
  );
  if (Number(result.changes) === 0) {
    return null;
  }
  return getAuthWebSocketTicket(database, ticketId);
}
/**
 * Function of deleteExpiredAuthWebSocketTickets.
 * @param database - The value of `database`.
 * @param now - The value of `now`.
 */

export function deleteExpiredAuthWebSocketTickets(
  database: Database,
  now: string,
): number {
  /** Remove websocket tickets that are expired or already consumed. */

  const result = runStatement(
    database,
    `
			DELETE FROM auth_websocket_tickets
			WHERE expires_at <= ?
				OR consumed_at IS NOT NULL
		`,
    now,
  );
  return Number(result.changes);
}
/**
 * Function of createSecurityAuditEvent.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function createSecurityAuditEvent(
  database: Database,
  input: SecurityAuditEventInput,
): SecurityAuditEventRecord {
  /** Persist a security-relevant event so dangerous local actions can be reviewed later. */
  const result = runStatement(
    database,
    `
			INSERT INTO security_audit_events (
				event_type,
				summary_text,
				thread_id,
				project_id,
				worktree_path,
				payload_json
			)
			VALUES (?, ?, ?, ?, ?, ?)
		`,
    input.eventType,
    input.summaryText,
    input.threadId ?? null,
    input.projectId ?? null,
    input.worktreePath ?? null,
    input.payloadJson ?? null,
  );
  const eventId = Number(result.lastInsertRowid);
  const event = database
    .query<SecurityAuditEventRecord, [number]>(
      `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE id = ?
		`,
    )
    .get(eventId);
  if (!event) {
    throw new Error("Failed to create security audit event.");
  }
  return event;
}
/**
 * Function of listSecurityAuditEvents.
 * @param database - The value of `database`.
 * @param options - The value of `options`.
 */

export function listSecurityAuditEvents(
  database: Database,
  options?: {
    limit?: number;
    projectId?: number;
    threadId?: number;
  },
): SecurityAuditEventRecord[] {
  /** Return persisted security audit events ordered newest-first, optionally scoped to one thread or project. */

  const limit =
    typeof options?.limit === "number" &&
    Number.isInteger(options.limit) &&
    options.limit > 0
      ? options.limit
      : null;
  if (typeof options?.threadId === "number") {
    if (limit !== null) {
      return database
        .query<SecurityAuditEventRecord, [number, number]>(
          `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE thread_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
        )
        .all(options.threadId, limit);
    }

    return database
      .query<SecurityAuditEventRecord, [number]>(
        `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE thread_id = ?
			ORDER BY created_at DESC, id DESC
		`,
      )
      .all(options.threadId);
  }

  if (typeof options?.projectId === "number") {
    if (limit !== null) {
      return database
        .query<SecurityAuditEventRecord, [number, number]>(
          `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE project_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
        )
        .all(options.projectId, limit);
    }

    return database
      .query<SecurityAuditEventRecord, [number]>(
        `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE project_id = ?
			ORDER BY created_at DESC, id DESC
		`,
      )
      .all(options.projectId);
  }

  if (limit !== null) {
    return database
      .query<SecurityAuditEventRecord, [number]>(
        `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
      )
      .all(limit);
  }

  return database
    .query<SecurityAuditEventRecord, []>(
      `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			ORDER BY created_at DESC, id DESC
		`,
    )
    .all();
}
/**
 * Function of getProject.
 * @param database - The value of `database`.
 * @param projectPath - The value of `projectPath`.
 */

export function getProject(
  database: Database,
  projectPath: string,
): ProjectRecord | null {
  /** Load a single project row by canonical path. */
  return database
    .query<ProjectRecord, [string]>(
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
			WHERE path = ?
		`,
    )
    .get(projectPath);
}
/**
 * Function of getProjectById.
 * @param database - The value of `database`.
 * @param projectId - The value of `projectId`.
 */

export function getProjectById(
  database: Database,
  projectId: number,
): ProjectRecord | null {
  /** Load a single project row by primary key id. */

  return database
    .query<ProjectRecord, [number]>(
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
			WHERE id = ?
		`,
    )
    .get(projectId);
}
/**
 * Function of listProjects.
 * @param database - The value of `database`.
 */

export function listProjects(database: Database): ProjectRecord[] {
  /** Read all projects ordered by recent activity and then name. */
  return database
    .query<ProjectRecord, []>(
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
    )
    .all();
}
/**
 * Function of upsertProject.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function upsertProject(
  database: Database,
  input: ProjectInput,
): ProjectRecord {
  /**
   * Create-or-update a project row and refresh its open/timestamp state.
   * Returns the canonical row after write to avoid stale callers.
   */

  runStatement(
    database,
    `
			INSERT INTO projects (path, name, is_open, last_opened_at, updated_at)
			VALUES (?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			ON CONFLICT(path) DO UPDATE SET
				is_open = 1,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		`,
    input.projectPath,
    input.name ?? "",
  );
  const project = getProject(database, input.projectPath);
  if (!project) {
    throw new Error(`Failed to upsert project at ${input.projectPath}`);
  }

  return project;
}
/**
 * Function of listOpenProjects.
 * @param database - The value of `database`.
 */

export function listOpenProjects(database: Database): ProjectRecord[] {
  /** Return only open projects for current workspaces. */
  return database
    .query<ProjectRecord, []>(
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
    )
    .all();
}
/**
 * Function of setProjectClosed.
 * @param database - The value of `database`.
 * @param projectId - The value of `projectId`.
 */

export function setProjectClosed(database: Database, projectId: number): void {
  /** Soft-close a project by unsetting its open flag. */

  runStatement(
    database,
    `UPDATE projects SET is_open = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    projectId,
  );
}
/**
 * Function of deleteProject.
 * @param database - The value of `database`.
 * @param projectId - The value of `projectId`.
 */

export function deleteProject(database: Database, projectId: number): void {
  /** Delete a project and cascade dependent rows via FK constraints. */
  runStatement(database, "DELETE FROM projects WHERE id = ?", projectId);
}
/**
 * Function of listProjectWorktreePins.
 * @param database - The value of `database`.
 * @param projectId - The value of `projectId`.
 */

export function listProjectWorktreePins(
  database: Database,
  projectId: number,
): ProjectWorktreePinRecord[] {
  /** Fetch pinned worktree entries for project workspace recall. */

  return database
    .query<ProjectWorktreePinRecord, [number]>(
      `
			SELECT
				project_id AS projectId,
				worktree_path AS worktreePath,
				pinned_at AS pinnedAt
			FROM project_worktrees
			WHERE project_id = ?
		`,
    )
    .all(projectId);
}
/**
 * Function of setProjectWorktreePinned.
 * @param database - The value of `database`.
 * @param projectId - The value of `projectId`.
 * @param worktreePath - The value of `worktreePath`.
 * @param pinned - The value of `pinned`.
 */

export function setProjectWorktreePinned(
  database: Database,
  projectId: number,
  worktreePath: string,
  pinned: boolean,
): void {
  /**
   * Add or remove a pinned worktree marker.
   * Insert updates pin timestamps; delete unpins and removes history.
   */

  if (pinned) {
    runStatement(
      database,
      `
				INSERT INTO project_worktrees (
					project_id,
					worktree_path,
					pinned_at
				)
				VALUES (
					?,
					?,
					strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				)
				ON CONFLICT(project_id, worktree_path) DO UPDATE SET
					pinned_at = excluded.pinned_at
			`,
      projectId,
      worktreePath,
    );
    return;
  }

  runStatement(
    database,
    `
			DELETE FROM project_worktrees
			WHERE project_id = ? AND worktree_path = ?
		`,
    projectId,
    worktreePath,
  );
}
/**
 * Function of listThreads.
 * @param database - The value of `database`.
 */

export function listThreads(database: Database): ThreadRecord[] {
  /** Fetch all threads, prioritized by pin state and recency. */
  return database
    .query<ThreadRecord, []>(
      `
				SELECT
					id,
					project_id AS projectId,
					worktree_path AS worktreePath,
					title,
					summary,
					model,
					reasoning_effort AS reasoningEffort,
					unsafe_mode AS unsafeMode,
					codex_thread_id AS codexThreadId,
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
					CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC,
					pinned_at DESC,
					updated_at DESC,
					created_at DESC,
					id DESC
			`,
    )
    .all();
}
/**
 * Function of getThreadById.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 */

export function getThreadById(
  database: Database,
  threadId: number,
): ThreadRecord | null {
  /** Fetch one thread record with token/compaction/error metadata mapped to camelCase. */

  return database
    .query<ThreadRecord, [number]>(
      `
				SELECT
					id,
					project_id AS projectId,
					worktree_path AS worktreePath,
					title,
					summary,
					model,
					reasoning_effort AS reasoningEffort,
					unsafe_mode AS unsafeMode,
					codex_thread_id AS codexThreadId,
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
				WHERE id = ?
			`,
    )
    .get(threadId);
}
/**
 * Function of createThread.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function createThread(
  database: Database,
  input: ThreadInput,
): ThreadRecord {
  /**
   * Insert a thread row and return the inserted record.
   * Throws if readback fails, which indicates write/read consistency issues.
   */

  const result = runStatement(
    database,
    `
			INSERT INTO threads (
				project_id,
				worktree_path,
				title,
				model,
				reasoning_effort,
				unsafe_mode,
				codex_thread_id,
				updated_at
			)
			VALUES (
				?,
				?,
				?,
				?,
				?,
				?,
				?,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			)
		`,
    input.projectId,
    input.worktreePath,
    input.title,
    input.model,
    input.reasoningEffort,
    input.unsafeMode ? 1 : 0,
    input.codexThreadId ?? null,
  );
  const threadId = Number(result.lastInsertRowid);
  const thread = getThreadById(database, threadId);
  if (!thread) {
    throw new Error(`Failed to create thread for project ${input.projectId}`);
  }
  return thread;
}
/**
 * Function of updateThreadCodexId.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param codexThreadId - The value of `codexThreadId`.
 */

export function updateThreadCodexId(
  database: Database,
  threadId: number,
  codexThreadId: string,
): void {
  /** Persist the provider thread identifier from external API backfill. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				codex_thread_id = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    codexThreadId,
    threadId,
  );
}
/**
 * Function of renameThread.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param title - The value of `title`.
 * @param summary - The value of `summary`.
 */

export function renameThread(
  database: Database,
  threadId: number,
  title: string,
  summary?: string | null,
): void {
  /** Rename a thread; includes optional summary persistence. */

  if (typeof summary !== "undefined") {
    runStatement(
      database,
      `
				UPDATE threads
				SET
					title = ?,
					summary = ?
				WHERE id = ?
			`,
      title,
      summary,
      threadId,
    );
    return;
  }

  runStatement(
    database,
    `
			UPDATE threads
			SET title = ?
			WHERE id = ?
		`,
    title,
    threadId,
  );
}
/**
 * Function of setThreadModel.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param model - The value of `model`.
 */

export function setThreadModel(
  database: Database,
  threadId: number,
  model: string,
): void {
  /** Persist selected model and update audit timestamp. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				model = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    model,
    threadId,
  );
}
/**
 * Function of setThreadReasoningEffort.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param reasoningEffort - The value of `reasoningEffort`.
 */

export function setThreadReasoningEffort(
  database: Database,
  threadId: number,
  reasoningEffort: string,
): void {
  /** Persist selected reasoning effort and refresh update time. */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				reasoning_effort = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    reasoningEffort,
    threadId,
  );
}
/**
 * Function of setThreadUnsafeMode.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param unsafeMode - The value of `unsafeMode`.
 */

export function setThreadUnsafeMode(
  database: Database,
  threadId: number,
  unsafeMode: boolean,
): void {
  /** Set unsafe mode flag and update thread's modified timestamp. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				unsafe_mode = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    unsafeMode ? 1 : 0,
    threadId,
  );
}
/**
 * Function of setThreadPinned.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param pinned - The value of `pinned`.
 */

export function setThreadPinned(
  database: Database,
  threadId: number,
  pinned: boolean,
): void {
  /**
   * Toggle pinned state by setting or clearing `pinned_at`.
   * Pinned threads sort above unpinned in listQueries.
   */

  runStatement(
    database,
    `
			UPDATE threads
			SET pinned_at = CASE
				WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				ELSE NULL
			END
			WHERE id = ?
		`,
    pinned ? 1 : 0,
    threadId,
  );
}
/**
 * Function of deleteThread.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 */

export function deleteThread(database: Database, threadId: number): void {
  /** Remove a thread and all its messages via foreign key cascade. */
  runStatement(database, "DELETE FROM threads WHERE id = ?", threadId);
}
/**
 * Function of markThreadRan.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 */

export function markThreadRan(database: Database, threadId: number): void {
  /** Mark a thread successfully executed and clear transient error state. */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				active_turn_started_at = NULL,
				last_error_at = NULL,
				last_error_seen_at = NULL,
				last_error_message = NULL
			WHERE id = ?
		`,
    threadId,
  );
}
/**
 * Function of markThreadRunStarted.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param startedAt - The value of `startedAt`.
 */

export function markThreadRunStarted(
  database: Database,
  threadId: number,
  startedAt: string,
): void {
  /**
   * Mark a thread turn as in-progress with a caller-provided start timestamp.
   * Mirrors start times across restart/resume scenarios.
   */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = ?,
				active_turn_started_at = ?
			WHERE id = ?
		`,
    startedAt,
    startedAt,
    threadId,
  );
}
/**
 * Function of markThreadStopped.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param message - The value of `message`.
 */

export function markThreadStopped(
  database: Database,
  threadId: number,
  message: string,
): void {
  /** Mark thread as stopped with human-readable failure text and timestamps. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				active_turn_started_at = NULL,
				last_error_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_error_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_error_message = ?
			WHERE id = ?
		`,
    message,
    threadId,
  );
}
/**
 * Function of setThreadUsage.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param usage - The value of `usage`.
 * @param compactionStats - The value of `compactionStats`.
 */

export function setThreadUsage(
  database: Database,
  threadId: number,
  usage: ThreadUsageInput,
  compactionStats: ThreadCompactionStatsInput,
): void {
  /** Store latest token usage and compaction telemetry for thread analytics. */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				last_input_tokens = ?,
				last_cached_input_tokens = ?,
				last_output_tokens = ?,
				max_input_tokens = ?,
				estimated_compaction_trigger_tokens = ?,
				compaction_count = ?,
				last_compaction_at = ?,
				last_compaction_before_input_tokens = ?,
				last_compaction_after_input_tokens = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    compactionStats.maxInputTokens,
    compactionStats.estimatedCompactionTriggerTokens,
    compactionStats.compactionCount,
    compactionStats.lastCompactionAt,
    compactionStats.lastCompactionBeforeInputTokens,
    compactionStats.lastCompactionAfterInputTokens,
    threadId,
  );
}
/**
 * Function of markThreadFailed.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param errorMessage - The value of `errorMessage`.
 */

export function markThreadFailed(
  database: Database,
  threadId: number,
  errorMessage: string,
): void {
  /** Capture a hard failure and make it visible as last error for UI surfacing. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				active_turn_started_at = NULL,
				last_error_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_error_seen_at = NULL,
				last_error_message = ?
			WHERE id = ?
		`,
    errorMessage,
    threadId,
  );
}
/**
 * Function of markThreadErrorSeen.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 */

export function markThreadErrorSeen(
  database: Database,
  threadId: number,
): void {
  /**
   * Mark last error as acknowledged by user.
   * If no prior error exists, leave `last_error_seen_at` null.
   */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				last_error_seen_at = CASE
					WHEN last_error_at IS NULL THEN NULL
					ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				END
			WHERE id = ?
		`,
    threadId,
  );
}
/**
 * Function of listThreadsWithInProgressMessages.
 * @param database - The value of `database`.
 */

export function listThreadsWithInProgressMessages(
  database: Database,
): InProgressThreadMessageRecord[] {
  /** Summarize latest activity update per thread for in-flight UI restoration. */
  return database
    .query<InProgressThreadMessageRecord, []>(
      `
				SELECT
					thread_id AS threadId,
					MAX(COALESCE(updated_at, created_at)) AS lastUpdatedAt
				FROM thread_messages
				WHERE state = 'in_progress'
				GROUP BY thread_id
			`,
    )
    .all();
}
/**
 * Function of listThreadMessages.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 */

export function listThreadMessages(
  database: Database,
  threadId: number,
): ThreadMessageRecord[] {
  /** Return all messages in canonical order for a thread. */

  return database
    .query<ThreadMessageRecord, [number]>(
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
				ORDER BY id ASC
			`,
    )
    .all(threadId);
}
/**
 * Function of listThreadMessagesPage.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param options - The value of `options`.
 */

export function listThreadMessagesPage(
  database: Database,
  threadId: number,
  options?: {
    cursor?: number | null;
    limit?: number;
  },
): {
  messages: ThreadMessageRecord[];
  nextCursor: number | null;
} {
  const limit = Math.max(1, options?.limit ?? 100);
  const pageSize = limit + 1;
  const cursor = typeof options?.cursor === "number" ? options.cursor : null;
  const rows =
    cursor === null
      ? database
          .query<ThreadMessageRecord, [number, number]>(
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
          )
          .all(threadId, pageSize)
      : database
          .query<ThreadMessageRecord, [number, number, number]>(
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
					AND id < ?
				ORDER BY id DESC
				LIMIT ?
			`,
          )
          .all(threadId, cursor, pageSize);
  const hasMore = rows.length > limit;
  const pageRows = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return {
    messages: pageRows,
    nextCursor:
      hasMore && pageRows.length > 0 ? (pageRows[0]?.id ?? null) : null,
  };
}
/**
 * Function of createThreadMessage.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function createThreadMessage(
  database: Database,
  input: ThreadMessageInput,
): ThreadMessageRecord {
  /** Insert a message row using default chat activity values and return inserted row. */
  const result = runStatement(
    database,
    `
			INSERT INTO thread_messages (
				thread_id,
				role,
				kind,
				item_id,
				text,
				state,
				payload_json,
				updated_at
			)
			VALUES (?, ?, 'chat', NULL, ?, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		`,
    input.threadId,
    input.role,
    input.text,
  );
  const messageId = Number(result.lastInsertRowid);
  const message = database
    .query<ThreadMessageRecord, [number]>(
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
				WHERE id = ?
			`,
    )
    .get(messageId);
  if (!message) {
    throw new Error(
      `Failed to create thread message for thread ${input.threadId}`,
    );
  }
  return message;
}
/**
 * Function of upsertThreadActivity.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

export function upsertThreadActivity(
  database: Database,
  input: ThreadActivityInput,
): void {
  /**
   * Convenience one-item wrapper around multi-activity upsert.
   * Keeps caller code simple when only a single activity update is needed.
   */

  upsertThreadActivities(database, [input]);
}
/**
 * Function of findThreadActivityMessageId.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 * @param itemId - The value of `itemId`.
 */

function findThreadActivityMessageId(
  database: Database,
  threadId: number,
  itemId: string,
): number | null {
  /** Find most recent message row for given thread+item to coalesce activity updates. */
  const existing = database
    .query<{ id: number }, [number, string]>(
      `
				SELECT id
				FROM thread_messages
				WHERE thread_id = ? AND item_id = ?
				ORDER BY id DESC
				LIMIT 1
			`,
    )
    .get(threadId, itemId);
  return existing ? existing.id : null;
}
/**
 * Function of updateThreadActivityById.
 * @param database - The value of `database`.
 * @param messageId - The value of `messageId`.
 * @param input - The value of `input`.
 */

function updateThreadActivityById(
  database: Database,
  messageId: number,
  input: ThreadActivityInput,
): boolean {
  /**
   * Apply a full activity upsert payload into an existing row.
   * Returns true when at least one database row changed.
   */

  const result = runStatement(
    database,
    `
			UPDATE thread_messages
			SET
				role = ?,
				kind = ?,
				text = ?,
				state = ?,
				payload_json = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    input.role ?? "assistant",
    input.kind,
    input.text,
    input.state,
    input.payloadJson ?? null,
    messageId,
  );
  return Number(result.changes) > 0;
}
/**
 * Function of insertThreadActivity.
 * @param database - The value of `database`.
 * @param input - The value of `input`.
 */

function insertThreadActivity(
  database: Database,
  input: ThreadActivityInput,
): number {
  /** Insert a new activity message row and return the row id for downstream correlation. */
  const result = runStatement(
    database,
    `
			INSERT INTO thread_messages (
				thread_id,
				role,
				kind,
				item_id,
				text,
				state,
				payload_json,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		`,
    input.threadId,
    input.role ?? "assistant",
    input.kind,
    input.itemId,
    input.text,
    input.state,
    input.payloadJson ?? null,
  );
  return Number(result.lastInsertRowid);
}
/**
 * Function of upsertThreadActivities.
 * @param database - The value of `database`.
 * @param inputs - The value of `inputs`.
 */

export function upsertThreadActivities(
  database: Database,
  inputs: readonly ThreadActivityPersistInput[],
): number[] {
  /**
   * Upsert many activity events in one atomic transaction.
   * Reuses known message ids within the batch to avoid duplicate rows for same item.
   */

  if (inputs.length === 0) {
    return [];
  }

  return runInTransaction(database, () => {
    const resolvedMessageIds: number[] = [];
    const messageIdByActivity = new Map<string, number>();

    for (const input of inputs) {
      const activityKey = `${input.threadId}\u0000${input.itemId}`;
      let messageId =
        typeof input.messageId === "number"
          ? input.messageId
          : (messageIdByActivity.get(activityKey) ?? null);

      if (typeof messageId === "number") {
        // Prefer in-batch update first so duplicate event chunks stay idempotent.
        if (!updateThreadActivityById(database, messageId, input)) {
          messageId = insertThreadActivity(database, input);
        }
      } else {
        const existingMessageId = findThreadActivityMessageId(
          database,
          input.threadId,
          input.itemId,
        );
        // Fall back to DB search for pre-existing activity rows from prior sessions.
        if (typeof existingMessageId === "number") {
          updateThreadActivityById(database, existingMessageId, input);
          messageId = existingMessageId;
        } else {
          messageId = insertThreadActivity(database, input);
        }
      }

      messageIdByActivity.set(activityKey, messageId);
      resolvedMessageIds.push(messageId);
    }

    return resolvedMessageIds;
  });
}
/**
 * Function of stopInProgressThreadMessages.
 * @param database - The value of `database`.
 * @param threadId - The value of `threadId`.
 */

export function stopInProgressThreadMessages(
  database: Database,
  threadId: number,
): void {
  /** Mark orphaned in-progress messages as stopped (used on restart/cleanup). */
  runStatement(
    database,
    `
			UPDATE thread_messages
			SET
				state = 'stopped',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE thread_id = ?
				AND state = 'in_progress'
		`,
    threadId,
  );
}
