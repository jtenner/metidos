/**
 * @file src/mainview/app/thread-store.ts
 * @description Focused Thread store, ordering, and error-preview helpers.
 */

import type {
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
} from "../../bun/rpc-schema";
import type { ProjectStore } from "./project-store";

export type ThreadStore = {
  byId: Record<number, RpcThread>;
  orderedIds: number[];
};

export const THREAD_STORE_MAX_RETAINED_THREADS = 500;

/**
 * Coarser-grain thread health classification used for badges and ordering.
 */
export type ThreadErrorLevel = "none" | "stopped" | "failed" | "unread";

/**
 * Thread summary shown in warning/error popovers.
 */
export type ThreadErrorPreview = {
  level: ThreadErrorLevel;
  text: string;
  updatedAt: string;
};

export function emptyThreadStore(): ThreadStore {
  return {
    byId: {},
    orderedIds: [],
  };
}

/**
 * Reads all threads from a thread store using its current ordering.
 */
export function threadStoreItems(store: ThreadStore): RpcThread[] {
  const items: RpcThread[] = [];

  for (const threadId of store.orderedIds) {
    const thread = store.byId[threadId];
    if (thread) {
      items.push(thread);
    }
  }

  return items;
}

/**
 * Reads a thread by id from a thread store.
 */
export function threadStoreGet(
  store: ThreadStore,
  threadId: number,
): RpcThread | null {
  return store.byId[threadId] ?? null;
}

/**
 * Extracts run status with an idle fallback when thread is absent.
 */
export function threadRunStatus(thread: RpcThread | null): RpcThreadRunStatus {
  return (
    thread?.runStatus ?? {
      state: "idle",
      startedAt: null,
      updatedAt: "",
      error: null,
      hasUnreadError: false,
    }
  );
}

/**
 * Computes thread error level from run status and unread-error state.
 */
export function threadErrorLevel(thread: RpcThread): ThreadErrorLevel {
  if (thread.runStatus.hasUnreadError) {
    return "unread";
  }
  if (thread.runStatus.state === "failed") {
    return "failed";
  }
  if (thread.runStatus.state === "stopped") {
    return "stopped";
  }
  return "none";
}

/**
 * Merges thread error level.
 */
export function mergeThreadErrorLevel(
  left: ThreadErrorLevel,
  right: ThreadErrorLevel,
): ThreadErrorLevel {
  return threadErrorLevelWeight(left) >= threadErrorLevelWeight(right)
    ? left
    : right;
}

/**
 * Convert thread-level error level into sortable numeric precedence.
 */
export function threadErrorLevelWeight(level: ThreadErrorLevel): number {
  switch (level) {
    case "unread":
      return 3;
    case "failed":
      return 2;
    case "stopped":
      return 1;
    default:
      return 0;
  }
}

/**
 * Build an error preview payload when thread has a user-visible error string.
 */
export function threadErrorPreview(
  thread: RpcThread,
): ThreadErrorPreview | null {
  const text = thread.runStatus.error?.trim();
  if (!text) {
    return null;
  }

  return {
    level: threadErrorLevel(thread),
    text,
    updatedAt: thread.runStatus.updatedAt ?? thread.updatedAt,
  };
}

/**
 * Chooses the preferred error preview from current and next candidates.
 */
export function pickPreferredThreadErrorPreview(
  current: ThreadErrorPreview | undefined,
  next: ThreadErrorPreview,
): ThreadErrorPreview {
  if (!current) {
    return next;
  }

  const currentWeight = threadErrorLevelWeight(current.level);
  const nextWeight = threadErrorLevelWeight(next.level);
  if (nextWeight !== currentWeight) {
    return nextWeight > currentWeight ? next : current;
  }

  return next.updatedAt.localeCompare(current.updatedAt) >= 0 ? next : current;
}

/**
 * Sorts threads.
 */
export function sortThreads(items: RpcThread[]): RpcThread[] {
  return [...items].sort(compareThreadsByRecency);
}

/**
 * Timestamp used for list ordering and row display. Stopped/failed run-status
 * updates can arrive before the persisted Thread summary's updatedAt catches up,
 * so reflect the terminal status timestamp when it is newer.
 */
export function threadListUpdatedAt(thread: RpcThread): string {
  if (
    (thread.runStatus.state === "stopped" ||
      thread.runStatus.state === "failed") &&
    thread.runStatus.updatedAt &&
    thread.runStatus.updatedAt > thread.updatedAt
  ) {
    return thread.runStatus.updatedAt;
  }

  return thread.updatedAt;
}

/**
 * Partitions an already-ordered thread list into pinned and unpinned arrays.
 */
export function partitionOrderedThreadsByPinnedState(items: RpcThread[]): {
  readonly activeThreads: RpcThread[];
  readonly pinnedThreads: RpcThread[];
} {
  const pinnedThreads: RpcThread[] = [];
  const activeThreads: RpcThread[] = [];

  for (const thread of items) {
    if (thread.pinnedAt !== null) {
      pinnedThreads.push(thread);
      continue;
    }

    activeThreads.push(thread);
  }

  return {
    activeThreads,
    pinnedThreads,
  };
}

function findThreadInsertionIndex(
  items: RpcThread[],
  thread: RpcThread,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midThread = items[mid];
    if (midThread && compareThreadsByRecency(midThread, thread) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function findThreadStoreInsertionIndex(
  orderedIds: number[],
  byId: Record<number, RpcThread>,
  thread: RpcThread,
): number {
  let low = 0;
  let high = orderedIds.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midThreadId = orderedIds[mid];
    const midThread = midThreadId ? byId[midThreadId] : undefined;
    if (midThread && compareThreadsByRecency(midThread, thread) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Order pinned threads by pinned timestamp. Otherwise, keep actively turning
 * threads first, then fall back to last updated date.
 */
export function compareThreadsByRecency(
  left: RpcThread,
  right: RpcThread,
): number {
  const leftPinnedAt = left.pinnedAt ?? "";
  const rightPinnedAt = right.pinnedAt ?? "";
  if (leftPinnedAt || rightPinnedAt) {
    if (!leftPinnedAt) {
      return 1;
    }
    if (!rightPinnedAt) {
      return -1;
    }
    if (leftPinnedAt !== rightPinnedAt) {
      return rightPinnedAt.localeCompare(leftPinnedAt);
    }
  }

  const leftIsTurning = left.runStatus.state === "working";
  const rightIsTurning = right.runStatus.state === "working";
  if (leftIsTurning !== rightIsTurning) {
    return leftIsTurning ? -1 : 1;
  }

  return threadListUpdatedAt(right).localeCompare(threadListUpdatedAt(left));
}

function parseThreadSnapshotTimestamp(
  value: string | null | undefined,
): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareThreadsByFreshness(left: RpcThread, right: RpcThread): number {
  const updatedAtComparison =
    parseThreadSnapshotTimestamp(left.updatedAt) -
    parseThreadSnapshotTimestamp(right.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }

  return (
    parseThreadSnapshotTimestamp(left.runStatus?.updatedAt) -
    parseThreadSnapshotTimestamp(right.runStatus?.updatedAt)
  );
}

function stringArraysEqual(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return (
    leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index])
  );
}

function threadQueueStatusesEqual(
  left: RpcThreadRunStatus["queue"],
  right: RpcThreadRunStatus["queue"],
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.pendingMessageCount === right.pendingMessageCount &&
    left.steeringMessageCount === right.steeringMessageCount &&
    left.followUpMessageCount === right.followUpMessageCount
  );
}

export function threadRunStatusesEqual(
  left: RpcThreadRunStatus,
  right: RpcThreadRunStatus,
): boolean {
  return (
    left.state === right.state &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.error === right.error &&
    left.hasUnreadError === right.hasUnreadError &&
    left.phase === right.phase &&
    threadQueueStatusesEqual(left.queue, right.queue)
  );
}

function threadUsageEqual(
  left: RpcThread["usage"],
  right: RpcThread["usage"],
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.contextWindowTokens === right.contextWindowTokens
  );
}

function threadCompactionsEqual(
  left: RpcThread["compaction"] | null | undefined,
  right: RpcThread["compaction"] | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.estimatedTriggerTokens === right.estimatedTriggerTokens &&
    left.estimatedTriggerSource === right.estimatedTriggerSource &&
    left.maxObservedInputTokens === right.maxObservedInputTokens &&
    left.inferredCount === right.inferredCount &&
    left.lastInferredAt === right.lastInferredAt &&
    left.lastInferredBeforeInputTokens ===
      right.lastInferredBeforeInputTokens &&
    left.lastInferredAfterInputTokens === right.lastInferredAfterInputTokens
  );
}

export function threadsEquivalent(left: RpcThread, right: RpcThread): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.worktreePath === right.worktreePath &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort &&
    left.webSearchAccess === right.webSearchAccess &&
    left.githubAccess === right.githubAccess &&
    left.gitAccess === right.gitAccess &&
    left.sqliteAccess === right.sqliteAccess &&
    left.webServerAccess === right.webServerAccess &&
    left.agentsAccess === right.agentsAccess &&
    left.calendarAccess === right.calendarAccess &&
    left.notificationsAccess === right.notificationsAccess &&
    left.weatherAccess === right.weatherAccess &&
    left.threadsAccess === right.threadsAccess &&
    left.cronsAccess === right.cronsAccess &&
    left.metidosAccess === right.metidosAccess &&
    stringArraysEqual(left.pluginAccessGroups, right.pluginAccessGroups) &&
    stringArraysEqual(left.permissions, right.permissions) &&
    left.unsafeMode === right.unsafeMode &&
    left.piSessionId === right.piSessionId &&
    left.piSessionFile === right.piSessionFile &&
    left.piLeafEntryId === right.piLeafEntryId &&
    left.pinnedAt === right.pinnedAt &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastRunAt === right.lastRunAt &&
    threadUsageEqual(left.usage, right.usage) &&
    threadCompactionsEqual(left.compaction, right.compaction) &&
    threadRunStatusesEqual(left.runStatus, right.runStatus)
  );
}

export function threadStoresEquivalent(
  left: ThreadStore,
  right: ThreadStore,
): boolean {
  if (left.orderedIds.length !== right.orderedIds.length) {
    return false;
  }
  return left.orderedIds.every((threadId, index) => {
    if (right.orderedIds[index] !== threadId) {
      return false;
    }
    const leftThread = left.byId[threadId];
    const rightThread = right.byId[threadId];
    return Boolean(
      leftThread && rightThread && threadsEquivalent(leftThread, rightThread),
    );
  });
}

/**
 * Picks a preferred thread for a worktree, favoring pinned/recency.
 */
export function preferredThreadForWorktree(
  threads: RpcThread[],
  projectId: number,
  worktreePath: string,
): RpcThread | null {
  let preferredThread: RpcThread | null = null;
  for (const thread of threads) {
    if (
      thread.projectId !== projectId ||
      thread.worktreePath !== worktreePath
    ) {
      continue;
    }
    if (
      preferredThread === null ||
      compareThreadsByRecency(thread, preferredThread) < 0
    ) {
      preferredThread = thread;
    }
  }

  return preferredThread;
}

/**
 * Returns the most recent thread for a project/worktree.
 */
export function latestThreadForWorktree(
  threads: RpcThread[],
  projectId: number,
  worktreePath: string,
): RpcThread | null {
  let latestThread: RpcThread | null = null;
  for (const thread of threads) {
    if (
      thread.projectId !== projectId ||
      thread.worktreePath !== worktreePath
    ) {
      continue;
    }
    if (
      latestThread === null ||
      compareThreadsByRecency(thread, latestThread) < 0
    ) {
      latestThread = thread;
    }
  }

  return latestThread;
}

/**
 * Return most recent pinned thread for a worktree, if any.
 */
export function pinnedThreadForWorktree(
  threads: RpcThread[],
  projectId: number,
  worktreePath: string,
): RpcThread | null {
  let pinnedThread: RpcThread | null = null;
  for (const thread of threads) {
    if (
      thread.projectId !== projectId ||
      thread.worktreePath !== worktreePath ||
      thread.pinnedAt === null
    ) {
      continue;
    }
    if (
      pinnedThread === null ||
      compareThreadsByRecency(thread, pinnedThread) < 0
    ) {
      pinnedThread = thread;
    }
  }

  return pinnedThread;
}

export function shouldAcceptThreadStoreUpdate(
  projectStore: ProjectStore,
  threadStore: ThreadStore,
  thread: RpcThread,
): boolean {
  return (
    typeof projectStore.byId[thread.projectId] !== "undefined" ||
    typeof threadStore.byId[thread.id] !== "undefined"
  );
}

/**
 * Upserts thread list.
 */
export function upsertThreadList(
  items: RpcThread[],
  thread: RpcThread,
): RpcThread[] {
  const existingIndex = items.findIndex((entry) => entry.id === thread.id);
  if (existingIndex === -1) {
    const insertionIndex = findThreadInsertionIndex(items, thread);
    const next = items.slice();
    next.splice(insertionIndex, 0, thread);
    return next;
  }

  const existingThread = items[existingIndex];
  if (!existingThread) {
    return items;
  }

  if (existingThread === thread || threadsEquivalent(existingThread, thread)) {
    return items;
  }

  if (compareThreadsByFreshness(thread, existingThread) < 0) {
    return items;
  }

  const previousThread =
    existingIndex > 0 ? (items[existingIndex - 1] ?? null) : null;
  const nextThread =
    existingIndex < items.length - 1
      ? (items[existingIndex + 1] ?? null)
      : null;
  const staysInPlace =
    (previousThread === null ||
      compareThreadsByRecency(previousThread, thread) <= 0) &&
    (nextThread === null || compareThreadsByRecency(thread, nextThread) <= 0);
  if (staysInPlace) {
    const next = items.slice();
    next[existingIndex] = thread;
    return next;
  }

  const next = items.slice();
  next.splice(existingIndex, 1);
  const insertionIndex = findThreadInsertionIndex(next, thread);
  next.splice(insertionIndex, 0, thread);
  return next;
}

/**
 * Returns a thread copy with unread error state acknowledged.
 */
export function withAcknowledgedUnreadThread(thread: RpcThread): RpcThread {
  if (!thread.runStatus.hasUnreadError) {
    return thread;
  }

  return {
    ...thread,
    runStatus: {
      ...thread.runStatus,
      hasUnreadError: false,
    },
  };
}

/**
 * Returns thread detail with unread error state acknowledged.
 */
export function withAcknowledgedUnreadThreadDetail(
  detail: RpcThreadDetail,
): RpcThreadDetail {
  if (!detail.thread.runStatus.hasUnreadError) {
    return detail;
  }

  return {
    ...detail,
    thread: withAcknowledgedUnreadThread(detail.thread),
  };
}

/**
 * Remove a thread by id and return the remaining list.
 */
export function removeThreadFromList(
  items: RpcThread[],
  threadId: number,
): RpcThread[] {
  return items.filter((thread) => thread.id !== threadId);
}

/**
 * Creates thread store.
 */
export function createThreadStore(items: RpcThread[]): ThreadStore {
  const byId: Record<number, RpcThread> = {};

  for (const thread of items) {
    const existingThread = byId[thread.id];
    if (
      !existingThread ||
      compareThreadsByFreshness(thread, existingThread) >= 0
    ) {
      byId[thread.id] = thread;
    }
  }

  const orderedIds = Object.values(byId)
    .sort(compareThreadsByRecency)
    .map((thread) => thread.id);

  return {
    byId,
    orderedIds,
  };
}

/**
 * Prunes stale retained threads while preserving active and important rows.
 */
export function pruneThreadStore(
  store: ThreadStore,
  options?: {
    maxRetainedThreads?: number;
    preserveThreadIds?: readonly number[];
  },
): ThreadStore {
  const maxRetainedThreads =
    options?.maxRetainedThreads ?? THREAD_STORE_MAX_RETAINED_THREADS;
  if (store.orderedIds.length <= maxRetainedThreads) {
    return store;
  }

  const retainedIds = new Set<number>();
  for (const threadId of options?.preserveThreadIds ?? []) {
    if (store.byId[threadId]) {
      retainedIds.add(threadId);
    }
  }
  // Preserve important rows before enforcing the soft retention target. Pinned,
  // working, and unread-error Threads may intentionally make the retained set
  // exceed maxRetainedThreads; the remaining fill then follows current recency
  // order from orderedIds.
  for (const threadId of store.orderedIds) {
    const thread = store.byId[threadId];
    if (!thread) {
      continue;
    }
    if (
      thread.pinnedAt !== null ||
      thread.runStatus.state === "working" ||
      thread.runStatus.hasUnreadError
    ) {
      retainedIds.add(threadId);
    }
  }

  for (const threadId of store.orderedIds) {
    if (retainedIds.size >= maxRetainedThreads) {
      break;
    }
    if (store.byId[threadId]) {
      retainedIds.add(threadId);
    }
  }

  const orderedIds = store.orderedIds.filter((threadId) =>
    retainedIds.has(threadId),
  );
  if (orderedIds.length === store.orderedIds.length) {
    return store;
  }

  const byId: Record<number, RpcThread> = {};
  for (const threadId of orderedIds) {
    const thread = store.byId[threadId];
    if (thread) {
      byId[threadId] = thread;
    }
  }

  return {
    byId,
    orderedIds,
  };
}

/**
 * Upserts thread store.
 */
export function upsertThreadStore(
  store: ThreadStore,
  thread: RpcThread,
): ThreadStore {
  const existingThread = store.byId[thread.id];
  if (!existingThread) {
    const orderedIds = store.orderedIds.slice();
    const insertionIndex = findThreadStoreInsertionIndex(
      orderedIds,
      store.byId,
      thread,
    );
    orderedIds.splice(insertionIndex, 0, thread.id);
    return {
      byId: {
        ...store.byId,
        [thread.id]: thread,
      },
      orderedIds,
    };
  }

  if (existingThread === thread || threadsEquivalent(existingThread, thread)) {
    return store;
  }

  if (compareThreadsByFreshness(thread, existingThread) < 0) {
    return store;
  }

  const existingIndex = store.orderedIds.indexOf(thread.id);
  if (existingIndex === -1) {
    return createThreadStore([...threadStoreItems(store), thread]);
  }

  const previousThreadId =
    existingIndex > 0 ? (store.orderedIds[existingIndex - 1] ?? null) : null;
  const nextThreadId =
    existingIndex < store.orderedIds.length - 1
      ? (store.orderedIds[existingIndex + 1] ?? null)
      : null;
  const previousThread =
    previousThreadId === null ? null : (store.byId[previousThreadId] ?? null);
  const nextThread =
    nextThreadId === null ? null : (store.byId[nextThreadId] ?? null);
  const staysInPlace =
    (previousThread === null ||
      compareThreadsByRecency(previousThread, thread) <= 0) &&
    (nextThread === null || compareThreadsByRecency(thread, nextThread) <= 0);
  if (staysInPlace) {
    return {
      byId: {
        ...store.byId,
        [thread.id]: thread,
      },
      orderedIds: store.orderedIds,
    };
  }

  const orderedIds = store.orderedIds.slice();
  orderedIds.splice(existingIndex, 1);
  const byId = {
    ...store.byId,
    [thread.id]: thread,
  };
  const insertionIndex = findThreadStoreInsertionIndex(
    orderedIds,
    byId,
    thread,
  );
  orderedIds.splice(insertionIndex, 0, thread.id);
  return {
    byId,
    orderedIds,
  };
}

/**
 * Removes thread from store.
 */
export function removeThreadFromStore(
  store: ThreadStore,
  threadId: number,
): ThreadStore {
  if (!store.byId[threadId]) {
    return store;
  }

  const byId = {
    ...store.byId,
  };
  delete byId[threadId];

  return {
    byId,
    orderedIds: store.orderedIds.filter((entryId) => entryId !== threadId),
  };
}
