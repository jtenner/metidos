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

const MESSAGE_PREPROCESS_CACHE_LIMIT = 32;

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
  listeners: Set<MessagePreprocessingListener>;
  requestId: number | null;
  snapshot: MessagePreprocessingSnapshot;
};

const EMPTY_MESSAGE_RENDER_PLAN: PreparedMessageRenderPlan = {
  kind: "plain",
  segments: [],
};

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

export class MessagePreprocessingRequestManager {
  private readonly cache = new Map<string, MessagePreprocessingSnapshot>();
  private readonly canUseWorker: () => boolean;
  private readonly createWorker: () => MessagePreprocessingWorkerLike;
  private readonly maxCacheEntries: number;
  private readonly pendingByText = new Map<
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

  constructor({
    canUseWorker = isBrowserWorkerAvailable,
    createWorker = createBrowserMessagePreprocessingWorker,
    maxCacheEntries = MESSAGE_PREPROCESS_CACHE_LIMIT,
    prepareSynchronously = prepareMessageRenderPlan,
  }: {
    canUseWorker?: () => boolean;
    createWorker?: () => MessagePreprocessingWorkerLike;
    maxCacheEntries?: number;
    prepareSynchronously?: (text: string) => PreparedMessageRenderPlan;
  } = {}) {
    this.canUseWorker = canUseWorker;
    this.createWorker = createWorker;
    this.maxCacheEntries = maxCacheEntries;
    this.prepareSynchronously = prepareSynchronously;
  }

  read(text: string): MessagePreprocessingSnapshot {
    if (!text.trim()) {
      return {
        isLoading: false,
        plan: EMPTY_MESSAGE_RENDER_PLAN,
      };
    }

    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }

    const pending = this.pendingByText.get(text);
    if (pending) {
      return pending.snapshot;
    }

    if (!shouldWorkerizeMessagePreprocessing(text)) {
      return this.storeReadySnapshot(text, this.prepareSynchronously(text));
    }

    const worker = this.getWorker();
    if (!worker) {
      return this.storeReadySnapshot(text, this.prepareSynchronously(text));
    }

    const loadingSnapshot: MessagePreprocessingSnapshot = {
      isLoading: true,
      plan: EMPTY_MESSAGE_RENDER_PLAN,
    };
    const requestId = this.nextRequestId + 1;
    this.nextRequestId = requestId;

    this.pendingByText.set(text, {
      listeners: new Set<MessagePreprocessingListener>(),
      requestId,
      snapshot: loadingSnapshot,
    });
    this.requestToText.set(requestId, text);

    try {
      worker.postMessage({
        id: requestId,
        text,
      });
    } catch {
      this.resolveSynchronously(text);
    }

    return loadingSnapshot;
  }

  subscribe(text: string, listener: MessagePreprocessingListener): () => void {
    const pending = this.pendingByText.get(text);
    if (!pending) {
      return () => {};
    }

    pending.listeners.add(listener);
    return () => {
      pending.listeners.delete(listener);
    };
  }

  private getWorker(): MessagePreprocessingWorkerLike | null {
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

  private handleWorkerMessage(data: MessagePreprocessingWorkerResponse): void {
    const text = this.requestToText.get(data.id);
    if (!text) {
      return;
    }

    this.requestToText.delete(data.id);

    if (!data.ok) {
      this.resolveSynchronously(text);
      return;
    }

    this.finishPendingText(text, data.plan);
  }

  private handleWorkerFailure(): void {
    const pendingTexts = [...this.pendingByText.keys()];
    this.requestToText.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerFailed = true;

    for (const text of pendingTexts) {
      this.resolveSynchronously(text);
    }
  }

  private resolveSynchronously(text: string): void {
    const pending = this.pendingByText.get(text);
    if (pending && pending.requestId !== null) {
      this.requestToText.delete(pending.requestId);
    }
    this.finishPendingText(text, this.prepareSynchronously(text));
  }

  private finishPendingText(
    text: string,
    plan: PreparedMessageRenderPlan,
  ): void {
    const pending = this.pendingByText.get(text);
    const readySnapshot = this.storeReadySnapshot(text, plan);
    if (!pending) {
      return;
    }

    this.pendingByText.delete(text);
    for (const listener of pending.listeners) {
      listener(readySnapshot);
    }
  }

  private storeReadySnapshot(
    text: string,
    plan: PreparedMessageRenderPlan,
  ): MessagePreprocessingSnapshot {
    const snapshot: MessagePreprocessingSnapshot = {
      isLoading: false,
      plan,
    };

    if (this.cache.has(text)) {
      this.cache.delete(text);
    }
    this.cache.set(text, snapshot);

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

const sharedMessagePreprocessingRequestManager =
  new MessagePreprocessingRequestManager();

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
