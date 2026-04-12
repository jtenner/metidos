/**
 * @file src/bun/runtime-stats-sidecar.ts
 * @description Optional SQLite sidecar sink for periodic runtime-stat snapshots.
 */

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  type AppDataPathOptions,
  applyAppDatabasePragmas,
  getAppDataDirectoryPath,
  SQL_BUSY_TIMEOUT_MS,
} from "./db";
import type { LogSubsystem } from "./logging";
import {
  buildRuntimeDiagnosticsSnapshot,
  type RuntimeDiagnosticsSnapshot,
} from "./runtime-stats";

export const TRACK_TELEMETRY_FLAG = "--track-telemetry";
export const RUNTIME_STATS_SIDECAR_DB_FILE_NAME = "runtime-stats.db";
export const DEFAULT_RUNTIME_STATS_SIDECAR_SAMPLE_INTERVAL_MS = 15_000;
export const DEFAULT_RUNTIME_STATS_SIDECAR_FLUSH_INTERVAL_MS = 60_000;
export const DEFAULT_RUNTIME_STATS_SIDECAR_BATCH_SIZE = 4;

type RuntimeStatsSidecarLogger = Pick<
  LogSubsystem,
  "error" | "info" | "warning"
>;

export type RuntimeStatsSidecarOptions = AppDataPathOptions & {
  batchSize?: number;
  buildSnapshot?: () => RuntimeDiagnosticsSnapshot;
  flushIntervalMs?: number | null;
  logger?: RuntimeStatsSidecarLogger;
  sampleIntervalMs?: number | null;
};

export type RuntimeStatsSidecar = {
  captureSnapshot: () => Promise<void>;
  close: () => Promise<void>;
  flush: () => Promise<void>;
  getDatabasePath: () => string;
};

function ensureAppDirectory(appDataPath: string): void {
  if (!existsSync(appDataPath)) {
    mkdirSync(appDataPath, {
      mode: 0o700,
      recursive: true,
    });
  }
}

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Ignore chmod failures on filesystems that do not support POSIX permissions.
  }
}

function applyRuntimeStatsSidecarPermissions(databasePath: string): void {
  if (existsSync(databasePath)) {
    applyOwnerOnlyFilePermissions(databasePath);
  }
  const journalingSidecars = [
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
  for (const sidecarPath of journalingSidecars) {
    if (!existsSync(sidecarPath)) {
      continue;
    }
    applyOwnerOnlyFilePermissions(sidecarPath);
  }
}

function tableHasColumn(
  database: Database,
  tableName: string,
  columnName: string,
): boolean {
  return database
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureRuntimeStatsSnapshotColumn(
  database: Database,
  columnName: string,
  columnDefinition: string,
): void {
  if (!tableHasColumn(database, "runtime_stats_snapshots", columnName)) {
    database.run(
      `ALTER TABLE runtime_stats_snapshots ADD COLUMN ${columnDefinition}`,
    );
  }
}

export function getRuntimeStatsSidecarDatabasePath(
  options?: AppDataPathOptions,
): string {
  return resolve(
    getAppDataDirectoryPath(options),
    RUNTIME_STATS_SIDECAR_DB_FILE_NAME,
  );
}

export function deleteRuntimeStatsSidecarDatabaseFiles(
  options?: AppDataPathOptions,
): string[] {
  const databasePath = getRuntimeStatsSidecarDatabasePath(options);
  const candidatePaths = [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
  const deletedPaths: string[] = [];
  for (const path of candidatePaths) {
    if (!existsSync(path)) {
      continue;
    }
    rmSync(path, {
      force: true,
    });
    deletedPaths.push(path);
  }
  return deletedPaths;
}

function migrateRuntimeStatsSidecarDatabase(database: Database): void {
  database.run(`PRAGMA foreign_keys = ON`);
  database.run(`
    CREATE TABLE IF NOT EXISTS runtime_stats_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_started_at TEXT NOT NULL,
      collector_started_at TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      memory_rss INTEGER NOT NULL,
      memory_heap_total INTEGER NOT NULL,
      memory_heap_used INTEGER NOT NULL,
      memory_external INTEGER NOT NULL,
      memory_array_buffers INTEGER NOT NULL,
      rpc_calls INTEGER NOT NULL,
      rpc_succeeded INTEGER NOT NULL,
      rpc_failed INTEGER NOT NULL,
      rpc_timed_out INTEGER NOT NULL,
      rpc_canceled INTEGER NOT NULL,
      rpc_total_duration_ms REAL NOT NULL,
      rpc_peak_duration_ms REAL NOT NULL,
      rpc_request_bytes INTEGER NOT NULL,
      rpc_response_bytes INTEGER NOT NULL,
      rpc_method_count INTEGER NOT NULL,
      websocket_messages INTEGER NOT NULL,
      websocket_delivered_clients INTEGER NOT NULL,
      websocket_dropped_clients INTEGER NOT NULL,
      websocket_payload_bytes INTEGER NOT NULL,
      websocket_type_count INTEGER NOT NULL,
      sqlite_loops_with_retry INTEGER NOT NULL,
      sqlite_total_retries INTEGER NOT NULL,
      sqlite_exhausted_loops INTEGER NOT NULL,
      sqlite_peak_retry_count INTEGER NOT NULL,
      sqlite_total_backoff_ms REAL NOT NULL,
      git_history_cache_range_hit INTEGER NOT NULL,
      git_history_fetches INTEGER NOT NULL,
      git_history_prefetch_waits INTEGER NOT NULL,
      git_history_preemptions INTEGER NOT NULL,
      git_commit_diff_hits INTEGER NOT NULL,
      git_commit_diff_misses INTEGER NOT NULL,
      git_commit_diff_pending_reuse INTEGER NOT NULL,
      git_commit_diff_stores INTEGER NOT NULL,
      cron_active_runs INTEGER NOT NULL DEFAULT 0,
      cron_peak_active_runs INTEGER NOT NULL DEFAULT 0,
      cron_pending_runs INTEGER NOT NULL DEFAULT 0,
      cron_peak_pending_runs INTEGER NOT NULL DEFAULT 0,
      cron_saturation_events INTEGER NOT NULL DEFAULT 0,
      cron_started_runs INTEGER NOT NULL DEFAULT 0,
      cron_completed_runs INTEGER NOT NULL DEFAULT 0,
      cron_stopped_runs INTEGER NOT NULL DEFAULT 0,
      cron_errored_runs INTEGER NOT NULL DEFAULT 0,
      cron_timed_out_runs INTEGER NOT NULL DEFAULT 0,
      cron_last_duration_ms REAL NOT NULL DEFAULT 0,
      cron_peak_duration_ms REAL NOT NULL DEFAULT 0,
      cron_total_duration_ms REAL NOT NULL DEFAULT 0
    )
  `);
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_active_runs",
    "cron_active_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_peak_active_runs",
    "cron_peak_active_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_pending_runs",
    "cron_pending_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_peak_pending_runs",
    "cron_peak_pending_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_saturation_events",
    "cron_saturation_events INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_started_runs",
    "cron_started_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_completed_runs",
    "cron_completed_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_stopped_runs",
    "cron_stopped_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_errored_runs",
    "cron_errored_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_timed_out_runs",
    "cron_timed_out_runs INTEGER NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_last_duration_ms",
    "cron_last_duration_ms REAL NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_peak_duration_ms",
    "cron_peak_duration_ms REAL NOT NULL DEFAULT 0",
  );
  ensureRuntimeStatsSnapshotColumn(
    database,
    "cron_total_duration_ms",
    "cron_total_duration_ms REAL NOT NULL DEFAULT 0",
  );
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_runtime_stats_snapshots_collected_at
    ON runtime_stats_snapshots(collected_at DESC, id DESC)
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_runtime_stats_snapshots_process_started_at
    ON runtime_stats_snapshots(process_started_at, collector_started_at, collected_at DESC, id DESC)
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS runtime_stats_rpc_method_snapshots (
      snapshot_id INTEGER NOT NULL REFERENCES runtime_stats_snapshots(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      calls INTEGER NOT NULL,
      canceled INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      last_duration_ms REAL NOT NULL,
      peak_duration_ms REAL NOT NULL,
      request_bytes INTEGER NOT NULL,
      response_bytes INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      timed_out INTEGER NOT NULL,
      total_duration_ms REAL NOT NULL,
      PRIMARY KEY (snapshot_id, method)
    )
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_runtime_stats_rpc_method_snapshots_method
    ON runtime_stats_rpc_method_snapshots(method, snapshot_id)
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS runtime_stats_websocket_push_snapshots (
      snapshot_id INTEGER NOT NULL REFERENCES runtime_stats_snapshots(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      delivered_clients INTEGER NOT NULL,
      dropped_clients INTEGER NOT NULL,
      messages INTEGER NOT NULL,
      payload_bytes INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, type)
    )
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_runtime_stats_websocket_push_snapshots_type
    ON runtime_stats_websocket_push_snapshots(type, snapshot_id)
  `);
}

function writeRuntimeStatsSnapshotBatch(
  database: Database,
  processStartedAt: string,
  batch: RuntimeDiagnosticsSnapshot[],
): void {
  const insertSnapshot = database.query(`
    INSERT INTO runtime_stats_snapshots (
      process_started_at,
      collector_started_at,
      collected_at,
      memory_rss,
      memory_heap_total,
      memory_heap_used,
      memory_external,
      memory_array_buffers,
      rpc_calls,
      rpc_succeeded,
      rpc_failed,
      rpc_timed_out,
      rpc_canceled,
      rpc_total_duration_ms,
      rpc_peak_duration_ms,
      rpc_request_bytes,
      rpc_response_bytes,
      rpc_method_count,
      websocket_messages,
      websocket_delivered_clients,
      websocket_dropped_clients,
      websocket_payload_bytes,
      websocket_type_count,
      sqlite_loops_with_retry,
      sqlite_total_retries,
      sqlite_exhausted_loops,
      sqlite_peak_retry_count,
      sqlite_total_backoff_ms,
      git_history_cache_range_hit,
      git_history_fetches,
      git_history_prefetch_waits,
      git_history_preemptions,
      git_commit_diff_hits,
      git_commit_diff_misses,
      git_commit_diff_pending_reuse,
      git_commit_diff_stores,
      cron_active_runs,
      cron_peak_active_runs,
      cron_pending_runs,
      cron_peak_pending_runs,
      cron_saturation_events,
      cron_started_runs,
      cron_completed_runs,
      cron_stopped_runs,
      cron_errored_runs,
      cron_timed_out_runs,
      cron_last_duration_ms,
      cron_peak_duration_ms,
      cron_total_duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRpcMethod = database.query(`
    INSERT INTO runtime_stats_rpc_method_snapshots (
      snapshot_id,
      method,
      calls,
      canceled,
      failed,
      last_duration_ms,
      peak_duration_ms,
      request_bytes,
      response_bytes,
      succeeded,
      timed_out,
      total_duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWebSocketPush = database.query(`
    INSERT INTO runtime_stats_websocket_push_snapshots (
      snapshot_id,
      type,
      delivered_clients,
      dropped_clients,
      messages,
      payload_bytes
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = database.transaction(
    (runtimeSnapshots: RuntimeDiagnosticsSnapshot[]) => {
      for (const snapshot of runtimeSnapshots) {
        const insertResult = insertSnapshot.run(
          processStartedAt,
          snapshot.runtimeStats.startedAt,
          snapshot.collectedAt,
          snapshot.memoryUsage.rss,
          snapshot.memoryUsage.heapTotal,
          snapshot.memoryUsage.heapUsed,
          snapshot.memoryUsage.external,
          snapshot.memoryUsage.arrayBuffers,
          snapshot.runtimeStatsSummary.rpc.calls,
          snapshot.runtimeStatsSummary.rpc.succeeded,
          snapshot.runtimeStatsSummary.rpc.failed,
          snapshot.runtimeStatsSummary.rpc.timedOut,
          snapshot.runtimeStatsSummary.rpc.canceled,
          snapshot.runtimeStatsSummary.rpc.totalDurationMs,
          snapshot.runtimeStatsSummary.rpc.peakDurationMs,
          snapshot.runtimeStatsSummary.rpc.requestBytes,
          snapshot.runtimeStatsSummary.rpc.responseBytes,
          snapshot.runtimeStatsSummary.rpc.methodCount,
          snapshot.runtimeStatsSummary.websocketPush.messages,
          snapshot.runtimeStatsSummary.websocketPush.deliveredClients,
          snapshot.runtimeStatsSummary.websocketPush.droppedClients,
          snapshot.runtimeStatsSummary.websocketPush.payloadBytes,
          snapshot.runtimeStatsSummary.websocketPush.typeCount,
          snapshot.runtimeStatsSummary.sqliteRetry.loopsWithRetry,
          snapshot.runtimeStatsSummary.sqliteRetry.totalRetries,
          snapshot.runtimeStatsSummary.sqliteRetry.exhaustedLoops,
          snapshot.runtimeStatsSummary.sqliteRetry.peakRetryCount,
          snapshot.runtimeStatsSummary.sqliteRetry.totalBackoffMs,
          snapshot.runtimeStatsSummary.gitCache.historyPage.cacheRangeHit,
          snapshot.runtimeStatsSummary.gitCache.historyPage.fetches,
          snapshot.runtimeStatsSummary.gitCache.historyPage.prefetchWaits,
          snapshot.runtimeStatsSummary.gitCache.historyPage.preemptions,
          snapshot.runtimeStatsSummary.gitCache.commitDiff.hits,
          snapshot.runtimeStatsSummary.gitCache.commitDiff.misses,
          snapshot.runtimeStatsSummary.gitCache.commitDiff.pendingReuse,
          snapshot.runtimeStatsSummary.gitCache.commitDiff.stores,
          snapshot.runtimeStatsSummary.cron.activeRuns,
          snapshot.runtimeStatsSummary.cron.peakActiveRuns,
          snapshot.runtimeStatsSummary.cron.pendingRuns,
          snapshot.runtimeStatsSummary.cron.peakPendingRuns,
          snapshot.runtimeStatsSummary.cron.saturationEvents,
          snapshot.runtimeStatsSummary.cron.startedRuns,
          snapshot.runtimeStatsSummary.cron.completedRuns,
          snapshot.runtimeStatsSummary.cron.stoppedRuns,
          snapshot.runtimeStatsSummary.cron.erroredRuns,
          snapshot.runtimeStatsSummary.cron.timedOutRuns,
          snapshot.runtimeStatsSummary.cron.lastDurationMs,
          snapshot.runtimeStatsSummary.cron.peakDurationMs,
          snapshot.runtimeStatsSummary.cron.totalDurationMs,
        );
        const snapshotId = Number(insertResult.lastInsertRowid);

        for (const [method, methodStats] of Object.entries(
          snapshot.runtimeStats.rpc.byMethod,
        )) {
          insertRpcMethod.run(
            snapshotId,
            method,
            methodStats.calls,
            methodStats.canceled,
            methodStats.failed,
            methodStats.lastDurationMs,
            methodStats.peakDurationMs,
            methodStats.requestBytes,
            methodStats.responseBytes,
            methodStats.succeeded,
            methodStats.timedOut,
            methodStats.totalDurationMs,
          );
        }

        for (const [type, pushStats] of Object.entries(
          snapshot.runtimeStats.websocketPush.byType,
        )) {
          insertWebSocketPush.run(
            snapshotId,
            type,
            pushStats.deliveredClients,
            pushStats.droppedClients,
            pushStats.messages,
            pushStats.payloadBytes,
          );
        }
      }
    },
  );

  transaction(batch);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

export function startRuntimeStatsSidecar(
  options: RuntimeStatsSidecarOptions = {},
): RuntimeStatsSidecar {
  const databasePath = getRuntimeStatsSidecarDatabasePath(options);
  ensureAppDirectory(getAppDataDirectoryPath(options));

  const database = new Database(databasePath);
  applyAppDatabasePragmas(database, {
    busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
  });
  migrateRuntimeStatsSidecarDatabase(database);
  applyRuntimeStatsSidecarPermissions(databasePath);

  const batchSize = Math.max(
    1,
    options.batchSize ?? DEFAULT_RUNTIME_STATS_SIDECAR_BATCH_SIZE,
  );
  const buildSnapshot =
    options.buildSnapshot ?? (() => buildRuntimeDiagnosticsSnapshot());
  const flushIntervalMs =
    options.flushIntervalMs === undefined
      ? DEFAULT_RUNTIME_STATS_SIDECAR_FLUSH_INTERVAL_MS
      : options.flushIntervalMs;
  const logger = options.logger;
  const processStartedAt = new Date().toISOString();
  const sampleIntervalMs =
    options.sampleIntervalMs === undefined
      ? DEFAULT_RUNTIME_STATS_SIDECAR_SAMPLE_INTERVAL_MS
      : options.sampleIntervalMs;

  const bufferedSnapshots: RuntimeDiagnosticsSnapshot[] = [];
  let closed = false;
  let flushInFlight: Promise<void> | null = null;
  let flushQueued = false;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let sampleTimer: ReturnType<typeof setInterval> | null = null;

  const flush = async (): Promise<void> => {
    if (closed) {
      return;
    }
    if (flushInFlight) {
      flushQueued = true;
      return flushInFlight;
    }

    flushInFlight = (async () => {
      do {
        flushQueued = false;
        const batch = bufferedSnapshots.splice(0, bufferedSnapshots.length);
        if (batch.length === 0) {
          continue;
        }
        try {
          writeRuntimeStatsSnapshotBatch(database, processStartedAt, batch);
          applyRuntimeStatsSidecarPermissions(databasePath);
        } catch (error) {
          bufferedSnapshots.unshift(...batch);
          throw error;
        }
      } while (flushQueued && bufferedSnapshots.length > 0);
    })().finally(() => {
      flushInFlight = null;
    });

    return flushInFlight;
  };

  const captureSnapshot = async (): Promise<void> => {
    if (closed) {
      return;
    }
    bufferedSnapshots.push(buildSnapshot());
    if (bufferedSnapshots.length >= batchSize) {
      await flush();
    }
  };

  if (typeof sampleIntervalMs === "number" && sampleIntervalMs > 0) {
    sampleTimer = setInterval(() => {
      void captureSnapshot().catch((error) => {
        logger?.error({
          message: "Failed to capture runtime telemetry snapshot",
          error: toErrorMessage(error),
        });
      });
    }, sampleIntervalMs);
  }

  if (typeof flushIntervalMs === "number" && flushIntervalMs > 0) {
    flushTimer = setInterval(() => {
      void flush().catch((error) => {
        logger?.error({
          message: "Failed to flush runtime telemetry sidecar batch",
          error: toErrorMessage(error),
        });
      });
    }, flushIntervalMs);
  }

  bufferedSnapshots.push(buildSnapshot());
  logger?.info({
    message: "Runtime telemetry sidecar enabled",
    databasePath,
    batchSize,
    flushIntervalMs,
    sampleIntervalMs,
  });

  return {
    async captureSnapshot() {
      await captureSnapshot();
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      if (sampleTimer) {
        clearInterval(sampleTimer);
        sampleTimer = null;
      }
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }

      bufferedSnapshots.push(buildSnapshot());
      if (flushInFlight) {
        flushQueued = true;
      }
      if (bufferedSnapshots.length > 0) {
        closed = false;
        try {
          await flush();
        } finally {
          closed = true;
        }
      }
      database.close(false);
    },
    async flush() {
      await flush();
    },
    getDatabasePath() {
      return databasePath;
    },
  };
}
