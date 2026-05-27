/**
 * @file src/bun/plugin/sidecar-main.ts
 * @description Minimal Plugin System v1 sidecar entrypoint managed over stdio.
 */

import {
  isPluginCalendarEventsOperation,
  type PluginCalendarEventsOperation,
} from "./calendar-events";
import {
  assertPluginCapability,
  type PluginCapabilityGateContext,
} from "./capability-gate";
import { buildPluginEntrypoint } from "./entrypoint-build";
import {
  type PluginFsReadContext,
  pluginFsExists,
  pluginFsGlob,
  pluginFsLs,
  pluginFsRead,
  pluginFsReadText,
  pluginFsStat,
} from "./fs-read";
import {
  type PluginFsWriteContext,
  pluginFsMkdir,
  pluginFsRm,
  pluginFsWrite,
  pluginFsWriteText,
} from "./fs-write";
import {
  assertPluginLogPermission,
  normalizePluginLogRequest,
  type PluginLogRequest,
} from "./log";
import { startPluginRuntime } from "./plugin-runtime";
import { PluginPythonRuntimeError } from "./python-runtime";
import {
  type PluginQuickJsRuntimeCalendarEventsCaller,
  PluginQuickJsRuntimeError,
  type PluginQuickJsRuntimeFsCaller,
  type PluginQuickJsRuntimeInstance,
  type PluginQuickJsRuntimeLogger,
  type PluginQuickJsRuntimeNotificationSender,
  type PluginQuickJsRuntimeSqliteCaller,
  type PluginQuickJsRuntimeTerminalCaller,
  type PluginQuickJsRuntimeWebSocketCaller,
} from "./quickjs-runtime";
import {
  decodePluginSidecarRpcEnvelope,
  encodePluginSidecarRpcEnvelope,
  PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
  type PluginSidecarHostEnvelope,
  type PluginSidecarStartupPayload,
} from "./sidecar-rpc";
import { isPluginLanceDbOperation } from "./lancedb";
import { isPluginSqliteOperation, type PluginSqliteOperation } from "./sqlite";
import {
  isPluginTerminalOperation,
  type PluginTerminalOperation,
} from "./terminal";

const TEXT_DECODER = new TextDecoder();
let protocolStdoutWriter = (text: string): void => {
  process.stdout.write(text);
};
let protocolStderrWriter = (text: string): void => {
  process.stderr.write(text);
};
const EXPECTED_PLUGIN_ID = process.env.METIDOS_PLUGIN_ID?.trim() ?? "";
const EXPECTED_PLUGIN_ROOT =
  process.env.METIDOS_PLUGIN_ROOT?.trim() ?? process.cwd();
const QUICKJS_MEMORY_LIMIT_BYTES = positiveIntegerFromEnv(
  process.env.METIDOS_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES,
);

let activeRuntime: PluginQuickJsRuntimeInstance | null = null;
let activeHostRequestId: string | null = null;
let hostRequestSequence = 0;
const PLUGIN_LOG_BATCH_MAX_ENTRIES = 64;
const PLUGIN_LOG_BATCH_MAX_MESSAGE_BYTES = 16 * 1024;
const PLUGIN_LOG_BATCH_MAX_DELAY_MS = 25;
const PLUGIN_HOST_REQUEST_TIMEOUT_DEFAULT_MS = 60_000;
export const PLUGIN_HOST_REQUEST_TIMEOUT_MAX_MS = 10 * 60_000;
export const PLUGIN_HOST_REQUEST_MAX_PENDING = 64;
let pendingLogFlush: Promise<unknown> | null = null;
let pluginLogFlushTimer: ReturnType<typeof setTimeout> | null = null;
const queuedPluginLogEntries: PluginLogRequest[] = [];
let droppedPluginLogEntries = 0;
const pendingHostRequests = new Map<
  string,
  {
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

class PluginSidecarHostRequestError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string }) {
    super(input.message);
    this.name = "PluginSidecarHostRequestError";
    this.code = input.code;
  }
}

function positiveIntegerFromEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function configurePluginSidecarIo(input: {
  stderr?: ((text: string) => void) | undefined;
  stdout?: ((text: string) => void) | undefined;
}): void {
  protocolStdoutWriter = input.stdout ?? protocolStdoutWriter;
  protocolStderrWriter = input.stderr ?? protocolStderrWriter;
}

export function isPluginSidecarHostSettlementFrame(frame: string): boolean {
  try {
    const envelope = JSON.parse(frame) as { type?: unknown };
    return envelope.type === "host.response" || envelope.type === "host.error";
  } catch {
    return false;
  }
}

function writeProtocolEnvelope(
  envelope: Parameters<typeof encodePluginSidecarRpcEnvelope>[0],
): void {
  const encoded = encodePluginSidecarRpcEnvelope(envelope);
  if (typeof encoded === "string") {
    protocolStdoutWriter(encoded);
    return;
  }
  protocolStderrWriter(
    `Failed to encode sidecar protocol envelope: ${encoded.error.message}\n`,
  );
}

function writeSidecarError(input: {
  code: string;
  message: string;
  pluginId?: string;
  requestId?: string;
}): void {
  writeProtocolEnvelope({
    id: input.requestId ?? "sidecar-error",
    payload: {
      code: input.code,
      message: input.message,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      retryable: false,
    },
    pluginId: input.pluginId ?? EXPECTED_PLUGIN_ID,
    type: "sidecar.error",
  });
}

function isHostEnvelope(
  envelope: unknown,
): envelope is PluginSidecarHostEnvelope {
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    "type" in envelope &&
    typeof envelope.type === "string" &&
    envelope.type.startsWith("host.")
  );
}

function missingRequiredEnvKeys(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.startup" }>,
): string[] {
  return envelope.payload.env
    .filter((envVar) => envVar.required && envVar.value === null)
    .map((envVar) => envVar.key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function errorCodeForCallbackFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/context/i.test(message)) {
    return "plugin_context_error";
  }
  if (/permission/i.test(message)) {
    return "plugin_permission_error";
  }
  if (/timed out/i.test(message)) {
    return "plugin_callback_timeout";
  }
  return "plugin_tool_failed";
}

function errorCodeForNotificationProviderFailure(error: unknown): string {
  const code = errorCodeForCallbackFailure(error);
  return code === "plugin_tool_failed"
    ? "plugin_notification_provider_failed"
    : code;
}

function errorCodeForModelProviderFailure(error: unknown): string {
  const code = errorCodeForCallbackFailure(error);
  return code === "plugin_tool_failed" ? "plugin_model_provider_failed" : code;
}

function normalizeOAuthCredential(
  result: unknown,
): Record<string, unknown> | null {
  if (result === null || result === undefined) {
    return null;
  }
  if (!isRecord(result)) {
    throw new Error(
      "OAuth provider callback must return a credential object or null.",
    );
  }
  const access = stringField(result, "access");
  if (!access) {
    throw new Error("OAuth credential access must be a non-empty string.");
  }
  const expires = result.expires;
  if (
    typeof expires !== "number" ||
    !Number.isFinite(expires) ||
    expires <= 0
  ) {
    throw new Error(
      "OAuth credential expires must be a positive timestamp in milliseconds.",
    );
  }
  const refresh = result.refresh;
  if (
    refresh !== undefined &&
    refresh !== null &&
    typeof refresh !== "string"
  ) {
    throw new Error("OAuth credential refresh must be a string when provided.");
  }
  return { ...result, access, expires, type: "oauth" };
}

function normalizeModelProviderConfigurations(
  providerId: string,
  result: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(result)) {
    throw new Error(
      `metidos.providers.addProvider ${providerId}.getProviderConfigurations must return an array.`,
    );
  }
  return result.map((configuration, index) => {
    if (!isRecord(configuration)) {
      throw new Error(
        `metidos.providers.addProvider ${providerId}.getProviderConfigurations[${index}] must be an object.`,
      );
    }
    const id = stringField(configuration, "id");
    if (!id) {
      throw new Error(
        `metidos.providers.addProvider ${providerId}.getProviderConfigurations[${index}].id must be a non-empty string.`,
      );
    }
    return { ...configuration };
  });
}

function nextHostRequestId(): string {
  hostRequestSequence += 1;
  return `${EXPECTED_PLUGIN_ID}:host-request:${hostRequestSequence}`;
}

async function withActiveHostRequest<T>(
  requestId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previousRequestId = activeHostRequestId;
  activeHostRequestId = requestId;
  try {
    return await callback();
  } finally {
    activeHostRequestId = previousRequestId;
  }
}

export function normalizeSidecarHostRequestDeadlineMs(
  deadlineMs: unknown,
  nowMs = Date.now(),
): { deadlineMs: number; timeoutMs: number } {
  const requestedTimeoutMs =
    typeof deadlineMs === "number" && Number.isFinite(deadlineMs)
      ? Math.trunc(deadlineMs - nowMs)
      : PLUGIN_HOST_REQUEST_TIMEOUT_DEFAULT_MS;
  const timeoutMs = Math.min(
    PLUGIN_HOST_REQUEST_TIMEOUT_MAX_MS,
    Math.max(1, requestedTimeoutMs),
  );
  return {
    deadlineMs: nowMs + timeoutMs,
    timeoutMs,
  };
}

function pluginLogMessageBytes(message: string): number {
  return new TextEncoder().encode(message).byteLength;
}

function isPluginFsReadOperation(operation: string): boolean {
  return [
    "fs.exists",
    "fs.glob",
    "fs.ls",
    "fs.read",
    "fs.stat",
    "fs.readText",
  ].includes(operation);
}

const MAX_PLUGIN_HOST_BINARY_PAYLOAD_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_HOST_BINARY_PAYLOAD_BYTES = 6 * 1024 * 1024;
const PLUGIN_HOST_BINARY_PAYLOAD_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function pluginBytesHostPayload(value: Uint8Array): {
  __metidosBytesBase64: string;
} {
  return { __metidosBytesBase64: Buffer.from(value).toString("base64") };
}

function assertPluginBinaryPayloadSize(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > MAX_PLUGIN_HOST_BINARY_PAYLOAD_BYTES) {
    throw new Error(
      `Plugin binary payload must be at most ${MAX_PLUGIN_HOST_BINARY_PAYLOAD_BYTES} bytes.`,
    );
  }
  return bytes;
}

function pluginBytesFromPayload(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return assertPluginBinaryPayloadSize(value);
  }
  if (value instanceof ArrayBuffer) {
    return assertPluginBinaryPayloadSize(new Uint8Array(value));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const encoded = (value as Record<string, unknown>).__metidosBytesBase64;
    if (typeof encoded === "string") {
      const normalized = encoded.trim();
      if (
        normalized.length > MAX_PLUGIN_HOST_BINARY_PAYLOAD_BASE64_BYTES ||
        !PLUGIN_HOST_BINARY_PAYLOAD_BASE64_PATTERN.test(normalized)
      ) {
        throw new Error("Plugin binary payload must be valid bounded base64.");
      }
      return assertPluginBinaryPayloadSize(
        new Uint8Array(Buffer.from(normalized, "base64")),
      );
    }
  }
  return new Uint8Array();
}

function sidecarFsContextKind(
  context: Record<string, unknown> | null,
): "startup" | "threadTool" {
  return context?.contextKind === "threadTool" ? "threadTool" : "startup";
}

export async function executeSidecarLocalFsOperation(input: {
  operation: string;
  permissions: readonly string[];
  request: unknown;
  startup: PluginSidecarStartupPayload;
}): Promise<unknown> {
  if (!input.startup.fs) {
    return requestHostOperation({
      operation: input.operation,
      params: input.request,
      permissions: input.permissions,
    });
  }
  const request =
    input.request &&
    typeof input.request === "object" &&
    !Array.isArray(input.request)
      ? (input.request as Record<string, unknown>)
      : {};
  const callbackContext =
    request.context &&
    typeof request.context === "object" &&
    !Array.isArray(request.context)
      ? (request.context as Record<string, unknown>)
      : null;
  const params =
    request.params &&
    typeof request.params === "object" &&
    !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};
  const worktreePath =
    callbackContext && typeof callbackContext.worktreePath === "string"
      ? callbackContext.worktreePath
      : null;
  const path = typeof params.path === "string" ? params.path : "";
  if (isPluginFsReadOperation(input.operation)) {
    const context: PluginFsReadContext = {
      contextKind: sidecarFsContextKind(callbackContext),
      filesReadAllowlist: input.startup.fs.files.allow.read,
      filesReadDenylist: input.startup.fs.files.deny.read,
      permissions: input.permissions,
      pluginPath: input.startup.fs.pluginPath,
      projectRootPath: worktreePath,
      threadRootPath: worktreePath,
    };
    const pattern = typeof params.pattern === "string" ? params.pattern : "";
    return input.operation === "fs.exists"
      ? pluginFsExists(context, path)
      : input.operation === "fs.glob"
        ? pluginFsGlob(context, pattern)
        : input.operation === "fs.ls"
          ? pluginFsLs(context, path)
          : input.operation === "fs.read"
            ? pluginBytesHostPayload(await pluginFsRead(context, path))
            : input.operation === "fs.stat"
              ? pluginFsStat(context, path)
              : pluginFsReadText(context, path);
  }
  const context: PluginFsWriteContext = {
    contextKind: sidecarFsContextKind(callbackContext),
    filesDeleteAllowlist: input.startup.fs.files.allow.delete,
    filesDeleteDenylist: input.startup.fs.files.deny.delete,
    filesReadAllowlist: input.startup.fs.files.allow.read,
    filesReadDenylist: input.startup.fs.files.deny.read,
    filesWriteAllowlist: input.startup.fs.files.allow.write,
    filesWriteDenylist: input.startup.fs.files.deny.write,
    permissions: input.permissions,
    pluginPath: input.startup.fs.pluginPath,
    projectRootPath: worktreePath,
    quota: input.startup.fs.quota,
    threadRootPath: worktreePath,
  };
  const options =
    params.options !== null &&
    params.options !== undefined &&
    typeof params.options === "object" &&
    !Array.isArray(params.options)
      ? (params.options as Record<string, unknown>)
      : {};
  return input.operation === "fs.mkdir"
    ? pluginFsMkdir(context, path, {
        recursive: options.recursive === true,
      })
    : input.operation === "fs.rm"
      ? pluginFsRm(context, path, {
          force: options.force === true,
          recursive: options.recursive === true,
        })
      : input.operation === "fs.write"
        ? pluginFsWrite(context, path, pluginBytesFromPayload(params.bytes))
        : pluginFsWriteText(
            context,
            path,
            typeof params.contents === "string" ? params.contents : "",
          );
}

async function flushPluginLogBatch(): Promise<unknown> {
  if (pluginLogFlushTimer) {
    clearTimeout(pluginLogFlushTimer);
    pluginLogFlushTimer = null;
  }
  if (pendingLogFlush) {
    await pendingLogFlush;
  }
  if (queuedPluginLogEntries.length === 0 && droppedPluginLogEntries === 0) {
    return { entries: 0, logged: false, path: null, pruning: null };
  }
  const entries = queuedPluginLogEntries.splice(
    0,
    queuedPluginLogEntries.length,
  );
  if (droppedPluginLogEntries > 0) {
    entries.push({
      level: "warn",
      message: `Dropped ${droppedPluginLogEntries} plugin log entries because the sidecar log queue was full.`,
    });
    droppedPluginLogEntries = 0;
  }
  pendingLogFlush = requestHostOperation({
    operation: "metidos.log.batch",
    params: { entries },
  }).finally(() => {
    pendingLogFlush = null;
  });
  return pendingLogFlush;
}

function schedulePluginLogFlush(): void {
  if (pluginLogFlushTimer) {
    return;
  }
  pluginLogFlushTimer = setTimeout(() => {
    void flushPluginLogBatch().catch((error) => {
      protocolStderrWriter(
        `Plugin log batch flush failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  }, PLUGIN_LOG_BATCH_MAX_DELAY_MS);
  pluginLogFlushTimer.unref?.();
}

async function enqueuePluginLog(input: {
  permissions: readonly string[];
  request: unknown;
}): Promise<unknown> {
  assertPluginLogPermission(input.permissions);
  const rawRequest =
    input.request &&
    typeof input.request === "object" &&
    !Array.isArray(input.request) &&
    "params" in input.request
      ? (input.request as { params?: unknown }).params
      : input.request;
  const normalized = normalizePluginLogRequest(rawRequest);
  if (
    pluginLogMessageBytes(normalized.message) >
    PLUGIN_LOG_BATCH_MAX_MESSAGE_BYTES
  ) {
    droppedPluginLogEntries += 1;
    return { logged: false, path: null, pruning: null, dropped: true };
  }
  if (queuedPluginLogEntries.length >= PLUGIN_LOG_BATCH_MAX_ENTRIES) {
    queuedPluginLogEntries.shift();
    droppedPluginLogEntries += 1;
  }
  queuedPluginLogEntries.push(normalized);
  if (queuedPluginLogEntries.length >= PLUGIN_LOG_BATCH_MAX_ENTRIES) {
    return flushPluginLogBatch();
  }
  schedulePluginLogFlush();
  return { queued: true };
}

function rejectPendingHostRequests(input: { code: string; message: string }) {
  for (const [requestId, pending] of pendingHostRequests) {
    pendingHostRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(new PluginSidecarHostRequestError(input));
  }
}

function handleHostResponse(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.response" }>,
): void {
  const pending = pendingHostRequests.get(envelope.payload.requestId);
  if (!pending) {
    return;
  }
  pendingHostRequests.delete(envelope.payload.requestId);
  clearTimeout(pending.timer);
  pending.resolve(envelope.payload.result);
}

function handleHostError(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.error" }>,
): void {
  const requestId = envelope.payload.requestId ?? "";
  const pending = pendingHostRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingHostRequests.delete(requestId);
  clearTimeout(pending.timer);
  pending.reject(
    new PluginSidecarHostRequestError({
      code: envelope.payload.code,
      message: envelope.payload.message,
    }),
  );
}

export async function assertSidecarHostOperationAllowed(input: {
  operation: string;
  params?: unknown;
  permissions: readonly string[];
}): Promise<void> {
  const request =
    input.params &&
    typeof input.params === "object" &&
    !Array.isArray(input.params)
      ? (input.params as Record<string, unknown>)
      : {};
  const context =
    request.context &&
    typeof request.context === "object" &&
    !Array.isArray(request.context)
      ? (request.context as PluginCapabilityGateContext)
      : {};
  const params =
    request.params &&
    typeof request.params === "object" &&
    !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};
  const gateContext: PluginCapabilityGateContext = {
    ...context,
    permissions: input.permissions,
    pluginPath: EXPECTED_PLUGIN_ROOT,
  };

  // Sidecar-local checks intentionally cover only decisions available from the
  // startup permission snapshot and per-call callback metadata. Maincar checks
  // remain authoritative for canonical state such as admin status, quotas,
  // rate limits, and resource ownership.
  if (isPluginCalendarEventsOperation(input.operation)) {
    await assertPluginCapability({
      context: gateContext,
      request: {
        kind: "calendar",
        operation: input.operation as PluginCalendarEventsOperation,
        params,
      },
    });
    return;
  }
  if (isPluginTerminalOperation(input.operation)) {
    await assertPluginCapability({
      context: gateContext,
      request: {
        kind: "terminal",
        operation: input.operation as PluginTerminalOperation,
      },
    });
    return;
  }
  if (isPluginSqliteOperation(input.operation)) {
    await assertPluginCapability({
      context: gateContext,
      request: {
        kind: "sqlite",
        operation: input.operation as PluginSqliteOperation,
        virtualPath: typeof params.path === "string" ? params.path : "",
      },
    });
    return;
  }
  if (isPluginLanceDbOperation(input.operation)) {
    await assertPluginCapability({
      context: gateContext,
      request: {
        kind: "permission",
        operation: input.operation,
        permission: "metidos:lancedb",
      },
    });
    await assertPluginCapability({
      context: gateContext,
      request: {
        kind: "permission",
        operation: input.operation,
        permission: "storage:write",
      },
    });
    return;
  }
  if (input.operation === "notifications.send") {
    await assertPluginCapability({
      context: gateContext,
      request: { kind: "notification", operation: "send" },
    });
  }
}

async function requestHostOperation(input: {
  deadlineMs?: unknown;
  operation: string;
  params?: unknown;
  permissions?: readonly string[];
}): Promise<unknown> {
  await assertSidecarHostOperationAllowed({
    operation: input.operation,
    params: input.params,
    permissions: input.permissions ?? [],
  });
  if (pendingHostRequests.size >= PLUGIN_HOST_REQUEST_MAX_PENDING) {
    throw new PluginSidecarHostRequestError({
      code: "too_many_host_requests",
      message: `Plugin sidecar has ${PLUGIN_HOST_REQUEST_MAX_PENDING} pending host requests.`,
    });
  }
  const requestId = nextHostRequestId();
  const requestedDeadline = normalizeSidecarHostRequestDeadlineMs(
    input.deadlineMs,
  );
  const payload: {
    deadlineMs?: number;
    hostRequestId?: string;
    operation: string;
    params?: unknown;
  } = { operation: input.operation };
  if (activeHostRequestId) {
    payload.hostRequestId = activeHostRequestId;
  }
  if (
    typeof input.deadlineMs === "number" &&
    Number.isFinite(input.deadlineMs)
  ) {
    payload.deadlineMs = requestedDeadline.deadlineMs;
  }
  if (input.params !== undefined) {
    payload.params = input.params;
  }
  const encodedRequest = encodePluginSidecarRpcEnvelope({
    id: requestId,
    payload,
    pluginId: EXPECTED_PLUGIN_ID,
    type: "sidecar.request",
  });
  if (typeof encodedRequest !== "string") {
    throw new PluginSidecarHostRequestError({
      code: encodedRequest.error.code,
      message: encodedRequest.error.message,
    });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostRequests.delete(requestId);
      reject(
        new PluginSidecarHostRequestError({
          code: "host_request_timeout",
          message: `Plugin host request ${input.operation} timed out.`,
        }),
      );
    }, requestedDeadline.timeoutMs);
    timer.unref?.();
    pendingHostRequests.set(requestId, { reject, resolve, timer });
    try {
      protocolStdoutWriter(encodedRequest);
    } catch (error) {
      pendingHostRequests.delete(requestId);
      clearTimeout(timer);
      reject(
        new PluginSidecarHostRequestError({
          code: "host_request_write_failed",
          message:
            error instanceof Error
              ? error.message
              : `Plugin host request ${input.operation} could not be written.`,
        }),
      );
    }
  });
}

async function handleModelProviderRefreshRequest(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.request" }>,
): Promise<void> {
  if (!activeRuntime) {
    writeSidecarError({
      code: "plugin_runtime_not_ready",
      message: "Plugin callbacks are unavailable before startup completes.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const params = envelope.payload.params;
  if (!isRecord(params)) {
    writeSidecarError({
      code: "invalid_model_provider_refresh",
      message: "Plugin model provider refresh params must be an object.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const providerId = stringField(params, "providerId");
  const handle = stringField(params, "getProviderConfigurationsHandle");
  if (!providerId || !handle) {
    writeSidecarError({
      code: "invalid_model_provider_refresh",
      message:
        "Plugin model provider refresh requires providerId and getProviderConfigurationsHandle.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const deadlineMs =
    typeof envelope.payload.deadlineMs === "number" &&
    Number.isFinite(envelope.payload.deadlineMs)
      ? envelope.payload.deadlineMs
      : Date.now();
  try {
    const result = await activeRuntime.invokeCallback({
      args: [],
      deadlineMs,
      handle,
      label: `Plugin model provider ${providerId} refresh`,
    });
    writeProtocolEnvelope({
      id: `${envelope.id}:response`,
      payload: {
        requestId: envelope.id,
        result: normalizeModelProviderConfigurations(providerId, result),
      },
      pluginId: envelope.pluginId,
      type: "sidecar.response",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolStderrWriter(
      `Plugin model provider ${providerId} refresh failed: ${message}\n`,
    );
    writeSidecarError({
      code: errorCodeForModelProviderFailure(error),
      message,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
  }
}

async function handleModelProviderCallbackRequest(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.request" }>,
  input: {
    callbackField: "embedHandle" | "executeHandle";
    failureCode: string;
    label: string;
    missingMessage: string;
  },
): Promise<void> {
  if (!activeRuntime) {
    writeSidecarError({
      code: "plugin_runtime_not_ready",
      message: "Plugin callbacks are unavailable before startup completes.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const params = envelope.payload.params;
  if (!isRecord(params)) {
    writeSidecarError({
      code: input.failureCode,
      message: `Plugin model provider ${input.label} params must be an object.`,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const providerId = stringField(params, "providerId");
  const handle = stringField(params, input.callbackField);
  if (!providerId || !handle) {
    writeSidecarError({
      code: input.failureCode,
      message: input.missingMessage,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const deadlineMs =
    typeof envelope.payload.deadlineMs === "number" &&
    Number.isFinite(envelope.payload.deadlineMs)
      ? envelope.payload.deadlineMs
      : Date.now();
  try {
    const result = await activeRuntime.invokeCallback({
      args: [params.context ?? {}, params.request ?? {}],
      deadlineMs,
      handle,
      label: `Plugin model provider ${providerId} ${input.label}`,
    });
    writeProtocolEnvelope({
      id: `${envelope.id}:response`,
      payload: {
        requestId: envelope.id,
        result,
      },
      pluginId: envelope.pluginId,
      type: "sidecar.response",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolStderrWriter(
      `Plugin model provider ${providerId} ${input.label} failed: ${message}\n`,
    );
    writeSidecarError({
      code: errorCodeForModelProviderFailure(error),
      message,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
  }
}

async function handleCronRunRequest(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.request" }>,
): Promise<void> {
  if (!activeRuntime) {
    writeSidecarError({
      code: "plugin_runtime_not_ready",
      message: "Plugin callbacks are unavailable before startup completes.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const params = envelope.payload.params;
  if (!isRecord(params)) {
    writeSidecarError({
      code: "invalid_cron_run",
      message: "Plugin cron run params must be an object.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const actionHandle = stringField(params, "actionHandle");
  const fullKey = stringField(params, "fullKey") ?? envelope.pluginId;
  if (!actionHandle) {
    writeSidecarError({
      code: "invalid_cron_run",
      message: "Plugin cron run requires actionHandle.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const deadlineMs =
    typeof envelope.payload.deadlineMs === "number" &&
    Number.isFinite(envelope.payload.deadlineMs)
      ? envelope.payload.deadlineMs
      : Date.now();
  try {
    const result = await activeRuntime.invokeCallback({
      args: [params.context ?? { contextKind: "cron", ownerUserId: null }],
      deadlineMs,
      handle: actionHandle,
      label: `Plugin cron ${fullKey}`,
    });
    writeProtocolEnvelope({
      id: `${envelope.id}:response`,
      payload: {
        requestId: envelope.id,
        result,
      },
      pluginId: envelope.pluginId,
      type: "sidecar.response",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolStderrWriter(`Plugin cron ${fullKey} failed: ${message}\n`);
    writeSidecarError({
      code: errorCodeForCallbackFailure(error),
      message,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
  }
}

async function handleNotificationProviderSendRequest(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.request" }>,
): Promise<void> {
  if (!activeRuntime) {
    writeSidecarError({
      code: "plugin_runtime_not_ready",
      message: "Plugin callbacks are unavailable before startup completes.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const params = envelope.payload.params;
  if (!isRecord(params)) {
    writeSidecarError({
      code: "invalid_notification_provider_send",
      message: "Plugin notification provider send params must be an object.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const providerId = stringField(params, "providerId");
  const sendHandle = stringField(params, "sendHandle");
  if (!providerId || !sendHandle) {
    writeSidecarError({
      code: "invalid_notification_provider_send",
      message:
        "Plugin notification provider send requires providerId and sendHandle.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const deadlineMs =
    typeof envelope.payload.deadlineMs === "number" &&
    Number.isFinite(envelope.payload.deadlineMs)
      ? envelope.payload.deadlineMs
      : Date.now();
  try {
    const result = await activeRuntime.invokeCallback({
      args: [params.request ?? {}],
      deadlineMs,
      handle: sendHandle,
      label: `Plugin notification provider ${providerId} send`,
    });
    writeProtocolEnvelope({
      id: `${envelope.id}:response`,
      payload: {
        requestId: envelope.id,
        result,
      },
      pluginId: envelope.pluginId,
      type: "sidecar.response",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolStderrWriter(
      `Plugin notification provider ${providerId} failed: ${message}\n`,
    );
    writeSidecarError({
      code: errorCodeForNotificationProviderFailure(error),
      message,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
  }
}

async function handleOAuthProviderRequest(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.request" }>,
): Promise<void> {
  if (!activeRuntime) {
    writeSidecarError({
      code: "plugin_runtime_not_ready",
      message: "Plugin callbacks are unavailable before startup completes.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const params = envelope.payload.params;
  if (!isRecord(params)) {
    writeSidecarError({
      code: "invalid_oauth_provider_request",
      message: "Plugin OAuth provider params must be an object.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const providerId = stringField(params, "providerId");
  const handle = stringField(params, "handle");
  if (!providerId || !handle) {
    writeSidecarError({
      code: "invalid_oauth_provider_request",
      message: "Plugin OAuth provider request requires providerId and handle.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const deadlineMs =
    typeof envelope.payload.deadlineMs === "number" &&
    Number.isFinite(envelope.payload.deadlineMs)
      ? envelope.payload.deadlineMs
      : Date.now();
  try {
    const args =
      envelope.payload.operation === "oauth.provider.refresh"
        ? [params.credentials]
        : [params.context ?? { contextKind: "oauthProvider" }];
    const result = await activeRuntime.invokeCallback({
      args,
      deadlineMs,
      handle,
      label: `Plugin OAuth provider ${providerId}`,
    });
    writeProtocolEnvelope({
      id: `${envelope.id}:response`,
      payload: {
        requestId: envelope.id,
        result: normalizeOAuthCredential(result),
      },
      pluginId: envelope.pluginId,
      type: "sidecar.response",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolStderrWriter(
      `Plugin OAuth provider ${providerId} failed: ${message}\n`,
    );
    writeSidecarError({
      code: errorCodeForCallbackFailure(error),
      message,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
  }
}

async function handleToolCallRequest(
  envelope: Extract<PluginSidecarHostEnvelope, { type: "host.request" }>,
): Promise<void> {
  if (!activeRuntime) {
    writeSidecarError({
      code: "plugin_runtime_not_ready",
      message: "Plugin callbacks are unavailable before startup completes.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  if (envelope.payload.operation === "model.provider.refresh") {
    await handleModelProviderRefreshRequest(envelope);
    return;
  }
  if (envelope.payload.operation === "model.provider.execute") {
    await handleModelProviderCallbackRequest(envelope, {
      callbackField: "executeHandle",
      failureCode: "invalid_model_provider_execute",
      label: "execution",
      missingMessage:
        "Plugin model provider execution requires providerId and executeHandle.",
    });
    return;
  }
  if (envelope.payload.operation === "model.provider.embed") {
    await handleModelProviderCallbackRequest(envelope, {
      callbackField: "embedHandle",
      failureCode: "invalid_model_provider_embed",
      label: "embedding",
      missingMessage:
        "Plugin model provider embedding requires providerId and embedHandle.",
    });
    return;
  }
  if (envelope.payload.operation === "notification.provider.send") {
    await handleNotificationProviderSendRequest(envelope);
    return;
  }
  if (
    envelope.payload.operation === "oauth.provider.import" ||
    envelope.payload.operation === "oauth.provider.refresh"
  ) {
    await handleOAuthProviderRequest(envelope);
    return;
  }
  if (envelope.payload.operation === "cron.run") {
    await handleCronRunRequest(envelope);
    return;
  }
  if (envelope.payload.operation === "metidos.gc") {
    const params = envelope.payload.params;
    if (!isRecord(params)) {
      writeSidecarError({
        code: "invalid_plugin_gc",
        message: "Plugin GC params must be an object.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const actionHandle = stringField(params, "actionHandle");
    if (!actionHandle) {
      writeSidecarError({
        code: "invalid_plugin_gc",
        message: "Plugin GC requires actionHandle.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const deadlineMs =
      typeof envelope.payload.deadlineMs === "number" &&
      Number.isFinite(envelope.payload.deadlineMs)
        ? envelope.payload.deadlineMs
        : Date.now();
    try {
      const result = await activeRuntime.invokeCallback({
        args: [
          {
            contextKind: "gc",
            virtualRoot: "~/",
          },
        ],
        deadlineMs,
        handle: actionHandle,
        label: "Plugin GC",
      });
      writeProtocolEnvelope({
        id: `${envelope.id}:response`,
        payload: {
          requestId: envelope.id,
          result,
        },
        pluginId: envelope.pluginId,
        type: "sidecar.response",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      protocolStderrWriter(`Plugin GC failed: ${message}\n`);
      writeSidecarError({
        code: errorCodeForCallbackFailure(error),
        message,
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
    }
    return;
  }
  if (envelope.payload.operation === "ingress.poll") {
    const params = envelope.payload.params;
    if (!isRecord(params)) {
      writeSidecarError({
        code: "invalid_ingress_poll",
        message: "Plugin ingress poll params must be an object.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const sourceId = stringField(params, "sourceId");
    const pollHandle = stringField(params, "pollHandle");
    if (!sourceId || !pollHandle) {
      writeSidecarError({
        code: "invalid_ingress_poll",
        message: "Plugin ingress poll requires sourceId and pollHandle.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const rawContext = isRecord(params.context) ? params.context : {};
    const deadlineMs =
      typeof envelope.payload.deadlineMs === "number" &&
      Number.isFinite(envelope.payload.deadlineMs)
        ? envelope.payload.deadlineMs
        : Date.now();
    try {
      const result = await activeRuntime.invokeCallback({
        args: [rawContext],
        deadlineMs,
        handle: pollHandle,
        label: `Plugin ingress source ${sourceId} poll`,
      });
      writeProtocolEnvelope({
        id: `${envelope.id}:response`,
        payload: { requestId: envelope.id, result },
        pluginId: envelope.pluginId,
        type: "sidecar.response",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      protocolStderrWriter(
        `Plugin ingress source ${sourceId} poll failed: ${message}\n`,
      );
      writeSidecarError({
        code: errorCodeForCallbackFailure(error),
        message,
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
    }
    return;
  }
  if (envelope.payload.operation === "ingress.prompt.template") {
    const params = envelope.payload.params;
    if (!isRecord(params)) {
      writeSidecarError({
        code: "invalid_ingress_prompt_template",
        message: "Plugin ingress prompt template params must be an object.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const sourceId = stringField(params, "sourceId");
    const promptTemplateHandle = stringField(params, "promptTemplateHandle");
    if (!sourceId || !promptTemplateHandle) {
      writeSidecarError({
        code: "invalid_ingress_prompt_template",
        message:
          "Plugin ingress prompt template requires sourceId and promptTemplateHandle.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const rawContext = isRecord(params.context) ? params.context : {};
    const deadlineMs =
      typeof envelope.payload.deadlineMs === "number" &&
      Number.isFinite(envelope.payload.deadlineMs)
        ? envelope.payload.deadlineMs
        : Date.now();
    try {
      const result = await activeRuntime.invokeCallback({
        args: [rawContext],
        deadlineMs,
        handle: promptTemplateHandle,
        label: `Plugin ingress source ${sourceId} prompt template`,
      });
      writeProtocolEnvelope({
        id: `${envelope.id}:response`,
        payload: { requestId: envelope.id, result },
        pluginId: envelope.pluginId,
        type: "sidecar.response",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      protocolStderrWriter(
        `Plugin ingress source ${sourceId} prompt template failed: ${message}\n`,
      );
      writeSidecarError({
        code: errorCodeForCallbackFailure(error),
        message,
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
    }
    return;
  }
  if (envelope.payload.operation === "ingress.respond") {
    const params = envelope.payload.params;
    if (!isRecord(params)) {
      writeSidecarError({
        code: "invalid_ingress_respond",
        message: "Plugin ingress respond params must be an object.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const sourceId = stringField(params, "sourceId");
    const respondHandle = stringField(params, "respondHandle");
    if (!sourceId || !respondHandle) {
      writeSidecarError({
        code: "invalid_ingress_respond",
        message: "Plugin ingress respond requires sourceId and respondHandle.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const rawContext = isRecord(params.context) ? params.context : {};
    const rawPayload = isRecord(params.payload) ? params.payload : {};
    const deadlineMs =
      typeof envelope.payload.deadlineMs === "number" &&
      Number.isFinite(envelope.payload.deadlineMs)
        ? envelope.payload.deadlineMs
        : Date.now();
    try {
      const result = await activeRuntime.invokeCallback({
        args: [rawContext, rawPayload],
        deadlineMs,
        handle: respondHandle,
        label: `Plugin ingress source ${sourceId} respond`,
      });
      writeProtocolEnvelope({
        id: `${envelope.id}:response`,
        payload: { requestId: envelope.id, result },
        pluginId: envelope.pluginId,
        type: "sidecar.response",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      protocolStderrWriter(
        `Plugin ingress source ${sourceId} respond failed: ${message}\n`,
      );
      writeSidecarError({
        code: errorCodeForCallbackFailure(error),
        message,
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
    }
    return;
  }
  if (envelope.payload.operation === "prompt.inject") {
    const params = envelope.payload.params;
    if (!isRecord(params)) {
      writeSidecarError({
        code: "invalid_prompt_injection",
        message: "Plugin prompt injection params must be an object.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const promptHandle = stringField(params, "promptHandle");
    const inject = stringField(params, "inject");
    const prompt = stringField(params, "prompt");
    if (!promptHandle || !inject) {
      writeSidecarError({
        code: "invalid_prompt_injection",
        message: "Plugin prompt injection requires inject and promptHandle.",
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
      return;
    }
    const deadlineMs =
      typeof envelope.payload.deadlineMs === "number" &&
      Number.isFinite(envelope.payload.deadlineMs)
        ? envelope.payload.deadlineMs
        : Date.now();
    try {
      const result = await activeRuntime.invokeCallback({
        args: [params.context ?? {}, prompt],
        deadlineMs,
        handle: promptHandle,
        label: `Plugin prompt injection ${inject}`,
      });
      writeProtocolEnvelope({
        id: `${envelope.id}:response`,
        payload: { requestId: envelope.id, result },
        pluginId: envelope.pluginId,
        type: "sidecar.response",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeSidecarError({
        code: errorCodeForCallbackFailure(error),
        message,
        pluginId: envelope.pluginId,
        requestId: envelope.id,
      });
    }
    return;
  }
  if (envelope.payload.operation !== "tool.call") {
    writeSidecarError({
      code: "unsupported_operation",
      message: `Plugin sidecar operation ${envelope.payload.operation} is not supported.`,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const params = envelope.payload.params;
  if (!isRecord(params)) {
    writeSidecarError({
      code: "invalid_tool_call",
      message: "Plugin tool call params must be an object.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }
  const tool = stringField(params, "tool");
  const validatePropsHandle = stringField(params, "validatePropsHandle");
  const actionHandle = stringField(params, "actionHandle");
  if (!tool || !validatePropsHandle || !actionHandle) {
    writeSidecarError({
      code: "invalid_tool_call",
      message:
        "Plugin tool call requires tool, validatePropsHandle, and actionHandle.",
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
    return;
  }

  const deadlineMs =
    typeof envelope.payload.deadlineMs === "number" &&
    Number.isFinite(envelope.payload.deadlineMs)
      ? envelope.payload.deadlineMs
      : Date.now();
  try {
    const validatedProps = await activeRuntime.invokeCallback({
      args: [params.props],
      deadlineMs,
      handle: validatePropsHandle,
      label: `Plugin tool ${tool} validateProps`,
    });
    const result = await activeRuntime.invokeCallback({
      args: [params.context ?? {}, validatedProps],
      deadlineMs,
      handle: actionHandle,
      label: `Plugin tool ${tool} action`,
    });
    writeProtocolEnvelope({
      id: `${envelope.id}:response`,
      payload: {
        requestId: envelope.id,
        result,
      },
      pluginId: envelope.pluginId,
      type: "sidecar.response",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    protocolStderrWriter(`Plugin tool ${tool} failed: ${message}\n`);
    writeSidecarError({
      code: errorCodeForCallbackFailure(error),
      message,
      pluginId: envelope.pluginId,
      requestId: envelope.id,
    });
  }
}

export async function handlePluginSidecarProtocolFrame(
  frame: string,
): Promise<boolean> {
  const decoded = decodePluginSidecarRpcEnvelope(frame, {
    expectedPluginId: EXPECTED_PLUGIN_ID,
  });
  if (!decoded.ok) {
    writeSidecarError({
      code: decoded.error.code,
      message: decoded.error.message,
      pluginId: decoded.error.pluginId ?? EXPECTED_PLUGIN_ID,
      ...(decoded.error.requestId
        ? { requestId: decoded.error.requestId }
        : {}),
    });
    return true;
  }
  if (!isHostEnvelope(decoded.envelope)) {
    writeSidecarError({
      code: "unexpected_envelope_type",
      message: `Sidecar stdin accepts host-owned envelopes only, not ${decoded.envelope.type}.`,
      pluginId: decoded.envelope.pluginId,
      requestId: decoded.envelope.id,
    });
    return true;
  }

  switch (decoded.envelope.type) {
    case "host.startup": {
      const missingEnvKeys = missingRequiredEnvKeys(decoded.envelope);
      if (missingEnvKeys.length > 0) {
        const message = `Missing required plugin env vars: ${missingEnvKeys.join(", ")}.`;
        protocolStderrWriter(`${message}\n`);
        writeProtocolEnvelope({
          id: `${decoded.envelope.id}:env-error`,
          payload: {
            code: "plugin_env_missing",
            message,
            retryable: false,
          },
          pluginId: decoded.envelope.pluginId,
          type: "sidecar.error",
        });
        return true;
      }
      const startupPayload = decoded.envelope.payload;
      const startupPermissions = startupPayload.permissions ?? [];
      let runtimeResult: PluginQuickJsRuntimeInstance;
      try {
        activeRuntime?.dispose();
        activeRuntime = null;
        const buildResult = await buildPluginEntrypoint({
          pluginRoot: EXPECTED_PLUGIN_ROOT,
        });
        runtimeResult = await startPluginRuntime(buildResult, {
          ...(QUICKJS_MEMORY_LIMIT_BYTES === undefined
            ? {}
            : { memoryLimitBytes: QUICKJS_MEMORY_LIMIT_BYTES }),
          pluginApi: {
            env: startupPayload.env,
            network: startupPayload.network,
            fs: async (operation, request) =>
              (await executeSidecarLocalFsOperation({
                operation,
                permissions: startupPermissions,
                request,
                startup: startupPayload,
              })) as Awaited<ReturnType<PluginQuickJsRuntimeFsCaller>>,
            calendarEvents: async (operation, request) =>
              (await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation: operation as PluginCalendarEventsOperation,
                params: request,
                permissions: startupPermissions,
              })) as Awaited<
                ReturnType<PluginQuickJsRuntimeCalendarEventsCaller>
              >,
            permissions: startupPermissions,
            ...(startupPayload.unsafeAllowPrivateNetwork === undefined
              ? {}
              : {
                  unsafeAllowPrivateNetwork:
                    startupPayload.unsafeAllowPrivateNetwork,
                }),
            terminal: async (operation, request) =>
              (await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation: operation as PluginTerminalOperation,
                params: request,
                permissions: startupPermissions,
              })) as Awaited<ReturnType<PluginQuickJsRuntimeTerminalCaller>>,
            webSocket: async (operation, request) =>
              (await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation,
                params: request,
              })) as Awaited<ReturnType<PluginQuickJsRuntimeWebSocketCaller>>,
            lancedb: async (operation, request) =>
              await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation,
                params: request,
                permissions: startupPermissions,
              }),
            embeddings: async (request) =>
              await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation: "embeddings.embed",
                params: request,
                permissions: startupPermissions,
              }),
            sqlite: async (operation, request) =>
              (await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation: operation as PluginSqliteOperation,
                params: request,
                permissions: startupPermissions,
              })) as Awaited<ReturnType<PluginQuickJsRuntimeSqliteCaller>>,
            log: async (request) =>
              (await enqueuePluginLog({
                permissions: startupPermissions,
                request,
              })) as Awaited<ReturnType<PluginQuickJsRuntimeLogger>>,
            sendNotification: async (request) =>
              (await requestHostOperation({
                deadlineMs:
                  request &&
                  typeof request === "object" &&
                  "deadlineMs" in request
                    ? (request as { deadlineMs?: unknown }).deadlineMs
                    : undefined,
                operation: "notifications.send",
                params: request,
                permissions: startupPermissions,
              })) as Awaited<
                ReturnType<PluginQuickJsRuntimeNotificationSender>
              >,
            ...(startupPayload.settings === undefined
              ? {}
              : { settings: startupPayload.settings }),
          },
        });
        activeRuntime = runtimeResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isBuildFailure = !(
          error instanceof PluginQuickJsRuntimeError ||
          error instanceof PluginPythonRuntimeError
        );
        protocolStderrWriter(
          `${isBuildFailure ? "Plugin entrypoint build failed" : "Plugin QuickJS setup failed"}: ${message}\n`,
        );
        writeProtocolEnvelope({
          id: `${decoded.envelope.id}:${isBuildFailure ? "build-error" : "startup-error"}`,
          payload: {
            code: isBuildFailure
              ? "plugin_build_failed"
              : "plugin_startup_failed",
            message,
            retryable: false,
          },
          pluginId: decoded.envelope.pluginId,
          type: "sidecar.error",
        });
        return true;
      }
      writeProtocolEnvelope({
        id: `${decoded.envelope.id}:ready`,
        payload: {
          protocolVersion: PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
          registrations: runtimeResult.setupResult ?? {},
        },
        pluginId: decoded.envelope.pluginId,
        type: "sidecar.ready",
      });
      return true;
    }
    case "host.shutdown":
      await flushPluginLogBatch().catch((error) => {
        protocolStderrWriter(
          `Plugin log shutdown flush failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
      rejectPendingHostRequests({
        code: "host_shutdown",
        message: "Plugin sidecar host is shutting down.",
      });
      activeRuntime?.dispose();
      activeRuntime = null;
      return false;
    case "host.cancel":
      return true;
    case "host.response":
      handleHostResponse(decoded.envelope);
      return true;
    case "host.error":
      handleHostError(decoded.envelope);
      return true;
    case "host.request": {
      const envelope = decoded.envelope;
      await withActiveHostRequest(envelope.id, () =>
        handleToolCallRequest(envelope),
      );
      return true;
    }
  }
}

async function main(): Promise<void> {
  if (!EXPECTED_PLUGIN_ID) {
    protocolStderrWriter(
      "METIDOS_PLUGIN_ID is required for plugin sidecars.\n",
    );
    process.exit(1);
  }

  const reader = Bun.stdin.stream().getReader();
  let buffer = "";
  let keepRunning = true;
  let queue = Promise.resolve();
  const handleFrameError = (error: unknown): void => {
    protocolStderrWriter(
      `Plugin sidecar failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    keepRunning = false;
    process.exitCode = 1;
  };
  const dispatchFrame = (frame: string): void => {
    const run = async () => {
      const frameKeepRunning = await handlePluginSidecarProtocolFrame(frame);
      if (!frameKeepRunning) {
        keepRunning = false;
      }
    };
    if (isPluginSidecarHostSettlementFrame(frame)) {
      void run().catch(handleFrameError);
      return;
    }
    queue = queue.then(run).catch((error: unknown) => {
      handleFrameError(error);
    });
  };
  try {
    while (keepRunning) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += TEXT_DECODER.decode(chunk.value, { stream: true });
      while (keepRunning) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const frame = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        if (frame.length > 0) {
          dispatchFrame(frame);
          await Promise.resolve();
        }
      }
    }
    await queue;
    await flushPluginLogBatch().catch((error) => {
      protocolStderrWriter(
        `Plugin log final flush failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  } finally {
    reader.releaseLock();
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    protocolStderrWriter(
      `Plugin sidecar failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
