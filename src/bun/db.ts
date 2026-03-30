import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const APP_NAME = ".jt-ide";
const DB_FILE_NAME = "app.db";
let appDatabase: Database | null = null;

type ProjectInput = {
	projectPath: string;
	name?: string | null;
};

type ThreadInput = {
	projectId: number;
	worktreePath: string;
	title: string;
	codexThreadId?: string | null;
};

type ThreadMessageInput = {
	threadId: number;
	role: "assistant" | "user";
	text: string;
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
	codexThreadId: string | null;
	createdAt: string;
	updatedAt: string;
	lastRunAt: string | null;
	lastErrorAt: string | null;
	lastErrorSeenAt: string | null;
	lastErrorMessage: string | null;
};

export type ThreadMessageRecord = {
	id: number;
	threadId: number;
	role: "assistant" | "user";
	text: string;
	createdAt: string;
};

const APP_DATA_DIR =
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

function ensureAppDirectory(appDataPath: string): void {
	if (!existsSync(appDataPath)) {
		mkdirSync(appDataPath, { recursive: true });
	}
}

function tableHasColumn(
	db: Database,
	tableName: string,
	columnName: string,
): boolean {
	return db
		.query<{ name: string }>(`PRAGMA table_info(${tableName})`)
		.all()
		.some((column) => column.name === columnName);
}

function ensureThreadColumn(
	db: Database,
	columnName: string,
	columnDefinition: string,
): void {
	if (!tableHasColumn(db, "threads", columnName)) {
		db.run(`ALTER TABLE threads ADD COLUMN ${columnDefinition}`);
	}
}

function migrate(db: Database): void {
	db.run(`
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
		`);
	db.run(`
			CREATE TABLE IF NOT EXISTS threads (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				worktree_path TEXT NOT NULL,
				title TEXT NOT NULL,
				codex_thread_id TEXT,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_run_at TEXT,
				last_error_at TEXT,
				last_error_seen_at TEXT,
				last_error_message TEXT
			);
		`);
	ensureThreadColumn(db, "last_error_at", "last_error_at TEXT");
	ensureThreadColumn(db, "last_error_seen_at", "last_error_seen_at TEXT");
	ensureThreadColumn(db, "last_error_message", "last_error_message TEXT");
	db.run(`
			CREATE TABLE IF NOT EXISTS thread_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
				role TEXT NOT NULL CHECK(role IN ('assistant', 'user')),
				text TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);
		`);
	db.run(`
			CREATE INDEX IF NOT EXISTS idx_threads_updated_at
			ON threads(updated_at DESC, id DESC);
		`);
	db.run(`
			CREATE INDEX IF NOT EXISTS idx_threads_project_id
			ON threads(project_id);
		`);
	db.run(`
			CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_id
			ON thread_messages(thread_id, id);
		`);
}

export function getAppDatabasePath(): string {
	return resolve(APP_DATA_DIR, DB_FILE_NAME);
}

export function initAppDatabase(): Database {
	if (appDatabase) {
		return appDatabase;
	}

	const dbPath = getAppDatabasePath();
	const appDataPath = dirname(dbPath);
	ensureAppDirectory(appDataPath);

	const db = new Database(dbPath);
	db.run("PRAGMA foreign_keys = ON");
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
		.query<ProjectRecord>(
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
	database.run(
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
		.query<ProjectRecord>(
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
	database.run(
		`UPDATE projects SET is_open = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
		projectId,
	);
}

export function deleteProject(database: Database, projectId: number): void {
	database.run("DELETE FROM projects WHERE id = ?", projectId);
}

export function listThreads(database: Database): ThreadRecord[] {
	return database
		.query<ThreadRecord>(
			`
				SELECT
					id,
					project_id AS projectId,
					worktree_path AS worktreePath,
					title,
					codex_thread_id AS codexThreadId,
					created_at AS createdAt,
					updated_at AS updatedAt,
					last_run_at AS lastRunAt,
					last_error_at AS lastErrorAt,
					last_error_seen_at AS lastErrorSeenAt,
					last_error_message AS lastErrorMessage
				FROM threads
				ORDER BY updated_at DESC, created_at DESC, id DESC
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
					codex_thread_id AS codexThreadId,
					created_at AS createdAt,
					updated_at AS updatedAt,
					last_run_at AS lastRunAt,
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
	const result = database.run(
		`
			INSERT INTO threads (
				project_id,
				worktree_path,
				title,
				codex_thread_id,
				updated_at
			)
			VALUES (
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
	database.run(
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

export function markThreadRan(database: Database, threadId: number): void {
	database.run(
		`
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_error_at = NULL,
				last_error_seen_at = NULL,
				last_error_message = NULL
			WHERE id = ?
		`,
		threadId,
	);
}

export function markThreadFailed(
	database: Database,
	threadId: number,
	errorMessage: string,
): void {
	database.run(
		`
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
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
	database.run(
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

export function touchThread(database: Database, threadId: number): void {
	database.run(
		`
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
		threadId,
	);
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
					text,
					created_at AS createdAt
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
	const result = database.run(
		`
			INSERT INTO thread_messages (thread_id, role, text)
			VALUES (?, ?, ?)
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
					text,
					created_at AS createdAt
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
