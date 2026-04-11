/**
 * @file src/mainview/app/use-thread-status-controller.ts
 * @description Isolated thread-status polling and selected-thread refresh controller.
 */

import {
  type Dispatch,
  type MutableRefObject,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type {
  ProjectProcedures,
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
} from "../../bun/rpc-schema";
import {
  listWorkingThreadIds,
  mergeThreadStatusSummaries,
  resolveThreadStatusRefreshOutcome,
  shouldRefreshSelectedThreadDetail,
} from "../thread-status-refresh";
import { THREAD_STATUS_POLL_INTERVAL_MS, type ThreadStore } from "./state";

type ThreadStatusControllerProcedures = Pick<
  ProjectProcedures,
  "getThread" | "listThreadStatuses"
>;

export type ThreadStatusControllerProps = {
  applyOptimisticThreadErrorSeenToList: (threads: RpcThread[]) => RpcThread[];
  discardThreadIfEmpty: (threadId: number) => Promise<void>;
  isDocumentVisible: boolean;
  mergeSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
  prepareOpenedThreadDetail: (detail: RpcThreadDetail) => RpcThreadDetail;
  procedures: ThreadStatusControllerProcedures;
  selectedThreadId: number | null;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedThreadRunStateRef: MutableRefObject<RpcThreadRunStatus["state"]>;
  setThreadStore: Dispatch<SetStateAction<ThreadStore>>;
  threads: RpcThread[];
};

export function useThreadStatusController(
  options: ThreadStatusControllerProps,
): void {
  const previousSelectedThreadIdRef = useRef<number | null>(
    options.selectedThreadId,
  );
  const previousDocumentVisibilityRef = useRef(options.isDocumentVisible);
  const threadStatusPollInFlightRef = useRef(false);

  const polledThreadIds = useMemo(
    () => listWorkingThreadIds(options.threads),
    [options.threads],
  );

  const refreshThreadStatuses = useCallback(
    async (threadIds: number[]) => {
      if (threadIds.length === 0) {
        return;
      }

      const activeSelectedThreadId = options.selectedThreadIdRef.current;
      const loadedThreadStatuses = options.applyOptimisticThreadErrorSeenToList(
        await options.procedures.listThreadStatuses({ threadIds }),
      );
      const selectedSummary =
        activeSelectedThreadId === null
          ? null
          : (loadedThreadStatuses.find(
              (thread) => thread.id === activeSelectedThreadId,
            ) ?? null);

      if (!selectedSummary) {
        options.setThreadStore((currentThreadStore) =>
          mergeThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
        return;
      }

      if (
        !shouldRefreshSelectedThreadDetail({
          previousSelectedRunState: options.selectedThreadRunStateRef.current,
          selectedSummaryRunState: selectedSummary.runStatus.state,
        })
      ) {
        options.selectedThreadRunStateRef.current =
          selectedSummary.runStatus.state;
        options.setThreadStore((currentThreadStore) =>
          mergeThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
        return;
      }

      try {
        const detail = options.prepareOpenedThreadDetail(
          await options.procedures.getThread({
            threadId: selectedSummary.id,
          }),
        );
        const selectedThreadIdForCommit = options.selectedThreadIdRef.current;
        options.setThreadStore(
          (currentThreadStore) =>
            resolveThreadStatusRefreshOutcome({
              currentThreadStore,
              detail,
              loadedThreadStatuses,
              selectedSummaryThreadId: selectedSummary.id,
              selectedThreadId: selectedThreadIdForCommit,
            }).nextThreadStore,
        );
        if (selectedThreadIdForCommit !== selectedSummary.id) {
          return;
        }
        options.selectedThreadRunStateRef.current =
          detail.thread.runStatus.state;
        options.mergeSelectedThreadMessageHistory(detail);
      } catch (error) {
        const selectedThreadIdForCommit = options.selectedThreadIdRef.current;
        options.setThreadStore(
          (currentThreadStore) =>
            resolveThreadStatusRefreshOutcome({
              currentThreadStore,
              detail: null,
              loadedThreadStatuses,
              selectedSummaryThreadId: selectedSummary.id,
              selectedThreadId: selectedThreadIdForCommit,
            }).nextThreadStore,
        );
        console.error(
          `Failed to refresh selected thread detail for ${selectedSummary.id}`,
          error,
        );
      }
    },
    [
      options.applyOptimisticThreadErrorSeenToList,
      options.mergeSelectedThreadMessageHistory,
      options.prepareOpenedThreadDetail,
      options.procedures,
      options.selectedThreadIdRef,
      options.selectedThreadRunStateRef,
      options.setThreadStore,
    ],
  );

  const pollThreadStatuses = useCallback(
    async (
      threadIds: number[],
      errorMessage: string,
      options?: {
        shouldLogError?: () => boolean;
      },
    ) => {
      if (threadStatusPollInFlightRef.current) {
        return;
      }

      threadStatusPollInFlightRef.current = true;
      try {
        await refreshThreadStatuses(threadIds);
      } catch (error) {
        if (options?.shouldLogError?.() ?? true) {
          console.error(errorMessage, error);
        }
      } finally {
        threadStatusPollInFlightRef.current = false;
      }
    },
    [refreshThreadStatuses],
  );

  useEffect(() => {
    const previousThreadId = previousSelectedThreadIdRef.current;
    options.selectedThreadIdRef.current = options.selectedThreadId;
    if (
      previousThreadId !== null &&
      previousThreadId !== options.selectedThreadId
    ) {
      void options.discardThreadIfEmpty(previousThreadId);
    }
    previousSelectedThreadIdRef.current = options.selectedThreadId;
  }, [
    options.discardThreadIfEmpty,
    options.selectedThreadId,
    options.selectedThreadIdRef,
  ]);

  useEffect(() => {
    const wasVisible = previousDocumentVisibilityRef.current;
    previousDocumentVisibilityRef.current = options.isDocumentVisible;
    if (
      !options.isDocumentVisible ||
      wasVisible ||
      polledThreadIds.length === 0
    ) {
      return;
    }

    void pollThreadStatuses(
      polledThreadIds,
      "Failed to refresh thread statuses after document became visible",
    );
  }, [options.isDocumentVisible, polledThreadIds, pollThreadStatuses]);

  useEffect(() => {
    if (polledThreadIds.length === 0) {
      if (options.threads.length === 0) {
        options.selectedThreadRunStateRef.current = "idle";
      }
      return;
    }

    let cancelled = false;
    const poll = async () => {
      await pollThreadStatuses(
        polledThreadIds,
        "Failed to poll thread statuses",
        {
          shouldLogError: () => !cancelled,
        },
      );
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, THREAD_STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    options.selectedThreadRunStateRef,
    options.threads.length,
    polledThreadIds,
    pollThreadStatuses,
  ]);
}

export const ThreadStatusController = memo(function ThreadStatusController(
  props: ThreadStatusControllerProps,
): null {
  useThreadStatusController(props);
  return null;
});
