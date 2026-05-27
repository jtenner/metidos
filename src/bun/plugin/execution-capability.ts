/**
 * @file src/bun/plugin/execution-capability.ts
 * @description Internal capability seam for Plugin System v1 agent tools, Cron callbacks, and GC callbacks.
 */

import type { AppDataPathOptions } from "../db";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { PluginGcError } from "./data";
import {
  type PluginRuntimeSettings,
  readPluginSettingsForRuntime,
} from "./settings";
import type { PluginSidecarStartupSettingsPayload } from "./sidecar-rpc";
import type {
  PluginStartupGcRegistration,
  PluginStartupRegistrations,
  PluginStartupToolRegistration,
} from "./startup-registrations";
import { filterPluginToolRegistrationsForThread } from "./tool-access";

export const PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MIN_MS = 1_000;
export const PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MAX_MS = 600_000;
export const PLUGIN_SIDECAR_TOOL_FAILURE_MESSAGE = "Tool call failed.";
export const PLUGIN_SIDECAR_UNAVAILABLE_TOOL_FAILURE_MESSAGE =
  "Tool call failed, plugin completely unavailable.";

export type PluginCapabilitySidecarRequest = {
  directoryName?: string;
  operation: string;
  params?: unknown;
  pluginId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type PluginAgentToolContext = {
  contextKind: "threadTool";
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type PluginCronExecutionContext = {
  contextKind: "cron";
  settings?: PluginSidecarStartupSettingsPayload;
};

export type PluginAgentToolRegistrationForThread = {
  directoryName: string;
  filesReadAllowlist: readonly string[];
  filesReadDenylist: readonly string[];
  permissions: readonly string[];
  pluginId: string;
  pluginPath: string;
  registration: PluginStartupToolRegistration;
};

export type PluginExecutionCapabilitySession = {
  directoryName: string;
  plugin: RpcPluginInventoryPlugin;
  ready?: boolean;
  registrations: PluginStartupRegistrations | null;
  stopping?: boolean;
};

export type PluginCronExecutionPlan<TSession> = {
  registration: PluginStartupRegistrations["crons"][number];
  request: PluginCapabilitySidecarRequest;
  session: TSession;
};

export type PluginGcExecutionPlan<TSession> = {
  registration: PluginStartupGcRegistration;
  request: PluginCapabilitySidecarRequest;
  session: TSession;
};

export class PluginSidecarToolCallError extends Error {
  readonly code: string;
  readonly diagnosticMessage: string;
  readonly pluginUnavailable: boolean;

  constructor(input: {
    cause?: unknown;
    code: string;
    diagnosticMessage?: string;
    pluginUnavailable?: boolean;
  }) {
    super(
      input.pluginUnavailable
        ? PLUGIN_SIDECAR_UNAVAILABLE_TOOL_FAILURE_MESSAGE
        : PLUGIN_SIDECAR_TOOL_FAILURE_MESSAGE,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginSidecarToolCallError";
    this.code = input.code;
    this.diagnosticMessage =
      input.diagnosticMessage ??
      (input.cause instanceof Error ? input.cause.message : this.message);
    this.pluginUnavailable = input.pluginUnavailable ?? false;
  }
}

export function normalizePluginCallbackTimeoutMs(
  timeoutMs: number | undefined,
): number {
  if (timeoutMs === undefined) {
    return PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MIN_MS;
  }
  if (!Number.isFinite(timeoutMs)) {
    return PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MIN_MS;
  }
  return Math.min(
    PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MAX_MS,
    Math.max(PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MIN_MS, Math.trunc(timeoutMs)),
  );
}

export function pluginSettingsDeclarations(plugin: RpcPluginInventoryPlugin) {
  return plugin.manifest.settings;
}

export function pluginRuntimeSettingsForStartup(
  settings: PluginRuntimeSettings,
): PluginSidecarStartupSettingsPayload {
  return {
    missingRequiredKeys: [...settings.missingRequiredKeys],
    values: {
      ...settings.values,
    } as PluginSidecarStartupSettingsPayload["values"],
  };
}

export function missingRequiredPluginSettingsMessage(keys: string[]): string {
  return `Missing required plugin settings: ${keys.join(", ")}.`;
}

export function errorMessageForUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function diagnosticMessageForUnknown(error: unknown): string {
  if (error instanceof PluginSidecarToolCallError) {
    return error.diagnosticMessage;
  }
  return errorMessageForUnknown(error);
}

export function diagnosticCodeForUnknown(error: unknown): string {
  if (error instanceof PluginSidecarToolCallError) {
    return error.code;
  }
  if (error instanceof Error && "code" in error) {
    return String(
      (error as { code?: unknown }).code ?? "plugin_operation_failed",
    );
  }
  return "plugin_operation_failed";
}

export function shouldRetainPluginOperationFailureDiagnostic(
  code: string,
): boolean {
  return code !== "cancelled" && code !== "host_shutdown";
}

export function pluginOperationTimeoutRejection(input: {
  operation: string;
  timeoutMs: number;
}): { code: "timeout"; diagnosticMessage: string } {
  return {
    code: "timeout",
    diagnosticMessage: `Plugin operation ${input.operation} timed out after ${input.timeoutMs}ms.`,
  };
}

export function pluginOperationCancellationRejection(input: {
  operation: string;
}): { code: "cancelled"; diagnosticMessage: string } {
  return {
    code: "cancelled",
    diagnosticMessage: `Plugin operation ${input.operation} was cancelled by the caller.`,
  };
}

export function createPluginPreDispatchCancellationError(input: {
  operation: string;
  reason?: unknown;
}): PluginSidecarToolCallError {
  return new PluginSidecarToolCallError({
    cause: input.reason,
    code: "cancelled",
    diagnosticMessage: `Plugin operation ${input.operation} was cancelled before dispatch.`,
  });
}

function isReadyCapabilitySession(
  session: PluginExecutionCapabilitySession | null | undefined,
): session is PluginExecutionCapabilitySession {
  return Boolean(session?.ready && !session.stopping);
}

export function listPluginAgentToolRegistrationsForThread(input: {
  enabledAccessGroups: readonly string[];
  sessions: Iterable<PluginExecutionCapabilitySession>;
}): PluginAgentToolRegistrationForThread[] {
  const tools: PluginAgentToolRegistrationForThread[] = [];
  for (const session of input.sessions) {
    if (
      !isReadyCapabilitySession(session) ||
      !session.plugin.pluginId ||
      !session.registrations
    ) {
      continue;
    }
    for (const registration of filterPluginToolRegistrationsForThread({
      enabledAccessGroups: input.enabledAccessGroups,
      plugin: session.plugin,
      tools: session.registrations.tools,
    })) {
      tools.push({
        directoryName: session.directoryName,
        filesReadAllowlist: session.plugin.manifest.files.allow.read,
        filesReadDenylist: session.plugin.manifest.files.deny.read,
        permissions: session.plugin.manifest.permissions,
        pluginId: session.plugin.pluginId,
        pluginPath: session.plugin.folderPath,
        registration,
      });
    }
  }
  return tools.sort((left, right) =>
    left.registration.runtimeId.localeCompare(right.registration.runtimeId),
  );
}

export async function buildPluginAgentToolSidecarRequest(input: {
  appDataOptions: AppDataPathOptions;
  context: PluginAgentToolContext;
  params: unknown;
  registration: PluginAgentToolRegistrationForThread;
  session: PluginExecutionCapabilitySession | null | undefined;
  signal?: AbortSignal;
}): Promise<PluginCapabilitySidecarRequest> {
  const { registration } = input.registration;
  const settings = input.session?.plugin.pluginId
    ? await readPluginSettingsForRuntime({
        declarations: pluginSettingsDeclarations(input.session.plugin),
        directoryName: input.session.directoryName,
        options: input.appDataOptions,
      })
    : null;
  if (settings && settings.missingRequiredKeys.length > 0) {
    throw new PluginSidecarToolCallError({
      code: "missing_required_plugin_settings",
      cause: new Error(
        missingRequiredPluginSettingsMessage(settings.missingRequiredKeys),
      ),
    });
  }
  return {
    directoryName: input.registration.directoryName,
    operation: "tool.call",
    params: {
      actionHandle: registration.actionHandle,
      context: {
        ...input.context,
        ...(settings
          ? { settings: pluginRuntimeSettingsForStartup(settings) }
          : {}),
      },
      props: input.params,
      tool: registration.tool,
      validatePropsHandle: registration.validatePropsHandle,
    },
    pluginId: input.registration.pluginId,
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: registration.timeoutMs,
  };
}

export function findPluginCronExecutionSession<
  TSession extends PluginExecutionCapabilitySession,
>(input: { fullKey: string; sessions: Iterable<TSession> }): TSession | null {
  for (const session of input.sessions) {
    if (
      isReadyCapabilitySession(session) &&
      session.registrations?.crons.some(
        (cron) => cron.fullKey === input.fullKey,
      )
    ) {
      return session;
    }
  }
  return null;
}

export async function buildPluginCronSidecarRequest<
  TSession extends PluginExecutionCapabilitySession,
>(input: {
  appDataOptions: AppDataPathOptions;
  fullKey: string;
  session: TSession | null | undefined;
}): Promise<PluginCronExecutionPlan<TSession>> {
  const session = input.session;
  if (!session?.plugin.pluginId) {
    throw new PluginSidecarToolCallError({
      code: "plugin_cron_unavailable",
      pluginUnavailable: true,
    });
  }
  const registration = session.registrations?.crons.find(
    (candidate) => candidate.fullKey === input.fullKey,
  );
  if (!registration) {
    throw new PluginSidecarToolCallError({
      code: "plugin_cron_unregistered",
    });
  }
  const context: PluginCronExecutionContext = {
    contextKind: "cron",
  };
  const settings = await readPluginSettingsForRuntime({
    declarations: pluginSettingsDeclarations(session.plugin),
    directoryName: session.directoryName,
    options: input.appDataOptions,
  });
  return {
    registration,
    request: {
      directoryName: session.directoryName,
      operation: "cron.run",
      params: {
        actionHandle: registration.actionHandle,
        context: {
          ...context,
          settings: pluginRuntimeSettingsForStartup(settings),
        },
        fullKey: registration.fullKey,
        key: registration.key,
      },
      pluginId: session.plugin.pluginId,
      timeoutMs: registration.timeoutMs,
    },
    session,
  };
}

export function buildPluginGcSidecarRequest<
  TSession extends PluginExecutionCapabilitySession,
>(input: {
  directoryName: string;
  session: TSession | null | undefined;
}): PluginGcExecutionPlan<TSession> {
  const session = input.session;
  if (!session?.plugin.pluginId) {
    throw new PluginGcError({
      code: "plugin_unavailable",
      message: "Plugin GC failed because the plugin runtime is unavailable.",
    });
  }
  const registration = session.registrations?.gc;
  if (!registration) {
    throw new PluginGcError({
      code: "plugin_gc_unregistered",
      message: "Plugin GC callback is not registered.",
    });
  }

  const timeoutMs =
    registration.timeoutMs ?? session.plugin.manifest.gc?.timeoutMs ?? null;
  return {
    registration,
    request: {
      directoryName: input.directoryName,
      operation: "metidos.gc",
      params: { actionHandle: registration.actionHandle, virtualRoot: "~/" },
      ...(timeoutMs === null ? {} : { timeoutMs }),
    },
    session,
  };
}

export function mapPluginGcSidecarFailure(error: unknown): PluginGcError {
  if (error instanceof PluginGcError) {
    return error;
  }
  return new PluginGcError({
    cause: error,
    code:
      error instanceof PluginSidecarToolCallError
        ? error.code
        : "plugin_gc_failed",
  });
}
