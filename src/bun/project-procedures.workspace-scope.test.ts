/**
 * @file src/bun/project-procedures.workspace-scope.test.ts
 * @description Regression tests for authenticated workspace path scoping.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  createThread,
  createUser,
  getThreadById,
  initAppDatabase,
  resetResolvedAppDataDirectory,
  upsertProject,
} from "./db";
import type { RpcRequestContext } from "./rpc-schema";

type ProjectProceduresModule = typeof import("./project-procedures");

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-workspace-scope-"));
  tempDirectories.add(path);
  return path;
}

async function loadProjectProcedures(): Promise<ProjectProceduresModule> {
  return (await import(
    `./project-procedures?workspace-scope=${Date.now()}`
  )) as ProjectProceduresModule;
}

function regularContext(
  auth: Partial<RpcRequestContext["auth"]>,
): RpcRequestContext {
  return {
    auth: {
      isAdmin: false,
      sessionId: "session-1",
      userId: 1,
      username: "alice",
      ...auth,
    },
    signal: new AbortController().signal,
    priority: "default",
    timeoutMs: null,
  };
}

beforeEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory();
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

describe("project procedure workspace scoping", () => {
  it("fails closed when a restricted local-operator context has no username", async () => {
    const { getHomeDirectoryProcedure } = await loadProjectProcedures();

    await expect(
      getHomeDirectoryProcedure(regularContext({ username: null })),
    ).rejects.toMatchObject({
      code: "session_required",
    });
  });

  it("fails closed when a restricted local-operator context has no user id", async () => {
    const { getHomeDirectoryProcedure } = await loadProjectProcedures();

    await expect(
      getHomeDirectoryProcedure(regularContext({ userId: null })),
    ).rejects.toMatchObject({
      code: "session_required",
    });
  });

  it("rejects creating projects through symlinked restricted-workspace ancestors", async () => {
    const database = initAppDatabase();
    createUser(database, { isAdmin: false, username: "alice" });
    const context = regularContext({});
    const { getHomeDirectoryProcedure, openProjectProcedure } =
      await loadProjectProcedures();
    const { homeDirectory } = await getHomeDirectoryProcedure(context);
    const outsideDirectory = createTempDirectory();
    const symlinkPath = join(homeDirectory, "escape");
    mkdirSync(homeDirectory, { recursive: true });
    symlinkSync(outsideDirectory, symlinkPath, "dir");

    await expect(
      openProjectProcedure(
        {
          createIfMissing: true,
          initGitIfNeeded: false,
          projectPath: "~/escape/new-project",
        },
        context,
      ),
    ).rejects.toThrow(
      "Workspace access is limited to the configured local workspace root.",
    );
  });

  it("formats missing project-folder prompts relative to the restricted workspace home", async () => {
    const database = initAppDatabase();
    createUser(database, { isAdmin: false, username: "alice" });
    const context = regularContext({});
    const { getHomeDirectoryProcedure, openProjectProcedure } =
      await loadProjectProcedures();
    const { homeDirectory } = await getHomeDirectoryProcedure(context);
    mkdirSync(homeDirectory, { recursive: true });

    await expect(
      openProjectProcedure(
        {
          createIfMissing: false,
          initGitIfNeeded: false,
          projectPath: "~/missing-project",
        },
        context,
      ),
    ).rejects.toThrow("Project path does not exist: ~/missing-project");
  });

  it("pins the opened worktree when project open requests direct pinning", async () => {
    const database = initAppDatabase();
    createUser(database, { isAdmin: false, username: "alice" });
    const context = regularContext({});
    const { getHomeDirectoryProcedure, openProjectProcedure } =
      await loadProjectProcedures();
    const { homeDirectory } = await getHomeDirectoryProcedure(context);
    mkdirSync(homeDirectory, { recursive: true });

    const opened = await openProjectProcedure(
      {
        createIfMissing: true,
        initGitIfNeeded: false,
        pinWorktree: true,
        projectPath: "~/pinned-project",
      },
      context,
    );

    expect(opened.worktrees).toEqual([
      expect.objectContaining({
        path: join(homeDirectory, "pinned-project"),
        pinnedAt: expect.any(String),
      }),
    ]);
  });

  it("does not discard empty threads for projects outside the caller workspace", async () => {
    const database = initAppDatabase();
    const outsideDirectory = createTempDirectory();
    const project = upsertProject(database, {
      projectPath: outsideDirectory,
      name: "Outside Workspace",
    });
    const thread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Outside empty thread",
      unsafeMode: false,
      worktreePath: outsideDirectory,
    });
    const { discardEmptyThreadProcedure } = await loadProjectProcedures();

    await expect(
      discardEmptyThreadProcedure({ threadId: thread.id }, regularContext({})),
    ).resolves.toEqual({
      discarded: false,
      threadId: thread.id,
    });
    expect(getThreadById(database, thread.id)).not.toBeNull();
  });

  it("rejects raw thread-id reads outside the caller workspace", async () => {
    const database = initAppDatabase();
    const alice = createUser(database, { isAdmin: false, username: "alice" });
    const context = regularContext({ userId: alice.id, username: "alice" });
    const outsideDirectory = createTempDirectory();
    const project = upsertProject(database, {
      projectPath: outsideDirectory,
      name: "Outside Workspace",
    });
    const thread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: "gpt-5.4",
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Outside thread",
      unsafeMode: false,
      worktreePath: outsideDirectory,
    });
    const { getThreadProcedure, listThreadsProcedure } =
      await loadProjectProcedures();

    expect(
      (await listThreadsProcedure(undefined, context)).map((entry) => entry.id),
    ).not.toContain(thread.id);
    await expect(
      getThreadProcedure({ threadId: thread.id }, context),
    ).rejects.toThrow(`Project not currently tracked: ${project.id}`);
  });

  it("exposes app-owned projects, threads, and crons when the workspace path is visible", async () => {
    const database = initAppDatabase();
    const alice = createUser(database, { isAdmin: false, username: "alice" });
    const context = regularContext({ userId: alice.id, username: "alice" });
    const {
      createThreadProcedure,
      getHomeDirectoryProcedure,
      getThreadProcedure,
      listCronsProcedure,
      listProjectsProcedure,
      listThreadsProcedure,
      newCronProcedure,
    } = await loadProjectProcedures();
    const { homeDirectory } = await getHomeDirectoryProcedure(context);
    mkdirSync(homeDirectory, { recursive: true });

    const projectPath = join(homeDirectory, "shared-project");
    mkdirSync(projectPath, { recursive: true });
    const project = upsertProject(database, {
      projectPath,
      name: "Shared Project",
    });

    const threadDetail = await createThreadProcedure(
      {
        model: null,
        permissions: ["metidos:threads"],
        projectId: project.id,
        reasoningEffort: null,
        worktreePath: projectPath,
      },
      context,
    );
    const cronJob = await newCronProcedure(
      {
        enabled: true,
        permissions: ["metidos:threads"],
        projectId: project.id,
        prompt: "echo ok",
        schedule: "0 * * * *",
        title: "Visible cron",
        worktreePath: projectPath,
      },
      context,
    );

    expect(
      (await listProjectsProcedure(undefined, context)).map(
        (entry) => entry.id,
      ),
    ).toContain(project.id);
    expect(
      (await listThreadsProcedure(undefined, context)).map((entry) => entry.id),
    ).toContain(threadDetail.thread.id);
    expect(
      (await listCronsProcedure(undefined, context)).map((entry) => entry.id),
    ).toContain(cronJob.id);
    await expect(
      getThreadProcedure({ threadId: threadDetail.thread.id }, context),
    ).resolves.toMatchObject({
      thread: {
        id: threadDetail.thread.id,
        projectId: project.id,
      },
    });
  });
});
