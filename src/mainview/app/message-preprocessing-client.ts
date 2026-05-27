/**
 * @file src/mainview/app/message-preprocessing-client.ts
 * @description Module for message preprocessing client.
 */

import { useEffect, useState } from "react";

import {
  type PreparedMessageRenderPlan,
  prepareMessageRenderPlan,
  shouldWorkerizeMessagePreprocessing,
} from "./message-preprocessing";
import type {
  MessagePreprocessingWorkerRequest,
  MessagePreprocessingWorkerResponse,
} from "./message-preprocessing-worker";

export const MESSAGE_PREPROCESS_CACHE_LIMIT = 16;
export const MESSAGE_PREPROCESS_CACHE_MAX_BYTES = 1024 * 1024;
export const MESSAGE_PREPROCESS_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
const MESSAGE_PREPROCESS_MAX_PENDING_WORKER_REQUESTS = 4;
const MESSAGE_PREPROCESS_WORKER_REQUEST_TIMEOUT_MS = 30_000;
const MESSAGE_PREPROCESS_WORKER_IDLE_TIMEOUT_MS = 60_000;

export type MessagePreprocessingSnapshot = {
  isLoading: boolean;
  plan: PreparedMessageRenderPlan;
};

type MessagePreprocessingListener = (
  snapshot: MessagePreprocessingSnapshot,
) => void;

type MessagePreprocessingWorkerLike = {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage:
    | ((event: MessageEvent<MessagePreprocessingWorkerResponse>) => void)
    | null;
  postMessage: (message: MessagePreprocessingWorkerRequest) => void;
  terminate: () => void;
};

type PendingMessagePreprocessingEntry = {
  cacheKey: string;
  listeners: Set<MessagePreprocessingListener>;
  requestId: number | null;
  snapshot: MessagePreprocessingSnapshot;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
};

type HotImportMeta = ImportMeta & {
  hot?: {
    dispose: (callback: () => void) => void;
  };
};

const EMPTY_MESSAGE_RENDER_PLAN: PreparedMessageRenderPlan = {
  kind: "plain",
  segments: [],
};

function stringByteLength(value: string | null | undefined): number {
  return (value?.length ?? 0) * 2;
}

export function estimatePreparedMessageRenderPlanBytes(
  plan: PreparedMessageRenderPlan,
): number {
  if (plan.kind === "plain") {
    return plan.segments.reduce(
      (totalBytes, segment) =>
        totalBytes +
        stringByteLength(segment.text) +
        (segment.kind === "link" ? stringByteLength(segment.href) : 0),
      0,
    );
  }

  return plan.blocks.reduce((totalBytes, block) => {
    if (block.kind === "code") {
      return (
        totalBytes +
        stringByteLength(block.code) +
        stringByteLength(block.language)
      );
    }
    return totalBytes + stringByteLength(block.text);
  }, 0);
}

function scheduleMessagePreprocessingTimeout(
  callback: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  const handle = setTimeout(callback, delayMs);
  (handle as { unref?: () => void }).unref?.();
  return handle;
}

function createBrowserMessagePreprocessingWorker(): MessagePreprocessingWorkerLike {
  return new Worker(
    new URL("./message-preprocessing-worker.ts", import.meta.url),
    {
      name: "message-preprocessing",
      type: "module",
    },
  ) as unknown as MessagePreprocessingWorkerLike;
}

function isBrowserWorkerAvailable(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function createMessagePreprocessingCacheKey(text: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }

  return [
    text.length.toString(36),
    (hashA >>> 0).toString(36),
    (hashB >>> 0).toString(36),
  ].join(":");
}

export class MessagePreprocessingRequestManager {
  private readonly cache = new Map<string, MessagePreprocessingSnapshot>();
  private readonly canUseWorker: () => boolean;
  private readonly createWorker: () => MessagePreprocessingWorkerLike;
  private cacheBytes = 0;
  private readonly maxCacheBytes: number;
  private readonly maxCacheEntries: number;
  private readonly maxCacheEntryBytes: number;
  private readonly maxPendingWorkerRequests: number;
  private readonly pendingByCacheKey = new Map<
    string,
    PendingMessagePreprocessingEntry
  >();
  private readonly prepareSynchronously: (
    text: string,
  ) => PreparedMessageRenderPlan;
  private readonly requestToText = new Map<number, string>();
  private nextRequestId = 0;
  private worker: MessagePreprocessingWorkerLike | null = null;
  private workerFailed = false;
  private workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly workerIdleTimeoutMs: number;
  private readonly workerRequestTimeoutMs: number;
  /**
   * Create a caching client with configurable worker/sync fallback behavior.
   * @param canUseWorker - Whether a browser worker is available.
   * @param createWorker - Factory for creating a preprocessing worker.
   * @param maxCacheEntries - Maximum plans to keep in cache.
   * @param prepareSynchronously - Synchronous fallback parser.
   */

  constructor({
    canUseWorker = isBrowserWorkerAvailable,
    createWorker = createBrowserMessagePreprocessingWorker,
    maxCacheBytes = MESSAGE_PREPROCESS_CACHE_MAX_BYTES,
    maxCacheEntries = MESSAGE_PREPROCESS_CACHE_LIMIT,
    maxCacheEntryBytes = MESSAGE_PREPROCESS_CACHE_MAX_ENTRY_BYTES,
    maxPendingWorkerRequests = MESSAGE_PREPROCESS_MAX_PENDING_WORKER_REQUESTS,
    prepareSynchronously = prepareMessageRenderPlan,
    workerIdleTimeoutMs = MESSAGE_PREPROCESS_WORKER_IDLE_TIMEOUT_MS,
    workerRequestTimeoutMs = MESSAGE_PREPROCESS_WORKER_REQUEST_TIMEOUT_MS,
  }: {
    canUseWorker?: () => boolean;
    createWorker?: () => MessagePreprocessingWorkerLike;
    maxCacheBytes?: number;
    maxCacheEntries?: number;
    maxCacheEntryBytes?: number;
    maxPendingWorkerRequests?: number;
    prepareSynchronously?: (text: string) => PreparedMessageRenderPlan;
    workerIdleTimeoutMs?: number;
    workerRequestTimeoutMs?: number;
  } = {}) {
    this.canUseWorker = canUseWorker;
    this.createWorker = createWorker;
    this.maxCacheBytes = maxCacheBytes;
    this.maxCacheEntries = maxCacheEntries;
    this.maxCacheEntryBytes = maxCacheEntryBytes;
    this.maxPendingWorkerRequests = maxPendingWorkerRequests;
    this.prepareSynchronously = prepareSynchronously;
    this.workerIdleTimeoutMs = workerIdleTimeoutMs;
    this.workerRequestTimeoutMs = workerRequestTimeoutMs;
  }
  /**
   * Read a cached or in-flight snapshot for the provided message text.
   * @param text - Message text to process.
   */

  dispose(): void {
    for (const pending of this.pendingByCacheKey.values()) {
      this.clearPendingEntry(pending);
    }
    this.cache.clear();
    this.cacheBytes = 0;
    this.pendingByCacheKey.clear();
    this.requestToText.clear();
    this.workerFailed = false;
    this.terminateWorker();
  }
  read(text: string): MessagePreprocessingSnapshot {
    if (!text.trim()) {
      return {
        isLoading: false,
        plan: EMPTY_MESSAGE_RENDER_PLAN,
      };
    }

    const cacheKey = createMessagePreprocessingCacheKey(text);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.pendingByCacheKey.get(cacheKey);
    if (pending) {
      return pending.snapshot;
    }

    if (
      !shouldWorkerizeMessagePreprocessing(text) ||
      this.pendingByCacheKey.size >= this.maxPendingWorkerRequests
    ) {
      return this.storeReadySnapshot(cacheKey, this.prepareSynchronously(text));
    }

    const worker = this.getWorker();
    if (!worker) {
      return this.storeReadySnapshot(cacheKey, this.prepareSynchronously(text));
    }

    const loadingSnapshot: MessagePreprocessingSnapshot = {
      isLoading: true,
      plan: EMPTY_MESSAGE_RENDER_PLAN,
    };
    const requestId = this.nextRequestId + 1;
    this.nextRequestId = requestId;

    const pendingEntry: PendingMessagePreprocessingEntry = {
      cacheKey,
      listeners: new Set<MessagePreprocessingListener>(),
      requestId,
      snapshot: loadingSnapshot,
      timeoutHandle: null,
    };
    this.pendingByCacheKey.set(cacheKey, pendingEntry);
    this.requestToText.set(requestId, text);

    try {
      worker.postMessage({
        id: requestId,
        text,
      });
      if (this.workerRequestTimeoutMs > 0) {
        pendingEntry.timeoutHandle = scheduleMessagePreprocessingTimeout(() => {
          this.resolveSynchronously(text);
          this.scheduleWorkerIdleTermination();
        }, this.workerRequestTimeoutMs);
      }
    } catch {
      this.resolveSynchronously(text);
    }

    return loadingSnapshot;
  }
  /**
   * Subscribe to updates when a worker result is ready.
   * @param text - Message text being tracked.
   * @param listener - Listener called with latest snapshot.
   */

  subscribe(text: string, listener: MessagePreprocessingListener): () => void {
    const cacheKey = createMessagePreprocessingCacheKey(text);
    const pending = this.pendingByCacheKey.get(cacheKey);
    if (!pending) {
      return () => {};
    }

    pending.listeners.add(listener);
    return () => {
      pending.listeners.delete(listener);
      if (
        pending.listeners.size === 0 &&
        this.pendingByCacheKey.get(cacheKey) === pending
      ) {
        this.clearPendingEntry(pending);
        this.scheduleWorkerIdleTermination();
      }
    };
  }

  private clearPendingEntry(pending: PendingMessagePreprocessingEntry): void {
    if (pending.timeoutHandle !== null) {
      clearTimeout(pending.timeoutHandle);
      pending.timeoutHandle = null;
    }
    if (pending.requestId !== null) {
      this.requestToText.delete(pending.requestId);
    }
    this.pendingByCacheKey.delete(pending.cacheKey);
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
      this.pendingByCacheKey.size > 0 ||
      this.workerIdleTimeoutMs <= 0
    ) {
      return;
    }
    this.clearWorkerIdleTimer();
    this.workerIdleTimer = scheduleMessagePreprocessingTimeout(() => {
      if (this.pendingByCacheKey.size === 0) {
        this.terminateWorker();
      }
    }, this.workerIdleTimeoutMs);
  }

  private getWorker(): MessagePreprocessingWorkerLike | null {
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
   * Handle responses from the preprocessing worker.
   * @param data - Parsed worker response payload.
   */

  private handleWorkerMessage(data: MessagePreprocessingWorkerResponse): void {
    const text = this.requestToText.get(data.id);
    if (!text) {
      return;
    }

    this.requestToText.delete(data.id);

    if (!data.ok) {
      this.resolveSynchronously(text);
      this.scheduleWorkerIdleTermination();
      return;
    }

    this.finishPendingText(text, data.plan);
    this.scheduleWorkerIdleTermination();
  }

  private handleWorkerFailure(): void {
    const pendingTexts = [...this.requestToText.values()];
    this.requestToText.clear();

    this.terminateWorker();
    this.workerFailed = true;

    for (const text of pendingTexts) {
      this.resolveSynchronously(text);
    }
  }
  /**
   * Resolve a text entry synchronously when worker path is unavailable.
   * @param text - Message text to process synchronously.
   */

  private resolveSynchronously(text: string): void {
    const cacheKey = createMessagePreprocessingCacheKey(text);
    const pending = this.pendingByCacheKey.get(cacheKey);
    if (pending && pending.requestId !== null) {
      this.requestToText.delete(pending.requestId);
    }
    this.finishPendingText(text, this.prepareSynchronously(text));
  }
  /**
   * Finalize a pending snapshot and notify listeners.
   * @param text - Message text resolved.
   * @param plan - Computed render plan.
   */

  private finishPendingText(
    text: string,
    plan: PreparedMessageRenderPlan,
  ): void {
    const cacheKey = createMessagePreprocessingCacheKey(text);
    const pending = this.pendingByCacheKey.get(cacheKey);
    const readySnapshot = this.storeReadySnapshot(cacheKey, plan);
    if (!pending) {
      return;
    }

    this.clearPendingEntry(pending);
    for (const listener of pending.listeners) {
      listener(readySnapshot);
    }
  }
  /**
   * Persist a ready snapshot in the internal LRU cache.
   * @param cacheKey - Compact message text key.
   * @param plan - Finalized render plan.
   */

  private storeReadySnapshot(
    cacheKey: string,
    plan: PreparedMessageRenderPlan,
  ): MessagePreprocessingSnapshot {
    const snapshot: MessagePreprocessingSnapshot = {
      isLoading: false,
      plan,
    };
    const snapshotBytes = estimatePreparedMessageRenderPlanBytes(plan);

    if (this.cache.has(cacheKey)) {
      const currentSnapshot = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cacheBytes = Math.max(
        0,
        this.cacheBytes -
          (currentSnapshot
            ? estimatePreparedMessageRenderPlanBytes(currentSnapshot.plan)
            : 0),
      );
    }

    if (
      snapshotBytes > this.maxCacheEntryBytes ||
      snapshotBytes > this.maxCacheBytes
    ) {
      return snapshot;
    }

    this.cache.set(cacheKey, snapshot);
    this.cacheBytes += snapshotBytes;

    while (
      this.cache.size > this.maxCacheEntries ||
      this.cacheBytes > this.maxCacheBytes
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        this.cacheBytes = 0;
        break;
      }
      const oldestSnapshot = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.cacheBytes = Math.max(
        0,
        this.cacheBytes -
          (oldestSnapshot
            ? estimatePreparedMessageRenderPlanBytes(oldestSnapshot.plan)
            : 0),
      );
    }

    return snapshot;
  }
}

function installMessagePreprocessingRequestManagerLifecycle(
  manager: MessagePreprocessingRequestManager,
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

const sharedMessagePreprocessingRequestManager =
  new MessagePreprocessingRequestManager();
const removeMessagePreprocessingRequestManagerLifecycle =
  installMessagePreprocessingRequestManagerLifecycle(
    sharedMessagePreprocessingRequestManager,
  );

(import.meta as HotImportMeta).hot?.dispose(() => {
  removeMessagePreprocessingRequestManagerLifecycle();
  sharedMessagePreprocessingRequestManager.dispose();
});
/**
 * Hook to obtain a cached or async-prepared message render snapshot.
 * @param text - Message text to render.
 */

export function usePreparedMessageRenderPlan(
  text: string,
): MessagePreprocessingSnapshot {
  const [snapshot, setSnapshot] = useState<MessagePreprocessingSnapshot>(() =>
    sharedMessagePreprocessingRequestManager.read(text),
  );

  useEffect(() => {
    setSnapshot(sharedMessagePreprocessingRequestManager.read(text));
    return sharedMessagePreprocessingRequestManager.subscribe(
      text,
      setSnapshot,
    );
  }, [text]);

  return snapshot;
}
