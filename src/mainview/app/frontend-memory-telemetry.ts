/**
 * @file src/mainview/app/frontend-memory-telemetry.ts
 * @description Lightweight frontend memory telemetry snapshots for long-running sessions.
 */

import { useEffect, useRef } from "react";
import { logClientEvent } from "../client-logging";

export const FRONTEND_MEMORY_TELEMETRY_INTERVAL_MS = 5 * 60 * 1000;

export type FrontendGitCacheTelemetry = {
  diffCacheBytes: number;
  diffCacheEntries: number;
  historyCacheBytes: number;
  historyCacheEntries: number;
  pendingDiffRequests: number;
  skipFreshHistoryRefreshEntries: number;
};

export type FrontendMemoryTelemetrySnapshot = {
  calendarNotifications: number;
  expandedTranscriptItems: number;
  gitCache: FrontendGitCacheTelemetry;
  gitHistoryEntries: number;
  loadedTranscriptMediaBytes: number;
  loadedTranscriptMediaEntries: number;
  openTerminals: number;
  pendingThreadStartRequests: number;
  projectCount: number;
  threadCount: number;
  threadMessageCount: number;
  userNotifications: number;
};

type PerformanceMemory = {
  jsHeapSizeLimit?: number | undefined;
  totalJSHeapSize?: number | undefined;
  usedJSHeapSize?: number | undefined;
};

type PerformanceWithMemory = Performance & {
  memory?: PerformanceMemory;
};

const emptyGitCacheTelemetry: FrontendGitCacheTelemetry = {
  diffCacheBytes: 0,
  diffCacheEntries: 0,
  historyCacheBytes: 0,
  historyCacheEntries: 0,
  pendingDiffRequests: 0,
  skipFreshHistoryRefreshEntries: 0,
};

let latestGitCacheTelemetry: FrontendGitCacheTelemetry = {
  ...emptyGitCacheTelemetry,
};

export function updateFrontendGitCacheTelemetry(
  telemetry: FrontendGitCacheTelemetry,
): void {
  latestGitCacheTelemetry = telemetry;
}

export function readFrontendGitCacheTelemetry(): FrontendGitCacheTelemetry {
  return latestGitCacheTelemetry;
}

function readPerformanceMemory(): PerformanceMemory | null {
  if (typeof performance === "undefined") {
    return null;
  }
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory) {
    return null;
  }
  return {
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    totalJSHeapSize: memory.totalJSHeapSize,
    usedJSHeapSize: memory.usedJSHeapSize,
  };
}

export function useFrontendMemoryTelemetry(
  snapshot: FrontendMemoryTelemetrySnapshot,
  options?: { intervalMs?: number },
): void {
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const publishSnapshot = (): void => {
      logClientEvent({
        severity: "info",
        message: "Frontend memory telemetry",
        context: "frontend-memory-telemetry",
        route: typeof window !== "undefined" ? window.location.pathname : null,
        timestamp: new Date().toISOString(),
        details: {
          counters: {
            ...snapshotRef.current,
            gitCache: readFrontendGitCacheTelemetry(),
          },
          heap: readPerformanceMemory(),
          visibility:
            typeof document !== "undefined" ? document.visibilityState : null,
        },
      });
    };

    const timer = window.setInterval(
      publishSnapshot,
      options?.intervalMs ?? FRONTEND_MEMORY_TELEMETRY_INTERVAL_MS,
    );
    publishSnapshot();
    return () => {
      window.clearInterval(timer);
    };
  }, [options?.intervalMs]);
}
