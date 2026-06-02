/**
 * @file src/mainview/app/use-git-history-controller.ts
 * @description Git history and commit-diff controller extraction.
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ProjectProcedures,
  RpcGitHistoryEntry,
  RpcProject,
  RpcThread,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import {
  awaitAbortableResult,
  createAbortError,
  isAbortError,
  type PendingSharedRequest,
  readLruValue,
  writeLruValue,
} from "./async-request-state";
import {
  appendGitHistoryPage,
  createGitHistoryDiffModalOpenState,
  estimateGitHistoryDiffCacheEntryBytes,
  estimateGitHistoryResultBytes,
  GIT_HISTORY_CACHE_PRUNE_INTERVAL_MS,
  GIT_HISTORY_DIFF_CACHE_IDLE_TTL_MS,
  GIT_HISTORY_DIFF_CACHE_MAX_BYTES,
  GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
  GIT_HISTORY_PAGE_SIZE,
  GIT_HISTORY_RESULT_CACHE_IDLE_TTL_MS,
  GIT_HISTORY_RESULT_CACHE_MAX_BYTES,
  GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
  type GitHistoryDiffCacheEntry,
  type GitHistoryModalState,
  gitHistoryDiffCacheKey,
  mergeResetGitHistory,
  trimGitHistoryResultEntries,
} from "./git-history-state";
import {
  type FrontendGitCacheTelemetry,
  updateFrontendGitCacheTelemetry,
} from "./frontend-memory-telemetry";
import { subscribeToWorktreeGitHistoryChanged } from "./invalidation-events";
import { worktreeKey } from "./project-worktree-state";

export function resolveGitHistoryLoadBehavior(options: {
  cachedHistory: RpcWorktreeGitHistoryResult | null;
  preferCached?: boolean;
  silent?: boolean;
  skipRefreshWhenCached?: boolean;
}): {
  serveCachedHistory: boolean;
  silentRefresh: boolean;
  skipRefreshWhenCached: boolean;
} {
  const serveCachedHistory = Boolean(
    options.preferCached && options.cachedHistory,
  );
  const skipRefreshWhenCached = Boolean(
    serveCachedHistory && options.skipRefreshWhenCached,
  );
  const silentRefresh = Boolean(options.silent || serveCachedHistory);
  return {
    serveCachedHistory,
    silentRefresh,
    skipRefreshWhenCached,
  };
}

export function canLoadMoreGitHistory(options: {
  activeSelectedWorktreePath: string | null;
  gitHistory: RpcWorktreeGitHistoryResult | null;
  gitHistoryLoading: boolean;
  gitHistoryLoadingMore: boolean;
  hasPendingLoadMore: boolean;
  selectedProject: RpcProject | null;
}): boolean {
  return Boolean(
    options.selectedProject &&
      options.activeSelectedWorktreePath &&
      options.gitHistory &&
      options.gitHistory.nextOffset !== null &&
      !options.gitHistoryLoading &&
      !options.gitHistoryLoadingMore &&
      !options.hasPendingLoadMore,
  );
}

export function touchGitHistoryCacheEntry(
  lastAccessByKey: Map<string, number>,
  key: string,
  nowMs = Date.now(),
): void {
  lastAccessByKey.set(key, nowMs);
}

export function pruneIdleGitHistoryCacheEntries<TValue>(
  cache: Map<string, TValue>,
  lastAccessByKey: Map<string, number>,
  idleTtlMs: number,
  nowMs = Date.now(),
): number {
  let removed = 0;
  for (const key of cache.keys()) {
    const lastAccessMs = lastAccessByKey.get(key) ?? 0;
    if (nowMs - lastAccessMs >= idleTtlMs) {
      cache.delete(key);
      lastAccessByKey.delete(key);
      removed += 1;
    }
  }

  for (const key of lastAccessByKey.keys()) {
    if (!cache.has(key)) {
      lastAccessByKey.delete(key);
    }
  }
  return removed;
}

function estimateCacheBytes<TValue>(
  cache: ReadonlyMap<string, TValue>,
  estimateBytes: (value: TValue) => number,
): number {
  let bytes = 0;
  for (const value of cache.values()) {
    bytes += estimateBytes(value);
  }
  return bytes;
}

type GitHistoryControllerProcedures = Pick<
  ProjectProcedures,
  "getWorktreeGitCommitDiff" | "listWorktreeGitHistory"
>;

export type UseGitHistoryControllerParams = {
  activeSelectedWorktreeMissing: boolean;
  activeSelectedWorktreePath: string | null;
  gitHistory: RpcWorktreeGitHistoryResult | null;
  gitHistoryLoading: boolean;
  gitHistoryLoadingMore: boolean;
  procedures: GitHistoryControllerProcedures;
  selectedProject: RpcProject | null;
  selectedThread: RpcThread | null;
  sessionStateReady: boolean;
  setGitHistory: Dispatch<SetStateAction<RpcWorktreeGitHistoryResult | null>>;
  setGitHistoryError: Dispatch<SetStateAction<string>>;
  setGitHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setGitHistoryLoadingMore: Dispatch<SetStateAction<boolean>>;
};

export function useGitHistoryController({
  activeSelectedWorktreeMissing,
  activeSelectedWorktreePath,
  gitHistory,
  gitHistoryLoading,
  gitHistoryLoadingMore,
  procedures,
  selectedProject,
  selectedThread,
  sessionStateReady,
  setGitHistory,
  setGitHistoryError,
  setGitHistoryLoading,
  setGitHistoryLoadingMore,
}: UseGitHistoryControllerParams) {
  const [gitHistoryModal, setGitHistoryModal] =
    useState<GitHistoryModalState | null>(null);

  const gitHistoryRequestIdRef = useRef(0);
  const gitHistoryAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryDiffRequestIdRef = useRef(0);
  const gitHistoryDiffAbortControllerRef = useRef<AbortController | null>(null);
  const gitHistoryLoadMoreAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const gitHistoryLoadingMoreRef = useRef(false);
  const gitHistoryDiffCacheRef = useRef(
    new Map<string, GitHistoryDiffCacheEntry>(),
  );
  const gitHistoryDiffCacheAccessRef = useRef(new Map<string, number>());
  const gitHistoryDiffRequestCacheRef = useRef(
    new Map<string, PendingSharedRequest<GitHistoryDiffCacheEntry>>(),
  );
  const gitHistoryCacheRef = useRef(
    new Map<string, RpcWorktreeGitHistoryResult>(),
  );
  const gitHistoryCacheAccessRef = useRef(new Map<string, number>());
  const skipFreshGitHistoryRefreshRef = useRef(new Set<string>());
  const gitHistoryRefreshedThreadIdRef = useRef<number | null>(null);
  const activeGitHistoryCacheKey =
    selectedProject && activeSelectedWorktreePath
      ? worktreeKey(selectedProject.id, activeSelectedWorktreePath)
      : null;

  const abortGitHistoryRequests = useCallback((reason: string) => {
    const historyController = gitHistoryAbortControllerRef.current;
    if (historyController) {
      gitHistoryAbortControllerRef.current = null;
      historyController.abort(createAbortError(null, reason));
    }

    const loadMoreController = gitHistoryLoadMoreAbortControllerRef.current;
    if (loadMoreController) {
      gitHistoryLoadMoreAbortControllerRef.current = null;
      loadMoreController.abort(createAbortError(null, reason));
    }
  }, []);

  const abortGitHistoryDiffRequest = useCallback((reason: string) => {
    const controller = gitHistoryDiffAbortControllerRef.current;
    if (!controller) {
      return;
    }

    gitHistoryDiffAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const closeGitHistoryModal = useCallback(() => {
    gitHistoryDiffRequestIdRef.current += 1;
    abortGitHistoryDiffRequest("Commit diff request was cleared.");
    setGitHistoryModal(null);
  }, [abortGitHistoryDiffRequest]);

  const reportGitCacheTelemetry = useCallback((): void => {
    const telemetry: FrontendGitCacheTelemetry = {
      diffCacheBytes: estimateCacheBytes(
        gitHistoryDiffCacheRef.current,
        estimateGitHistoryDiffCacheEntryBytes,
      ),
      diffCacheEntries: gitHistoryDiffCacheRef.current.size,
      historyCacheBytes: estimateCacheBytes(
        gitHistoryCacheRef.current,
        estimateGitHistoryResultBytes,
      ),
      historyCacheEntries: gitHistoryCacheRef.current.size,
      pendingDiffRequests: gitHistoryDiffRequestCacheRef.current.size,
      skipFreshHistoryRefreshEntries:
        skipFreshGitHistoryRefreshRef.current.size,
    };
    updateFrontendGitCacheTelemetry(telemetry);
  }, []);

  const pruneCacheByByteBudget = useCallback(
    <TValue>(
      cache: Map<string, TValue>,
      estimateBytes: (value: TValue) => number,
      maxBytes: number,
      accessByKey?: Map<string, number>,
    ): void => {
      const totalBytes = (): number => {
        let bytes = 0;
        for (const value of cache.values()) {
          bytes += estimateBytes(value);
        }
        return bytes;
      };

      while (cache.size > 1 && totalBytes() > maxBytes) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) {
          return;
        }
        cache.delete(oldestKey);
        accessByKey?.delete(oldestKey);
      }
    },
    [],
  );

  const cacheGitHistoryResult = useCallback(
    (history: RpcWorktreeGitHistoryResult) => {
      const cachedHistory = trimGitHistoryResultEntries(history);
      const cacheKey = worktreeKey(
        cachedHistory.projectId,
        cachedHistory.worktreePath,
      );
      writeLruValue(
        gitHistoryCacheRef.current,
        cacheKey,
        cachedHistory,
        GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
      );
      touchGitHistoryCacheEntry(gitHistoryCacheAccessRef.current, cacheKey);
      pruneCacheByByteBudget(
        gitHistoryCacheRef.current,
        estimateGitHistoryResultBytes,
        GIT_HISTORY_RESULT_CACHE_MAX_BYTES,
        gitHistoryCacheAccessRef.current,
      );
      reportGitCacheTelemetry();
    },
    [pruneCacheByByteBudget, reportGitCacheTelemetry],
  );

  const primeGitHistoryResult = useCallback(
    (history: RpcWorktreeGitHistoryResult) => {
      cacheGitHistoryResult(history);
      skipFreshGitHistoryRefreshRef.current.add(
        worktreeKey(history.projectId, history.worktreePath),
      );
      reportGitCacheTelemetry();
    },
    [cacheGitHistoryResult, reportGitCacheTelemetry],
  );

  useEffect(() => {
    const pruneIdleCaches = (): void => {
      pruneIdleGitHistoryCacheEntries(
        gitHistoryCacheRef.current,
        gitHistoryCacheAccessRef.current,
        GIT_HISTORY_RESULT_CACHE_IDLE_TTL_MS,
      );
      pruneIdleGitHistoryCacheEntries(
        gitHistoryDiffCacheRef.current,
        gitHistoryDiffCacheAccessRef.current,
        GIT_HISTORY_DIFF_CACHE_IDLE_TTL_MS,
      );
      for (const cacheKey of skipFreshGitHistoryRefreshRef.current) {
        if (
          !gitHistoryCacheRef.current.has(cacheKey) ||
          (activeGitHistoryCacheKey !== null &&
            cacheKey !== activeGitHistoryCacheKey)
        ) {
          skipFreshGitHistoryRefreshRef.current.delete(cacheKey);
        }
      }
      reportGitCacheTelemetry();
    };

    pruneIdleCaches();
    const timer = window.setInterval(
      pruneIdleCaches,
      GIT_HISTORY_CACHE_PRUNE_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [activeGitHistoryCacheKey, reportGitCacheTelemetry]);

  const loadGitHistoryDiff = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      entry: RpcGitHistoryEntry,
      options?: {
        priority?: "background" | "default" | "foreground";
        signal?: AbortSignal;
      },
    ): Promise<GitHistoryDiffCacheEntry> => {
      const cacheKey = gitHistoryDiffCacheKey(
        projectId,
        worktreePath,
        entry.hash,
      );
      const cached = readLruValue(gitHistoryDiffCacheRef.current, cacheKey);
      if (cached) {
        touchGitHistoryCacheEntry(
          gitHistoryDiffCacheAccessRef.current,
          cacheKey,
        );
        reportGitCacheTelemetry();
        return Promise.resolve(cached);
      }

      const pending = gitHistoryDiffRequestCacheRef.current.get(cacheKey);
      if (pending) {
        pending.waiterCount += 1;
        try {
          return await awaitAbortableResult(
            pending.promise,
            options?.signal,
            "Commit diff read was aborted.",
          );
        } finally {
          pending.waiterCount = Math.max(0, pending.waiterCount - 1);
          if (
            pending.waiterCount === 0 &&
            gitHistoryDiffRequestCacheRef.current.get(cacheKey) === pending
          ) {
            pending.controller.abort(
              createAbortError(null, "Commit diff read was aborted."),
            );
          }
        }
      }

      const controller = new AbortController();
      const pendingRequest: PendingSharedRequest<GitHistoryDiffCacheEntry> = {
        controller,
        promise: Promise.resolve(null as never),
        waiterCount: 1,
      };
      const request = procedures
        .getWorktreeGitCommitDiff(
          {
            projectId,
            worktreePath,
            commitHash: entry.hash,
          },
          {
            priority: options?.priority ?? "foreground",
            signal: controller.signal,
          },
        )
        .then((result) => {
          const nextValue = {
            commit: result.commit,
            diffText: result.diffText,
          };
          writeLruValue(
            gitHistoryDiffCacheRef.current,
            cacheKey,
            nextValue,
            GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
          );
          touchGitHistoryCacheEntry(
            gitHistoryDiffCacheAccessRef.current,
            cacheKey,
          );
          pruneCacheByByteBudget(
            gitHistoryDiffCacheRef.current,
            estimateGitHistoryDiffCacheEntryBytes,
            GIT_HISTORY_DIFF_CACHE_MAX_BYTES,
            gitHistoryDiffCacheAccessRef.current,
          );
          reportGitCacheTelemetry();
          return nextValue;
        })
        .finally(() => {
          if (
            gitHistoryDiffRequestCacheRef.current.get(cacheKey) ===
            pendingRequest
          ) {
            gitHistoryDiffRequestCacheRef.current.delete(cacheKey);
            reportGitCacheTelemetry();
          }
        });
      pendingRequest.promise = request;
      gitHistoryDiffRequestCacheRef.current.set(cacheKey, pendingRequest);
      reportGitCacheTelemetry();

      try {
        return await awaitAbortableResult(
          request,
          options?.signal,
          "Commit diff read was aborted.",
        );
      } finally {
        pendingRequest.waiterCount = Math.max(
          0,
          pendingRequest.waiterCount - 1,
        );
        if (
          pendingRequest.waiterCount === 0 &&
          gitHistoryDiffRequestCacheRef.current.get(cacheKey) === pendingRequest
        ) {
          controller.abort(
            createAbortError(null, "Commit diff read was aborted."),
          );
        }
      }
    },
    [procedures, pruneCacheByByteBudget, reportGitCacheTelemetry],
  );

  const openGitHistoryDiff = useCallback(
    async (entry: RpcGitHistoryEntry) => {
      if (
        !selectedProject ||
        !activeSelectedWorktreePath ||
        activeSelectedWorktreeMissing
      ) {
        return;
      }

      const projectId = selectedProject.id;
      const worktreePath = activeSelectedWorktreePath;
      const cacheKey = gitHistoryDiffCacheKey(
        projectId,
        worktreePath,
        entry.hash,
      );
      const cached = readLruValue(gitHistoryDiffCacheRef.current, cacheKey);
      if (cached) {
        touchGitHistoryCacheEntry(
          gitHistoryDiffCacheAccessRef.current,
          cacheKey,
        );
        reportGitCacheTelemetry();
      }
      const requestId = gitHistoryDiffRequestIdRef.current + 1;
      gitHistoryDiffRequestIdRef.current = requestId;
      abortGitHistoryDiffRequest("Commit diff request was superseded.");

      setGitHistoryModal(
        createGitHistoryDiffModalOpenState({
          projectId,
          worktreePath,
          entry,
          cached,
        }),
      );

      if (cached) {
        return;
      }

      const controller = new AbortController();
      gitHistoryDiffAbortControllerRef.current = controller;
      try {
        const result = await loadGitHistoryDiff(
          projectId,
          worktreePath,
          entry,
          {
            priority: "foreground",
            signal: controller.signal,
          },
        );
        if (gitHistoryDiffRequestIdRef.current !== requestId) {
          return;
        }

        setGitHistoryModal((current) =>
          current &&
          current.projectId === projectId &&
          current.worktreePath === worktreePath &&
          current.entry.hash === entry.hash
            ? {
                ...current,
                entry: result.commit,
                diffText: result.diffText,
                loading: false,
                error: "",
              }
            : current,
        );
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (gitHistoryDiffRequestIdRef.current !== requestId) {
          return;
        }
        setGitHistoryModal((current) =>
          current &&
          current.projectId === projectId &&
          current.worktreePath === worktreePath &&
          current.entry.hash === entry.hash
            ? {
                ...current,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : current,
        );
      } finally {
        if (gitHistoryDiffAbortControllerRef.current === controller) {
          gitHistoryDiffAbortControllerRef.current = null;
        }
      }
    },
    [
      abortGitHistoryDiffRequest,
      activeSelectedWorktreeMissing,
      activeSelectedWorktreePath,
      loadGitHistoryDiff,
      reportGitCacheTelemetry,
      selectedProject,
    ],
  );

  const loadGitHistory = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      options?: {
        preferCached?: boolean;
        silent?: boolean;
        skipRefreshWhenCached?: boolean;
      },
    ): Promise<void> => {
      const requestId = ++gitHistoryRequestIdRef.current;
      abortGitHistoryRequests("Git history request was superseded.");
      const cacheKey = worktreeKey(projectId, worktreePath);
      const cachedHistory = readLruValue(gitHistoryCacheRef.current, cacheKey);
      if (cachedHistory) {
        touchGitHistoryCacheEntry(gitHistoryCacheAccessRef.current, cacheKey);
        reportGitCacheTelemetry();
      }
      const loadBehavior = resolveGitHistoryLoadBehavior({
        cachedHistory,
        preferCached: options?.preferCached === true,
        silent: options?.silent === true,
        skipRefreshWhenCached: options?.skipRefreshWhenCached === true,
      });
      if (loadBehavior.serveCachedHistory && cachedHistory) {
        setGitHistory(cachedHistory);
        setGitHistoryLoading(false);
        setGitHistoryLoadingMore(false);
        gitHistoryLoadingMoreRef.current = false;
        setGitHistoryError("");
      }
      if (loadBehavior.skipRefreshWhenCached) {
        gitHistoryAbortControllerRef.current = null;
        return;
      }

      const controller = new AbortController();
      gitHistoryAbortControllerRef.current = controller;
      if (!loadBehavior.silentRefresh) {
        setGitHistoryLoading(true);
        setGitHistoryError("");
      }

      try {
        const result = await procedures.listWorktreeGitHistory(
          {
            projectId,
            worktreePath,
            offset: 0,
            limit: GIT_HISTORY_PAGE_SIZE,
          },
          {
            priority: loadBehavior.silentRefresh ? "default" : "foreground",
            signal: controller.signal,
          },
        );
        if (gitHistoryRequestIdRef.current !== requestId) {
          return;
        }

        const nextHistory = mergeResetGitHistory(cachedHistory, result);
        setGitHistory(nextHistory);
        cacheGitHistoryResult(nextHistory);
        setGitHistoryError("");
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (gitHistoryRequestIdRef.current !== requestId) {
          return;
        }
        if (!loadBehavior.silentRefresh && !cachedHistory) {
          setGitHistory(null);
          setGitHistoryError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (gitHistoryAbortControllerRef.current === controller) {
          gitHistoryAbortControllerRef.current = null;
        }
        if (gitHistoryRequestIdRef.current === requestId) {
          setGitHistoryLoading(false);
          setGitHistoryLoadingMore(false);
          gitHistoryLoadingMoreRef.current = false;
        }
      }
    },
    [
      abortGitHistoryRequests,
      cacheGitHistoryResult,
      procedures,
      reportGitCacheTelemetry,
      setGitHistory,
      setGitHistoryError,
      setGitHistoryLoading,
      setGitHistoryLoadingMore,
    ],
  );

  const loadMoreGitHistory = useCallback(async (): Promise<void> => {
    if (
      !canLoadMoreGitHistory({
        activeSelectedWorktreePath,
        gitHistory,
        gitHistoryLoading,
        gitHistoryLoadingMore,
        hasPendingLoadMore: gitHistoryLoadingMoreRef.current,
        selectedProject,
      })
    ) {
      return;
    }

    const currentProject = selectedProject;
    const currentWorktreePath = activeSelectedWorktreePath;
    const currentHistory = gitHistory;
    if (
      !currentProject ||
      !currentWorktreePath ||
      !currentHistory ||
      currentHistory.nextOffset === null
    ) {
      return;
    }

    const requestId = gitHistoryRequestIdRef.current;
    const nextOffset = currentHistory.nextOffset;
    const expectedHeadHash = currentHistory.headHash;
    const expectedBranch = currentHistory.branch;
    const controller = new AbortController();
    if (gitHistoryLoadMoreAbortControllerRef.current) {
      gitHistoryLoadMoreAbortControllerRef.current.abort(
        createAbortError(
          null,
          "Git history pagination request was superseded.",
        ),
      );
    }
    gitHistoryLoadMoreAbortControllerRef.current = controller;

    gitHistoryLoadingMoreRef.current = true;
    setGitHistoryLoadingMore(true);

    try {
      const result = await procedures.listWorktreeGitHistory(
        {
          projectId: currentProject.id,
          worktreePath: currentWorktreePath,
          offset: nextOffset,
          limit: GIT_HISTORY_PAGE_SIZE,
        },
        {
          priority: "foreground",
          signal: controller.signal,
        },
      );
      if (gitHistoryRequestIdRef.current !== requestId) {
        return;
      }

      if (
        result.headHash !== expectedHeadHash ||
        result.branch !== expectedBranch
      ) {
        void loadGitHistory(currentProject.id, currentWorktreePath, {
          silent: true,
        });
        return;
      }

      const nextHistory = appendGitHistoryPage(currentHistory, result);
      setGitHistory((current) =>
        current &&
        current.projectId === nextHistory.projectId &&
        current.worktreePath === nextHistory.worktreePath
          ? nextHistory
          : current,
      );
      cacheGitHistoryResult(nextHistory);
      setGitHistoryError("");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      if (gitHistoryRequestIdRef.current !== requestId) {
        return;
      }
      setGitHistoryError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (gitHistoryLoadMoreAbortControllerRef.current === controller) {
        gitHistoryLoadMoreAbortControllerRef.current = null;
      }
      if (gitHistoryRequestIdRef.current === requestId) {
        setGitHistoryLoadingMore(false);
        gitHistoryLoadingMoreRef.current = false;
      }
    }
  }, [
    activeSelectedWorktreePath,
    cacheGitHistoryResult,
    gitHistory,
    gitHistoryLoading,
    gitHistoryLoadingMore,
    loadGitHistory,
    procedures,
    selectedProject,
    setGitHistory,
    setGitHistoryError,
    setGitHistoryLoadingMore,
  ]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      activeSelectedWorktreeMissing
    ) {
      gitHistoryRequestIdRef.current += 1;
      abortGitHistoryRequests("Git history request was cleared.");
      setGitHistory(null);
      setGitHistoryLoading(false);
      setGitHistoryLoadingMore(false);
      gitHistoryLoadingMoreRef.current = false;
      setGitHistoryError("");
      return;
    }
    const cacheKey = worktreeKey(
      selectedProject.id,
      activeSelectedWorktreePath,
    );
    void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
      preferCached: true,
      skipRefreshWhenCached:
        skipFreshGitHistoryRefreshRef.current.delete(cacheKey),
    });
  }, [
    activeSelectedWorktreeMissing,
    activeSelectedWorktreePath,
    abortGitHistoryRequests,
    loadGitHistory,
    selectedProject,
    sessionStateReady,
    setGitHistory,
    setGitHistoryError,
    setGitHistoryLoading,
    setGitHistoryLoadingMore,
  ]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }
    if (!selectedThread) {
      gitHistoryRefreshedThreadIdRef.current = null;
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      activeSelectedWorktreeMissing ||
      selectedThread.projectId !== selectedProject.id ||
      selectedThread.worktreePath !== activeSelectedWorktreePath
    ) {
      return;
    }
    if (gitHistoryRefreshedThreadIdRef.current === selectedThread.id) {
      return;
    }

    gitHistoryRefreshedThreadIdRef.current = selectedThread.id;
    void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
      preferCached: true,
    });
  }, [
    activeSelectedWorktreeMissing,
    activeSelectedWorktreePath,
    loadGitHistory,
    selectedProject,
    selectedThread,
    sessionStateReady,
  ]);

  useEffect(() => {
    const unsubscribe = subscribeToWorktreeGitHistoryChanged((payload) => {
      if (
        !selectedProject ||
        !activeSelectedWorktreePath ||
        activeSelectedWorktreeMissing
      ) {
        return;
      }
      if (
        payload.projectId !== selectedProject.id ||
        payload.worktreePath !== activeSelectedWorktreePath
      ) {
        return;
      }
      void loadGitHistory(payload.projectId, payload.worktreePath, {
        silent: true,
      });
    });
    return unsubscribe;
  }, [
    activeSelectedWorktreeMissing,
    activeSelectedWorktreePath,
    loadGitHistory,
    selectedProject,
  ]);

  useEffect(() => {
    if (!gitHistoryModal) {
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      activeSelectedWorktreeMissing ||
      gitHistoryModal.projectId !== selectedProject.id ||
      gitHistoryModal.worktreePath !== activeSelectedWorktreePath
    ) {
      closeGitHistoryModal();
    }
  }, [
    activeSelectedWorktreeMissing,
    activeSelectedWorktreePath,
    closeGitHistoryModal,
    gitHistoryModal,
    selectedProject,
  ]);

  useEffect(
    () => () => {
      abortGitHistoryRequests("Git history request was canceled.");
      gitHistoryDiffRequestIdRef.current += 1;
      abortGitHistoryDiffRequest("Commit diff request was cleared.");
    },
    [abortGitHistoryDiffRequest, abortGitHistoryRequests],
  );

  useEffect(() => {
    if (!gitHistoryModal) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeGitHistoryModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeGitHistoryModal, gitHistoryModal]);

  return {
    closeGitHistoryModal,
    gitHistoryModal,
    loadMoreGitHistory,
    openGitHistoryDiff,
    primeGitHistoryResult,
  };
}
