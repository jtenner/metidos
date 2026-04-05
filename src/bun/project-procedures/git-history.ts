/**
 * @file src/bun/project-procedures/git-history.ts
 * @description Module for git history.
 */

import {
  DEFAULT_GIT_HISTORY_PAGE_SIZE,
  type GitCommandOptions,
  type GitCommandPriority,
  normalizeGitCommandOptions,
  readGitCommitDiffResult,
  readGitHistoryPageEntries,
} from "../git";
import type {
  RpcGitCommitDiffResult,
  RpcGitHistoryEntry,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
} from "../rpc-schema";
import {
  awaitAbortableResult,
  createAbortError,
  readLruValue,
  throwIfAborted,
  writeLruValue,
} from "./shared";

const GIT_HISTORY_PREFETCH_CHUNK_SIZE = DEFAULT_GIT_HISTORY_PAGE_SIZE * 4;

/**
 * A request in-flight for a commit diff, shared between waiters.
 */
export type PendingGitCommitDiffRequest = {
  controller: AbortController;
  promise: Promise<RpcGitCommitDiffResult>;
  waiterCount: number;
};

/**
 * A request in-flight for paginated git-history prefetch.
 */
export type PendingGitHistoryPrefetch = {
  controller: AbortController;
  priority: GitCommandPriority;
  promise: Promise<void>;
};

/**
 * Cache envelope for a worktree's git history:
 * - loaded entries
 * - next pagination offset
 * - active prefetch request
 * - signature to invalidate stale fills
 */
export type WorktreeGitHistoryCacheState = {
  history: RpcWorktreeGitHistorySummary;
  historyEntries: RpcGitHistoryEntry[];
  historyNextOffset: number | null;
  historyPrefetch: PendingGitHistoryPrefetch | null;
  historySignature: string | null;
};
/**
 * Function of applyGitHistoryCachePage.
 * @param worktreeState - The value of `worktreeState`.
 * @param offset - The value of `offset`.
 * @param page - The value of `page`.
 */

export function applyGitHistoryCachePage(
  worktreeState: WorktreeGitHistoryCacheState,
  offset: number,
  page: {
    entries: RpcGitHistoryEntry[];
    nextOffset: number | null;
  },
): void {
  const prefix = worktreeState.historyEntries.slice(0, offset);
  worktreeState.historyEntries = [...prefix, ...page.entries];
  worktreeState.historyNextOffset = page.nextOffset;
}

/**
 * Whether cached entries already satisfy the requested window.
 * True also when history is fully loaded but short of requested offset.
 */
function hasGitHistoryCacheRange(
  worktreeState: WorktreeGitHistoryCacheState,
  offset: number,
  limit: number,
): boolean {
  if (worktreeState.historyEntries.length >= offset + limit) {
    return true;
  }

  return (
    worktreeState.historyNextOffset === null &&
    worktreeState.historyEntries.length >= offset
  );
}

/**
 * Build a page result from cache only (no disk access).
 */
export function buildGitHistoryResultFromCache(
  worktreeState: WorktreeGitHistoryCacheState,
  limit: number,
  offset: number,
): RpcWorktreeGitHistoryResult {
  const endOffset = Math.min(
    offset + limit,
    worktreeState.historyEntries.length,
  );

  return {
    ...worktreeState.history,
    entries: worktreeState.historyEntries.slice(offset, endOffset),
    limit,
    nextOffset:
      endOffset < worktreeState.historyEntries.length
        ? endOffset
        : worktreeState.historyNextOffset,
  };
}

/**
 * Cancel active prefetch for a worktree and clear marker so future callers can start fresh.
 */
export function abortGitHistoryPrefetch(
  worktreeState: WorktreeGitHistoryCacheState,
  reason: string,
): void {
  const prefetch = worktreeState.historyPrefetch;
  if (!prefetch) {
    return;
  }

  if (worktreeState.historyPrefetch === prefetch) {
    worktreeState.historyPrefetch = null;
  }
  prefetch.controller.abort(createAbortError(null, reason));
}

/**
 * Ensure cache has enough entries for the requested offset/limit.
 * Handles background/foreground prioritization and request coalescing.
 */
export async function fillGitHistoryCache(
  worktreeState: WorktreeGitHistoryCacheState,
  worktreePath: string,
  offset: number,
  limit: number,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<void> {
  const normalizedOptions = normalizeGitCommandOptions(options);
  while (
    !hasGitHistoryCacheRange(worktreeState, offset, limit) &&
    worktreeState.historyNextOffset !== null
  ) {
    throwIfAborted(
      normalizedOptions.signal,
      "Git history cache fill was aborted.",
    );
    const currentPrefetch = worktreeState.historyPrefetch;
    if (
      currentPrefetch &&
      normalizedOptions.priority === "foreground" &&
      currentPrefetch.priority === "background"
    ) {
      abortGitHistoryPrefetch(
        worktreeState,
        `Foreground git history request replaced background warming for ${worktreePath}.`,
      );
      continue;
    }
    if (currentPrefetch) {
      await awaitAbortableResult(
        currentPrefetch.promise,
        normalizedOptions.signal,
        "Git history cache fill was aborted.",
      );
      continue;
    }

    const expectedSignature = worktreeState.historySignature;
    const fetchOffset = worktreeState.historyEntries.length;
    const fetchLimit = Math.max(
      GIT_HISTORY_PREFETCH_CHUNK_SIZE,
      offset + limit - fetchOffset,
    );
    const controller = new AbortController();
    const prefetch: PendingGitHistoryPrefetch = {
      controller,
      priority: normalizedOptions.priority,
      promise: Promise.resolve(),
    };
    const promise = (async () => {
      try {
        const page = await readGitHistoryPageEntries(
          worktreePath,
          fetchOffset,
          fetchLimit,
          {
            priority: normalizedOptions.priority,
            signal: controller.signal,
          },
        );
        if (
          worktreeState.historySignature !== expectedSignature ||
          worktreeState.historyEntries.length !== fetchOffset
        ) {
          return;
        }
        applyGitHistoryCachePage(worktreeState, fetchOffset, page);
      } finally {
        if (worktreeState.historyPrefetch === prefetch) {
          worktreeState.historyPrefetch = null;
        }
      }
    })();
    prefetch.promise = promise;
    worktreeState.historyPrefetch = prefetch;
    await awaitAbortableResult(
      promise,
      normalizedOptions.signal,
      "Git history cache fill was aborted.",
    );
  }
}

/**
 * Kick off non-blocking background prefetch for one additional page.
 * No-op when history is exhausted or prefetch already in-flight.
 */
export function warmGitHistoryCache(
  worktreeState: WorktreeGitHistoryCacheState,
  worktreePath: string,
  onBackgroundError: (message: string, error: unknown) => void,
): void {
  if (
    worktreeState.historyNextOffset === null ||
    worktreeState.historyPrefetch
  ) {
    return;
  }

  void fillGitHistoryCache(
    worktreeState,
    worktreePath,
    worktreeState.historyEntries.length,
    DEFAULT_GIT_HISTORY_PAGE_SIZE + 1,
    "background",
  ).catch((error) => {
    onBackgroundError(`Git history prefetch failed for ${worktreePath}`, error);
  });
}

/**
 * Build stable cache key for per-(worktree,commit) diff lookups.
 */
export function gitCommitDiffCacheKey(
  worktreePath: string,
  commitHash: string,
): string {
  return `${worktreePath}\n${commitHash}`;
}

/**
 * Read commit diff from LRU cache when possible.
 * Coalesces concurrent misses, and aborts pending request if nobody is waiting.
 */
export async function getCachedGitCommitDiffResult(
  projectId: number,
  worktreePath: string,
  commitHash: string,
  options: {
    gitCommitDiffCache: Map<string, RpcGitCommitDiffResult>;
    gitCommitDiffRequestCache: Map<string, PendingGitCommitDiffRequest>;
    maxEntries: number;
    requestOptions?: GitCommandPriority | GitCommandOptions | undefined;
  },
): Promise<RpcGitCommitDiffResult> {
  const normalizedOptions = normalizeGitCommandOptions(options.requestOptions);
  const cacheKey = gitCommitDiffCacheKey(worktreePath, commitHash);
  const cached = readLruValue(options.gitCommitDiffCache, cacheKey);
  if (cached) {
    return cached;
  }

  const pending = options.gitCommitDiffRequestCache.get(cacheKey);
  if (pending) {
    pending.waiterCount += 1;
    try {
      return await awaitAbortableResult(
        pending.promise,
        normalizedOptions.signal,
        "Commit diff read was aborted.",
      );
    } finally {
      pending.waiterCount = Math.max(0, pending.waiterCount - 1);
      if (
        pending.waiterCount === 0 &&
        options.gitCommitDiffRequestCache.get(cacheKey) === pending
      ) {
        pending.controller.abort(
          createAbortError(null, "Commit diff read was aborted."),
        );
      }
    }
  }

  const controller = new AbortController();
  const pendingRequest: PendingGitCommitDiffRequest = {
    controller,
    promise: Promise.resolve(null as never),
    waiterCount: 1,
  };
  const promise = readGitCommitDiffResult(projectId, worktreePath, commitHash, {
    priority: normalizedOptions.priority,
    signal: controller.signal,
  })
    .then((result) => {
      writeLruValue(
        options.gitCommitDiffCache,
        cacheKey,
        result,
        options.maxEntries,
      );
      return result;
    })
    .finally(() => {
      if (options.gitCommitDiffRequestCache.get(cacheKey) === pendingRequest) {
        options.gitCommitDiffRequestCache.delete(cacheKey);
      }
    });
  pendingRequest.promise = promise;
  options.gitCommitDiffRequestCache.set(cacheKey, pendingRequest);

  try {
    return await awaitAbortableResult(
      promise,
      normalizedOptions.signal,
      "Commit diff read was aborted.",
    );
  } finally {
    pendingRequest.waiterCount = Math.max(0, pendingRequest.waiterCount - 1);
    if (
      pendingRequest.waiterCount === 0 &&
      options.gitCommitDiffRequestCache.get(cacheKey) === pendingRequest
    ) {
      controller.abort(createAbortError(null, "Commit diff read was aborted."));
    }
  }
}
