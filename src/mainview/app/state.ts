/**
 * @file src/mainview/app/state.ts
 * @description Module for state.
 */

import type { UIEvent } from "react";

import type {
  RpcGitHistoryEntry,
  RpcProject,
  RpcReasoningEffort,
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
  RpcWorktree,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeSnapshot,
} from "../../bun/rpc-schema";

/**
 * Base chat-render payload shared by every visible row type.
 */
type VisibleMessageBase = {
  key: string;
};

export type VisibleMessage =
  | (VisibleMessageBase & {
      kind: "chat";
      speaker: "assistant" | "user";
      text: string;
      tone?: "normal" | "working" | "error" | "notice";
    })
  | (VisibleMessageBase & {
      kind: "reasoning";
      text: string;
      state: "in_progress" | "completed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "command";
      command: string;
      output: string;
      state: "in_progress" | "completed" | "failed" | "stopped";
      exitCode: number | null;
    })
  | (VisibleMessageBase & {
      kind: "file_change";
      path: string;
      diffText: string;
      changeKind: "add" | "delete" | "update";
      state: "in_progress" | "completed" | "failed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "tool_call";
      server: string;
      tool: string;
      argumentsText: string;
      output: string;
      state: "in_progress" | "completed" | "failed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "web_search";
      query: string;
      state: "in_progress" | "completed" | "stopped";
    })
  | (VisibleMessageBase & {
      kind: "error";
      text: string;
      state: "in_progress" | "completed" | "stopped";
    });

/**
 * Grouped conversation rows used by the thread message list.
 */
export type MessageGroup =
  | {
      kind: "assistant";
      key: string;
      messages: VisibleMessage[];
    }
  | {
      kind: "user";
      key: string;
      text: string;
    };

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
 * In-memory tree state for a single project and its worktrees.
 */
export type ProjectNodeState = {
  worktreeByPath: Record<string, RpcWorktree>;
  worktreePaths: string[];
  worktreesLoadedAt: number | null;
  loadingWorktrees: boolean;
  error: string;
  openWorktrees: Set<string>;
};

/**
 * In-memory state for a single worktree row and snapshot loading.
 */
export type WorktreeNodeState = {
  loading: boolean;
  opened: boolean;
  snapshot?: RpcWorktreeSnapshot | undefined;
  error: string;
};

export type ProjectStateMap = Record<number, ProjectNodeState>;
export type WorktreeStateMap = Record<string, WorktreeNodeState>;

export type ProjectStore = {
  byId: Record<number, RpcProject>;
  orderedIds: number[];
};

export type ThreadStore = {
  byId: Record<number, RpcThread>;
  orderedIds: number[];
};

/**
 * UI anchor for project context menu rendering.
 */
export type ProjectActionMenuState = {
  projectId: number;
  x: number;
  y: number;
};

/**
 * Context-menu coordinates for a single thread row action menu.
 */
export type ThreadActionMenuState = {
  threadId: number;
  x: number;
  y: number;
};

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

/**
 * Popover payload for inline thread warning/error text.
 */
export type ErrorPreviewPopoverState = {
  anchorId: string;
  text: string;
  x: number;
  y: number;
};

/**
 * Popover payload for thread summary content display.
 */
export type ThreadSummaryPopoverState = {
  anchorId: string;
  title: string;
  summary: string;
  x: number;
  y: number;
};

/**
 * Persisted tuple describing an expanded/open worktree.
 */
export type PersistedOpenWorktree = {
  projectId: number;
  worktreePath: string;
};

/**
 * Persisted global UI state for selected project/worktree/thread and composer inputs.
 */
export type PersistedMainviewState = {
  version: number;
  selectedProjectId: number | null;
  selectedWorktreePath: string | null;
  selectedThreadId: number | null;
  pendingThreadModel: string;
  pendingThreadReasoningEffort: string;
  pendingThreadGithubAccess: boolean;
  pendingThreadAgentsAccess: boolean;
  pendingThreadMetidosAccess: boolean;
  pendingThreadUnsafeMode: boolean;
  chatInput: string;
  sidebarCollapsed: boolean;
  sidebarSearchQuery: string;
  openWorktrees: PersistedOpenWorktree[];
};

type PersistedMainviewStorageRecord = Omit<
  PersistedMainviewState,
  | "chatInput"
  | "pendingThreadAgentsAccess"
  | "pendingThreadGithubAccess"
  | "pendingThreadMetidosAccess"
  | "pendingThreadUnsafeMode"
>;

/**
 * Persisted sidebar expansion state for all left-tree sections.
 */
export type PersistedTreeViewState = {
  version: number;
  workspaceSectionOpen: boolean;
  workspaceActiveSectionOpen: boolean;
  projectsSectionOpen: boolean;
  threadsSectionOpen: boolean;
  gitSectionOpen: boolean;
  openProjectPaths: string[];
};

/**
 * Cached directory suggestions for filesystem path autocomplete.
 */
export type DirectorySuggestionResultCacheEntry = {
  directories: string[];
  loadedAt: number;
};

/**
 * Internal tracker for a deduplicated async request and its waiting consumers.
 */
export type PendingSharedRequest<T> = {
  controller: AbortController;
  promise: Promise<T>;
  waiterCount: number;
};

/**
 * Optional details used when opening a thread and validating selection.
 */
export type OpenThreadOptions = {
  detailPromise?: Promise<RpcThreadDetail> | null;
  selectionGuard?: {
    projectId: number;
    worktreePath: string;
  } | null;
};

export const THREAD_START_REQUEST_CREATED_EVENT_NAME =
  "metidos:thread-start-request-created";
export const CONTEXT_FOCUS_CHANGED_EVENT_NAME = "metidos:context-focus-changed";
export const THREAD_EXTENSION_UI_EVENT_NAME = "metidos:thread-extension-ui";
/**
 * Delay before firing directory suggestion network calls to avoid noisy typing.
 */
export const DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS = 50;
export const DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES = 128;
export const DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS = 30_000;
const FORMAT_PATH_FOR_DISPLAY_CACHE_MAX_ENTRIES = 2_048;
const formatPathForDisplayCache = new Map<string, string>();
/**
 * Git history pagination/window constants used by list rendering and requests.
 */
export const GIT_HISTORY_PAGE_SIZE = 20;
export const GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES = 8;
export const GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES = 24;
export const GIT_HISTORY_ROW_HEIGHT_PX = 58;
export const GIT_HISTORY_DOM_WINDOW_SIZE = 20;
export const GIT_HISTORY_RENDER_OVERSCAN_ROWS = 8;
export const GIT_HISTORY_LOAD_MORE_THRESHOLD_PX = GIT_HISTORY_ROW_HEIGHT_PX * 3;
export const THREAD_STATUS_POLL_INTERVAL_MS = 1_500;
export const DESKTOP_COMPOSER_MIN_HEIGHT_PX = 96;
export const MOBILE_COMPOSER_MIN_HEIGHT_PX = 44;
export const COMPOSER_MAX_HEIGHT_PX = 240;
export const MAINVIEW_STATE_STORAGE_KEY = "metidos:mainview-state";
export const MAINVIEW_STATE_STORAGE_VERSION = 1;
export const MAINVIEW_STATE_WRITE_DEBOUNCE_MS = 160;
export const TREE_VIEW_STATE_STORAGE_KEY = "metidos:tree-view-state";
export const TREE_VIEW_STATE_STORAGE_VERSION = 1;
export const APP_TITLE = "Metidos";
const LEGACY_MAINVIEW_STATE_STORAGE_KEY = "jolt:mainview-state";
const LEGACY_TREE_VIEW_STATE_STORAGE_KEY = "jolt:tree-view-state";
const GIT_HISTORY_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const CODEX_REASONING_EFFORT_VALUES: RpcReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/**
 * Read-most-recently-used helper for cache access.
 */
export function readLruValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
): Value | null {
  if (!cache.has(key)) {
    return null;
  }

  const value = cache.get(key);
  if (typeof value === "undefined") {
    return null;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

/**
 * Write to an LRU-style cache and evict oldest keys when capacity is exceeded.
 */
export function writeLruValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  maxEntries: number,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      return;
    }
    cache.delete(oldest.value);
  }
}

/**
 * Normalize cancellation errors into typed `Error` values with stable `name`.
 */
export function createAbortError(
  reason: unknown,
  fallbackMessage: string,
): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" && reason.trim() ? reason : fallbackMessage,
    {
      cause: reason,
    },
  );
  if (reason instanceof DOMException && reason.name) {
    error.name = reason.name;
  } else {
    error.name = "AbortError";
  }
  return error;
}

/**
 * Detect abort/timeout errors for expected cancellation paths.
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Await a promise with optional abort support and a fallback reason message.
 */
export async function awaitAbortableResult<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined,
  fallbackMessage: string,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw createAbortError(signal.reason, fallbackMessage);
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(createAbortError(signal.reason, fallbackMessage));
    };
    signal.addEventListener("abort", handleAbort, {
      once: true,
    });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

/**
 * Return last path segment after normalizing trailing separators.
 */
export function shortName(value: string): string {
  const normalized = value.replace(/[\\/]$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}
/**
 * Builds a stable key for a project/worktree tuple.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 */

export function worktreeKey(projectId: number, worktreePath: string): string {
  return `${projectId}::${worktreePath}`;
}

/**
 * Clamp numeric value to inclusive min/max bounds.
 */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
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
 * Fresh project node state for newly loaded project entries.
 */
export function defaultProjectState(): ProjectNodeState {
  return {
    worktreeByPath: {},
    worktreePaths: [],
    worktreesLoadedAt: null,
    loadingWorktrees: false,
    error: "",
    openWorktrees: new Set(),
  };
}

/**
 * Fresh worktree node state for newly discovered worktree entries.
 */
export function defaultWorktreeState(): WorktreeNodeState {
  return {
    loading: false,
    opened: false,
    error: "",
  };
}
/**
 * Builds project worktree index.
 * @param worktrees - worktrees value.
 */

export function buildProjectWorktreeIndex(
  worktrees: RpcWorktree[],
): Pick<ProjectNodeState, "worktreeByPath" | "worktreePaths"> {
  const worktreeByPath: Record<string, RpcWorktree> = {};
  const worktreePaths: string[] = [];

  for (const worktree of worktrees) {
    worktreeByPath[worktree.path] = worktree;
    worktreePaths.push(worktree.path);
  }

  return {
    worktreeByPath,
    worktreePaths,
  };
}
/**
 * Extracts worktrees from a project state map in deterministic order.
 * @param state - Current state value.
 */

export function projectStateWorktrees(
  state: Pick<ProjectNodeState, "worktreeByPath" | "worktreePaths">,
): RpcWorktree[] {
  const worktrees: RpcWorktree[] = [];

  for (const path of state.worktreePaths) {
    const worktree = state.worktreeByPath[path];
    if (worktree) {
      worktrees.push(worktree);
    }
  }

  return worktrees;
}
/**
 * Returns the number of worktrees in a project state.
 * @param state - Current state value.
 */

export function projectStateWorktreeCount(
  state: Pick<ProjectNodeState, "worktreePaths">,
): number {
  return state.worktreePaths.length;
}

export function emptyProjectStore(): ProjectStore {
  return {
    byId: {},
    orderedIds: [],
  };
}

export function emptyThreadStore(): ThreadStore {
  return {
    byId: {},
    orderedIds: [],
  };
}
/**
 * Reads all projects from a project store using its current ordering.
 * @param store - Project store.
 */

export function projectStoreItems(store: ProjectStore): RpcProject[] {
  const items: RpcProject[] = [];

  for (const projectId of store.orderedIds) {
    const project = store.byId[projectId];
    if (project) {
      items.push(project);
    }
  }

  return items;
}
/**
 * Reads all threads from a thread store using its current ordering.
 * @param store - Thread store.
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
 * Reads a project by id from a project store.
 * @param store - Project store.
 * @param projectId - Project identifier.
 */

export function projectStoreGet(
  store: ProjectStore,
  projectId: number,
): RpcProject | null {
  return store.byId[projectId] ?? null;
}
/**
 * Reads a thread by id from a thread store.
 * @param store - Thread store.
 * @param threadId - Thread identifier.
 */

export function threadStoreGet(
  store: ThreadStore,
  threadId: number,
): RpcThread | null {
  return store.byId[threadId] ?? null;
}

/**
 * Replace current page while preserving pre-existing entries that are not duplicated by
 * the server page.
 */
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
    return nextPage;
  }

  const nextHashes = new Set(nextPage.entries.map((entry) => entry.hash));
  const preservedTail = current.entries.filter(
    (entry) => !nextHashes.has(entry.hash),
  );

  return {
    ...nextPage,
    entries: [...nextPage.entries, ...preservedTail],
    nextOffset:
      preservedTail.length > 0 ? current.nextOffset : nextPage.nextOffset,
  };
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

  return {
    ...current,
    branch: nextPage.branch,
    headHash: nextPage.headHash,
    headShortHash: nextPage.headShortHash,
    lastUpdatedAt: nextPage.lastUpdatedAt,
    entries: [...current.entries, ...appendedEntries],
    limit: nextPage.limit,
    nextOffset: nextPage.nextOffset,
  };
}
/**
 * Finds primary worktree.
 * @param project - project value.
 * @param worktrees - worktrees value.
 */

export function findPrimaryWorktree(
  project: RpcProject,
  worktrees: RpcWorktree[],
): RpcWorktree | null {
  return worktrees.find((worktree) => worktree.path === project.path) ?? null;
}

/**
 * Resolve the canonical primary worktree path, falling back to project path.
 */
export function primaryWorktreePath(
  project: RpcProject,
  worktrees: RpcWorktree[],
): string {
  return findPrimaryWorktree(project, worktrees)?.path ?? project.path;
}
/**
 * Orders worktrees for sidebar/workspace selection.
 * Pinned worktrees appear first, then the remainder is sorted by workspace
 * display name and full path for stability.
 * @param project - project value.
 * @param worktrees - worktrees value.
 */

export function orderProjectWorktrees(
  _project: RpcProject,
  worktrees: RpcWorktree[],
): RpcWorktree[] {
  return [...worktrees].sort((left, right) => {
    const leftPinned = left.pinnedAt !== null;
    const rightPinned = right.pinnedAt !== null;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }

    const leftName = shortName(left.path);
    const rightName = shortName(right.path);
    const nameCompare = leftName.localeCompare(rightName);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return left.path.localeCompare(right.path);
  });
}
/**
 * Returns the display label for a worktree.
 * @param worktree - Worktree entry.
 */

export function worktreeDisplayName(worktree: RpcWorktree | null): string {
  return worktree?.branch ?? "Primary";
}

/**
 * Stable anchor id for the active worktree row thread-switcher trigger.
 */
export function worktreeThreadPopoverAnchorId(
  projectId: number,
  worktreePath: string,
): string {
  return `worktree-thread-anchor-${projectId}-${encodeURIComponent(worktreePath).replaceAll("%", "_")}`;
}

export function defaultPersistedMainviewState(): PersistedMainviewState {
  return {
    version: MAINVIEW_STATE_STORAGE_VERSION,
    selectedProjectId: null,
    selectedWorktreePath: null,
    selectedThreadId: null,
    pendingThreadModel: "",
    pendingThreadReasoningEffort: "",
    pendingThreadGithubAccess: false,
    pendingThreadAgentsAccess: false,
    pendingThreadMetidosAccess: true,
    pendingThreadUnsafeMode: false,
    chatInput: "",
    sidebarCollapsed: false,
    sidebarSearchQuery: "",
    openWorktrees: [],
  };
}

/**
 * Baseline tree view state used when storage is unavailable or out of date.
 */
export function defaultPersistedTreeViewState(): PersistedTreeViewState {
  return {
    version: TREE_VIEW_STATE_STORAGE_VERSION,
    workspaceSectionOpen: true,
    workspaceActiveSectionOpen: true,
    projectsSectionOpen: true,
    threadsSectionOpen: true,
    gitSectionOpen: true,
    openProjectPaths: [],
  };
}

/**
 * Parse and sanitize integers expected for ids.
 */
function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
/**
 * Checks whether a value is a recognized codex reasoning effort.
 * @param value - Input value.
 */

export function isCodexReasoningEffort(
  value: unknown,
): value is RpcReasoningEffort {
  return (
    typeof value === "string" &&
    CODEX_REASONING_EFFORT_VALUES.includes(value as RpcReasoningEffort)
  );
}

/**
 * Normalize persisted open-worktree entries and drop duplicates/invalid rows.
 */
function normalizePersistedOpenWorktrees(
  value: unknown,
): PersistedOpenWorktree[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: PersistedOpenWorktree[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<PersistedOpenWorktree>;
    const projectId = parsePositiveInteger(candidate.projectId);
    const worktreePath = candidate.worktreePath;
    if (projectId === null) {
      continue;
    }
    if (typeof worktreePath !== "string" || !worktreePath.trim()) {
      continue;
    }

    const key = `${projectId}:${worktreePath}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push({
      projectId,
      worktreePath,
    });
  }

  return next;
}
/**
 * Normalizes persisted open project paths.
 * @param value - Input value.
 */

function normalizePersistedOpenProjectPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

/**
 * Read mainview persisted state from storage with safe fallback for malformed/corrupt data.
 */
export function readPersistedMainviewState(): PersistedMainviewState {
  if (typeof window === "undefined") {
    return defaultPersistedMainviewState();
  }

  try {
    const raw =
      window.localStorage.getItem(MAINVIEW_STATE_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_MAINVIEW_STATE_STORAGE_KEY);
    if (!raw) {
      return defaultPersistedMainviewState();
    }
    const parsed = JSON.parse(raw) as Partial<PersistedMainviewState>;
    if (parsed.version !== MAINVIEW_STATE_STORAGE_VERSION) {
      return defaultPersistedMainviewState();
    }
    return {
      version: MAINVIEW_STATE_STORAGE_VERSION,
      selectedProjectId: parsePositiveInteger(parsed.selectedProjectId) ?? null,
      selectedWorktreePath:
        typeof parsed.selectedWorktreePath === "string"
          ? parsed.selectedWorktreePath
          : null,
      selectedThreadId: parsePositiveInteger(parsed.selectedThreadId) ?? null,
      pendingThreadModel:
        typeof parsed.pendingThreadModel === "string"
          ? parsed.pendingThreadModel
          : "",
      pendingThreadReasoningEffort:
        typeof parsed.pendingThreadReasoningEffort === "string"
          ? parsed.pendingThreadReasoningEffort
          : "",
      pendingThreadGithubAccess: false,
      pendingThreadAgentsAccess: false,
      pendingThreadMetidosAccess: true,
      // Sensitive local inputs stay memory-only and are intentionally never restored.
      pendingThreadUnsafeMode: false,
      chatInput: "",
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      sidebarSearchQuery:
        typeof parsed.sidebarSearchQuery === "string"
          ? parsed.sidebarSearchQuery
          : "",
      openWorktrees: normalizePersistedOpenWorktrees(parsed.openWorktrees),
    };
  } catch {
    return defaultPersistedMainviewState();
  }
}

export function readPersistedTreeViewState(): PersistedTreeViewState {
  if (typeof window === "undefined") {
    return defaultPersistedTreeViewState();
  }

  try {
    const raw =
      window.localStorage.getItem(TREE_VIEW_STATE_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_TREE_VIEW_STATE_STORAGE_KEY);
    if (!raw) {
      return defaultPersistedTreeViewState();
    }
    const parsed = JSON.parse(raw) as Partial<PersistedTreeViewState>;
    if (parsed.version !== TREE_VIEW_STATE_STORAGE_VERSION) {
      return defaultPersistedTreeViewState();
    }
    return {
      version: TREE_VIEW_STATE_STORAGE_VERSION,
      workspaceSectionOpen: parsed.workspaceSectionOpen !== false,
      workspaceActiveSectionOpen: parsed.workspaceActiveSectionOpen !== false,
      projectsSectionOpen: parsed.projectsSectionOpen !== false,
      threadsSectionOpen: parsed.threadsSectionOpen !== false,
      gitSectionOpen: parsed.gitSectionOpen !== false,
      openProjectPaths: normalizePersistedOpenProjectPaths(
        parsed.openProjectPaths,
      ),
    };
  } catch {
    return defaultPersistedTreeViewState();
  }
}
/**
 * Serializes mainview state to a persisted-safe record shape.
 * @param state - Full mainview state.
 */

function serializePersistedMainviewState(
  state: PersistedMainviewState,
): PersistedMainviewStorageRecord {
  const {
    chatInput: _chatInput,
    pendingThreadAgentsAccess: _pendingThreadAgentsAccess,
    pendingThreadGithubAccess: _pendingThreadGithubAccess,
    pendingThreadMetidosAccess: _pendingThreadMetidosAccess,
    pendingThreadUnsafeMode: _pendingThreadUnsafeMode,
    ...persistedState
  } = state;
  return persistedState;
}

/**
 * Persist mainview state blob unless executing outside browser context.
 */
export function writePersistedMainviewState(
  state: PersistedMainviewState,
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    MAINVIEW_STATE_STORAGE_KEY,
    JSON.stringify(serializePersistedMainviewState(state)),
  );
}
/**
 * Persists a partial mainview state patch into localStorage.
 * @param patch - Partial state patch.
 */

export function patchPersistedMainviewState(
  patch: Partial<PersistedMainviewState>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  writePersistedMainviewState({
    ...readPersistedMainviewState(),
    ...patch,
    version: MAINVIEW_STATE_STORAGE_VERSION,
  });
}
/**
 * Writes persisted tree view state.
 * @param state - Current state value.
 */

export function writePersistedTreeViewState(
  state: PersistedTreeViewState,
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    TREE_VIEW_STATE_STORAGE_KEY,
    JSON.stringify(state),
  );
}

/**
 * Resize textarea to fit content while respecting a minimum height floor.
 */
export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement | null,
  minHeight: number,
): void {
  if (!textarea) {
    return;
  }
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
}
/**
 * Extracts run status with an idle fallback when thread is absent.
 * @param thread - Thread record or null.
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
 * @param thread - Thread record.
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
 * @param left - left value.
 * @param right - right value.
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
 * @param current - Existing preview candidate.
 * @param next - New preview candidate.
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
 * Detect file separator by inspecting path shape so formatting works cross-platform.
 */
export function pathSeparator(value: string): string {
  return value.includes("\\") ? "\\" : "/";
}

/**
 * Return path with a trailing separator if absent for display/input composition.
 */
export function ensureTrailingSeparator(value: string): string {
  const separator = pathSeparator(value);
  return value.endsWith("/") || value.endsWith("\\")
    ? value
    : `${value}${separator}`;
}
/**
 * Formats directory path for input.
 * @param value - Input value.
 * @param homeDirectory - homeDirectory value.
 * @param supportsTildePath - supportsTildePath path used by formatDirectoryPathForInput.
 */

export function formatDirectoryPathForInput(
  value: string,
  homeDirectory: string,
  supportsTildePath: boolean,
): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (!supportsTildePath || !homeDirectory) {
    return ensureTrailingSeparator(normalized);
  }

  const normalizedHomeDirectory = homeDirectory.replace(/[\\/]+$/, "");
  if (
    normalized === normalizedHomeDirectory ||
    normalized.startsWith(
      `${normalizedHomeDirectory}${pathSeparator(normalized)}`,
    )
  ) {
    const suffix = normalized.slice(normalizedHomeDirectory.length);
    return ensureTrailingSeparator(`~${suffix}`);
  }

  return ensureTrailingSeparator(normalized);
}

/**
 * Render a path with a leading `~` when it shares the same home directory.
 */
export function formatPathForDisplay(
  path: string,
  homeDirectory: string,
  supportsTildePath: boolean,
): string {
  const cacheKey = `${supportsTildePath ? "1" : "0"}\u0000${homeDirectory}\u0000${path}`;
  const cached = formatPathForDisplayCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let formattedPath = path;
  if (supportsTildePath && homeDirectory) {
    const normalizedHomeDirectory = homeDirectory.replace(/[\\/]+$/, "");
    if (path === normalizedHomeDirectory) {
      formattedPath = "~";
    } else if (
      path.startsWith(`${normalizedHomeDirectory}${pathSeparator(path)}`)
    ) {
      formattedPath = `~${path.slice(normalizedHomeDirectory.length)}`;
    }
  }

  formatPathForDisplayCache.set(cacheKey, formattedPath);
  if (
    formatPathForDisplayCache.size > FORMAT_PATH_FOR_DISPLAY_CACHE_MAX_ENTRIES
  ) {
    const firstKey = formatPathForDisplayCache.keys().next().value;
    if (firstKey !== undefined) {
      formatPathForDisplayCache.delete(firstKey);
    }
  }

  return formattedPath;
}
/**
 * Formats git history timestamp.
 * @param value - Input value.
 */

export function formatGitHistoryTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return GIT_HISTORY_TIMESTAMP_FORMATTER.format(timestamp);
}
/**
 * Sorts threads.
 * @param items - items value.
 */

export function sortThreads(items: RpcThread[]): RpcThread[] {
  return [...items].sort(compareThreadsByRecency);
}

/**
 * Partitions an already-recency-ordered thread list into pinned and unpinned arrays.
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
/**
 * Finds thread insertion index.
 * @param items - items value.
 * @param thread - thread value.
 */

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
/**
 * Finds thread store insertion index.
 * @param orderedIds - orderedIds value.
 * @param byId - byId identifier.
 * @param thread - thread value.
 */

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
 * Order threads by pinned timestamp first, then by last updated date.
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
  return right.updatedAt.localeCompare(left.updatedAt);
}
/**
 * Picks a preferred thread for a worktree, favoring pinned/recency.
 * @param threads - Candidate threads.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
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
 * @param threads - Candidate threads.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 */

export function latestThreadForWorktree(
  threads: RpcThread[],
  projectId: number,
  worktreePath: string,
): RpcThread | null {
  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === projectId &&
          thread.worktreePath === worktreePath,
      ),
    )[0] ?? null
  );
}

/**
 * Return most recent pinned thread for a worktree, if any.
 */
export function pinnedThreadForWorktree(
  threads: RpcThread[],
  projectId: number,
  worktreePath: string,
): RpcThread | null {
  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === projectId &&
          thread.worktreePath === worktreePath &&
          thread.pinnedAt !== null,
      ),
    )[0] ?? null
  );
}
/**
 * Serializes open-worktree flags into a persistable list.
 * @param projectStates - Project state map.
 */

export function serializeOpenWorktrees(
  projectStates: ProjectStateMap,
): PersistedOpenWorktree[] {
  const next: PersistedOpenWorktree[] = [];
  for (const [projectIdKey, state] of Object.entries(projectStates)) {
    const projectId = Number(projectIdKey);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      continue;
    }
    for (const worktreePath of state.openWorktrees) {
      next.push({
        projectId,
        worktreePath,
      });
    }
  }
  return next;
}

/**
 * Rehydrate selected thread from persisted state, preferring explicit ID then worktree match.
 */
export function pickInitialThread(
  threads: RpcThread[],
  persistedState: PersistedMainviewState,
): RpcThread | null {
  if (persistedState.selectedThreadId !== null) {
    const persistedThread =
      threads.find((thread) => thread.id === persistedState.selectedThreadId) ??
      null;
    if (persistedThread) {
      return persistedThread;
    }
  }

  if (
    persistedState.selectedProjectId !== null &&
    persistedState.selectedWorktreePath
  ) {
    const matchingThread = latestThreadForWorktree(
      threads,
      persistedState.selectedProjectId,
      persistedState.selectedWorktreePath,
    );
    if (matchingThread) {
      return matchingThread;
    }
  }

  return threads[0] ?? null;
}
/**
 * Upserts thread list.
 * @param items - items value.
 * @param thread - thread value.
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

  if (existingThread === thread) {
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
 * Compares projects.
 * @param left - left value.
 * @param right - right value.
 */

function compareProjects(left: RpcProject, right: RpcProject): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
/**
 * Finds project insertion index.
 * @param orderedIds - orderedIds value.
 * @param byId - byId identifier.
 * @param project - project value.
 */

function findProjectInsertionIndex(
  orderedIds: number[],
  byId: Record<number, RpcProject>,
  project: RpcProject,
): number {
  let low = 0;
  let high = orderedIds.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midProjectId = orderedIds[mid];
    const midProject = midProjectId ? byId[midProjectId] : undefined;
    if (midProject && compareProjects(midProject, project) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Insert/replace a project preserving sorted order by project name.
 */
export function upsertProjectList(
  items: RpcProject[],
  project: RpcProject,
): RpcProject[] {
  const next = items.filter((entry) => entry.id !== project.id);
  next.push(project);
  return next.sort(compareProjects);
}
/**
 * Creates project store.
 * @param items - items value.
 */

export function createProjectStore(items: RpcProject[]): ProjectStore {
  let nextStore = emptyProjectStore();

  for (const project of items) {
    nextStore = upsertProjectStore(nextStore, project);
  }

  return nextStore;
}
/**
 * Upserts project store.
 * @param store - store value.
 * @param project - project value.
 */

export function upsertProjectStore(
  store: ProjectStore,
  project: RpcProject,
): ProjectStore {
  const existingProject = store.byId[project.id];
  if (existingProject === project) {
    return store;
  }

  if (!existingProject) {
    const orderedIds = store.orderedIds.slice();
    const insertionIndex = findProjectInsertionIndex(
      orderedIds,
      store.byId,
      project,
    );
    orderedIds.splice(insertionIndex, 0, project.id);
    return {
      byId: {
        ...store.byId,
        [project.id]: project,
      },
      orderedIds,
    };
  }

  const existingIndex = store.orderedIds.indexOf(project.id);
  if (existingIndex === -1) {
    return createProjectStore([...projectStoreItems(store), project]);
  }

  const previousProjectId =
    existingIndex > 0 ? (store.orderedIds[existingIndex - 1] ?? null) : null;
  const nextProjectId =
    existingIndex < store.orderedIds.length - 1
      ? (store.orderedIds[existingIndex + 1] ?? null)
      : null;
  const previousProject =
    previousProjectId === null ? null : (store.byId[previousProjectId] ?? null);
  const nextProject =
    nextProjectId === null ? null : (store.byId[nextProjectId] ?? null);
  const staysInPlace =
    (previousProject === null ||
      compareProjects(previousProject, project) <= 0) &&
    (nextProject === null || compareProjects(project, nextProject) <= 0);
  if (staysInPlace) {
    return {
      byId: {
        ...store.byId,
        [project.id]: project,
      },
      orderedIds: store.orderedIds,
    };
  }

  const orderedIds = store.orderedIds.slice();
  orderedIds.splice(existingIndex, 1);
  const byId = {
    ...store.byId,
    [project.id]: project,
  };
  const insertionIndex = findProjectInsertionIndex(orderedIds, byId, project);
  orderedIds.splice(insertionIndex, 0, project.id);
  return {
    byId,
    orderedIds,
  };
}
/**
 * Removes project from store.
 * @param store - store value.
 * @param projectId - Project identifier.
 */

export function removeProjectFromStore(
  store: ProjectStore,
  projectId: number,
): ProjectStore {
  if (!store.byId[projectId]) {
    return store;
  }

  const byId = {
    ...store.byId,
  };
  delete byId[projectId];

  return {
    byId,
    orderedIds: store.orderedIds.filter((entryId) => entryId !== projectId),
  };
}
/**
 * Returns a thread copy with unread error state acknowledged.
 * @param thread - Thread record.
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
 * @param detail - Thread detail payload.
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
 * @param items - items value.
 */

export function createThreadStore(items: RpcThread[]): ThreadStore {
  let nextStore = emptyThreadStore();

  for (const thread of items) {
    nextStore = upsertThreadStore(nextStore, thread);
  }

  return nextStore;
}
/**
 * Upserts thread store.
 * @param store - store value.
 * @param thread - thread value.
 */

export function upsertThreadStore(
  store: ThreadStore,
  thread: RpcThread,
): ThreadStore {
  const existingThread = store.byId[thread.id];
  if (existingThread === thread) {
    return store;
  }

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
 * @param store - store value.
 * @param threadId - Thread identifier.
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

/**
 * Keep context menu coordinate inside viewport bounds.
 */
export function clampProjectMenuCoordinate(
  value: number,
  viewportSize: number,
  panelSize: number,
): number {
  return clampNumber(value, 8, Math.max(8, viewportSize - panelSize - 8));
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

  if (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    GIT_HISTORY_LOAD_MORE_THRESHOLD_PX
  ) {
    onThreshold();
  }
}
