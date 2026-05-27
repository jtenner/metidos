/**
 * @file src/bun/plugin/sidecar-host-framing.ts
 * @description Shared host-request framing helpers for Plugin System v1 sidecars.
 */

import {
  isPluginCalendarEventsOperation,
  PluginCalendarEventsError,
} from "./calendar-events";
import { PluginFsReadError } from "./fs-read";
import { PluginFsWriteError } from "./fs-write";
import { PluginLogError } from "./log";
import { PluginNotificationError } from "./notifications";
import {
  encodePluginSidecarRpcEnvelope,
  type PluginSidecarHostRequestEnvelope,
} from "./sidecar-rpc";
import { isPluginSqliteOperation, PluginSqliteError } from "./sqlite";
import { isPluginTerminalOperation, PluginTerminalError } from "./terminal";
import { isPluginWebSocketOperation, PluginWebSocketError } from "./websocket";

export type PluginHostRequestObject = Record<string, unknown>;

export function normalizePluginHostRequestObject(
  value: unknown,
): PluginHostRequestObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PluginHostRequestObject)
    : {};
}

export function normalizePluginHostOptionalObject(
  value: unknown,
): PluginHostRequestObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PluginHostRequestObject)
    : null;
}

export function normalizePluginHostRequestPayload(
  envelope: PluginSidecarHostRequestEnvelope,
): {
  context: PluginHostRequestObject | null;
  params: PluginHostRequestObject;
  request: PluginHostRequestObject;
} {
  const request = normalizePluginHostRequestObject(envelope.payload.params);
  return {
    context: normalizePluginHostOptionalObject(request.context),
    params: normalizePluginHostRequestObject(request.params),
    request,
  };
}

export function createPluginHostResponseFrame(input: {
  envelope: PluginSidecarHostRequestEnvelope;
  pluginId: string;
  result: unknown;
}): string | null {
  const frame = encodePluginSidecarRpcEnvelope({
    id: `${input.envelope.id}:response`,
    payload: {
      requestId: input.envelope.id,
      result: input.result,
    },
    pluginId: input.pluginId,
    type: "host.response",
  });
  return typeof frame === "string" ? frame : null;
}

export function createPluginHostErrorFrame(input: {
  code: string;
  envelope: PluginSidecarHostRequestEnvelope;
  message: string;
  pluginId: string;
}): string | null {
  const frame = encodePluginSidecarRpcEnvelope({
    id: `${input.envelope.id}:error`,
    payload: {
      code: input.code,
      message: input.message,
      requestId: input.envelope.id,
      retryable: false,
    },
    pluginId: input.pluginId,
    type: "host.error",
  });
  return typeof frame === "string" ? frame : null;
}

function isPluginHostFilesystemOperation(operation: string): boolean {
  return [
    "fs.exists",
    "fs.glob",
    "fs.ls",
    "fs.mkdir",
    "fs.read",
    "fs.readText",
    "fs.stat",
    "fs.write",
    "fs.writeText",
  ].includes(operation);
}

export function selectPluginHostRequestErrorCode(input: {
  error: unknown;
  operation: string;
}): string {
  const { error, operation } = input;
  if (
    error instanceof PluginCalendarEventsError ||
    error instanceof PluginFsReadError ||
    error instanceof PluginFsWriteError ||
    error instanceof PluginLogError ||
    error instanceof PluginNotificationError ||
    error instanceof PluginSqliteError ||
    error instanceof PluginTerminalError ||
    error instanceof PluginWebSocketError
  ) {
    return error.code;
  }
  if (error instanceof Error && "code" in error) {
    return String((error as { code?: unknown }).code);
  }
  if (isPluginCalendarEventsOperation(operation)) {
    return "plugin_calendar_events_failed";
  }
  if (isPluginHostFilesystemOperation(operation)) {
    return "plugin_fs_failed";
  }
  if (isPluginTerminalOperation(operation)) {
    return "plugin_terminal_failed";
  }
  if (isPluginWebSocketOperation(operation)) {
    return "plugin_websocket_failed";
  }
  if (isPluginSqliteOperation(operation)) {
    return "plugin_sqlite_failed";
  }
  if (operation === "metidos.log" || operation === "metidos.log.batch") {
    return "plugin_log_failed";
  }
  if (operation === "notifications.send") {
    return "plugin_notification_failed";
  }
  return "plugin_host_request_failed";
}
