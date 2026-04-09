/**
 * @file src/bun/project-security-audit.ts
 * @description Module for project security audit.
 */

import type { Database } from "bun:sqlite";

import {
  createSecurityAuditEvent,
  type ProjectRecord,
  type ThreadRecord,
} from "./db";
import { createThreadRequiresStepUp } from "./rpc-authz";
import type { AppRPCSchema } from "./rpc-schema";

type CreateThreadParams = AppRPCSchema["requests"]["createThread"]["params"];
/**
 * Stringifies payload.
 * @param payload - payload argument for stringifyPayload.
 */

function stringifyPayload(
  payload: Record<string, string | number | boolean | null>,
): string {
  return JSON.stringify(payload);
}
/**
 * Normalizes unsafe mode.
 * @param value - Input value.
 */

function normalizeUnsafeMode(value: boolean | number): boolean {
  return value === true || value === 1;
}
/**
 * Performs recordCrossWorkspaceThreadAuditEvent operation.
 * @param database - database argument for recordCrossWorkspaceThreadAuditEvent.
 * @param input - input argument for recordCrossWorkspaceThreadAuditEvent.
 */

export function recordCrossWorkspaceThreadAuditEvent(
  database: Database,
  input: {
    params: CreateThreadParams;
    thread: Pick<
      ThreadRecord,
      "id" | "projectId" | "unsafeMode" | "worktreePath"
    >;
  },
): void {
  if (!createThreadRequiresStepUp(input.params)) {
    return;
  }

  createSecurityAuditEvent(database, {
    eventType: "cross_workspace_thread_created",
    payloadJson: stringifyPayload({
      currentProjectId: input.params.currentProjectId ?? null,
      currentWorktreePath: input.params.currentWorktreePath ?? null,
      unsafeMode: normalizeUnsafeMode(input.thread.unsafeMode),
    }),
    projectId: input.thread.projectId,
    summaryText:
      "Created a thread outside the current workspace after step-up authentication.",
    threadId: input.thread.id,
    worktreePath: input.thread.worktreePath,
  });
}
/**
 * Performs recordProjectDeletedAuditEvent operation.
 * @param database - database argument for recordProjectDeletedAuditEvent.
 * @param input - input argument for recordProjectDeletedAuditEvent.
 */

export function recordProjectDeletedAuditEvent(
  database: Database,
  input: {
    project: Pick<ProjectRecord, "id" | "name" | "path">;
    threadCount: number;
  },
): void {
  createSecurityAuditEvent(database, {
    eventType: "project_deleted",
    payloadJson: stringifyPayload({
      projectName: input.project.name,
      projectPath: input.project.path,
      threadCount: input.threadCount,
    }),
    projectId: input.project.id,
    summaryText: `Deleted project ${input.project.name}.`,
  });
}
