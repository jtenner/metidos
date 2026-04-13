/**
 * @file src/bun/pi-metidos-tools-shared.ts
 * @description Shared Pi-native Metidos tool types, payload builders, and utilities.
 */

import type {
  AgentToolResult,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

import type {
  AppRPCSchema,
  RpcContextFocusChanged,
  RpcCronJob,
  RpcInitTaskGraphRequest,
  RpcInitTaskGraphResult,
  RpcNormalizeTaskGraphRequest,
  RpcNormalizeTaskGraphResult,
  RpcProject,
  RpcThread,
  RpcThreadDetail,
  RpcThreadStartRequest,
  RpcValidateTaskGraphRequest,
  RpcValidateTaskGraphResult,
  RpcWorktree,
} from "./rpc-schema";
import {
  recordMetidosToolFailed,
  recordMetidosToolStarted,
  recordMetidosToolSucceeded,
  recordMetidosUnsafeModeRequest,
} from "./runtime-stats";
import { canonicalizeThreadToolPath } from "./thread-tool-scope";

export type PiMetidosToolScope = {
  allowUnsafeModeEscalation: boolean;
  projectIdContext: number;
  threadIdContext: number;
  worktreePathContext: string;
};

export type PiMetidosToolHost = {
  capabilities: {
    taskGraphAdmin: boolean;
  };
  createThread: (
    params: AppRPCSchema["requests"]["createThread"]["params"],
  ) => Promise<RpcThreadDetail>;
  focusContext: (
    params: AppRPCSchema["requests"]["focusContext"]["params"],
    signal?: AbortSignal,
  ) => Promise<RpcContextFocusChanged>;
  initTaskGraph: (
    params: RpcInitTaskGraphRequest,
    worktreePath: string,
  ) => Promise<RpcInitTaskGraphResult>;
  listCrons: () => Promise<RpcCronJob[]>;
  listProjectWorktrees: (
    params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
    signal?: AbortSignal,
  ) => Promise<RpcWorktree[]>;
  listProjects: () => Promise<RpcProject[]>;
  listThreads: () => Promise<RpcThread[]>;
  newCron: (
    params: AppRPCSchema["requests"]["newCron"]["params"],
  ) => Promise<RpcCronJob>;
  normalizeTaskGraph: (
    params: RpcNormalizeTaskGraphRequest,
    worktreePath: string,
  ) => Promise<RpcNormalizeTaskGraphResult>;
  requestThreadStart: (
    params: AppRPCSchema["requests"]["requestThreadStart"]["params"],
  ) => Promise<RpcThreadStartRequest>;
  sendThreadMessage: (
    params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
  ) => Promise<RpcThreadDetail>;
  updateCron: (
    params: AppRPCSchema["requests"]["updateCron"]["params"],
  ) => Promise<RpcCronJob>;
  updateThreadMetadata: (
    params: AppRPCSchema["requests"]["updateThreadMetadata"]["params"],
  ) => Promise<RpcThread>;
  validateTaskGraph: (
    params: RpcValidateTaskGraphRequest,
    worktreePath: string,
  ) => Promise<RpcValidateTaskGraphResult>;
};

const PI_THINKING_LEVEL_VALUES = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const SUPPORTED_MODELS_SENTENCE =
  "Supported models are loaded from the Pi-backed catalog.";
export const NullableString = Type.Union([Type.String(), Type.Null()]);
export const PositiveInteger = Type.Integer({ minimum: 1 });
export const ThinkingLevel = Type.Union(
  PI_THINKING_LEVEL_VALUES.map((value) => Type.Literal(value)),
);

export function canonicalPath(
  value: string,
  scope: PiMetidosToolScope,
): string {
  return canonicalizeThreadToolPath(value, {
    baseDirectory: scope.worktreePathContext,
  });
}

export function samePath(
  left: string,
  right: string,
  scope: PiMetidosToolScope,
): boolean {
  return canonicalPath(left, scope) === canonicalPath(right, scope);
}

export function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

export function shortName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function normalizeThreadIdInput(
  threadId: string | number | null | undefined,
): number | null {
  if (typeof threadId === "number") {
    if (!Number.isInteger(threadId) || threadId <= 0) {
      throw new Error("threadId must be a positive integer.");
    }
    return threadId;
  }

  if (typeof threadId !== "string") {
    return null;
  }

  const trimmed = threadId.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error("threadId must be a positive integer.");
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("threadId must be a positive integer.");
  }
  return parsed;
}

function summarizeThreadStatus(detail: RpcThreadDetail): string {
  switch (detail.thread.runStatus.state) {
    case "working":
      return "Turning";
    case "failed":
      return "Errored";
    default:
      return detail.thread.lastRunAt === null && detail.messages.length === 0
        ? "Created"
        : "Stopped";
  }
}

export function threadMetadataPayload(
  thread: RpcThreadDetail["thread"] | RpcThread,
) {
  return {
    agentsAccess: thread.agentsAccess,
    githubAccess: thread.githubAccess,
    metidosAccess: thread.metidosAccess,
    pinned: thread.pinnedAt !== null,
    pinnedAt: thread.pinnedAt,
    projectId: thread.projectId,
    summary: thread.summary,
    threadId: thread.id,
    title: thread.title,
    unsafeMode: thread.unsafeMode,
    webSearchAccess: thread.webSearchAccess,
    worktreePath: thread.worktreePath,
  };
}

export function threadStatusPayload(
  detail: RpcThreadDetail,
  metadata: {
    autoStart: boolean | null;
    input: string;
    model: string | null;
    projectPath: string | null;
    reasoningEffort:
      | AppRPCSchema["requests"]["createThread"]["params"]["reasoningEffort"]
      | null;
    unsafeMode: boolean | null;
  },
) {
  return {
    ...threadMetadataPayload(detail.thread),
    autoStart: metadata.autoStart,
    createdAt: null,
    error: detail.thread.runStatus.error,
    hasUnreadError: detail.thread.runStatus.hasUnreadError,
    input: metadata.input,
    lastRunAt: detail.thread.lastRunAt,
    model: metadata.model,
    projectPath: metadata.projectPath,
    reasoningEffort: metadata.reasoningEffort,
    requestId: null,
    runState: detail.thread.runStatus.state,
    status: summarizeThreadStatus(detail),
    unsafeMode: metadata.unsafeMode,
  };
}

export function threadStartRequestPayload(request: RpcThreadStartRequest) {
  return {
    ...request,
    error: null,
    hasUnreadError: null,
    lastRunAt: null,
    runState: null,
    status: null,
  };
}

export function cronJobPayload(cronJob: RpcCronJob) {
  return {
    agentsAccess: cronJob.agentsAccess,
    createdAt: cronJob.createdAt,
    cronJobId: cronJob.id,
    deletedAt: cronJob.deletedAt,
    description: cronJob.description,
    enabled: cronJob.enabled,
    githubAccess: cronJob.githubAccess,
    metidosAccess: cronJob.metidosAccess,
    lastRunDate: cronJob.lastRunDate,
    lastRunStatus: cronJob.lastRunStatus,
    nextRunDate: cronJob.nextRunDate,
    projectId: cronJob.projectId,
    prompt: cronJob.prompt,
    schedule: cronJob.schedule,
    title: cronJob.title,
    unsafeMode: cronJob.unsafeMode,
    updatedAt: cronJob.updatedAt,
    webSearchAccess: cronJob.webSearchAccess,
    worktreePath: cronJob.worktreePath,
  };
}

export function textToolResult<TDetails>(
  text: string,
  details: TDetails,
): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function coerceBooleanLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return value;
}

function coercePositiveIntegerLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^\d+$/u.test(normalized)) {
    return value;
  }
  return Number.parseInt(normalized, 10);
}

export function prepareThreadIdAndBooleanArguments<TParams extends TSchema>(
  value: unknown,
  booleanKeys: readonly string[],
  integerKeys: readonly string[] = [],
): Static<TParams> {
  if (!value || typeof value !== "object") {
    return value as Static<TParams>;
  }

  const record = { ...(value as Record<string, unknown>) };
  for (const key of booleanKeys) {
    record[key] = coerceBooleanLikeInput(record[key]);
  }
  for (const key of integerKeys) {
    record[key] = coercePositiveIntegerLikeInput(record[key]);
  }
  return record as Static<TParams>;
}

export function assertTaskGraphAdminAllowed(host: PiMetidosToolHost): void {
  if (host.capabilities.taskGraphAdmin) {
    return;
  }
  throw new Error(
    "Task graph admin tools are disabled for this runtime. This thread cannot initialize, validate, or normalize the repository task graph.",
  );
}

export function assertUnsafeModeEscalationAllowed(
  toolName: string,
  scope: PiMetidosToolScope,
  requestedUnsafeMode: boolean | null | undefined,
): void {
  if (requestedUnsafeMode !== true) {
    return;
  }

  if (!scope.allowUnsafeModeEscalation) {
    recordMetidosUnsafeModeRequest({
      allowed: false,
      toolName,
    });
    throw new Error(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );
  }

  recordMetidosUnsafeModeRequest({
    allowed: true,
    toolName,
  });
}

export function withMetidosToolTelemetry<
  TParameters extends TSchema = TSchema,
  TDetails = Record<string, unknown>,
>(
  tool: ToolDefinition<TParameters, TDetails>,
): ToolDefinition<TParameters, TDetails> {
  const execute = tool.execute;
  return {
    ...tool,
    execute: async (...args: Parameters<typeof execute>) => {
      const token = recordMetidosToolStarted(tool.name);
      try {
        const result = await execute(...args);
        recordMetidosToolSucceeded(token);
        return result;
      } catch (error) {
        recordMetidosToolFailed(token);
        throw error;
      }
    },
  };
}
