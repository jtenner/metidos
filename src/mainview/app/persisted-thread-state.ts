/**
 * @file src/mainview/app/persisted-thread-state.ts
 * @description Helpers for serializing persisted worktree and thread selection state.
 */

import type { RpcThread } from "../../bun/rpc-schema";
import type {
  PersistedMainviewState,
  PersistedOpenWorktree,
} from "./persisted-mainview-state";
import type { ProjectStateMap } from "./project-worktree-state";
import { latestThreadForWorktree } from "./thread-store";

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
