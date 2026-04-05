import type { RpcThread, RpcThreadDetail } from "../bun/rpc-schema";
import { upsertThreadList } from "./app/state";

export type ThreadStatusRefreshOutcome = {
  nextThreads: RpcThread[];
  shouldApplySelectedDetail: boolean;
};

type MergeThreadStatusSummariesOptions = {
  currentThreads: RpcThread[];
  loadedThreadStatuses: RpcThread[];
};

export function mergeThreadStatusSummaries(
  options: MergeThreadStatusSummariesOptions,
): RpcThread[] {
  let nextThreads = options.currentThreads;

  for (const thread of options.loadedThreadStatuses) {
    nextThreads = upsertThreadList(nextThreads, thread);
  }

  return nextThreads;
}

type ResolveThreadStatusRefreshOutcomeOptions = {
  detail: RpcThreadDetail | null;
  currentThreads: RpcThread[];
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
  const mergedThreads = mergeThreadStatusSummaries({
    currentThreads: options.currentThreads,
    loadedThreadStatuses: options.loadedThreadStatuses,
  });

  if (
    options.detail === null ||
    options.selectedThreadId !== options.selectedSummaryThreadId
  ) {
    return {
      nextThreads: mergedThreads,
      shouldApplySelectedDetail: false,
    };
  }

  return {
    nextThreads: upsertThreadList(mergedThreads, options.detail.thread),
    shouldApplySelectedDetail: true,
  };
}
