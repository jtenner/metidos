/**
 * @file src/bun/plugin/host-capabilities.ts
 * @description Language-neutral permissioned Plugin host capability operations for runtime adapters.
 */

import {
  assertPluginCalendarEventsPermission,
  isPluginCalendarEventsOperation,
} from "./calendar-events";
import { PluginPermissionError } from "./context";
import { assertPluginCanEmbedPermission } from "./embeddings";
import { executePluginFetch } from "./fetch";
import {
  assertPluginLanceDbPermission,
  isPluginLanceDbOperation,
} from "./lancedb";
import {
  assertPluginNotificationSendPermission,
  normalizePluginNotificationRequest,
} from "./notifications";
import type { PluginRuntimeApiOptions } from "./plugin-runtime-contract";
import {
  assertPluginSqlitePermission,
  isPluginSqliteOperation,
} from "./sqlite";
import {
  assertPluginTerminalPermission,
  isPluginTerminalOperation,
} from "./terminal";

export type PluginHostCapabilityMetadata = {
  context: unknown | null;
  deadlineMs: number | null;
};

export type PluginHostCapabilityErrorFactory = (message: string) => Error;

export type PluginHostCapabilityOperationInput = {
  createError: PluginHostCapabilityErrorFactory;
  metadata: PluginHostCapabilityMetadata;
  pluginApi?: PluginRuntimeApiOptions | undefined;
};

function api(
  input: PluginHostCapabilityOperationInput,
): PluginRuntimeApiOptions {
  return input.pluginApi ?? {};
}

function unavailable(
  input: PluginHostCapabilityOperationInput,
  message: string,
): Error {
  return input.createError(message);
}

function operationString(input: {
  createError: PluginHostCapabilityErrorFactory;
  family: string;
  operation: unknown;
}): string {
  if (typeof input.operation === "string") {
    return input.operation;
  }
  throw input.createError(
    `Plugin ${input.family} operation ${String(input.operation)} is not supported.`,
  );
}

export async function executePluginHostFetchOperation(
  input: PluginHostCapabilityOperationInput & {
    options: unknown;
    url: unknown;
  },
): Promise<unknown> {
  const pluginApi = api(input);
  return await executePluginFetch({
    context: {
      network: pluginApi.network,
      permissions: pluginApi.permissions ?? [],
      unsafeAllowPrivateNetwork: pluginApi.unsafeAllowPrivateNetwork,
    },
    options: input.options,
    url: typeof input.url === "string" ? input.url : String(input.url),
  });
}

export async function executePluginHostCalendarEventsOperation(
  input: PluginHostCapabilityOperationInput & {
    operation: unknown;
    params: unknown;
  },
): Promise<unknown> {
  const operation = operationString({
    createError: input.createError,
    family: "calendar/events",
    operation: input.operation,
  });
  if (!isPluginCalendarEventsOperation(operation)) {
    throw input.createError(
      `Plugin calendar/events operation ${String(input.operation)} is not supported.`,
    );
  }
  const pluginApi = api(input);
  assertPluginCalendarEventsPermission({
    operation,
    permissions: pluginApi.permissions ?? [],
  });
  if (!pluginApi.calendarEvents) {
    throw unavailable(input, "Plugin calendar/events host API is unavailable.");
  }
  return await pluginApi.calendarEvents(operation, {
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostTerminalOperation(
  input: PluginHostCapabilityOperationInput & {
    operation: unknown;
    params: unknown;
  },
): Promise<unknown> {
  const operation = operationString({
    createError: input.createError,
    family: "terminal",
    operation: input.operation,
  });
  if (!isPluginTerminalOperation(operation)) {
    throw input.createError(
      `Plugin terminal operation ${String(input.operation)} is not supported.`,
    );
  }
  const pluginApi = api(input);
  assertPluginTerminalPermission({
    operation,
    permissions: pluginApi.permissions ?? [],
  });
  if (!pluginApi.terminal) {
    throw unavailable(input, "Plugin terminal host API is unavailable.");
  }
  return await pluginApi.terminal(operation, {
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostSqliteOperation(
  input: PluginHostCapabilityOperationInput & {
    operation: unknown;
    params: unknown;
  },
): Promise<unknown> {
  const operation = operationString({
    createError: input.createError,
    family: "SQLite",
    operation: input.operation,
  });
  if (!isPluginSqliteOperation(operation)) {
    throw input.createError(
      `Plugin SQLite operation ${String(input.operation)} is not supported.`,
    );
  }
  const pluginApi = api(input);
  const virtualPath =
    input.params && typeof input.params === "object" && "path" in input.params
      ? (input.params as { path?: unknown }).path
      : null;
  assertPluginSqlitePermission({
    permissions: pluginApi.permissions ?? [],
    virtualPath: typeof virtualPath === "string" ? virtualPath : null,
  });
  if (!pluginApi.sqlite) {
    throw unavailable(input, "Plugin SQLite host API is unavailable.");
  }
  return await pluginApi.sqlite(operation, {
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostLanceDbOperation(
  input: PluginHostCapabilityOperationInput & {
    operation: unknown;
    params: unknown;
  },
): Promise<unknown> {
  const operation = operationString({
    createError: input.createError,
    family: "LanceDB",
    operation: input.operation,
  });
  if (!isPluginLanceDbOperation(operation)) {
    throw input.createError(
      `Plugin LanceDB operation ${String(input.operation)} is not supported.`,
    );
  }
  const pluginApi = api(input);
  assertPluginLanceDbPermission(pluginApi.permissions ?? []);
  if (!pluginApi.lancedb) {
    throw unavailable(input, "Plugin LanceDB host API is unavailable.");
  }
  return await pluginApi.lancedb(operation, {
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostEmbeddingsOperation(
  input: PluginHostCapabilityOperationInput & {
    params: unknown;
  },
): Promise<unknown> {
  const pluginApi = api(input);
  assertPluginCanEmbedPermission(pluginApi.permissions ?? []);
  if (!pluginApi.embeddings) {
    throw unavailable(input, "Plugin embeddings host API is unavailable.");
  }
  return await pluginApi.embeddings({
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostLogOperation(
  input: PluginHostCapabilityOperationInput & {
    params: unknown;
  },
): Promise<unknown> {
  const pluginApi = api(input);
  if (!(pluginApi.permissions ?? []).includes("log:write")) {
    throw new PluginPermissionError({
      message: "metidos.log requires log:write.",
      permission: "log:write",
    });
  }
  if (!pluginApi.log) {
    throw unavailable(input, "Plugin log host API is unavailable.");
  }
  return await pluginApi.log({
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostNotificationSendOperation(
  input: PluginHostCapabilityOperationInput & {
    request: unknown;
  },
): Promise<unknown> {
  const pluginApi = api(input);
  assertPluginNotificationSendPermission(pluginApi.permissions ?? []);
  if (!pluginApi.sendNotification) {
    throw unavailable(input, "Plugin notification host API is unavailable.");
  }
  return await pluginApi.sendNotification({
    ...normalizePluginNotificationRequest(input.request),
    ...input.metadata,
  });
}

export async function executePluginHostFsOperation(
  input: PluginHostCapabilityOperationInput & {
    operation: unknown;
    params: unknown;
  },
): Promise<unknown> {
  const pluginApi = api(input);
  if (!pluginApi.fs) {
    throw unavailable(input, "Plugin fs host API is unavailable.");
  }
  return await pluginApi.fs(String(input.operation), {
    ...input.metadata,
    params: input.params,
  });
}

export async function executePluginHostWebSocketOperation(
  input: PluginHostCapabilityOperationInput & {
    operation: unknown;
    params: unknown;
  },
): Promise<unknown> {
  const pluginApi = api(input);
  if (!pluginApi.webSocket) {
    throw unavailable(input, "Plugin WebSocket host API is unavailable.");
  }
  return await pluginApi.webSocket(String(input.operation), {
    ...input.metadata,
    params: input.params,
  });
}
