/**
 * @file src/bun/plugin/capability-gate.ts
 * @description Central Plugin System v1 capability decisions for permission, context, path, network, SQLite, Calendar, Terminal, provider, and notification operations.
 */

import type { RpcPluginManifestNetworkSummary } from "../rpc-schema/plugin";
import {
  type PluginCalendarEventsContext,
  type PluginCalendarEventsOperation,
  permissionForPluginCalendarEventsOperation,
} from "./calendar-events";
import {
  type PluginCallbackContextKind,
  PluginContextError,
  PluginPermissionError,
} from "./context";
import type { PluginFsPathAccess, ResolvedPluginFsPath } from "./fs-path";
import { resolvePluginFsVirtualPath } from "./fs-path";
import {
  PLUGIN_LANCEDB_PERMISSION,
  PLUGIN_LANCEDB_STORAGE_WRITE_PERMISSION,
  type PluginLanceDbOperation,
} from "./lancedb";
import {
  assertPluginNetworkUrlAllowed,
  compilePluginNetworkAllowlist,
} from "./network-allowlist";
import {
  PLUGIN_NOTIFICATION_PROVIDER_PERMISSION,
  PLUGIN_NOTIFICATION_SEND_PERMISSION,
} from "./notifications";
import {
  PLUGIN_SQLITE_PERMISSION,
  PLUGIN_SQLITE_STORAGE_WRITE_PERMISSION,
  type PluginSqliteOperation,
} from "./sqlite";
import {
  PLUGIN_TERMINAL_UNSAFE_PERMISSION,
  type PluginTerminalContext,
  type PluginTerminalOperation,
  permissionForPluginTerminalOperation,
} from "./terminal";

export type PluginCapabilityDecisionCode =
  | "allowed"
  | "invalid_network_policy"
  | "network_url_not_allowed"
  | "plugin_confirmation_unavailable"
  | "plugin_context_error"
  | "plugin_permission_error"
  | "plugin_terminal_unavailable_in_cron"
  | "plugin_unsafe_permission_required"
  | "project_context_unavailable";

export type PluginCapabilityDecision =
  | {
      allowed: true;
      code: "allowed";
      message: string;
      permission?: string | null;
      resolvedPath?: ResolvedPluginFsPath;
      url?: URL;
    }
  | {
      allowed: false;
      code: Exclude<PluginCapabilityDecisionCode, "allowed">;
      message: string;
      permission?: string | null;
    };

export type PluginCapabilityGateContext = {
  contextKind?: PluginCallbackContextKind | string | null;
  enabledAccessGroups?: readonly string[] | null;
  network?: RpcPluginManifestNetworkSummary | null;
  ownerUserId?: number | null;
  permissions: readonly string[];
  pluginId?: string | null;
  pluginPath?: string | null;
  projectId?: number | null;
  projectRootPath?: string | null;
  threadId?: number | null;
  threadRootPath?: string | null;
  worktreePath?: string | null;
};

export type PluginCapabilityRequest =
  | { kind: "accessGroup"; groupId: string; pluginId?: string | null }
  | {
      kind: "calendar";
      operation: PluginCalendarEventsOperation;
      params?: Record<string, unknown> | null;
    }
  | {
      kind: "fs";
      access: PluginFsPathAccess;
      pathAccess?: PluginFsPathAccess;
      virtualPath: string;
    }
  | { kind: "lancedb"; operation: PluginLanceDbOperation; virtualPath: string }
  | { kind: "network"; operation: "fetch" | "websocket"; url: string | URL }
  | { kind: "notification"; operation: "provider" | "send" }
  | { kind: "permission"; operation: string; permission: string }
  | {
      kind: "provider";
      operation: "model" | "notification" | "oauth";
      permission: string;
    }
  | { kind: "sqlite"; operation: PluginSqliteOperation; virtualPath: string }
  | { kind: "terminal"; operation: PluginTerminalOperation };

function allow(
  input: Omit<
    Extract<PluginCapabilityDecision, { allowed: true }>,
    "allowed" | "code" | "message"
  > & { message?: string } = {},
): PluginCapabilityDecision {
  const decision: Extract<PluginCapabilityDecision, { allowed: true }> = {
    allowed: true,
    code: "allowed",
    message: input.message ?? "Plugin capability is allowed.",
  };
  if (input.permission !== undefined) {
    decision.permission = input.permission;
  }
  if (input.resolvedPath !== undefined) {
    decision.resolvedPath = input.resolvedPath;
  }
  if (input.url !== undefined) {
    decision.url = input.url;
  }
  return decision;
}

function deny(input: {
  code: Exclude<PluginCapabilityDecisionCode, "allowed">;
  message: string;
  permission?: string | null;
}): PluginCapabilityDecision {
  return { allowed: false, ...input };
}

function hasPermission(
  context: PluginCapabilityGateContext,
  permission: string,
): boolean {
  return context.permissions.includes(permission);
}

function requirePermission(input: {
  context: PluginCapabilityGateContext;
  operation: string;
  permission: string;
}): PluginCapabilityDecision {
  if (hasPermission(input.context, input.permission)) {
    return allow({ permission: input.permission });
  }
  return deny({
    code: "plugin_permission_error",
    message: `metidos.${input.operation} requires ${input.permission}.`,
    permission: input.permission,
  });
}

function isProjectVirtualPath(virtualPath: string): boolean {
  return virtualPath === "." || virtualPath.startsWith("./");
}

function contextSupportsProjectFiles(
  context: PluginCapabilityGateContext,
): boolean {
  return context.contextKind === "threadTool";
}

async function evaluateFsCapability(input: {
  context: PluginCapabilityGateContext;
  request: Extract<PluginCapabilityRequest, { kind: "fs" }>;
}): Promise<PluginCapabilityDecision> {
  const permission = isProjectVirtualPath(input.request.virtualPath)
    ? `files:${input.request.access}`
    : `storage:${input.request.access}`;
  const permissionDecision = requirePermission({
    context: input.context,
    operation: `fs.${input.request.access}`,
    permission,
  });
  if (!permissionDecision.allowed) {
    return permissionDecision;
  }
  if (!input.context.pluginPath) {
    return deny({
      code: "plugin_context_error",
      message: "Plugin fs requires an approved plugin installation path.",
    });
  }
  if (
    isProjectVirtualPath(input.request.virtualPath) &&
    !contextSupportsProjectFiles(input.context)
  ) {
    return deny({
      code: "project_context_unavailable",
      message: "Plugin fs ./ paths are available only in thread tool contexts.",
      permission,
    });
  }

  const resolvedPath = await resolvePluginFsVirtualPath({
    access: input.request.pathAccess ?? input.request.access,
    pluginPath: input.context.pluginPath,
    projectRootPath: input.context.projectRootPath,
    threadRootPath: input.context.threadRootPath,
    virtualPath: input.request.virtualPath,
  });
  return allow({ permission, resolvedPath });
}

function evaluateNetworkCapability(input: {
  context: PluginCapabilityGateContext;
  request: Extract<PluginCapabilityRequest, { kind: "network" }>;
}): PluginCapabilityDecision {
  const permission =
    input.request.operation === "websocket"
      ? "network:websocket"
      : "network:fetch";
  const permissionDecision = requirePermission({
    context: input.context,
    operation: input.request.operation,
    permission,
  });
  if (!permissionDecision.allowed) {
    return permissionDecision;
  }
  const allowPatterns =
    input.request.operation === "websocket"
      ? input.context.network?.webSocketAllow
      : input.context.network?.allow;
  if (!allowPatterns || allowPatterns.length === 0) {
    return deny({
      code: "invalid_network_policy",
      message: `Plugin ${input.request.operation} requires a non-empty network.allow list.`,
      permission,
    });
  }
  const compiled = compilePluginNetworkAllowlist({
    allowUnsafeAllDomains: input.context.permissions.includes("unsafe"),
    enforceHttps: input.context.network?.enforceHttps ?? true,
    kind: input.request.operation === "websocket" ? "websocket" : "fetch",
    patterns: allowPatterns,
  });
  if (compiled.issues.length > 0) {
    return deny({
      code: "invalid_network_policy",
      message: compiled.issues.map((issue) => issue.message).join(" "),
      permission,
    });
  }
  try {
    const url = assertPluginNetworkUrlAllowed(
      compiled.patterns,
      input.request.url,
    );
    return allow({ permission, url });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Plugin network URL is not allowed.";
    return deny({
      code: "network_url_not_allowed",
      message,
      permission,
    });
  }
}

async function evaluatePluginDataCapability(input: {
  context: PluginCapabilityGateContext;
  operation: string;
  primaryPermission: string;
  storagePermission: string;
  virtualPath: string;
}): Promise<PluginCapabilityDecision> {
  for (const permission of [input.primaryPermission, input.storagePermission]) {
    const decision = requirePermission({
      context: input.context,
      operation: input.operation,
      permission,
    });
    if (!decision.allowed) {
      return decision;
    }
  }
  if (!input.virtualPath.startsWith("~/")) {
    return deny({
      code: "project_context_unavailable",
      message: `metidos.${input.operation} is scoped to plugin data ~/ paths.`,
      permission: input.storagePermission,
    });
  }
  if (!input.context.pluginPath) {
    return deny({
      code: "plugin_context_error",
      message: `metidos.${input.operation} requires an approved plugin installation path.`,
    });
  }
  const resolvedPath = await resolvePluginFsVirtualPath({
    access: "write",
    pluginPath: input.context.pluginPath,
    virtualPath: input.virtualPath,
  });
  return allow({ permission: input.primaryPermission, resolvedPath });
}

async function evaluateSqliteCapability(input: {
  context: PluginCapabilityGateContext;
  request: Extract<PluginCapabilityRequest, { kind: "sqlite" }>;
}): Promise<PluginCapabilityDecision> {
  return evaluatePluginDataCapability({
    context: input.context,
    operation: "sqlite",
    primaryPermission: PLUGIN_SQLITE_PERMISSION,
    storagePermission: PLUGIN_SQLITE_STORAGE_WRITE_PERMISSION,
    virtualPath: input.request.virtualPath,
  });
}

async function evaluateLanceDbCapability(input: {
  context: PluginCapabilityGateContext;
  request: Extract<PluginCapabilityRequest, { kind: "lancedb" }>;
}): Promise<PluginCapabilityDecision> {
  return evaluatePluginDataCapability({
    context: input.context,
    operation: "lancedb",
    primaryPermission: PLUGIN_LANCEDB_PERMISSION,
    storagePermission: PLUGIN_LANCEDB_STORAGE_WRITE_PERMISSION,
    virtualPath: input.request.virtualPath,
  });
}

function evaluateCalendarCapability(input: {
  context: PluginCapabilityGateContext;
  request: Extract<PluginCapabilityRequest, { kind: "calendar" }>;
}): PluginCapabilityDecision {
  const permission = permissionForPluginCalendarEventsOperation(
    input.request.operation,
  );
  const permissionDecision = requirePermission({
    context: input.context,
    operation: input.request.operation,
    permission,
  });
  if (!permissionDecision.allowed) {
    return permissionDecision;
  }
  const calendarContext: PluginCalendarEventsContext = input.context;
  if (
    (input.request.operation === "calendar.delete" ||
      input.request.operation === "events.delete") &&
    calendarContext.contextKind === "cron"
  ) {
    return deny({
      code: "plugin_confirmation_unavailable",
      message: `metidos.${input.request.operation} cannot run in cron because confirmation is unavailable.`,
      permission,
    });
  }
  if (
    (input.request.operation === "calendar.delete" ||
      input.request.operation === "events.delete") &&
    input.request.params?.confirmed !== true &&
    input.request.params?.confirmation !== true
  ) {
    return deny({
      code: "plugin_context_error",
      message: `metidos.${input.request.operation} requires explicit confirmation.`,
      permission,
    });
  }
  if (
    input.context.contextKind !== "threadTool" &&
    input.context.contextKind !== "cron" &&
    input.context.contextKind !== "userCron"
  ) {
    return deny({
      code: "plugin_context_error",
      message: `metidos.${input.request.operation} requires an authenticated local-operator plugin callback context.`,
      permission,
    });
  }
  return allow({ permission });
}

function evaluateTerminalCapability(input: {
  context: PluginCapabilityGateContext;
  request: Extract<PluginCapabilityRequest, { kind: "terminal" }>;
}): PluginCapabilityDecision {
  const terminalContext: PluginTerminalContext = input.context;
  const permission = permissionForPluginTerminalOperation(
    input.request.operation,
  );
  const permissionDecision = requirePermission({
    context: input.context,
    operation: input.request.operation,
    permission,
  });
  if (!permissionDecision.allowed) {
    return permissionDecision;
  }
  if (
    (input.request.operation === "terminal.create" ||
      input.request.operation === "terminal.kill") &&
    !hasPermission(input.context, PLUGIN_TERMINAL_UNSAFE_PERMISSION)
  ) {
    return deny({
      code: "plugin_unsafe_permission_required",
      message: `metidos.${input.request.operation} requires unsafe review and activation.`,
      permission: PLUGIN_TERMINAL_UNSAFE_PERMISSION,
    });
  }
  if (terminalContext.contextKind === "cron") {
    return deny({
      code: "plugin_terminal_unavailable_in_cron",
      message: `metidos.${input.request.operation} is unavailable in cron contexts.`,
      permission,
    });
  }
  if (terminalContext.contextKind !== "threadTool") {
    return deny({
      code: "plugin_context_error",
      message: `metidos.${input.request.operation} requires a thread tool plugin callback context.`,
      permission,
    });
  }
  if (
    typeof terminalContext.projectId !== "number" ||
    typeof terminalContext.threadId !== "number" ||
    typeof terminalContext.worktreePath !== "string" ||
    terminalContext.worktreePath.trim().length === 0
  ) {
    return deny({
      code: "plugin_context_error",
      message: `metidos.${input.request.operation} requires a current thread and worktree context.`,
      permission,
    });
  }
  return allow({ permission });
}

function pluginAccessGroupCapabilityKey(
  context: PluginCapabilityGateContext,
  request: Extract<PluginCapabilityRequest, { kind: "accessGroup" }>,
): string {
  const pluginId = request.pluginId ?? context.pluginId;
  return pluginId ? `${pluginId}/${request.groupId}` : request.groupId;
}

type PluginStaticCapabilityRequest =
  | Extract<PluginCapabilityRequest, { kind: "accessGroup" }>
  | Extract<PluginCapabilityRequest, { kind: "notification" }>
  | Extract<PluginCapabilityRequest, { kind: "permission" }>
  | Extract<PluginCapabilityRequest, { kind: "provider" }>;

export function evaluatePluginStaticCapability(input: {
  context: PluginCapabilityGateContext;
  request: PluginStaticCapabilityRequest;
}): PluginCapabilityDecision {
  switch (input.request.kind) {
    case "accessGroup": {
      const key = pluginAccessGroupCapabilityKey(input.context, input.request);
      return (input.context.enabledAccessGroups ?? []).includes(key)
        ? allow()
        : deny({
            code: "plugin_permission_error",
            message: `Plugin access group ${key} is not enabled in this thread.`,
          });
    }
    case "notification":
      return requirePermission({
        context: input.context,
        operation: `notifications.${input.request.operation}`,
        permission:
          input.request.operation === "provider"
            ? PLUGIN_NOTIFICATION_PROVIDER_PERMISSION
            : PLUGIN_NOTIFICATION_SEND_PERMISSION,
      });
    case "permission":
      return requirePermission({
        context: input.context,
        operation: input.request.operation,
        permission: input.request.permission,
      });
    case "provider":
      return requirePermission({
        context: input.context,
        operation: `${input.request.operation} provider`,
        permission: input.request.permission,
      });
  }
}

export async function evaluatePluginCapability(input: {
  context: PluginCapabilityGateContext;
  request: PluginCapabilityRequest;
}): Promise<PluginCapabilityDecision> {
  switch (input.request.kind) {
    case "accessGroup":
      return evaluatePluginStaticCapability({
        context: input.context,
        request: input.request,
      });
    case "calendar":
      return evaluateCalendarCapability({
        context: input.context,
        request: input.request,
      });
    case "fs":
      return await evaluateFsCapability({
        context: input.context,
        request: input.request,
      });
    case "lancedb":
      return await evaluateLanceDbCapability({
        context: input.context,
        request: input.request,
      });
    case "network":
      return evaluateNetworkCapability({
        context: input.context,
        request: input.request,
      });
    case "notification":
    case "permission":
    case "provider":
      return evaluatePluginStaticCapability({
        context: input.context,
        request: input.request,
      });
    case "sqlite":
      return await evaluateSqliteCapability({
        context: input.context,
        request: input.request,
      });
    case "terminal":
      return evaluateTerminalCapability({
        context: input.context,
        request: input.request,
      });
  }
}

export async function assertPluginCapability(input: {
  context: PluginCapabilityGateContext;
  request: PluginCapabilityRequest;
}): Promise<Extract<PluginCapabilityDecision, { allowed: true }>> {
  const decision = await evaluatePluginCapability(input);
  if (decision.allowed) {
    return decision;
  }
  if (
    decision.code === "plugin_permission_error" ||
    decision.code === "plugin_unsafe_permission_required"
  ) {
    throw new PluginPermissionError({
      code: decision.code,
      message: decision.message,
      ...(decision.permission === undefined
        ? {}
        : { permission: decision.permission }),
    });
  }
  throw new PluginContextError({
    code:
      decision.code === "network_url_not_allowed" ||
      decision.code === "invalid_network_policy"
        ? "plugin_context_error"
        : decision.code,
    message: decision.message,
  });
}
