/**
 * @file src/bun/project-store.ts
 * @description Concrete SQLite store for Project and Worktree persistence.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";

export type ProjectInput = {
  projectPath: string;
  name?: string | null;
};

/** Public DB shape for project rows returned from queries. */
export type ProjectRecord = {
  id: number;
  path: string;
  name: string;
  gitRemote: string | null;
  isOpen: 1 | 0;
  faviconDataUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

export type ProjectWorktreeRecord = {
  projectId: number;
  worktreePath: string;
  pinnedAt: string | null;
};

const PROJECT_COLUMNS = `
	id,
	path,
	name,
	git_remote AS gitRemote,
	is_open AS isOpen,
	favicon_data_url AS faviconDataUrl,
	created_at AS createdAt,
	updated_at AS updatedAt,
	last_opened_at AS lastOpenedAt
`;

function runStatement(
  database: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): ReturnType<Database["run"]> {
  return bindings.length === 0
    ? database.run(sql)
    : database.run(sql, bindings);
}

export function getProject(
  database: Database,
  projectPath: string,
): ProjectRecord | null {
  return database
    .query<ProjectRecord, [string]>(
      `
			SELECT ${PROJECT_COLUMNS}
			FROM projects
			WHERE path = ?
				AND deleted_at IS NULL
			ORDER BY last_opened_at DESC, id DESC
			LIMIT 1
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
			SELECT ${PROJECT_COLUMNS}
			FROM projects
			WHERE id = ?
				AND deleted_at IS NULL
		`,
    )
    .get(projectId);
}

export function listProjects(database: Database): ProjectRecord[] {
  return database
    .query<ProjectRecord, []>(
      `
			SELECT ${PROJECT_COLUMNS}
			FROM projects
			WHERE deleted_at IS NULL
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
			INSERT INTO projects (
				path,
				name,
				is_open,
				last_opened_at,
				updated_at
			)
			VALUES (
				?,
				?,
				1,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			)
			ON CONFLICT(path) DO UPDATE SET
				name = excluded.name,
				is_open = 1,
				deleted_at = NULL,
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
			SELECT ${PROJECT_COLUMNS}
			FROM projects
			WHERE is_open = 1
				AND deleted_at IS NULL
			ORDER BY last_opened_at DESC
		`,
    )
    .all();
}

export function setProjectFaviconDataUrl(
  database: Database,
  projectId: number,
  faviconDataUrl: string,
): void {
  runStatement(
    database,
    `
			UPDATE projects
			SET
				favicon_data_url = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND deleted_at IS NULL
		`,
    faviconDataUrl,
    projectId,
  );
}

export function setProjectClosed(database: Database, projectId: number): void {
  runStatement(
    database,
    `
			UPDATE projects
			SET
				is_open = 0,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND deleted_at IS NULL
		`,
    projectId,
  );
}

export function deleteProject(database: Database, projectId: number): void {
  // Project deletion is intentionally a soft-delete for projects, threads, and
  // cron jobs so historical thread_messages remain attached to their soft-
  // deleted thread rows for audit/export purposes. There is no orphaned-message
  // cleanup here because message retention is a product/data-retention policy,
  // not part of hiding a project from active lists. `deleted_at` remains an
  // epoch-milliseconds tombstone for active-list indexes and comparisons,
  // separate from the ISO-8601 human-facing updated/created timestamps.
  database.transaction(() => {
    runStatement(
      database,
      `
			UPDATE projects
			SET
				deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				is_open = 0,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
      projectId,
    );
    runStatement(
      database,
      `
			UPDATE threads
			SET
				deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE project_id = ?
				AND deleted_at IS NULL
		`,
      projectId,
    );
    runStatement(
      database,
      `
			UPDATE cron_jobs
			SET
				deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				enabled = 0,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE project_id = ?
				AND deleted_at IS NULL
		`,
      projectId,
    );
  })();
}

export function listProjectWorktreesMetadata(
  database: Database,
  projectId: number,
): ProjectWorktreeRecord[] {
  return database
    .query<ProjectWorktreeRecord, [number]>(
      `
			SELECT
				project_id AS projectId,
				worktree_path AS worktreePath,
				pinned_at AS pinnedAt
			FROM project_worktrees
			WHERE project_id = ?
			ORDER BY
				(pinned_at IS NULL) ASC,
				pinned_at DESC,
				worktree_path ASC
		`,
    )
    .all(projectId);
}

export function ensureProjectWorktreeVisible(
  database: Database,
  projectId: number,
  worktreePath: string,
): void {
  runStatement(
    database,
    `
			INSERT INTO project_worktrees (
				project_id,
				worktree_path,
				pinned_at
			)
			VALUES (?, ?, NULL)
			ON CONFLICT(project_id, worktree_path) DO NOTHING
		`,
    projectId,
    worktreePath,
  );
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
			UPDATE project_worktrees
			SET pinned_at = NULL
			WHERE project_id = ? AND worktree_path = ?
		`,
    projectId,
    worktreePath,
  );
}
