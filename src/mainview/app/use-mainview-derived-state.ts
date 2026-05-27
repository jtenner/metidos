/**
 * @file src/mainview/app/use-mainview-derived-state.ts
 * @description Module for use mainview derived state.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  RpcModelOption,
  RpcProject,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
  RpcThread,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import { findCodexModel } from "../controls/codex-utils";
import { normalizeSearchQuery } from "../controls/search-utils";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import { buildDiffFileTree } from "./diff-workspace";
import {
  buildProjectWorktreeDerivedMaps,
  deriveActiveContextUsage,
  deriveProjectWorktreesById,
  deriveReasoningEffortSelectorDisabled,
  dismissibleThreadStatusKey,
  filterProjectsBySidebarSearch,
} from "./mainview-derived-selectors";
import type { ProjectStore } from "./project-store";
import {
  findPrimaryWorktree,
  orderProjectWorktrees,
  type ProjectNodeState,
  primaryWorktreePath,
  shortName,
  type WorktreeNodeState,
  worktreeDisplayName,
  worktreeKey,
} from "./project-worktree-state";
import {
  partitionOrderedThreadsByPinnedState,
  type ThreadStore,
  threadRunStatus,
} from "./thread-store";
import type {
  ProjectActionMenuState,
  ThreadActionMenuState,
} from "./thread-ui-state";
import { accessPermissionsFromThread } from "./use-access-permissions";

export {
  deriveActiveContextUsage,
  deriveReasoningEffortSelectorDisabled,
  deriveWorktreeDisplayPathByKey,
} from "./mainview-derived-selectors";

/** Parameters required by {@link useMainviewDerivedState}. */
type UseMainviewDerivedStateParams = {
  chatError: string;
  codexModels: RpcModelOption[];
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
  getProjectState: (projectId: number) => ProjectNodeState;
  getWorktreeState: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  gitHistory: RpcWorktreeGitHistoryResult | null;
  homeDirectory: string;
  isCreatingThread: boolean;
  isDocumentVisible: boolean;
  isSending: boolean;
  isStoppingThread: boolean;
  isThreadLoading: boolean;
  isUpdatingThreadModel: boolean;
  isUpdatingThreadReasoningEffort: boolean;
  isUpdatingThreadAccess: boolean;
  pendingThreadAccessValue: ThreadAccessValue;
  pendingThreadModel: string;
  pendingThreadReasoningEffort: RpcReasoningEffort;
  projectActionMenu: ProjectActionMenuState | null;
  projectStore: ProjectStore;
  projects: RpcProject[];
  reasoningEfforts: RpcReasoningEffortOption[];
  selectedDiffFilePath: string | null;
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  sidebarSearchQuery: string;
  supportsTildePath: boolean;
  threadActionMenu: ThreadActionMenuState | null;
  threadStore: ThreadStore;
  threads: RpcThread[];
};

/**
 * Provides hook behavior for MainviewDerivedState.
 * @param chatError - chatError argument for useMainviewDerivedState.
 * @param codexModels - codexModels argument for useMainviewDerivedState.
 * @param defaultCodexModel - defaultCodexModel argument for useMainviewDerivedState.
 * @param defaultCodexReasoningEffort - defaultCodexReasoningEffort argument for useMainviewDerivedState.
 * @param getProjectState - getProjectState argument for useMainviewDerivedState.
 * @param getWorktreeState - getWorktreeState argument for useMainviewDerivedState.
 * @param gitHistory - gitHistory argument for useMainviewDerivedState.
 * @param homeDirectory - homeDirectory argument for useMainviewDerivedState.
 * @param isCreatingThread - Boolean flag indicating isCreatingThread.
 * @param isDocumentVisible - Boolean flag indicating isDocumentVisible.
 * @param isSending - Boolean flag indicating isSending.
 * @param isStoppingThread - Boolean flag indicating isStoppingThread.
 * @param isThreadLoading - Boolean flag indicating isThreadLoading.
 * @param isUpdatingThreadModel - Boolean flag indicating isUpdatingThreadModel.
 * @param isUpdatingThreadReasoningEffort - Boolean flag indicating isUpdatingThreadReasoningEffort.
 * @param isUpdatingThreadAccess - Boolean flag indicating isUpdatingThreadAccess.
 * @param pendingThreadGithubAccess - pendingThreadGithubAccess argument for useMainviewDerivedState.
 * @param pendingThreadGitAccess - pendingThreadGitAccess argument for useMainviewDerivedState.
 * @param pendingThreadSqliteAccess - pendingThreadSqliteAccess argument for useMainviewDerivedState.
 * @param pendingThreadAgentsAccess - pendingThreadAgentsAccess argument for useMainviewDerivedState.
 * @param pendingThreadMetidosAccess - pendingThreadMetidosAccess argument for useMainviewDerivedState.
 * @param pendingThreadModel - pendingThreadModel argument for useMainviewDerivedState.
 * @param pendingThreadReasoningEffort - pendingThreadReasoningEffort argument for useMainviewDerivedState.
 * @param pendingThreadUnsafeMode - pendingThreadUnsafeMode argument for useMainviewDerivedState.
 * @param projectActionMenu - projectActionMenu argument for useMainviewDerivedState.
 * @param projects - projects argument for useMainviewDerivedState.
 * @param reasoningEfforts - reasoningEfforts argument for useMainviewDerivedState.
 * @param selectedDiffFilePath - selectedDiffFilePath path used by useMainviewDerivedState.
 * @param selectedProjectId - selectedProjectId identifier.
 * @param selectedThreadId - selectedThreadId identifier.
 * @param selectedWorktreePath - selectedWorktreePath path used by useMainviewDerivedState.
 * @param sidebarSearchQuery - sidebarSearchQuery argument for useMainviewDerivedState.
 * @param supportsTildePath - supportsTildePath path used by useMainviewDerivedState.
 * @param threadActionMenu - threadActionMenu argument for useMainviewDerivedState.
 * @param threads - threads argument for useMainviewDerivedState.
 */

export function useMainviewDerivedState({
  chatError,
  codexModels,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  getProjectState,
  getWorktreeState,
  gitHistory,
  homeDirectory,
  isCreatingThread,
  isDocumentVisible,
  isSending,
  isStoppingThread,
  isThreadLoading,
  isUpdatingThreadModel,
  isUpdatingThreadReasoningEffort,
  isUpdatingThreadAccess,
  pendingThreadAccessValue,
  pendingThreadModel,
  pendingThreadReasoningEffort,
  projectActionMenu,
  projectStore,
  projects,
  reasoningEfforts,
  selectedDiffFilePath,
  selectedProjectId,
  selectedThreadId,
  selectedWorktreePath,
  sidebarSearchQuery,
  supportsTildePath,
  threadActionMenu,
  threadStore,
  threads,
}: UseMainviewDerivedStateParams) {
  const [dismissedThreadStatusKeys, setDismissedThreadStatusKeys] = useState<
    Record<number, string>
  >({});
  const deferredSidebarSearchQuery = useDeferredValue(sidebarSearchQuery);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );

  const projectWorktreesById = useMemo(
    () => deriveProjectWorktreesById(projects, getProjectState),
    [getProjectState, projects],
  );
  const {
    projectSearchTextById,
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
    worktreeSearchTextByKey,
  } = useMemo(
    () =>
      buildProjectWorktreeDerivedMaps({
        homeDirectory,
        projectWorktreesById,
        projects,
        supportsTildePath,
      }),
    [homeDirectory, projectWorktreesById, projects, supportsTildePath],
  );
  const normalizedSidebarSearchQuery = useMemo(
    // Defer the heavy sidebar search projections so typing stays responsive.
    () => normalizeSearchQuery(deferredSidebarSearchQuery),
    [deferredSidebarSearchQuery],
  );
  const selectedProject = useMemo(() => {
    // Resolve the selected project by ID from the full project list.
    if (!selectedProjectId) {
      return null;
    }
    return projectById.get(selectedProjectId) ?? null;
  }, [projectById, selectedProjectId]);

  const selectedThread = useMemo(() => {
    // Resolve the selected thread by ID from the full thread list.
    if (!selectedThreadId) {
      return null;
    }
    return threadStore.byId[selectedThreadId] ?? null;
  }, [selectedThreadId, threadStore.byId]);

  const selectedThreadRunStatus = useMemo(
    () => threadRunStatus(selectedThread),
    [selectedThread],
  );

  const hasWorkingThreads = useMemo(
    // Tracks whether any thread in the workspace list is in the working state.
    () => threads.some((thread) => thread.runStatus.state === "working"),
    [threads],
  );

  const activeCodexModel = useMemo(() => {
    if (isUpdatingThreadModel && pendingThreadModel) {
      return pendingThreadModel;
    }
    if (selectedThread?.model) {
      return selectedThread.model;
    }
    return pendingThreadModel || defaultCodexModel;
  }, [
    defaultCodexModel,
    isUpdatingThreadModel,
    pendingThreadModel,
    selectedThread,
  ]);

  const activeCodexModelOption = useMemo(
    () => findCodexModel(codexModels, activeCodexModel),
    [activeCodexModel, codexModels],
  );

  const activeReasoningEffort = useMemo(() => {
    if (isUpdatingThreadReasoningEffort && pendingThreadReasoningEffort) {
      return pendingThreadReasoningEffort;
    }
    // Keep active reasoning effort aligned with selected thread when available.
    if (selectedThread?.reasoningEffort) {
      return selectedThread.reasoningEffort;
    }
    return pendingThreadReasoningEffort || defaultCodexReasoningEffort;
  }, [
    defaultCodexReasoningEffort,
    isUpdatingThreadReasoningEffort,
    pendingThreadReasoningEffort,
    selectedThread,
  ]);

  const activeThreadAccessValue = useMemo(
    () =>
      selectedThread
        ? accessPermissionsFromThread(selectedThread)
        : pendingThreadAccessValue,
    [pendingThreadAccessValue, selectedThread],
  );

  const {
    contextWindowTokens: activeContextWindowTokens,
    inputTokens: activeContextInputTokens,
  } = deriveActiveContextUsage(selectedThread ?? null, activeCodexModelOption);

  const isThreadStatusDismissed = useCallback(
    // A thread is considered dismissed if its current terminal key matches prior state.
    (thread: RpcThread | null): boolean => {
      if (!thread) {
        return false;
      }

      const statusKey = dismissibleThreadStatusKey(thread.runStatus);
      return (
        statusKey !== null && dismissedThreadStatusKeys[thread.id] === statusKey
      );
    },
    [dismissedThreadStatusKeys],
  );

  useEffect(() => {
    // Drop outdated dismissal records when threads are removed or their status key changes.
    setDismissedThreadStatusKeys((prev) => {
      const nextEntries = Object.entries(prev).filter(
        ([threadId, statusKey]) => {
          const thread = threadStore.byId[Number(threadId)] ?? null;
          return thread
            ? dismissibleThreadStatusKey(thread.runStatus) === statusKey
            : false;
        },
      );
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }

      return Object.fromEntries(nextEntries) as Record<number, string>;
    });
  }, [threadStore.byId]);

  const dismissThreadStatus = useCallback((thread: RpcThread): void => {
    // Record dismissal only when thread has a terminal/dismissible status.
    const statusKey = dismissibleThreadStatusKey(thread.runStatus);
    if (!statusKey) {
      return;
    }

    setDismissedThreadStatusKeys((prev) =>
      prev[thread.id] === statusKey
        ? prev
        : {
            ...prev,
            [thread.id]: statusKey,
          },
    );
  }, []);

  const selectedThreadIsWorking = selectedThreadRunStatus.state === "working";
  // Disable inputs that mutate state while any thread action is in-flight.
  const modelSelectorDisabled =
    codexModels.length === 0 ||
    isCreatingThread ||
    isThreadLoading ||
    isSending ||
    isUpdatingThreadModel ||
    selectedThreadIsWorking;
  const reasoningEffortSelectorDisabled = deriveReasoningEffortSelectorDisabled(
    {
      activeCodexModelOption,
      isCreatingThread,
      isSending,
      isThreadLoading,
      isUpdatingThreadReasoningEffort,
      reasoningEfforts,
      selectedThreadIsWorking,
    },
  );
  const threadAccessControlDisabled =
    isCreatingThread ||
    isThreadLoading ||
    isSending ||
    isUpdatingThreadAccess ||
    selectedThreadIsWorking;

  const selectedThreadRunError =
    selectedThreadRunStatus.state === "failed"
      ? (selectedThreadRunStatus.error ?? "")
      : "";
  const selectedThreadRunNotice =
    selectedThreadRunStatus.state === "stopped"
      ? (selectedThreadRunStatus.error ?? "")
      : "";
  const composerActionDisabled = selectedThreadIsWorking
    ? !selectedThread || isThreadLoading || isStoppingThread
    : !selectedThread || isSending || isThreadLoading;
  const composerActionLabel = selectedThreadIsWorking
    ? "Stop current run"
    : "Send message";

  const activeChatError = chatError || selectedThreadRunError;
  const activeChatNotice = selectedThreadRunNotice;

  const projectActionMenuProject = useMemo(() => {
    if (!projectActionMenu) {
      return null;
    }
    return projectStore.byId[projectActionMenu.projectId] ?? null;
  }, [projectActionMenu, projectStore.byId]);

  const threadActionMenuThread = useMemo(() => {
    if (!threadActionMenu) {
      return null;
    }
    return threadStore.byId[threadActionMenu.threadId] ?? null;
  }, [threadActionMenu, threadStore.byId]);

  const selectedProjectWorktrees = useMemo(() => {
    // Worktrees are sourced from the memoized project-worktree snapshot,
    // then ordered for UI display only for the selected project.
    if (!selectedProject) {
      return [];
    }
    return orderProjectWorktrees(
      selectedProject,
      projectWorktreesById.get(selectedProject.id) ?? [],
    );
  }, [projectWorktreesById, selectedProject]);

  const activeSelectedWorktreePath = useMemo(() => {
    // Prefer the thread-specific worktree when valid; fall back to explicit selection.
    if (!selectedProject) {
      return null;
    }
    const threadSelectedWorktreePath =
      selectedThread?.projectId === selectedProject.id
        ? selectedThread.worktreePath
        : null;
    if (
      threadSelectedWorktreePath &&
      selectedWorktreePath === threadSelectedWorktreePath
    ) {
      return threadSelectedWorktreePath;
    }
    if (selectedProject.isOpen !== 1) {
      return null;
    }
    if (selectedWorktreePath) {
      return selectedWorktreePath;
    }
    return primaryWorktreePath(selectedProject, selectedProjectWorktrees);
  }, [
    selectedProject,
    selectedProjectWorktrees,
    selectedThread,
    selectedWorktreePath,
  ]);

  const activeSelectedWorktree = useMemo(() => {
    // Resolve requested worktree by path, otherwise fall back to primary.
    if (!selectedProject || !activeSelectedWorktreePath) {
      return null;
    }
    return (
      worktreeByProjectAndPath.get(
        worktreeKey(selectedProject.id, activeSelectedWorktreePath),
      ) ?? findPrimaryWorktree(selectedProject, selectedProjectWorktrees)
    );
  }, [
    activeSelectedWorktreePath,
    selectedProject,
    selectedProjectWorktrees,
    worktreeByProjectAndPath,
  ]);

  const activeSelectedWorktreeOpened = useMemo(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return false;
    }
    return getWorktreeState(selectedProject.id, activeSelectedWorktreePath)
      .opened;
  }, [activeSelectedWorktreePath, getWorktreeState, selectedProject]);

  const activeSelectedWorktreeState = useMemo(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return null;
    }
    return getWorktreeState(selectedProject.id, activeSelectedWorktreePath);
  }, [activeSelectedWorktreePath, getWorktreeState, selectedProject]);

  // Snapshot drives file tree + diff computations.
  const activeWorktreeSnapshot = activeSelectedWorktreeState?.snapshot ?? null;
  const activeWorktreeChanges = activeWorktreeSnapshot?.changes ?? [];
  const diffFileTree = useMemo(
    () => buildDiffFileTree(activeWorktreeChanges),
    [activeWorktreeChanges],
  );
  const selectedDiffFileChange = useMemo(
    () =>
      selectedDiffFilePath
        ? (activeWorktreeChanges.find(
            (change) => change.path === selectedDiffFilePath,
          ) ?? null)
        : null,
    [activeWorktreeChanges, selectedDiffFilePath],
  );

  // Poll only for open worktrees while the document is visible and selected.
  const activePollingProjectId =
    isDocumentVisible &&
    selectedProject &&
    selectedProject.isOpen === 1 &&
    activeSelectedWorktreePath
      ? selectedProject.id
      : null;
  const activePollingWorktreePath =
    activePollingProjectId !== null ? activeSelectedWorktreePath : null;

  const activeSelectedWorktreeFolder = useMemo(() => {
    if (!activeSelectedWorktreePath) {
      return "No worktree selected";
    }
    return shortName(activeSelectedWorktreePath);
  }, [activeSelectedWorktreePath]);

  const activeSelectedWorktreeName = useMemo(() => {
    if (!selectedProject) {
      return "";
    }
    if (!activeSelectedWorktree && selectedThread) {
      return selectedThread.title;
    }
    return worktreeDisplayName(activeSelectedWorktree);
  }, [activeSelectedWorktree, selectedProject, selectedThread]);

  const localUserLabel = useMemo(() => {
    const normalizedHomeDirectory = homeDirectory.replace(/[\\/]+$/, "");
    if (!normalizedHomeDirectory) {
      return "Operator";
    }
    const label = shortName(normalizedHomeDirectory);
    if (!label || label === "/" || /^[A-Za-z]:$/.test(label)) {
      return "Operator";
    }
    return label;
  }, [homeDirectory]);

  const activeScreenTitle = selectedThread?.title ?? "No thread selected";
  const activeScreenSubtitlePrimary = selectedProject
    ? activeSelectedWorktreeName || activeSelectedWorktreeFolder
    : "No project selected";
  const activeScreenSubtitleSecondary = selectedProject
    ? activeSelectedWorktreeFolder
    : "No worktree selected";

  const filteredProjects = useMemo(
    () =>
      filterProjectsBySidebarSearch({
        normalizedSidebarSearchQuery,
        projectSearchTextById,
        projectWorktreesById,
        projects,
        worktreeSearchTextByKey,
      }),
    [
      normalizedSidebarSearchQuery,
      projectSearchTextById,
      projectWorktreesById,
      projects,
      worktreeSearchTextByKey,
    ],
  );

  const {
    activeThreads: filteredWorkspaceActiveThreads,
    pinnedThreads: filteredWorkspacePinnedThreads,
  } = useMemo(
    // threadStoreItems() already preserves thread-list order, so just partition.
    () => partitionOrderedThreadsByPinnedState(threads),
    [threads],
  );

  const filteredGitHistoryEntries = gitHistory?.entries ?? [];

  const isActiveWorktree = useCallback(
    // Re-used across lists/items to consistently highlight active worktree.
    (projectId: number, worktreePath: string): boolean =>
      selectedProjectId === projectId &&
      activeSelectedWorktreePath === worktreePath,
    [activeSelectedWorktreePath, selectedProjectId],
  );

  return {
    activeChatError,
    activeChatNotice,
    activeCodexModel,
    activeContextInputTokens,
    activeContextWindowTokens,
    activeWebSearchAccess: activeThreadAccessValue.webSearchAccess,
    activeWebviewAccess: false,
    activeGithubAccess: activeThreadAccessValue.githubAccess,
    activeGitAccess: activeThreadAccessValue.gitAccess,
    activeSqliteAccess: activeThreadAccessValue.sqliteAccess,
    activeAgentsAccess: activeThreadAccessValue.agentsAccess,
    activeCalendarAccess: activeThreadAccessValue.calendarAccess,
    activeNotificationsAccess: activeThreadAccessValue.notificationsAccess,
    activeWebServerAccess: activeThreadAccessValue.webServerAccess,
    activeMetidosAccess: activeThreadAccessValue.metidosAccess,
    activePollingProjectId,
    activePollingWorktreePath,
    activeReasoningEffort,
    activeUnsafeMode: activeThreadAccessValue.unsafeMode,
    activeThreadAccessValue,
    activeScreenSubtitlePrimary,
    activeScreenSubtitleSecondary,
    activeScreenTitle,
    activeSelectedWorktree,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreeName,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    activeSelectedWorktreeState,
    activeWorktreeChanges,
    activeWorktreeSnapshot,
    composerActionDisabled,
    composerActionLabel,
    diffFileTree,
    dismissThreadStatus,
    filteredGitHistoryEntries,
    filteredProjects,
    filteredWorkspaceActiveThreads,
    filteredWorkspacePinnedThreads,
    hasWorkingThreads,
    isActiveWorktree,
    isThreadStatusDismissed,
    localUserLabel,
    modelSelectorDisabled,
    normalizedSidebarSearchQuery,
    projectActionMenuProject,
    projectById,
    projectWorktreesById,
    reasoningEffortSelectorDisabled,
    selectedDiffFileChange,
    selectedProject,
    selectedProjectWorktrees,
    selectedThread,
    selectedThreadIsWorking,
    selectedThreadRunStatus,
    threadActionMenuThread,
    threadAccessControlDisabled,
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
    worktreeSearchTextByKey,
  };
}
