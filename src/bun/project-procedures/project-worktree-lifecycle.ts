/**
 * @file src/bun/project-procedures/project-worktree-lifecycle.ts
 * @description Focused Project/Worktree lifecycle, listing, and polling workflows for Backend procedure callers.
 */

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectRecord, ProjectWorktreeRecord } from "../project-store";
import type {
  RpcGitHistoryEntry,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeSnapshot,
} from "../rpc-schema";
import type { PendingGitHistoryPrefetch } from "./git-history";
import {
  createWorktreeGitHistoryChangedEvent,
  type WorkContextLifecycleEventPublisher,
} from "./work-context-events";

export type WorkContextProjectWorktreeListing = {
  hiddenWorktrees: RpcWorktree[];
  worktrees: RpcWorktree[];
};

export type WorktreePollState = {
  changes: RpcWorktreeChange[];
  diff: string[];
  files: string[];
  history: RpcWorktreeGitHistorySummary;
  historyEntries: RpcGitHistoryEntry[];
  historyNextOffset: number | null;
  historyPolling: boolean;
  historyPrefetch: PendingGitHistoryPrefetch | null;
  historySignature: string | null;
  historyTimer: ReturnType<typeof setInterval> | null;
  lastUpdatedAt: string;
  snapshotRead: Promise<RpcWorktreeSnapshot> | null;
};

export type ProjectPollState = {
  id: number;
  project: ProjectRecord;
  projectPath: string;
  worktrees: RpcWorktree[];
  worktreesLoadedAt: number;
  activeWorktreePath: string | null;
  projectTimer: ReturnType<typeof setInterval> | null;
  openWorktrees: Map<string, WorktreePollState>;
};

export type StartWorktreeGitHistoryPollingOptions = {
  abortGitHistoryPrefetch: (
    worktreeState: WorktreePollState,
    reason: string,
  ) => void;
  logBackgroundGitFailure: (message: string, error: unknown) => void;
  publishEvent: WorkContextLifecycleEventPublisher;
  pollIntervalMs: number;
  readGitHistorySummary: (
    projectId: number,
    worktreePath: string,
    priority: "background",
  ) => Promise<{ history: RpcWorktreeGitHistorySummary; signature: string }>;
};

export type CreateProjectWorktreeContextInput = {
  assertWorktreePathAllowed: (worktreePath: string) => void;
  ensureVisible: (worktreePath: string) => void;
  formatWorktreePathForError: (worktreePath: string) => string;
  project: ProjectRecord;
  readListing: () => Promise<WorkContextProjectWorktreeListing>;
  runGitWorktreeAdd: (worktreePath: string) => Promise<void>;
  setPinned: (worktreePath: string, pinned: boolean) => void;
  worktreeName: string;
  workspaceRoot: string;
};

export type OpenWorktreeLifecycleInput = {
  project: ProjectRecord;
  queueHistoryWarmup: (worktreeState: WorktreePollState) => void;
  readGitHistoryFirstPage: () => Promise<{
    history: RpcWorktreeGitHistoryResult;
    signature: string;
    summary: RpcWorktreeGitHistorySummary;
  }>;
  readAndStoreSnapshot: () => Promise<RpcWorktreeSnapshot>;
  runWorktreeOpenLimited: <T>(callback: () => Promise<T>) => Promise<T>;
  state: ProjectPollState;
  syncBackgroundPolling: () => void;
  worktreePath: string;
  worktrees: RpcWorktree[];
};

export type ProjectWorktreeLifecycleModule = {
  readonly applyRefreshedListingToPollState: (
    state: ProjectPollState,
    worktrees: RpcWorktree[],
    stopWorktreePolling: (worktreePath: string) => void,
  ) => void;
  readonly buildRootWorkspaceRecord: (
    projectPath: string,
    pinnedAt?: string | null,
  ) => RpcWorktree;
  readonly createPollState: (
    project: ProjectRecord,
    worktrees?: RpcWorktree[],
    now?: number,
  ) => ProjectPollState;
  readonly createWorktree: (
    input: CreateProjectWorktreeContextInput,
  ) => Promise<{
    hiddenWorktrees: RpcWorktree[];
    project: ProjectRecord;
    worktrees: RpcWorktree[];
    worktreePath: string;
  }>;
  readonly ensureWorktreePollState: (
    state: ProjectPollState,
    worktreePath: string,
    now: string,
  ) => WorktreePollState;
  readonly filterForAccess: (
    worktrees: readonly RpcWorktree[],
    isWorktreePathAllowed: (worktreePath: string) => boolean,
  ) => RpcWorktree[];
  readonly hydrateFreshListing: (input: {
    includeHidden: boolean;
    projectPath: string;
    trackedWorktrees: readonly Pick<
      ProjectWorktreeRecord,
      "pinnedAt" | "worktreePath"
    >[];
    worktrees: readonly RpcWorktree[];
  }) => WorkContextProjectWorktreeListing;
  readonly hydrateOpenProjectWorktrees: (input: {
    projectPath: string;
    rootPinnedAt: string | null;
    worktrees: readonly RpcWorktree[];
  }) => RpcWorktree[];
  readonly isGitWorkspaceUnavailableError: (error: unknown) => boolean;
  readonly openWorktree: (input: OpenWorktreeLifecycleInput) => Promise<{
    history: RpcWorktreeGitHistoryResult;
    project: ProjectRecord;
    worktree: RpcWorktreeSnapshot;
    worktrees: RpcWorktree[];
  }>;
  readonly reconcilePrimaryWorktreePath: (
    projectPath: string,
    worktrees: readonly RpcWorktree[],
  ) => RpcWorktree[];
  readonly startGitHistoryPolling: (
    state: ProjectPollState,
    worktreePath: string,
    options: StartWorktreeGitHistoryPollingOptions,
  ) => WorktreePollState;
  readonly stopWorktreeBackgroundPolling: (
    worktreeState: WorktreePollState,
    reason: string,
    abortGitHistoryPrefetch: (
      worktreeState: WorktreePollState,
      reason: string,
    ) => void,
  ) => void;
  readonly stopWorktreePolling: (
    state: ProjectPollState,
    worktreePath: string,
    abortGitHistoryPrefetch: (
      worktreeState: WorktreePollState,
      reason: string,
    ) => void,
  ) => void;
  readonly syncBackgroundPolling: (
    state: ProjectPollState,
    input: {
      hasForegroundReadPressure: boolean;
      startGitHistoryPolling: (
        state: ProjectPollState,
        worktreePath: string,
      ) => WorktreePollState;
      stopWorktreeBackgroundPolling: (
        worktreeState: WorktreePollState,
        reason: string,
      ) => void;
    },
  ) => void;
  readonly trackedWorktree: (
    state: ProjectPollState,
    worktreePath: string,
  ) => RpcWorktree | null;
  readonly updatePollStateProject: (
    state: ProjectPollState,
    project: ProjectRecord,
  ) => void;
  readonly splitForVisibility: (input: {
    includeHidden: boolean;
    projectPath: string;
    trackedWorktrees: readonly Pick<
      ProjectWorktreeRecord,
      "pinnedAt" | "worktreePath"
    >[];
    worktrees: readonly RpcWorktree[];
  }) => WorkContextProjectWorktreeListing;
};

export function createProjectRootWorkspaceWorktree(
  projectPath: string,
  pinnedAt: string | null = null,
): RpcWorktree {
  return {
    path: resolve(projectPath),
    bare: false,
    branch: null,
    head: null,
    pinnedAt,
  };
}

export function splitProjectWorktreesForVisibility(
  projectPath: string,
  trackedWorktrees: readonly Pick<
    ProjectWorktreeRecord,
    "pinnedAt" | "worktreePath"
  >[],
  worktrees: readonly RpcWorktree[],
  includeHidden: boolean,
): WorkContextProjectWorktreeListing {
  const trackedWorktreePaths = new Map(
    trackedWorktrees.map((record) => [record.worktreePath, record.pinnedAt]),
  );

  const visibleWorktrees: RpcWorktree[] = [];
  const hiddenWorktrees: RpcWorktree[] = [];

  for (const worktree of worktrees) {
    const nextWorktree = {
      ...worktree,
      pinnedAt: trackedWorktreePaths.get(worktree.path) ?? null,
    } satisfies RpcWorktree;
    if (
      worktree.path === projectPath ||
      trackedWorktreePaths.has(worktree.path)
    ) {
      visibleWorktrees.push(nextWorktree);
      continue;
    }
    if (includeHidden) {
      hiddenWorktrees.push(nextWorktree);
    }
  }

  return {
    hiddenWorktrees,
    worktrees: visibleWorktrees,
  };
}

export function isGitWorkspaceUnavailableError(error: unknown): boolean {
  // Git command wrappers surface repository-availability failures as stderr
  // text rather than a stable typed error. Keep this matcher conservative: only
  // known setup/root errors become non-git fallback, while unknown or localized
  // failures still bubble to callers instead of fabricating workspace state.
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();

  return (
    message.includes("not a git repository") ||
    message.includes("must be run in a work tree") ||
    message.includes("could not locate the git executable")
  );
}

export function reconcileProjectPrimaryWorktreePath(
  projectPath: string,
  worktrees: readonly RpcWorktree[],
): RpcWorktree[] {
  // Empty means git did not report the requested folder as the repository root
  // or an equivalent realpath. Callers that support non-git/root fallback should
  // hydrate that explicitly instead of accepting unrelated git worktree rows.
  const normalizedProjectPath = resolve(projectPath);
  const exactMatchIndex = worktrees.findIndex(
    (worktree) => resolve(worktree.path) === normalizedProjectPath,
  );
  if (exactMatchIndex !== -1) {
    return [...worktrees];
  }

  try {
    const canonicalProjectPath = realpathSync(normalizedProjectPath);
    const equivalentMatchIndex = worktrees.findIndex((worktree) => {
      try {
        return realpathSync(resolve(worktree.path)) === canonicalProjectPath;
      } catch {
        return false;
      }
    });
    if (equivalentMatchIndex !== -1) {
      return worktrees.map((worktree, index) =>
        index === equivalentMatchIndex
          ? {
              ...worktree,
              path: normalizedProjectPath,
            }
          : worktree,
      );
    }
  } catch {
    // If the requested folder cannot be resolved, treat it as not matching a
    // git repository root/worktree rather than fabricating one.
  }

  return [];
}

export function filterProjectWorktreesForAccess(
  worktrees: readonly RpcWorktree[],
  isWorktreePathAllowed: (worktreePath: string) => boolean,
): RpcWorktree[] {
  return worktrees.filter((worktree) => isWorktreePathAllowed(worktree.path));
}

export function hydrateFreshProjectWorktreeListing(input: {
  includeHidden: boolean;
  projectPath: string;
  trackedWorktrees: readonly Pick<
    ProjectWorktreeRecord,
    "pinnedAt" | "worktreePath"
  >[];
  worktrees: readonly RpcWorktree[];
}): WorkContextProjectWorktreeListing {
  return splitProjectWorktreesForVisibility(
    input.projectPath,
    input.trackedWorktrees,
    input.worktrees,
    input.includeHidden,
  );
}

export function hydrateOpenProjectWorktrees(input: {
  projectPath: string;
  rootPinnedAt: string | null;
  worktrees: readonly RpcWorktree[];
}): RpcWorktree[] {
  if (input.worktrees.length > 0) {
    return [...input.worktrees];
  }

  return [
    createProjectRootWorkspaceWorktree(input.projectPath, input.rootPinnedAt),
  ];
}

export function createProjectPollState(
  project: ProjectRecord,
  worktrees: RpcWorktree[] = [],
  now = 0,
): ProjectPollState {
  return {
    id: project.id,
    project,
    projectPath: project.path,
    worktrees,
    worktreesLoadedAt: now,
    activeWorktreePath: null,
    projectTimer: null,
    openWorktrees: new Map(),
  };
}

export function updateProjectPollStateProject(
  state: ProjectPollState,
  project: ProjectRecord,
): void {
  state.project = project;
  state.projectPath = project.path;
}

export function createWorktreePollState(
  projectId: number,
  worktreePath: string,
  lastUpdatedAt: string,
): WorktreePollState {
  return {
    changes: [],
    diff: [],
    files: [],
    history: {
      projectId,
      worktreePath,
      branch: null,
      headHash: null,
      headShortHash: null,
      lastUpdatedAt,
    },
    historyEntries: [],
    historyNextOffset: null,
    historyPolling: false,
    historyPrefetch: null,
    historySignature: null,
    historyTimer: null,
    lastUpdatedAt,
    snapshotRead: null,
  };
}

export function trackedProjectWorktree(
  state: ProjectPollState,
  worktreePath: string,
): RpcWorktree | null {
  return state.worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

export function ensureWorktreePollState(
  state: ProjectPollState,
  worktreePath: string,
  now: string,
): WorktreePollState {
  const existing = state.openWorktrees.get(worktreePath);
  if (existing) {
    return existing;
  }

  const worktreeState = createWorktreePollState(state.id, worktreePath, now);
  state.openWorktrees.set(worktreePath, worktreeState);
  return worktreeState;
}

export function stopWorktreeBackgroundPolling(
  worktreeState: WorktreePollState,
  reason: string,
  abortGitHistoryPrefetch: (
    worktreeState: WorktreePollState,
    reason: string,
  ) => void,
): void {
  if (worktreeState.historyTimer) {
    clearInterval(worktreeState.historyTimer);
    worktreeState.historyTimer = null;
  }
  abortGitHistoryPrefetch(worktreeState, reason);
}

export function stopWorktreePolling(
  state: ProjectPollState,
  worktreePath: string,
  abortGitHistoryPrefetch: (
    worktreeState: WorktreePollState,
    reason: string,
  ) => void,
): void {
  const active = state.openWorktrees.get(worktreePath);
  if (!active) return;

  stopWorktreeBackgroundPolling(
    active,
    `Stopped worktree polling for ${worktreePath}.`,
    abortGitHistoryPrefetch,
  );
  state.openWorktrees.delete(worktreePath);
}

export function startWorktreeGitHistoryPolling(
  state: ProjectPollState,
  worktreePath: string,
  options: StartWorktreeGitHistoryPollingOptions,
): WorktreePollState {
  const worktreeState = ensureWorktreePollState(
    state,
    worktreePath,
    new Date().toISOString(),
  );
  if (worktreeState.historyTimer) {
    return worktreeState;
  }

  const pollGitHistory = async () => {
    if (worktreeState.historyPolling) {
      return;
    }
    worktreeState.historyPolling = true;
    try {
      const previousSignature = worktreeState.historySignature;
      const { history, signature } = await options.readGitHistorySummary(
        state.id,
        worktreePath,
        "background",
      );
      worktreeState.history = history;
      if (previousSignature !== null && previousSignature !== signature) {
        worktreeState.historyEntries = [];
        worktreeState.historyNextOffset = history.headHash ? 0 : null;
        options.abortGitHistoryPrefetch(
          worktreeState,
          `Git history signature changed for ${worktreePath}.`,
        );
      }
      worktreeState.historySignature = signature;
      worktreeState.lastUpdatedAt = history.lastUpdatedAt;

      if (previousSignature !== null && previousSignature !== signature) {
        options.publishEvent(
          createWorktreeGitHistoryChangedEvent(state.id, worktreePath),
        );
      }
    } catch (error) {
      options.logBackgroundGitFailure(
        `Git history poll failed for ${worktreePath}`,
        error,
      );
    } finally {
      worktreeState.historyPolling = false;
    }
  };

  worktreeState.historyTimer = setInterval(() => {
    void pollGitHistory();
  }, options.pollIntervalMs);

  void pollGitHistory();

  return worktreeState;
}

export function syncProjectWorktreeBackgroundPolling(
  state: ProjectPollState,
  input: {
    hasForegroundReadPressure: boolean;
    startGitHistoryPolling: (
      state: ProjectPollState,
      worktreePath: string,
    ) => WorktreePollState;
    stopWorktreeBackgroundPolling: (
      worktreeState: WorktreePollState,
      reason: string,
    ) => void;
  },
): void {
  if (input.hasForegroundReadPressure) {
    for (const [worktreePath, worktreeState] of state.openWorktrees) {
      input.stopWorktreeBackgroundPolling(
        worktreeState,
        `Foreground read pressure paused worktree polling for ${worktreePath}.`,
      );
    }
    return;
  }

  for (const [worktreePath, worktreeState] of state.openWorktrees) {
    if (state.activeWorktreePath === worktreePath) {
      input.startGitHistoryPolling(state, worktreePath);
      continue;
    }

    input.stopWorktreeBackgroundPolling(
      worktreeState,
      `Worktree ${worktreePath} is no longer the active view.`,
    );
  }
}

export function applyRefreshedListingToPollState(
  state: ProjectPollState,
  worktrees: RpcWorktree[],
  stopPolling: (worktreePath: string) => void,
): void {
  state.worktrees = worktrees;
  state.worktreesLoadedAt = Date.now();

  const activeWorktrees = new Set(worktrees.map((worktree) => worktree.path));
  for (const [worktreePath] of state.openWorktrees) {
    if (!activeWorktrees.has(worktreePath)) {
      stopPolling(worktreePath);
    }
  }
  if (
    state.activeWorktreePath !== null &&
    !activeWorktrees.has(state.activeWorktreePath)
  ) {
    state.activeWorktreePath = null;
  }
}

export async function createProjectWorktreeContext(
  input: CreateProjectWorktreeContextInput,
): Promise<{
  hiddenWorktrees: RpcWorktree[];
  project: ProjectRecord;
  worktrees: RpcWorktree[];
  worktreePath: string;
}> {
  input.assertWorktreePathAllowed(input.workspaceRoot);
  mkdirSync(input.workspaceRoot, {
    recursive: true,
  });
  input.assertWorktreePathAllowed(input.workspaceRoot);
  const worktreePath = resolve(input.workspaceRoot, input.worktreeName);
  input.assertWorktreePathAllowed(worktreePath);
  if (existsSync(worktreePath)) {
    throw new Error(
      `Worktree path already exists: ${input.formatWorktreePathForError(worktreePath)}`,
    );
  }

  await input.runGitWorktreeAdd(worktreePath);
  input.ensureVisible(worktreePath);
  input.setPinned(worktreePath, true);

  const listing = await input.readListing();
  return {
    hiddenWorktrees: listing.hiddenWorktrees,
    project: input.project,
    worktrees: listing.worktrees,
    worktreePath,
  };
}

export async function openWorktreeLifecycle(
  input: OpenWorktreeLifecycleInput,
): Promise<{
  history: RpcWorktreeGitHistoryResult;
  project: ProjectRecord;
  worktree: RpcWorktreeSnapshot;
  worktrees: RpcWorktree[];
}> {
  const worktreeState = ensureWorktreePollState(
    input.state,
    input.worktreePath,
    new Date().toISOString(),
  );
  const [{ history, summary, signature }, snapshot] =
    await input.runWorktreeOpenLimited(() =>
      Promise.all([
        input.readGitHistoryFirstPage(),
        input.readAndStoreSnapshot(),
      ]),
    );
  worktreeState.history = summary;
  worktreeState.historyEntries = history.entries;
  worktreeState.historyNextOffset = history.nextOffset;
  worktreeState.historySignature = signature;
  input.syncBackgroundPolling();
  input.queueHistoryWarmup(worktreeState);

  return {
    history,
    project: input.project,
    worktree: snapshot,
    worktrees: input.worktrees,
  };
}

export const projectWorktreeLifecycle: ProjectWorktreeLifecycleModule = {
  applyRefreshedListingToPollState,
  buildRootWorkspaceRecord: createProjectRootWorkspaceWorktree,
  createPollState: createProjectPollState,
  createWorktree: createProjectWorktreeContext,
  ensureWorktreePollState,
  filterForAccess: filterProjectWorktreesForAccess,
  hydrateFreshListing: hydrateFreshProjectWorktreeListing,
  hydrateOpenProjectWorktrees,
  isGitWorkspaceUnavailableError,
  openWorktree: openWorktreeLifecycle,
  reconcilePrimaryWorktreePath: reconcileProjectPrimaryWorktreePath,
  startGitHistoryPolling: startWorktreeGitHistoryPolling,
  stopWorktreeBackgroundPolling,
  stopWorktreePolling,
  syncBackgroundPolling: syncProjectWorktreeBackgroundPolling,
  trackedWorktree: trackedProjectWorktree,
  updatePollStateProject: updateProjectPollStateProject,
  splitForVisibility: (input) =>
    splitProjectWorktreesForVisibility(
      input.projectPath,
      input.trackedWorktrees,
      input.worktrees,
      input.includeHidden,
    ),
};
