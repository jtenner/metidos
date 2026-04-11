/**
 * @file src/bun/starvation-harness.test.ts
 * @description Test file for starvation harness reporting helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RuntimeDiagnosticsSnapshot } from "./runtime-stats";
import {
  buildHarnessReport,
  type PressureSummary,
  parseArgs,
  type StartupSummary,
  summarizeDurationSamples,
  summarizePressure,
} from "./starvation-harness";

function buildDiagnosticsSnapshot(
  collectedAt: string,
  rss: number,
): RuntimeDiagnosticsSnapshot {
  return {
    collectedAt,
    memoryUsage: {
      arrayBuffers: 1_024,
      external: 2_048,
      heapTotal: 3_072,
      heapUsed: 4_096,
      rss,
    },
    runtimeStats: {
      gitCache: {
        commitDiff: {
          hits: 2,
          misses: 1,
          pendingReuse: 1,
          stores: 1,
        },
        historyPage: {
          cacheRangeHit: 3,
          fetches: 2,
          preemptions: 1,
          prefetchWaits: 1,
        },
      },
      rpc: {
        byMethod: {
          openWorktree: {
            calls: 2,
            canceled: 0,
            failed: 0,
            lastDurationMs: 12,
            peakDurationMs: 14,
            requestBytes: 100,
            responseBytes: 200,
            succeeded: 2,
            timedOut: 0,
            totalDurationMs: 26,
          },
        },
        totals: {
          calls: 2,
          canceled: 0,
          failed: 0,
          peakDurationMs: 14,
          requestBytes: 100,
          responseBytes: 200,
          succeeded: 2,
          timedOut: 0,
          totalDurationMs: 26,
        },
      },
      sqliteRetry: {
        exhaustedLoops: 0,
        loopsWithRetry: 1,
        peakRetryCount: 2,
        totalBackoffMs: 40,
        totalRetries: 2,
      },
      startedAt: collectedAt,
      websocketPush: {
        byType: {
          "git-history-changed": {
            deliveredClients: 2,
            droppedClients: 0,
            messages: 1,
            payloadBytes: 128,
          },
        },
        totals: {
          deliveredClients: 2,
          droppedClients: 0,
          messages: 1,
          payloadBytes: 128,
        },
      },
    },
    runtimeStatsSummary: {
      gitCache: {
        commitDiff: {
          hits: 2,
          misses: 1,
          pendingReuse: 1,
          stores: 1,
        },
        historyPage: {
          cacheRangeHit: 3,
          fetches: 2,
          preemptions: 1,
          prefetchWaits: 1,
        },
      },
      rpc: {
        calls: 2,
        canceled: 0,
        failed: 0,
        methodCount: 1,
        peakDurationMs: 14,
        requestBytes: 100,
        responseBytes: 200,
        succeeded: 2,
        timedOut: 0,
        totalDurationMs: 26,
      },
      sqliteRetry: {
        exhaustedLoops: 0,
        loopsWithRetry: 1,
        peakRetryCount: 2,
        totalBackoffMs: 40,
        totalRetries: 2,
      },
      startedAt: collectedAt,
      websocketPush: {
        deliveredClients: 2,
        droppedClients: 0,
        messages: 1,
        payloadBytes: 128,
        typeCount: 1,
      },
    },
  };
}

describe("starvation harness helpers", () => {
  it("parses the json flag alongside numeric options", () => {
    const parsed = parseArgs([
      "--json",
      "--port",
      "7600",
      "--workers=5",
      "--duration-ms",
      "1200",
    ]);

    expect(parsed.json).toBe(true);
    expect(parsed.port).toBe(7600);
    expect(parsed.workers).toBe(5);
    expect(parsed.durationMs).toBe(1200);
  });

  it("computes count, mean, and percentile summaries", () => {
    expect(summarizeDurationSamples([])).toEqual({
      count: 0,
      maxMs: null,
      meanMs: null,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    });

    expect(summarizeDurationSamples([10, 20, 30, 40, 50])).toEqual({
      count: 5,
      maxMs: 50,
      meanMs: 30,
      minMs: 10,
      p50Ms: 30,
      p95Ms: 50,
      p99Ms: 50,
    });
  });

  it("merges pressure worker summaries and builds a structured report", () => {
    const pressureA: PressureSummary = {
      abortedCount: 1,
      completedCount: 2,
      failedCount: 1,
      failureCountByLabel: {
        listWorktreeGitHistory: 1,
      },
      timingsByLabel: {
        openWorktree: [10, 20],
      },
    };
    const pressureB: PressureSummary = {
      abortedCount: 0,
      completedCount: 1,
      failedCount: 0,
      failureCountByLabel: {},
      timingsByLabel: {
        getWorktreeGitCommitDiff: [30],
        openWorktree: [15],
      },
    };
    const pressure = summarizePressure([pressureA, pressureB]);
    expect(pressure).toEqual({
      abortedCount: 1,
      completedCount: 3,
      failedCount: 1,
      failureCountByLabel: {
        listWorktreeGitHistory: 1,
      },
      timingsByLabel: {
        getWorktreeGitCommitDiff: [30],
        openWorktree: [10, 20, 15],
      },
    });

    const startup: StartupSummary = {
      http: [
        {
          durationMs: 12,
          httpStatus: 200,
          label: "/health",
          ok: true,
          status: "ok",
          url: "http://127.0.0.1:7599/health",
        },
      ],
      rpc: [
        {
          durationMs: 18,
          label: "getAppBootstrap",
          ok: true,
          status: "ok",
        },
      ],
      totalDurationMs: 40,
    };

    const report = buildHarnessReport({
      baseUrl: "http://127.0.0.1:7599",
      context: {
        project: {
          createdAt: "2026-04-11T00:00:00.000Z",
          id: 7,
          isOpen: 1,
          lastOpenedAt: "2026-04-11T00:00:00.000Z",
          name: "metidos",
          path: "/repo",
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
        projectWasCreated: false,
        projectWasInitiallyOpen: true,
        worktree: {
          bare: false,
          branch: "main",
          head: "abc123",
          path: "/repo",
          pinnedAt: null,
        },
      },
      diagnostics: {
        afterPressure: buildDiagnosticsSnapshot(
          "2026-04-11T12:00:02.000Z",
          30_000_000,
        ),
        afterWarmup: buildDiagnosticsSnapshot(
          "2026-04-11T12:00:01.000Z",
          20_000_000,
        ),
        beforeWarmup: buildDiagnosticsSnapshot(
          "2026-04-11T12:00:00.000Z",
          10_000_000,
        ),
      },
      pass: true,
      pressure,
      rpcUrl: "ws://127.0.0.1:7599/rpc",
      startup,
      startupBudgets: {
        httpBudgetMs: 3000,
        rpcBudgetMs: 5000,
        startupBudgetMs: 12000,
      },
    });

    expect(report.pass).toBe(true);
    expect(report.target).toEqual({
      projectId: 7,
      projectName: "metidos",
      publicUrl: "http://127.0.0.1:7599",
      rpcUrl: "ws://127.0.0.1:7599/rpc",
      worktreePath: "/repo",
    });
    expect(report.latency.pressureRpcByLabel.openWorktree).toEqual({
      count: 3,
      maxMs: 20,
      meanMs: 15,
      minMs: 10,
      p50Ms: 15,
      p95Ms: 20,
      p99Ms: 20,
    });
    expect(report.latency.pressureRpcByLabel.getWorktreeGitCommitDiff).toEqual({
      count: 1,
      maxMs: 30,
      meanMs: 30,
      minMs: 30,
      p50Ms: 30,
      p95Ms: 30,
      p99Ms: 30,
    });
    expect(report.pressure.failureCountByLabel).toEqual({
      listWorktreeGitHistory: 1,
    });
    expect(report.diagnostics.afterPressure.memoryUsage.rss).toBe(30_000_000);
  });
});
