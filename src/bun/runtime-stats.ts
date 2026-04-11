/**
 * @file src/bun/runtime-stats.ts
 * @description Lightweight process-local runtime statistics collector.
 */

import type { AppRPCSchema } from "./rpc-schema";

type RpcMethodName = keyof AppRPCSchema["requests"];
export type RpcMethodRuntimeStats = {
  calls: number;
  canceled: number;
  failed: number;
  lastDurationMs: number;
  peakDurationMs: number;
  requestBytes: number;
  responseBytes: number;
  succeeded: number;
  timedOut: number;
  totalDurationMs: number;
};

export type RuntimeStatsRpcTotals = {
  calls: number;
  canceled: number;
  failed: number;
  peakDurationMs: number;
  requestBytes: number;
  responseBytes: number;
  succeeded: number;
  timedOut: number;
  totalDurationMs: number;
};

export type WebSocketPushRuntimeStats = {
  deliveredClients: number;
  droppedClients: number;
  messages: number;
  payloadBytes: number;
};

export type RuntimeStatsWebSocketTotals = {
  deliveredClients: number;
  droppedClients: number;
  messages: number;
  payloadBytes: number;
};

export type SqliteRetryRuntimeStats = {
  exhaustedLoops: number;
  loopsWithRetry: number;
  peakRetryCount: number;
  totalBackoffMs: number;
  totalRetries: number;
};

export type GitHistoryPageCacheRuntimeStats = {
  cacheRangeHit: number;
  fetches: number;
  preemptions: number;
  prefetchWaits: number;
};

export type GitCommitDiffCacheRuntimeStats = {
  hits: number;
  misses: number;
  pendingReuse: number;
  stores: number;
};

export type RuntimeStatsSnapshot = {
  gitCache: {
    commitDiff: GitCommitDiffCacheRuntimeStats;
    historyPage: GitHistoryPageCacheRuntimeStats;
  };
  rpc: {
    byMethod: Record<string, RpcMethodRuntimeStats>;
    totals: RuntimeStatsRpcTotals;
  };
  sqliteRetry: SqliteRetryRuntimeStats;
  startedAt: string;
  websocketPush: {
    byType: Record<string, WebSocketPushRuntimeStats>;
    totals: RuntimeStatsWebSocketTotals;
  };
};

export type RankedRpcPayloadRuntimeStats = {
  calls: number;
  method: string;
  requestBytes: number;
  responseBytes: number;
};

export type RankedWebSocketPushPayloadRuntimeStats = {
  deliveredClients: number;
  droppedClients: number;
  messages: number;
  payloadBytes: number;
  type: string;
};

export type RuntimeStatsSummary = {
  gitCache: RuntimeStatsSnapshot["gitCache"];
  rpc: RuntimeStatsRpcTotals & {
    methodCount: number;
    topResponseBytesMethods: RankedRpcPayloadRuntimeStats[];
  };
  sqliteRetry: SqliteRetryRuntimeStats;
  startedAt: string;
  websocketPush: RuntimeStatsWebSocketTotals & {
    topPayloadBytesTypes: RankedWebSocketPushPayloadRuntimeStats[];
    typeCount: number;
  };
};

export type ProcessMemoryUsageSnapshot = {
  arrayBuffers: number;
  external: number;
  heapTotal: number;
  heapUsed: number;
  rss: number;
};

export type RuntimeDiagnosticsSnapshot = {
  collectedAt: string;
  memoryUsage: ProcessMemoryUsageSnapshot;
  runtimeStats: RuntimeStatsSnapshot;
  runtimeStatsSummary: RuntimeStatsSummary;
};

export function readProcessMemoryUsageSnapshot(): ProcessMemoryUsageSnapshot {
  const memory = process.memoryUsage();
  return {
    arrayBuffers: memory.arrayBuffers,
    external: memory.external,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    rss: memory.rss,
  };
}

export function buildRuntimeDiagnosticsSnapshot(
  collectedAt = new Date().toISOString(),
): RuntimeDiagnosticsSnapshot {
  return {
    collectedAt,
    memoryUsage: readProcessMemoryUsageSnapshot(),
    runtimeStats: getRuntimeStatsSnapshot(),
    runtimeStatsSummary: getRuntimeStatsSummary(),
  };
}

export type RpcMeasurementToken = {
  method: RpcMethodName | (string & {});
  startedAtMs: number;
};

type RuntimeStatsState = {
  gitCache: RuntimeStatsSnapshot["gitCache"];
  rpcByMethod: Map<string, RpcMethodRuntimeStats>;
  rpcTotals: RuntimeStatsRpcTotals;
  sqliteRetry: SqliteRetryRuntimeStats;
  startedAt: string;
  websocketPushByType: Map<string, WebSocketPushRuntimeStats>;
  websocketPushTotals: RuntimeStatsWebSocketTotals;
};

function createEmptyRpcMethodRuntimeStats(): RpcMethodRuntimeStats {
  return {
    calls: 0,
    canceled: 0,
    failed: 0,
    lastDurationMs: 0,
    peakDurationMs: 0,
    requestBytes: 0,
    responseBytes: 0,
    succeeded: 0,
    timedOut: 0,
    totalDurationMs: 0,
  };
}

function createEmptyRuntimeStatsState(now = new Date()): RuntimeStatsState {
  return {
    gitCache: {
      commitDiff: {
        hits: 0,
        misses: 0,
        pendingReuse: 0,
        stores: 0,
      },
      historyPage: {
        cacheRangeHit: 0,
        fetches: 0,
        preemptions: 0,
        prefetchWaits: 0,
      },
    },
    rpcByMethod: new Map<string, RpcMethodRuntimeStats>(),
    rpcTotals: {
      calls: 0,
      canceled: 0,
      failed: 0,
      peakDurationMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      succeeded: 0,
      timedOut: 0,
      totalDurationMs: 0,
    },
    sqliteRetry: {
      exhaustedLoops: 0,
      loopsWithRetry: 0,
      peakRetryCount: 0,
      totalBackoffMs: 0,
      totalRetries: 0,
    },
    startedAt: now.toISOString(),
    websocketPushByType: new Map<string, WebSocketPushRuntimeStats>(),
    websocketPushTotals: {
      deliveredClients: 0,
      droppedClients: 0,
      messages: 0,
      payloadBytes: 0,
    },
  };
}

const RUNTIME_STATS_TOP_ENTRY_LIMIT = 5;

let runtimeStatsState = createEmptyRuntimeStatsState();

function ensureRpcMethodRuntimeStats(
  method: RpcMethodName | (string & {}),
): RpcMethodRuntimeStats {
  const key = String(method);
  const existing = runtimeStatsState.rpcByMethod.get(key);
  if (existing) {
    return existing;
  }

  const created = createEmptyRpcMethodRuntimeStats();
  runtimeStatsState.rpcByMethod.set(key, created);
  return created;
}

function ensureWebSocketPushRuntimeStats(
  type: string,
): WebSocketPushRuntimeStats {
  const existing = runtimeStatsState.websocketPushByType.get(type);
  if (existing) {
    return existing;
  }

  const created: WebSocketPushRuntimeStats = {
    deliveredClients: 0,
    droppedClients: 0,
    messages: 0,
    payloadBytes: 0,
  };
  runtimeStatsState.websocketPushByType.set(type, created);
  return created;
}

function cloneMapRecord<Value extends Record<string, number>>(
  map: Map<string, Value>,
): Record<string, Value> {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, { ...value }]),
  );
}

function summarizeTopRpcResponseBytesMethods(
  map: Map<string, RpcMethodRuntimeStats>,
): RankedRpcPayloadRuntimeStats[] {
  return [...map.entries()]
    .sort(([leftMethod, left], [rightMethod, right]) => {
      if (right.responseBytes !== left.responseBytes) {
        return right.responseBytes - left.responseBytes;
      }
      if (right.calls !== left.calls) {
        return right.calls - left.calls;
      }
      return leftMethod.localeCompare(rightMethod);
    })
    .slice(0, RUNTIME_STATS_TOP_ENTRY_LIMIT)
    .map(([method, stats]) => ({
      calls: stats.calls,
      method,
      requestBytes: stats.requestBytes,
      responseBytes: stats.responseBytes,
    }));
}

function summarizeTopWebSocketPushPayloadTypes(
  map: Map<string, WebSocketPushRuntimeStats>,
): RankedWebSocketPushPayloadRuntimeStats[] {
  return [...map.entries()]
    .sort(([leftType, left], [rightType, right]) => {
      if (right.payloadBytes !== left.payloadBytes) {
        return right.payloadBytes - left.payloadBytes;
      }
      if (right.messages !== left.messages) {
        return right.messages - left.messages;
      }
      return leftType.localeCompare(rightType);
    })
    .slice(0, RUNTIME_STATS_TOP_ENTRY_LIMIT)
    .map(([type, stats]) => ({
      deliveredClients: stats.deliveredClients,
      droppedClients: stats.droppedClients,
      messages: stats.messages,
      payloadBytes: stats.payloadBytes,
      type,
    }));
}

function recordRpcOutcome(
  token: RpcMeasurementToken,
  outcome: "canceled" | "failed" | "succeeded" | "timedOut",
  responseBytes: number,
): void {
  const durationMs = Math.max(0, performance.now() - token.startedAtMs);
  const methodStats = ensureRpcMethodRuntimeStats(token.method);
  methodStats.lastDurationMs = durationMs;
  methodStats.peakDurationMs = Math.max(methodStats.peakDurationMs, durationMs);
  methodStats.responseBytes += responseBytes;
  methodStats.totalDurationMs += durationMs;

  runtimeStatsState.rpcTotals.peakDurationMs = Math.max(
    runtimeStatsState.rpcTotals.peakDurationMs,
    durationMs,
  );
  runtimeStatsState.rpcTotals.responseBytes += responseBytes;
  runtimeStatsState.rpcTotals.totalDurationMs += durationMs;

  switch (outcome) {
    case "canceled":
      methodStats.canceled += 1;
      runtimeStatsState.rpcTotals.canceled += 1;
      return;
    case "failed":
      methodStats.failed += 1;
      runtimeStatsState.rpcTotals.failed += 1;
      return;
    case "succeeded":
      methodStats.succeeded += 1;
      runtimeStatsState.rpcTotals.succeeded += 1;
      return;
    case "timedOut":
      methodStats.timedOut += 1;
      runtimeStatsState.rpcTotals.timedOut += 1;
      return;
  }
}

export function recordRpcStarted(
  method: RpcMethodName | (string & {}),
  requestBytes: number,
): RpcMeasurementToken {
  const methodStats = ensureRpcMethodRuntimeStats(method);
  methodStats.calls += 1;
  methodStats.requestBytes += requestBytes;

  runtimeStatsState.rpcTotals.calls += 1;
  runtimeStatsState.rpcTotals.requestBytes += requestBytes;

  return {
    method,
    startedAtMs: performance.now(),
  };
}

export function recordRpcSucceeded(
  token: RpcMeasurementToken,
  responseBytes: number,
): void {
  recordRpcOutcome(token, "succeeded", responseBytes);
}

export function recordRpcFailed(
  token: RpcMeasurementToken,
  responseBytes: number,
): void {
  recordRpcOutcome(token, "failed", responseBytes);
}

export function recordRpcTimedOut(
  token: RpcMeasurementToken,
  responseBytes: number,
): void {
  recordRpcOutcome(token, "timedOut", responseBytes);
}

export function recordRpcCanceled(token: RpcMeasurementToken): void {
  recordRpcOutcome(token, "canceled", 0);
}

export function recordWebSocketPush(options: {
  deliveredClients: number;
  droppedClients: number;
  payloadBytes: number;
  type: string;
}): void {
  const pushStats = ensureWebSocketPushRuntimeStats(options.type);
  pushStats.deliveredClients += options.deliveredClients;
  pushStats.droppedClients += options.droppedClients;
  pushStats.messages += 1;
  pushStats.payloadBytes += options.payloadBytes;

  runtimeStatsState.websocketPushTotals.deliveredClients +=
    options.deliveredClients;
  runtimeStatsState.websocketPushTotals.droppedClients +=
    options.droppedClients;
  runtimeStatsState.websocketPushTotals.messages += 1;
  runtimeStatsState.websocketPushTotals.payloadBytes += options.payloadBytes;
}

export function recordSqliteRetryLoop(options: {
  exhausted: boolean;
  retryCount: number;
  totalBackoffMs: number;
}): void {
  if (options.retryCount > 0) {
    runtimeStatsState.sqliteRetry.loopsWithRetry += 1;
  }
  if (options.exhausted) {
    runtimeStatsState.sqliteRetry.exhaustedLoops += 1;
  }
  runtimeStatsState.sqliteRetry.peakRetryCount = Math.max(
    runtimeStatsState.sqliteRetry.peakRetryCount,
    options.retryCount,
  );
  runtimeStatsState.sqliteRetry.totalBackoffMs += options.totalBackoffMs;
  runtimeStatsState.sqliteRetry.totalRetries += options.retryCount;
}

export function recordGitHistoryCacheRangeHit(): void {
  runtimeStatsState.gitCache.historyPage.cacheRangeHit += 1;
}

export function recordGitHistoryCacheFetch(): void {
  runtimeStatsState.gitCache.historyPage.fetches += 1;
}

export function recordGitHistoryCachePrefetchWait(): void {
  runtimeStatsState.gitCache.historyPage.prefetchWaits += 1;
}

export function recordGitHistoryCachePreemption(): void {
  runtimeStatsState.gitCache.historyPage.preemptions += 1;
}

export function recordGitCommitDiffCacheHit(): void {
  runtimeStatsState.gitCache.commitDiff.hits += 1;
}

export function recordGitCommitDiffCacheMiss(): void {
  runtimeStatsState.gitCache.commitDiff.misses += 1;
}

export function recordGitCommitDiffPendingReuse(): void {
  runtimeStatsState.gitCache.commitDiff.pendingReuse += 1;
}

export function recordGitCommitDiffStore(): void {
  runtimeStatsState.gitCache.commitDiff.stores += 1;
}

export function getRuntimeStatsSnapshot(): RuntimeStatsSnapshot {
  return {
    gitCache: {
      commitDiff: {
        ...runtimeStatsState.gitCache.commitDiff,
      },
      historyPage: {
        ...runtimeStatsState.gitCache.historyPage,
      },
    },
    rpc: {
      byMethod: cloneMapRecord(runtimeStatsState.rpcByMethod),
      totals: {
        ...runtimeStatsState.rpcTotals,
      },
    },
    sqliteRetry: {
      ...runtimeStatsState.sqliteRetry,
    },
    startedAt: runtimeStatsState.startedAt,
    websocketPush: {
      byType: cloneMapRecord(runtimeStatsState.websocketPushByType),
      totals: {
        ...runtimeStatsState.websocketPushTotals,
      },
    },
  };
}

export function getRuntimeStatsSummary(): RuntimeStatsSummary {
  return {
    gitCache: {
      commitDiff: {
        ...runtimeStatsState.gitCache.commitDiff,
      },
      historyPage: {
        ...runtimeStatsState.gitCache.historyPage,
      },
    },
    rpc: {
      ...runtimeStatsState.rpcTotals,
      methodCount: runtimeStatsState.rpcByMethod.size,
      topResponseBytesMethods: summarizeTopRpcResponseBytesMethods(
        runtimeStatsState.rpcByMethod,
      ),
    },
    sqliteRetry: {
      ...runtimeStatsState.sqliteRetry,
    },
    startedAt: runtimeStatsState.startedAt,
    websocketPush: {
      ...runtimeStatsState.websocketPushTotals,
      topPayloadBytesTypes: summarizeTopWebSocketPushPayloadTypes(
        runtimeStatsState.websocketPushByType,
      ),
      typeCount: runtimeStatsState.websocketPushByType.size,
    },
  };
}

export function resetRuntimeStats(now = new Date()): void {
  runtimeStatsState = createEmptyRuntimeStatsState(now);
}
