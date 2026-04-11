/**
 * @file src/mainview/app/mainview-derived-selectors.ts
 * @description Pure derived-state helpers for the mainview shell.
 */

import type {
  RpcModelOption,
  RpcProject,
  RpcReasoningEffortOption,
  RpcThread,
  RpcThreadRunStatus,
  RpcWorktree,
} from "../../bun/rpc-schema";
import { codexModelSupportsThinkingLevel } from "../controls/codex-utils";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
} from "../controls/search-utils";
import {
  formatPathForDisplay,
  type ProjectNodeState,
  projectStateWorktrees,
  shortName,
  worktreeKey,
} from "./state";

/**
 * Creates a stable key for a dismissible thread status.
 * Returns null for statuses that should not be tracked as dismissible.
 */
export function dismissibleThreadStatusKey(
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

/**
 * Materializes the current worktree arrays for every project.
 */
export function deriveProjectWorktreesById(
  projects: RpcProject[],
  getProjectState: (
    projectId: number,
  ) => Pick<ProjectNodeState, "worktreeByPath" | "worktreePaths">,
): ReadonlyMap<number, RpcWorktree[]> {
  const next = new Map<number, RpcWorktree[]>();

  for (const project of projects) {
    next.set(project.id, projectStateWorktrees(getProjectState(project.id)));
  }

  return next;
}

/**
 * Creates a formatted display-path lookup for each project worktree.
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

/**
 * Builds shared worktree lookups reused by sidebar and workspace views.
 */
export function buildProjectWorktreeDerivedMaps({
  homeDirectory,
  projectWorktreesById,
  projects,
  supportsTildePath,
}: {
  homeDirectory: string;
  projectWorktreesById: ReadonlyMap<number, RpcWorktree[]>;
  projects: RpcProject[];
  supportsTildePath: boolean;
}): {
  readonly worktreeByProjectAndPath: ReadonlyMap<string, RpcWorktree>;
  readonly worktreeDisplayPathByKey: ReadonlyMap<string, string>;
} {
  const worktreeByProjectAndPath = new Map<string, RpcWorktree>();
  const worktreeDisplayPathByKey = new Map<string, string>();

  for (const project of projects) {
    for (const worktree of projectWorktreesById.get(project.id) ?? []) {
      const key = worktreeKey(project.id, worktree.path);
      worktreeByProjectAndPath.set(key, worktree);
      worktreeDisplayPathByKey.set(
        key,
        formatPathForDisplay(worktree.path, homeDirectory, supportsTildePath),
      );
    }
  }

  return {
    worktreeByProjectAndPath,
    worktreeDisplayPathByKey,
  };
}

/**
 * Search text indexes reused while sidebar filtering is active.
 */
export type SidebarProjectSearchIndexes = {
  readonly projectSearchTextById: ReadonlyMap<number, string>;
  readonly worktreeSearchTextByKey: ReadonlyMap<string, string>;
};

/**
 * Builds normalized search text indexes for projects and worktrees.
 */
export function buildSidebarProjectSearchIndexes({
  homeDirectory,
  projectWorktreesById,
  projects,
  supportsTildePath,
  worktreeDisplayPathByKey,
}: {
  homeDirectory: string;
  projectWorktreesById: ReadonlyMap<number, RpcWorktree[]>;
  projects: RpcProject[];
  supportsTildePath: boolean;
  worktreeDisplayPathByKey: ReadonlyMap<string, string>;
}): SidebarProjectSearchIndexes {
  const projectSearchTextById = new Map<number, string>();
  const worktreeSearchTextByKey = new Map<string, string>();

  for (const project of projects) {
    projectSearchTextById.set(
      project.id,
      buildNormalizedSearchText(
        project.name,
        project.path,
        formatPathForDisplay(project.path, homeDirectory, supportsTildePath),
      ),
    );

    for (const worktree of projectWorktreesById.get(project.id) ?? []) {
      const key = worktreeKey(project.id, worktree.path);
      worktreeSearchTextByKey.set(
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

  return {
    projectSearchTextById,
    worktreeSearchTextByKey,
  };
}

/**
 * Filters projects by the current normalized sidebar search query.
 */
export function filterProjectsBySidebarSearch({
  normalizedSidebarSearchQuery,
  projectSearchTextById,
  projectWorktreesById,
  projects,
  worktreeSearchTextByKey,
}: {
  normalizedSidebarSearchQuery: string;
  projectSearchTextById: ReadonlyMap<number, string>;
  projectWorktreesById: ReadonlyMap<number, RpcWorktree[]>;
  projects: RpcProject[];
  worktreeSearchTextByKey: ReadonlyMap<string, string>;
}): RpcProject[] {
  if (!normalizedSidebarSearchQuery) {
    return projects;
  }

  return projects.filter((project) => {
    const matchingWorktree = (projectWorktreesById.get(project.id) ?? []).some(
      (worktree) =>
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
}

export function deriveActiveContextUsage(
  selectedThread: RpcThread | null,
  activeCodexModelOption: RpcModelOption | null,
): {
  contextWindowTokens: number;
  inputTokens: number;
} {
  return {
    inputTokens: selectedThread?.usage?.inputTokens ?? 0,
    contextWindowTokens:
      selectedThread?.usage?.contextWindowTokens ??
      activeCodexModelOption?.contextWindowTokens ??
      400_000,
  };
}

export function deriveReasoningEffortSelectorDisabled({
  activeCodexModelOption,
  isCreatingThread,
  isSending,
  isThreadLoading,
  isUpdatingThreadReasoningEffort,
  reasoningEfforts,
  selectedThreadIsWorking,
}: {
  activeCodexModelOption: RpcModelOption | null;
  isCreatingThread: boolean;
  isSending: boolean;
  isThreadLoading: boolean;
  isUpdatingThreadReasoningEffort: boolean;
  reasoningEfforts: RpcReasoningEffortOption[];
  selectedThreadIsWorking: boolean;
}): boolean {
  return (
    reasoningEfforts.length === 0 ||
    !codexModelSupportsThinkingLevel(activeCodexModelOption) ||
    isCreatingThread ||
    isThreadLoading ||
    isSending ||
    isUpdatingThreadReasoningEffort ||
    selectedThreadIsWorking
  );
}
