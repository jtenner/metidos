#!/usr/bin/env bun
/**
 * Copy a host Metidos app-data directory into a container /data directory and
 * prune it to the project paths explicitly kept for the Podman migration.
 */

import { Database } from "bun:sqlite";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

type Options = {
  force: boolean;
  oldAppDataPath: string;
  source: string;
  target: string;
};

const KEEP_PROJECT_PATHS = (process.env.METIDOS_MIGRATE_KEEP_PROJECT_PATHS ?? "")
  .split(/[\n,]/)
  .map((path) => path.trim())
  .filter((path) => path.length > 0);

function usage(): string {
  return [
    "Usage:",
    "  bun run deploy/podman/migrate-app-data.ts --source <path> --target <path> [--force]",
    "",
    "Defaults used by this repository:",
    "  --source /source",
    "  --target /data",
    "  --old-app-data-path /home/metidos/.local/share/.metidos",
  ].join("\n");
}

function readOptions(argv: string[]): Options {
  const options: Options = {
    force: false,
    oldAppDataPath: "/home/metidos/.local/share/.metidos",
    source: "/source",
    target: "/data",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}.\n${usage()}`);
    }
    if (arg === "--source") {
      options.source = next;
      index += 1;
      continue;
    }
    if (arg === "--target") {
      options.target = next;
      index += 1;
      continue;
    }
    if (arg === "--old-app-data-path") {
      options.oldAppDataPath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return {
    ...options,
    oldAppDataPath: resolve(options.oldAppDataPath),
    source: resolve(options.source),
    target: resolve(options.target),
  };
}

function ensureReadableSource(source: string): void {
  const dbPath = join(source, "app.db");
  if (!existsSync(dbPath)) {
    throw new Error(`Source app database not found: ${dbPath}`);
  }
  if (!statSync(source).isDirectory()) {
    throw new Error(`Source is not a directory: ${source}`);
  }
}

function emptyDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(path)) {
    rmSync(join(path, entry), { force: true, recursive: true });
  }
}

function copyAppData(options: Options): void {
  ensureReadableSource(options.source);
  if (options.source === options.target) {
    throw new Error("Source and target app-data paths must be different.");
  }
  if (existsSync(join(options.target, "app.db")) && !options.force) {
    throw new Error(
      `Target already contains app.db: ${options.target}. Re-run with --force to replace the target copy.`,
    );
  }
  emptyDirectory(options.target);
  cpSync(options.source, options.target, {
    dereference: false,
    errorOnExist: false,
    force: true,
    preserveTimestamps: true,
    recursive: true,
  });
  chmodSync(options.target, 0o700);
  mkdirSync(join(options.target, "plugins", "codex", ".data"), {
    recursive: true,
    mode: 0o700,
  });
}

function run(database: Database, sql: string, ...bindings: unknown[]): void {
  database.run(sql, bindings);
}

function scalar(
  database: Database,
  sql: string,
  ...bindings: unknown[]
): number {
  const row = database.query(sql).get(...bindings) as
    | { value?: unknown }
    | null
    | undefined;
  return typeof row?.value === "number" ? row.value : 0;
}

function pruneDatabase(options: Options): Set<number> {
  const dbPath = join(options.target, "app.db");
  const database = new Database(dbPath);
  try {
    database.run("PRAGMA foreign_keys = ON");
    database.run("PRAGMA wal_checkpoint(TRUNCATE)");
    database.run("BEGIN IMMEDIATE");
    try {
      database.run("CREATE TEMP TABLE keep_projects(id INTEGER PRIMARY KEY)");
      for (const projectPath of KEEP_PROJECT_PATHS) {
        run(
          database,
          "INSERT OR IGNORE INTO keep_projects(id) SELECT id FROM projects WHERE path = ? AND deleted_at IS NULL",
          projectPath,
        );
      }
      const keepProjectCount = scalar(
        database,
        "SELECT COUNT(*) AS value FROM keep_projects",
      );
      if (keepProjectCount !== KEEP_PROJECT_PATHS.length) {
        throw new Error(
          `Expected ${KEEP_PROJECT_PATHS.length} kept projects, found ${keepProjectCount}.`,
        );
      }

      run(
        database,
        "DELETE FROM projects WHERE id NOT IN (SELECT id FROM keep_projects)",
      );
      run(
        database,
        `
          DELETE FROM security_audit_events
          WHERE (project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects))
            OR (thread_id IS NOT NULL AND thread_id NOT IN (SELECT id FROM threads))
            OR (worktree_path IS NOT NULL AND worktree_path NOT LIKE '/home/metidos/Projects/%')
        `,
      );
      run(
        database,
        `
          UPDATE threads
          SET pi_session_file = replace(pi_session_file, ?, '/data')
          WHERE pi_session_file LIKE ?
        `,
        options.oldAppDataPath,
        `${options.oldAppDataPath}/%`,
      );
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }

    database.run("VACUUM");
    database.run("PRAGMA journal_mode = WAL");
    const rows = database
      .query("SELECT id FROM threads WHERE deleted_at IS NULL")
      .all() as { id: number }[];
    return new Set(rows.map((row) => row.id));
  } finally {
    database.close();
  }
}

function pruneThreadSessions(target: string, keepThreadIds: Set<number>): void {
  const threadSessionsPath = join(target, "pi-agent", "thread-sessions");
  if (!existsSync(threadSessionsPath)) {
    return;
  }
  for (const entry of readdirSync(threadSessionsPath, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || !entry.name.startsWith("thread-")) {
      continue;
    }
    const id = Number(entry.name.slice("thread-".length));
    if (Number.isInteger(id) && keepThreadIds.has(id)) {
      continue;
    }
    rmSync(join(threadSessionsPath, entry.name), {
      force: true,
      recursive: true,
    });
  }
}

function removeUnneededCopiedData(target: string): void {
  const removableNames = [
    "app.db.bak-20260411-legacy-user",
    "runtime-stats.db",
    "runtime-stats.db-shm",
    "runtime-stats.db-wal",
    "users",
  ];
  for (const name of removableNames) {
    rmSync(join(target, name), { force: true, recursive: true });
  }
}

function summarize(options: Options, keepThreadIds: Set<number>): void {
  console.log("Migrated Metidos app data.");
  console.log(`  Source: ${options.source}`);
  console.log(`  Target: ${options.target}`);
  console.log(`  Kept projects: ${KEEP_PROJECT_PATHS.length}`);
  console.log(`  Kept active threads: ${keepThreadIds.size}`);
  console.log(
    `  Codex auth mount target prepared: ${join(options.target, "plugins", "codex", ".data", "auth.json")}`,
  );
}

function main(): void {
  const options = readOptions(process.argv.slice(2));
  copyAppData(options);
  const keepThreadIds = pruneDatabase(options);
  pruneThreadSessions(options.target, keepThreadIds);
  removeUnneededCopiedData(options.target);
  summarize(options, keepThreadIds);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
