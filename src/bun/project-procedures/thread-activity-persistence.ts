/**
 * @file src/bun/project-procedures/thread-activity-persistence.ts
 * @description Buffered persistence for projected thread activity writes.
 */

import type { Database } from "bun:sqlite";

import type { ThreadActivityInput } from "../db";
import { createBoundMessageActivityStore } from "../message-activity-store";
import type { ProjectedPiActivityWrite } from "./pi-event-projection";

const DEFAULT_THREAD_ACTIVITY_FLUSH_INTERVAL_MS = 500;

type BufferedThreadActivityWrite = {
  buildInputs: () => Promise<ThreadActivityInput[]>;
  lastPersistedAt: number;
  lastPersistedSignature: string | null;
  messageIds: Array<number | null>;
  persisted: boolean;
  signature: string;
  terminal: boolean;
};

export type BufferedThreadActivityWriter = {
  flushAll: () => Promise<void>;
  queue: (
    activityId: string,
    signature: string,
    buildInputs: () => Promise<ThreadActivityInput[]>,
    options?: {
      force?: boolean;
      terminal?: boolean;
    },
  ) => Promise<void>;
};

export type ThreadActivityPersistenceRuntimeStats = {
  last: number;
  peak: number;
};

export type ThreadActivityPersistenceStore = {
  createBufferedWriter: () => BufferedThreadActivityWriter;
  persistInputs: (inputs: readonly ThreadActivityInput[]) => void;
  queueProjectedPiActivities: (
    writer: BufferedThreadActivityWriter,
    writes: readonly ProjectedPiActivityWrite[],
  ) => Promise<void>;
  runtimeStats: () => ThreadActivityPersistenceRuntimeStats;
};

type ThreadActivityPersistenceStoreOptions = {
  database: Database;
  flushIntervalMs?: number;
  invalidateThreadDetail: (threadId: number) => void;
  now?: () => number;
  performanceNow?: () => number;
};

export function createThreadActivityPersistenceStore({
  database,
  flushIntervalMs = DEFAULT_THREAD_ACTIVITY_FLUSH_INTERVAL_MS,
  invalidateThreadDetail,
  now = Date.now,
  performanceNow = () => performance.now(),
}: ThreadActivityPersistenceStoreOptions): ThreadActivityPersistenceStore {
  let lastDurationMs = 0;
  let peakDurationMs = 0;
  const messageActivityStore = createBoundMessageActivityStore(database);

  const recordDuration = (durationMs: number): void => {
    lastDurationMs = durationMs;
    peakDurationMs = Math.max(peakDurationMs, durationMs);
  };

  const invalidateForInputs = (
    inputs: readonly ThreadActivityInput[],
  ): void => {
    const firstInput = inputs[0];
    if (!firstInput) return;
    const firstThreadId = firstInput.threadId;
    let affectedThreadIds: Set<number> | null = null;
    for (let index = 1; index < inputs.length; index += 1) {
      const input = inputs[index];
      if (!input) continue;
      if (input.threadId !== firstThreadId) {
        affectedThreadIds = new Set([firstThreadId, input.threadId]);
        for (
          let restIndex = index + 1;
          restIndex < inputs.length;
          restIndex += 1
        ) {
          const restInput = inputs[restIndex];
          if (restInput) affectedThreadIds.add(restInput.threadId);
        }
        break;
      }
    }
    if (!affectedThreadIds) {
      invalidateThreadDetail(firstThreadId);
      return;
    }
    for (const threadId of affectedThreadIds) invalidateThreadDetail(threadId);
  };

  const persistInputs = (inputs: readonly ThreadActivityInput[]): void => {
    const startedAt = performanceNow();
    const persistedMessageIds = messageActivityStore.upsertActivities(inputs);
    recordDuration(Math.max(0, performanceNow() - startedAt));
    if (persistedMessageIds.length > 0) invalidateForInputs(inputs);
  };

  const createBufferedWriter = (): BufferedThreadActivityWriter => {
    const entries = new Map<string, BufferedThreadActivityWrite>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushChain = Promise.resolve();

    const clearFlushTimer = (): void => {
      if (!flushTimer) return;
      clearTimeout(flushTimer);
      flushTimer = null;
    };

    const scheduleFlush = (): void => {
      if (flushTimer || entries.size === 0) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void enqueueFlush(false);
      }, flushIntervalMs);
    };

    const flushEntries = async (force: boolean): Promise<void> => {
      const timestamp = now();
      let needsReschedule = false;
      const dueEntries: Array<{
        activityId: string;
        entry: BufferedThreadActivityWrite;
        signatureChanged: boolean;
      }> = [];
      for (const [activityId, entry] of entries) {
        const due =
          force ||
          !entry.persisted ||
          entry.terminal ||
          timestamp - entry.lastPersistedAt >= flushIntervalMs;
        if (!due) {
          needsReschedule = true;
          continue;
        }
        const signatureChanged =
          !entry.persisted || entry.lastPersistedSignature !== entry.signature;
        dueEntries.push({ activityId, entry, signatureChanged });
      }

      const resolvedEntries = await Promise.all(
        dueEntries
          .filter((due) => due.signatureChanged)
          .map(async ({ entry }) => ({
            entry,
            inputs: await entry.buildInputs(),
          })),
      );
      const flattenedInputs: Array<
        ThreadActivityInput & { messageId: number | null }
      > = [];
      for (const { entry, inputs } of resolvedEntries) {
        for (let index = 0; index < inputs.length; index += 1) {
          const input = inputs[index];
          if (!input) continue;
          flattenedInputs.push({
            ...input,
            messageId: entry.messageIds[index] ?? null,
          });
        }
      }
      if (flattenedInputs.length > 0) {
        const startedAt = performanceNow();
        const persistedMessageIds =
          messageActivityStore.upsertActivities(flattenedInputs);
        recordDuration(Math.max(0, performanceNow() - startedAt));
        let offset = 0;
        for (const { entry, inputs } of resolvedEntries) {
          entry.messageIds = inputs.map(
            (_, index) => persistedMessageIds[offset + index] ?? null,
          );
          offset += inputs.length;
        }
        invalidateForInputs(flattenedInputs);
      }

      const persistedAt = now();
      for (const { activityId, entry, signatureChanged } of dueEntries) {
        if (signatureChanged) entry.lastPersistedSignature = entry.signature;
        entry.lastPersistedAt = persistedAt;
        entry.persisted = true;
        if (entry.terminal) entries.delete(activityId);
      }
      if (needsReschedule || entries.size > 0) scheduleFlush();
    };

    const enqueueFlush = (force: boolean): Promise<void> => {
      flushChain = flushChain.then(() => flushEntries(force));
      return flushChain;
    };

    return {
      flushAll: async () => {
        clearFlushTimer();
        try {
          await enqueueFlush(true);
        } finally {
          clearFlushTimer();
        }
      },
      queue: async (activityId, signature, buildInputs, options) => {
        const entry = entries.get(activityId) ?? {
          buildInputs,
          lastPersistedAt: 0,
          lastPersistedSignature: null,
          messageIds: [],
          persisted: false,
          signature,
          terminal: false,
        };
        entry.buildInputs = buildInputs;
        entry.signature = signature;
        entry.terminal = options?.terminal === true;
        entries.set(activityId, entry);
        if (options?.force === true || options?.terminal === true) {
          clearFlushTimer();
          await enqueueFlush(true);
          return;
        }
        scheduleFlush();
      },
    };
  };

  return {
    createBufferedWriter,
    persistInputs,
    queueProjectedPiActivities: async (writer, writes) => {
      for (const write of writes) {
        await writer.queue(
          write.activityId,
          write.signature,
          async () => write.inputs,
          {
            ...(write.force === true ? { force: true } : {}),
            ...(write.terminal === true ? { terminal: true } : {}),
          },
        );
      }
    },
    runtimeStats: () => ({ last: lastDurationMs, peak: peakDurationMs }),
  };
}
