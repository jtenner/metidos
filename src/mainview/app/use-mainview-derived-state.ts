import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
  RpcProject,
  RpcThread,
  RpcThreadRunStatus,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import { findCodexModel } from "../controls/codex-utils";
import {
  matchesSearchQuery,
  normalizeSearchQuery,
} from "../controls/search-utils";
import { buildDiffFileTree } from "./diff-workspace";
import {
  APP_TITLE,
  type ProjectActionMenuState,
  type ProjectNodeState,
  type ThreadActionMenuState,
  type ThreadErrorLevel,
  type WorktreeNodeState,
  findPrimaryWorktree,
  formatPathForDisplay,
  mergeThreadErrorLevel,
  orderProjectWorktrees,
  pinnedThreadForWorktree,
  primaryWorktreePath,
  shortName,
  sortThreads,
  threadErrorLevel,
  threadRunStatus,
  worktreeDisplayName,
  worktreeKey,
} from "./state";

function dismissibleThreadStatusKey(
  runStatus: RpcThreadRunStatus,
): string | null {
  const hasDismissibleStatus =
    runStatus.hasUnreadError ||
    runStatus.state === "failed" ||
    runStatus.state === "stopped";
  const updatedAt = runStatus.updatedAt?.trim() ?? "";
  if (!hasDismissibleStatus || !updatedAt) {
    return null;
  }

  return `${runStatus.state}:${updatedAt}:${runStatus.error ?? ""}`;
}

type UseMainviewDerivedStateParams = {
  chatError: string;
  codexModels: RpcCodexModelOption[];
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcCodexReasoningEffort;
  getProjectState: (projectId: number) => ProjectNodeState;
  getWorktreeState: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  gitHistory: RpcWorktreeGitHistoryResult | null;
  homeDirectory: string;
  isCreatingThread: boolean;
  isDocumentVisible: boolean;
  isLoadingProjectTasks: boolean;
  isRunningProjectTask: boolean;
  isSending: boolean;
  isStoppingThread: boolean;
  isThreadLoading: boolean;
  isUpdatingThreadModel: boolean;
  isUpdatingThreadReasoningEffort: boolean;
  isUpdatingThreadUnsafeMode: boolean;
  pendingThreadModel: string;
  pendingThreadReasoningEffort: RpcCodexReasoningEffort;
  pendingThreadUnsafeMode: boolean;
  projectActionMenu: ProjectActionMenuState | null;
  projects: RpcProject[];
  reasoningEfforts: RpcCodexReasoningEffortOption[];
  selectedDiffFilePath: string | null;
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  sidebarSearchQuery: string;
  supportsTildePath: boolean;
  threadActionMenu: ThreadActionMenuState | null;
  threads: RpcThread[];
};

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
  isLoadingProjectTasks,
  isRunningProjectTask,
  isSending,
  isStoppingThread,
  isThreadLoading,
  isUpdatingThreadModel,
  isUpdatingThreadReasoningEffort,
  isUpdatingThreadUnsafeMode,
  pendingThreadModel,
  pendingThreadReasoningEffort,
  pendingThreadUnsafeMode,
  projectActionMenu,
  projects,
  reasoningEfforts,
  selectedDiffFilePath,
  selectedProjectId,
  selectedThreadId,
  selectedWorktreePath,
  sidebarSearchQuery,
  supportsTildePath,
  threadActionMenu,
  threads,
}: UseMainviewDerivedStateParams) {
  const [dismissedThreadStatusKeys, setDismissedThreadStatusKeys] = useState<
    Record<number, string>
  >({});

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) {
      return null;
    }
    return projects.find((entry) => entry.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadId) {
      return null;
    }
    return threads.find((entry) => entry.id === selectedThreadId) ?? null;
  }, [selectedThreadId, threads]);

  const selectedThreadRunStatus = useMemo(
    () => threadRunStatus(selectedThread),
    [selectedThread],
  );

  const hasWorkingThreads = useMemo(
    () => threads.some((thread) => thread.runStatus.state === "working"),
    [threads],
  );

  const activeCodexModel = useMemo(() => {
    if (selectedThread?.model) {
      return selectedThread.model;
    }
    return pendingThreadModel || defaultCodexModel;
  }, [defaultCodexModel, pendingThreadModel, selectedThread]);

  const activeCodexModelOption = useMemo(
    () => findCodexModel(codexModels, activeCodexModel),
    [activeCodexModel, codexModels],
  );

  const activeReasoningEffort = useMemo(() => {
    if (selectedThread?.reasoningEffort) {
      return selectedThread.reasoningEffort;
    }
    return pendingThreadReasoningEffort || defaultCodexReasoningEffort;
  }, [
    defaultCodexReasoningEffort,
    pendingThreadReasoningEffort,
    selectedThread,
  ]);

  const activeUnsafeMode = useMemo(() => {
    if (selectedThread) {
      return selectedThread.unsafeMode;
    }
    return pendingThreadUnsafeMode;
  }, [pendingThreadUnsafeMode, selectedThread]);

  const activeContextWindowTokens =
    activeCodexModelOption?.contextWindowTokens ?? 400_000;
  const activeContextInputTokens = selectedThread?.usage?.inputTokens ?? 0;

  const isThreadStatusDismissed = useCallback(
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

  const projectThreadErrorLevels = useMemo(() => {
    const next = new Map<number, ThreadErrorLevel>();
    for (const thread of threads) {
      const level = isThreadStatusDismissed(thread)
        ? "none"
        : threadErrorLevel(thread);
      if (level === "none") {
        continue;
      }
      next.set(
        thread.projectId,
        mergeThreadErrorLevel(next.get(thread.projectId) ?? "none", level),
      );
    }
    return next;
  }, [isThreadStatusDismissed, threads]);

  const worktreeThreadErrorLevels = useMemo(() => {
    const next = new Map<string, ThreadErrorLevel>();
    for (const thread of threads) {
      const level = isThreadStatusDismissed(thread)
        ? "none"
        : threadErrorLevel(thread);
      if (level === "none") {
        continue;
      }
      const key = worktreeKey(thread.projectId, thread.worktreePath);
      next.set(key, mergeThreadErrorLevel(next.get(key) ?? "none", level));
    }
    return next;
  }, [isThreadStatusDismissed, threads]);

  useEffect(() => {
    setDismissedThreadStatusKeys((prev) => {
      const nextEntries = Object.entries(prev).filter(
        ([threadId, statusKey]) => {
          const thread =
            threads.find((entry) => entry.id === Number(threadId)) ?? null;
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
  }, [threads]);

  const dismissThreadStatus = useCallback((thread: RpcThread): void => {
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
  const modelSelectorDisabled =
    codexModels.length === 0 ||
    isCreatingThread ||
    isThreadLoading ||
    isSending ||
    isUpdatingThreadModel ||
    selectedThreadIsWorking;
  const reasoningEffortSelectorDisabled =
    reasoningEfforts.length === 0 ||
    isCreatingThread ||
    isThreadLoading ||
    isSending ||
    isUpdatingThreadReasoningEffort ||
    selectedThreadIsWorking;
  const unsafeModeToggleDisabled =
    isCreatingThread ||
    isThreadLoading ||
    isSending ||
    isUpdatingThreadUnsafeMode ||
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
    return (
      projects.find((project) => project.id === projectActionMenu.projectId) ??
      null
    );
  }, [projectActionMenu, projects]);

  const threadActionMenuThread = useMemo(() => {
    if (!threadActionMenu) {
      return null;
    }
    return (
      threads.find((thread) => thread.id === threadActionMenu.threadId) ?? null
    );
  }, [threadActionMenu, threads]);

  const selectedProjectWorktrees = useMemo(() => {
    if (!selectedProject) {
      return [];
    }
    return orderProjectWorktrees(
      selectedProject,
      getProjectState(selectedProject.id).worktrees,
    );
  }, [getProjectState, selectedProject]);

  const activeSelectedWorktreePath = useMemo(() => {
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
    if (!selectedProject || !activeSelectedWorktreePath) {
      return null;
    }
    return (
      selectedProjectWorktrees.find(
        (worktree) => worktree.path === activeSelectedWorktreePath,
      ) ?? findPrimaryWorktree(selectedProject, selectedProjectWorktrees)
    );
  }, [activeSelectedWorktreePath, selectedProject, selectedProjectWorktrees]);

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
      return "User";
    }
    const label = shortName(normalizedHomeDirectory);
    if (!label || label === "/" || /^[A-Za-z]:$/.test(label)) {
      return "User";
    }
    return label;
  }, [homeDirectory]);

  const activeScreenTitle = selectedThread?.title ?? "No thread selected";
  const activeScreenSubtitlePrimary = selectedProject
    ? activeSelectedWorktreeFolder
    : "No project selected";
  const activeScreenSubtitleSecondary = activeSelectedWorktreePath
    ? formatPathForDisplay(
        activeSelectedWorktreePath,
        homeDirectory,
        supportsTildePath,
      )
    : "No worktree selected";

  const taskSelectorDisabled =
    !selectedProject ||
    !activeSelectedWorktreePath ||
    !activeSelectedWorktreeOpened ||
    isLoadingProjectTasks ||
    isRunningProjectTask ||
    isSending ||
    selectedThreadIsWorking ||
    isThreadLoading;

  const normalizedSidebarSearchQuery = useMemo(
    () => normalizeSearchQuery(sidebarSearchQuery),
    [sidebarSearchQuery],
  );

  const filteredProjects = useMemo(() => {
    if (!normalizedSidebarSearchQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const projectState = getProjectState(project.id);
      const matchingWorktree = projectState.worktrees.some((worktree) =>
        matchesSearchQuery(
          normalizedSidebarSearchQuery,
          project.name,
          project.path,
          formatPathForDisplay(project.path, homeDirectory, supportsTildePath),
          worktree.branch,
          worktree.path,
          shortName(worktree.path),
          formatPathForDisplay(worktree.path, homeDirectory, supportsTildePath),
        ),
      );

      return (
        matchesSearchQuery(
          normalizedSidebarSearchQuery,
          project.name,
          project.path,
          formatPathForDisplay(project.path, homeDirectory, supportsTildePath),
        ) || matchingWorktree
      );
    });
  }, [
    getProjectState,
    homeDirectory,
    normalizedSidebarSearchQuery,
    projects,
    supportsTildePath,
  ]);

  const filteredWorkspacePinnedThreads = useMemo(() => {
    return sortThreads(threads.filter((thread) => thread.pinnedAt !== null));
  }, [threads]);

  const filteredWorkspaceActiveThreads = useMemo(() => {
    return sortThreads(threads.filter((thread) => thread.pinnedAt === null));
  }, [threads]);

  const filteredGitHistoryEntries = useMemo(() => {
    return gitHistory?.entries ?? [];
  }, [gitHistory]);

  const isActiveWorktree = useCallback(
    (projectId: number, worktreePath: string): boolean =>
      selectedProjectId === projectId &&
      activeSelectedWorktreePath === worktreePath,
    [activeSelectedWorktreePath, selectedProjectId],
  );

  const projectThreadErrorLevel = useCallback(
    (projectId: number): ThreadErrorLevel =>
      projectThreadErrorLevels.get(projectId) ?? "none",
    [projectThreadErrorLevels],
  );

  const worktreeThreadErrorLevel = useCallback(
    (projectId: number, worktreePath: string): ThreadErrorLevel =>
      worktreeThreadErrorLevels.get(worktreeKey(projectId, worktreePath)) ??
      "none",
    [worktreeThreadErrorLevels],
  );

  return {
    activeChatError,
    activeChatNotice,
    activeCodexModel,
    activeContextInputTokens,
    activeContextWindowTokens,
    activePollingProjectId,
    activePollingWorktreePath,
    activeReasoningEffort,
    activeUnsafeMode,
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
    projectThreadErrorLevel,
    reasoningEffortSelectorDisabled,
    selectedDiffFileChange,
    selectedProject,
    selectedProjectWorktrees,
    selectedThread,
    selectedThreadIsWorking,
    selectedThreadRunStatus,
    taskSelectorDisabled,
    threadActionMenuThread,
    unsafeModeToggleDisabled,
    worktreeThreadErrorLevel,
  };
}
