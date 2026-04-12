/**
 * @file src/bun/runtime-stats-sidecar.test.ts
 * @description Tests for the optional runtime-stats SQLite sidecar sink.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RuntimeDiagnosticsSnapshot } from "./runtime-stats";
import {
  deleteRuntimeStatsSidecarDatabaseFiles,
  getRuntimeStatsSidecarDatabasePath,
  startRuntimeStatsSidecar,
} from "./runtime-stats-sidecar";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-runtime-stats-sidecar-"));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

function createRuntimeDiagnosticsSnapshot(
  ordinal: number,
): RuntimeDiagnosticsSnapshot {
  const calls = ordinal + 1;
  return {
    collectedAt: `2026-04-11T12:00:0${ordinal}.000Z`,
    memoryUsage: {
      arrayBuffers: 1_000 + ordinal,
      external: 2_000 + ordinal,
      heapTotal: 3_000 + ordinal,
      heapUsed: 2_500 + ordinal,
      rss: 9_000 + ordinal,
    },
    runtimeStats: {
      cron: {
        activeRuns: ordinal,
        completedRuns: ordinal + 1,
        erroredRuns: ordinal + 2,
        lastDurationMs: ordinal + 3,
        peakActiveRuns: ordinal + 4,
        peakDurationMs: ordinal + 5,
        peakPendingRuns: ordinal + 6,
        pendingRuns: ordinal + 7,
        saturationEvents: ordinal + 8,
        startedRuns: ordinal + 9,
        stoppedRuns: ordinal + 10,
        timedOutRuns: ordinal + 11,
        totalDurationMs: ordinal + 12,
      },
      gitCache: {
        commitDiff: {
          hits: ordinal,
          misses: ordinal + 1,
          pendingReuse: ordinal + 2,
          stores: ordinal + 3,
        },
        historyPage: {
          cacheRangeHit: ordinal + 4,
          fetches: ordinal + 5,
          preemptions: ordinal + 6,
          prefetchWaits: ordinal + 7,
        },
      },
      metidosTools: {
        byTool: {
          new_thread: {
            calls,
            failed: ordinal,
            lastDurationMs: 8 + ordinal,
            peakDurationMs: 9 + ordinal,
            succeeded: calls - ordinal,
            totalDurationMs: 10 + ordinal,
          },
        },
        sandbox: {
          calls: ordinal + 1,
          failed: ordinal,
          succeeded: 1,
          timedOut: 0,
        },
        totals: {
          calls,
          failed: ordinal,
          lastDurationMs: 8 + ordinal,
          peakDurationMs: 9 + ordinal,
          succeeded: calls - ordinal,
          totalDurationMs: 10 + ordinal,
        },
        unsafeModeRequests: {
          byTool: {
            new_thread: {
              allowed: ordinal,
              blocked: 0,
              requested: ordinal,
            },
          },
          totals: {
            allowed: ordinal,
            blocked: 0,
            requested: ordinal,
          },
        },
      },
      rpc: {
        byMethod: {
          getThread: {
            calls,
            canceled: 0,
            failed: ordinal,
            lastDurationMs: 10 + ordinal,
            peakDurationMs: 20 + ordinal,
            requestBytes: 100 + ordinal,
            responseBytes: 200 + ordinal,
            succeeded: calls - ordinal,
            timedOut: 0,
            totalDurationMs: 30 + ordinal,
          },
        },
        totals: {
          calls,
          canceled: 0,
          failed: ordinal,
          peakDurationMs: 20 + ordinal,
          requestBytes: 100 + ordinal,
          responseBytes: 200 + ordinal,
          succeeded: calls - ordinal,
          timedOut: 0,
          totalDurationMs: 30 + ordinal,
        },
      },
      sqliteRetry: {
        exhaustedLoops: ordinal,
        loopsWithRetry: ordinal + 1,
        peakRetryCount: ordinal + 2,
        totalBackoffMs: ordinal + 3,
        totalRetries: ordinal + 4,
      },
      startedAt: `2026-04-11T11:59:0${ordinal}.000Z`,
      websocketPush: {
        byType: {
          reload: {
            deliveredClients: ordinal + 1,
            droppedClients: ordinal,
            messages: ordinal + 2,
            payloadBytes: 40 + ordinal,
          },
        },
        totals: {
          deliveredClients: ordinal + 1,
          droppedClients: ordinal,
          messages: ordinal + 2,
          payloadBytes: 40 + ordinal,
        },
      },
    },
    runtimeStatsSummary: {
      cron: {
        activeRuns: ordinal,
        completedRuns: ordinal + 1,
        erroredRuns: ordinal + 2,
        lastDurationMs: ordinal + 3,
        peakActiveRuns: ordinal + 4,
        peakDurationMs: ordinal + 5,
        peakPendingRuns: ordinal + 6,
        pendingRuns: ordinal + 7,
        saturationEvents: ordinal + 8,
        startedRuns: ordinal + 9,
        stoppedRuns: ordinal + 10,
        timedOutRuns: ordinal + 11,
        totalDurationMs: ordinal + 12,
      },
      gitCache: {
        commitDiff: {
          hits: ordinal,
          misses: ordinal + 1,
          pendingReuse: ordinal + 2,
          stores: ordinal + 3,
        },
        historyPage: {
          cacheRangeHit: ordinal + 4,
          fetches: ordinal + 5,
          preemptions: ordinal + 6,
          prefetchWaits: ordinal + 7,
        },
      },
      metidosTools: {
        byTool: {
          new_thread: {
            calls,
            failed: ordinal,
            lastDurationMs: 8 + ordinal,
            peakDurationMs: 9 + ordinal,
            succeeded: calls - ordinal,
            totalDurationMs: 10 + ordinal,
          },
        },
        sandbox: {
          calls: ordinal + 1,
          failed: ordinal,
          succeeded: 1,
          timedOut: 0,
        },
        toolCount: 1,
        totals: {
          calls,
          failed: ordinal,
          lastDurationMs: 8 + ordinal,
          peakDurationMs: 9 + ordinal,
          succeeded: calls - ordinal,
          totalDurationMs: 10 + ordinal,
        },
        unsafeModeRequests: {
          byTool: {
            new_thread: {
              allowed: ordinal,
              blocked: 0,
              requested: ordinal,
            },
          },
          totals: {
            allowed: ordinal,
            blocked: 0,
            requested: ordinal,
          },
        },
        unsafeModeToolCount: 1,
      },
      rpc: {
        calls,
        canceled: 0,
        failed: ordinal,
        methodCount: 1,
        peakDurationMs: 20 + ordinal,
        requestBytes: 100 + ordinal,
        responseBytes: 200 + ordinal,
        succeeded: calls - ordinal,
        timedOut: 0,
        topResponseBytesMethods: [
          {
            calls,
            method: "getThread",
            requestBytes: 100 + ordinal,
            responseBytes: 200 + ordinal,
          },
        ],
        totalDurationMs: 30 + ordinal,
      },
      sqliteRetry: {
        exhaustedLoops: ordinal,
        loopsWithRetry: ordinal + 1,
        peakRetryCount: ordinal + 2,
        totalBackoffMs: ordinal + 3,
        totalRetries: ordinal + 4,
      },
      startedAt: `2026-04-11T11:59:0${ordinal}.000Z`,
      websocketPush: {
        deliveredClients: ordinal + 1,
        droppedClients: ordinal,
        messages: ordinal + 2,
        payloadBytes: 40 + ordinal,
        topPayloadBytesTypes: [
          {
            deliveredClients: ordinal + 1,
            droppedClients: ordinal,
            messages: ordinal + 2,
            payloadBytes: 40 + ordinal,
            type: "reload",
          },
        ],
        typeCount: 1,
      },
    },
  };
}

function readSnapshotCount(databasePath: string): number {
  const database = new Database(databasePath);
  try {
    const row = database
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count FROM runtime_stats_snapshots`,
      )
      .get();
    return row?.count ?? 0;
  } finally {
    database.close(false);
  }
}

describe("runtime stats sidecar", () => {
  it("buffers snapshots and flushes them to sqlite in one batch", async () => {
    const appDataDir = createTempDirectory();
    let nextOrdinal = 0;
    const databasePath = getRuntimeStatsSidecarDatabasePath({
      appDataDir,
    });
    const sidecar = startRuntimeStatsSidecar({
      appDataDir,
      batchSize: 3,
      buildSnapshot: () => createRuntimeDiagnosticsSnapshot(nextOrdinal++),
      flushIntervalMs: null,
      sampleIntervalMs: null,
    });

    expect(existsSync(databasePath)).toBeTrue();
    expect(readSnapshotCount(databasePath)).toBe(0);

    await sidecar.captureSnapshot();
    expect(readSnapshotCount(databasePath)).toBe(0);

    await sidecar.captureSnapshot();
    expect(readSnapshotCount(databasePath)).toBe(3);

    const database = new Database(databasePath);
    try {
      const latestSnapshot = database
        .query<
          {
            collectedAt: string;
            cronPeakActiveRuns: number;
            rpcCalls: number;
            responseBytes: number;
            websocketMessages: number;
          },
          []
        >(
          `
            SELECT
              collected_at AS collectedAt,
              cron_peak_active_runs AS cronPeakActiveRuns,
              rpc_calls AS rpcCalls,
              rpc_response_bytes AS responseBytes,
              websocket_messages AS websocketMessages
            FROM runtime_stats_snapshots
            ORDER BY id DESC
            LIMIT 1
          `,
        )
        .get();
      expect(latestSnapshot).toEqual({
        collectedAt: "2026-04-11T12:00:02.000Z",
        cronPeakActiveRuns: 6,
        rpcCalls: 3,
        responseBytes: 202,
        websocketMessages: 4,
      });

      const rpcMethodRows = database
        .query<{ method: string; calls: number; responseBytes: number }, []>(
          `
            SELECT
              method,
              calls,
              response_bytes AS responseBytes
            FROM runtime_stats_rpc_method_snapshots
            ORDER BY snapshot_id ASC, method ASC
          `,
        )
        .all();
      expect(rpcMethodRows).toHaveLength(3);
      expect(rpcMethodRows[2]).toEqual({
        method: "getThread",
        calls: 3,
        responseBytes: 202,
      });
    } finally {
      database.close(false);
    }

    await sidecar.close();
  });

  it("flushes the final buffered snapshots on close and deletes the sidecar files", async () => {
    const appDataDir = createTempDirectory();
    let nextOrdinal = 0;
    const databasePath = getRuntimeStatsSidecarDatabasePath({
      appDataDir,
    });
    const sidecar = startRuntimeStatsSidecar({
      appDataDir,
      batchSize: 10,
      buildSnapshot: () => createRuntimeDiagnosticsSnapshot(nextOrdinal++),
      flushIntervalMs: null,
      sampleIntervalMs: null,
    });

    await sidecar.captureSnapshot();
    expect(readSnapshotCount(databasePath)).toBe(0);

    await sidecar.close();
    expect(readSnapshotCount(databasePath)).toBe(3);

    const deletedPaths = deleteRuntimeStatsSidecarDatabaseFiles({
      appDataDir,
    });
    expect(deletedPaths).toContain(databasePath);
    expect(existsSync(databasePath)).toBeFalse();
  });
});
