import type { Database } from "bun:sqlite";

import { initAppDatabase, listSecurityAuditEvents } from "./db";
import type { AppRPCSchema, RpcSecurityAuditEvent } from "./rpc-schema";

type ListSecurityAuditEventsParams =
  AppRPCSchema["requests"]["listSecurityAuditEvents"]["params"];

const DEFAULT_SECURITY_AUDIT_LIMIT = 100;
const MAX_SECURITY_AUDIT_LIMIT = 200;

type RpcSecurityAuditPayloadValue = NonNullable<
  RpcSecurityAuditEvent["payload"]
>[string];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function normalizeSecurityAuditLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isInteger(limit)) {
    return DEFAULT_SECURITY_AUDIT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_SECURITY_AUDIT_LIMIT, limit));
}

function normalizeThreadId(threadId?: number | null): number | undefined {
  return typeof threadId === "number" &&
    Number.isInteger(threadId) &&
    threadId > 0
    ? threadId
    : undefined;
}

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

export function listSecurityAuditEventsFromDatabase(
  database: Database,
  params: ListSecurityAuditEventsParams = {},
): RpcSecurityAuditEvent[] {
  const threadId = normalizeThreadId(params.threadId);

  return listSecurityAuditEvents(database, {
    limit: normalizeSecurityAuditLimit(params.limit),
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

export function listSecurityAuditEventsProcedure(
  params: ListSecurityAuditEventsParams = {},
): RpcSecurityAuditEvent[] {
  return listSecurityAuditEventsFromDatabase(initAppDatabase(), params);
}
