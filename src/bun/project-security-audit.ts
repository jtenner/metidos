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
type RunProjectTaskParams =
  AppRPCSchema["requests"]["runProjectTask"]["params"];

function stringifyPayload(
  payload: Record<string, string | number | boolean | null>,
): string {
  return JSON.stringify(payload);
}

function normalizeUnsafeMode(value: boolean | number): boolean {
  return value === true || value === 1;
}

function taskLabel(task: RunProjectTaskParams["task"]): string {
  if (task.kind === "script") {
    return task.scriptName?.trim() || task.title;
  }
  return task.path;
}

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

export function recordProjectTaskQueuedAuditEvent(
  database: Database,
  input: {
    createdThread: boolean;
    params: RunProjectTaskParams;
    thread: Pick<
      ThreadRecord,
      "id" | "projectId" | "unsafeMode" | "worktreePath"
    >;
  },
): void {
  createSecurityAuditEvent(database, {
    eventType: "project_task_queued",
    payloadJson: stringifyPayload({
      createdThread: input.createdThread,
      taskKind: input.params.task.kind,
      taskLabel: taskLabel(input.params.task),
      unsafeMode: normalizeUnsafeMode(input.thread.unsafeMode),
    }),
    projectId: input.thread.projectId,
    summaryText: "Queued a project task for Codex execution.",
    threadId: input.thread.id,
    worktreePath: input.thread.worktreePath,
  });
}

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
