/**
 * @file src/bun/project-procedures.terminal.test.ts
 * @description Regression tests for terminal project procedure authorization and stale worktree rejection.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  initAppDatabase,
  resetResolvedAppDataDirectory,
  upsertProject,
} from "./db";
import type { RpcRequestContext } from "./rpc-schema";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

type ProjectProceduresModule = typeof import("./project-procedures");

function createTempDirectory(prefix = "metidos-terminal-procedure-"): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

async function loadProjectProcedures(): Promise<ProjectProceduresModule> {
  return (await import(
    `./project-procedures?terminal-procedures=${Date.now()}-${Math.random()}`
  )) as ProjectProceduresModule;
}

function context(input?: {
  isAdmin?: boolean;
  sessionId?: string | null;
  userId?: number | null;
  username?: string | null;
}): RpcRequestContext {
  return {
    auth: {
      isAdmin: input?.isAdmin ?? false,
      sessionId:
        input && "sessionId" in input ? (input.sessionId ?? null) : "session-1",
      userId: input && "userId" in input ? (input.userId ?? null) : 1,
      username:
        input && "username" in input ? (input.username ?? null) : "operator",
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

beforeEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
    "metidos-terminal-procedure-db-",
  );
});

afterEach(() => {
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

describe("terminal project procedures", () => {
  it("rejects unauthenticated list, create, and close calls before reading app data", async () => {
    const {
      closeTerminalProcedure,
      createTerminalProcedure,
      listTerminalsProcedure,
    } = await loadProjectProcedures();
    const unauthenticated = context({
      isAdmin: false,
      sessionId: null,
      userId: null,
      username: null,
    });

    await expect(
      listTerminalsProcedure(undefined, unauthenticated),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      createTerminalProcedure(
        { projectId: 1, worktreePath: createTempDirectory() },
        unauthenticated,
      ),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      closeTerminalProcedure({ terminalId: "terminal-1" }, unauthenticated),
    ).rejects.toMatchObject({ code: "admin_required" });
  });

  it("rejects non-admin local operators for list, create, and close terminal flows", async () => {
    const {
      closeTerminalProcedure,
      createTerminalProcedure,
      listTerminalsProcedure,
    } = await loadProjectProcedures();
    const nonAdmin = context({ isAdmin: false });

    await expect(
      listTerminalsProcedure(undefined, nonAdmin),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      createTerminalProcedure(
        { projectId: 1, worktreePath: createTempDirectory() },
        nonAdmin,
      ),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      closeTerminalProcedure({ terminalId: "terminal-1" }, nonAdmin),
    ).rejects.toMatchObject({ code: "admin_required" });
  });

  it("rejects stale or deleted worktree paths before creating a terminal", async () => {
    const database = initAppDatabase();
    const projectPath = createTempDirectory("metidos-terminal-project-");
    mkdirSync(projectPath, { recursive: true });
    const project = upsertProject(database, {
      name: "Terminal Procedure Project",
      projectPath,
    });
    const deletedWorktreePath = join(projectPath, "deleted-worktree");
    const { createTerminalProcedure } = await loadProjectProcedures();

    await expect(
      createTerminalProcedure(
        {
          projectId: project.id,
          title: "Deleted worktree terminal",
          worktreePath: deletedWorktreePath,
        },
        context({ isAdmin: true }),
      ),
    ).rejects.toThrow(
      `Worktree not found for project ${projectPath}: ${deletedWorktreePath}`,
    );
  });
});
