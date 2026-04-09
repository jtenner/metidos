/**
 * @file src/bun/project-procedures/thread-detail.ts
 * @description Module for thread detail.
 */

import type { ThreadMessageRecord, ThreadRecord } from "../db";
import type {
  RpcThread,
  RpcThreadCompaction,
  RpcThreadMessage,
  RpcThreadRunStatus,
  RpcThreadUsage,
  RpcWorktree,
} from "../rpc-schema";
import { normalizeCommandDisplayText } from "./command-normalization";
import {
  heuristicCompactionTriggerTokens,
  normalizeStoredCodexModel,
  normalizeStoredCodexReasoningEffort,
} from "./model-catalog";
import { shortName } from "./shared";

const LEGACY_THREAD_STOPPED_MESSAGE = "Codex turn was stopped by the user.";
const LEGACY_THREAD_INTERRUPTED_MESSAGE =
  "Codex turn was interrupted before completion.";

export const THREAD_STOPPED_MESSAGE = "Thread run was stopped by the user.";
export const THREAD_INTERRUPTED_MESSAGE =
  "Thread run was interrupted before completion.";

const COMPACTION_INFERENCE_MIN_PREVIOUS_WINDOW_RATIO = 0.72;
const COMPACTION_INFERENCE_MAX_CURRENT_RATIO = 0.68;
const COMPACTION_INFERENCE_MIN_DROP_WINDOW_RATIO = 0.16;

/**
 * Activity payload stored for command/file/tool messages.
 */
type CommandActivityPayload = {
  command: string;
  output: string;
  exitCode: number | null;
};

/**
 * Activity payload stored for filesystem-change messages.
 */
type FileChangeActivityPayload = {
  path: string;
  changeKind: "add" | "delete" | "update";
  diffText: string;
};

/**
 * Activity payload stored for tool-call messages.
 */
type ToolCallActivityPayload = {
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
};

/**
 * Unread error exists when lastErrorAt exists and wasn't seen later.
 */
function hasUnreadThreadError(thread: ThreadRecord): boolean {
  return Boolean(
    thread.lastErrorAt &&
      (!thread.lastErrorSeenAt || thread.lastErrorSeenAt < thread.lastErrorAt),
  );
}
/**
 * Is stopped thread message.
 * @param message - Message payload.
 */

export function isStoppedThreadMessage(message: string | null): boolean {
  return (
    message === THREAD_STOPPED_MESSAGE ||
    message === THREAD_INTERRUPTED_MESSAGE ||
    message === LEGACY_THREAD_STOPPED_MESSAGE ||
    message === LEGACY_THREAD_INTERRUPTED_MESSAGE
  );
}

/**
 * Compute derived run state for a thread, preferring active status from runtime when present.
 */
export function threadRunStatusFromRecord(
  thread: ThreadRecord,
  activeStatus?: RpcThreadRunStatus,
): RpcThreadRunStatus {
  const hasUnreadError = hasUnreadThreadError(thread);
  if (activeStatus) {
    return {
      ...activeStatus,
      hasUnreadError: activeStatus.state === "stopped" ? false : hasUnreadError,
    };
  }

  const failureIsCurrent =
    thread.lastErrorAt &&
    (!thread.lastRunAt || thread.lastErrorAt >= thread.lastRunAt);
  if (failureIsCurrent) {
    if (isStoppedThreadMessage(thread.lastErrorMessage)) {
      return {
        state: "stopped",
        startedAt: null,
        updatedAt: thread.lastErrorAt,
        error: thread.lastErrorMessage,
        hasUnreadError: false,
      };
    }
    return {
      state: "failed",
      startedAt: null,
      updatedAt: thread.lastErrorAt,
      error: thread.lastErrorMessage ?? "Codex turn failed.",
      hasUnreadError,
    };
  }

  return {
    state: "idle",
    startedAt: null,
    updatedAt: thread.lastRunAt ?? thread.updatedAt,
    error: null,
    hasUnreadError: false,
  };
}

/**
 * Convert token counters from DB record into optional RPC usage shape.
 */
function threadUsageFromRecord(thread: ThreadRecord): RpcThreadUsage | null {
  if (
    thread.lastInputTokens === null &&
    thread.lastCachedInputTokens === null &&
    thread.lastOutputTokens === null
  ) {
    return null;
  }
  return {
    inputTokens: thread.lastInputTokens ?? 0,
    cachedInputTokens: thread.lastCachedInputTokens ?? 0,
    outputTokens: thread.lastOutputTokens ?? 0,
  };
}

/**
 * Derive compaction telemetry with fallback heuristic and observed inference history.
 */
function threadCompactionFromRecord(thread: ThreadRecord): RpcThreadCompaction {
  return {
    estimatedTriggerTokens:
      thread.estimatedCompactionTriggerTokens ??
      heuristicCompactionTriggerTokens(thread.model),
    estimatedTriggerSource: thread.estimatedCompactionTriggerTokens
      ? "observed"
      : "heuristic",
    maxObservedInputTokens: thread.maxInputTokens,
    inferredCount: thread.compactionCount,
    lastInferredAt: thread.lastCompactionAt,
    lastInferredBeforeInputTokens: thread.lastCompactionBeforeInputTokens,
    lastInferredAfterInputTokens: thread.lastCompactionAfterInputTokens,
  };
}

/**
 * Convert DB thread record to RPC thread object with normalized model/effort and runtime status.
 */
export function toRpcThread(
  thread: ThreadRecord,
  activeStatus?: RpcThreadRunStatus,
): RpcThread {
  return {
    ...thread,
    model: normalizeStoredCodexModel(thread.model),
    reasoningEffort: normalizeStoredCodexReasoningEffort(
      thread.reasoningEffort,
    ),
    unsafeMode: thread.unsafeMode === 1,
    usage: threadUsageFromRecord(thread),
    compaction: threadCompactionFromRecord(thread),
    runStatus: threadRunStatusFromRecord(thread, activeStatus),
  };
}

/**
 * Build updated compaction telemetry from latest usage sample.
 */
export function buildNextCompactionTelemetry(
  thread: ThreadRecord,
  usage: RpcThreadUsage,
  contextWindowTokens: number,
): {
  maxInputTokens: number;
  estimatedCompactionTriggerTokens: number | null;
  compactionCount: number;
  lastCompactionAt: string | null;
  lastCompactionBeforeInputTokens: number | null;
  lastCompactionAfterInputTokens: number | null;
} {
  const previousInputTokens = thread.lastInputTokens;
  const currentInputTokens = usage.inputTokens;
  const heuristicTriggerTokens = heuristicCompactionTriggerTokens(thread.model);
  const baselineTriggerTokens =
    thread.estimatedCompactionTriggerTokens ?? heuristicTriggerTokens;
  const maxInputTokens = Math.max(
    thread.maxInputTokens ?? 0,
    currentInputTokens,
  );

  let estimatedCompactionTriggerTokens =
    thread.estimatedCompactionTriggerTokens ?? null;
  let compactionCount = thread.compactionCount;
  let lastCompactionAt = thread.lastCompactionAt;
  let lastCompactionBeforeInputTokens = thread.lastCompactionBeforeInputTokens;
  let lastCompactionAfterInputTokens = thread.lastCompactionAfterInputTokens;

  if (typeof previousInputTokens === "number" && previousInputTokens > 0) {
    const previousNearCompaction =
      previousInputTokens >=
      Math.round(
        Math.min(
          baselineTriggerTokens,
          contextWindowTokens * COMPACTION_INFERENCE_MIN_PREVIOUS_WINDOW_RATIO,
        ),
      );
    const currentDroppedSharply =
      currentInputTokens <=
      Math.round(previousInputTokens * COMPACTION_INFERENCE_MAX_CURRENT_RATIO);
    const droppedByMeaningfulWindowShare =
      previousInputTokens - currentInputTokens >=
      Math.round(
        contextWindowTokens * COMPACTION_INFERENCE_MIN_DROP_WINDOW_RATIO,
      );

    if (
      previousNearCompaction &&
      currentDroppedSharply &&
      droppedByMeaningfulWindowShare
    ) {
      const nextSample = previousInputTokens;
      const sampleCount = Math.max(compactionCount, 0);
      estimatedCompactionTriggerTokens =
        sampleCount > 0 && estimatedCompactionTriggerTokens
          ? Math.round(
              (estimatedCompactionTriggerTokens * sampleCount + nextSample) /
                (sampleCount + 1),
            )
          : nextSample;
      compactionCount += 1;
      lastCompactionAt = new Date().toISOString();
      lastCompactionBeforeInputTokens = previousInputTokens;
      lastCompactionAfterInputTokens = currentInputTokens;
    }
  }

  return {
    maxInputTokens,
    estimatedCompactionTriggerTokens,
    compactionCount,
    lastCompactionAt,
    lastCompactionBeforeInputTokens,
    lastCompactionAfterInputTokens,
  };
}

/**
 * Parse optional JSON payload on command/file/tool messages; fallback to null on invalid JSON.
 */
function parseActivityPayload<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Convert a single persisted message into strongly-typed RPC message form.
 */
function toRpcThreadMessage(message: ThreadMessageRecord): RpcThreadMessage {
  if (message.kind === "command" && message.itemId) {
    const payload = parseActivityPayload<CommandActivityPayload>(
      message.payloadJson,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "command",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" ||
        message.state === "failed" ||
        message.state === "stopped"
          ? message.state
          : "in_progress",
      command: normalizeCommandDisplayText(payload?.command ?? message.text),
      output: payload?.output ?? "",
      exitCode: typeof payload?.exitCode === "number" ? payload.exitCode : null,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "file_change" && message.itemId) {
    const payload = parseActivityPayload<FileChangeActivityPayload>(
      message.payloadJson,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "file_change",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "in_progress" ||
        message.state === "failed" ||
        message.state === "stopped"
          ? message.state
          : "completed",
      path: payload?.path ?? message.text,
      changeKind: payload?.changeKind ?? "update",
      diffText: payload?.diffText ?? "",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "tool_call" && message.itemId) {
    const payload = parseActivityPayload<ToolCallActivityPayload>(
      message.payloadJson,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "tool_call",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "in_progress" ||
        message.state === "failed" ||
        message.state === "stopped"
          ? message.state
          : "completed",
      server: payload?.server ?? "",
      tool: payload?.tool ?? message.text,
      argumentsText: payload?.argumentsText ?? "",
      output: payload?.output ?? "",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "web_search" && message.itemId) {
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "web_search",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" || message.state === "stopped"
          ? message.state
          : "in_progress",
      query: message.text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "error" && message.itemId) {
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "error",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" || message.state === "stopped"
          ? message.state
          : "in_progress",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "reasoning" && message.itemId) {
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "reasoning",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" || message.state === "stopped"
          ? message.state
          : "in_progress",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    kind: "chat",
    itemId: message.itemId,
    text: message.text,
    state:
      message.state === "in_progress" ||
      message.state === "completed" ||
      message.state === "failed" ||
      message.state === "stopped"
        ? message.state
        : null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

/**
 * Map stored thread messages to RPC wire shape.
 */
export function toRpcThreadMessages(
  messages: ThreadMessageRecord[],
): RpcThreadMessage[] {
  return messages.map(toRpcThreadMessage);
}

/**
 * Build display title from branch name or fallback directory short name.
 */
export function buildThreadTitle(
  worktree: RpcWorktree | null,
  worktreePath: string,
): string {
  return worktree?.branch?.trim() || shortName(worktreePath);
}
