/**
 * @file src/mainview/app/project-worktree-state.ts
 * @description Project and Worktree state helpers for Mainview.
 */

import type {
  RpcProject,
  RpcWorktree,
  RpcWorktreeSnapshot,
} from "../../bun/rpc-schema";

/**
 * In-memory tree state for a single Project and its Worktrees.
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
 * In-memory state for a single Worktree row and snapshot loading.
 */
export type WorktreeNodeState = {
  loading: boolean;
  opened: boolean;
  snapshot?: RpcWorktreeSnapshot | undefined;
  error: string;
};

export type ProjectStateMap = Record<number, ProjectNodeState>;
export type WorktreeStateMap = Record<string, WorktreeNodeState>;

/**
 * Return last path segment after normalizing trailing separators.
 */
export function shortName(value: string): string {
  const normalized = value.replace(/[\\/]$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

/**
 * Builds a stable key for a Project/Worktree tuple.
 */
export function worktreeKey(projectId: number, worktreePath: string): string {
  return `${projectId}::${worktreePath}`;
}

/**
 * Fresh Project node state for newly loaded Project entries.
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
 * Fresh Worktree node state for newly discovered Worktree entries.
 */
export function defaultWorktreeState(): WorktreeNodeState {
  return {
    loading: false,
    opened: false,
    error: "",
  };
}

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
 * Extracts Worktrees from a Project state map in deterministic order.
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
 * Returns the number of Worktrees in a Project state.
 */
export function projectStateWorktreeCount(
  state: Pick<ProjectNodeState, "worktreePaths">,
): number {
  return state.worktreePaths.length;
}

export function findPrimaryWorktree(
  project: RpcProject,
  worktrees: RpcWorktree[],
): RpcWorktree | null {
  return worktrees.find((worktree) => worktree.path === project.path) ?? null;
}

/**
 * Resolve the canonical primary Worktree path, falling back to Project path.
 */
export function primaryWorktreePath(
  project: RpcProject,
  worktrees: RpcWorktree[],
): string {
  return findPrimaryWorktree(project, worktrees)?.path ?? project.path;
}

/**
 * Orders Worktrees for sidebar/workspace selection.
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
 * Returns the display label for a Worktree.
 */
export function pruneProjectStates(
  states: ProjectStateMap,
  activeProjectIds: Iterable<number>,
): ProjectStateMap {
  const activeIds = new Set(activeProjectIds);
  let changed = false;
  const next: ProjectStateMap = {};

  for (const [rawProjectId, state] of Object.entries(states)) {
    const projectId = Number(rawProjectId);
    if (!activeIds.has(projectId)) {
      changed = true;
      continue;
    }

    const knownWorktreePaths = new Set(state.worktreePaths);
    const openWorktrees = new Set<string>();
    for (const worktreePath of state.openWorktrees) {
      if (knownWorktreePaths.has(worktreePath)) {
        openWorktrees.add(worktreePath);
      } else {
        changed = true;
      }
    }

    if (openWorktrees.size !== state.openWorktrees.size) {
      next[projectId] = {
        ...state,
        openWorktrees,
      };
      continue;
    }

    next[projectId] = state;
  }

  return changed ? next : states;
}

function parseWorktreeKey(
  key: string,
): { projectId: number; path: string } | null {
  const separatorIndex = key.indexOf("::");
  if (separatorIndex <= 0) {
    return null;
  }

  const projectId = Number(key.slice(0, separatorIndex));
  if (!Number.isFinite(projectId)) {
    return null;
  }

  return {
    projectId,
    path: key.slice(separatorIndex + 2),
  };
}

export function pruneWorktreeStates(
  states: WorktreeStateMap,
  projectStates: ProjectStateMap,
): WorktreeStateMap {
  let changed = false;
  const next: WorktreeStateMap = {};

  for (const [key, state] of Object.entries(states)) {
    const parsedKey = parseWorktreeKey(key);
    const projectState = parsedKey ? projectStates[parsedKey.projectId] : null;
    if (!parsedKey || !projectState) {
      changed = true;
      continue;
    }

    const isKnownWorktree = Boolean(
      projectState.worktreeByPath[parsedKey.path],
    );
    const isOpenWorktree = projectState.openWorktrees.has(parsedKey.path);
    if (!state.opened && !isKnownWorktree && !isOpenWorktree) {
      changed = true;
      continue;
    }

    next[key] = state;
  }

  return changed ? next : states;
}

export function worktreeDisplayName(worktree: RpcWorktree | null): string {
  return worktree?.branch ?? "Primary";
}
