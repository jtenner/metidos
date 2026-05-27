/**
 * @file src/bun/project-security-audit.test.ts
 * @description Test file for project security audit.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createThread,
  listSecurityAuditEvents,
  migrateDatabase,
  upsertProject,
} from "./db";
import {
  recordCrossWorkspaceThreadAuditEvent,
  recordProjectDeletedAuditEvent,
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
  it("records cross-workspace thread creation when workspace context changes", () => {
    const database = createTestDatabase();
    const featureAPath = mkdtempSync(join(tmpdir(), "metidos-audit-a-"));
    const featureBPath = mkdtempSync(join(tmpdir(), "metidos-audit-b-"));
    const project = upsertProject(database, {
      name: "Repo",
      projectPath: "/repo",
    });
    const thread = createThread(database, {
      piLeafEntryId: null,
      piSessionFile: null,
      piSessionId: null,
      agentsAccess: false,
      githubAccess: false,
      model: "gpt-5",
      projectId: project.id,
      reasoningEffort: "medium",
      title: "Feature thread",
      metidosAccess: true,
      unsafeMode: false,
      worktreePath: featureBPath,
    });

    recordCrossWorkspaceThreadAuditEvent(database, {
      params: {
        currentProjectId: project.id,
        currentWorktreePath: featureAPath,
        projectId: project.id,
        worktreePath: featureBPath,
      },
      thread,
    });
    recordCrossWorkspaceThreadAuditEvent(database, {
      params: {
        currentProjectId: project.id,
        currentWorktreePath: featureBPath,
        projectId: project.id,
        worktreePath: featureBPath,
      },
      thread,
    });

    const events = listSecurityAuditEvents(database);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("cross_workspace_thread_created");
    expect(events[0]?.threadId).toBe(thread.id);
    expect(events[0]?.payloadJson).toContain(
      `"currentWorktreePath":"${featureAPath}"`,
    );
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
