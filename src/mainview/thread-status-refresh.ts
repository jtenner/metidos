import type { RpcThread, RpcThreadDetail } from "../bun/rpc-schema";
import { upsertThreadList } from "./app/state";

export type ThreadStatusRefreshOutcome = {
  nextThreads: RpcThread[];
  shouldApplySelectedDetail: boolean;
};

type ResolveThreadStatusRefreshOutcomeOptions = {
  detail: RpcThreadDetail | null;
  loadedThreads: RpcThread[];
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
  if (
    options.detail === null ||
    options.selectedThreadId !== options.selectedSummaryThreadId
  ) {
    return {
      nextThreads: options.loadedThreads,
      shouldApplySelectedDetail: false,
    };
  }

  return {
    nextThreads: upsertThreadList(options.loadedThreads, options.detail.thread),
    shouldApplySelectedDetail: true,
  };
}
