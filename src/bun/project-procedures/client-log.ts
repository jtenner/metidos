import type { Database } from "bun:sqlite";
import { createClientLogEvent } from "../db";
import type {
  AppRPCSchema,
  RpcClientLogRequest,
  RpcRequestContext,
} from "../rpc-schema";
import { requireLocalOperatorUserId } from "./local-operator";

const CLIENT_LOG_MAX_TEXT_LENGTH = 2000;
const CLIENT_LOG_MAX_DETAILS_LENGTH = 8192;
const CLIENT_LOG_SEVERITIES = new Set(["debug", "info", "warn", "error"]);

function trimClientLogText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > CLIENT_LOG_MAX_TEXT_LENGTH
    ? `${trimmed.slice(0, CLIENT_LOG_MAX_TEXT_LENGTH)}…`
    : trimmed;
}

function normalizeClientLogDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") {
    return null;
  }
  try {
    const json = JSON.stringify(details);
    return json.length > CLIENT_LOG_MAX_DETAILS_LENGTH
      ? `${json.slice(0, CLIENT_LOG_MAX_DETAILS_LENGTH)}…`
      : json;
  } catch {
    return JSON.stringify({ value: "[Unserializable]" });
  }
}

export async function logClientEventProcedure(
  database: Database,
  params: RpcClientLogRequest,
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["logClientEvent"]["response"]> {
  const userId = requireLocalOperatorUserId(context);
  const severity = CLIENT_LOG_SEVERITIES.has(params.severity)
    ? params.severity
    : "error";
  const message = trimClientLogText(params.message);
  if (!message) {
    throw new Error("Client log message is required.");
  }
  const event = createClientLogEvent(database, {
    userId,
    severity,
    message,
    detailsJson: normalizeClientLogDetails(params.details),
    route: trimClientLogText(params.route),
    context: trimClientLogText(params.context),
    clientTimestamp: trimClientLogText(params.timestamp),
  });
  return { accepted: true, id: event.id };
}
