/**
 * @file src/bun/db-context.ts
 * @description App Data path, SQLite file, and runtime pragma helpers for the concrete app database.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const APP_NAME = ".metidos";
const DB_FILE_NAME = "app.db";

/** Default SQLite lock-retry timeout for write contention handling. */
export const SQL_BUSY_TIMEOUT_MS = 2500;
/** Preferred SQLite journal mode for the multi-connection Metidos runtime. */
export const APP_DATABASE_JOURNAL_MODE = "wal";
/** Preferred SQLite synchronous mode paired with WAL in the Metidos runtime. */
export const APP_DATABASE_SYNCHRONOUS = "NORMAL";
const TEST_APP_DATABASE_JOURNAL_MODE = "delete";
const TEST_APP_DATABASE_SYNCHRONOUS = "FULL";

export type AppDataPathOptions = {
  appDataDir?: string;
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

let resolvedAppDataDir: string | null = null;

/** Create folder if it doesn't exist before opening DB files. */
function applyOwnerOnlyDirectoryPermissions(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}

function chmodCreatedDirectoryTree(
  firstCreatedPath: string,
  leafPath: string,
): void {
  const firstCreated = resolve(firstCreatedPath);
  const leaf = resolve(leafPath);
  const relativeLeaf = relative(firstCreated, leaf);
  if (
    relativeLeaf === ".." ||
    relativeLeaf.startsWith(`..${sep}`) ||
    relativeLeaf === ""
  ) {
    applyOwnerOnlyDirectoryPermissions(leaf);
    return;
  }

  applyOwnerOnlyDirectoryPermissions(firstCreated);
  let current = firstCreated;
  for (const segment of relativeLeaf.split(sep)) {
    if (!segment) {
      continue;
    }
    current = join(current, segment);
    applyOwnerOnlyDirectoryPermissions(current);
  }
}

export function ensureAppDirectory(appDataPath: string): void {
  const createdPath = !existsSync(appDataPath)
    ? mkdirSync(appDataPath, {
        recursive: true,
        mode: 0o700,
      })
    : undefined;
  if (createdPath) {
    chmodCreatedDirectoryTree(createdPath, appDataPath);
    return;
  }
  applyOwnerOnlyDirectoryPermissions(appDataPath);
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

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}

function assertRegularAppDataFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      `Refusing to use App Data file because it is not a regular file: ${path}`,
    );
  }
}

export function assertAppDatabaseFilesAreRegular(dbPath: string): void {
  // Check SQLite sidecars as well as app.db. WAL/SHM/journal files can contain
  // database pages, so they get the same symlink/special-file rejection before
  // chmod hardening and database open paths rely on them.
  for (const path of [
    dbPath,
    `${dbPath}-journal`,
    `${dbPath}-shm`,
    `${dbPath}-wal`,
  ]) {
    assertRegularAppDataFile(path);
  }
}

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
    ? `Checked METIDOS_APP_DATA_DIR=${options.configuredAppDataDir} and ${options.defaultAppDataDir}.`
    : `Checked ${options.defaultAppDataDir}.`;
  throw new Error(
    [
      "Unable to find a writable application data directory.",
      checkedPaths,
      "Set METIDOS_APP_DATA_DIR to an explicit writable application data directory if the default location is unavailable.",
    ].join(" "),
  );
}

function resolveAppDataDirectory(): string {
  if (resolvedAppDataDir) {
    return resolvedAppDataDir;
  }

  const configuredAppDataDir = process.env.METIDOS_APP_DATA_DIR?.trim();
  resolvedAppDataDir = selectWritableAppDataDirectory({
    configuredAppDataDir,
    defaultAppDataDir: DEFAULT_APP_DATA_DIR,
  });
  return resolvedAppDataDir;
}

export function getAppDataDirectoryPath(options?: AppDataPathOptions): string {
  return options?.appDataDir ?? resolveAppDataDirectory();
}

export function resetResolvedAppDataDirectory(): void {
  resolvedAppDataDir = null;
}

export function getAppDatabasePath(options?: AppDataPathOptions): string {
  const configuredDatabasePath = process.env.METIDOS_APP_DATABASE_PATH?.trim();
  if (!options?.appDataDir && configuredDatabasePath) {
    return configuredDatabasePath;
  }
  return resolve(getAppDataDirectoryPath(options), DB_FILE_NAME);
}

export function isInMemoryAppDatabasePath(dbPath: string): boolean {
  return dbPath === ":memory:" || /[?&]mode=memory(?:&|$)/.test(dbPath);
}

export function deleteAppDatabaseFiles(options?: AppDataPathOptions): string[] {
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

export function resolveAppDatabaseRuntimePragmas(
  env: NodeJS.ProcessEnv = process.env,
): {
  journalMode: string;
  synchronous: string;
} {
  if (env.NODE_ENV === "test") {
    return {
      journalMode: TEST_APP_DATABASE_JOURNAL_MODE,
      synchronous: TEST_APP_DATABASE_SYNCHRONOUS,
    };
  }

  return {
    journalMode: APP_DATABASE_JOURNAL_MODE,
    synchronous: APP_DATABASE_SYNCHRONOUS,
  };
}

export function applyAppDatabasePragmas(
  database: Database,
  runStatement: (
    database: Database,
    sql: string,
    ...bindings: SQLQueryBindings[]
  ) => unknown,
  options?: {
    busyTimeoutMs?: number | null;
    journalMode?: string | null;
    synchronous?: string | null;
  },
): void {
  const pragmas = resolveAppDatabaseRuntimePragmas();
  const journalMode = options?.journalMode ?? pragmas.journalMode;
  const synchronous = options?.synchronous ?? pragmas.synchronous;

  runStatement(database, "PRAGMA foreign_keys = ON");
  if (typeof options?.busyTimeoutMs === "number") {
    runStatement(database, `PRAGMA busy_timeout = ${options.busyTimeoutMs}`);
  }
  runStatement(database, `PRAGMA journal_mode = ${journalMode.toUpperCase()}`);
  runStatement(database, `PRAGMA synchronous = ${synchronous}`);
}

export function getAppDatabaseDirectoryPath(
  options?: AppDataPathOptions,
): string {
  const dbPath = getAppDatabasePath(options);
  if (isInMemoryAppDatabasePath(dbPath)) {
    return getAppDataDirectoryPath(options);
  }
  return dirname(dbPath);
}

export function applyAppDatabasePermissions(dbPath: string): void {
  assertAppDatabaseFilesAreRegular(dbPath);
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
