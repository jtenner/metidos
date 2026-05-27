/**
 * @file src/bun/thread-start-approval.test.ts
 * @description Regression tests for thread-start approval authorization.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  createUser,
  initAppDatabase,
  resetResolvedAppDataDirectory,
} from "./db";
import type { RpcRequestContext } from "./rpc-schema";

type ProjectProceduresModule = typeof import("./project-procedures");

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
let procedures: ProjectProceduresModule | null = null;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function initializeGitRepository(path: string): void {
  execFileSync("git", ["init"], { cwd: path, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: path,
    stdio: "ignore",
  });
  writeFileSync(join(path, "README.md"), "# Test repo\n");
  execFileSync("git", ["add", "."], { cwd: path, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: path,
    stdio: "ignore",
  });
}

function requestContext(input: {
  isAdmin: boolean;
  userId: number;
  username: string;
}): RpcRequestContext {
  return {
    auth: {
      isAdmin: input.isAdmin,
      sessionId: `session-${input.userId}`,
      userId: input.userId,
      username: input.username,
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

async function openUserRepository(
  username: string,
  repositoryName: string,
): Promise<{
  context: RpcRequestContext;
  opened: Awaited<ReturnType<ProjectProceduresModule["openProjectProcedure"]>>;
  repoPath: string;
}> {
  if (!procedures) {
    throw new Error("Project procedures were not loaded.");
  }

  const database = initAppDatabase();
  const user = createUser(database, { isAdmin: false, username });
  const context = requestContext({
    isAdmin: false,
    userId: user.id,
    username: user.username,
  });
  const home = await procedures.getHomeDirectoryProcedure(context);
  const repoPath = join(home.homeDirectory, repositoryName);
  rmSync(repoPath, { force: true, recursive: true });
  mkdirSync(repoPath, { recursive: true });
  initializeGitRepository(repoPath);

  const opened = await procedures.openProjectProcedure(
    {
      projectPath: repoPath,
    },
    context,
  );
  return { context, opened, repoPath };
}

beforeAll(async () => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
    "metidos-thread-start-approval-db-",
  );
  procedures = (await import(
    `./project-procedures?thread-start-approval=${Date.now()}`
  )) as ProjectProceduresModule;
});

afterAll(async () => {
  procedures?.shutdownProjectPolling();
  await procedures?.shutdownActiveThreadTurns();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }

  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("thread-start approval authorization", () => {
  it("does not let a non-privileged local session self-approve unsafe thread creation", async () => {
    if (!procedures) {
      throw new Error("Project procedures were not loaded.");
    }

    const { context, opened, repoPath } = await openUserRepository(
      "alice",
      "unsafe-approval-repo",
    );
    const request = await procedures.requestThreadStartProcedure(
      {
        autoStart: true,
        input: "Run unsafe work",
        model: null,
        permissions: ["metidos:unsafe"],
        projectId: opened.project.id,
        reasoningEffort: null,
        worktreePath: repoPath,
      },
      context,
    );

    await expect(
      procedures.approveThreadStartRequestProcedure(
        { requestId: request.requestId },
        context,
      ),
    ).rejects.toMatchObject({
      code: "admin_required",
    });
  });

  it("queues the initial prompt when approving an auto-start request", async () => {
    if (!procedures) {
      throw new Error("Project procedures were not loaded.");
    }

    const { context, opened, repoPath } = await openUserRepository(
      "bob",
      "auto-start-approval-repo",
    );
    const request = await procedures.requestThreadStartProcedure(
      {
        autoStart: true,
        input: "Approved prompt",
        model: null,
        permissions: null,
        projectId: opened.project.id,
        reasoningEffort: null,
        worktreePath: repoPath,
      },
      context,
    );

    const detail = await procedures.approveThreadStartRequestProcedure(
      { requestId: request.requestId },
      context,
    );

    expect(
      detail.messages.some(
        (message) =>
          message.kind === "chat" &&
          message.role === "user" &&
          message.text === "Approved prompt",
      ),
    ).toBeTrue();
  });
});
