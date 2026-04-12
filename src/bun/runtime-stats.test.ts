/**
 * @file src/bun/runtime-stats.test.ts
 * @description Test file for runtime stats.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import {
  getRuntimeStatsSnapshot,
  getRuntimeStatsSummary,
  recordCronPendingRuns,
  recordCronRunFinished,
  recordCronRunQueued,
  recordCronRunStarted,
  recordGitCommitDiffCacheHit,
  recordGitCommitDiffCacheMiss,
  recordGitCommitDiffPendingReuse,
  recordGitCommitDiffStore,
  recordGitHistoryCacheFetch,
  recordGitHistoryCachePreemption,
  recordGitHistoryCachePrefetchWait,
  recordGitHistoryCacheRangeHit,
  recordRpcCanceled,
  recordRpcFailed,
  recordRpcStarted,
  recordRpcSucceeded,
  recordRpcTimedOut,
  recordSqliteRetryLoop,
  recordWebSocketPush,
  resetRuntimeStats,
} from "./runtime-stats";

describe("runtime stats collector", () => {
  beforeEach(() => {
    resetRuntimeStats();
  });

  it("aggregates rpc method outcomes and byte totals", () => {
    const listThreads = recordRpcStarted("listThreads", 120);
    recordRpcSucceeded(listThreads, 480);

    const getThread = recordRpcStarted("getThread", 64);
    recordRpcFailed(getThread, 42);

    const openWorktree = recordRpcStarted("openWorktree", 33);
    recordRpcTimedOut(openWorktree, 15);

    const sendThreadMessage = recordRpcStarted("sendThreadMessage", 81);
    recordRpcCanceled(sendThreadMessage);

    const snapshot = getRuntimeStatsSnapshot();
    expect(snapshot.rpc.totals.calls).toBe(4);
    expect(snapshot.rpc.totals.succeeded).toBe(1);
    expect(snapshot.rpc.totals.failed).toBe(1);
    expect(snapshot.rpc.totals.timedOut).toBe(1);
    expect(snapshot.rpc.totals.canceled).toBe(1);
    expect(snapshot.rpc.totals.requestBytes).toBe(298);
    expect(snapshot.rpc.totals.responseBytes).toBe(537);

    expect(snapshot.rpc.byMethod.listThreads).toMatchObject({
      calls: 1,
      requestBytes: 120,
      responseBytes: 480,
      succeeded: 1,
    });
    expect(snapshot.rpc.byMethod.getThread).toMatchObject({
      calls: 1,
      failed: 1,
      responseBytes: 42,
    });
    expect(snapshot.rpc.byMethod.openWorktree).toMatchObject({
      calls: 1,
      timedOut: 1,
      responseBytes: 15,
    });
    expect(snapshot.rpc.byMethod.sendThreadMessage).toMatchObject({
      calls: 1,
      canceled: 1,
      responseBytes: 0,
    });
    expect(
      snapshot.rpc.byMethod.listThreads?.totalDurationMs ?? 0,
    ).toBeGreaterThanOrEqual(0);
    expect(snapshot.rpc.totals.totalDurationMs).toBeGreaterThanOrEqual(0);

    const summary = getRuntimeStatsSummary();
    expect(summary.rpc.methodCount).toBe(4);
    expect(summary.rpc.topResponseBytesMethods).toEqual([
      {
        calls: 1,
        method: "listThreads",
        requestBytes: 120,
        responseBytes: 480,
      },
      {
        calls: 1,
        method: "getThread",
        requestBytes: 64,
        responseBytes: 42,
      },
      {
        calls: 1,
        method: "openWorktree",
        requestBytes: 33,
        responseBytes: 15,
      },
      {
        calls: 1,
        method: "sendThreadMessage",
        requestBytes: 81,
        responseBytes: 0,
      },
    ]);
  });

  it("aggregates websocket push payloads and delivery counts by type", () => {
    recordWebSocketPush({
      deliveredClients: 3,
      droppedClients: 1,
      payloadBytes: 128,
      type: "git-history-changed",
    });
    recordWebSocketPush({
      deliveredClients: 1,
      droppedClients: 0,
      payloadBytes: 44,
      type: "git-history-changed",
    });
    recordWebSocketPush({
      deliveredClients: 2,
      droppedClients: 0,
      payloadBytes: 80,
      type: "thread-extension-ui",
    });

    const snapshot = getRuntimeStatsSnapshot();
    expect(snapshot.websocketPush.totals.messages).toBe(3);
    expect(snapshot.websocketPush.totals.payloadBytes).toBe(252);
    expect(snapshot.websocketPush.totals.deliveredClients).toBe(6);
    expect(snapshot.websocketPush.totals.droppedClients).toBe(1);
    expect(snapshot.websocketPush.byType["git-history-changed"]).toEqual({
      deliveredClients: 4,
      droppedClients: 1,
      messages: 2,
      payloadBytes: 172,
    });

    const summary = getRuntimeStatsSummary();
    expect(summary.websocketPush.typeCount).toBe(2);
    expect(summary.websocketPush.topPayloadBytesTypes).toEqual([
      {
        deliveredClients: 4,
        droppedClients: 1,
        messages: 2,
        payloadBytes: 172,
        type: "git-history-changed",
      },
      {
        deliveredClients: 2,
        droppedClients: 0,
        messages: 1,
        payloadBytes: 80,
        type: "thread-extension-ui",
      },
    ]);
  });

  it("tracks sqlite retry loops including exhaustion in snapshots and summary", () => {
    recordSqliteRetryLoop({
      exhausted: false,
      retryCount: 2,
      totalBackoffMs: 75,
    });
    recordSqliteRetryLoop({
      exhausted: true,
      retryCount: 5,
      totalBackoffMs: 620,
    });

    const expectedRetryStats = {
      exhaustedLoops: 1,
      loopsWithRetry: 2,
      peakRetryCount: 5,
      totalBackoffMs: 695,
      totalRetries: 7,
    };

    const snapshot = getRuntimeStatsSnapshot();
    expect(snapshot.sqliteRetry).toEqual(expectedRetryStats);

    const summary = getRuntimeStatsSummary();
    expect(summary.sqliteRetry).toEqual(expectedRetryStats);
  });

  it("tracks git cache hit and miss counters", () => {
    recordGitHistoryCacheRangeHit();
    recordGitHistoryCacheFetch();
    recordGitHistoryCacheFetch();
    recordGitHistoryCachePrefetchWait();
    recordGitHistoryCachePreemption();
    recordGitCommitDiffCacheHit();
    recordGitCommitDiffCacheMiss();
    recordGitCommitDiffPendingReuse();
    recordGitCommitDiffStore();

    const snapshot = getRuntimeStatsSnapshot();
    expect(snapshot.gitCache.historyPage).toEqual({
      cacheRangeHit: 1,
      fetches: 2,
      preemptions: 1,
      prefetchWaits: 1,
    });
    expect(snapshot.gitCache.commitDiff).toEqual({
      hits: 1,
      misses: 1,
      pendingReuse: 1,
      stores: 1,
    });
  });

  it("tracks cron run duration, queue pressure, and timeout counters", async () => {
    recordCronRunQueued(1);

    const firstRun = recordCronRunStarted({
      activeRuns: 1,
      pendingRuns: 1,
    });
    const secondRun = recordCronRunStarted({
      activeRuns: 2,
      pendingRuns: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 2));
    recordCronRunFinished(firstRun, {
      activeRuns: 1,
      pendingRuns: 0,
      status: "Completed",
      timedOut: false,
    });
    recordCronPendingRuns(0);

    await new Promise((resolve) => setTimeout(resolve, 2));
    recordCronRunFinished(secondRun, {
      activeRuns: 0,
      pendingRuns: 0,
      status: "Errored",
      timedOut: true,
    });

    const snapshot = getRuntimeStatsSnapshot();
    expect(snapshot.cron).toMatchObject({
      activeRuns: 0,
      completedRuns: 1,
      erroredRuns: 1,
      peakActiveRuns: 2,
      peakPendingRuns: 1,
      pendingRuns: 0,
      saturationEvents: 1,
      startedRuns: 2,
      stoppedRuns: 0,
      timedOutRuns: 1,
    });
    expect(snapshot.cron.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.cron.peakDurationMs).toBeGreaterThanOrEqual(
      snapshot.cron.lastDurationMs,
    );

    const summary = getRuntimeStatsSummary();
    expect(summary.cron).toEqual(snapshot.cron);
  });

  it("reset clears counters and refreshes the startedAt timestamp", async () => {
    const token = recordRpcStarted("listThreads", 12);
    recordRpcSucceeded(token, 24);
    const beforeReset = getRuntimeStatsSnapshot();

    await new Promise((resolve) => setTimeout(resolve, 2));
    resetRuntimeStats();

    const afterReset = getRuntimeStatsSnapshot();
    expect(afterReset.startedAt).not.toBe(beforeReset.startedAt);
    expect(afterReset.rpc.totals.calls).toBe(0);
    expect(afterReset.websocketPush.totals.messages).toBe(0);
    expect(afterReset.sqliteRetry.totalRetries).toBe(0);
    expect(afterReset.gitCache.historyPage.fetches).toBe(0);
    expect(afterReset.cron.startedRuns).toBe(0);
  });
});
