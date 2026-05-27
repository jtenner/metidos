/**
 * @file src/bun/security-audit-cli.test.ts
 * @description Test file for security audit cli.
 */

import { describe, expect, it } from "bun:test";

import {
  formatSecurityAuditEventsForCli,
  parseSecurityAuditCliArgs,
} from "./security-audit-cli";

describe("security audit CLI helpers", () => {
  it("parses JSON output plus scoped limit flags", () => {
    expect(
      parseSecurityAuditCliArgs([
        "--json",
        "--limit",
        "25",
        "--project-id=7",
        "--thread-id",
        "11",
      ]),
    ).toEqual({
      format: "json",
      limit: 25,
      projectId: 7,
      showHelp: false,
      threadId: 11,
    });
  });

  it("formats audit events into readable text output", () => {
    const output = formatSecurityAuditEventsForCli([
      {
        createdAt: "2026-04-03T12:00:00.000Z",
        eventType: "project_deleted",
        id: 1,
        payload: {
          projectName: "Repo",
        },
        projectId: 4,
        summaryText: "Deleted project Repo.",
        threadId: 9,
        worktreePath: "/repo",
      },
    ]);

    expect(output).toContain("[2026-04-03T12:00:00.000Z] project_deleted");
    expect(output).toContain("project: 4");
    expect(output).toContain("thread: 9");
    expect(output).toContain("payload:");
  });

  it("rejects invalid integer flags", () => {
    expect(() => parseSecurityAuditCliArgs(["--limit", "zero"])).toThrow(
      "Expected --limit to be a positive integer.",
    );
  });
});
