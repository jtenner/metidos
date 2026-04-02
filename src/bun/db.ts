import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const APP_NAME = ".jolt";
const DB_FILE_NAME = "app.db";
export const DEFAULT_THREAD_MODEL = "gpt-5.4";
export const DEFAULT_THREAD_REASONING_EFFORT = "medium";
let appDatabase: Database | null = null;

type ProjectInput = {
  projectPath: string;
  name?: string | null;
};

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
  | "tool_call";

type ThreadActivityInput = {
  threadId: number;
  itemId: string;
  role?: "assistant" | "user";
  kind: ThreadActivityKind;
  text: string;
  state: string | null;
  payloadJson?: string | null;
};

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
const TEMP_APP_DATA_DIR = join(tmpdir(), APP_NAME);
let resolvedAppDataDir: string | null = null;

function runStatement(
  database: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): ReturnType<Database["run"]> {
  return bindings.length === 0
    ? database.run(sql)
    : database.run(sql, bindings);
}

function ensureAppDirectory(appDataPath: string): void {
  if (!existsSync(appDataPath)) {
    mkdirSync(appDataPath, { recursive: true });
  }
}

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

function resolveAppDataDirectory(): string {
  if (resolvedAppDataDir) {
    return resolvedAppDataDir;
  }

  const configuredAppDataDir = process.env.JOLT_APP_DATA_DIR?.trim();
  const candidates = [
    configuredAppDataDir || null,
    DEFAULT_APP_DATA_DIR,
    TEMP_APP_DATA_DIR,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!isWritableDirectory(candidate)) {
      continue;
    }
    resolvedAppDataDir = candidate;
    return candidate;
  }

  throw new Error(
    [
      "Unable to find a writable application data directory.",
      configuredAppDataDir
        ? `Checked JOLT_APP_DATA_DIR=${configuredAppDataDir}, ${DEFAULT_APP_DATA_DIR}, and ${TEMP_APP_DATA_DIR}.`
        : `Checked ${DEFAULT_APP_DATA_DIR} and ${TEMP_APP_DATA_DIR}.`,
    ].join(" "),
  );
}

function tableHasColumn(
  db: Database,
  tableName: string,
  columnName: string,
): boolean {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureThreadColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  if (!tableHasColumn(db, "threads", columnName)) {
    runStatement(db, `ALTER TABLE threads ADD COLUMN ${columnDefinition}`);
  }
}

function ensureThreadMessageColumn(
  db: Database,
  columnName: string,
  columnDefinition: string,
): void {
  if (!tableHasColumn(db, "thread_messages", columnName)) {
    runStatement(
      db,
      `ALTER TABLE thread_messages ADD COLUMN ${columnDefinition}`,
    );
  }
}

function migrate(db: Database): void {
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
}

export function getAppDatabasePath(): string {
  return resolve(resolveAppDataDirectory(), DB_FILE_NAME);
}

export function initAppDatabase(): Database {
  if (appDatabase) {
    return appDatabase;
  }

  const dbPath = getAppDatabasePath();
  const appDataPath = dirname(dbPath);
  ensureAppDirectory(appDataPath);

  const db = new Database(dbPath);
  runStatement(db, "PRAGMA foreign_keys = ON");
  migrate(db);
  appDatabase = db;
  return db;
}

export function getProject(
  database: Database,
  projectPath: string,
): ProjectRecord | null {
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

export function getProjectById(
  database: Database,
  projectId: number,
): ProjectRecord | null {
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

export function listProjects(database: Database): ProjectRecord[] {
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

export function upsertProject(
  database: Database,
  input: ProjectInput,
): ProjectRecord {
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

export function listOpenProjects(database: Database): ProjectRecord[] {
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

export function setProjectClosed(database: Database, projectId: number): void {
  runStatement(
    database,
    `UPDATE projects SET is_open = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    projectId,
  );
}

export function deleteProject(database: Database, projectId: number): void {
  runStatement(database, "DELETE FROM projects WHERE id = ?", projectId);
}

export function listProjectWorktreePins(
  database: Database,
  projectId: number,
): ProjectWorktreePinRecord[] {
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

export function setProjectWorktreePinned(
  database: Database,
  projectId: number,
  worktreePath: string,
  pinned: boolean,
): void {
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

export function listThreads(database: Database): ThreadRecord[] {
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

export function getThreadById(
  database: Database,
  threadId: number,
): ThreadRecord | null {
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

export function createThread(
  database: Database,
  input: ThreadInput,
): ThreadRecord {
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

export function updateThreadCodexId(
  database: Database,
  threadId: number,
  codexThreadId: string,
): void {
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

export function renameThread(
  database: Database,
  threadId: number,
  title: string,
  summary?: string | null,
): void {
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

export function setThreadModel(
  database: Database,
  threadId: number,
  model: string,
): void {
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

export function setThreadReasoningEffort(
  database: Database,
  threadId: number,
  reasoningEffort: string,
): void {
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

export function setThreadUnsafeMode(
  database: Database,
  threadId: number,
  unsafeMode: boolean,
): void {
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

export function setThreadPinned(
  database: Database,
  threadId: number,
  pinned: boolean,
): void {
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

export function deleteThread(database: Database, threadId: number): void {
  runStatement(database, "DELETE FROM threads WHERE id = ?", threadId);
}

export function markThreadRan(database: Database, threadId: number): void {
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

export function markThreadRunStarted(
  database: Database,
  threadId: number,
  startedAt: string,
): void {
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

export function markThreadStopped(
  database: Database,
  threadId: number,
  message: string,
): void {
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

export function setThreadUsage(
  database: Database,
  threadId: number,
  usage: ThreadUsageInput,
  compactionStats: ThreadCompactionStatsInput,
): void {
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

export function markThreadFailed(
  database: Database,
  threadId: number,
  errorMessage: string,
): void {
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

export function markThreadErrorSeen(
  database: Database,
  threadId: number,
): void {
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

export function listThreadsWithInProgressMessages(
  database: Database,
): InProgressThreadMessageRecord[] {
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

export function listThreadMessages(
  database: Database,
  threadId: number,
): ThreadMessageRecord[] {
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

export function createThreadMessage(
  database: Database,
  input: ThreadMessageInput,
): ThreadMessageRecord {
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

export function upsertThreadActivity(
  database: Database,
  input: ThreadActivityInput,
): void {
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
    .get(input.threadId, input.itemId);

  if (existing) {
    runStatement(
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
      existing.id,
    );
  } else {
    runStatement(
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
  }
}

export function stopInProgressThreadMessages(
  database: Database,
  threadId: number,
): void {
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
