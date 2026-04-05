/**
 * @file src/bun/project-procedures/project-tasks.ts
 * @description Module for project tasks.
 */

import { readFileSync, realpathSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { RpcProjectTask } from "../rpc-schema";
import {
  safeIsDirectory,
  safeIsDirectoryAsync,
  safeIsFile,
  safeIsFileAsync,
} from "./shared";

export type TaskWatchTarget = {
  kind: "directory" | "tasks";
  path: string;
};

export type ResolvedProjectTaskExecution =
  | {
      kind: "file";
      prompt: string;
    }
  | {
      kind: "script";
      task: {
        packageJsonPath: string;
        packageDirectory: string;
        scriptName: string;
        command: string;
      };
    };

function tasksDirectoryPath(worktreePath: string): string {
  return resolve(worktreePath, ".tasks");
}

/**
 * Normalize task paths so callers can pass loose input safely.
 */
function normalizeRelativeTaskPath(taskPath: string): string {
  return taskPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function pathEscapesRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  if (!relativePath) {
    return false;
  }

  return (
    relativePath === ".." ||
    relativePath.split(/[\\/]/).includes("..") ||
    isAbsolute(relativePath)
  );
}

async function safeRealPathInsideRootAsync(
  rootRealPath: string,
  candidatePath: string,
): Promise<boolean> {
  try {
    const realCandidatePath = await realpath(candidatePath);
    return !pathEscapesRoot(rootRealPath, realCandidatePath);
  } catch {
    return false;
  }
}

function assertRealPathInsideRoot(
  rootPath: string,
  candidatePath: string,
  errorMessage: string,
): void {
  const realRootPath = realpathSync(rootPath);
  const realCandidatePath = realpathSync(candidatePath);
  if (pathEscapesRoot(realRootPath, realCandidatePath)) {
    throw new Error(errorMessage);
  }
}

/**
 * Convert `.tasks` file path to a user-facing title.
 */
export function taskTitleFromPath(taskPath: string): string {
  return taskPath.replace(/\.[^./\\]+$/, "").replace(/\\/g, "/");
}

/**
 * Build the user prompt for file-backed tasks.
 */
export function formatTaskPrompt(
  taskTitle: string,
  taskContent: string,
): string {
  return `Your job is to perform the task: ${taskTitle}\n${taskContent.trim()}\n\nDo this now.`;
}

/**
 * Build the user prompt for package.json script tasks.
 */
export function formatPackageScriptTaskPrompt(task: {
  packageJsonPath: string;
  packageDirectory: string;
  scriptName: string;
  command: string;
}): string {
  return [
    `Your job is to run the package script "${task.scriptName}".`,
    `package.json: ${task.packageJsonPath}`,
    `Working directory: ${task.packageDirectory}`,
    `Run command: bun run ${task.scriptName}`,
    `Script definition: ${task.command}`,
    "",
    "Inspect the repository as needed, then run this task now and address any issues required to get it passing.",
  ].join("\n");
}

/**
 * Skip directories that should not be traversed for task discovery.
 */
function isIgnoredPackageDirectory(name: string): boolean {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === ".next" ||
    name === ".turbo" ||
    name === ".yarn" ||
    name === "dist" ||
    name === "build"
  );
}

function sortDirectoryEntries<
  Entry extends {
    name: string;
  },
>(values: Entry[]): Entry[] {
  /**
   * Locale-aware numeric sort keeps human-friendly ordering (e.g. task-2 before task-10).
   */
  return [...values].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

async function safeDirectoryRealPathAsync(
  path: string,
): Promise<string | null> {
  if (!(await safeIsDirectoryAsync(path))) {
    return null;
  }

  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/**
 * Visit a directory exactly once using real path tracking; reject paths outside the root subtree.
 */
async function visitDirectoryOnceAsync(
  path: string,
  visitedRealPaths: Set<string>,
  rootRealPath: string,
): Promise<boolean> {
  const realPath = await safeDirectoryRealPathAsync(path);
  if (!realPath) {
    return false;
  }

  const relativeRealPath = relative(rootRealPath, realPath);
  if (
    relativeRealPath !== "" &&
    (relativeRealPath.startsWith("..") || isAbsolute(relativeRealPath))
  ) {
    return false;
  }

  if (visitedRealPaths.has(realPath)) {
    return false;
  }

  visitedRealPaths.add(realPath);
  return true;
}

async function isDirectoryCandidate(
  entry: {
    isDirectory: () => boolean;
  },
  fullPath: string,
): Promise<boolean> {
  if (entry.isDirectory()) {
    return true;
  }

  return safeIsDirectoryAsync(fullPath);
}

/**
 * Candidate helper supports both Dirent-backed and symlink-resolved directories.
 */
async function isFileCandidate(
  entry: {
    isFile: () => boolean;
  },
  fullPath: string,
): Promise<boolean> {
  if (entry.isFile()) {
    return true;
  }

  return safeIsFileAsync(fullPath);
}

async function listProjectTaskFilesAsync(
  tasksDirectory: string,
  prefix = "",
  rootRealPath?: string | null,
  visitedRealPaths = new Set<string>(),
): Promise<RpcProjectTask[]> {
  const resolvedRootRealPath =
    rootRealPath ?? (await safeDirectoryRealPathAsync(tasksDirectory));
  if (!resolvedRootRealPath) {
    return [];
  }

  if (
    !(await visitDirectoryOnceAsync(
      tasksDirectory,
      visitedRealPaths,
      resolvedRootRealPath,
    ))
  ) {
    return [];
  }

  const tasks: RpcProjectTask[] = [];
  for (const entry of sortDirectoryEntries(
    (
      await readdir(tasksDirectory, {
        withFileTypes: true,
      })
    ).filter((value) => !value.name.startsWith(".")),
  )) {
    const fullPath = resolve(tasksDirectory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (await isDirectoryCandidate(entry, fullPath)) {
      tasks.push(
        ...(await listProjectTaskFilesAsync(
          fullPath,
          relativePath,
          resolvedRootRealPath,
          visitedRealPaths,
        )),
      );
      continue;
    }
    if (!(await isFileCandidate(entry, fullPath))) {
      continue;
    }
    if (!(await safeRealPathInsideRootAsync(resolvedRootRealPath, fullPath))) {
      continue;
    }
    tasks.push({
      id: `file:${relativePath.replace(/\\/g, "/")}`,
      kind: "file",
      path: relativePath.replace(/\\/g, "/"),
      title: taskTitleFromPath(relativePath),
      scriptName: null,
      command: null,
    });
  }

  return tasks;
}

async function listPackageJsonTasksAsync(
  rootDirectory: string,
  currentDirectory = rootDirectory,
  rootRealPath?: string | null,
  visitedRealPaths = new Set<string>(),
): Promise<RpcProjectTask[]> {
  const resolvedRootRealPath =
    rootRealPath ?? (await safeDirectoryRealPathAsync(rootDirectory));
  if (!resolvedRootRealPath) {
    return [];
  }

  if (
    !(await visitDirectoryOnceAsync(
      currentDirectory,
      visitedRealPaths,
      resolvedRootRealPath,
    ))
  ) {
    return [];
  }

  const tasks: RpcProjectTask[] = [];
  const entries = sortDirectoryEntries(
    await readdir(currentDirectory, {
      withFileTypes: true,
    }),
  );
  const packageJsonPath = resolve(currentDirectory, "package.json");
  if (
    entries.some((entry) => entry.name === "package.json") &&
    (await safeIsFileAsync(packageJsonPath)) &&
    (await safeRealPathInsideRootAsync(resolvedRootRealPath, packageJsonPath))
  ) {
    try {
      const parsed = JSON.parse(
        await readFile(packageJsonPath, "utf8"),
      ) as Partial<{
        scripts: Record<string, unknown>;
      }>;
      const scripts =
        parsed.scripts && typeof parsed.scripts === "object"
          ? parsed.scripts
          : null;
      if (scripts) {
        const relativePackageJsonPath =
          relative(rootDirectory, packageJsonPath).replace(/\\/g, "/") ||
          "package.json";
        for (const scriptName of Object.keys(scripts).sort((a, b) =>
          a.localeCompare(b),
        )) {
          const command = scripts[scriptName];
          if (typeof command !== "string" || !command.trim()) {
            continue;
          }
          tasks.push({
            id: `script:${relativePackageJsonPath}:${scriptName}`,
            kind: "script",
            path: relativePackageJsonPath,
            title: scriptName,
            scriptName,
            command,
          });
        }
      }
    } catch {
      // Ignore invalid package.json files so one malformed package does not hide all tasks.
    }
  }

  for (const entry of entries) {
    if (entry.name === "package.json") {
      continue;
    }
    const fullPath = resolve(currentDirectory, entry.name);
    if (
      !(await isDirectoryCandidate(entry, fullPath)) ||
      isIgnoredPackageDirectory(entry.name)
    ) {
      continue;
    }
    tasks.push(
      ...(await listPackageJsonTasksAsync(
        rootDirectory,
        fullPath,
        resolvedRootRealPath,
        visitedRealPaths,
      )),
    );
  }

  return tasks;
}

/**
 * Promote watch target kind to "tasks" when needed while preserving "tasks" over "directory".
 */
function addTaskWatchTarget(
  watchTargetKinds: Map<string, TaskWatchTarget["kind"]>,
  path: string,
  kind: TaskWatchTarget["kind"],
): void {
  const currentKind = watchTargetKinds.get(path);
  if (currentKind === "tasks" || currentKind === kind) {
    return;
  }
  watchTargetKinds.set(path, kind);
}

/**
 * Recursively discover directories to watch:
 *  - all directories under .tasks
 *  - package directories that may contain script changes.
 */
async function collectTaskWatchTargetsAsync(
  worktreePath: string,
  currentDirectory: string,
  watchTargetKinds: Map<string, TaskWatchTarget["kind"]>,
  rootRealPath: string,
  visitedRealPaths: Set<string>,
): Promise<void> {
  if (
    !(await visitDirectoryOnceAsync(
      currentDirectory,
      visitedRealPaths,
      rootRealPath,
    ))
  ) {
    return;
  }

  const entries = sortDirectoryEntries(
    await readdir(currentDirectory, {
      withFileTypes: true,
    }),
  );
  const relativeDirectory =
    relative(worktreePath, currentDirectory).replace(/\\/g, "/") || ".";
  const insideTasksDirectory =
    relativeDirectory === ".tasks" || relativeDirectory.startsWith(".tasks/");
  addTaskWatchTarget(
    watchTargetKinds,
    currentDirectory,
    insideTasksDirectory ? "tasks" : "directory",
  );

  if (insideTasksDirectory) {
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = resolve(currentDirectory, entry.name);
      if (await isDirectoryCandidate(entry, fullPath)) {
        await collectTaskWatchTargetsAsync(
          worktreePath,
          fullPath,
          watchTargetKinds,
          rootRealPath,
          visitedRealPaths,
        );
      }
    }
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".tasks") {
      await collectTaskWatchTargetsAsync(
        worktreePath,
        resolve(currentDirectory, entry.name),
        watchTargetKinds,
        rootRealPath,
        visitedRealPaths,
      );
      continue;
    }

    const fullPath = resolve(currentDirectory, entry.name);
    if (
      !(await isDirectoryCandidate(entry, fullPath)) ||
      isIgnoredPackageDirectory(entry.name)
    ) {
      continue;
    }
    await collectTaskWatchTargetsAsync(
      worktreePath,
      fullPath,
      watchTargetKinds,
      rootRealPath,
      visitedRealPaths,
    );
  }
}

/**
 * Read all task watch targets for a worktree and return deterministic ordering.
 */
export async function readTaskWatchTargets(
  worktreePath: string,
): Promise<TaskWatchTarget[]> {
  const rootRealPath = await safeDirectoryRealPathAsync(worktreePath);
  if (!rootRealPath) {
    return [];
  }

  const watchTargetKinds = new Map<string, TaskWatchTarget["kind"]>();
  await collectTaskWatchTargetsAsync(
    worktreePath,
    worktreePath,
    watchTargetKinds,
    rootRealPath,
    new Set<string>(),
  );
  return [...watchTargetKinds.entries()]
    .map(([path, kind]) => ({
      path,
      kind,
    }))
    .sort((left, right) =>
      left.path === right.path
        ? left.kind.localeCompare(right.kind)
        : left.path.localeCompare(right.path),
    );
}

/**
 * Sort first by task kind (file before script), then by title and path.
 */
function sortProjectTasks(tasks: RpcProjectTask[]): RpcProjectTask[] {
  return [...tasks].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "file" ? -1 : 1;
    }
    const titleResult = left.title.localeCompare(right.title);
    if (titleResult !== 0) {
      return titleResult;
    }
    return left.path.localeCompare(right.path);
  });
}

/**
 * Aggregate `.tasks` files and package scripts, then sort results.
 */
export async function readProjectTasksFromDisk(
  worktreePath: string,
): Promise<RpcProjectTask[]> {
  const worktreeRealPath = await safeDirectoryRealPathAsync(worktreePath);
  const tasksDirectory = tasksDirectoryPath(worktreePath);
  const tasksRealPath = await safeDirectoryRealPathAsync(tasksDirectory);
  const fileTasks =
    worktreeRealPath &&
    tasksRealPath &&
    !pathEscapesRoot(worktreeRealPath, tasksRealPath)
      ? await listProjectTaskFilesAsync(tasksDirectory)
      : [];

  return sortProjectTasks([
    ...fileTasks,
    ...(await listPackageJsonTasksAsync(worktreePath)),
  ]);
}

/**
 * Resolve and validate task file path to prevent escaping from the `.tasks` root.
 */
export function resolveProjectTaskFilePath(
  worktreePath: string,
  taskPath: string,
): string {
  const normalizedTaskPath = normalizeRelativeTaskPath(taskPath);
  if (!normalizedTaskPath) {
    throw new Error("Task path is required.");
  }

  const tasksDirectory = tasksDirectoryPath(worktreePath);
  if (!safeIsDirectory(tasksDirectory)) {
    throw new Error(`No .tasks directory found in ${worktreePath}.`);
  }
  assertRealPathInsideRoot(
    worktreePath,
    tasksDirectory,
    `Task path must stay within ${tasksDirectory}.`,
  );

  const fullPath = resolve(tasksDirectory, normalizedTaskPath);
  const relativePath = relative(tasksDirectory, fullPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Task path must stay within ${tasksDirectory}.`);
  }
  if (!safeIsFile(fullPath)) {
    throw new Error(`Task not found: ${normalizedTaskPath}`);
  }
  assertRealPathInsideRoot(
    tasksDirectory,
    fullPath,
    `Task path must stay within ${tasksDirectory}.`,
  );

  return fullPath;
}

/**
 * Resolve, validate, and parse a package.json script target from an RpcProjectTask.
 */
export function resolvePackageJsonTask(
  worktreePath: string,
  task: RpcProjectTask,
): {
  packageJsonPath: string;
  packageDirectory: string;
  scriptName: string;
  command: string;
} {
  const normalizedPackageJsonPath = normalizeRelativeTaskPath(task.path);
  if (!normalizedPackageJsonPath) {
    throw new Error("Package task path is required.");
  }
  if (!task.scriptName?.trim()) {
    throw new Error("Package task script name is required.");
  }

  const packageJsonPath = resolve(worktreePath, normalizedPackageJsonPath);
  const relativePath = relative(worktreePath, packageJsonPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`Package task path must stay within ${worktreePath}.`);
  }
  if (!safeIsFile(packageJsonPath)) {
    throw new Error(`package.json not found: ${normalizedPackageJsonPath}`);
  }
  assertRealPathInsideRoot(
    worktreePath,
    packageJsonPath,
    `Package task path must stay within ${worktreePath}.`,
  );

  let parsed: Partial<{ scripts: Record<string, unknown> }>;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Partial<{
      scripts: Record<string, unknown>;
    }>;
  } catch {
    throw new Error(`Invalid package.json: ${normalizedPackageJsonPath}`);
  }

  const command = parsed.scripts?.[task.scriptName];
  if (typeof command !== "string" || !command.trim()) {
    throw new Error(
      `Script "${task.scriptName}" not found in ${normalizedPackageJsonPath}`,
    );
  }

  const packageDirectory =
    relative(worktreePath, dirname(packageJsonPath)).replace(/\\/g, "/") || ".";
  return {
    packageJsonPath: normalizedPackageJsonPath,
    packageDirectory,
    scriptName: task.scriptName,
    command,
  };
}

/**
 * Resolve a task into the validated payload needed to queue it. This allows
 * stale task selections to fail before a new thread is created.
 */
export async function resolveProjectTaskExecution(
  worktreePath: string,
  task: RpcProjectTask,
): Promise<ResolvedProjectTaskExecution> {
  switch (task.kind) {
    case "script":
      return {
        kind: "script",
        task: resolvePackageJsonTask(worktreePath, task),
      };
    case "file": {
      const taskFilePath = resolveProjectTaskFilePath(worktreePath, task.path);
      const taskContent = await Bun.file(taskFilePath).text();
      if (!taskContent.trim()) {
        throw new Error(`Task file is empty: ${task.path}`);
      }
      return {
        kind: "file",
        prompt: formatTaskPrompt(taskTitleFromPath(task.path), taskContent),
      };
    }
    default:
      throw new Error(`Unsupported project task kind: ${task.kind}`);
  }
}
