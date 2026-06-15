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
import { logClientError } from "../client-logging";
import {
  chatComposerDraftKey,
  migrateChatComposerDraftKey,
} from "../controls/chat-composer-draft-store";
import { migrateChatComposerImageAttachmentKey } from "../controls/chat-composer-image-attachments";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import { buildLoadedProjectWorktreesState } from "../project-worktree-refresh";
import type {
  MainviewPrimaryView,
  SelectedWorktreeThreadSyncPlan,
} from "../thread-workspace-selection";
import { deriveSelectedWorktreeThreadSyncPlan } from "../thread-workspace-selection-controller";
import {
  awaitAbortableResult,
  createAbortError,
  isAbortError,
} from "./async-request-state";
import {
  type ProjectNodeState,
  primaryWorktreePath,
  projectStateWorktrees,
  type WorktreeNodeState,
  worktreeKey,
} from "./project-worktree-state";
import { preferredThreadForWorktree, type ThreadStore } from "./thread-store";
import { retainRecentThreadMessages } from "./thread-message-retention";
import {
  CONTEXT_FOCUS_CHANGED_EVENT_NAME,
  type OpenThreadOptions,
} from "./thread-ui-state";

export type ThreadWorkspaceSelectionActions = {
  abortThreadHistoryBackfill: (reason: string) => void;
  ensureWorktreeOpen: (
    projectId: number,
    worktreePath: string,
  ) => Promise<void>;
  executeRpcAction: <T>(
    actionLabel: string,
    action: () => Promise<T>,
  ) => Promise<T | null>;
  loadProjectWorktrees: (
    projectId: number,
    loadOptions?: {
      backgroundRefresh?: boolean;
      preferCached?: boolean;
    },
  ) => Promise<RpcWorktree[]>;
  prepareOpenedThreadDetail: (detail: RpcThreadDetail) => RpcThreadDetail;
  replaceSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
  removeThread: (threadId: number) => void;
  selectProject: (project: RpcProject, worktreePath?: string | null) => void;
  upsertProject: (project: RpcProject) => void;
  upsertThread: (thread: RpcThread) => void;
};

export type ThreadWorkspaceSelectionModelDefaults = {
  activeCodexModel: string;
  activeModelProviderAvailable: boolean;
  activeReasoningEffort: RpcReasoningEffort;
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
};

export type ThreadWorkspaceSelectionStateSnapshot = {
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  isApprovingThreadStartRequest: boolean;
  isThreadLoading: boolean;
  selectedProjectId: number | null;
  selectedThread: RpcThread | null;
  selectedThreadId: number | null;
  sessionStateReady: boolean;
};

export type ThreadWorkspaceSelectionRefs = {
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedThreadRunStateRef: MutableRefObject<RpcThreadRunStatus["state"]>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  threadStoreRef: MutableRefObject<ThreadStore>;
};

export type ThreadWorkspaceSelectionSetters = {
  setChatError: Dispatch<SetStateAction<string>>;
  setIsApprovingThreadStartRequest: Dispatch<SetStateAction<boolean>>;
  setIsCreatingThread: Dispatch<SetStateAction<boolean>>;
  setIsThreadLoading: Dispatch<SetStateAction<boolean>>;
  setMobileProjectListOpen: Dispatch<SetStateAction<boolean>>;
  setModelControlError: Dispatch<SetStateAction<string>>;
  setPrimaryView: Dispatch<SetStateAction<MainviewPrimaryView>>;
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
};

export type ThreadWorkspaceSelectionThreads = {
  safeChildAccessDefaults: ThreadAccessValue;
  threads: RpcThread[];
};

export type ThreadWorkspaceSelectionControllerProps = {
  actions: ThreadWorkspaceSelectionActions;
  modelDefaults: ThreadWorkspaceSelectionModelDefaults;
  procedures: ProjectProcedures;
  projectState: {
    getProjectState: (projectId: number) => ProjectNodeState;
    getWorktreeState: (
      projectId: number,
      worktreePath: string,
    ) => WorktreeNodeState;
    setProjectState: (
      projectId: number,
      update: Partial<ProjectNodeState>,
    ) => void;
  };
  refs: ThreadWorkspaceSelectionRefs;
  selection: ThreadWorkspaceSelectionStateSnapshot;
  setters: ThreadWorkspaceSelectionSetters;
  threads: ThreadWorkspaceSelectionThreads;
};

export function resolveSelectedWorktreeThreadSyncPlanForModel(
  plan: SelectedWorktreeThreadSyncPlan,
  options: { activeModelProviderAvailable: boolean },
): SelectedWorktreeThreadSyncPlan {
  if (
    plan.action === "create-thread" &&
    !options.activeModelProviderAvailable
  ) {
    return { action: "noop" };
  }
  return plan;
}

export type ThreadWorkspaceSelectionController = {
  approveThreadStartRequest: (request: RpcThreadStartRequest) => Promise<void>;
  clearThreadSelection: () => void;
  createThreadForWorktree: (
    projectId: number,
    worktreePath: string,
    options?: { requireNoSelectedThread?: boolean },
  ) => Promise<RpcThreadDetail | null>;
  dismissThreadStartRequest: (requestId: string) => void;
  handleProjectWorktreeClick: (
    project: RpcProject,
    worktreePath: string,
  ) => Promise<void>;
  openThread: (threadId: number, options?: OpenThreadOptions) => Promise<void>;
};

export function useThreadWorkspaceSelectionController({
  actions,
  modelDefaults,
  procedures,
  projectState,
  refs,
  selection,
  setters,
  threads: threadSelection,
}: ThreadWorkspaceSelectionControllerProps): ThreadWorkspaceSelectionController {
  const {
    abortThreadHistoryBackfill,
    ensureWorktreeOpen,
    executeRpcAction,
    loadProjectWorktrees,
    prepareOpenedThreadDetail,
    replaceSelectedThreadMessageHistory,
    removeThread,
    selectProject,
    upsertProject,
    upsertThread,
  } = actions;
  const {
    activeCodexModel,
    activeModelProviderAvailable,
    activeReasoningEffort,
    defaultCodexModel,
    defaultCodexReasoningEffort,
  } = modelDefaults;
  const { getProjectState, getWorktreeState, setProjectState } = projectState;
  const {
    selectedProjectIdRef,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadIdRef,
    selectedThreadRunStateRef,
    selectedWorktreePathRef,
    threadStoreRef,
  } = refs;
  const {
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    isApprovingThreadStartRequest,
    isThreadLoading,
    selectedProjectId,
    selectedThread,
    selectedThreadId,
    sessionStateReady,
  } = selection;
  const {
    setChatError,
    setIsApprovingThreadStartRequest,
    setIsCreatingThread,
    setIsThreadLoading,
    setMobileProjectListOpen,
    setModelControlError,
    setPendingThreadStartRequests,
    setPrimaryView,
    setReasoningEffortControlError,
    setSelectedProjectId,
    setSelectedThreadId,
    setSelectedWorktreePath,
    setThreadAccessControlError,
    setThreadMessages,
    setThreadsError,
    setThreadStartRequestError,
  } = setters;
  const { safeChildAccessDefaults, threads } = threadSelection;
  const autoThreadCreationWorktreeKeysRef = useRef(new Set<string>());
  const threadCreationPromisesByWorktreeKeyRef = useRef(
    new Map<string, Promise<RpcThreadDetail | null>>(),
  );
  const optimisticThreadIdRef = useRef(-1);
  const projectWorktreeClickRequestIdRef = useRef(0);
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
    (
      projectId: number,
      worktreePath: string,
      options?: {
        requireNoSelectedThread?: boolean;
      },
    ): Promise<RpcThreadDetail | null> => {
      const creationKey = worktreeKey(projectId, worktreePath);
      const existingRequest =
        threadCreationPromisesByWorktreeKeyRef.current.get(creationKey);
      if (existingRequest) {
        return existingRequest;
      }

      const request = (async (): Promise<RpcThreadDetail | null> => {
        threadCreationInFlightCountRef.current += 1;
        setIsCreatingThread(true);
        setThreadsError("");
        setModelControlError("");
        setReasoningEffortControlError("");
        setThreadAccessControlError("");
        setChatError("");
        const optimisticThreadId = optimisticThreadIdRef.current--;
        const optimisticCreatedAt = new Date().toISOString();
        const optimisticThread: RpcThread = {
          id: optimisticThreadId,
          projectId,
          worktreePath,
          title: "New thread",
          summary: null,
          model: activeCodexModel || defaultCodexModel || "",
          reasoningEffort:
            activeReasoningEffort || defaultCodexReasoningEffort || "medium",
          permissions: safeChildAccessDefaults.permissions ?? [],
          webSearchAccess: safeChildAccessDefaults.webSearchAccess,
          githubAccess: safeChildAccessDefaults.githubAccess,
          gitAccess: safeChildAccessDefaults.gitAccess,
          sqliteAccess: safeChildAccessDefaults.sqliteAccess,
          webServerAccess: safeChildAccessDefaults.webServerAccess ?? false,
          agentsAccess: safeChildAccessDefaults.agentsAccess,
          calendarAccess: safeChildAccessDefaults.calendarAccess ?? false,
          notificationsAccess:
            safeChildAccessDefaults.notificationsAccess ?? false,
          threadsAccess:
            safeChildAccessDefaults.threadsAccess ??
            safeChildAccessDefaults.metidosAccess,
          cronsAccess:
            safeChildAccessDefaults.cronsAccess ??
            safeChildAccessDefaults.metidosAccess,
          metidosAccess: safeChildAccessDefaults.metidosAccess,
          unsafeMode: safeChildAccessDefaults.unsafeMode,
          piSessionId: null,
          piSessionFile: null,
          piLeafEntryId: null,
          pinnedAt: null,
          createdAt: optimisticCreatedAt,
          updatedAt: optimisticCreatedAt,
          lastRunAt: null,
          usage: null,
          compaction: {
            estimatedTriggerTokens: 0,
            estimatedTriggerSource: "heuristic",
            maxObservedInputTokens: null,
            inferredCount: 0,
            lastInferredAt: null,
            lastInferredBeforeInputTokens: null,
            lastInferredAfterInputTokens: null,
          },
          runStatus: {
            state: "idle",
            startedAt: null,
            updatedAt: null,
            error: null,
            hasUnreadError: false,
          },
        };
        const previousSelectedThreadId = selectedThreadIdRef.current;
        const canApplyOptimisticSelection =
          selectedProjectIdRef.current === projectId &&
          selectedWorktreePathRef.current === worktreePath &&
          (!options?.requireNoSelectedThread ||
            (previousSelectedThreadId === null &&
              threadOpenAbortControllerRef.current === null));
        if (canApplyOptimisticSelection) {
          if (
            previousSelectedThreadId === null ||
            previousSelectedThreadId < 0
          ) {
            migrateChatComposerDraftKey(
              chatComposerDraftKey(previousSelectedThreadId),
              chatComposerDraftKey(optimisticThread.id),
            );
            migrateChatComposerImageAttachmentKey(
              chatComposerDraftKey(previousSelectedThreadId),
              chatComposerDraftKey(optimisticThread.id),
            );
          }
          upsertThread(optimisticThread);
          setSelectedThreadId(optimisticThread.id);
          selectedThreadIdRef.current = optimisticThread.id;
          selectedThreadRunStateRef.current = optimisticThread.runStatus.state;
          setThreadMessages([]);
          syncThreadContext(optimisticThread);
          setPrimaryView("chat");
          setMobileProjectListOpen(false);
        }
        try {
          const detail = await executeRpcAction(
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
                permissions: safeChildAccessDefaults.permissions ?? [],
              }),
          );
          if (!detail) {
            if (canApplyOptimisticSelection) {
              removeThread(optimisticThreadId);
              if (selectedThreadIdRef.current === optimisticThreadId) {
                setSelectedThreadId(null);
                selectedThreadIdRef.current = null;
                selectedThreadRunStateRef.current = "idle";
                setThreadMessages([]);
              }
            }
            return null;
          }
          const isActiveSelection =
            selectedProjectIdRef.current === projectId &&
            selectedWorktreePathRef.current === worktreePath;
          const canApplySelection =
            !options?.requireNoSelectedThread ||
            ((selectedThreadIdRef.current === null ||
              selectedThreadIdRef.current === optimisticThreadId) &&
              threadOpenAbortControllerRef.current === null);
          if (!isActiveSelection || !canApplySelection) {
            if (canApplyOptimisticSelection) {
              removeThread(optimisticThreadId);
            }
            void procedures
              .discardEmptyThread({
                threadId: detail.thread.id,
              })
              .catch(() => {
                // Ignore cleanup failures for stale auto-created threads.
              });
            return null;
          }

          if (canApplyOptimisticSelection) {
            migrateChatComposerDraftKey(
              chatComposerDraftKey(optimisticThreadId),
              chatComposerDraftKey(detail.thread.id),
            );
            migrateChatComposerImageAttachmentKey(
              chatComposerDraftKey(optimisticThreadId),
              chatComposerDraftKey(detail.thread.id),
            );
            removeThread(optimisticThreadId);
          }
          upsertThread(detail.thread);
          setSelectedThreadId(detail.thread.id);
          selectedThreadIdRef.current = detail.thread.id;
          selectedThreadRunStateRef.current = detail.thread.runStatus.state;
          setThreadMessages(retainRecentThreadMessages(detail.messages));
          syncThreadContext(detail.thread);
          setPrimaryView("chat");
          setMobileProjectListOpen(false);
          void loadProjectWorktrees(detail.thread.projectId).catch(() => {
            // Ignore worktree refresh failures; the new thread is still usable.
          });
          return detail;
        } catch (error) {
          if (canApplyOptimisticSelection) {
            removeThread(optimisticThreadId);
            if (selectedThreadIdRef.current === optimisticThreadId) {
              setSelectedThreadId(null);
              selectedThreadIdRef.current = null;
              selectedThreadRunStateRef.current = "idle";
              setThreadMessages([]);
            }
          }
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
      })();
      threadCreationPromisesByWorktreeKeyRef.current.set(creationKey, request);
      void request.finally(() => {
        if (
          threadCreationPromisesByWorktreeKeyRef.current.get(creationKey) ===
          request
        ) {
          threadCreationPromisesByWorktreeKeyRef.current.delete(creationKey);
        }
      });
      return request;
    },
    [
      activeCodexModel,
      activeReasoningEffort,
      defaultCodexModel,
      defaultCodexReasoningEffort,
      executeRpcAction,
      loadProjectWorktrees,
      procedures,
      removeThread,
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
        createdDetail = await procedures.approveThreadStartRequest({
          requestId: request.requestId,
        });

        const finalDetail =
          request.autoStart === true || request.input.trim().length === 0
            ? createdDetail
            : await procedures.sendThreadMessage({
                threadId: createdDetail.thread.id,
                input: request.input,
              });

        applyOpenedThreadDetail(finalDetail);
        dismissThreadStartRequest(request.requestId);
      } catch (error) {
        if (createdDetail) {
          applyOpenedThreadDetail(createdDetail);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Thread start request not found or already handled.") {
          dismissThreadStartRequest(request.requestId);
          return;
        }
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
      procedures,
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
        { threadId, includeHeavyContent: false },
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
      setPrimaryView("chat");
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
      setPrimaryView,
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

      const guardedPlan = resolveSelectedWorktreeThreadSyncPlanForModel(plan, {
        activeModelProviderAvailable,
      });

      if (guardedPlan.action === "open-thread") {
        void openThread(guardedPlan.threadId, {
          selectionGuard: {
            projectId,
            worktreePath,
          },
        });
        return;
      }

      if (guardedPlan.action !== "create-thread") {
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
      activeModelProviderAvailable,
      createThreadForWorktree,
      openThread,
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedWorktreePathRef,
      threads,
    ],
  );

  const handleProjectWorktreeClick = useCallback(
    async (project: RpcProject, worktreePath: string): Promise<void> => {
      const clickRequestId = ++projectWorktreeClickRequestIdRef.current;
      setMobileProjectListOpen(false);
      setThreadsError("");
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
          if (projectWorktreeClickRequestIdRef.current !== clickRequestId) {
            return;
          }
          upsertProject(openedProject.project);
          setProjectState(
            openedProject.project.id,
            buildLoadedProjectWorktreesState(openedProject.worktrees),
          );
          resolvedProject = openedProject.project;
          resolvedProjectId = openedProject.project.id;
        } catch (error) {
          if (projectWorktreeClickRequestIdRef.current !== clickRequestId) {
            return;
          }
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
      setMobileProjectListOpen,
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
          logClientError("Failed to apply focused Metidos context", error);
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
    const trackedWorktreeCount = selectedProjectId
      ? projectStateWorktrees(getProjectState(selectedProjectId)).length
      : 0;
    const allowProjectRootThreadSync = trackedWorktreeCount === 0;

    if (
      !selectedProjectId ||
      !activeSelectedWorktreePath ||
      (!activeSelectedWorktreeOpened && !allowProjectRootThreadSync) ||
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
      const selectedWorktreeKey = worktreeKey(
        selectedProjectId,
        activeSelectedWorktreePath,
      );
      if (
        selectedThreadId !== null &&
        !autoThreadCreationWorktreeKeysRef.current.has(selectedWorktreeKey)
      ) {
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
    getProjectState,
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

    // Negative ids are optimistic local placeholders created while the real
    // thread RPC is in flight. They can briefly be selected before/after their
    // optimistic store row is visible to derived state. Do not treat that gap as
    // a stale missing selection and fall back to the first globally ordered
    // thread, because pinned threads sort first and would steal the selection
    // from an explicit New Thread action.
    if (selectedThreadId < 0) {
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
