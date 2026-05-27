/**
 * @file src/bun/project-store.test.ts
 * @description Tests for the concrete SQLite Project/Worktree store.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { createCronJob, createThread, migrateDatabase } from "./db";
import {
  deleteProject,
  ensureProjectWorktreeVisible,
  getProject,
  getProjectById,
  listProjects,
  listProjectWorktreesMetadata,
  setProjectClosed,
  setProjectWorktreePinned,
  upsertProject,
} from "./project-store";

describe("project store", () => {
  let database: Database | null = null;

  afterEach(() => {
    database?.close(false);
    database = null;
  });

  function openDatabase(): Database {
    database = new Database(":memory:");
    migrateDatabase(database);
    return database;
  }

  it("upserts and lists app-owned projects", () => {
    const db = openDatabase();

    const project = upsertProject(db, {
      name: "Shared Path",
      projectPath: "/workspace/shared",
    });

    expect(getProject(db, "/workspace/shared")?.id).toBe(project.id);
    expect(listProjects(db).map((item) => item.id)).toEqual([project.id]);

    const reopened = upsertProject(db, {
      name: "Renamed",
      projectPath: "/workspace/shared",
    });
    expect(reopened.id).toBe(project.id);
    expect(reopened.name).toBe("Renamed");
  });

  it("tracks visible worktrees and optional pin state", () => {
    const db = openDatabase();
    const project = upsertProject(db, {
      name: "Tracked",
      projectPath: "/workspace/project",
    });

    ensureProjectWorktreeVisible(db, project.id, "/workspace/project-feature");
    setProjectWorktreePinned(
      db,
      project.id,
      "/workspace/project-release",
      true,
    );

    const records = listProjectWorktreesMetadata(db, project.id);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pinnedAt: null,
          projectId: project.id,
          worktreePath: "/workspace/project-feature",
        }),
        expect.objectContaining({
          projectId: project.id,
          worktreePath: "/workspace/project-release",
        }),
      ]),
    );
    expect(
      records.find(
        (record) => record.worktreePath === "/workspace/project-release",
      )?.pinnedAt,
    ).toEqual(expect.any(String));
  });

  it("closes and soft-deletes projects with dependent threads and cron jobs", () => {
    const db = openDatabase();
    const project = upsertProject(db, {
      name: "Deletable",
      projectPath: "/workspace/deletable",
    });
    const thread = createThread(db, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: false,
      model: "gpt-5.4",
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Thread",
      unsafeMode: false,
      worktreePath: project.path,
    });
    const cronJob = createCronJob(db, {
      agentsAccess: false,
      description: "",
      enabled: true,
      githubAccess: false,
      metidosAccess: false,
      model: "gpt-5.4",
      prompt: "echo ok",
      projectId: project.id,
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      title: "Cron",
      unsafeMode: false,
      worktreePath: project.path,
    });

    setProjectClosed(db, project.id);
    expect(getProjectById(db, project.id)?.isOpen).toBe(0);

    deleteProject(db, project.id);
    expect(getProjectById(db, project.id)).toBeNull();
    expect(
      db
        .query<{ deletedAt: number | null }, [number]>(
          "SELECT deleted_at AS deletedAt FROM threads WHERE id = ?",
        )
        .get(thread.id)?.deletedAt,
    ).toEqual(expect.any(Number));
    expect(
      db
        .query<{ deletedAt: number | null; enabled: 0 | 1 }, [number]>(
          "SELECT deleted_at AS deletedAt, enabled FROM cron_jobs WHERE id = ?",
        )
        .get(cronJob.id),
    ).toEqual({ deletedAt: expect.any(Number), enabled: 0 });
  });
});
