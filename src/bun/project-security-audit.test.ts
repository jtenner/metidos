/**
 * @file src/bun/project-security-audit.test.ts
 * @description Test file for project security audit.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import {
  createThread,
  listSecurityAuditEvents,
  migrateDatabase,
  upsertProject,
} from "./db";
import {
  recordCrossWorkspaceThreadAuditEvent,
  recordProjectDeletedAuditEvent,
  recordProjectTaskQueuedAuditEvent,
} from "./project-security-audit";

const openDatabases = new Set<Database>();

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases) {
    database.close(false);
  }
  openDatabases.clear();
});

describe("project security audit helpers", () => {
  it("records cross-workspace thread creation only when step-up was required", () => {
    const database = createTestDatabase();
    const project = upsertProject(database, {
      name: "Repo",
      projectPath: "/repo",
    });
    const thread = createThread(database, {
      codexThreadId: null,
      model: "gpt-5",
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Feature thread",
      unsafeMode: false,
      worktreePath: "/repo/feature-b",
    });

    recordCrossWorkspaceThreadAuditEvent(database, {
      params: {
        currentProjectId: project.id,
        currentWorktreePath: "/repo/feature-a",
        projectId: project.id,
        worktreePath: "/repo/feature-b",
      },
      thread,
    });
    recordCrossWorkspaceThreadAuditEvent(database, {
      params: {
        currentProjectId: project.id,
        currentWorktreePath: "/repo/feature-b",
        projectId: project.id,
        worktreePath: "/repo/feature-b",
      },
      thread,
    });

    const events = listSecurityAuditEvents(database);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("cross_workspace_thread_created");
    expect(events[0]?.threadId).toBe(thread.id);
    expect(events[0]?.payloadJson).toContain(
      '"currentWorktreePath":"/repo/feature-a"',
    );
  });

  it("records queued project-task executions with thread context", () => {
    const database = createTestDatabase();
    const project = upsertProject(database, {
      name: "Repo",
      projectPath: "/repo",
    });
    const thread = createThread(database, {
      codexThreadId: null,
      model: "gpt-5",
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Task thread",
      unsafeMode: true,
      worktreePath: "/repo",
    });

    recordProjectTaskQueuedAuditEvent(database, {
      createdThread: false,
      params: {
        projectId: project.id,
        task: {
          command: "bun test",
          id: "task-1",
          kind: "script",
          path: "/repo/package.json",
          scriptName: "test",
          title: "test",
        },
        threadId: thread.id,
        worktreePath: "/repo",
      },
      thread,
    });

    const event = listSecurityAuditEvents(database)[0];
    expect(event?.eventType).toBe("project_task_queued");
    expect(event?.threadId).toBe(thread.id);
    expect(event?.payloadJson).toContain('"taskKind":"script"');
    expect(event?.payloadJson).toContain('"unsafeMode":true');
  });

  it("records project deletions with the affected project metadata", () => {
    const database = createTestDatabase();
    const project = upsertProject(database, {
      name: "Repo",
      projectPath: "/repo",
    });

    recordProjectDeletedAuditEvent(database, {
      project,
      threadCount: 3,
    });

    const event = listSecurityAuditEvents(database)[0];
    expect(event?.eventType).toBe("project_deleted");
    expect(event?.projectId).toBe(project.id);
    expect(event?.summaryText).toBe("Deleted project Repo.");
    expect(event?.payloadJson).toContain('"threadCount":3');
  });
});
