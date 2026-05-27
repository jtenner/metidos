/**
 * @file src/bun/plugin/sidecar-host-router.ts
 * @description Host-operation router for Plugin System v1 sidecar requests.
 */

import { Buffer } from "node:buffer";

import type { LogSubsystem } from "../logging";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import {
  executePluginCalendarEventsOperation,
  isPluginCalendarEventsOperation,
  type PluginCalendarEventsHost,
} from "./calendar-events";
import {
  assertPluginCapability,
  type PluginCapabilityGateContext,
} from "./capability-gate";
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
  assertPluginCanEmbedPermission,
  type PluginEmbeddingHost,
} from "./embeddings";
import {
  executePluginLanceDbOperation,
  isPluginLanceDbOperation,
} from "./lancedb";
import {
  executePluginLogBatchOperation,
  executePluginLogOperation,
} from "./log";
import {
  assertPluginNotificationSendPermission,
  normalizePluginNotificationRequest,
  type PluginNotificationDeliveryControls,
  type PluginNotificationSendInput,
  type PluginNotificationSendResult,
} from "./notifications";
import {
  normalizePluginHostOptionalObject,
  normalizePluginHostRequestObject,
  selectPluginHostRequestErrorCode,
} from "./sidecar-host-framing";
import type { PluginSidecarHostRequestEnvelope } from "./sidecar-rpc";
import {
  executePluginSqliteOperation,
  isPluginSqliteOperation,
} from "./sqlite";
import {
  executePluginTerminalOperation,
  isPluginTerminalOperation,
  type PluginTerminalHost,
} from "./terminal";
import {
  executePluginWebSocketOperation,
  isPluginWebSocketOperation,
  type PluginWebSocketRegistry,
} from "./websocket";

type PluginHostRequestRouterLogger = Pick<LogSubsystem, "error" | "warning">;
type PluginUsersHost = unknown;

export type PluginNotificationSender = (
  input: PluginNotificationSendInput,
  controls?: PluginNotificationDeliveryControls,
) => Promise<PluginNotificationSendResult>;

export type PluginHostRequestRouterSession = {
  plugin: RpcPluginInventoryPlugin & { pluginId: string };
  webSockets: PluginWebSocketRegistry;
};

export type PluginHostRequestRouterDependencies = {
  calendarEventsHost: PluginCalendarEventsHost;
  dispatchPluginNotificationProviders: NonNullable<
    PluginNotificationDeliveryControls["providerDispatcher"]
  >;
  embed: PluginEmbeddingHost;
  logger: PluginHostRequestRouterLogger;
  now: () => Date;
  sendNotification: PluginNotificationSender;
  terminalHost: PluginTerminalHost;
  usersHost: PluginUsersHost;
};

export type PluginHostRequestTrustedCallback = {
  context: unknown | null;
  deadlineMs: number;
};

export type PluginHostRequestRouterResult =
  | {
      result: unknown;
      type: "response";
    }
  | {
      code: string;
      message: string;
      operation: string;
      retainFailureDiagnostic: boolean;
      type: "error";
    };

type PluginHostRequestRouteOutcome = {
  result: PluginHostRequestRouterResult;
  routed: true;
};

const MAX_PLUGIN_HOST_BINARY_PAYLOAD_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_HOST_BINARY_PAYLOAD_BYTES = 6 * 1024 * 1024;
const PLUGIN_HOST_BINARY_PAYLOAD_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

class PluginHostBinaryPayloadError extends Error {
  readonly code = "invalid_binary_payload";

  constructor(message: string) {
    super(message);
    this.name = "PluginHostBinaryPayloadError";
  }
}

function unsupportedPluginHostOperation(
  operation: string,
): PluginHostRequestRouteOutcome {
  return {
    result: {
      code: "unsupported_operation",
      message: `Plugin host operation ${operation} is not supported.`,
      operation,
      retainFailureDiagnostic: false,
      type: "error",
    },
    routed: true,
  };
}

function isPluginHostRequestRouteOutcome(
  value: unknown,
): value is PluginHostRequestRouteOutcome {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { routed?: unknown }).routed === true &&
    "result" in value
  );
}

function isPluginFsReadOperation(operation: string): boolean {
  return [
    "fs.exists",
    "fs.glob",
    "fs.ls",
    "fs.read",
    "fs.readText",
    "fs.stat",
  ].includes(operation);
}

function isPluginFsWriteOperation(operation: string): boolean {
  return ["fs.mkdir", "fs.rm", "fs.write", "fs.writeText"].includes(operation);
}

function pluginBytesHostPayload(value: Uint8Array): {
  __metidosBytesBase64: string;
} {
  return { __metidosBytesBase64: Buffer.from(value).toString("base64") };
}

function assertPluginBinaryPayloadSize(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > MAX_PLUGIN_HOST_BINARY_PAYLOAD_BYTES) {
    throw new PluginHostBinaryPayloadError(
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
        throw new PluginHostBinaryPayloadError(
          "Plugin binary payload must be valid bounded base64.",
        );
      }
      return assertPluginBinaryPayloadSize(
        new Uint8Array(Buffer.from(normalized, "base64")),
      );
    }
  }
  return new Uint8Array();
}

async function routePluginHostOperation(input: {
  dependencies: PluginHostRequestRouterDependencies;
  envelope: PluginSidecarHostRequestEnvelope;
  session: PluginHostRequestRouterSession;
  trustedCallback?: PluginHostRequestTrustedCallback | null;
}): Promise<unknown | PluginHostRequestRouteOutcome> {
  const { dependencies, envelope, session, trustedCallback } = input;

  if (isPluginCalendarEventsOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const context = normalizePluginHostOptionalObject(trustedCallback?.context);
    const params = normalizePluginHostRequestObject(request.params);
    await assertPluginCapability({
      context: {
        ...(context ?? {}),
        permissions: session.plugin.manifest.permissions,
      } as PluginCapabilityGateContext,
      request: {
        kind: "calendar",
        operation: envelope.payload.operation,
        params,
      },
    });
    return executePluginCalendarEventsOperation({
      context,
      host: dependencies.calendarEventsHost,
      operation: envelope.payload.operation,
      params: request.params,
      permissions: session.plugin.manifest.permissions,
    });
  }

  if (isPluginTerminalOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const context = normalizePluginHostOptionalObject(trustedCallback?.context);
    await assertPluginCapability({
      context: {
        ...(context ?? {}),
        permissions: session.plugin.manifest.permissions,
      } as PluginCapabilityGateContext,
      request: { kind: "terminal", operation: envelope.payload.operation },
    });
    return executePluginTerminalOperation({
      context,
      host: dependencies.terminalHost,
      operation: envelope.payload.operation,
      params: request.params,
      permissions: session.plugin.manifest.permissions,
    });
  }

  if (isPluginWebSocketOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    return executePluginWebSocketOperation({
      operation: envelope.payload.operation,
      params: request.params,
      registry: session.webSockets,
    });
  }

  if (isPluginFsReadOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const callbackContext = normalizePluginHostOptionalObject(
      trustedCallback?.context,
    );
    const params = normalizePluginHostRequestObject(request.params);
    const worktreePath =
      callbackContext && typeof callbackContext.worktreePath === "string"
        ? callbackContext.worktreePath
        : null;
    const context: PluginFsReadContext = {
      contextKind:
        callbackContext?.contextKind === "threadTool"
          ? "threadTool"
          : "startup",
      filesReadAllowlist: session.plugin.manifest.files.allow.read,
      filesReadDenylist: session.plugin.manifest.files.deny.read,
      permissions: session.plugin.manifest.permissions,
      pluginPath: session.plugin.folderPath,
      projectRootPath: worktreePath,
      threadRootPath: worktreePath,
    };
    const path = typeof params.path === "string" ? params.path : "";
    const pattern = typeof params.pattern === "string" ? params.pattern : "";
    return envelope.payload.operation === "fs.exists"
      ? pluginFsExists(context, path)
      : envelope.payload.operation === "fs.glob"
        ? pluginFsGlob(context, pattern)
        : envelope.payload.operation === "fs.ls"
          ? pluginFsLs(context, path)
          : envelope.payload.operation === "fs.read"
            ? pluginBytesHostPayload(await pluginFsRead(context, path))
            : envelope.payload.operation === "fs.stat"
              ? pluginFsStat(context, path)
              : pluginFsReadText(context, path);
  }

  if (isPluginFsWriteOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const callbackContext = normalizePluginHostOptionalObject(
      trustedCallback?.context,
    );
    const params = normalizePluginHostRequestObject(request.params);
    const worktreePath =
      callbackContext && typeof callbackContext.worktreePath === "string"
        ? callbackContext.worktreePath
        : null;
    const context: PluginFsWriteContext = {
      contextKind:
        callbackContext?.contextKind === "threadTool"
          ? "threadTool"
          : "startup",
      filesDeleteAllowlist: session.plugin.manifest.files.allow.delete,
      filesDeleteDenylist: session.plugin.manifest.files.deny.delete,
      filesReadAllowlist: session.plugin.manifest.files.allow.read,
      filesReadDenylist: session.plugin.manifest.files.deny.read,
      filesWriteAllowlist: session.plugin.manifest.files.allow.write,
      filesWriteDenylist: session.plugin.manifest.files.deny.write,
      permissions: session.plugin.manifest.permissions,
      pluginPath: session.plugin.folderPath,
      projectRootPath: worktreePath,
      quota: session.plugin.lifecycle.settings.quota,
      threadRootPath: worktreePath,
    };
    const path = typeof params.path === "string" ? params.path : "";
    const options =
      params.options !== null &&
      params.options !== undefined &&
      typeof params.options === "object" &&
      !Array.isArray(params.options)
        ? (params.options as Record<string, unknown>)
        : {};
    return envelope.payload.operation === "fs.mkdir"
      ? pluginFsMkdir(context, path, { recursive: options.recursive === true })
      : envelope.payload.operation === "fs.rm"
        ? pluginFsRm(context, path, {
            force: options.force === true,
            recursive: options.recursive === true,
          })
        : envelope.payload.operation === "fs.write"
          ? pluginFsWrite(context, path, pluginBytesFromPayload(params.bytes))
          : pluginFsWriteText(
              context,
              path,
              typeof params.contents === "string" ? params.contents : "",
            );
  }

  if (isPluginSqliteOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const params = normalizePluginHostRequestObject(request.params);
    await assertPluginCapability({
      context: {
        permissions: session.plugin.manifest.permissions,
        pluginPath: session.plugin.folderPath,
      },
      request: {
        kind: "sqlite",
        operation: envelope.payload.operation,
        virtualPath: typeof params.path === "string" ? params.path : "",
      },
    });
    return executePluginSqliteOperation({
      operation: envelope.payload.operation,
      params: request.params,
      permissions: session.plugin.manifest.permissions,
      pluginPath: session.plugin.folderPath,
      quota: session.plugin.lifecycle.settings.quota,
    });
  }

  if (isPluginLanceDbOperation(envelope.payload.operation)) {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const params = normalizePluginHostRequestObject(request.params);
    await assertPluginCapability({
      context: {
        permissions: session.plugin.manifest.permissions,
        pluginPath: session.plugin.folderPath,
      },
      request: {
        kind: "lancedb",
        operation: envelope.payload.operation,
        virtualPath: typeof params.path === "string" ? params.path : "",
      },
    });
    return executePluginLanceDbOperation({
      operation: envelope.payload.operation,
      params,
      permissions: session.plugin.manifest.permissions,
      pluginPath: session.plugin.folderPath,
      quota: session.plugin.lifecycle.settings.quota,
    });
  }

  if (envelope.payload.operation === "embeddings.embed") {
    assertPluginCanEmbedPermission(session.plugin.manifest.permissions);
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    const params = normalizePluginHostRequestObject(request.params);
    return dependencies.embed({
      context: trustedCallback?.context ?? null,
      deadlineMs: trustedCallback?.deadlineMs ?? null,
      input: params.input,
      payload: params.payload,
    });
  }

  if (envelope.payload.operation === "metidos.log.batch") {
    return executePluginLogBatchOperation({
      now: dependencies.now(),
      params: envelope.payload.params,
      permissions: session.plugin.manifest.permissions,
      pluginPath: session.plugin.folderPath,
      settings: session.plugin.lifecycle.settings.log,
    });
  }

  if (envelope.payload.operation === "metidos.log") {
    const request = normalizePluginHostRequestObject(envelope.payload.params);
    return executePluginLogOperation({
      now: dependencies.now(),
      params: request.params,
      permissions: session.plugin.manifest.permissions,
      pluginPath: session.plugin.folderPath,
      settings: session.plugin.lifecycle.settings.log,
    });
  }

  if (envelope.payload.operation !== "notifications.send") {
    return unsupportedPluginHostOperation(envelope.payload.operation);
  }

  assertPluginNotificationSendPermission(session.plugin.manifest.permissions);
  const params = normalizePluginHostRequestObject(envelope.payload.params);
  const request = normalizePluginNotificationRequest(params);
  const context: NonNullable<PluginNotificationSendInput["context"]> | null =
    trustedCallback?.context &&
    typeof trustedCallback.context === "object" &&
    !Array.isArray(trustedCallback.context)
      ? (trustedCallback.context as NonNullable<
          PluginNotificationSendInput["context"]
        >)
      : null;
  return dependencies.sendNotification(
    {
      ...request,
      context,
      pluginId: session.plugin.pluginId,
    },
    {
      logSettings: session.plugin.lifecycle.settings.log,
      logger: dependencies.logger,
      notificationSettings: session.plugin.lifecycle.settings.notifications,
      permissions: session.plugin.manifest.permissions,
      providerDispatcher: (providerInput) =>
        dependencies.dispatchPluginNotificationProviders(providerInput),
    },
  );
}

export async function handlePluginSidecarHostRequest(input: {
  dependencies: PluginHostRequestRouterDependencies;
  envelope: PluginSidecarHostRequestEnvelope;
  session: PluginHostRequestRouterSession;
  trustedCallback?: PluginHostRequestTrustedCallback | null;
}): Promise<PluginHostRequestRouterResult> {
  try {
    const result = await routePluginHostOperation(input);
    if (isPluginHostRequestRouteOutcome(result)) {
      return result.result;
    }
    return { result, type: "response" };
  } catch (error) {
    const code = selectPluginHostRequestErrorCode({
      error,
      operation: input.envelope.payload.operation,
    });
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      operation: input.envelope.payload.operation,
      retainFailureDiagnostic: true,
      type: "error",
    };
  }
}
