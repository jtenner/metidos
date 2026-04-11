/**
 * @file src/mainview/thread-status-refresh.ts
 * @description Module for thread status refresh.
 */

import type {
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
} from "../bun/rpc-schema";
import { type ThreadStore, upsertThreadStore } from "./app/state";

export type ThreadStatusRefreshOutcome = {
  nextThreadStore: ThreadStore;
  shouldApplySelectedDetail: boolean;
};

type MergeThreadStatusSummariesOptions = {
  currentThreadStore: ThreadStore;
  loadedThreadStatuses: RpcThread[];
};

export function listWorkingThreadIds(threads: RpcThread[]): number[] {
  return threads
    .filter((thread) => thread.runStatus.state === "working")
    .map((thread) => thread.id);
}

export function shouldRefreshSelectedThreadDetail(options: {
  previousSelectedRunState: RpcThreadRunStatus["state"];
  selectedSummaryRunState: RpcThreadRunStatus["state"];
}): boolean {
  return (
    options.selectedSummaryRunState === "working" ||
    options.previousSelectedRunState === "working" ||
    (options.selectedSummaryRunState === "failed" &&
      options.previousSelectedRunState !== "failed") ||
    (options.selectedSummaryRunState === "stopped" &&
      options.previousSelectedRunState !== "stopped")
  );
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
