/**
 * @file src/bun/security-audit.ts
 * @description Module for security audit.
 */

import type { Database } from "bun:sqlite";

import { listSecurityAuditEvents } from "./db";
import type { RpcSecurityAuditEvent } from "./rpc-schema";

const DEFAULT_SECURITY_AUDIT_LIMIT = 100;
const MAX_SECURITY_AUDIT_LIMIT = 200;

type RpcSecurityAuditPayloadValue = NonNullable<
  RpcSecurityAuditEvent["payload"]
>[string];
/**
 * Function of isRecord.
 * @param value - The value of `value`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Function of isRpcSecurityAuditPayloadValue.
 * @param value - The value of `value`.
 */

function isRpcSecurityAuditPayloadValue(
  value: unknown,
): value is RpcSecurityAuditPayloadValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}
/**
 * Function of normalizeSecurityAuditLimit.
 * @param limit - The value of `limit`.
 */

function normalizeSecurityAuditLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isInteger(limit)) {
    return DEFAULT_SECURITY_AUDIT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_SECURITY_AUDIT_LIMIT, limit));
}
/**
 * Function of normalizeThreadId.
 * @param threadId - The value of `threadId`.
 */

function normalizeThreadId(threadId?: number | null): number | undefined {
  return typeof threadId === "number" &&
    Number.isInteger(threadId) &&
    threadId > 0
    ? threadId
    : undefined;
}
/**
 * Function of normalizeProjectId.
 * @param projectId - The value of `projectId`.
 */

function normalizeProjectId(projectId?: number | null): number | undefined {
  return typeof projectId === "number" &&
    Number.isInteger(projectId) &&
    projectId > 0
    ? projectId
    : undefined;
}
/**
 * Function of parseSecurityAuditPayload.
 * @param payloadJson - The value of `payloadJson`.
 */

function parseSecurityAuditPayload(
  payloadJson: string | null,
): RpcSecurityAuditEvent["payload"] {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const payload: NonNullable<RpcSecurityAuditEvent["payload"]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isRpcSecurityAuditPayloadValue(value)) {
        return null;
      }
      payload[key] = value;
    }
    return payload;
  } catch {
    return null;
  }
}
/**
 * Function of listSecurityAuditEventsFromDatabase.
 * @param database - The value of `database`.
 * @param params - The value of `params`.
 */

export function listSecurityAuditEventsFromDatabase(
  database: Database,
  params: {
    limit?: number;
    projectId?: number | null;
    threadId?: number | null;
  } = {},
): RpcSecurityAuditEvent[] {
  const projectId = normalizeProjectId(params.projectId);
  const threadId = normalizeThreadId(params.threadId);

  return listSecurityAuditEvents(database, {
    limit: normalizeSecurityAuditLimit(params.limit),
    ...(typeof projectId === "number"
      ? {
          projectId,
        }
      : {}),
    ...(typeof threadId === "number"
      ? {
          threadId,
        }
      : {}),
  }).map((event) => ({
    createdAt: event.createdAt,
    eventType: event.eventType,
    id: event.id,
    payload: parseSecurityAuditPayload(event.payloadJson),
    projectId: event.projectId,
    summaryText: event.summaryText,
    threadId: event.threadId,
    worktreePath: event.worktreePath,
  }));
}
