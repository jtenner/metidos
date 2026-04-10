/**
 * @file src/bun/project-procedures/pi-session-telemetry.test.ts
 * @description Focused coverage for Pi-backed thread telemetry hydration.
 */

import { describe, expect, it } from "bun:test";
import { SessionManager } from "@mariozechner/pi-coding-agent";

import type { PiThreadRuntime } from "../pi-thread-runtime";
import type {
  RpcThread,
  RpcThreadCompaction,
  RpcThreadRunStatus,
} from "../rpc-schema";
import {
  applyPiRuntimeTelemetry,
  buildPiRuntimeCompaction,
  buildPiRuntimeRunStatus,
  buildPiRuntimeUsage,
} from "./pi-session-telemetry";

function assistantMessage(
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  timestamp: number,
): Record<string, unknown> {
  return {
    role: "assistant",
    api: "anthropic-messages",
    provider: "openai",
    model: "gpt-5.4",
    content: [{ type: "text", text: `assistant-${timestamp}` }],
    stopReason: "stop",
    timestamp,
    usage: {
      input: inputTokens,
      cacheRead: cachedInputTokens,
      cacheWrite: 0,
      output: outputTokens,
      totalTokens: inputTokens + cachedInputTokens + outputTokens,
      cost: {
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 0,
      },
    },
  };
}

function userMessage(text: string, timestamp: number): Record<string, unknown> {
  return {
    role: "user",
    content: text,
    timestamp,
  };
}

function makeRuntime(options?: {
  contextWindowTokens?: number;
  contextUsageTokens?: number | null;
  followUpMessageCount?: number;
  isCompacting?: boolean;
  isStreaming?: boolean;
  pendingMessageCount?: number;
  steeringMessageCount?: number;
}): PiThreadRuntime {
  const sessionManager = SessionManager.inMemory("/repo");
  const firstUserId = sessionManager.appendMessage(
    userMessage("start", 1) as never,
  );
  sessionManager.appendMessage(assistantMessage(2_400, 320, 64, 2) as never);
  sessionManager.appendCompaction("summary-1", firstUserId, 4_500);
  sessionManager.appendMessage(assistantMessage(1_200, 160, 32, 3) as never);
  const secondUserId = sessionManager.appendMessage(
    userMessage("continue", 4) as never,
  );
  sessionManager.appendCompaction("summary-2", secondUserId, 5_200);
  sessionManager.appendMessage(assistantMessage(980, 110, 28, 5) as never);

  return {
    agentDirectory: "/tmp/pi-agent",
    contextWindowTokens: options?.contextWindowTokens ?? 8_192,
    model: {
      contextWindow: options?.contextWindowTokens ?? 8_192,
      id: "gpt-5.4",
      provider: "openai",
    } as never,
    session: {
      getContextUsage: () => ({
        contextWindow: options?.contextWindowTokens ?? 8_192,
        percent:
          typeof options?.contextUsageTokens === "number"
            ? (options.contextUsageTokens /
                (options?.contextWindowTokens ?? 8_192)) *
              100
            : null,
        tokens:
          typeof options?.contextUsageTokens === "undefined"
            ? 1_536
            : options.contextUsageTokens,
      }),
      getFollowUpMessages: () =>
        Array.from(
          { length: options?.followUpMessageCount ?? 0 },
          (_, index) => `follow-up-${index}`,
        ),
      getSteeringMessages: () =>
        Array.from(
          { length: options?.steeringMessageCount ?? 0 },
          (_, index) => `steer-${index}`,
        ),
      isCompacting: options?.isCompacting ?? false,
      isStreaming: options?.isStreaming ?? false,
      pendingMessageCount: options?.pendingMessageCount ?? 0,
      sessionManager,
    } as never,
    sessionDirectory: "/tmp/pi-session",
  };
}

function makeRunStatus(
  input?: Partial<RpcThreadRunStatus>,
): RpcThreadRunStatus {
  return {
    error: null,
    hasUnreadError: false,
    startedAt: "2026-04-09T12:00:00.000Z",
    state: "working",
    updatedAt: "2026-04-09T12:00:00.000Z",
    ...input,
  };
}

function makeCompaction(
  input?: Partial<RpcThreadCompaction>,
): RpcThreadCompaction {
  return {
    estimatedTriggerTokens: 6_000,
    estimatedTriggerSource: "heuristic",
    inferredCount: 0,
    lastInferredAfterInputTokens: null,
    lastInferredAt: null,
    lastInferredBeforeInputTokens: null,
    maxObservedInputTokens: null,
    ...input,
  };
}

function makeThread(input?: Partial<RpcThread>): RpcThread {
  return {
    agentsAccess: false,
    compaction: makeCompaction(),
    createdAt: "2026-04-09T11:00:00.000Z",
    githubAccess: false,
    id: 12,
    metidosAccess: true,
    lastRunAt: null,
    model: "openai:gpt-5.4",
    piLeafEntryId: null,
    piSessionFile: null,
    piSessionId: null,
    pinnedAt: null,
    projectId: 7,
    reasoningEffort: "medium",
    runStatus: makeRunStatus(),
    summary: null,
    title: "Telemetry Thread",
    unsafeMode: false,
    updatedAt: "2026-04-09T11:00:00.000Z",
    usage: {
      cachedInputTokens: 50,
      inputTokens: 900,
      outputTokens: 20,
    },
    worktreePath: "/repo",
    ...input,
  };
}

describe("buildPiRuntimeUsage", () => {
  it("uses live context usage for input tokens and latest assistant usage for output/cache", () => {
    const usage = buildPiRuntimeUsage(
      {
        cachedInputTokens: 50,
        inputTokens: 900,
        outputTokens: 20,
      },
      makeRuntime(),
    );

    expect(usage).toEqual({
      cachedInputTokens: 110,
      contextWindowTokens: 8_192,
      inputTokens: 1_536,
      outputTokens: 28,
    });
  });

  it("keeps persisted input tokens when Pi has no post-compaction token estimate yet", () => {
    const usage = buildPiRuntimeUsage(
      {
        cachedInputTokens: 50,
        inputTokens: 900,
        outputTokens: 20,
      },
      makeRuntime({
        contextUsageTokens: null,
      }),
    );

    expect(usage).toEqual({
      cachedInputTokens: 110,
      contextWindowTokens: 8_192,
      inputTokens: 900,
      outputTokens: 28,
    });
  });
});

describe("buildPiRuntimeCompaction", () => {
  it("derives observed compaction stats from the active Pi session branch", () => {
    const compaction = buildPiRuntimeCompaction(
      makeCompaction(),
      makeRuntime(),
    );

    expect(compaction).toEqual({
      estimatedTriggerTokens: 4_850,
      estimatedTriggerSource: "observed",
      inferredCount: 2,
      lastInferredAfterInputTokens: 980,
      lastInferredAt: expect.any(String),
      lastInferredBeforeInputTokens: 5_200,
      maxObservedInputTokens: 5_200,
    });
  });
});

describe("buildPiRuntimeRunStatus", () => {
  it("adds live phase and queue counts", () => {
    const runStatus = buildPiRuntimeRunStatus(
      makeRunStatus(),
      makeRuntime({
        followUpMessageCount: 1,
        isCompacting: true,
        pendingMessageCount: 2,
        steeringMessageCount: 1,
      }),
    );

    expect(runStatus).toEqual({
      error: null,
      hasUnreadError: false,
      phase: "compacting",
      queue: {
        followUpMessageCount: 1,
        pendingMessageCount: 2,
        steeringMessageCount: 1,
      },
      startedAt: "2026-04-09T12:00:00.000Z",
      state: "working",
      updatedAt: "2026-04-09T12:00:00.000Z",
    });
  });

  it("clears stale Pi-only phase and queue fields when the runtime is idle", () => {
    const runStatus = buildPiRuntimeRunStatus(
      makeRunStatus({
        phase: "streaming",
        queue: {
          followUpMessageCount: 1,
          pendingMessageCount: 1,
          steeringMessageCount: 0,
        },
      }),
      makeRuntime({
        contextUsageTokens: 800,
      }),
    );

    expect(runStatus).toEqual({
      error: null,
      hasUnreadError: false,
      startedAt: "2026-04-09T12:00:00.000Z",
      state: "working",
      updatedAt: "2026-04-09T12:00:00.000Z",
    });
    expect("phase" in runStatus).toBe(false);
    expect("queue" in runStatus).toBe(false);
  });
});

describe("applyPiRuntimeTelemetry", () => {
  it("hydrates a thread with Pi-backed usage, compaction, and runtime status", () => {
    const thread = applyPiRuntimeTelemetry(
      makeThread(),
      makeRuntime({
        followUpMessageCount: 1,
        isStreaming: true,
        pendingMessageCount: 1,
      }),
    );

    expect(thread.usage).toEqual({
      cachedInputTokens: 110,
      contextWindowTokens: 8_192,
      inputTokens: 1_536,
      outputTokens: 28,
    });
    expect(thread.compaction).toMatchObject({
      estimatedTriggerSource: "observed",
      inferredCount: 2,
      lastInferredBeforeInputTokens: 5_200,
    });
    expect(thread.runStatus).toEqual({
      error: null,
      hasUnreadError: false,
      phase: "streaming",
      queue: {
        followUpMessageCount: 1,
        pendingMessageCount: 1,
        steeringMessageCount: 0,
      },
      startedAt: "2026-04-09T12:00:00.000Z",
      state: "working",
      updatedAt: "2026-04-09T12:00:00.000Z",
    });
  });
});
