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

const DIFF_PARSE_CACHE_LIMIT = 24;

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

export class DiffParseRequestManager {
  private readonly cache = new Map<string, DiffParseSnapshot>();
  private readonly pendingByDiffText = new Map<string, PendingDiffParseEntry>();
  private readonly requestToDiffText = new Map<number, string>();
  private readonly canUseWorker: () => boolean;
  private readonly createWorker: () => DiffParseWorkerLike;
  private readonly maxCacheEntries: number;
  private readonly parseSynchronously: (diffText: string) => DiffParseResult;
  private nextRequestId = 0;
  private worker: DiffParseWorkerLike | null = null;
  private workerFailed = false;
  /**
   * Function of constructor.
   * @param canUseWorker - The value of `canUseWorker`.
   * @param createWorker - The value of `createWorker`.
   * @param maxCacheEntries - The value of `maxCacheEntries`.
   * @param parseSynchronously - The value of `parseSynchronously`.
   */

  constructor({
    canUseWorker = isBrowserWorkerAvailable,
    createWorker = createBrowserDiffParsingWorker,
    maxCacheEntries = DIFF_PARSE_CACHE_LIMIT,
    parseSynchronously = parseUnifiedDiffText,
  }: {
    canUseWorker?: () => boolean;
    createWorker?: () => DiffParseWorkerLike;
    maxCacheEntries?: number;
    parseSynchronously?: (diffText: string) => DiffParseResult;
  } = {}) {
    this.canUseWorker = canUseWorker;
    this.createWorker = createWorker;
    this.maxCacheEntries = maxCacheEntries;
    this.parseSynchronously = parseSynchronously;
  }
  /**
   * Function of read.
   * @param diffText - The value of `diffText`.
   */

  read(diffText: string): DiffParseSnapshot {
    if (!diffText.trim()) {
      return {
        isLoading: false,
        result: EMPTY_DIFF_PARSE_RESULT,
      };
    }

    const cached = this.cache.get(diffText);
    if (cached) {
      return cached;
    }

    const pending = this.pendingByDiffText.get(diffText);
    if (pending) {
      return pending.snapshot;
    }

    if (!shouldWorkerizeDiffParsing(diffText)) {
      return this.storeReadySnapshot(
        diffText,
        this.parseSynchronously(diffText),
      );
    }

    const worker = this.getWorker();
    if (!worker) {
      return this.storeReadySnapshot(
        diffText,
        this.parseSynchronously(diffText),
      );
    }

    const loadingSnapshot: DiffParseSnapshot = {
      isLoading: true,
      result: EMPTY_DIFF_PARSE_RESULT,
    };
    const requestId = this.nextRequestId + 1;
    this.nextRequestId = requestId;

    this.pendingByDiffText.set(diffText, {
      listeners: new Set<DiffParseListener>(),
      requestId,
      snapshot: loadingSnapshot,
    });
    this.requestToDiffText.set(requestId, diffText);

    try {
      worker.postMessage({
        diffText,
        id: requestId,
      });
    } catch {
      this.resolveSynchronously(diffText);
    }

    return loadingSnapshot;
  }
  /**
   * Function of subscribe.
   * @param diffText - The value of `diffText`.
   * @param listener - The value of `listener`.
   */

  subscribe(diffText: string, listener: DiffParseListener): () => void {
    const pending = this.pendingByDiffText.get(diffText);
    if (!pending) {
      return () => {};
    }

    pending.listeners.add(listener);
    return () => {
      pending.listeners.delete(listener);
    };
  }

  private getWorker(): DiffParseWorkerLike | null {
    if (this.workerFailed || !this.canUseWorker()) {
      return null;
    }
    if (this.worker) {
      return this.worker;
    }

    try {
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
   * Function of handleWorkerMessage.
   * @param data - The value of `data`.
   */

  private handleWorkerMessage(data: DiffParsingWorkerResponse): void {
    const diffText = this.requestToDiffText.get(data.id);
    if (!diffText) {
      return;
    }

    this.requestToDiffText.delete(data.id);

    if (!data.ok) {
      this.resolveSynchronously(diffText);
      return;
    }

    this.finishPendingDiff(diffText, data.result);
  }

  private handleWorkerFailure(): void {
    const pendingDiffTexts = [...this.pendingByDiffText.keys()];
    this.requestToDiffText.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerFailed = true;

    for (const diffText of pendingDiffTexts) {
      this.resolveSynchronously(diffText);
    }
  }
  /**
   * Function of resolveSynchronously.
   * @param diffText - The value of `diffText`.
   */

  private resolveSynchronously(diffText: string): void {
    const pending = this.pendingByDiffText.get(diffText);
    if (pending && pending.requestId !== null) {
      this.requestToDiffText.delete(pending.requestId);
    }
    this.finishPendingDiff(diffText, this.parseSynchronously(diffText));
  }
  /**
   * Function of finishPendingDiff.
   * @param diffText - The value of `diffText`.
   * @param result - The value of `result`.
   */

  private finishPendingDiff(diffText: string, result: DiffParseResult): void {
    const pending = this.pendingByDiffText.get(diffText);
    const readySnapshot = this.storeReadySnapshot(diffText, result);
    if (!pending) {
      return;
    }

    this.pendingByDiffText.delete(diffText);
    for (const listener of pending.listeners) {
      listener(readySnapshot);
    }
  }
  /**
   * Function of storeReadySnapshot.
   * @param diffText - The value of `diffText`.
   * @param result - The value of `result`.
   */

  private storeReadySnapshot(
    diffText: string,
    result: DiffParseResult,
  ): DiffParseSnapshot {
    const snapshot: DiffParseSnapshot = {
      isLoading: false,
      result,
    };

    if (this.cache.has(diffText)) {
      this.cache.delete(diffText);
    }
    this.cache.set(diffText, snapshot);

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

const sharedDiffParseRequestManager = new DiffParseRequestManager();
/**
 * Function of useDiffParseResult.
 * @param diffText - The value of `diffText`.
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
