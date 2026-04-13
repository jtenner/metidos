/**
 * @file src/bun/pi-metidos-tools-shared.ts
 * @description Shared Pi-native Metidos tool types, payload builders, and utilities.
 */

import type {
  AgentToolResult,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

import { createAbortError } from "./project-procedures/shared";
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
  recordMetidosToolBudgetFinished,
  recordMetidosToolBudgetQueued,
  recordMetidosToolBudgetSaturated,
  recordMetidosToolBudgetStarted,
  recordMetidosToolBudgetState,
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

type MetidosToolBudgetDefinition = {
  budgetName: string;
  maxConcurrent: number;
  maxPending: number;
  saturationMessage: string;
};

type PendingMetidosToolBudgetTask = {
  abortMessage: string;
  detachAbortListener: () => void;
  reject: (reason?: unknown) => void;
  resolve: (release: () => void) => void;
  signal: AbortSignal | null;
};

type MetidosToolBudgetState = {
  activeCount: number;
  definition: MetidosToolBudgetDefinition;
  pending: PendingMetidosToolBudgetTask[];
};

const METIDOS_THREAD_CRON_MUTATION_BUDGET: MetidosToolBudgetDefinition = {
  budgetName: "thread_cron_mutations",
  maxConcurrent: 2,
  maxPending: 2,
  saturationMessage:
    "Metidos child-thread and cron mutations are saturated. Wait for earlier new_thread, new_cron, or update_cron calls to finish.",
};

const METIDOS_UNSAFE_CHILD_OPERATION_BUDGET: MetidosToolBudgetDefinition = {
  budgetName: "unsafe_child_operations",
  maxConcurrent: 1,
  maxPending: 0,
  saturationMessage:
    "Unsafe child-thread and cron mutations are saturated. Wait for the current unsafe operation to finish before starting another.",
};

const METIDOS_SANDBOX_RUN_BUDGET: MetidosToolBudgetDefinition = {
  budgetName: "sandbox_runs",
  maxConcurrent: 1,
  maxPending: 0,
  saturationMessage:
    "Sandbox execution is saturated. Wait for the current run_untrusted_js call to finish before starting another.",
};

const metidosToolBudgetStates = new Map<string, MetidosToolBudgetState>();

function getMetidosToolBudgetState(
  definition: MetidosToolBudgetDefinition,
): MetidosToolBudgetState {
  const existing = metidosToolBudgetStates.get(definition.budgetName);
  if (existing) {
    return existing;
  }

  const created: MetidosToolBudgetState = {
    activeCount: 0,
    definition,
    pending: [],
  };
  metidosToolBudgetStates.set(definition.budgetName, created);
  return created;
}

function buildMetidosToolBudgetSaturationError(
  state: MetidosToolBudgetState,
): Error {
  return new Error(
    `${state.definition.saturationMessage} (active=${state.activeCount}, pending=${state.pending.length}, maxConcurrent=${state.definition.maxConcurrent}, maxPending=${state.definition.maxPending})`,
  );
}

function snapshotMetidosToolBudgetState(state: MetidosToolBudgetState): void {
  recordMetidosToolBudgetState({
    activeCount: state.activeCount,
    budgetName: state.definition.budgetName,
    pendingCount: state.pending.length,
  });
}

function releaseMetidosToolBudget(state: MetidosToolBudgetState): void {
  state.activeCount = Math.max(0, state.activeCount - 1);

  while (state.activeCount < state.definition.maxConcurrent) {
    const next = state.pending.shift();
    if (!next) {
      break;
    }
    if (next.signal?.aborted) {
      next.detachAbortListener();
      snapshotMetidosToolBudgetState(state);
      next.reject(createAbortError(next.signal.reason, next.abortMessage));
      continue;
    }

    next.detachAbortListener();
    state.activeCount += 1;
    recordMetidosToolBudgetStarted({
      activeCount: state.activeCount,
      budgetName: state.definition.budgetName,
      pendingCount: state.pending.length,
    });
    next.resolve(createMetidosToolBudgetRelease(state));
    break;
  }

  recordMetidosToolBudgetFinished({
    activeCount: state.activeCount,
    budgetName: state.definition.budgetName,
    pendingCount: state.pending.length,
  });
}

function createMetidosToolBudgetRelease(
  state: MetidosToolBudgetState,
): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    releaseMetidosToolBudget(state);
  };
}

async function acquireMetidosToolBudget(
  definition: MetidosToolBudgetDefinition,
  signal: AbortSignal | null | undefined,
): Promise<() => void> {
  const state = getMetidosToolBudgetState(definition);
  if (state.activeCount < definition.maxConcurrent) {
    state.activeCount += 1;
    recordMetidosToolBudgetStarted({
      activeCount: state.activeCount,
      budgetName: definition.budgetName,
      pendingCount: state.pending.length,
    });
    return createMetidosToolBudgetRelease(state);
  }

  if (state.pending.length >= definition.maxPending) {
    recordMetidosToolBudgetSaturated({
      activeCount: state.activeCount,
      budgetName: definition.budgetName,
      pendingCount: state.pending.length,
    });
    throw buildMetidosToolBudgetSaturationError(state);
  }

  const abortMessage = `Queued ${definition.budgetName} operation was aborted.`;
  if (signal?.aborted) {
    throw createAbortError(signal.reason, abortMessage);
  }

  return new Promise<() => void>((resolve, reject) => {
    let task: PendingMetidosToolBudgetTask | null = null;
    const handleAbort = () => {
      if (!task) {
        reject(createAbortError(signal?.reason, abortMessage));
        return;
      }
      const index = state.pending.indexOf(task);
      if (index < 0) {
        return;
      }
      state.pending.splice(index, 1);
      task.detachAbortListener();
      snapshotMetidosToolBudgetState(state);
      reject(createAbortError(signal?.reason, abortMessage));
    };

    task = {
      abortMessage,
      detachAbortListener: () => {
        signal?.removeEventListener("abort", handleAbort);
      },
      reject,
      resolve,
      signal: signal ?? null,
    };

    state.pending.push(task);
    signal?.addEventListener("abort", handleAbort, {
      once: true,
    });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    recordMetidosToolBudgetQueued({
      activeCount: state.activeCount,
      budgetName: definition.budgetName,
      pendingCount: state.pending.length,
    });
  });
}

async function acquireMetidosToolBudgets(
  definitions: readonly MetidosToolBudgetDefinition[],
  signal: AbortSignal | null | undefined,
): Promise<() => void> {
  const releases: Array<() => void> = [];
  try {
    for (const definition of definitions) {
      releases.push(await acquireMetidosToolBudget(definition, signal));
    }
  } catch (error) {
    for (let index = releases.length - 1; index >= 0; index -= 1) {
      releases[index]?.();
    }
    throw error;
  }

  return () => {
    for (let index = releases.length - 1; index >= 0; index -= 1) {
      releases[index]?.();
    }
  };
}

function getMetidosToolBudgets(
  toolName: string,
  params: unknown,
): readonly MetidosToolBudgetDefinition[] {
  if (toolName === "run_untrusted_js") {
    return [METIDOS_SANDBOX_RUN_BUDGET];
  }

  if (
    toolName !== "new_thread" &&
    toolName !== "new_cron" &&
    toolName !== "update_cron"
  ) {
    return [];
  }

  const budgets = [METIDOS_THREAD_CRON_MUTATION_BUDGET];
  const requestedUnsafeMode =
    !!params &&
    typeof params === "object" &&
    (params as { unsafeMode?: unknown }).unsafeMode === true;
  if (requestedUnsafeMode) {
    budgets.push(METIDOS_UNSAFE_CHILD_OPERATION_BUDGET);
  }
  return budgets;
}

export function resetMetidosToolBudgetsForTests(): void {
  metidosToolBudgetStates.clear();
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
      let releaseBudgets: (() => void) | null = null;
      try {
        releaseBudgets = await acquireMetidosToolBudgets(
          getMetidosToolBudgets(tool.name, args[1]),
          args[2],
        );
        const result = await execute(...args);
        recordMetidosToolSucceeded(token);
        return result;
      } catch (error) {
        recordMetidosToolFailed(token);
        throw error;
      } finally {
        releaseBudgets?.();
      }
    },
  };
}
