import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import { createSecurityAuditEvent, migrateDatabase } from "./db";
import { listSecurityAuditEventsFromDatabase } from "./security-audit";

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

describe("security audit procedures", () => {
  it("lists audit events with normalized payload objects and limit filtering", () => {
    const database = createTestDatabase();

    createSecurityAuditEvent(database, {
      eventType: "auth_login",
      payloadJson: JSON.stringify({
        method: "totp",
        success: true,
      }),
      summaryText: "Authenticated with TOTP.",
    });
    createSecurityAuditEvent(database, {
      eventType: "project_deleted",
      payloadJson: JSON.stringify({
        projectName: "Repo",
        threadCount: 2,
      }),
      projectId: 4,
      summaryText: "Deleted project Repo.",
    });

    const result = listSecurityAuditEventsFromDatabase(database, {
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.eventType).toBe("project_deleted");
    expect(result[0]?.payload).toEqual({
      projectName: "Repo",
      threadCount: 2,
    });
  });

  it("supports thread-scoped queries and drops malformed payload JSON", () => {
    const database = createTestDatabase();

    createSecurityAuditEvent(database, {
      eventType: "unsafe_mode_enabled",
      payloadJson: "{not-json",
      projectId: 1,
      summaryText: "Unsafe mode enabled.",
      threadId: 11,
      worktreePath: "/repo",
    });
    createSecurityAuditEvent(database, {
      eventType: "auth_login",
      payloadJson: JSON.stringify({
        method: "totp",
      }),
      summaryText: "Authenticated with TOTP.",
      threadId: 12,
    });

    const result = listSecurityAuditEventsFromDatabase(database, {
      threadId: 11,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.threadId).toBe(11);
    expect(result[0]?.payload).toBeNull();
  });

  it("supports project-scoped queries when no thread filter is supplied", () => {
    const database = createTestDatabase();

    createSecurityAuditEvent(database, {
      eventType: "project_task_queued",
      payloadJson: JSON.stringify({
        taskKind: "script",
      }),
      projectId: 5,
      summaryText: "Queued a project task for Codex execution.",
      threadId: 51,
    });
    createSecurityAuditEvent(database, {
      eventType: "project_deleted",
      payloadJson: JSON.stringify({
        projectName: "Other",
      }),
      projectId: 6,
      summaryText: "Deleted project Other.",
    });

    const result = listSecurityAuditEventsFromDatabase(database, {
      projectId: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.projectId).toBe(5);
    expect(result[0]?.eventType).toBe("project_task_queued");
  });
});
