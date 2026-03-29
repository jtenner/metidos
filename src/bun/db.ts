import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const APP_NAME = ".jt-ide";
const DB_FILE_NAME = "app.db";
let appDatabase: Database | null = null;

type ProjectInput = {
	projectPath: string;
	name?: string | null;
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
		Bun.mkdirSync(appDataPath, { recursive: true });
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
