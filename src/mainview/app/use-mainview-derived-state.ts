import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
  RpcProject,
  RpcThread,
  RpcThreadRunStatus,
  RpcWorktree,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import { findCodexModel } from "../controls/codex-utils";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
  normalizeSearchQuery,
} from "../controls/search-utils";
import { buildDiffFileTree } from "./diff-workspace";
import {
  findPrimaryWorktree,
  formatPathForDisplay,
  mergeThreadErrorLevel,
  orderProjectWorktrees,
  type ProjectActionMenuState,
  type ProjectNodeState,
  primaryWorktreePath,
  shortName,
  sortThreads,
  type ThreadActionMenuState,
  type ThreadErrorLevel,
  threadErrorLevel,
  threadRunStatus,
  type WorktreeNodeState,
  worktreeDisplayName,
  worktreeKey,
} from "./state";

/**
 * Creates a stable key for a dismissible thread status.
 * Returns null for statuses that should not be tracked as dismissible.
 */
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

/** Parameters required by {@link useMainviewDerivedState}. */
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

/**
 * Computes derived mainview state and memoized selectors from raw state inputs.
 */
export function deriveWorktreeDisplayPathByKey(
  projects: RpcProject[],
  getProjectWorktrees: (projectId: number) => RpcWorktree[],
  homeDirectory: string,
  supportsTildePath: boolean,
): ReadonlyMap<string, string> {
  const next = new Map<string, string>();

  for (const project of projects) {
    for (const worktree of getProjectWorktrees(project.id)) {
      next.set(
        worktreeKey(project.id, worktree.path),
        formatPathForDisplay(worktree.path, homeDirectory, supportsTildePath),
      );
    }
  }

  return next;
}

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
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread] as const)),
    [threads],
  );
  const worktreeByProjectAndPath = useMemo(() => {
    const next = new Map<string, RpcWorktree>();
    for (const project of projects) {
      for (const worktree of getProjectState(project.id).worktrees) {
        next.set(worktreeKey(project.id, worktree.path), worktree);
      }
    }
    return next;
  }, [getProjectState, projects]);
  const projectSearchTextById = useMemo(() => {
    const next = new Map<number, string>();
    for (const project of projects) {
      next.set(
        project.id,
        buildNormalizedSearchText(
          project.name,
          project.path,
          formatPathForDisplay(project.path, homeDirectory, supportsTildePath),
        ),
      );
    }
    return next;
  }, [homeDirectory, projects, supportsTildePath]);
  const worktreeDisplayPathByKey = useMemo(
    () =>
      deriveWorktreeDisplayPathByKey(
        projects,
        (projectId) => getProjectState(projectId).worktrees,
        homeDirectory,
        supportsTildePath,
      ),
    [getProjectState, homeDirectory, projects, supportsTildePath],
  );
  const worktreeSearchTextByKey = useMemo(() => {
    const next = new Map<string, string>();
    for (const project of projects) {
      for (const worktree of getProjectState(project.id).worktrees) {
        const key = worktreeKey(project.id, worktree.path);
        next.set(
          key,
          buildNormalizedSearchText(
            project.name,
            worktree.branch,
            worktree.path,
            shortName(worktree.path),
            worktreeDisplayPathByKey.get(key) ?? worktree.path,
          ),
        );
      }
    }
    return next;
  }, [getProjectState, projects, worktreeDisplayPathByKey]);

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
    return threadById.get(selectedThreadId) ?? null;
  }, [selectedThreadId, threadById]);

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
    // Keep active reasoning effort aligned with selected thread when available.
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

  const projectThreadErrorLevels = useMemo(() => {
    // Aggregate non-dismissed thread error levels per project, keeping max severity.
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
    // Aggregate non-dismissed thread error levels per worktree, keyed by project+path.
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
    // Drop stale dismissals when threads are removed or their status key changes.
    setDismissedThreadStatusKeys((prev) => {
      const nextEntries = Object.entries(prev).filter(
        ([threadId, statusKey]) => {
          const thread = threadById.get(Number(threadId)) ?? null;
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
  }, [threadById]);

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
    return projectById.get(projectActionMenu.projectId) ?? null;
  }, [projectActionMenu, projectById]);

  const threadActionMenuThread = useMemo(() => {
    if (!threadActionMenu) {
      return null;
    }
    return threadById.get(threadActionMenu.threadId) ?? null;
  }, [threadActionMenu, threadById]);

  const selectedProjectWorktrees = useMemo(() => {
    // Worktrees are sourced from project state cache, then ordered for UI display.
    if (!selectedProject) {
      return [];
    }
    return orderProjectWorktrees(
      selectedProject,
      getProjectState(selectedProject.id).worktrees,
    );
  }, [getProjectState, selectedProject]);

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
    ? selectedProject
      ? (worktreeDisplayPathByKey.get(
          worktreeKey(selectedProject.id, activeSelectedWorktreePath),
        ) ??
        formatPathForDisplay(
          activeSelectedWorktreePath,
          homeDirectory,
          supportsTildePath,
        ))
      : formatPathForDisplay(
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
    // Normalize once so every query check uses a canonicalized token stream.
    () => normalizeSearchQuery(sidebarSearchQuery),
    [sidebarSearchQuery],
  );

  const filteredProjects = useMemo(() => {
    // Match against project metadata and each worktree's display fields.
    if (!normalizedSidebarSearchQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const projectState = getProjectState(project.id);
      const matchingWorktree = projectState.worktrees.some((worktree) =>
        matchesNormalizedSearchText(
          normalizedSidebarSearchQuery,
          worktreeSearchTextByKey.get(worktreeKey(project.id, worktree.path)) ??
            "",
        ),
      );

      return (
        matchesNormalizedSearchText(
          normalizedSidebarSearchQuery,
          projectSearchTextById.get(project.id) ?? "",
        ) || matchingWorktree
      );
    });
  }, [
    getProjectState,
    normalizedSidebarSearchQuery,
    projectSearchTextById,
    projects,
    worktreeSearchTextByKey,
  ]);

  const { filteredWorkspaceActiveThreads, filteredWorkspacePinnedThreads } =
    useMemo(() => {
      // Sort once for stable recency ordering, then partition into pinned/recent lists.
      const sortedThreads = sortThreads(threads);
      const pinnedThreads: RpcThread[] = [];
      const activeThreads: RpcThread[] = [];

      for (const thread of sortedThreads) {
        if (thread.pinnedAt !== null) {
          pinnedThreads.push(thread);
          continue;
        }
        activeThreads.push(thread);
      }

      return {
        filteredWorkspaceActiveThreads: activeThreads,
        filteredWorkspacePinnedThreads: pinnedThreads,
      };
    }, [threads]);

  const filteredGitHistoryEntries = useMemo(() => {
    return gitHistory?.entries ?? [];
  }, [gitHistory]);

  const isActiveWorktree = useCallback(
    // Re-used across lists/items to consistently highlight active worktree.
    (projectId: number, worktreePath: string): boolean =>
      selectedProjectId === projectId &&
      activeSelectedWorktreePath === worktreePath,
    [activeSelectedWorktreePath, selectedProjectId],
  );

  const projectThreadErrorLevel = useCallback(
    // Exposed helper for UI badges at project level.
    (projectId: number): ThreadErrorLevel =>
      projectThreadErrorLevels.get(projectId) ?? "none",
    [projectThreadErrorLevels],
  );

  const worktreeThreadErrorLevel = useCallback(
    // Exposed helper for UI badges at worktree level.
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
    projectById,
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
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
    worktreeSearchTextByKey,
    worktreeThreadErrorLevel,
  };
}
