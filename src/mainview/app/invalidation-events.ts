/**
 * @file src/mainview/app/invalidation-events.ts
 * @description Module for invalidation events.
 */

import type { RpcWorktreeGitHistoryChanged } from "../../bun/rpc-schema";
import { worktreeKey } from "./project-worktree-state";

type WorktreeInvalidationPayload = {
  projectId: number;
  worktreePath: string;
};

type WorktreeInvalidationSubscriber<
  TPayload extends WorktreeInvalidationPayload,
> = (payload: TPayload) => void;

type ScheduledFlushHandle = unknown;
type ScheduleFlush = (flush: () => void) => ScheduledFlushHandle;
type CancelFlush = (handle: ScheduledFlushHandle) => void;

type CoalescedWorktreeInvalidationChannel<
  TPayload extends WorktreeInvalidationPayload,
> = {
  flushPending: () => void;
  publish: (payload: TPayload) => void;
  subscribe: (
    subscriber: WorktreeInvalidationSubscriber<TPayload>,
  ) => () => void;
};

type CoalescedSignalChannel = {
  flushPending: () => void;
  publish: () => void;
  subscribe: (subscriber: () => void) => () => void;
};
/**
 * Creates coalesced worktree invalidation channel.
 * @param scheduleFlush - scheduleFlush argument for createCoalescedWorktreeInvalidationChannel.
 * @param cancelFlush - cancelFlush argument for createCoalescedWorktreeInvalidationChannel.
 */

export function createCoalescedWorktreeInvalidationChannel<
  TPayload extends WorktreeInvalidationPayload,
>(
  scheduleFlush: ScheduleFlush = (flush) => globalThis.setTimeout(flush, 0),
  cancelFlush: CancelFlush = (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
): CoalescedWorktreeInvalidationChannel<TPayload> {
  const subscribers = new Set<WorktreeInvalidationSubscriber<TPayload>>();
  const pendingPayloadsByKey = new Map<string, TPayload>();
  let scheduledFlushHandle: ScheduledFlushHandle | null = null;

  const flushPending = (): void => {
    if (scheduledFlushHandle !== null) {
      cancelFlush(scheduledFlushHandle);
      scheduledFlushHandle = null;
    }
    if (pendingPayloadsByKey.size === 0) {
      return;
    }

    const pendingPayloads = [...pendingPayloadsByKey.values()];
    pendingPayloadsByKey.clear();
    for (const subscriber of subscribers) {
      for (const payload of pendingPayloads) {
        subscriber(payload);
      }
    }
  };

  return {
    flushPending,
    publish: (payload) => {
      pendingPayloadsByKey.set(
        worktreeKey(payload.projectId, payload.worktreePath),
        payload,
      );
      if (scheduledFlushHandle !== null) {
        return;
      }
      scheduledFlushHandle = scheduleFlush(flushPending);
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}

export function createCoalescedSignalChannel(
  scheduleFlush: ScheduleFlush = (flush) => globalThis.setTimeout(flush, 0),
  cancelFlush: CancelFlush = (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
): CoalescedSignalChannel {
  const subscribers = new Set<() => void>();
  let hasPendingSignal = false;
  let scheduledFlushHandle: ScheduledFlushHandle | null = null;

  const flushPending = (): void => {
    if (scheduledFlushHandle !== null) {
      cancelFlush(scheduledFlushHandle);
      scheduledFlushHandle = null;
    }
    if (!hasPendingSignal) {
      return;
    }

    hasPendingSignal = false;
    for (const subscriber of subscribers) {
      subscriber();
    }
  };

  return {
    flushPending,
    publish: () => {
      hasPendingSignal = true;
      if (scheduledFlushHandle !== null) {
        return;
      }
      scheduledFlushHandle = scheduleFlush(flushPending);
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}

const worktreeGitHistoryChangedChannel =
  createCoalescedWorktreeInvalidationChannel<RpcWorktreeGitHistoryChanged>();
const cronJobsChangedChannel = createCoalescedSignalChannel();
/**
 * Performs publishWorktreeGitHistoryChanged operation.
 * @param payload - payload argument for publishWorktreeGitHistoryChanged.
 */

export function publishWorktreeGitHistoryChanged(
  payload: RpcWorktreeGitHistoryChanged,
): void {
  worktreeGitHistoryChangedChannel.publish(payload);
}
/**
 * Performs subscribeToWorktreeGitHistoryChanged operation.
 * @param subscriber - subscriber argument for subscribeToWorktreeGitHistoryChanged.
 */

export function subscribeToWorktreeGitHistoryChanged(
  subscriber: WorktreeInvalidationSubscriber<RpcWorktreeGitHistoryChanged>,
): () => void {
  return worktreeGitHistoryChangedChannel.subscribe(subscriber);
}

export function publishCronJobsChanged(): void {
  cronJobsChangedChannel.publish();
}

export function subscribeToCronJobsChanged(subscriber: () => void): () => void {
  return cronJobsChangedChannel.subscribe(subscriber);
}
