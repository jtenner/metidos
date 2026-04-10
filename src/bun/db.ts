/**
 * @file src/bun/db.ts
 * @description Module for db.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const APP_NAME = ".metidos";
const LEGACY_APP_NAME = ".jolt";
/** Database filename under the app data directory. */
const DB_FILE_NAME = "app.db";
/** Default thread model used when no explicit model is provided. */

export const DEFAULT_THREAD_MODEL = "gpt-5.4";
/** Default reasoning effort used for thread creation and migration repair. */
export const DEFAULT_THREAD_REASONING_EFFORT = "medium";
/** Lazily-initialized singleton db handle for the process lifetime. */

let appDatabase: Database | null = null;
/** Default SQLite lock-retry timeout for write contention handling. */
const SQL_BUSY_TIMEOUT_MS = 2500;

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
  githubAccess: boolean;
  agentsAccess: boolean;
  metidosAccess: boolean;
  unsafeMode: boolean;
  piSessionId?: string | null;
  piSessionFile?: string | null;
  piLeafEntryId?: string | null;
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
  githubAccess: boolean;
  agentsAccess: boolean;
  metidosAccess: boolean;
  unsafeMode: 0 | 1;
  piSessionId: string | null;
  piSessionFile: string | null;
  piLeafEntryId: string | null;
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

type ThreadSqlRecord = Omit<
  ThreadRecord,
  "agentsAccess" | "githubAccess" | "metidosAccess"
> & {
  agentsAccess: 0 | 1;
  githubAccess: 0 | 1;
  metidosAccess: 0 | 1;
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

export type CronJobRunStatus =
  | "InProgress"
  | "Stopped"
  | "Errored"
  | "Completed";

export type CronJobRecord = {
  id: number;
  projectId: number;
  worktreePath: string;
  schedule: string;
  prompt: string;
  title: string;
  description: string;
  model: string;
  reasoningEffort: string;
  githubAccess: boolean;
  agentsAccess: boolean;
  metidosAccess: boolean;
  unsafeMode: 0 | 1;
  lastRunDate: number | null;
  lastRunStatus: CronJobRunStatus | null;
  enabled: 0 | 1;
  deletedAt: number | null;
  createdAt: string;
  updatedAt: string;
  nextRunDate: number | null;
};

export type CronJobRunRecord = {
  id: number;
  cronJobId: number;
  threadId: number;
  runDate: number;
  runStatus: CronJobRunStatus;
};

type CronJobInput = {
  projectId: number;
  worktreePath: string;
  schedule: string;
  prompt: string;
  title: string;
  description: string;
  model: string;
  reasoningEffort: string;
  githubAccess?: boolean | null;
  agentsAccess?: boolean | null;
  metidosAccess?: boolean | null;
  unsafeMode?: boolean | null;
  enabled?: boolean | null;
};

type CronJobUpdateInput = {
  schedule?: string;
  prompt?: string;
  title?: string;
  description?: string;
  model?: string;
  reasoningEffort?: string;
  githubAccess?: boolean;
  agentsAccess?: boolean;
  metidosAccess?: boolean;
  unsafeMode?: boolean;
  enabled?: boolean;
};

type CronJobRunInput = {
  cronJobId: number;
  threadId: number;
  runDate: number;
  runStatus: CronJobRunStatus;
};

type CronJobSqlRecord = Omit<
  CronJobRecord,
  "agentsAccess" | "githubAccess" | "metidosAccess" | "nextRunDate"
> & {
  agentsAccess: 0 | 1;
  githubAccess: 0 | 1;
  metidosAccess: 0 | 1;
};

function buildDefaultAppDataDirPath(appName: string): string {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", appName)
    : process.platform === "win32"
      ? join(
          process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
          appName,
        )
      : join(
          process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
          appName,
        );
}

const DEFAULT_APP_DATA_DIR = buildDefaultAppDataDirPath(APP_NAME);
const LEGACY_DEFAULT_APP_DATA_DIR = buildDefaultAppDataDirPath(LEGACY_APP_NAME);
/** Cached app-data directory path resolved for this process. */

let resolvedAppDataDir: string | null = null;

/** Compute next run timestamp from a cron schedule expression, if parseable. */
function computeCronJobNextRunDate(schedule: string): number | null {
  if (
    typeof Bun === "undefined" ||
    !Bun.cron ||
    typeof Bun.cron.parse !== "function" ||
    typeof schedule !== "string" ||
    schedule.trim().length === 0
  ) {
    return null;
  }
  try {
    const nextRunDate = Bun.cron.parse(schedule);
    if (!(nextRunDate instanceof Date)) {
      return null;
    }
    const nextRunDateMs = nextRunDate.getTime();
    return Number.isNaN(nextRunDateMs) ? null : nextRunDateMs;
  } catch {
    return null;
  }
}

/** Attach computed `nextRunDate` to a cron record coming out of SQL. */
function hydrateCronJobFromSqlRow(
  cronJob: CronJobSqlRecord,
  includeNextRunDate: boolean,
): CronJobRecord {
  return {
    ...cronJob,
    githubAccess: cronJob.githubAccess === 1,
    agentsAccess: cronJob.agentsAccess === 1,
    metidosAccess: cronJob.metidosAccess === 1,
    nextRunDate: includeNextRunDate
      ? computeCronJobNextRunDate(cronJob.schedule)
      : null,
  };
}

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
 * @param path - Filesystem path.
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
 * Applies owner only file permissions.
 * @param path - Filesystem path.
 */

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Selects writable app data directory.
 * @param options - Configuration options used by this operation.
 */

export function selectWritableAppDataDirectory(options: {
  configuredAppDataDir?: string | null | undefined;
  defaultAppDataDir: string;
  isWritableDirectory?: (path: string) => boolean;
  legacyDefaultAppDataDir?: string | null | undefined;
}): string {
  const isWritable = options.isWritableDirectory ?? isWritableDirectory;
  const preferLegacyDefault =
    !options.configuredAppDataDir &&
    typeof options.legacyDefaultAppDataDir === "string" &&
    options.legacyDefaultAppDataDir.length > 0 &&
    existsSync(options.legacyDefaultAppDataDir) &&
    !existsSync(options.defaultAppDataDir);
  const candidates = [
    options.configuredAppDataDir || null,
    preferLegacyDefault ? options.legacyDefaultAppDataDir || null : null,
    options.defaultAppDataDir,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!isWritable(candidate)) {
      continue;
    }
    return candidate;
  }

  const checkedPaths = options.configuredAppDataDir
    ? `Checked METIDOS_APP_DATA_DIR=${options.configuredAppDataDir} and ${options.defaultAppDataDir}.`
    : typeof options.legacyDefaultAppDataDir === "string"
      ? `Checked ${options.defaultAppDataDir} and legacy ${options.legacyDefaultAppDataDir}.`
      : `Checked ${options.defaultAppDataDir}.`;
  throw new Error(
    [
      "Unable to find a writable application data directory.",
      checkedPaths,
      "Set METIDOS_APP_DATA_DIR to an explicit writable per-user directory if the default location is unavailable.",
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

  const configuredAppDataDir =
    process.env.METIDOS_APP_DATA_DIR?.trim() ||
    process.env.JOLT_APP_DATA_DIR?.trim();
  resolvedAppDataDir = selectWritableAppDataDirectory({
    configuredAppDataDir,
    defaultAppDataDir: DEFAULT_APP_DATA_DIR,
    legacyDefaultAppDataDir: LEGACY_DEFAULT_APP_DATA_DIR,
  });
  return resolvedAppDataDir;
}
/**
 * Gets app data directory path.
 * @param options - Configuration options used by this operation.
 */

export function getAppDataDirectoryPath(options?: AppDataPathOptions): string {
  return options?.appDataDir ?? resolveAppDataDirectory();
}
/**
 * Applies app database permissions.
 * @param dbPath - dbPath path used by applyAppDatabasePermissions.
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
 * Performs tableHasColumn operation.
 * @param db - Database connection used for schema introspection.
 * @param tableName - Name of the table being checked for a column.
 * @param columnName - Column name whose existence is being validated.
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
 * This lets existing databases safely add newer nullable/default fields.
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
 * Ensure `cron_jobs` has a column for evolving schema versions.
 * This keeps existing databases compatible with new cron metadata fields.
 */
function ensureCronJobColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  // Column addition is additive and preserves existing row data.
  if (!tableHasColumn(db, "cron_jobs", columnName)) {
    runStatement(db, `ALTER TABLE cron_jobs ADD COLUMN ${columnDefinition}`);
  }
}

/**
 * Make existing active cron titles unique so the unique index can be added safely.
 */
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

/**
 * Migrate/create schema and apply incremental column backfills on startup.
 * Keeps the on-disk DB in sync with expected runtime shape.
 * @param db - Database handle to open a transaction against.
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
				github_access INTEGER NOT NULL DEFAULT 0,
				agents_access INTEGER NOT NULL DEFAULT 0,
				metidos_access INTEGER NOT NULL DEFAULT 1,
				unsafe_mode INTEGER NOT NULL DEFAULT 0,
				pi_session_id TEXT,
				pi_session_file TEXT,
				pi_leaf_entry_id TEXT,
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
  const hasLegacyThreadAccessColumn = tableHasColumn(
    db,
    "threads",
    "jolt_access",
  );
  const hasMetidosThreadAccessColumn = tableHasColumn(
    db,
    "threads",
    "metidos_access",
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
    "github_access",
    "github_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureThreadColumn(
    db,
    "agents_access",
    "agents_access INTEGER NOT NULL DEFAULT 0",
  );
  if (!hasMetidosThreadAccessColumn) {
    ensureThreadColumn(
      db,
      "metidos_access",
      "metidos_access INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (hasLegacyThreadAccessColumn && !hasMetidosThreadAccessColumn) {
    runStatement(
      db,
      `
			UPDATE threads
			SET metidos_access = jolt_access
		`,
    );
  }
  ensureThreadColumn(
    db,
    "unsafe_mode",
    "unsafe_mode INTEGER NOT NULL DEFAULT 0",
  );
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
			UPDATE threads
			SET github_access = 0
			WHERE github_access IS NULL
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
			SET metidos_access = 1
			WHERE metidos_access IS NULL
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
				github_access INTEGER NOT NULL DEFAULT 0,
				agents_access INTEGER NOT NULL DEFAULT 0,
				metidos_access INTEGER NOT NULL DEFAULT 1,
				unsafe_mode INTEGER NOT NULL DEFAULT 0,
				last_run_date INTEGER,
				last_run_status TEXT CHECK(last_run_status IN ('InProgress', 'Stopped', 'Errored', 'Completed')),
				enabled INTEGER NOT NULL DEFAULT 1,
				deleted_at INTEGER,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`,
  );
  const hasLegacyCronAccessColumn = tableHasColumn(
    db,
    "cron_jobs",
    "jolt_access",
  );
  const hasMetidosCronAccessColumn = tableHasColumn(
    db,
    "cron_jobs",
    "metidos_access",
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
    "github_access",
    "github_access INTEGER NOT NULL DEFAULT 0",
  );
  ensureCronJobColumn(
    db,
    "agents_access",
    "agents_access INTEGER NOT NULL DEFAULT 0",
  );
  if (!hasMetidosCronAccessColumn) {
    ensureCronJobColumn(
      db,
      "metidos_access",
      "metidos_access INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (hasLegacyCronAccessColumn && !hasMetidosCronAccessColumn) {
    runStatement(
      db,
      `
			UPDATE cron_jobs
			SET metidos_access = jolt_access
		`,
    );
  }
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
    DEFAULT_THREAD_MODEL,
  );
  runStatement(
    db,
    `
			UPDATE cron_jobs
			SET
				reasoning_effort = ?
			WHERE reasoning_effort IS NULL OR TRIM(reasoning_effort) = ''
		`,
    DEFAULT_THREAD_REASONING_EFFORT,
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
				github_access = 0
			WHERE github_access IS NULL
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
				metidos_access = 1
			WHERE metidos_access IS NULL
		`,
  );
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
}
/**
 * Gets app database path.
 * @param options - Configuration options used by this operation.
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
 * Deletes the app database files for the resolved app-data directory.
 * @param options - Configuration options used by this operation.
 */
export function deleteAppDatabaseFiles(options?: AppDataPathOptions): string[] {
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  const dbPath = getAppDatabasePath(options);
  const candidatePaths = [
    dbPath,
    `${dbPath}-journal`,
    `${dbPath}-shm`,
    `${dbPath}-wal`,
  ];
  const deletedPaths: string[] = [];
  for (const path of candidatePaths) {
    if (!existsSync(path)) {
      continue;
    }
    rmSync(path, {
      force: true,
    });
    deletedPaths.push(path);
  }

  return deletedPaths;
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
  runStatement(db, `PRAGMA busy_timeout = ${SQL_BUSY_TIMEOUT_MS}`);
  migrateDatabase(db);
  applyAppDatabasePermissions(dbPath);
  appDatabase = db;
  return db;
}
/**
 * Gets auth settings.
 * @param database - Database instance to read authentication settings from.
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
 * Upserts auth settings.
 * @param database - Database instance used to upsert auth settings.
 * @param input - Auth settings payload to persist.
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
 * Sets auth failure state.
 * @param database - Database instance used to update failure counters.
 * @param failedPrimaryFactorAttempts - Counter for failed primary factor attempts.
 * @param lockedUntil - Timestamp until which account lockout remains.
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
 * Resets auth failure state.
 * @param database - Database instance used to clear failure state.
 */

export function resetAuthFailureState(database: Database): void {
  /** Clear any stored failed-attempt counters and lockout state. */

  setAuthFailureState(database, 0, null);
}
/**
 * Lists auth recovery codes.
 * @param database - Database instance used to list recovery codes.
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
 * Replaces auth recovery code hashes.
 * @param database - Database instance used to replace recovery hashes.
 * @param codeHashes - New recovery code hash list to persist.
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
 * Marks auth recovery code used.
 * @param database - Database instance marking a code as used.
 * @param codeHash - Recovery code hash that was used.
 * @param usedAt - Timestamp at which the recovery code was consumed.
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
 * Creates auth session.
 * @param database - Database handle used to create an auth session.
 * @param input - Auth session creation payload.
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
 * Gets auth session.
 * @param database - Database handle used to fetch a session.
 * @param sessionId - sessionId identifier.
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
 * Touches auth session.
 * @param database - Database handle used to refresh session activity.
 * @param sessionId - sessionId identifier.
 * @param lastUsedAt - Timestamp to update as most recent usage.
 * @param expiresAt - Optional new expiration timestamp.
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
 * Sets auth session step up valid until.
 * @param database - Database handle used to set step-up expiry.
 * @param sessionId - sessionId identifier.
 * @param stepUpValidUntil - Timestamp until step-up authentication remains valid.
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
 * Deletes auth session.
 * @param database - Database handle used to delete a session.
 * @param sessionId - sessionId identifier.
 */

export function deleteAuthSession(database: Database, sessionId: string): void {
  /** Remove one session and cascade any dependent websocket tickets. */

  runStatement(database, "DELETE FROM auth_sessions WHERE id = ?", sessionId);
}
/**
 * Deletes all auth sessions.
 * @param database - Database handle used to purge all sessions.
 */

export function deleteAllAuthSessions(database: Database): number {
  /** Revoke every authenticated session and cascade dependent websocket tickets. */
  const result = runStatement(database, "DELETE FROM auth_sessions");
  return Number(result.changes);
}
/**
 * Deletes expired auth sessions.
 * @param database - Database handle used to remove expired sessions.
 * @param now - Current timestamp used to evaluate expiration.
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
 * Creates auth web socket ticket.
 * @param database - Database handle used to create a websocket ticket.
 * @param input - Websocket ticket creation input payload.
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
 * Gets auth web socket ticket.
 * @param database - Database handle used to fetch a websocket ticket.
 * @param ticketId - ticketId identifier.
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
 * Performs consumeAuthWebSocketTicket operation.
 * @param database - Database handle used to consume a websocket ticket.
 * @param ticketId - ticketId identifier.
 * @param consumedAt - Timestamp marking ticket consumption time.
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
 * Deletes expired auth web socket tickets.
 * @param database - Database handle used to purge expired tickets.
 * @param now - Current timestamp used to determine ticket expiry.
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
 * Creates security audit event.
 * @param database - Database handle used to create an audit event.
 * @param input - Audit event payload to persist.
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
 * Lists security audit events.
 * @param database - Database handle used to list security audit events.
 * @param options - Configuration options used by this operation.
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
 * Gets project.
 * @param database - Database handle used to fetch a project by path.
 * @param projectPath - projectPath path used by getProject.
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
 * Gets project by id.
 * @param database - Database handle used to fetch a project by ID.
 * @param projectId - Project identifier.
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
 * Lists projects.
 * @param database - Database handle used to list projects.
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
 * Upserts project.
 * @param database - Database handle used to upsert project metadata.
 * @param input - Project metadata to insert or update.
 */

export function upsertProject(
  database: Database,
  input: ProjectInput,
): ProjectRecord {
  /**
   * Create-or-update a project row and refresh its open/timestamp state.
   * Returns the canonical row after write so callers always read the persisted state.
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
 * Lists open projects.
 * @param database - Database handle used to list open projects.
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
 * Sets project closed.
 * @param database - Database handle used to mark a project as closed.
 * @param projectId - Project identifier.
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
 * Deletes project.
 * @param database - Database handle used to delete a project.
 * @param projectId - Project identifier.
 */

export function deleteProject(database: Database, projectId: number): void {
  /** Delete a project and cascade dependent rows via FK constraints. */
  runStatement(database, "DELETE FROM projects WHERE id = ?", projectId);
}
/**
 * Lists project worktree pins.
 * @param database - Database handle used to fetch project worktree pins.
 * @param projectId - Project identifier.
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
 * Sets project worktree pinned.
 * @param database - Database handle used to update pin state.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 * @param pinned - Whether the worktree pin should be set or cleared.
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
 * Lists threads.
 * @param database - Database handle used to list threads.
 */

export function listThreads(database: Database): ThreadRecord[] {
  /** Fetch all threads, prioritized by pin state and recency. */
  const rows = database
    .query<ThreadSqlRecord, []>(
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
					CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC,
					pinned_at DESC,
					updated_at DESC,
					created_at DESC,
					id DESC
			`,
    )
    .all();
  return rows.map(hydrateThreadFromSqlRow);
}
/**
 * Gets thread by id.
 * @param database - Database handle used to fetch a thread by ID.
 * @param threadId - Thread identifier.
 */

export function getThreadById(
  database: Database,
  threadId: number,
): ThreadRecord | null {
  /** Fetch one thread record with token/compaction/error metadata mapped to camelCase. */

  const thread = database
    .query<ThreadSqlRecord, [number]>(
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
					WHERE id = ?
			`,
    )
    .get(threadId);
  return thread ? hydrateThreadFromSqlRow(thread) : null;
}

function hydrateThreadFromSqlRow(thread: ThreadSqlRecord): ThreadRecord {
  return {
    ...thread,
    githubAccess: thread.githubAccess === 1,
    agentsAccess: thread.agentsAccess === 1,
    metidosAccess: thread.metidosAccess === 1,
  };
}
/**
 * Creates thread.
 * @param database - Database handle used to create a new thread.
 * @param input - Thread creation payload.
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
				github_access,
				agents_access,
				metidos_access,
				unsafe_mode,
				pi_session_id,
				pi_session_file,
				pi_leaf_entry_id,
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
    input.githubAccess ? 1 : 0,
    input.agentsAccess ? 1 : 0,
    input.metidosAccess ? 1 : 0,
    input.unsafeMode ? 1 : 0,
    input.piSessionId ?? null,
    input.piSessionFile ?? null,
    input.piLeafEntryId ?? null,
  );
  const threadId = Number(result.lastInsertRowid);
  const thread = getThreadById(database, threadId);
  if (!thread) {
    throw new Error(`Failed to create thread for project ${input.projectId}`);
  }
  return thread;
}
export function updateThreadPiSessionState(
  database: Database,
  threadId: number,
  input: {
    piSessionId: string | null;
    piSessionFile: string | null;
    piLeafEntryId: string | null;
  },
): void {
  runStatement(
    database,
    `
			UPDATE threads
			SET
				pi_session_id = ?,
				pi_session_file = ?,
				pi_leaf_entry_id = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    input.piSessionId,
    input.piSessionFile,
    input.piLeafEntryId,
    threadId,
  );
}
/**
 * Performs renameThread operation.
 * @param database - Database handle used to rename a thread.
 * @param threadId - Thread identifier.
 * @param title - New thread title.
 * @param summary - New thread summary text.
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
 * Sets thread model.
 * @param database - Database handle used to set thread model.
 * @param threadId - Thread identifier.
 * @param model - Model to configure for the thread.
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
 * Sets thread reasoning effort.
 * @param database - Database handle used to set reasoning effort.
 * @param threadId - Thread identifier.
 * @param reasoningEffort - Reasoning effort value to persist.
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
 * Sets thread access controls.
 * @param database - Database handle used to update thread access.
 * @param threadId - Thread identifier.
 * @param input - Access flag input.
 */

export function setThreadAccess(
  database: Database,
  threadId: number,
  input: {
    githubAccess: boolean;
    agentsAccess: boolean;
    metidosAccess: boolean;
    unsafeMode: boolean;
  },
): void {
  /** Persist access controls and refresh the thread's modified timestamp. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				github_access = ?,
				agents_access = ?,
				metidos_access = ?,
				unsafe_mode = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    input.githubAccess ? 1 : 0,
    input.agentsAccess ? 1 : 0,
    input.metidosAccess ? 1 : 0,
    input.unsafeMode ? 1 : 0,
    threadId,
  );
}
/**
 * Sets thread unsafe mode.
 * @param database - Database handle used to update thread unsafe-mode.
 * @param threadId - Thread identifier.
 * @param unsafeMode - Unsafe-mode value to persist.
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
 * Sets thread pinned.
 * @param database - Database handle used to pin or unpin a thread.
 * @param threadId - Thread identifier.
 * @param pinned - Desired thread pinned state.
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
 * Deletes thread.
 * @param database - Database handle used to delete a thread.
 * @param threadId - Thread identifier.
 */

export function deleteThread(database: Database, threadId: number): void {
  /** Remove a thread and all its messages via foreign key cascade. */
  runStatement(database, "DELETE FROM threads WHERE id = ?", threadId);
}
/**
 * Marks thread ran.
 * @param database - Database handle used to mark thread as executed.
 * @param threadId - Thread identifier.
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
 * Marks thread run started.
 * @param database - Database handle used to mark thread run start.
 * @param threadId - Thread identifier.
 * @param startedAt - Timestamp when thread run started.
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
 * Marks thread stopped.
 * @param database - Database handle used to mark thread as stopped.
 * @param threadId - Thread identifier.
 * @param message - Message payload.
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
 * Sets thread usage.
 * @param database - Database handle used to set thread usage metrics.
 * @param threadId - Thread identifier.
 * @param usage - Usage metrics payload for the thread.
 * @param compactionStats - Compaction metadata included in usage metrics.
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
 * Marks thread failed.
 * @param database - Database handle used to mark thread as failed.
 * @param threadId - Thread identifier.
 * @param errorMessage - Failure message to persist for the thread.
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
 * Marks thread error seen.
 * @param database - Database handle used to mark thread error as acknowledged.
 * @param threadId - Thread identifier.
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
 * Lists threads with in progress messages.
 * @param database - Database handle used to list in-progress thread messages.
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
 * Lists thread messages.
 * @param database - Database handle used to list thread messages.
 * @param threadId - Thread identifier.
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
 * Lists thread messages page.
 * @param database - Database handle used to fetch a paginated message list.
 * @param threadId - Thread identifier.
 * @param options - Configuration options used by this operation.
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
 * Creates thread message.
 * @param database - Database handle used to create a thread message.
 * @param input - Message payload to persist for the thread.
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
 * Upserts thread activity.
 * @param database - Database handle used to upsert thread activity.
 * @param input - Activity input payload for upsert.
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
 * Finds thread activity message id.
 * @param database - Database handle used to locate activity message ID.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
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
 * Updates thread activity by id.
 * @param database - Database handle used to update activity by ID.
 * @param messageId - messageId identifier.
 * @param input - Updated activity fields.
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
 * Inserts thread activity.
 * @param database - Database handle used to insert thread activity.
 * @param input - Activity payload to insert.
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
 * Upserts thread activities.
 * @param database - Database handle used to bulk-upsert thread activities.
 * @param inputs - Activity payloads to upsert in batch.
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
 * Performs stopInProgressThreadMessages operation.
 * @param database - Database handle used to stop in-progress messages.
 * @param threadId - Thread identifier.
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

/**
 * Creates a cron job row.
 * @param database - Database handle used to create cron jobs.
 * @param input - Input row.
 */
export function createCronJob(
  database: Database,
  input: CronJobInput,
): CronJobRecord {
  const result = runStatement(
    database,
    `
			INSERT INTO cron_jobs (
				project_id,
				worktree_path,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort,
				github_access,
				agents_access,
				metidos_access,
				unsafe_mode,
				enabled
			)
				VALUES (
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?
				)
		`,
    input.projectId,
    input.worktreePath,
    input.schedule,
    input.prompt,
    input.title,
    input.description,
    input.model,
    input.reasoningEffort,
    input.githubAccess === true ? 1 : 0,
    input.agentsAccess === true ? 1 : 0,
    input.metidosAccess === false ? 0 : 1,
    input.unsafeMode === true ? 1 : 0,
    input.enabled === false ? 0 : 1,
  );
  const cronJob = getCronJobById(database, Number(result.lastInsertRowid));
  if (!cronJob) {
    throw new Error(
      `Failed to create cron job for project ${input.projectId} and workspace ${input.worktreePath}`,
    );
  }
  return cronJob;
}

/**
 * Lists cron jobs.
 * @param database - Database handle used to list cron jobs.
 */
export function listCronJobs(database: Database): CronJobRecord[] {
  /** Load all cron jobs with latest settings. */
  const rows = database
    .query<CronJobSqlRecord, []>(
      `
			SELECT
				id,
				project_id AS projectId,
				worktree_path AS worktreePath,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort AS reasoningEffort,
				github_access AS githubAccess,
				agents_access AS agentsAccess,
				metidos_access AS metidosAccess,
				unsafe_mode AS unsafeMode,
				last_run_date AS lastRunDate,
				last_run_status AS lastRunStatus,
				enabled,
				deleted_at AS deletedAt,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM cron_jobs
			ORDER BY id DESC
		`,
    )
    .all();
  return rows.map((cronJob) => hydrateCronJobFromSqlRow(cronJob, true));
}

/**
 * Gets a single cron job by id.
 * @param database - Database handle used to fetch a cron job by ID.
 * @param cronJobId - Cron job identifier.
 */
export function getCronJobById(
  database: Database,
  cronJobId: number,
  options: { includeNextRunDate?: boolean } = {},
): CronJobRecord | null {
  const { includeNextRunDate = true } = options;
  /** Read a cron job row by its id. */
  const cronJob = database
    .query<CronJobSqlRecord, [number]>(
      `
			SELECT
				id,
				project_id AS projectId,
				worktree_path AS worktreePath,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort AS reasoningEffort,
				github_access AS githubAccess,
				agents_access AS agentsAccess,
				metidos_access AS metidosAccess,
				unsafe_mode AS unsafeMode,
				last_run_date AS lastRunDate,
				last_run_status AS lastRunStatus,
				enabled,
				deleted_at AS deletedAt,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM cron_jobs
			WHERE id = ?
		`,
    )
    .get(cronJobId);
  return cronJob ? hydrateCronJobFromSqlRow(cronJob, includeNextRunDate) : null;
}

/**
 * Updates a cron job row.
 * @param database - Database handle used to update cron job metadata.
 * @param cronJobId - Cron job identifier.
 * @param input - patch input.
 */
export function updateCronJob(
  database: Database,
  cronJobId: number,
  input: CronJobUpdateInput,
): CronJobRecord {
  const updates: string[] = [];
  const bindings: SQLQueryBindings[] = [];

  if (typeof input.schedule === "string") {
    updates.push("schedule = ?");
    bindings.push(input.schedule);
  }

  if (typeof input.prompt === "string") {
    updates.push("prompt = ?");
    bindings.push(input.prompt);
  }

  if (typeof input.title === "string") {
    updates.push("title = ?");
    bindings.push(input.title);
  }

  if (typeof input.description === "string") {
    updates.push("description = ?");
    bindings.push(input.description);
  }

  if (typeof input.model === "string") {
    updates.push("model = ?");
    bindings.push(input.model);
  }

  if (typeof input.reasoningEffort === "string") {
    updates.push("reasoning_effort = ?");
    bindings.push(input.reasoningEffort);
  }

  if (typeof input.githubAccess === "boolean") {
    updates.push("github_access = ?");
    bindings.push(input.githubAccess ? 1 : 0);
  }

  if (typeof input.agentsAccess === "boolean") {
    updates.push("agents_access = ?");
    bindings.push(input.agentsAccess ? 1 : 0);
  }

  if (typeof input.metidosAccess === "boolean") {
    updates.push("metidos_access = ?");
    bindings.push(input.metidosAccess ? 1 : 0);
  }

  if (typeof input.unsafeMode === "boolean") {
    updates.push("unsafe_mode = ?");
    bindings.push(input.unsafeMode ? 1 : 0);
  }

  if (typeof input.enabled === "boolean") {
    updates.push("enabled = ?");
    bindings.push(input.enabled ? 1 : 0);
  }

  if (!updates.length) {
    throw new Error("No cron job fields to update.");
  }

  const sql = `
			UPDATE cron_jobs
			SET
				${updates.join(", ")},
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`;

  runStatement(database, sql, ...bindings, cronJobId);
  const cronJob = getCronJobById(database, cronJobId);
  if (!cronJob) {
    throw new Error(`Cron job not found: ${cronJobId}`);
  }
  return cronJob;
}

/**
 * Lists enabled, non-deleted cron jobs.
 * @param database - Database handle used to list active cron jobs.
 */
export function listActiveCronJobs(database: Database): CronJobRecord[] {
  /** Read cron jobs that are enabled and not soft-deleted. */
  const rows = database
    .query<CronJobSqlRecord, []>(
      `
			SELECT
				id,
				project_id AS projectId,
				worktree_path AS worktreePath,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort AS reasoningEffort,
				github_access AS githubAccess,
				agents_access AS agentsAccess,
				metidos_access AS metidosAccess,
				unsafe_mode AS unsafeMode,
				last_run_date AS lastRunDate,
				last_run_status AS lastRunStatus,
				enabled,
				deleted_at AS deletedAt,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM cron_jobs
			WHERE enabled = 1 AND deleted_at IS NULL
			ORDER BY id ASC
		`,
    )
    .all();
  return rows.map((cronJob) => hydrateCronJobFromSqlRow(cronJob, false));
}

/**
 * Sets cron job enabled state.
 * @param database - Database handle used to enable/disable cron job.
 * @param cronJobId - Cron job identifier.
 * @param enabled - enabled state.
 */
export function setCronJobEnabled(
  database: Database,
  cronJobId: number,
  enabled: boolean,
): void {
  /** Toggle cron job scheduling state. */
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				enabled = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    enabled ? 1 : 0,
    cronJobId,
  );
}

/**
 * Soft deletes a cron job by setting deletedAt.
 * @param database - Database handle used to mark a cron job as deleted.
 * @param cronJobId - Cron job identifier.
 */
export function softDeleteCronJob(database: Database, cronJobId: number): void {
  /** Disable and soft-delete a cron job so historical run rows remain. */
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				enabled = 0,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    cronJobId,
  );
}

/**
 * Updates cron job last-run metadata.
 * @param database - Database handle used to record cron last run timestamp.
 * @param cronJobId - Cron job identifier.
 * @param inputRunDate - Last run date (ms since epoch).
 * @param status - Last run status.
 */
export function updateCronJobLastRun(
  database: Database,
  cronJobId: number,
  inputRunDate: number,
  status: CronJobRunStatus,
): void {
  /** Persist runtime execution metadata for scheduler visibility. */
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				last_run_date = ?,
				last_run_status = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    inputRunDate,
    status,
    cronJobId,
  );
}

/**
 * Claims due cron jobs and marks them as in progress.
 * @param database - Database handle used to claim cron jobs for execution.
 * @param schedule - Cron schedule expression that triggered.
 * @param runDate - Run time in ms since epoch.
 */
export function claimCronJobsForScheduledRun(
  database: Database,
  schedule: string,
  runDate: number,
): CronJobRecord[] {
  /** Claim due jobs atomically by matching schedule and outdated last-run timestamp. */
  const rows = database
    .query<CronJobSqlRecord, [number, string, number]>(
      `
			UPDATE cron_jobs
			SET
				last_run_date = ?,
				last_run_status = 'InProgress',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id IN (
				SELECT id
				FROM cron_jobs
				WHERE schedule = ?
					AND enabled = 1
					AND deleted_at IS NULL
					AND (
						last_run_date IS NULL
						OR last_run_date < ?
					)
			)
			RETURNING
				id,
				project_id AS projectId,
				worktree_path AS worktreePath,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort AS reasoningEffort,
				github_access AS githubAccess,
				agents_access AS agentsAccess,
				metidos_access AS metidosAccess,
				unsafe_mode AS unsafeMode,
				last_run_date AS lastRunDate,
				last_run_status AS lastRunStatus,
				enabled,
				deleted_at AS deletedAt,
				created_at AS createdAt,
				updated_at AS updatedAt
		`,
    )
    .all(runDate, schedule, runDate);
  return rows.map((cronJob) => hydrateCronJobFromSqlRow(cronJob, false));
}

/**
 * Claims a specific cron job for execution and marks it in progress.
 */
export function claimCronJobForScheduledRunById(
  database: Database,
  cronJobId: number,
  runDate: number,
): CronJobRecord[] {
  const rows = database
    .query<CronJobSqlRecord, [number, number, number]>(
      `
			UPDATE cron_jobs
			SET
				last_run_date = ?,
				last_run_status = 'InProgress',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND enabled = 1
				AND deleted_at IS NULL
				AND (
					last_run_date IS NULL
					OR last_run_date < ?
				)
			RETURNING
				id,
				project_id AS projectId,
				worktree_path AS worktreePath,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort AS reasoningEffort,
				github_access AS githubAccess,
				agents_access AS agentsAccess,
				metidos_access AS metidosAccess,
				unsafe_mode AS unsafeMode,
				last_run_date AS lastRunDate,
				last_run_status AS lastRunStatus,
				enabled,
				deleted_at AS deletedAt,
				created_at AS createdAt,
				updated_at AS updatedAt
		`,
    )
    .all(runDate, cronJobId, runDate);

  return rows.map((cronJob) => hydrateCronJobFromSqlRow(cronJob, false));
}

/**
 * Creates a cron job run row.
 * @param database - Database handle used to create a cron run record.
 * @param input - Input row.
 */
export function createCronJobRun(
  database: Database,
  input: CronJobRunInput,
): CronJobRunRecord {
  const result = runStatement(
    database,
    `
			INSERT INTO cron_job_runs (
				cron_job_id,
				thread_id,
				run_date,
				run_status
			)
			VALUES (?, ?, ?, ?)
		`,
    input.cronJobId,
    input.threadId,
    input.runDate,
    input.runStatus,
  );
  const runId = Number(result.lastInsertRowid);
  const runRow = getCronJobRunById(database, runId);
  if (!runRow) {
    throw new Error(
      `Failed to create cron job run for cronJobId ${input.cronJobId}`,
    );
  }
  return runRow;
}

/**
 * Reads a cron job run by id.
 * @param database - Database handle used to fetch cron run details.
 * @param runId - Run identifier.
 */
export function getCronJobRunById(
  database: Database,
  runId: number,
): CronJobRunRecord | null {
  /** Read a single run row by primary key. */
  return database
    .query<CronJobRunRecord, [number]>(
      `
			SELECT
				id,
				cron_job_id AS cronJobId,
				thread_id AS threadId,
				run_date AS runDate,
				run_status AS runStatus
			FROM cron_job_runs
			WHERE id = ?
		`,
    )
    .get(runId);
}

/**
 * Updates cron job run status.
 * @param database - Database handle used to update cron run status.
 * @param runId - Run identifier.
 * @param status - New status.
 */
export function updateCronJobRunStatus(
  database: Database,
  runId: number,
  status: CronJobRunStatus,
): void {
  /** Persist terminal run status for scheduler history. */
  runStatement(
    database,
    `
			UPDATE cron_job_runs
			SET run_status = ?
			WHERE id = ?
		`,
    status,
    runId,
  );
}

/**
 * Lists run rows for a specific cron job.
 * @param database - Database handle used to list cron run history.
 * @param cronJobId - Cron job identifier.
 */
export function listCronJobRuns(
  database: Database,
  cronJobId: number,
): CronJobRunRecord[] {
  /** Return run history newest-first for inspection and analytics. */
  return database
    .query<CronJobRunRecord, [number]>(
      `
			SELECT
				id,
				cron_job_id AS cronJobId,
				thread_id AS threadId,
				run_date AS runDate,
				run_status AS runStatus
			FROM cron_job_runs
			WHERE cron_job_id = ?
			ORDER BY run_date DESC, id DESC
		`,
    )
    .all(cronJobId);
}
