/**
 * @file src/mainview/app/git-history-state.ts
 * @description Git history pagination, cache, and display-state helpers.
 */

import type { UIEvent } from "react";

import type {
  RpcGitHistoryEntry,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";

/**
 * Modal state for the git history diff viewer tied to one worktree entry.
 */
export type GitHistoryModalState = {
  projectId: number;
  worktreePath: string;
  entry: RpcGitHistoryEntry;
  diffText: string;
  loading: boolean;
  error: string;
};

/**
 * Cached git history diff payload keyed by commit for quick reopening.
 */
export type GitHistoryDiffCacheEntry = {
  commit: RpcGitHistoryEntry;
  diffText: string;
};

/**
 * Git history pagination/window constants used by list rendering and requests.
 */
export const GIT_HISTORY_PAGE_SIZE = 20;
export const GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES = 4;
export const GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES = 12;
export const GIT_HISTORY_RESULT_CACHE_MAX_BYTES = 1024 * 1024;
export const GIT_HISTORY_DIFF_CACHE_MAX_BYTES = 4 * 1024 * 1024;
export const GIT_HISTORY_RESULT_CACHE_IDLE_TTL_MS = 30 * 60 * 1000;
export const GIT_HISTORY_DIFF_CACHE_IDLE_TTL_MS = 15 * 60 * 1000;
export const GIT_HISTORY_CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
export const GIT_HISTORY_MAX_RETAINED_ENTRIES = 200;
export const GIT_HISTORY_ROW_HEIGHT_PX = 58;
export const GIT_HISTORY_DOM_WINDOW_SIZE = 20;
export const GIT_HISTORY_RENDER_OVERSCAN_ROWS = 8;
export const GIT_HISTORY_LOAD_MORE_THRESHOLD_PX = GIT_HISTORY_ROW_HEIGHT_PX * 3;

/**
 * Builds a stable cache key for a worktree diff by commit hash.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 * @param commitHash - Commit hash for the requested diff.
 */
export function gitHistoryDiffCacheKey(
  projectId: number,
  worktreePath: string,
  commitHash: string,
): string {
  return `${projectId}::${worktreePath}::${commitHash}`;
}

/**
 * Replace current page while preserving pre-existing entries that are not duplicated by
 * the server page.
 */
export function trimGitHistoryResultEntries(
  result: RpcWorktreeGitHistoryResult,
): RpcWorktreeGitHistoryResult {
  if (result.entries.length <= GIT_HISTORY_MAX_RETAINED_ENTRIES) {
    return result;
  }

  return {
    ...result,
    entries: result.entries.slice(0, GIT_HISTORY_MAX_RETAINED_ENTRIES),
    nextOffset: null,
  };
}

function estimateStringBytes(value: string | null | undefined): number {
  return value ? value.length * 2 : 0;
}

function estimateGitHistoryEntryBytes(entry: RpcGitHistoryEntry): number {
  return (
    estimateStringBytes(entry.hash) +
    estimateStringBytes(entry.shortHash) +
    estimateStringBytes(entry.subject) +
    estimateStringBytes(entry.authorName) +
    estimateStringBytes(entry.committedAt)
  );
}

export function estimateGitHistoryResultBytes(
  result: RpcWorktreeGitHistoryResult,
): number {
  return (
    estimateStringBytes(result.worktreePath) +
    estimateStringBytes(result.branch) +
    estimateStringBytes(result.headHash) +
    estimateStringBytes(result.headShortHash) +
    result.entries.reduce(
      (totalBytes, entry) => totalBytes + estimateGitHistoryEntryBytes(entry),
      0,
    )
  );
}

export function estimateGitHistoryDiffCacheEntryBytes(
  entry: GitHistoryDiffCacheEntry,
): number {
  return (
    estimateGitHistoryEntryBytes(entry.commit) +
    estimateStringBytes(entry.diffText)
  );
}

export function mergeResetGitHistory(
  current: RpcWorktreeGitHistoryResult | null,
  nextPage: RpcWorktreeGitHistoryResult,
): RpcWorktreeGitHistoryResult {
  if (
    !current ||
    current.projectId !== nextPage.projectId ||
    current.worktreePath !== nextPage.worktreePath ||
    current.headHash !== nextPage.headHash ||
    current.branch !== nextPage.branch
  ) {
    return trimGitHistoryResultEntries(nextPage);
  }

  const nextHashes = new Set(nextPage.entries.map((entry) => entry.hash));
  const preservedTail = current.entries.filter(
    (entry) => !nextHashes.has(entry.hash),
  );

  return trimGitHistoryResultEntries({
    ...nextPage,
    entries: [...nextPage.entries, ...preservedTail],
    nextOffset:
      preservedTail.length > 0 ? current.nextOffset : nextPage.nextOffset,
  });
}

/**
 * Appends a new worktree history page while de-duping existing entries.
 * @param current - Current page state.
 * @param nextPage - Newly loaded page.
 */
export function appendGitHistoryPage(
  current: RpcWorktreeGitHistoryResult,
  nextPage: RpcWorktreeGitHistoryResult,
): RpcWorktreeGitHistoryResult {
  const existingHashes = new Set(current.entries.map((entry) => entry.hash));
  const appendedEntries = nextPage.entries.filter(
    (entry) => !existingHashes.has(entry.hash),
  );

  return trimGitHistoryResultEntries({
    ...current,
    branch: nextPage.branch,
    headHash: nextPage.headHash,
    headShortHash: nextPage.headShortHash,
    lastUpdatedAt: nextPage.lastUpdatedAt,
    entries: [...current.entries, ...appendedEntries],
    limit: nextPage.limit,
    nextOffset: nextPage.nextOffset,
  });
}

/**
 * Checks whether a scroll container is close enough to the end to prefetch another history page.
 */
export function isGitHistoryLoadMoreThresholdReached(
  container: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    GIT_HISTORY_LOAD_MORE_THRESHOLD_PX
  );
}

/**
 * Store current scroll position and trigger lazy load when nearing the list end.
 */
export function handleGitHistoryScrollPosition(
  event: UIEvent<HTMLDivElement>,
  setScrollTop: (value: number) => void,
  onThreshold: () => void,
): void {
  const container = event.currentTarget;
  setScrollTop(container.scrollTop);

  if (isGitHistoryLoadMoreThresholdReached(container)) {
    onThreshold();
  }
}
