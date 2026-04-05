/**
 * @file src/mainview/app/invalidation-events.ts
 * @description Module for invalidation events.
 */

import type {
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeTasksChanged,
} from "../../bun/rpc-schema";
import { worktreeKey } from "./state";

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
/**
 * Function of createCoalescedWorktreeInvalidationChannel.
 * @param scheduleFlush - The value of `scheduleFlush`.
 * @param cancelFlush - The value of `cancelFlush`.
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

const worktreeTasksChangedChannel =
  createCoalescedWorktreeInvalidationChannel<RpcWorktreeTasksChanged>();
const worktreeGitHistoryChangedChannel =
  createCoalescedWorktreeInvalidationChannel<RpcWorktreeGitHistoryChanged>();
/**
 * Function of publishWorktreeTasksChanged.
 * @param payload - The value of `payload`.
 */

export function publishWorktreeTasksChanged(
  payload: RpcWorktreeTasksChanged,
): void {
  worktreeTasksChangedChannel.publish(payload);
}
/**
 * Function of subscribeToWorktreeTasksChanged.
 * @param subscriber - The value of `subscriber`.
 */

export function subscribeToWorktreeTasksChanged(
  subscriber: WorktreeInvalidationSubscriber<RpcWorktreeTasksChanged>,
): () => void {
  return worktreeTasksChangedChannel.subscribe(subscriber);
}
/**
 * Function of publishWorktreeGitHistoryChanged.
 * @param payload - The value of `payload`.
 */

export function publishWorktreeGitHistoryChanged(
  payload: RpcWorktreeGitHistoryChanged,
): void {
  worktreeGitHistoryChangedChannel.publish(payload);
}
/**
 * Function of subscribeToWorktreeGitHistoryChanged.
 * @param subscriber - The value of `subscriber`.
 */

export function subscribeToWorktreeGitHistoryChanged(
  subscriber: WorktreeInvalidationSubscriber<RpcWorktreeGitHistoryChanged>,
): () => void {
  return worktreeGitHistoryChangedChannel.subscribe(subscriber);
}
