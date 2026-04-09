import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "./db";
import {
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
} from "./pi-thread-runtime";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;
const originalPiRuntimeTestProvider =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];

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
  process.env.JOLT_APP_DATA_DIR = createTempDirectory("jolt-pi-runtime-db-");
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;
  projectProcedures = (await import(
    `./project-procedures?pi-runtime-integration=${Date.now()}`
  )) as ProjectProceduresModule;
  return projectProcedures;
}

async function waitForThreadToSettle(
  procedures: ProjectProceduresModule,
  threadId: number,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const detail = await procedures.getThreadProcedure({
      threadId,
    });
    if (detail.thread.runStatus.state !== "working") {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for thread ${threadId} to settle.`);
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

  if (typeof originalPiRuntimeTestProvider === "string") {
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
      originalPiRuntimeTestProvider;
  } else {
    delete process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("Pi thread runtime integration", () => {
  it("runs a thread through project procedures and persists the assistant reply", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-pi-runtime-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Pi Runtime Repo",
      projectPath: repoPath,
    });
    const created = await procedures.createThreadProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      unsafeMode: false,
    });

    await procedures.sendThreadMessageProcedure({
      threadId: created.thread.id,
      input: "pi runtime integration smoke",
    });

    const settled = await waitForThreadToSettle(procedures, created.thread.id);
    const liveStatuses = await procedures.listThreadStatusesProcedure({
      threadIds: [created.thread.id],
    });
    const assistantMessages = settled.messages.filter(
      (message) => message.role === "assistant",
    );
    const lastAssistantMessage =
      assistantMessages[assistantMessages.length - 1] ?? null;

    expect(settled.thread.runStatus.state).toBe("idle");
    expect(settled.thread.codexThreadId).toBeNull();
    expect(settled.thread.piSessionId).toBeString();
    expect(settled.thread.piSessionFile).toBeString();
    expect(settled.thread.piLeafEntryId).toBeString();
    expect(settled.thread.usage?.contextWindowTokens).toBe(8_192);
    expect(settled.thread.usage?.inputTokens ?? 0).toBeGreaterThan(0);
    expect(liveStatuses[0]?.usage?.contextWindowTokens).toBe(8_192);
    expect(lastAssistantMessage?.text).toContain("pi-runtime-probe");
    expect(lastAssistantMessage?.text).toContain(
      "pi runtime integration smoke",
    );
  });
});
