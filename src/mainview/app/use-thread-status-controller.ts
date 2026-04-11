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
  buildSelectedThreadDetailRefreshKey,
  buildThreadStatusRequestKey,
  listWorkingThreadIds,
  mergeThreadStatusSummaries,
  resolveQueuedThreadStatusRefreshRequest,
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
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
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
  const activeThreadStatusRefreshKeyRef = useRef<string | null>(null);
  const queuedThreadStatusRefreshIdsRef = useRef<number[] | null>(null);
  const threadStatusRefreshPromiseRef = useRef<Promise<void> | null>(null);

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

      const selectedSummaryDetailRefreshKey =
        buildSelectedThreadDetailRefreshKey(selectedSummary);
      if (
        !shouldRefreshSelectedThreadDetail({
          lastLoadedSelectedDetailRefreshKey:
            options.selectedThreadDetailRefreshKeyRef.current,
          previousSelectedRunState: options.selectedThreadRunStateRef.current,
          selectedSummaryDetailRefreshKey,
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
        options.selectedThreadDetailRefreshKeyRef.current =
          buildSelectedThreadDetailRefreshKey(detail.thread);
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
      options.selectedThreadDetailRefreshKeyRef,
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
      const requestKey = buildThreadStatusRequestKey(threadIds);
      const activeRequest = threadStatusRefreshPromiseRef.current;
      if (activeRequest) {
        if (activeThreadStatusRefreshKeyRef.current !== requestKey) {
          queuedThreadStatusRefreshIdsRef.current = threadIds;
        }
        try {
          await activeRequest;
        } catch {
          // The owning refresh request already logged the failure.
        }
        return;
      }

      activeThreadStatusRefreshKeyRef.current = requestKey;
      const refreshPromise = (async () => {
        let nextThreadIds: number[] | null = threadIds;
        while (nextThreadIds && nextThreadIds.length > 0) {
          const completedThreadIds = nextThreadIds;
          queuedThreadStatusRefreshIdsRef.current = null;
          await refreshThreadStatuses(completedThreadIds);
          nextThreadIds = resolveQueuedThreadStatusRefreshRequest({
            completedThreadIds,
            queuedThreadIds: queuedThreadStatusRefreshIdsRef.current,
          });
          activeThreadStatusRefreshKeyRef.current = nextThreadIds
            ? buildThreadStatusRequestKey(nextThreadIds)
            : null;
        }
      })();
      threadStatusRefreshPromiseRef.current = refreshPromise;

      try {
        await refreshPromise;
      } catch (error) {
        if (options?.shouldLogError?.() ?? true) {
          console.error(errorMessage, error);
        }
      } finally {
        if (threadStatusRefreshPromiseRef.current === refreshPromise) {
          threadStatusRefreshPromiseRef.current = null;
          activeThreadStatusRefreshKeyRef.current = null;
          queuedThreadStatusRefreshIdsRef.current = null;
        }
      }
    },
    [refreshThreadStatuses],
  );

  useEffect(() => {
    const previousThreadId = previousSelectedThreadIdRef.current;
    options.selectedThreadIdRef.current = options.selectedThreadId;
    if (previousThreadId !== options.selectedThreadId) {
      options.selectedThreadDetailRefreshKeyRef.current = null;
    }
    if (
      previousThreadId !== null &&
      previousThreadId !== options.selectedThreadId
    ) {
      void options.discardThreadIfEmpty(previousThreadId);
    }
    previousSelectedThreadIdRef.current = options.selectedThreadId;
  }, [
    options.discardThreadIfEmpty,
    options.selectedThreadDetailRefreshKeyRef,
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
