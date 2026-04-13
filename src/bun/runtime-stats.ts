/**
 * @file src/bun/runtime-stats.ts
 * @description Lightweight process-local runtime statistics collector.
 */

import type { CronJobRunStatus } from "./db";
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

export type CronRuntimeStats = {
  activeRuns: number;
  completedRuns: number;
  erroredRuns: number;
  lastDurationMs: number;
  peakActiveRuns: number;
  peakDurationMs: number;
  peakPendingRuns: number;
  pendingRuns: number;
  saturationEvents: number;
  startedRuns: number;
  stoppedRuns: number;
  timedOutRuns: number;
  totalDurationMs: number;
};

export type NativeWebSearchProviderRuntimeStats = {
  eligibleRequests: number;
  injectedRequests: number;
  skippedRequests: number;
};

export type NativeWebSearchRuntimeStats = {
  byProvider: Record<string, NativeWebSearchProviderRuntimeStats>;
  totals: NativeWebSearchProviderRuntimeStats;
};

export type RuntimeStatsSnapshot = {
  cron: CronRuntimeStats;
  gitCache: {
    commitDiff: GitCommitDiffCacheRuntimeStats;
    historyPage: GitHistoryPageCacheRuntimeStats;
  };
  metidosTools: RuntimeStatsMetidosToolsSnapshot;
  rpc: {
    byMethod: Record<string, RpcMethodRuntimeStats>;
    totals: RuntimeStatsRpcTotals;
  };
  sqliteRetry: SqliteRetryRuntimeStats;
  startedAt: string;
  webSearch?: NativeWebSearchRuntimeStats;
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
  cron: CronRuntimeStats;
  gitCache: RuntimeStatsSnapshot["gitCache"];
  metidosTools: RuntimeStatsMetidosToolsSummary;
  rpc: RuntimeStatsRpcTotals & {
    methodCount: number;
    topResponseBytesMethods: RankedRpcPayloadRuntimeStats[];
  };
  sqliteRetry: SqliteRetryRuntimeStats;
  startedAt: string;
  webSearch?: NativeWebSearchRuntimeStats & {
    providerCount: number;
  };
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

export type CronRunMeasurementToken = {
  startedAtMs: number;
};

export type MetidosToolMeasurementToken = {
  startedAtMs: number;
  toolName: string;
};

export type MetidosToolRuntimeStats = {
  calls: number;
  failed: number;
  lastDurationMs: number;
  peakDurationMs: number;
  succeeded: number;
  totalDurationMs: number;
};

export type MetidosUnsafeModeRequestRuntimeStats = {
  allowed: number;
  blocked: number;
  requested: number;
};

export type MetidosSandboxRuntimeStats = {
  calls: number;
  failed: number;
  succeeded: number;
  timedOut: number;
};

export type MetidosToolBudgetRuntimeStats = {
  activeCount: number;
  completedCalls: number;
  peakActiveCount: number;
  peakPendingCount: number;
  pendingCount: number;
  queuedCalls: number;
  saturationEvents: number;
  startedCalls: number;
};

export type RuntimeStatsMetidosToolBudgetsSnapshot = {
  byBudget: Record<string, MetidosToolBudgetRuntimeStats>;
};

export type RuntimeStatsMetidosToolBudgetsSummary =
  RuntimeStatsMetidosToolBudgetsSnapshot & {
    budgetCount: number;
  };

export type RuntimeStatsMetidosToolsSnapshot = {
  byTool: Record<string, MetidosToolRuntimeStats>;
  budgets?: RuntimeStatsMetidosToolBudgetsSnapshot;
  sandbox: MetidosSandboxRuntimeStats;
  totals: MetidosToolRuntimeStats;
  unsafeModeRequests: {
    byTool: Record<string, MetidosUnsafeModeRequestRuntimeStats>;
    totals: MetidosUnsafeModeRequestRuntimeStats;
  };
};

export type RuntimeStatsMetidosToolsSummary = Omit<
  RuntimeStatsMetidosToolsSnapshot,
  "budgets"
> & {
  budgets?: RuntimeStatsMetidosToolBudgetsSummary;
  toolCount: number;
  unsafeModeToolCount: number;
};

type RuntimeStatsState = {
  cron: CronRuntimeStats;
  gitCache: RuntimeStatsSnapshot["gitCache"];
  metidosSandbox: MetidosSandboxRuntimeStats;
  metidosToolBudgetByName: Map<string, MetidosToolBudgetRuntimeStats>;
  metidosToolByName: Map<string, MetidosToolRuntimeStats>;
  metidosToolTotals: MetidosToolRuntimeStats;
  metidosUnsafeModeByTool: Map<string, MetidosUnsafeModeRequestRuntimeStats>;
  metidosUnsafeModeTotals: MetidosUnsafeModeRequestRuntimeStats;
  nativeWebSearchByProvider: Map<string, NativeWebSearchProviderRuntimeStats>;
  nativeWebSearchTotals: NativeWebSearchProviderRuntimeStats;
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

function createEmptyMetidosToolRuntimeStats(): MetidosToolRuntimeStats {
  return {
    calls: 0,
    failed: 0,
    lastDurationMs: 0,
    peakDurationMs: 0,
    succeeded: 0,
    totalDurationMs: 0,
  };
}

function createEmptyMetidosUnsafeModeRequestRuntimeStats(): MetidosUnsafeModeRequestRuntimeStats {
  return {
    allowed: 0,
    blocked: 0,
    requested: 0,
  };
}

function createEmptyMetidosToolBudgetRuntimeStats(): MetidosToolBudgetRuntimeStats {
  return {
    activeCount: 0,
    completedCalls: 0,
    peakActiveCount: 0,
    peakPendingCount: 0,
    pendingCount: 0,
    queuedCalls: 0,
    saturationEvents: 0,
    startedCalls: 0,
  };
}

function createEmptyRuntimeStatsState(now = new Date()): RuntimeStatsState {
  return {
    cron: {
      activeRuns: 0,
      completedRuns: 0,
      erroredRuns: 0,
      lastDurationMs: 0,
      peakActiveRuns: 0,
      peakDurationMs: 0,
      peakPendingRuns: 0,
      pendingRuns: 0,
      saturationEvents: 0,
      startedRuns: 0,
      stoppedRuns: 0,
      timedOutRuns: 0,
      totalDurationMs: 0,
    },
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
    metidosSandbox: {
      calls: 0,
      failed: 0,
      succeeded: 0,
      timedOut: 0,
    },
    metidosToolBudgetByName: new Map<string, MetidosToolBudgetRuntimeStats>(),
    metidosToolByName: new Map<string, MetidosToolRuntimeStats>(),
    metidosToolTotals: createEmptyMetidosToolRuntimeStats(),
    metidosUnsafeModeByTool: new Map<
      string,
      MetidosUnsafeModeRequestRuntimeStats
    >(),
    metidosUnsafeModeTotals: createEmptyMetidosUnsafeModeRequestRuntimeStats(),
    nativeWebSearchByProvider: new Map<
      string,
      NativeWebSearchProviderRuntimeStats
    >(),
    nativeWebSearchTotals: {
      eligibleRequests: 0,
      injectedRequests: 0,
      skippedRequests: 0,
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

function ensureMetidosToolRuntimeStats(
  toolName: string,
): MetidosToolRuntimeStats {
  const existing = runtimeStatsState.metidosToolByName.get(toolName);
  if (existing) {
    return existing;
  }

  const created = createEmptyMetidosToolRuntimeStats();
  runtimeStatsState.metidosToolByName.set(toolName, created);
  return created;
}

function ensureMetidosToolBudgetRuntimeStats(
  budgetName: string,
): MetidosToolBudgetRuntimeStats {
  const existing = runtimeStatsState.metidosToolBudgetByName.get(budgetName);
  if (existing) {
    return existing;
  }

  const created = createEmptyMetidosToolBudgetRuntimeStats();
  runtimeStatsState.metidosToolBudgetByName.set(budgetName, created);
  return created;
}

function ensureMetidosUnsafeModeRequestRuntimeStats(
  toolName: string,
): MetidosUnsafeModeRequestRuntimeStats {
  const existing = runtimeStatsState.metidosUnsafeModeByTool.get(toolName);
  if (existing) {
    return existing;
  }

  const created = createEmptyMetidosUnsafeModeRequestRuntimeStats();
  runtimeStatsState.metidosUnsafeModeByTool.set(toolName, created);
  return created;
}

function ensureNativeWebSearchProviderRuntimeStats(
  provider: string,
): NativeWebSearchProviderRuntimeStats {
  const existing = runtimeStatsState.nativeWebSearchByProvider.get(provider);
  if (existing) {
    return existing;
  }

  const created: NativeWebSearchProviderRuntimeStats = {
    eligibleRequests: 0,
    injectedRequests: 0,
    skippedRequests: 0,
  };
  runtimeStatsState.nativeWebSearchByProvider.set(provider, created);
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

function buildMetidosToolBudgetSnapshot():
  | RuntimeStatsMetidosToolBudgetsSnapshot
  | undefined {
  if (runtimeStatsState.metidosToolBudgetByName.size === 0) {
    return undefined;
  }

  return {
    byBudget: cloneMapRecord(runtimeStatsState.metidosToolBudgetByName),
  };
}

function buildMetidosToolBudgetSummary():
  | RuntimeStatsMetidosToolBudgetsSummary
  | undefined {
  const snapshot = buildMetidosToolBudgetSnapshot();
  if (!snapshot) {
    return undefined;
  }

  return {
    ...snapshot,
    budgetCount: runtimeStatsState.metidosToolBudgetByName.size,
  };
}

function updateCronPressureState(options: {
  activeRuns?: number | null;
  pendingRuns?: number | null;
}): void {
  if (typeof options.activeRuns === "number") {
    const activeRuns = Math.max(0, Math.trunc(options.activeRuns));
    runtimeStatsState.cron.activeRuns = activeRuns;
    runtimeStatsState.cron.peakActiveRuns = Math.max(
      runtimeStatsState.cron.peakActiveRuns,
      activeRuns,
    );
  }
  if (typeof options.pendingRuns === "number") {
    const pendingRuns = Math.max(0, Math.trunc(options.pendingRuns));
    runtimeStatsState.cron.pendingRuns = pendingRuns;
    runtimeStatsState.cron.peakPendingRuns = Math.max(
      runtimeStatsState.cron.peakPendingRuns,
      pendingRuns,
    );
  }
}

function updateMetidosToolBudgetState(options: {
  activeCount: number;
  budgetName: string;
  pendingCount: number;
}): MetidosToolBudgetRuntimeStats {
  const budgetStats = ensureMetidosToolBudgetRuntimeStats(options.budgetName);
  budgetStats.activeCount = Math.max(0, Math.trunc(options.activeCount));
  budgetStats.pendingCount = Math.max(0, Math.trunc(options.pendingCount));
  budgetStats.peakActiveCount = Math.max(
    budgetStats.peakActiveCount,
    budgetStats.activeCount,
  );
  budgetStats.peakPendingCount = Math.max(
    budgetStats.peakPendingCount,
    budgetStats.pendingCount,
  );
  return budgetStats;
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

export function recordNativeWebSearchDecision(options: {
  decision: "injected" | "skipped";
  provider: string;
}): void {
  const providerStats = ensureNativeWebSearchProviderRuntimeStats(
    options.provider,
  );

  providerStats.eligibleRequests += 1;
  runtimeStatsState.nativeWebSearchTotals.eligibleRequests += 1;
  if (options.decision === "injected") {
    providerStats.injectedRequests += 1;
    runtimeStatsState.nativeWebSearchTotals.injectedRequests += 1;
    return;
  }

  providerStats.skippedRequests += 1;
  runtimeStatsState.nativeWebSearchTotals.skippedRequests += 1;
}

export function recordCronRunQueued(pendingRuns: number): void {
  runtimeStatsState.cron.saturationEvents += 1;
  updateCronPressureState({
    pendingRuns,
  });
}

export function recordCronPendingRuns(pendingRuns: number): void {
  updateCronPressureState({
    pendingRuns,
  });
}

export function recordCronRunStarted(options?: {
  activeRuns?: number | null;
  pendingRuns?: number | null;
}): CronRunMeasurementToken {
  runtimeStatsState.cron.startedRuns += 1;
  updateCronPressureState({
    activeRuns: options?.activeRuns ?? null,
    pendingRuns: options?.pendingRuns ?? null,
  });
  return {
    startedAtMs: performance.now(),
  };
}

export function recordCronRunFinished(
  token: CronRunMeasurementToken,
  options: {
    activeRuns?: number | null;
    pendingRuns?: number | null;
    status: CronJobRunStatus;
    timedOut?: boolean | null;
  },
): void {
  const durationMs = Math.max(0, performance.now() - token.startedAtMs);
  runtimeStatsState.cron.lastDurationMs = durationMs;
  runtimeStatsState.cron.totalDurationMs += durationMs;
  runtimeStatsState.cron.peakDurationMs = Math.max(
    runtimeStatsState.cron.peakDurationMs,
    durationMs,
  );
  updateCronPressureState({
    activeRuns: options.activeRuns ?? null,
    pendingRuns: options.pendingRuns ?? null,
  });
  if (options.timedOut === true) {
    runtimeStatsState.cron.timedOutRuns += 1;
  }
  switch (options.status) {
    case "Completed":
      runtimeStatsState.cron.completedRuns += 1;
      return;
    case "Stopped":
      runtimeStatsState.cron.stoppedRuns += 1;
      return;
    case "Errored":
      runtimeStatsState.cron.erroredRuns += 1;
      return;
    case "InProgress":
      return;
  }
}

function recordMetidosToolOutcome(
  token: MetidosToolMeasurementToken,
  outcome: "failed" | "succeeded",
): void {
  const durationMs = Math.max(0, performance.now() - token.startedAtMs);
  const toolStats = ensureMetidosToolRuntimeStats(token.toolName);
  toolStats.lastDurationMs = durationMs;
  toolStats.peakDurationMs = Math.max(toolStats.peakDurationMs, durationMs);
  toolStats.totalDurationMs += durationMs;

  runtimeStatsState.metidosToolTotals.lastDurationMs = durationMs;
  runtimeStatsState.metidosToolTotals.peakDurationMs = Math.max(
    runtimeStatsState.metidosToolTotals.peakDurationMs,
    durationMs,
  );
  runtimeStatsState.metidosToolTotals.totalDurationMs += durationMs;

  if (outcome === "succeeded") {
    toolStats.succeeded += 1;
    runtimeStatsState.metidosToolTotals.succeeded += 1;
    return;
  }

  toolStats.failed += 1;
  runtimeStatsState.metidosToolTotals.failed += 1;
}

export function recordMetidosToolStarted(
  toolName: string,
): MetidosToolMeasurementToken {
  const toolStats = ensureMetidosToolRuntimeStats(toolName);
  toolStats.calls += 1;
  runtimeStatsState.metidosToolTotals.calls += 1;

  return {
    startedAtMs: performance.now(),
    toolName,
  };
}

export function recordMetidosToolSucceeded(
  token: MetidosToolMeasurementToken,
): void {
  recordMetidosToolOutcome(token, "succeeded");
}

export function recordMetidosToolFailed(
  token: MetidosToolMeasurementToken,
): void {
  recordMetidosToolOutcome(token, "failed");
}

export function recordMetidosUnsafeModeRequest(options: {
  allowed: boolean;
  toolName: string;
}): void {
  const toolStats = ensureMetidosUnsafeModeRequestRuntimeStats(
    options.toolName,
  );
  toolStats.requested += 1;
  runtimeStatsState.metidosUnsafeModeTotals.requested += 1;
  if (options.allowed) {
    toolStats.allowed += 1;
    runtimeStatsState.metidosUnsafeModeTotals.allowed += 1;
    return;
  }
  toolStats.blocked += 1;
  runtimeStatsState.metidosUnsafeModeTotals.blocked += 1;
}

export function recordMetidosToolBudgetState(options: {
  activeCount: number;
  budgetName: string;
  pendingCount: number;
}): void {
  updateMetidosToolBudgetState(options);
}

export function recordMetidosToolBudgetQueued(options: {
  activeCount: number;
  budgetName: string;
  pendingCount: number;
}): void {
  const budgetStats = updateMetidosToolBudgetState(options);
  budgetStats.queuedCalls += 1;
}

export function recordMetidosToolBudgetStarted(options: {
  activeCount: number;
  budgetName: string;
  pendingCount: number;
}): void {
  const budgetStats = updateMetidosToolBudgetState(options);
  budgetStats.startedCalls += 1;
}

export function recordMetidosToolBudgetFinished(options: {
  activeCount: number;
  budgetName: string;
  pendingCount: number;
}): void {
  const budgetStats = updateMetidosToolBudgetState(options);
  budgetStats.completedCalls += 1;
}

export function recordMetidosToolBudgetSaturated(options: {
  activeCount: number;
  budgetName: string;
  pendingCount: number;
}): void {
  const budgetStats = updateMetidosToolBudgetState(options);
  budgetStats.saturationEvents += 1;
}

export function recordMetidosSandboxRun(options: {
  outcome: "failed" | "succeeded" | "timedOut";
}): void {
  runtimeStatsState.metidosSandbox.calls += 1;
  switch (options.outcome) {
    case "succeeded":
      runtimeStatsState.metidosSandbox.succeeded += 1;
      return;
    case "timedOut":
      runtimeStatsState.metidosSandbox.timedOut += 1;
      return;
    case "failed":
      runtimeStatsState.metidosSandbox.failed += 1;
      return;
  }
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
  const metidosToolBudgets = buildMetidosToolBudgetSnapshot();
  return {
    cron: {
      ...runtimeStatsState.cron,
    },
    gitCache: {
      commitDiff: {
        ...runtimeStatsState.gitCache.commitDiff,
      },
      historyPage: {
        ...runtimeStatsState.gitCache.historyPage,
      },
    },
    metidosTools: metidosToolBudgets
      ? {
          budgets: metidosToolBudgets,
          byTool: cloneMapRecord(runtimeStatsState.metidosToolByName),
          sandbox: {
            ...runtimeStatsState.metidosSandbox,
          },
          totals: {
            ...runtimeStatsState.metidosToolTotals,
          },
          unsafeModeRequests: {
            byTool: cloneMapRecord(runtimeStatsState.metidosUnsafeModeByTool),
            totals: {
              ...runtimeStatsState.metidosUnsafeModeTotals,
            },
          },
        }
      : {
          byTool: cloneMapRecord(runtimeStatsState.metidosToolByName),
          sandbox: {
            ...runtimeStatsState.metidosSandbox,
          },
          totals: {
            ...runtimeStatsState.metidosToolTotals,
          },
          unsafeModeRequests: {
            byTool: cloneMapRecord(runtimeStatsState.metidosUnsafeModeByTool),
            totals: {
              ...runtimeStatsState.metidosUnsafeModeTotals,
            },
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
    webSearch: {
      byProvider: cloneMapRecord(runtimeStatsState.nativeWebSearchByProvider),
      totals: {
        ...runtimeStatsState.nativeWebSearchTotals,
      },
    },
    websocketPush: {
      byType: cloneMapRecord(runtimeStatsState.websocketPushByType),
      totals: {
        ...runtimeStatsState.websocketPushTotals,
      },
    },
  };
}

export function getRuntimeStatsSummary(): RuntimeStatsSummary {
  const metidosToolBudgets = buildMetidosToolBudgetSummary();
  return {
    cron: {
      ...runtimeStatsState.cron,
    },
    gitCache: {
      commitDiff: {
        ...runtimeStatsState.gitCache.commitDiff,
      },
      historyPage: {
        ...runtimeStatsState.gitCache.historyPage,
      },
    },
    metidosTools: metidosToolBudgets
      ? {
          budgets: metidosToolBudgets,
          byTool: cloneMapRecord(runtimeStatsState.metidosToolByName),
          sandbox: {
            ...runtimeStatsState.metidosSandbox,
          },
          toolCount: runtimeStatsState.metidosToolByName.size,
          totals: {
            ...runtimeStatsState.metidosToolTotals,
          },
          unsafeModeRequests: {
            byTool: cloneMapRecord(runtimeStatsState.metidosUnsafeModeByTool),
            totals: {
              ...runtimeStatsState.metidosUnsafeModeTotals,
            },
          },
          unsafeModeToolCount: runtimeStatsState.metidosUnsafeModeByTool.size,
        }
      : {
          byTool: cloneMapRecord(runtimeStatsState.metidosToolByName),
          sandbox: {
            ...runtimeStatsState.metidosSandbox,
          },
          toolCount: runtimeStatsState.metidosToolByName.size,
          totals: {
            ...runtimeStatsState.metidosToolTotals,
          },
          unsafeModeRequests: {
            byTool: cloneMapRecord(runtimeStatsState.metidosUnsafeModeByTool),
            totals: {
              ...runtimeStatsState.metidosUnsafeModeTotals,
            },
          },
          unsafeModeToolCount: runtimeStatsState.metidosUnsafeModeByTool.size,
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
    webSearch: {
      byProvider: cloneMapRecord(runtimeStatsState.nativeWebSearchByProvider),
      providerCount: runtimeStatsState.nativeWebSearchByProvider.size,
      totals: {
        ...runtimeStatsState.nativeWebSearchTotals,
      },
    },
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
