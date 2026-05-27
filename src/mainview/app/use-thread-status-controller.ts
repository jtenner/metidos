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
  RpcProcedureCallOptions,
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
} from "../../bun/rpc-schema";
import { logClientError } from "../client-logging";
import {
  buildThreadStatusRequestKey,
  listWorkingThreadIds,
  resolveQueuedThreadStatusRefreshRequest,
} from "../thread-status-refresh";
import {
  buildMainviewShellSelectedThreadDetailRefreshState,
  mergeMainviewShellThreadStatusSummaries,
  resolveMainviewShellThreadStatusRefreshOutcome,
  shouldRefreshMainviewShellSelectedThreadDetail,
} from "./mainview-shell-state";
import {
  createThreadStore,
  threadStoreItems,
  threadStoresEquivalent,
  type ThreadStore,
  upsertThreadStore,
} from "./thread-store";
import { THREAD_STATUS_POLL_INTERVAL_MS } from "./thread-ui-state";

type ThreadStatusControllerProcedures = Pick<
  ProjectProcedures,
  "getThread" | "listThreadStatuses" | "listThreads"
>;

export const THREAD_DISCOVERY_POLL_INTERVAL_MS = 30_000;
export const SELECTED_THREAD_DETAIL_POLL_MESSAGE_LIMIT = 12;
export const STUCK_WORKING_THREAD_BACKOFF_AFTER_MS = 60_000;
export const STUCK_WORKING_THREAD_POLL_INTERVAL_MS = 30_000;
export const SELECTED_THREAD_DETAIL_UNCHANGED_WORKING_MIN_INTERVAL_MS = 15_000;
const THREAD_STATUS_POLL_RPC_TIMEOUT_MS = 30_000;
const THREAD_DISCOVERY_POLL_RPC_TIMEOUT_MS = 30_000;
const SELECTED_THREAD_DETAIL_POLL_RPC_TIMEOUT_MS = 45_000;

export const THREAD_STATUS_POLL_RPC_OPTIONS = Object.freeze({
  priority: "background",
  timeoutMs: THREAD_STATUS_POLL_RPC_TIMEOUT_MS,
} satisfies RpcProcedureCallOptions);

export const THREAD_DISCOVERY_POLL_RPC_OPTIONS = Object.freeze({
  priority: "background",
  timeoutMs: THREAD_DISCOVERY_POLL_RPC_TIMEOUT_MS,
} satisfies RpcProcedureCallOptions);

export const SELECTED_THREAD_DETAIL_POLL_RPC_OPTIONS = Object.freeze({
  priority: "background",
  timeoutMs: SELECTED_THREAD_DETAIL_POLL_RPC_TIMEOUT_MS,
} satisfies RpcProcedureCallOptions);

function readThreadActivityTimestampMs(thread: RpcThread): number | null {
  const updatedAtMs = Date.parse(thread.runStatus.updatedAt ?? "");
  const startedAtMs = Date.parse(thread.runStatus.startedAt ?? "");
  const activityMs = Math.max(
    Number.isFinite(updatedAtMs) ? updatedAtMs : Number.NEGATIVE_INFINITY,
    Number.isFinite(startedAtMs) ? startedAtMs : Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(activityMs) ? activityMs : null;
}

function isStaleWorkingThread(thread: RpcThread, nowMs: number): boolean {
  if (thread.runStatus.state !== "working") {
    return false;
  }
  const activityMs = readThreadActivityTimestampMs(thread);
  return (
    activityMs !== null &&
    nowMs - activityMs >= STUCK_WORKING_THREAD_BACKOFF_AFTER_MS
  );
}

export function resolveThreadStatusPollIntervalMs({
  isDocumentVisible,
  nowMs = Date.now(),
  polledThreads,
}: {
  isDocumentVisible: boolean;
  nowMs?: number;
  polledThreads: readonly RpcThread[];
}): number | null {
  if (!isDocumentVisible || polledThreads.length === 0) {
    return null;
  }
  return polledThreads.every((thread) => isStaleWorkingThread(thread, nowMs))
    ? STUCK_WORKING_THREAD_POLL_INTERVAL_MS
    : THREAD_STATUS_POLL_INTERVAL_MS;
}

export function shouldRunThreadStatusPollInterval({
  isDocumentVisible,
  polledThreadIds,
}: {
  isDocumentVisible: boolean;
  polledThreadIds: readonly number[];
}): boolean {
  return isDocumentVisible && polledThreadIds.length > 0;
}

export function shouldSkipSelectedThreadDetailPoll({
  lastPoll,
  nowMs = Date.now(),
  selectedSummaryDetailRefreshKey,
  selectedSummaryRunState,
}: {
  lastPoll: { key: string | null; polledAtMs: number } | null;
  nowMs?: number;
  selectedSummaryDetailRefreshKey: string | null;
  selectedSummaryRunState: RpcThreadRunStatus["state"];
}): boolean {
  return (
    selectedSummaryRunState === "working" &&
    selectedSummaryDetailRefreshKey !== null &&
    lastPoll?.key === selectedSummaryDetailRefreshKey &&
    nowMs - lastPoll.polledAtMs <
      SELECTED_THREAD_DETAIL_UNCHANGED_WORKING_MIN_INTERVAL_MS
  );
}

export function shouldCommitThreadDiscoveryPoll({
  cancelled,
}: {
  cancelled: boolean;
}): boolean {
  return !cancelled;
}

export function shouldRequestEmptyThreadDiscard({
  isProtected,
  previousThreadId,
  selectedThreadId,
}: {
  isProtected?: boolean;
  previousThreadId: number | null;
  selectedThreadId: number | null;
}): boolean {
  return (
    previousThreadId !== null &&
    previousThreadId !== selectedThreadId &&
    isProtected !== true
  );
}

export type ThreadStatusControllerProps = {
  applyOptimisticThreadErrorSeenToList: (threads: RpcThread[]) => RpcThread[];
  discardThreadIfEmpty: (threadId: number) => Promise<void>;
  isDocumentVisible: boolean;
  isThreadEmptyDiscardProtected?: (threadId: number) => boolean;
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
  const threadDiscoveryPollPromiseRef = useRef<Promise<void> | null>(null);
  const selectedThreadDetailRefreshPromiseRef = useRef<{
    promise: Promise<RpcThreadDetail>;
    threadId: number;
  } | null>(null);
  const lastSelectedThreadDetailPollRef = useRef<{
    key: string | null;
    polledAtMs: number;
  } | null>(null);

  const polledThreadIdsKey = useMemo(
    () => buildThreadStatusRequestKey(listWorkingThreadIds(options.threads)),
    [options.threads],
  );

  const loadSelectedThreadDetailForPoll = useCallback(
    (
      threadId: number,
      requestOptions?: { signal?: AbortSignal },
    ): Promise<RpcThreadDetail> => {
      if (!requestOptions?.signal) {
        const activeRequest = selectedThreadDetailRefreshPromiseRef.current;
        if (activeRequest?.threadId === threadId) {
          return activeRequest.promise;
        }
      }

      const promise = options.procedures.getThread(
        {
          includeHeavyContent: false,
          messageLimit: SELECTED_THREAD_DETAIL_POLL_MESSAGE_LIMIT,
          threadId,
        },
        {
          ...SELECTED_THREAD_DETAIL_POLL_RPC_OPTIONS,
          ...(requestOptions?.signal ? { signal: requestOptions.signal } : {}),
        },
      );
      if (requestOptions?.signal) {
        return promise;
      }
      selectedThreadDetailRefreshPromiseRef.current = {
        promise,
        threadId,
      };
      void promise.finally(() => {
        if (
          selectedThreadDetailRefreshPromiseRef.current?.promise === promise
        ) {
          selectedThreadDetailRefreshPromiseRef.current = null;
        }
      });
      return promise;
    },
    [options.procedures],
  );
  const polledThreadIds = useMemo(
    () =>
      polledThreadIdsKey.length === 0
        ? []
        : polledThreadIdsKey.split(",").map((threadId) => Number(threadId)),
    [polledThreadIdsKey],
  );
  const threadByIdForPolling = useMemo(
    () =>
      new Map(options.threads.map((thread) => [thread.id, thread] as const)),
    [options.threads],
  );
  const polledThreads = useMemo(
    () =>
      polledThreadIds
        .map((threadId) => threadByIdForPolling.get(threadId) ?? null)
        .filter((thread): thread is RpcThread => thread !== null),
    [threadByIdForPolling, polledThreadIds],
  );
  const threadStatusPollIntervalMs = resolveThreadStatusPollIntervalMs({
    isDocumentVisible: options.isDocumentVisible,
    polledThreads,
  });

  const refreshThreadStatuses = useCallback(
    async (threadIds: number[], requestOptions?: { signal?: AbortSignal }) => {
      if (threadIds.length === 0) {
        return;
      }

      const activeSelectedThreadId = options.selectedThreadIdRef.current;
      const loadedThreadStatuses = options.applyOptimisticThreadErrorSeenToList(
        await options.procedures.listThreadStatuses(
          { threadIds },
          {
            ...THREAD_STATUS_POLL_RPC_OPTIONS,
            ...(requestOptions?.signal
              ? { signal: requestOptions.signal }
              : {}),
          },
        ),
      );
      const selectedSummary =
        activeSelectedThreadId === null
          ? null
          : (loadedThreadStatuses.find(
              (thread) => thread.id === activeSelectedThreadId,
            ) ?? null);

      if (!selectedSummary) {
        options.setThreadStore((currentThreadStore) =>
          mergeMainviewShellThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
        return;
      }

      const selectedSummaryDetailRefreshKey =
        buildMainviewShellSelectedThreadDetailRefreshState({
          thread: selectedSummary,
        }).detailRefreshKey;
      if (
        !shouldRefreshMainviewShellSelectedThreadDetail({
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
          mergeMainviewShellThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
        return;
      }

      if (
        shouldSkipSelectedThreadDetailPoll({
          lastPoll: lastSelectedThreadDetailPollRef.current,
          selectedSummaryDetailRefreshKey,
          selectedSummaryRunState: selectedSummary.runStatus.state,
        })
      ) {
        options.selectedThreadRunStateRef.current =
          selectedSummary.runStatus.state;
        options.setThreadStore((currentThreadStore) =>
          mergeMainviewShellThreadStatusSummaries({
            currentThreadStore,
            loadedThreadStatuses,
          }),
        );
        return;
      }

      try {
        const detail = options.prepareOpenedThreadDetail(
          await loadSelectedThreadDetailForPoll(
            selectedSummary.id,
            requestOptions?.signal
              ? { signal: requestOptions.signal }
              : undefined,
          ),
        );
        lastSelectedThreadDetailPollRef.current = {
          key: selectedSummaryDetailRefreshKey,
          polledAtMs: Date.now(),
        };
        const selectedThreadIdForCommit = options.selectedThreadIdRef.current;
        options.setThreadStore(
          (currentThreadStore) =>
            resolveMainviewShellThreadStatusRefreshOutcome({
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
        const refreshState =
          buildMainviewShellSelectedThreadDetailRefreshState(detail);
        options.selectedThreadDetailRefreshKeyRef.current =
          refreshState.detailRefreshKey;
        options.selectedThreadRunStateRef.current = refreshState.runState;
        options.mergeSelectedThreadMessageHistory(detail);
      } catch (error) {
        const selectedThreadIdForCommit = options.selectedThreadIdRef.current;
        options.setThreadStore(
          (currentThreadStore) =>
            resolveMainviewShellThreadStatusRefreshOutcome({
              currentThreadStore,
              detail: null,
              loadedThreadStatuses,
              selectedSummaryThreadId: selectedSummary.id,
              selectedThreadId: selectedThreadIdForCommit,
            }).nextThreadStore,
        );
        logClientError("Failed to refresh selected thread detail", error, {
          context: `threadId:${selectedSummary.id}`,
        });
      }
    },
    [
      options.applyOptimisticThreadErrorSeenToList,
      options.mergeSelectedThreadMessageHistory,
      loadSelectedThreadDetailForPoll,
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
        signal?: AbortSignal;
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
          await refreshThreadStatuses(
            completedThreadIds,
            options?.signal ? { signal: options.signal } : undefined,
          );
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
          logClientError(errorMessage, error);
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
      shouldRequestEmptyThreadDiscard({
        isProtected:
          options.isThreadEmptyDiscardProtected?.(previousThreadId) ?? false,
        previousThreadId,
        selectedThreadId: options.selectedThreadId,
      })
    ) {
      void options.discardThreadIfEmpty(previousThreadId);
    }
    previousSelectedThreadIdRef.current = options.selectedThreadId;
  }, [
    options.discardThreadIfEmpty,
    options.isThreadEmptyDiscardProtected,
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
    if (threadStatusPollIntervalMs === null) {
      if (options.threads.length === 0) {
        options.selectedThreadRunStateRef.current = "idle";
      }
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;
    const poll = async () => {
      if (activeController !== null) {
        return;
      }
      const controller = new AbortController();
      activeController = controller;
      try {
        await pollThreadStatuses(
          polledThreadIds,
          "Failed to poll thread statuses",
          {
            shouldLogError: () => !cancelled,
            signal: controller.signal,
          },
        );
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, threadStatusPollIntervalMs);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(timer);
    };
  }, [
    options.selectedThreadRunStateRef,
    options.threads.length,
    polledThreadIds,
    pollThreadStatuses,
    threadStatusPollIntervalMs,
  ]);

  useEffect(() => {
    if (!options.isDocumentVisible) {
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;
    const pollThreadList = async () => {
      if (threadDiscoveryPollPromiseRef.current) {
        return;
      }

      const controller = new AbortController();
      activeController = controller;
      const pollPromise = (async () => {
        try {
          const activeSelectedThreadId = options.selectedThreadIdRef.current;
          const loadedThreads = options.applyOptimisticThreadErrorSeenToList(
            await options.procedures.listThreads(
              { offset: 0, limit: 100 },
              {
                ...THREAD_DISCOVERY_POLL_RPC_OPTIONS,
                signal: controller.signal,
              },
            ),
          );
          if (!shouldCommitThreadDiscoveryPoll({ cancelled })) {
            return;
          }
          const nextDiscoveredThreadStore = loadedThreads.reduce(
            (store, thread) => upsertThreadStore(store, thread),
            createThreadStore(options.threads),
          );
          const discoveredThreads = threadStoreItems(nextDiscoveredThreadStore);
          const selectedSummary =
            activeSelectedThreadId === null
              ? null
              : (nextDiscoveredThreadStore.byId[activeSelectedThreadId] ??
                null);

          if (!selectedSummary) {
            options.setThreadStore((currentThreadStore) =>
              threadStoresEquivalent(
                currentThreadStore,
                nextDiscoveredThreadStore,
              )
                ? currentThreadStore
                : nextDiscoveredThreadStore,
            );
            if (discoveredThreads.length === 0) {
              options.selectedThreadRunStateRef.current = "idle";
            }
            return;
          }

          const selectedSummaryDetailRefreshKey =
            buildMainviewShellSelectedThreadDetailRefreshState({
              thread: selectedSummary,
            }).detailRefreshKey;
          if (
            !shouldRefreshMainviewShellSelectedThreadDetail({
              lastLoadedSelectedDetailRefreshKey:
                options.selectedThreadDetailRefreshKeyRef.current,
              previousSelectedRunState:
                options.selectedThreadRunStateRef.current,
              selectedSummaryDetailRefreshKey,
              selectedSummaryRunState: selectedSummary.runStatus.state,
            })
          ) {
            options.selectedThreadRunStateRef.current =
              selectedSummary.runStatus.state;
            options.setThreadStore((currentThreadStore) =>
              threadStoresEquivalent(
                currentThreadStore,
                nextDiscoveredThreadStore,
              )
                ? currentThreadStore
                : nextDiscoveredThreadStore,
            );
            return;
          }

          if (
            shouldSkipSelectedThreadDetailPoll({
              lastPoll: lastSelectedThreadDetailPollRef.current,
              selectedSummaryDetailRefreshKey,
              selectedSummaryRunState: selectedSummary.runStatus.state,
            })
          ) {
            options.setThreadStore((currentThreadStore) =>
              threadStoresEquivalent(
                currentThreadStore,
                nextDiscoveredThreadStore,
              )
                ? currentThreadStore
                : nextDiscoveredThreadStore,
            );
            return;
          }

          try {
            const detail = options.prepareOpenedThreadDetail(
              await loadSelectedThreadDetailForPoll(selectedSummary.id, {
                signal: controller.signal,
              }),
            );
            lastSelectedThreadDetailPollRef.current = {
              key: selectedSummaryDetailRefreshKey,
              polledAtMs: Date.now(),
            };
            if (!shouldCommitThreadDiscoveryPoll({ cancelled })) {
              return;
            }
            const selectedThreadIdForCommit =
              options.selectedThreadIdRef.current;
            const nextThreadStore = nextDiscoveredThreadStore;
            options.setThreadStore((currentThreadStore) => {
              const resolvedThreadStore =
                selectedThreadIdForCommit === selectedSummary.id
                  ? resolveMainviewShellThreadStatusRefreshOutcome({
                      currentThreadStore: nextThreadStore,
                      detail,
                      loadedThreadStatuses: loadedThreads,
                      selectedSummaryThreadId: selectedSummary.id,
                      selectedThreadId: selectedThreadIdForCommit,
                    }).nextThreadStore
                  : nextThreadStore;
              return threadStoresEquivalent(
                currentThreadStore,
                resolvedThreadStore,
              )
                ? currentThreadStore
                : resolvedThreadStore;
            });
            if (selectedThreadIdForCommit !== selectedSummary.id) {
              return;
            }
            const refreshState =
              buildMainviewShellSelectedThreadDetailRefreshState(detail);
            options.selectedThreadDetailRefreshKeyRef.current =
              refreshState.detailRefreshKey;
            options.selectedThreadRunStateRef.current = refreshState.runState;
            options.mergeSelectedThreadMessageHistory(detail);
          } catch (error) {
            if (!shouldCommitThreadDiscoveryPoll({ cancelled })) {
              return;
            }
            options.setThreadStore((currentThreadStore) =>
              threadStoresEquivalent(
                currentThreadStore,
                nextDiscoveredThreadStore,
              )
                ? currentThreadStore
                : nextDiscoveredThreadStore,
            );
            if (!cancelled) {
              logClientError("Failed to refresh thread list", error);
            }
          }
        } catch (error) {
          if (!cancelled) {
            logClientError("Failed to discover external thread updates", error);
          }
        }
      })();
      threadDiscoveryPollPromiseRef.current = pollPromise;
      try {
        await pollPromise;
      } finally {
        if (threadDiscoveryPollPromiseRef.current === pollPromise) {
          threadDiscoveryPollPromiseRef.current = null;
        }
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    void pollThreadList();
    const timer = window.setInterval(() => {
      void pollThreadList();
    }, THREAD_DISCOVERY_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(timer);
    };
  }, [
    options.applyOptimisticThreadErrorSeenToList,
    loadSelectedThreadDetailForPoll,
    options.isDocumentVisible,
    options.mergeSelectedThreadMessageHistory,
    options.prepareOpenedThreadDetail,
    options.procedures,
    options.selectedThreadDetailRefreshKeyRef,
    options.selectedThreadIdRef,
    options.selectedThreadRunStateRef,
    options.setThreadStore,
    options.threads,
  ]);
}

export const ThreadStatusController = memo(function ThreadStatusController(
  props: ThreadStatusControllerProps,
): null {
  useThreadStatusController(props);
  return null;
});
