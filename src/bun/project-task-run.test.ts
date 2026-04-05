/**
 * @file src/bun/project-task-run.test.ts
 * @description Test file for project task run.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  initAppDatabase,
  listThreads,
  resetResolvedAppDataDirectory,
} from "./db";
import type { RpcProjectTask } from "./rpc-schema";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;

type ProjectProceduresModule = typeof import("./project-procedures");

let projectProcedures: ProjectProceduresModule | null = null;
/**
 * Function of createTempDirectory.
 * @param prefix - The value of `prefix`.
 */

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}
/**
 * Function of initializeGitRepository.
 * @param path - The value of `path`.
 */

function initializeGitRepository(path: string): void {
  execFileSync("git", ["init"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: path,
    stdio: "ignore",
  });
  writeFileSync(join(path, "README.md"), "# Test repo\n");
  execFileSync("git", ["add", "."], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: path,
    stdio: "ignore",
  });
}

async function loadProjectProcedures() {
  if (projectProcedures) {
    return projectProcedures;
  }

  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.JOLT_APP_DATA_DIR = createTempDirectory("jolt-task-db-");
  projectProcedures = (await import(
    `./project-procedures?project-task-run=${Date.now()}`
  )) as ProjectProceduresModule;
  return projectProcedures;
}

function currentThreadIds(): number[] {
  return listThreads(initAppDatabase()).map((thread) => thread.id);
}

beforeAll(async () => {
  await loadProjectProcedures();
});

afterEach(() => {
  projectProcedures?.shutdownProjectPolling();
});

afterAll(async () => {
  projectProcedures?.shutdownProjectPolling();
  await projectProcedures?.shutdownActiveThreadTurns();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.JOLT_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.JOLT_APP_DATA_DIR;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("project task execution", () => {
  it("rejects an aborted active-worktree update before validation completes", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-active-worktree-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Active Worktree Repo",
      projectPath: repoPath,
    });

    await expect(
      procedures.setActiveWorktreeProcedure(
        {
          projectId: opened.project.id,
          worktreePath: repoPath,
        },
        {
          auth: {
            authBypass: true,
            sessionId: null,
          },
          priority: "default",
          signal: AbortSignal.abort(
            new Error("Active worktree update was aborted."),
          ),
          timeoutMs: null,
        },
      ),
    ).rejects.toThrow("Active worktree update was aborted.");
  });

  it("returns package script tasks on the first worktree open", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-worktree-open-script-");
    initializeGitRepository(repoPath);
    writeFileSync(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "repo",
          scripts: {
            test: "echo ok",
          },
        },
        null,
        2,
      ),
    );

    const opened = await procedures.openProjectProcedure({
      name: "Script Repo",
      projectPath: repoPath,
    });
    const openedWorktree = await procedures.openWorktreeProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
    });
    const scriptTask = openedWorktree.tasks.find(
      (task): task is RpcProjectTask =>
        task.kind === "script" && task.scriptName === "test",
    );

    expect(scriptTask).toBeDefined();
  });

  it("returns package script tasks on the first batch worktree open", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-worktree-open-batch-script-");
    initializeGitRepository(repoPath);
    writeFileSync(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "repo",
          scripts: {
            test: "echo ok",
          },
        },
        null,
        2,
      ),
    );

    const opened = await procedures.openProjectProcedure({
      name: "Batch Script Repo",
      projectPath: repoPath,
    });
    const results = await procedures.openWorktreesBatchProcedure({
      worktrees: [
        {
          projectId: opened.project.id,
          worktreePath: repoPath,
        },
      ],
    });
    const result = results[0];

    expect(result).toBeDefined();
    expect(result?.ok).toBeTrue();
    if (!result?.ok) {
      throw new Error("Expected batch worktree open to succeed.");
    }

    const scriptTask = result.tasks.find(
      (task): task is RpcProjectTask =>
        task.kind === "script" && task.scriptName === "test",
    );

    expect(scriptTask).toBeDefined();
  });

  it("does not create a new thread when a cached package script task disappears before run", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-task-repo-script-");
    initializeGitRepository(repoPath);
    writeFileSync(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "repo",
          scripts: {
            test: "echo ok",
          },
        },
        null,
        2,
      ),
    );

    const opened = await procedures.openProjectProcedure({
      name: "Script Repo",
      projectPath: repoPath,
    });
    const tasks = await procedures.listProjectTasksProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
    });
    const scriptTask = tasks.find(
      (task): task is RpcProjectTask =>
        task.kind === "script" && task.scriptName === "test",
    );

    expect(scriptTask).toBeDefined();
    if (!scriptTask) {
      throw new Error("Expected to load the test package script task.");
    }
    const beforeThreadIds = currentThreadIds();

    writeFileSync(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "repo",
          scripts: {},
        },
        null,
        2,
      ),
    );

    await expect(
      procedures.runProjectTaskProcedure({
        model: "gpt-5.4",
        projectId: opened.project.id,
        reasoningEffort: "medium",
        task: scriptTask,
        threadId: null,
        unsafeMode: false,
        worktreePath: repoPath,
      }),
    ).rejects.toThrow('Script "test" not found in package.json');

    expect(currentThreadIds()).toEqual(beforeThreadIds);
  });

  it("does not create a new thread when a cached file task disappears before run", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-task-repo-file-");
    initializeGitRepository(repoPath);
    const tasksDirectory = join(repoPath, ".tasks");
    mkdirSync(tasksDirectory, {
      recursive: true,
    });
    const taskPath = join(tasksDirectory, "review.md");
    writeFileSync(taskPath, "Review the repo.\n");

    const opened = await procedures.openProjectProcedure({
      name: "File Repo",
      projectPath: repoPath,
    });
    const tasks = await procedures.listProjectTasksProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
    });
    const fileTask = tasks.find(
      (task): task is RpcProjectTask =>
        task.kind === "file" && task.path === "review.md",
    );

    expect(fileTask).toBeDefined();
    if (!fileTask) {
      throw new Error("Expected to load the test file task.");
    }
    const beforeThreadIds = currentThreadIds();

    rmSync(taskPath, {
      force: true,
    });

    await expect(
      procedures.runProjectTaskProcedure({
        model: "gpt-5.4",
        projectId: opened.project.id,
        reasoningEffort: "medium",
        task: fileTask,
        threadId: null,
        unsafeMode: false,
        worktreePath: repoPath,
      }),
    ).rejects.toThrow("Task not found: review.md");

    expect(currentThreadIds()).toEqual(beforeThreadIds);
  });
});
