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
import { subscribeToWorktreeGitHistoryChanged } from "./invalidation-events";
import {
  appendGitHistoryPage,
  awaitAbortableResult,
  createAbortError,
  GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
  GIT_HISTORY_PAGE_SIZE,
  GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
  type GitHistoryDiffCacheEntry,
  type GitHistoryModalState,
  gitHistoryDiffCacheKey,
  isAbortError,
  mergeResetGitHistory,
  type PendingSharedRequest,
  readLruValue,
  worktreeKey,
  writeLruValue,
} from "./state";

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

type GitHistoryControllerProcedures = Pick<
  ProjectProcedures,
  "getWorktreeGitCommitDiff" | "listWorktreeGitHistory"
>;

export type UseGitHistoryControllerParams = {
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
  const gitHistoryDiffRequestCacheRef = useRef(
    new Map<string, PendingSharedRequest<GitHistoryDiffCacheEntry>>(),
  );
  const gitHistoryCacheRef = useRef(
    new Map<string, RpcWorktreeGitHistoryResult>(),
  );
  const skipFreshGitHistoryRefreshRef = useRef(new Set<string>());
  const gitHistoryRefreshedThreadIdRef = useRef<number | null>(null);

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

  const cacheGitHistoryResult = useCallback(
    (history: RpcWorktreeGitHistoryResult) => {
      writeLruValue(
        gitHistoryCacheRef.current,
        worktreeKey(history.projectId, history.worktreePath),
        history,
        GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
      );
    },
    [],
  );

  const primeGitHistoryResult = useCallback(
    (history: RpcWorktreeGitHistoryResult) => {
      cacheGitHistoryResult(history);
      skipFreshGitHistoryRefreshRef.current.add(
        worktreeKey(history.projectId, history.worktreePath),
      );
    },
    [cacheGitHistoryResult],
  );

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
          return nextValue;
        })
        .finally(() => {
          if (
            gitHistoryDiffRequestCacheRef.current.get(cacheKey) ===
            pendingRequest
          ) {
            gitHistoryDiffRequestCacheRef.current.delete(cacheKey);
          }
        });
      pendingRequest.promise = request;
      gitHistoryDiffRequestCacheRef.current.set(cacheKey, pendingRequest);

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
    [procedures],
  );

  const openGitHistoryDiff = useCallback(
    async (entry: RpcGitHistoryEntry) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
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
      const requestId = gitHistoryDiffRequestIdRef.current + 1;
      gitHistoryDiffRequestIdRef.current = requestId;
      abortGitHistoryDiffRequest("Commit diff request was superseded.");

      setGitHistoryModal({
        projectId,
        worktreePath,
        entry: cached?.commit ?? entry,
        diffText: cached?.diffText ?? "",
        loading: !cached,
        error: "",
      });

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
      activeSelectedWorktreePath,
      loadGitHistoryDiff,
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
    if (!selectedProject || !activeSelectedWorktreePath) {
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
    activeSelectedWorktreePath,
    loadGitHistory,
    selectedProject,
    selectedThread,
    sessionStateReady,
  ]);

  useEffect(() => {
    const unsubscribe = subscribeToWorktreeGitHistoryChanged((payload) => {
      if (!selectedProject || !activeSelectedWorktreePath) {
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
  }, [activeSelectedWorktreePath, loadGitHistory, selectedProject]);

  useEffect(() => {
    if (!gitHistoryModal) {
      return;
    }
    if (
      !selectedProject ||
      !activeSelectedWorktreePath ||
      gitHistoryModal.projectId !== selectedProject.id ||
      gitHistoryModal.worktreePath !== activeSelectedWorktreePath
    ) {
      closeGitHistoryModal();
    }
  }, [
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
