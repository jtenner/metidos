/**
 * @file src/bun/sync-core-plugins.ts
 * @description Local-development sync from repo core_plugins/ into app-data plugins/.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { getAppDataDirectoryPath } from "./db";
import { getPluginsDirectoryPath } from "./plugin/discovery";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const CORE_PLUGINS_DIRECTORY = join(REPO_ROOT, "core_plugins");
const PRESERVED_DIRECTORY_NAMES = new Set([".data", ".logs", "node_modules"]);

function isPreservedRuntimeDirectory(name: string): boolean {
  return PRESERVED_DIRECTORY_NAMES.has(name) || name.startsWith(".data-bak-");
}

function assertManagedDirectoryIsNotSymlink(path: string, label: string): void {
  if (!existsSync(path)) {
    return;
  }
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Refusing to sync core plugins because ${label} is not a regular directory: ${path}`,
    );
  }
}

function clearManagedDestination(destinationDirectory: string): void {
  if (!existsSync(destinationDirectory)) {
    return;
  }
  for (const entry of readdirSync(destinationDirectory, {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && isPreservedRuntimeDirectory(entry.name)) {
      continue;
    }
    rmSync(join(destinationDirectory, entry.name), {
      force: true,
      recursive: true,
    });
  }
}

function copyManagedFiles(
  sourceDirectory: string,
  destinationDirectory: string,
): void {
  assertManagedDirectoryIsNotSymlink(
    destinationDirectory,
    "plugin destination",
  );
  mkdirSync(destinationDirectory, { mode: 0o700, recursive: true });
  assertManagedDirectoryIsNotSymlink(
    destinationDirectory,
    "plugin destination",
  );
  chmodSync(destinationDirectory, 0o700);
  clearManagedDestination(destinationDirectory);

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (isPreservedRuntimeDirectory(entry.name)) {
      continue;
    }
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      copyManagedFiles(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    mkdirSync(resolve(destinationPath, ".."), { mode: 0o700, recursive: true });
    copyFileSync(sourcePath, destinationPath);
    const mode = statSync(sourcePath).mode & 0o777;
    chmodSync(destinationPath, mode || 0o600);
  }
}

function syncCorePlugins(): void {
  const appDataDirectory = getAppDataDirectoryPath();
  const pluginsDirectory = getPluginsDirectoryPath({
    appDataDir: appDataDirectory,
  });
  if (!existsSync(CORE_PLUGINS_DIRECTORY)) {
    return;
  }
  assertManagedDirectoryIsNotSymlink(pluginsDirectory, "plugins directory");
  mkdirSync(pluginsDirectory, { mode: 0o700, recursive: true });
  assertManagedDirectoryIsNotSymlink(pluginsDirectory, "plugins directory");
  chmodSync(pluginsDirectory, 0o700);

  for (const entry of readdirSync(CORE_PLUGINS_DIRECTORY, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceDirectory = join(CORE_PLUGINS_DIRECTORY, entry.name);
    const destinationDirectory = join(pluginsDirectory, entry.name);
    copyManagedFiles(sourceDirectory, destinationDirectory);
    console.log(
      `Synced core plugin ${entry.name} to ${relative(process.cwd(), destinationDirectory) || basename(destinationDirectory)}`,
    );
  }
}

syncCorePlugins();
