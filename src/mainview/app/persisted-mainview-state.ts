/**
 * @file src/mainview/app/persisted-mainview-state.ts
 * @description Browser storage helpers for persisted Mainview UI state.
 */

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
  pendingThreadPermissions: string[];
  pendingThreadWebSearchAccess?: boolean;
  pendingThreadWebviewAccess?: boolean;
  pendingThreadGithubAccess?: boolean;
  pendingThreadGitAccess?: boolean;
  pendingThreadSqliteAccess?: boolean;
  pendingThreadWebServerAccess?: boolean;
  pendingThreadAgentsAccess?: boolean;
  pendingThreadCalendarAccess?: boolean;
  pendingThreadNotificationsAccess?: boolean;
  pendingThreadWeatherAccess?: boolean;
  pendingThreadThreadsAccess?: boolean;
  pendingThreadCronsAccess?: boolean;
  pendingThreadMetidosAccess?: boolean;
  pendingThreadUnsafeMode?: boolean;
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
  | "pendingThreadGitAccess"
  | "pendingThreadSqliteAccess"
  | "pendingThreadWebServerAccess"
  | "pendingThreadMetidosAccess"
  | "pendingThreadThreadsAccess"
  | "pendingThreadCronsAccess"
  | "pendingThreadNotificationsAccess"
  | "pendingThreadWeatherAccess"
  | "pendingThreadWebSearchAccess"
  | "pendingThreadWebviewAccess"
  | "pendingThreadUnsafeMode"
>;

/**
 * Persisted sidebar expansion state for all left-tree sections.
 */
export type PersistedTreeViewState = {
  version: number;
  foldersSectionOpen: boolean;
  workspaceSectionOpen: boolean;
  workspaceActiveSectionOpen: boolean;
  projectsSectionOpen: boolean;
  threadsSectionOpen: boolean;
  gitSectionOpen: boolean;
  openProjectPaths: string[];
};

export const MAINVIEW_STATE_STORAGE_KEY = "metidos:mainview-state";
export const MAINVIEW_STATE_STORAGE_VERSION = 1;
export const MAINVIEW_STATE_WRITE_DEBOUNCE_MS = 160;
export const TREE_VIEW_STATE_STORAGE_KEY = "metidos:tree-view-state";
export const TREE_VIEW_STATE_STORAGE_VERSION = 1;

export function defaultPersistedMainviewState(): PersistedMainviewState {
  return {
    version: MAINVIEW_STATE_STORAGE_VERSION,
    selectedProjectId: null,
    selectedWorktreePath: null,
    selectedThreadId: null,
    pendingThreadModel: "",
    pendingThreadReasoningEffort: "",
    pendingThreadPermissions: [
      "metidos:crons",
      "metidos:threads",
      "metidos:web-search",
    ],
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
    foldersSectionOpen: true,
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
    const raw = window.localStorage.getItem(MAINVIEW_STATE_STORAGE_KEY);
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
      pendingThreadPermissions: Array.isArray(parsed.pendingThreadPermissions)
        ? [
            ...new Set(
              parsed.pendingThreadPermissions.filter(
                (permission): permission is string =>
                  typeof permission === "string" && permission.trim() !== "",
              ),
            ),
          ].sort((left, right) => left.localeCompare(right))
        : defaultPersistedMainviewState().pendingThreadPermissions,
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
    const raw = window.localStorage.getItem(TREE_VIEW_STATE_STORAGE_KEY);
    if (!raw) {
      return defaultPersistedTreeViewState();
    }
    const parsed = JSON.parse(raw) as Partial<PersistedTreeViewState>;
    if (parsed.version !== TREE_VIEW_STATE_STORAGE_VERSION) {
      return defaultPersistedTreeViewState();
    }
    return {
      version: TREE_VIEW_STATE_STORAGE_VERSION,
      foldersSectionOpen: parsed.foldersSectionOpen !== false,
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
    pendingThreadGitAccess: _pendingThreadGitAccess,
    pendingThreadSqliteAccess: _pendingThreadSqliteAccess,
    pendingThreadWebServerAccess: _pendingThreadWebServerAccess,
    pendingThreadMetidosAccess: _pendingThreadMetidosAccess,
    pendingThreadThreadsAccess: _pendingThreadThreadsAccess,
    pendingThreadCronsAccess: _pendingThreadCronsAccess,
    pendingThreadNotificationsAccess: _pendingThreadNotificationsAccess,
    pendingThreadWeatherAccess: _pendingThreadWeatherAccess,
    pendingThreadWebSearchAccess: _pendingThreadWebSearchAccess,
    pendingThreadWebviewAccess: _pendingThreadWebviewAccess,
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
