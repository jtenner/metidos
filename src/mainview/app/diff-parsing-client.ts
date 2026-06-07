/**
 * @file src/mainview/app/diff-parsing-client.ts
 * @description Module for diff parsing client.
 */

import { useEffect, useState } from "react";

import {
  type DiffParseResult,
  EMPTY_DIFF_PARSE_RESULT,
  parseUnifiedDiffText,
  shouldWorkerizeDiffParsing,
} from "./diff-parsing";
import type {
  DiffParsingWorkerRequest,
  DiffParsingWorkerResponse,
} from "./diff-parsing-worker";

export const DIFF_PARSE_CACHE_LIMIT = 12;
const DIFF_PARSE_MAX_PENDING_WORKER_REQUESTS = 3;
const DIFF_PARSE_WORKER_REQUEST_TIMEOUT_MS = 30_000;
const DIFF_PARSE_WORKER_IDLE_TIMEOUT_MS = 60_000;

export function diffTextCacheKey(diffText: string): string {
  let hash = 2166136261;
  for (let index = 0; index < diffText.length; index += 1) {
    hash ^= diffText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${diffText.length}:${hash >>> 0}`;
}

export type DiffParseSnapshot = {
  isLoading: boolean;
  result: DiffParseResult;
};

type DiffParseListener = (snapshot: DiffParseSnapshot) => void;

type DiffParseWorkerLike = {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<DiffParsingWorkerResponse>) => void) | null;
  postMessage: (message: DiffParsingWorkerRequest) => void;
  terminate: () => void;
};

type PendingDiffParseEntry = {
  listeners: Set<DiffParseListener>;
  requestId: number | null;
  snapshot: DiffParseSnapshot;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
};

type HotImportMeta = ImportMeta & {
  hot?: {
    dispose: (callback: () => void) => void;
  };
};

function createBrowserDiffParsingWorker(): DiffParseWorkerLike {
  return new Worker(new URL("./diff-parsing-worker.ts", import.meta.url), {
    name: "diff-parsing",
    type: "module",
  }) as unknown as DiffParseWorkerLike;
}

function isBrowserWorkerAvailable(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function scheduleDiffParseTimeout(
  callback: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  const handle = setTimeout(callback, delayMs);
  (handle as { unref?: () => void }).unref?.();
  return handle;
}

export class DiffParseRequestManager {
  private readonly cache = new Map<string, DiffParseSnapshot>();
  private readonly pendingByDiffKey = new Map<string, PendingDiffParseEntry>();
  private readonly pendingDiffTextByKey = new Map<string, string>();
  private readonly requestToDiffKey = new Map<number, string>();
  private readonly canUseWorker: () => boolean;
  private readonly createWorker: () => DiffParseWorkerLike;
  private readonly maxCacheEntries: number;
  private readonly maxPendingWorkerRequests: number;
  private readonly parseSynchronously: (diffText: string) => DiffParseResult;
  private nextRequestId = 0;
  private worker: DiffParseWorkerLike | null = null;
  private workerFailed = false;
  private workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly workerIdleTimeoutMs: number;
  private readonly workerRequestTimeoutMs: number;
  /**
   * Create a caching diff parser with configurable worker usage.
   * @param canUseWorker - Whether a browser worker can be used.
   * @param createWorker - Factory for creating the diff worker.
   * @param maxCacheEntries - Maximum cached parse results.
   * @param parseSynchronously - Synchronous fallback parser.
   */

  constructor({
    canUseWorker = isBrowserWorkerAvailable,
    createWorker = createBrowserDiffParsingWorker,
    maxCacheEntries = DIFF_PARSE_CACHE_LIMIT,
    maxPendingWorkerRequests = DIFF_PARSE_MAX_PENDING_WORKER_REQUESTS,
    parseSynchronously = parseUnifiedDiffText,
    workerIdleTimeoutMs = DIFF_PARSE_WORKER_IDLE_TIMEOUT_MS,
    workerRequestTimeoutMs = DIFF_PARSE_WORKER_REQUEST_TIMEOUT_MS,
  }: {
    canUseWorker?: () => boolean;
    createWorker?: () => DiffParseWorkerLike;
    maxCacheEntries?: number;
    maxPendingWorkerRequests?: number;
    parseSynchronously?: (diffText: string) => DiffParseResult;
    workerIdleTimeoutMs?: number;
    workerRequestTimeoutMs?: number;
  } = {}) {
    this.canUseWorker = canUseWorker;
    this.createWorker = createWorker;
    this.maxCacheEntries = maxCacheEntries;
    this.maxPendingWorkerRequests = maxPendingWorkerRequests;
    this.parseSynchronously = parseSynchronously;
    this.workerIdleTimeoutMs = workerIdleTimeoutMs;
    this.workerRequestTimeoutMs = workerRequestTimeoutMs;
  }
  /**
   * Read a cached result or queue parsing for the diff text.
   * @param diffText - Diff text to parse.
   */

  dispose(): void {
    for (const [diffKey, pending] of this.pendingByDiffKey) {
      this.clearPendingDiff(diffKey, pending);
    }
    this.cache.clear();
    this.pendingByDiffKey.clear();
    this.pendingDiffTextByKey.clear();
    this.requestToDiffKey.clear();
    this.workerFailed = false;
    this.terminateWorker();
  }
  read(diffText: string): DiffParseSnapshot {
    if (!diffText.trim()) {
      return {
        isLoading: false,
        result: EMPTY_DIFF_PARSE_RESULT,
      };
    }

    const diffKey = diffTextCacheKey(diffText);
    const cached = this.cache.get(diffKey);
    if (cached) {
      return cached;
    }

    const pending = this.pendingByDiffKey.get(diffKey);
    if (pending) {
      return pending.snapshot;
    }

    if (
      !shouldWorkerizeDiffParsing(diffText) ||
      this.pendingByDiffKey.size >= this.maxPendingWorkerRequests
    ) {
      return this.storeReadySnapshot(
        diffKey,
        this.parseSynchronously(diffText),
      );
    }

    const worker = this.getWorker();
    if (!worker) {
      return this.storeReadySnapshot(
        diffKey,
        this.parseSynchronously(diffText),
      );
    }

    const loadingSnapshot: DiffParseSnapshot = {
      isLoading: true,
      result: EMPTY_DIFF_PARSE_RESULT,
    };
    // `read()` can be called during render before `subscribe()` attaches a
    // listener. That temporary listener-less entry is bounded by the pending
    // request cap and request timeout, and every worker response/failure/timeout
    // path clears the pending maps. Starting the request here lets all committed
    // subscribers share one parse instead of spawning duplicate workers.
    const requestId = this.nextRequestId + 1;
    this.nextRequestId = requestId;

    const pendingEntry: PendingDiffParseEntry = {
      listeners: new Set<DiffParseListener>(),
      requestId,
      snapshot: loadingSnapshot,
      timeoutHandle: null,
    };
    this.pendingByDiffKey.set(diffKey, pendingEntry);
    this.pendingDiffTextByKey.set(diffKey, diffText);
    this.requestToDiffKey.set(requestId, diffKey);

    try {
      worker.postMessage({
        diffText,
        id: requestId,
      });
      if (this.workerRequestTimeoutMs > 0) {
        pendingEntry.timeoutHandle = scheduleDiffParseTimeout(() => {
          this.resolveSynchronously(diffKey);
          this.scheduleWorkerIdleTermination();
        }, this.workerRequestTimeoutMs);
      }
    } catch {
      this.resolveSynchronously(diffKey);
    }

    return loadingSnapshot;
  }
  /**
   * Subscribe to updates when a background diff result is ready.
   * @param diffText - Diff text key being tracked.
   * @param listener - Listener to receive updated snapshots.
   */

  subscribe(diffText: string, listener: DiffParseListener): () => void {
    const diffKey = diffTextCacheKey(diffText);
    const pending = this.pendingByDiffKey.get(diffKey);
    if (!pending) {
      return () => {};
    }

    pending.listeners.add(listener);
    return () => {
      pending.listeners.delete(listener);
      if (
        pending.listeners.size === 0 &&
        this.pendingByDiffKey.get(diffKey) === pending
      ) {
        this.clearPendingDiff(diffKey, pending);
        this.scheduleWorkerIdleTermination();
      }
    };
  }

  private clearPendingDiff(
    diffKey: string,
    pending: PendingDiffParseEntry,
  ): void {
    if (pending.timeoutHandle !== null) {
      clearTimeout(pending.timeoutHandle);
      pending.timeoutHandle = null;
    }
    if (pending.requestId !== null) {
      this.requestToDiffKey.delete(pending.requestId);
    }
    this.pendingByDiffKey.delete(diffKey);
    this.pendingDiffTextByKey.delete(diffKey);
  }

  private clearWorkerIdleTimer(): void {
    if (this.workerIdleTimer !== null) {
      clearTimeout(this.workerIdleTimer);
      this.workerIdleTimer = null;
    }
  }

  private terminateWorker(): void {
    this.clearWorkerIdleTimer();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private scheduleWorkerIdleTermination(): void {
    if (
      !this.worker ||
      this.pendingByDiffKey.size > 0 ||
      this.workerIdleTimeoutMs <= 0
    ) {
      return;
    }
    this.clearWorkerIdleTimer();
    this.workerIdleTimer = scheduleDiffParseTimeout(() => {
      if (this.pendingByDiffKey.size === 0) {
        this.terminateWorker();
      }
    }, this.workerIdleTimeoutMs);
  }

  private getWorker(): DiffParseWorkerLike | null {
    if (this.workerFailed || !this.canUseWorker()) {
      return null;
    }
    if (this.worker) {
      return this.worker;
    }

    try {
      this.clearWorkerIdleTimer();
      const worker = this.createWorker();
      worker.onmessage = (event) => {
        this.handleWorkerMessage(event.data);
      };
      worker.onerror = () => {
        this.handleWorkerFailure();
      };
      this.worker = worker;
      return worker;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }
  /**
   * Handle responses from the parsing worker.
   * @param data - Worker response payload.
   */

  private handleWorkerMessage(data: DiffParsingWorkerResponse): void {
    const diffKey = this.requestToDiffKey.get(data.id);
    if (!diffKey) {
      return;
    }

    this.requestToDiffKey.delete(data.id);

    if (!data.ok) {
      this.resolveSynchronously(diffKey);
      this.scheduleWorkerIdleTermination();
      return;
    }

    this.finishPendingDiff(diffKey, data.result);
    this.scheduleWorkerIdleTermination();
  }

  private handleWorkerFailure(): void {
    const pendingDiffKeys = [...this.pendingByDiffKey.keys()];
    this.requestToDiffKey.clear();

    this.terminateWorker();
    this.workerFailed = true;

    for (const diffKey of pendingDiffKeys) {
      this.resolveSynchronously(diffKey);
    }
  }
  /**
   * Resolve a pending request synchronously when worker path is unavailable.
   * @param diffKey - Compact diff text cache key.
   */

  private resolveSynchronously(diffKey: string): void {
    const pending = this.pendingByDiffKey.get(diffKey);
    const diffText = this.pendingDiffTextByKey.get(diffKey);
    if (!diffText) {
      return;
    }
    if (pending && pending.requestId !== null) {
      this.requestToDiffKey.delete(pending.requestId);
    }
    this.finishPendingDiff(diffKey, this.parseSynchronously(diffText));
  }
  /**
   * Finalize a pending diff request and notify listeners.
   * @param diffKey - Compact diff text cache key.
   * @param result - Parsed diff result.
   */

  private finishPendingDiff(diffKey: string, result: DiffParseResult): void {
    const pending = this.pendingByDiffKey.get(diffKey);
    const readySnapshot = this.storeReadySnapshot(diffKey, result);
    if (!pending) {
      return;
    }

    this.clearPendingDiff(diffKey, pending);
    for (const listener of pending.listeners) {
      listener(readySnapshot);
    }
  }
  /**
   * Cache a ready snapshot and trim old entries when over capacity.
   * @param diffKey - Compact diff text cache key.
   * @param result - Parsed diff result.
   */

  private storeReadySnapshot(
    diffKey: string,
    result: DiffParseResult,
  ): DiffParseSnapshot {
    const snapshot: DiffParseSnapshot = {
      isLoading: false,
      result,
    };

    if (this.cache.has(diffKey)) {
      this.cache.delete(diffKey);
    }
    this.cache.set(diffKey, snapshot);

    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.cache.delete(oldestKey);
    }

    return snapshot;
  }
}

function installDiffParseRequestManagerLifecycle(
  manager: DiffParseRequestManager,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const disposeManager = (): void => {
    manager.dispose();
  };
  window.addEventListener("beforeunload", disposeManager);
  window.addEventListener("pagehide", disposeManager);
  return () => {
    window.removeEventListener("beforeunload", disposeManager);
    window.removeEventListener("pagehide", disposeManager);
  };
}

const sharedDiffParseRequestManager = new DiffParseRequestManager();
const removeDiffParseRequestManagerLifecycle =
  installDiffParseRequestManagerLifecycle(sharedDiffParseRequestManager);

(import.meta as HotImportMeta).hot?.dispose(() => {
  removeDiffParseRequestManagerLifecycle();
  sharedDiffParseRequestManager.dispose();
});
/**
 * Hook for consuming diff parse results with async worker support.
 * @param diffText - Diff text to parse.
 */

export function useDiffParseResult(diffText: string): DiffParseSnapshot {
  const [snapshot, setSnapshot] = useState<DiffParseSnapshot>(() =>
    sharedDiffParseRequestManager.read(diffText),
  );

  useEffect(() => {
    setSnapshot(sharedDiffParseRequestManager.read(diffText));
    return sharedDiffParseRequestManager.subscribe(diffText, setSnapshot);
  }, [diffText]);

  return snapshot;
}
