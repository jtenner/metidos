/**
 * @file src/bun/plugin/terminal.ts
 * @description Permissioned Plugin System v1 terminal host API helpers.
 */

import type { RpcTerminal } from "../rpc-schema";
import { PluginContextError, PluginPermissionError } from "./context";

export const PLUGIN_TERMINAL_CREATE_PERMISSION = "terminal:create";
export const PLUGIN_TERMINAL_READ_PERMISSION = "terminal:read";
export const PLUGIN_TERMINAL_KILL_PERMISSION = "terminal:kill";
export const PLUGIN_TERMINAL_UNSAFE_PERMISSION = "unsafe";

export type PluginTerminalOperation =
  | "terminal.create"
  | "terminal.grep"
  | "terminal.kill"
  | "terminal.read";

export type PluginTerminalContext = {
  contextKind?: string | null;
  ownerUserId?: number | null;
  projectId?: number | null;
  threadId?: number | null;
  worktreePath?: string | null;
};

export type PluginTerminalCreateRequest = {
  command?: string | null;
  dir?: string | null;
  title?: string | null;
};

export type PluginTerminalReadRequest = {
  lineCount?: number;
  lineOffset?: number;
  terminalIndex: number;
};

export type PluginTerminalGrepRequest = {
  ignoreCase?: boolean;
  maxMatches?: number;
  pattern: string;
  terminalIndex: number;
};

export type PluginTerminalKillRequest = {
  terminalIndex: number;
};

export type PluginTerminalThreadContext = {
  ownerUserId: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type PluginTerminalHost = {
  createTerminal(
    context: PluginTerminalThreadContext,
    request: PluginTerminalCreateRequest,
  ): Promise<RpcTerminal> | RpcTerminal;
  grepTerminal(
    context: PluginTerminalThreadContext,
    request: PluginTerminalGrepRequest,
  ): Promise<string> | string;
  killTerminal(
    context: PluginTerminalThreadContext,
    request: PluginTerminalKillRequest,
  ): Promise<void> | void;
  readTerminal(
    context: PluginTerminalThreadContext,
    request: PluginTerminalReadRequest,
  ): Promise<string> | string;
};

export class PluginTerminalError extends Error {
  readonly code: string;

  constructor(input: { cause?: unknown; code: string; message: string }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginTerminalError";
    this.code = input.code;
  }
}

const OPERATION_PERMISSIONS: Record<PluginTerminalOperation, string> = {
  "terminal.create": PLUGIN_TERMINAL_CREATE_PERMISSION,
  "terminal.grep": PLUGIN_TERMINAL_READ_PERMISSION,
  "terminal.kill": PLUGIN_TERMINAL_KILL_PERMISSION,
  "terminal.read": PLUGIN_TERMINAL_READ_PERMISSION,
};

const UNSAFE_OPERATIONS = new Set<PluginTerminalOperation>([
  "terminal.create",
  "terminal.kill",
]);

export function isPluginTerminalOperation(
  value: string,
): value is PluginTerminalOperation {
  return Object.hasOwn(OPERATION_PERMISSIONS, value);
}

export function permissionForPluginTerminalOperation(
  operation: PluginTerminalOperation,
): string {
  return OPERATION_PERMISSIONS[operation];
}

export function assertPluginTerminalPermission(input: {
  operation: PluginTerminalOperation;
  permissions: readonly string[];
}): void {
  const permission = permissionForPluginTerminalOperation(input.operation);
  if (!input.permissions.includes(permission)) {
    throw new PluginPermissionError({
      code: "plugin_permission_error",
      message: `metidos.${input.operation} requires ${permission}.`,
      permission,
    });
  }
  if (
    UNSAFE_OPERATIONS.has(input.operation) &&
    !input.permissions.includes(PLUGIN_TERMINAL_UNSAFE_PERMISSION)
  ) {
    throw new PluginPermissionError({
      code: "plugin_unsafe_permission_required",
      message: `metidos.${input.operation} requires unsafe review and activation.`,
      permission: PLUGIN_TERMINAL_UNSAFE_PERMISSION,
    });
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginTerminalError({
      code: "invalid_plugin_terminal_request",
      message: `${label} must be an object.`,
    });
  }
  return value as Record<string, unknown>;
}

function optionalRecordValue(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  return recordValue(value, "Plugin terminal request");
}

function positiveIntegerField(
  record: Record<string, unknown>,
  key: string,
  options: { defaultValue?: number; max?: number; min?: number } = {},
): number {
  const value = record[key] ?? options.defaultValue;
  const min = options.min ?? 1;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    (options.max === undefined || value <= options.max)
  ) {
    return value;
  }
  throw new PluginTerminalError({
    code: "invalid_plugin_terminal_request",
    message: `Plugin terminal request requires ${key} to be an integer${options.max === undefined ? "" : ` no greater than ${options.max}`} and at least ${min}.`,
  });
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
      throw new PluginTerminalError({
        code: "invalid_plugin_terminal_request",
        message: `Plugin terminal request ${key} must be ${options.maxLength} characters or fewer.`,
      });
    }
    return trimmed.length > 0 ? trimmed : null;
  }
  throw new PluginTerminalError({
    code: "invalid_plugin_terminal_request",
    message: `Plugin terminal request ${key} must be a string when provided.`,
  });
}

function pluginTerminalThreadContext(input: {
  context?: PluginTerminalContext | null | undefined;
  operation: PluginTerminalOperation;
}): PluginTerminalThreadContext {
  const context = input.context;
  if (context?.contextKind === "cron") {
    throw new PluginContextError({
      code: "plugin_terminal_unavailable_in_cron",
      contextKind: context.contextKind,
      message: `metidos.${input.operation} is unavailable in cron contexts.`,
    });
  }
  if (context?.contextKind !== "threadTool") {
    throw new PluginContextError({
      code: "plugin_context_error",
      contextKind: context?.contextKind ?? null,
      message: `metidos.${input.operation} requires a thread tool plugin callback context.`,
    });
  }
  if (
    typeof context.projectId !== "number" ||
    !Number.isInteger(context.projectId) ||
    context.projectId <= 0 ||
    typeof context.threadId !== "number" ||
    !Number.isInteger(context.threadId) ||
    context.threadId <= 0 ||
    typeof context.worktreePath !== "string" ||
    context.worktreePath.trim().length === 0
  ) {
    throw new PluginContextError({
      code: "plugin_context_error",
      contextKind: context.contextKind,
      message: `metidos.${input.operation} requires current project, worktree, and thread context.`,
    });
  }
  return {
    ownerUserId:
      typeof context.ownerUserId === "number" ? context.ownerUserId : null,
    projectId: context.projectId,
    threadId: context.threadId,
    worktreePath: context.worktreePath,
  };
}

function normalizeCreateRequest(
  params: Record<string, unknown>,
): PluginTerminalCreateRequest {
  return {
    command: optionalStringField(params, "command", { maxLength: 4096 }),
    dir: optionalStringField(params, "dir", { maxLength: 1024 }),
    title: optionalStringField(params, "title", { maxLength: 256 }),
  };
}

function normalizeReadRequest(
  params: Record<string, unknown>,
): PluginTerminalReadRequest {
  return {
    lineCount: positiveIntegerField(params, "lineCount", {
      defaultValue: 200,
      max: 1000,
    }),
    lineOffset: positiveIntegerField(params, "lineOffset", {
      defaultValue: 0,
      min: 0,
    }),
    terminalIndex: positiveIntegerField(params, "terminalIndex", { min: 0 }),
  };
}

function normalizeGrepRequest(
  params: Record<string, unknown>,
): PluginTerminalGrepRequest {
  const pattern = params.pattern;
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    throw new PluginTerminalError({
      code: "invalid_plugin_terminal_request",
      message: "Plugin terminal grep requires a non-empty pattern string.",
    });
  }
  if (pattern.length > 256) {
    throw new PluginTerminalError({
      code: "invalid_plugin_terminal_request",
      message: "Plugin terminal grep pattern must be 256 characters or fewer.",
    });
  }
  return {
    ignoreCase: params.ignoreCase === true,
    maxMatches: positiveIntegerField(params, "maxMatches", {
      defaultValue: 20,
      max: 100,
    }),
    pattern,
    terminalIndex: positiveIntegerField(params, "terminalIndex", { min: 0 }),
  };
}

function normalizeKillRequest(
  params: Record<string, unknown>,
): PluginTerminalKillRequest {
  return {
    terminalIndex: positiveIntegerField(params, "terminalIndex", { min: 0 }),
  };
}

export async function executePluginTerminalOperation(input: {
  context?: PluginTerminalContext | null;
  host: PluginTerminalHost;
  operation: PluginTerminalOperation;
  params?: unknown;
  permissions: readonly string[];
}): Promise<unknown> {
  assertPluginTerminalPermission({
    operation: input.operation,
    permissions: input.permissions,
  });
  const context = pluginTerminalThreadContext({
    context: input.context,
    operation: input.operation,
  });
  const params = optionalRecordValue(input.params);

  switch (input.operation) {
    case "terminal.create":
      return await input.host.createTerminal(
        context,
        normalizeCreateRequest(params),
      );
    case "terminal.read":
      return await input.host.readTerminal(
        context,
        normalizeReadRequest(params),
      );
    case "terminal.grep":
      return await input.host.grepTerminal(
        context,
        normalizeGrepRequest(params),
      );
    case "terminal.kill": {
      const request = normalizeKillRequest(params);
      await input.host.killTerminal(context, request);
      return { success: true, terminalIndex: request.terminalIndex };
    }
  }
}
