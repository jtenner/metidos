/**
 * @file src/mainview/thread-status-refresh.ts
 * @description Module for thread status refresh.
 */

import type {
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
} from "../bun/rpc-schema";
import { type ThreadStore, upsertThreadStore } from "./app/thread-store";

export type ThreadStatusRefreshOutcome = {
  nextThreadStore: ThreadStore;
  shouldApplySelectedDetail: boolean;
};

export type ThreadActivityIndicator = "none" | "working" | "completed";

export type CompletedThreadIndicatorState = {
  hasUnreadCompletedThread: boolean;
  nextCompletedThreadIds: Set<number>;
};

export const MAX_COMPLETED_THREAD_INDICATOR_IDS = 200;

type MergeThreadStatusSummariesOptions = {
  currentThreadStore: ThreadStore;
  loadedThreadStatuses: RpcThread[];
};

export function listWorkingThreadIds(threads: RpcThread[]): number[] {
  const out = [];
  for (const thread of threads) {
    if (thread.runStatus.state === "working") out.push(thread.id);
  }
  return out;
}

export function buildThreadRunStateSnapshot(
  threads: RpcThread[],
): Map<number, RpcThreadRunStatus["state"]> {
  const next = new Map<number, RpcThreadRunStatus["state"]>();
  for (const thread of threads) {
    next.set(thread.id, thread.runStatus.state);
  }
  return next;
}

export function haveSameCompletedThreadIndicatorIds(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const threadId of left) {
    if (!right.has(threadId)) {
      return false;
    }
  }

  return true;
}

export function buildThreadStatusRequestKey(threadIds: number[]): string {
  return threadIds
    .slice()
    .sort((left, right) => left - right)
    .toString();
}

export function resolveQueuedThreadStatusRefreshRequest(options: {
  completedThreadIds: number[];
  queuedThreadIds: number[] | null;
}): number[] | null {
  if (!options.queuedThreadIds || options.queuedThreadIds.length === 0) {
    return null;
  }

  return buildThreadStatusRequestKey(options.completedThreadIds) ===
    buildThreadStatusRequestKey(options.queuedThreadIds)
    ? null
    : options.queuedThreadIds;
}

export function buildSelectedThreadDetailRefreshKey(
  thread: Pick<RpcThread, "id" | "updatedAt" | "runStatus"> | null,
): string | null {
  if (!thread) {
    return null;
  }

  return [
    thread.id,
    thread.updatedAt,
    thread.runStatus.state,
    thread.runStatus.updatedAt ?? "",
  ].join(":");
}

export function shouldRefreshSelectedThreadDetail(options: {
  lastLoadedSelectedDetailRefreshKey?: string | null;
  previousSelectedRunState: RpcThreadRunStatus["state"];
  selectedSummaryDetailRefreshKey?: string | null;
  selectedSummaryRunState: RpcThreadRunStatus["state"];
}): boolean {
  // Keep polling the selected thread while it is actively working. Buffered
  // thread-activity flushes can land without changing the lightweight summary
  // key, and the open transcript would otherwise look frozen until settle.
  if (options.selectedSummaryRunState === "working") {
    return true;
  }

  const requiresDetailRefresh =
    options.previousSelectedRunState === "working" ||
    (options.selectedSummaryRunState === "failed" &&
      options.previousSelectedRunState !== "failed") ||
    (options.selectedSummaryRunState === "stopped" &&
      options.previousSelectedRunState !== "stopped");

  if (!requiresDetailRefresh) {
    return false;
  }

  return (
    options.selectedSummaryDetailRefreshKey === null ||
    options.selectedSummaryDetailRefreshKey === undefined ||
    options.selectedSummaryDetailRefreshKey !==
      options.lastLoadedSelectedDetailRefreshKey
  );
}

export function readThreadActivityIndicator(options: {
  completedThreadIndicatorIds: ReadonlySet<number>;
  selectedThreadId: number | null;
  thread: Pick<RpcThread, "id" | "runStatus"> | null | undefined;
}): ThreadActivityIndicator {
  if (options.thread?.runStatus.state === "working") {
    return "working";
  }

  return options.thread &&
    options.selectedThreadId !== options.thread.id &&
    options.completedThreadIndicatorIds.has(options.thread.id)
    ? "completed"
    : "none";
}

export function resolveCompletedThreadIndicatorState(options: {
  currentCompletedThreadIds: ReadonlySet<number>;
  previousThreadRunStates: ReadonlyMap<number, RpcThreadRunStatus["state"]>;
  selectedThreadId: number | null;
  threads: RpcThread[];
}): CompletedThreadIndicatorState {
  let hasUnreadCompletedThread = false;
  const nextCompletedThreadIds = new Set<number>();

  for (const thread of options.threads) {
    if (thread.runStatus.state === "working") {
      continue;
    }

    const threadIsSelected = options.selectedThreadId === thread.id;
    if (options.currentCompletedThreadIds.has(thread.id) && !threadIsSelected) {
      if (nextCompletedThreadIds.size < MAX_COMPLETED_THREAD_INDICATOR_IDS) {
        nextCompletedThreadIds.add(thread.id);
      }
      hasUnreadCompletedThread = true;
    }

    if (
      options.previousThreadRunStates.get(thread.id) === "working" &&
      thread.runStatus.state === "idle" &&
      !threadIsSelected
    ) {
      if (nextCompletedThreadIds.size < MAX_COMPLETED_THREAD_INDICATOR_IDS) {
        nextCompletedThreadIds.add(thread.id);
      }
      hasUnreadCompletedThread = true;
    }
  }

  return {
    hasUnreadCompletedThread,
    nextCompletedThreadIds,
  };
}
/**
 * Merges thread status summaries.
 * @param options - Configuration options used by this operation.
 */

export function mergeThreadStatusSummaries(
  options: MergeThreadStatusSummariesOptions,
): ThreadStore {
  let nextThreadStore = options.currentThreadStore;

  for (const thread of options.loadedThreadStatuses) {
    nextThreadStore = upsertThreadStore(nextThreadStore, thread);
  }

  return nextThreadStore;
}

type ResolveThreadStatusRefreshOutcomeOptions = {
  detail: RpcThreadDetail | null;
  currentThreadStore: ThreadStore;
  loadedThreadStatuses: RpcThread[];
  selectedSummaryThreadId: number;
  selectedThreadId: number | null;
};

/**
 * Preserve the freshly loaded thread summary even when the selected-thread
 * detail cannot be applied or fails to load.
 */
export function resolveThreadStatusRefreshOutcome(
  options: ResolveThreadStatusRefreshOutcomeOptions,
): ThreadStatusRefreshOutcome {
  const mergedThreadStore = mergeThreadStatusSummaries({
    currentThreadStore: options.currentThreadStore,
    loadedThreadStatuses: options.loadedThreadStatuses,
  });

  if (
    options.detail === null ||
    options.selectedThreadId !== options.selectedSummaryThreadId
  ) {
    return {
      nextThreadStore: mergedThreadStore,
      shouldApplySelectedDetail: false,
    };
  }

  return {
    nextThreadStore: upsertThreadStore(
      mergedThreadStore,
      options.detail.thread,
    ),
    shouldApplySelectedDetail: true,
  };
}
