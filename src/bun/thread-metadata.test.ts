/**
 * @file src/bun/thread-metadata.test.ts
 * @description Test file for thread metadata.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "./db";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;

type ProjectProceduresModule = typeof import("./project-procedures");

let projectProcedures: ProjectProceduresModule | null = null;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

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
  process.env.JOLT_APP_DATA_DIR = createTempDirectory(
    "jolt-thread-metadata-db-",
  );
  projectProcedures = (await import(
    `./project-procedures?thread-metadata=${Date.now()}`
  )) as ProjectProceduresModule;
  return projectProcedures;
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

describe("thread metadata procedures", () => {
  it("returns live status summaries for only the requested thread ids", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-thread-status-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Status Repo",
      projectPath: repoPath,
    });
    const firstThread = await procedures.createThreadProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      unsafeMode: false,
    });
    const secondThread = await procedures.createThreadProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      unsafeMode: false,
    });

    const loadedStatuses = await procedures.listThreadStatusesProcedure({
      threadIds: [secondThread.thread.id, secondThread.thread.id],
    });

    expect(loadedStatuses).toHaveLength(1);
    expect(loadedStatuses[0]?.id).toBe(secondThread.thread.id);
    expect(loadedStatuses[0]?.runStatus.state).toBe("idle");
    expect(loadedStatuses[0]?.id).not.toBe(firstThread.thread.id);
  });

  it("preserves unspecified fields and applies combined metadata updates", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-thread-metadata-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Metadata Repo",
      projectPath: repoPath,
    });
    const created = await procedures.createThreadProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      unsafeMode: false,
    });
    const originalTitle = created.thread.title;

    const pinnedWithSummary = await procedures.updateThreadMetadataProcedure({
      threadId: created.thread.id,
      summary: "  Short summary  ",
      pinned: true,
    });

    expect(pinnedWithSummary.title).toBe(originalTitle);
    expect(pinnedWithSummary.summary).toBe("Short summary");
    expect(pinnedWithSummary.pinnedAt).not.toBeNull();

    const renamed = await procedures.updateThreadMetadataProcedure({
      threadId: created.thread.id,
      title: "Renamed thread",
      summary: "   ",
    });

    expect(renamed.title).toBe("Renamed thread");
    expect(renamed.summary).toBeNull();
    expect(renamed.pinnedAt).toBe(pinnedWithSummary.pinnedAt);

    const detail = await procedures.getThreadProcedure({
      threadId: created.thread.id,
    });
    expect(detail.thread.title).toBe("Renamed thread");
    expect(detail.thread.summary).toBeNull();
    expect(detail.thread.pinnedAt).toBe(pinnedWithSummary.pinnedAt);
  });
});
