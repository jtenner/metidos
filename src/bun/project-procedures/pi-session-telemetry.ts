/**
 * @file src/bun/project-procedures/pi-session-telemetry.ts
 * @description Maps live Pi session telemetry onto Metidos thread status/detail payloads.
 */

import type {
  CompactionEntry,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";

import type { PiThreadRuntime } from "../pi-thread-runtime";
import type {
  RpcThread,
  RpcThreadCompaction,
  RpcThreadQueueStatus,
  RpcThreadRunStatus,
  RpcThreadUsage,
} from "../rpc-schema";
import { extractPiAssistantUsage } from "./pi-sdk-shapes";

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function listSessionBranchEntries(runtime: PiThreadRuntime): SessionEntry[] {
  return runtime.session.sessionManager.getBranch();
}

function isSuccessfulAssistantEntry(
  entry: SessionEntry,
): entry is Extract<SessionEntry, { type: "message" }> {
  if (entry.type !== "message" || entry.message.role !== "assistant") {
    return false;
  }

  const stopReason = entry.message.stopReason;
  return stopReason !== "aborted" && stopReason !== "error";
}

function findLatestAssistantUsage(
  entries: readonly SessionEntry[],
): RpcThreadUsage | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !isSuccessfulAssistantEntry(entry)) {
      continue;
    }

    return extractPiAssistantUsage(entry.message);
  }

  return null;
}

function findFirstAssistantUsageAfter(
  entries: readonly SessionEntry[],
  entryId: string,
): RpcThreadUsage | null {
  const startIndex = entries.findIndex((entry) => entry.id === entryId);
  if (startIndex < 0) {
    return null;
  }

  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || !isSuccessfulAssistantEntry(entry)) {
      continue;
    }

    return extractPiAssistantUsage(entry.message);
  }

  return null;
}

function listCompactionEntries(
  entries: readonly SessionEntry[],
): CompactionEntry[] {
  return entries.filter(
    (entry): entry is CompactionEntry => entry.type === "compaction",
  );
}

function collectObservedInputTokens(
  entries: readonly SessionEntry[],
  liveContextTokens: number | null,
  baseMaxObservedInputTokens: number | null,
): number | null {
  const observedTokens: number[] = [];

  if (isFinitePositiveNumber(baseMaxObservedInputTokens)) {
    observedTokens.push(baseMaxObservedInputTokens);
  }

  if (isFinitePositiveNumber(liveContextTokens)) {
    observedTokens.push(liveContextTokens);
  }

  for (const entry of entries) {
    if (
      entry.type === "compaction" &&
      isFinitePositiveNumber(entry.tokensBefore)
    ) {
      observedTokens.push(entry.tokensBefore);
      continue;
    }

    if (!isSuccessfulAssistantEntry(entry)) {
      continue;
    }

    const usage = extractPiAssistantUsage(entry.message);
    if (isFinitePositiveNumber(usage?.inputTokens)) {
      observedTokens.push(usage.inputTokens);
    }
  }

  if (observedTokens.length === 0) {
    return null;
  }

  return Math.max(...observedTokens);
}

function buildQueueStatus(
  runtime: PiThreadRuntime,
): RpcThreadQueueStatus | null {
  const pendingMessageCount = runtime.session.pendingMessageCount;
  const steeringMessageCount = runtime.session.getSteeringMessages().length;
  const followUpMessageCount = runtime.session.getFollowUpMessages().length;

  if (
    pendingMessageCount <= 0 &&
    steeringMessageCount <= 0 &&
    followUpMessageCount <= 0
  ) {
    return null;
  }

  return {
    pendingMessageCount,
    steeringMessageCount,
    followUpMessageCount,
  };
}

export function buildPiRuntimeUsage(
  baseUsage: RpcThreadUsage | null,
  runtime: PiThreadRuntime,
): RpcThreadUsage | null {
  const entries = listSessionBranchEntries(runtime);
  const latestAssistantUsage = findLatestAssistantUsage(entries);
  const contextUsage = runtime.session.getContextUsage();
  const contextWindowTokens =
    contextUsage?.contextWindow ?? runtime.contextWindowTokens ?? null;

  if (contextWindowTokens === null && baseUsage === null) {
    return null;
  }

  return {
    inputTokens:
      contextUsage?.tokens ??
      baseUsage?.inputTokens ??
      latestAssistantUsage?.inputTokens ??
      0,
    cachedInputTokens:
      latestAssistantUsage?.cachedInputTokens ??
      baseUsage?.cachedInputTokens ??
      0,
    outputTokens:
      latestAssistantUsage?.outputTokens ?? baseUsage?.outputTokens ?? 0,
    ...(contextWindowTokens === null ? {} : { contextWindowTokens }),
  };
}

export function buildPiRuntimeCompaction(
  baseCompaction: RpcThreadCompaction,
  runtime: PiThreadRuntime,
): RpcThreadCompaction {
  const entries = listSessionBranchEntries(runtime);
  const compactionEntries = listCompactionEntries(entries);
  const contextUsage = runtime.session.getContextUsage();
  const liveContextTokens = contextUsage?.tokens ?? null;

  if (compactionEntries.length === 0) {
    return {
      ...baseCompaction,
      maxObservedInputTokens: collectObservedInputTokens(
        entries,
        liveContextTokens,
        baseCompaction.maxObservedInputTokens,
      ),
    };
  }

  const latestCompaction = compactionEntries[compactionEntries.length - 1];
  if (!latestCompaction) {
    return baseCompaction;
  }
  const sampledTriggerTokens = compactionEntries
    .map((entry) => entry.tokensBefore)
    .filter(isFinitePositiveNumber);
  const estimatedTriggerTokens =
    sampledTriggerTokens.length > 0
      ? Math.round(
          sampledTriggerTokens.reduce((sum, value) => sum + value, 0) /
            sampledTriggerTokens.length,
        )
      : baseCompaction.estimatedTriggerTokens;
  const postCompactionUsage =
    findFirstAssistantUsageAfter(entries, latestCompaction.id) ?? null;

  return {
    estimatedTriggerTokens,
    estimatedTriggerSource: "observed",
    maxObservedInputTokens: collectObservedInputTokens(
      entries,
      liveContextTokens,
      baseCompaction.maxObservedInputTokens,
    ),
    inferredCount: compactionEntries.length,
    lastInferredAt: latestCompaction.timestamp,
    lastInferredBeforeInputTokens: latestCompaction.tokensBefore,
    lastInferredAfterInputTokens: postCompactionUsage?.inputTokens ?? null,
  };
}

export function buildPiRuntimeRunStatus(
  baseRunStatus: RpcThreadRunStatus,
  runtime: PiThreadRuntime,
): RpcThreadRunStatus {
  const { phase: _phase, queue: _queue, ...stableStatus } = baseRunStatus;
  const queue = buildQueueStatus(runtime);
  const phase = runtime.session.isCompacting
    ? "compacting"
    : runtime.session.isStreaming
      ? "streaming"
      : null;

  return {
    ...stableStatus,
    ...(phase === null ? {} : { phase }),
    ...(queue === null ? {} : { queue }),
  };
}

export function applyPiRuntimeTelemetry(
  thread: RpcThread,
  runtime: PiThreadRuntime | null | undefined,
): RpcThread {
  if (!runtime) {
    return thread;
  }

  return {
    ...thread,
    usage: buildPiRuntimeUsage(thread.usage, runtime),
    compaction: buildPiRuntimeCompaction(thread.compaction, runtime),
    runStatus: buildPiRuntimeRunStatus(thread.runStatus, runtime),
  };
}
