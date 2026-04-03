import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { RpcProjectTask } from "../rpc-schema";
import { safeIsDirectory, safeIsFile } from "./shared";

export type TaskWatchTarget = {
  kind: "directory" | "tasks";
  path: string;
};

function tasksDirectoryPath(worktreePath: string): string {
  return resolve(worktreePath, ".tasks");
}

function normalizeRelativeTaskPath(taskPath: string): string {
  return taskPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function taskTitleFromPath(taskPath: string): string {
  return taskPath.replace(/\.[^./\\]+$/, "").replace(/\\/g, "/");
}

export function formatTaskPrompt(
  taskTitle: string,
  taskContent: string,
): string {
  return `Your job is to perform the task: ${taskTitle}\n${taskContent.trim()}\n\nDo this now.`;
}

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
  return [...values].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function safeDirectoryRealPath(path: string): string | null {
  if (!safeIsDirectory(path)) {
    return null;
  }

  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function visitDirectoryOnce(
  path: string,
  visitedRealPaths: Set<string>,
  rootRealPath: string,
): boolean {
  const realPath = safeDirectoryRealPath(path);
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

function listProjectTaskFiles(
  tasksDirectory: string,
  prefix = "",
  rootRealPath = safeDirectoryRealPath(tasksDirectory),
  visitedRealPaths = new Set<string>(),
): RpcProjectTask[] {
  if (!rootRealPath) {
    return [];
  }

  if (!visitDirectoryOnce(tasksDirectory, visitedRealPaths, rootRealPath)) {
    return [];
  }

  const tasks: RpcProjectTask[] = [];
  for (const entry of sortDirectoryEntries(
    readdirSync(tasksDirectory, {
      withFileTypes: true,
    }).filter((value) => !value.name.startsWith(".")),
  )) {
    const fullPath = resolve(tasksDirectory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() || safeIsDirectory(fullPath)) {
      tasks.push(
        ...listProjectTaskFiles(
          fullPath,
          relativePath,
          rootRealPath,
          visitedRealPaths,
        ),
      );
      continue;
    }
    if (!(entry.isFile() || safeIsFile(fullPath))) {
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

function listPackageJsonTasks(
  rootDirectory: string,
  currentDirectory = rootDirectory,
  rootRealPath = safeDirectoryRealPath(rootDirectory),
  visitedRealPaths = new Set<string>(),
): RpcProjectTask[] {
  if (!rootRealPath) {
    return [];
  }

  if (!visitDirectoryOnce(currentDirectory, visitedRealPaths, rootRealPath)) {
    return [];
  }

  const tasks: RpcProjectTask[] = [];
  const entries = sortDirectoryEntries(
    readdirSync(currentDirectory, {
      withFileTypes: true,
    }),
  );
  const packageJsonPath = resolve(currentDirectory, "package.json");
  if (
    entries.some((entry) => entry.name === "package.json") &&
    safeIsFile(packageJsonPath)
  ) {
    try {
      const parsed = JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
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
      !(entry.isDirectory() || safeIsDirectory(fullPath)) ||
      isIgnoredPackageDirectory(entry.name)
    ) {
      continue;
    }
    tasks.push(
      ...listPackageJsonTasks(
        rootDirectory,
        fullPath,
        rootRealPath,
        visitedRealPaths,
      ),
    );
  }

  return tasks;
}

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

function collectTaskWatchTargets(
  worktreePath: string,
  currentDirectory: string,
  watchTargetKinds: Map<string, TaskWatchTarget["kind"]>,
  rootRealPath: string,
  visitedRealPaths: Set<string>,
): void {
  if (!visitDirectoryOnce(currentDirectory, visitedRealPaths, rootRealPath)) {
    return;
  }

  const entries = sortDirectoryEntries(
    readdirSync(currentDirectory, {
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
      if (entry.isDirectory() || safeIsDirectory(fullPath)) {
        collectTaskWatchTargets(
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
      collectTaskWatchTargets(
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
      !(entry.isDirectory() || safeIsDirectory(fullPath)) ||
      isIgnoredPackageDirectory(entry.name)
    ) {
      continue;
    }
    collectTaskWatchTargets(
      worktreePath,
      fullPath,
      watchTargetKinds,
      rootRealPath,
      visitedRealPaths,
    );
  }
}

export function readTaskWatchTargets(worktreePath: string): TaskWatchTarget[] {
  const rootRealPath = safeDirectoryRealPath(worktreePath);
  if (!rootRealPath) {
    return [];
  }

  const watchTargetKinds = new Map<string, TaskWatchTarget["kind"]>();
  collectTaskWatchTargets(
    worktreePath,
    worktreePath,
    watchTargetKinds,
    rootRealPath,
    new Set<string>(),
  );
  return [...watchTargetKinds.entries()].map(([path, kind]) => ({
    path,
    kind,
  }));
}

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

export function readProjectTasksFromDisk(
  worktreePath: string,
): RpcProjectTask[] {
  return sortProjectTasks([
    ...listProjectTaskFiles(tasksDirectoryPath(worktreePath)),
    ...listPackageJsonTasks(worktreePath),
  ]);
}

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

  return fullPath;
}

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
