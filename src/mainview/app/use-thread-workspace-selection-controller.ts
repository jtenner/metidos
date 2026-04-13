/**
 * @file src/mainview/app/use-thread-workspace-selection-controller.ts
 * @description Thread/workspace selection and cross-workspace thread orchestration.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  ProjectProcedures,
  RpcContextFocusChanged,
  RpcProject,
  RpcReasoningEffort,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadRunStatus,
  RpcThreadStartRequest,
  RpcWorktree,
} from "../../bun/rpc-schema";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import { buildLoadedProjectWorktreesState } from "../project-worktree-refresh";
import {
  planSelectedWorktreeThreadSync,
  type SelectedWorktreeThreadSyncPlan,
} from "../thread-workspace-selection";
import {
  awaitAbortableResult,
  CONTEXT_FOCUS_CHANGED_EVENT_NAME,
  createAbortError,
  isAbortError,
  type OpenThreadOptions,
  type ProjectNodeState,
  preferredThreadForWorktree,
  primaryWorktreePath,
  projectStateWorktrees,
  type ThreadStore,
  type WorktreeNodeState,
  worktreeKey,
} from "./state";

type ThreadWorkspaceSelectionControllerProps = {
  abortThreadHistoryBackfill: (reason: string) => void;
  activeCodexModel: string;
  activeReasoningEffort: RpcReasoningEffort;
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
  ensureWorktreeOpen: (
    projectId: number,
    worktreePath: string,
  ) => Promise<void>;
  executeWithStepUp: <T>(
    actionLabel: string,
    action: () => Promise<T>,
  ) => Promise<T | null>;
  getProjectState: (projectId: number) => ProjectNodeState;
  getWorktreeState: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  loadProjectWorktrees: (
    projectId: number,
    loadOptions?: {
      backgroundRefresh?: boolean;
      preferCached?: boolean;
    },
  ) => Promise<RpcWorktree[]>;
  prepareOpenedThreadDetail: (detail: RpcThreadDetail) => RpcThreadDetail;
  procedures: ProjectProcedures;
  replaceSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
  safeChildAccessDefaults: ThreadAccessValue;
  selectProject: (project: RpcProject, worktreePath?: string | null) => void;
  isApprovingThreadStartRequest: boolean;
  isThreadLoading: boolean;
  selectedProjectId: number | null;
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedThread: RpcThread | null;
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
  selectedThreadId: number | null;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedThreadRunStateRef: MutableRefObject<RpcThreadRunStatus["state"]>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  sessionStateReady: boolean;
  setChatError: Dispatch<SetStateAction<string>>;
  setIsApprovingThreadStartRequest: Dispatch<SetStateAction<boolean>>;
  setIsCreatingThread: Dispatch<SetStateAction<boolean>>;
  setIsThreadLoading: Dispatch<SetStateAction<boolean>>;
  setMobileProjectListOpen: Dispatch<SetStateAction<boolean>>;
  setModelControlError: Dispatch<SetStateAction<string>>;
  setPrimaryView: Dispatch<SetStateAction<"chat" | "diff" | "cronjobs">>;
  setProjectState: (
    projectId: number,
    update: Partial<ProjectNodeState>,
  ) => void;
  setReasoningEffortControlError: Dispatch<SetStateAction<string>>;
  setSelectedProjectId: Dispatch<SetStateAction<number | null>>;
  setSelectedThreadId: Dispatch<SetStateAction<number | null>>;
  setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
  setThreadAccessControlError: Dispatch<SetStateAction<string>>;
  setThreadMessages: Dispatch<SetStateAction<RpcThreadMessage[]>>;
  setThreadsError: Dispatch<SetStateAction<string>>;
  setThreadStartRequestError: Dispatch<SetStateAction<string>>;
  setPendingThreadStartRequests: Dispatch<
    SetStateAction<RpcThreadStartRequest[]>
  >;
  threadStoreRef: MutableRefObject<ThreadStore>;
  threads: RpcThread[];
  upsertProject: (project: RpcProject) => void;
  upsertThread: (thread: RpcThread) => void;
};

function deriveSelectedWorktreeThreadSyncPlan(options: {
  projectId: number;
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  threadOpenInFlight: boolean;
  threads: RpcThread[];
  worktreeAutoCreationInFlight: boolean;
  worktreePath: string;
}): SelectedWorktreeThreadSyncPlan {
  const preferredThread = preferredThreadForWorktree(
    options.threads,
    options.projectId,
    options.worktreePath,
  );

  return planSelectedWorktreeThreadSync({
    preferredThreadId: preferredThread?.id ?? null,
    projectId: options.projectId,
    selectedProjectId: options.selectedProjectIdRef.current,
    selectedThreadId: options.selectedThreadIdRef.current,
    selectedWorktreePath: options.selectedWorktreePathRef.current,
    threadOpenInFlight: options.threadOpenInFlight,
    worktreeAutoCreationInFlight: options.worktreeAutoCreationInFlight,
    worktreePath: options.worktreePath,
  });
}

export function useThreadWorkspaceSelectionController({
  abortThreadHistoryBackfill,
  activeCodexModel,
  activeReasoningEffort,
  activeSelectedWorktreeOpened,
  activeSelectedWorktreePath,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  ensureWorktreeOpen,
  executeWithStepUp,
  getProjectState,
  getWorktreeState,
  loadProjectWorktrees,
  prepareOpenedThreadDetail,
  procedures,
  replaceSelectedThreadMessageHistory,
  safeChildAccessDefaults,
  selectProject,
  isApprovingThreadStartRequest,
  isThreadLoading,
  selectedProjectId,
  selectedProjectIdRef,
  selectedThread,
  selectedThreadDetailRefreshKeyRef,
  selectedThreadId,
  selectedThreadIdRef,
  selectedThreadRunStateRef,
  selectedWorktreePathRef,
  sessionStateReady,
  setChatError,
  setIsApprovingThreadStartRequest,
  setIsCreatingThread,
  setIsThreadLoading,
  setMobileProjectListOpen,
  setModelControlError,
  setPrimaryView,
  setProjectState,
  setReasoningEffortControlError,
  setSelectedProjectId,
  setSelectedThreadId,
  setSelectedWorktreePath,
  setThreadAccessControlError,
  setThreadMessages,
  setThreadsError,
  setThreadStartRequestError,
  setPendingThreadStartRequests,
  threadStoreRef,
  threads,
  upsertProject,
  upsertThread,
}: ThreadWorkspaceSelectionControllerProps) {
  const autoThreadCreationWorktreeKeysRef = useRef(new Set<string>());
  const threadCreationInFlightCountRef = useRef(0);
  const threadOpenAbortControllerRef = useRef<AbortController | null>(null);
  const threadOpenRequestIdRef = useRef(0);

  const syncThreadContext = useCallback(
    (thread: RpcThread) => {
      selectedProjectIdRef.current = thread.projectId;
      selectedWorktreePathRef.current = thread.worktreePath;
      setSelectedProjectId(thread.projectId);
      setSelectedWorktreePath(thread.worktreePath);
    },
    [
      selectedProjectIdRef,
      selectedWorktreePathRef,
      setSelectedProjectId,
      setSelectedWorktreePath,
    ],
  );

  const applyOpenedThreadDetail = useCallback(
    (detail: RpcThreadDetail) => {
      upsertThread(detail.thread);
      setSelectedThreadId(detail.thread.id);
      selectedThreadIdRef.current = detail.thread.id;
      selectedThreadRunStateRef.current = detail.thread.runStatus.state;
      replaceSelectedThreadMessageHistory(detail);
      syncThreadContext(detail.thread);
      if (sessionStateReady) {
        void loadProjectWorktrees(detail.thread.projectId).catch(() => {
          // Keep rendering the selected thread even if metadata refresh fails.
        });
      }
      setMobileProjectListOpen(false);
    },
    [
      loadProjectWorktrees,
      replaceSelectedThreadMessageHistory,
      selectedThreadIdRef,
      selectedThreadRunStateRef,
      sessionStateReady,
      setMobileProjectListOpen,
      setSelectedThreadId,
      syncThreadContext,
      upsertThread,
    ],
  );

  const dismissThreadStartRequest = useCallback(
    (requestId: string) => {
      setPendingThreadStartRequests((current) =>
        current.filter((request) => request.requestId !== requestId),
      );
      setThreadStartRequestError("");
    },
    [setPendingThreadStartRequests, setThreadStartRequestError],
  );

  const abortThreadOpenRequest = useCallback((reason: string) => {
    const controller = threadOpenAbortControllerRef.current;
    if (!controller) {
      return;
    }

    threadOpenAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const clearThreadSelection = useCallback(() => {
    threadOpenRequestIdRef.current += 1;
    abortThreadOpenRequest("Thread selection was cleared.");
    abortThreadHistoryBackfill("Thread selection was cleared.");
    setSelectedThreadId(null);
    setThreadMessages([]);
    setChatError("");
    setModelControlError("");
    setIsThreadLoading(false);
    selectedThreadIdRef.current = null;
    selectedThreadRunStateRef.current = "idle";
    selectedThreadDetailRefreshKeyRef.current = null;
  }, [
    abortThreadHistoryBackfill,
    abortThreadOpenRequest,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadIdRef,
    selectedThreadRunStateRef,
    setChatError,
    setIsThreadLoading,
    setModelControlError,
    setSelectedThreadId,
    setThreadMessages,
  ]);

  const createThreadForWorktree = useCallback(
    async (
      projectId: number,
      worktreePath: string,
      options?: {
        requireNoSelectedThread?: boolean;
      },
    ): Promise<RpcThreadDetail | null> => {
      threadCreationInFlightCountRef.current += 1;
      setIsCreatingThread(true);
      setThreadsError("");
      setModelControlError("");
      setReasoningEffortControlError("");
      setThreadAccessControlError("");
      setChatError("");
      try {
        const detail = await executeWithStepUp(
          "create a thread outside the current workspace",
          () =>
            procedures.createThread({
              projectId,
              worktreePath,
              currentProjectId: selectedProjectIdRef.current,
              currentWorktreePath: selectedWorktreePathRef.current,
              model: activeCodexModel || defaultCodexModel || null,
              reasoningEffort:
                activeReasoningEffort || defaultCodexReasoningEffort || null,
              webSearchAccess: safeChildAccessDefaults.webSearchAccess,
              githubAccess: safeChildAccessDefaults.githubAccess,
              agentsAccess: safeChildAccessDefaults.agentsAccess,
              metidosAccess: safeChildAccessDefaults.metidosAccess,
              unsafeMode: safeChildAccessDefaults.unsafeMode,
            }),
        );
        if (!detail) {
          return null;
        }
        const isActiveSelection =
          selectedProjectIdRef.current === projectId &&
          selectedWorktreePathRef.current === worktreePath;
        const canApplySelection =
          !options?.requireNoSelectedThread ||
          (selectedThreadIdRef.current === null &&
            threadOpenAbortControllerRef.current === null);
        if (!isActiveSelection || !canApplySelection) {
          void procedures
            .discardEmptyThread({
              threadId: detail.thread.id,
            })
            .catch(() => {
              // Ignore cleanup failures for stale auto-created threads.
            });
          return null;
        }

        upsertThread(detail.thread);
        setSelectedThreadId(detail.thread.id);
        selectedThreadIdRef.current = detail.thread.id;
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        setThreadMessages(detail.messages);
        syncThreadContext(detail.thread);
        setPrimaryView("chat");
        setMobileProjectListOpen(false);
        try {
          await loadProjectWorktrees(detail.thread.projectId);
        } catch {
          // Ignore worktree refresh failures; the new thread is still usable.
        }
        return detail;
      } catch (error) {
        if (
          selectedProjectIdRef.current === projectId &&
          selectedWorktreePathRef.current === worktreePath
        ) {
          setThreadsError(
            error instanceof Error ? error.message : String(error),
          );
        }
        return null;
      } finally {
        threadCreationInFlightCountRef.current = Math.max(
          0,
          threadCreationInFlightCountRef.current - 1,
        );
        setIsCreatingThread(threadCreationInFlightCountRef.current > 0);
      }
    },
    [
      activeCodexModel,
      activeReasoningEffort,
      defaultCodexModel,
      defaultCodexReasoningEffort,
      executeWithStepUp,
      loadProjectWorktrees,
      procedures,
      safeChildAccessDefaults,
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedThreadRunStateRef,
      selectedWorktreePathRef,
      setChatError,
      setIsCreatingThread,
      setMobileProjectListOpen,
      setModelControlError,
      setPrimaryView,
      setReasoningEffortControlError,
      setSelectedThreadId,
      setThreadAccessControlError,
      setThreadMessages,
      setThreadsError,
      syncThreadContext,
      upsertThread,
    ],
  );

  const approveThreadStartRequest = useCallback(
    async (request: RpcThreadStartRequest) => {
      if (isApprovingThreadStartRequest) {
        return;
      }

      threadCreationInFlightCountRef.current += 1;
      setIsCreatingThread(true);
      setIsApprovingThreadStartRequest(true);
      setThreadStartRequestError("");
      setThreadsError("");
      setModelControlError("");
      setReasoningEffortControlError("");
      setThreadAccessControlError("");
      setChatError("");

      let createdDetail: RpcThreadDetail | null = null;
      try {
        createdDetail = await executeWithStepUp(
          "create a thread outside the current workspace",
          () =>
            procedures.createThread({
              projectId: request.projectId,
              worktreePath: request.worktreePath,
              currentProjectId: selectedProjectIdRef.current,
              currentWorktreePath: selectedWorktreePathRef.current,
              model: request.model,
              reasoningEffort: request.reasoningEffort,
              webSearchAccess: request.webSearchAccess,
              githubAccess: request.githubAccess,
              agentsAccess: request.agentsAccess,
              metidosAccess: request.metidosAccess,
              unsafeMode: request.unsafeMode,
            }),
        );
        if (!createdDetail) {
          return;
        }

        const finalDetail =
          request.input.trim().length > 0
            ? await procedures.sendThreadMessage({
                threadId: createdDetail.thread.id,
                input: request.input,
              })
            : createdDetail;

        applyOpenedThreadDetail(finalDetail);
        dismissThreadStartRequest(request.requestId);
      } catch (error) {
        if (createdDetail) {
          applyOpenedThreadDetail(createdDetail);
        }
        const message = error instanceof Error ? error.message : String(error);
        setThreadStartRequestError(message);
        setThreadsError(message);
      } finally {
        setIsApprovingThreadStartRequest(false);
        threadCreationInFlightCountRef.current = Math.max(
          0,
          threadCreationInFlightCountRef.current - 1,
        );
        setIsCreatingThread(threadCreationInFlightCountRef.current > 0);
      }
    },
    [
      applyOpenedThreadDetail,
      dismissThreadStartRequest,
      executeWithStepUp,
      procedures,
      selectedProjectIdRef,
      selectedWorktreePathRef,
      isApprovingThreadStartRequest,
      setChatError,
      setIsApprovingThreadStartRequest,
      setIsCreatingThread,
      setModelControlError,
      setReasoningEffortControlError,
      setThreadAccessControlError,
      setThreadsError,
      setThreadStartRequestError,
    ],
  );

  const loadThreadDetailForOpen = useCallback(
    async (
      threadId: number,
      signal: AbortSignal,
      options?: OpenThreadOptions,
    ): Promise<RpcThreadDetail> => {
      const prefetchedDetail = options?.detailPromise
        ? await awaitAbortableResult(
            options.detailPromise.catch(() => null),
            signal,
            "Thread open request was aborted.",
          )
        : null;
      if (prefetchedDetail) {
        return prefetchedDetail;
      }

      return procedures.getThread(
        { threadId },
        {
          priority: "foreground",
          signal,
        },
      );
    },
    [procedures],
  );

  const openThread = useCallback(
    async (threadId: number, options?: OpenThreadOptions) => {
      const requestId = ++threadOpenRequestIdRef.current;
      const optimisticThread = threadStoreRef.current.byId[threadId] ?? null;
      abortThreadOpenRequest("Thread open request was superseded.");
      abortThreadHistoryBackfill("Thread open request was superseded.");
      const controller = new AbortController();
      threadOpenAbortControllerRef.current = controller;
      setSelectedThreadId(threadId);
      selectedThreadIdRef.current = threadId;
      selectedThreadRunStateRef.current =
        optimisticThread?.runStatus.state ?? "idle";
      selectedThreadDetailRefreshKeyRef.current = null;
      setThreadMessages([]);
      if (optimisticThread) {
        syncThreadContext(optimisticThread);
      }
      setMobileProjectListOpen(false);
      setIsThreadLoading(true);
      setThreadsError("");
      setChatError("");
      setModelControlError("");
      try {
        const detail = prepareOpenedThreadDetail(
          await loadThreadDetailForOpen(threadId, controller.signal, options),
        );
        if (threadOpenRequestIdRef.current !== requestId) {
          return;
        }
        if (
          options?.selectionGuard &&
          (selectedProjectIdRef.current !== options.selectionGuard.projectId ||
            selectedWorktreePathRef.current !==
              options.selectionGuard.worktreePath)
        ) {
          upsertThread(detail.thread);
          return;
        }
        applyOpenedThreadDetail(detail);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (threadOpenRequestIdRef.current !== requestId) {
          return;
        }
        setThreadsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (threadOpenAbortControllerRef.current === controller) {
          threadOpenAbortControllerRef.current = null;
        }
        if (threadOpenRequestIdRef.current === requestId) {
          setIsThreadLoading(false);
        }
      }
    },
    [
      abortThreadHistoryBackfill,
      abortThreadOpenRequest,
      applyOpenedThreadDetail,
      loadThreadDetailForOpen,
      prepareOpenedThreadDetail,
      selectedProjectIdRef,
      selectedThreadDetailRefreshKeyRef,
      selectedThreadIdRef,
      selectedThreadRunStateRef,
      selectedWorktreePathRef,
      setChatError,
      setIsThreadLoading,
      setMobileProjectListOpen,
      setModelControlError,
      setSelectedThreadId,
      setThreadMessages,
      setThreadsError,
      syncThreadContext,
      threadStoreRef,
      upsertThread,
    ],
  );

  const syncSelectedWorktreeThread = useCallback(
    (projectId: number, worktreePath: string): void => {
      const key = worktreeKey(projectId, worktreePath);
      const plan = deriveSelectedWorktreeThreadSyncPlan({
        projectId,
        selectedProjectIdRef,
        selectedThreadIdRef,
        selectedWorktreePathRef,
        threadOpenInFlight: threadOpenAbortControllerRef.current !== null,
        threads,
        worktreeAutoCreationInFlight:
          autoThreadCreationWorktreeKeysRef.current.has(key),
        worktreePath,
      });

      if (plan.action === "open-thread") {
        void openThread(plan.threadId, {
          selectionGuard: {
            projectId,
            worktreePath,
          },
        });
        return;
      }

      if (plan.action !== "create-thread") {
        return;
      }

      autoThreadCreationWorktreeKeysRef.current.add(key);
      void createThreadForWorktree(projectId, worktreePath, {
        requireNoSelectedThread: true,
      }).finally(() => {
        autoThreadCreationWorktreeKeysRef.current.delete(key);
      });
    },
    [
      createThreadForWorktree,
      openThread,
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedWorktreePathRef,
      threads,
    ],
  );

  const handleProjectWorktreeClick = useCallback(
    (project: RpcProject, worktreePath: string) => {
      setThreadsError("");
      void (async () => {
        let resolvedProject = project;
        let resolvedProjectId = project.id;
        const projectState = getProjectState(project.id);
        if (
          project.isOpen !== 1 ||
          projectStateWorktrees(projectState).length === 0
        ) {
          try {
            const openedProject = await procedures.openProject(
              {
                name: project.name,
                projectPath: project.path,
              },
              {
                priority: "foreground",
              },
            );
            upsertProject(openedProject.project);
            setProjectState(
              openedProject.project.id,
              buildLoadedProjectWorktreesState(openedProject.worktrees),
            );
            resolvedProject = openedProject.project;
            resolvedProjectId = openedProject.project.id;
          } catch (error) {
            setThreadsError(
              error instanceof Error ? error.message : String(error),
            );
            return;
          }
        }

        const target = getWorktreeState(resolvedProjectId, worktreePath);
        const alreadySelected =
          selectedProjectIdRef.current === resolvedProjectId &&
          selectedWorktreePathRef.current === worktreePath;
        if (!alreadySelected) {
          clearThreadSelection();
          selectProject(resolvedProject, worktreePath);
        }
        syncSelectedWorktreeThread(resolvedProjectId, worktreePath);
        if (target.opened || target.loading) {
          return;
        }
        await ensureWorktreeOpen(resolvedProjectId, worktreePath);
      })();
    },
    [
      clearThreadSelection,
      ensureWorktreeOpen,
      getProjectState,
      getWorktreeState,
      procedures,
      selectProject,
      selectedProjectIdRef,
      selectedWorktreePathRef,
      setProjectState,
      setThreadsError,
      syncSelectedWorktreeThread,
      upsertProject,
    ],
  );

  useEffect(() => {
    const handleContextFocusChanged = (
      event: CustomEvent<RpcContextFocusChanged>,
    ) => {
      if (!sessionStateReady) {
        return;
      }

      const payload = event.detail;
      void (async () => {
        try {
          const openedProject = await procedures.openProject(
            {
              projectPath: payload.projectPath,
              name: payload.projectName,
            },
            {
              priority: "foreground",
            },
          );
          upsertProject(openedProject.project);
          setProjectState(
            openedProject.project.id,
            buildLoadedProjectWorktreesState(openedProject.worktrees),
          );

          const targetWorktreePath =
            payload.worktreePath ??
            primaryWorktreePath(openedProject.project, openedProject.worktrees);
          selectProject(openedProject.project, targetWorktreePath);
          await ensureWorktreeOpen(
            openedProject.project.id,
            targetWorktreePath,
          );

          if (payload.threadId !== null) {
            await openThread(payload.threadId);
          }
        } catch (error) {
          console.error("Failed to apply focused Metidos context", error);
        }
      })();
    };

    window.addEventListener(
      CONTEXT_FOCUS_CHANGED_EVENT_NAME,
      handleContextFocusChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        CONTEXT_FOCUS_CHANGED_EVENT_NAME,
        handleContextFocusChanged as EventListener,
      );
    };
  }, [
    ensureWorktreeOpen,
    openThread,
    procedures,
    selectProject,
    sessionStateReady,
    setProjectState,
    upsertProject,
  ]);

  useEffect(() => {
    if (
      !selectedProjectId ||
      !activeSelectedWorktreePath ||
      !activeSelectedWorktreeOpened ||
      isThreadLoading
    ) {
      return;
    }
    if (
      selectedThread &&
      selectedThread.projectId === selectedProjectId &&
      selectedThread.worktreePath === activeSelectedWorktreePath
    ) {
      return;
    }

    const preferredThread = preferredThreadForWorktree(
      threads,
      selectedProjectId,
      activeSelectedWorktreePath,
    );
    if (!preferredThread) {
      if (selectedThreadId !== null) {
        clearThreadSelection();
      }
      syncSelectedWorktreeThread(selectedProjectId, activeSelectedWorktreePath);
      return;
    }
    if (selectedThreadId === preferredThread.id) {
      return;
    }
    syncSelectedWorktreeThread(selectedProjectId, activeSelectedWorktreePath);
  }, [
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    clearThreadSelection,
    isThreadLoading,
    selectedProjectId,
    selectedThread,
    selectedThreadId,
    syncSelectedWorktreeThread,
    threads,
  ]);

  useEffect(() => {
    if (!selectedThreadId || selectedThread || isThreadLoading) {
      return;
    }
    if (threads[0]) {
      void openThread(threads[0].id);
      return;
    }
    clearThreadSelection();
  }, [
    clearThreadSelection,
    isThreadLoading,
    openThread,
    selectedThread,
    selectedThreadId,
    threads,
  ]);

  return {
    approveThreadStartRequest,
    clearThreadSelection,
    createThreadForWorktree,
    dismissThreadStartRequest,
    handleProjectWorktreeClick,
    openThread,
  };
}
