import { useSyncExternalStore } from "react";
import {
  readPersistedTreeViewState,
  TREE_VIEW_STATE_STORAGE_VERSION,
  writePersistedTreeViewState,
} from "./state";

/**
 * Serialized sidebar UI state exposed to components and persisted for session restore.
 */
type SidebarPanelsSnapshot = {
  gitHistoryOpen: boolean;
  openProjectPaths: Set<string>;
  projectsOpen: boolean;
  securityAuditOpen: boolean;
  threadsOpen: boolean;
  workspaceActiveOpen: boolean;
  workspaceOpen: boolean;
};

const listeners = new Set<() => void>();

let sidebarPanelsSnapshot: SidebarPanelsSnapshot | null = null;

/**
 * Load the sidebar snapshot lazily from cache or persisted storage.
 */
function ensureSidebarPanelsSnapshot(): SidebarPanelsSnapshot {
  if (sidebarPanelsSnapshot) {
    return sidebarPanelsSnapshot;
  }

  const persistedState = readPersistedTreeViewState();
  sidebarPanelsSnapshot = {
    gitHistoryOpen: persistedState.gitSectionOpen,
    openProjectPaths: new Set(persistedState.openProjectPaths),
    projectsOpen: persistedState.projectsSectionOpen,
    securityAuditOpen: persistedState.securityAuditSectionOpen,
    threadsOpen: persistedState.threadsSectionOpen,
    workspaceActiveOpen: persistedState.workspaceActiveSectionOpen,
    workspaceOpen: persistedState.workspaceSectionOpen,
  };
  return sidebarPanelsSnapshot;
}

/**
 * Notify all mounted subscribers that sidebar panel state has changed.
 */
function emitSidebarPanelsChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Persist snapshot to storage so expanded/collapsed state survives reloads.
 */
function persistSidebarPanelsSnapshot(snapshot: SidebarPanelsSnapshot): void {
  writePersistedTreeViewState({
    version: TREE_VIEW_STATE_STORAGE_VERSION,
    workspaceSectionOpen: snapshot.workspaceOpen,
    workspaceActiveSectionOpen: snapshot.workspaceActiveOpen,
    projectsSectionOpen: snapshot.projectsOpen,
    threadsSectionOpen: snapshot.threadsOpen,
    gitSectionOpen: snapshot.gitHistoryOpen,
    securityAuditSectionOpen: snapshot.securityAuditOpen,
    openProjectPaths: [...snapshot.openProjectPaths],
  });
}

/**
 * Subscribe/unsubscribe a store listener for external-store updates.
 */
function subscribeToSidebarPanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Update shared snapshot immutably, skip updates when no real change occurred.
 */
function updateSidebarPanelsSnapshot(
  updater: (current: SidebarPanelsSnapshot) => SidebarPanelsSnapshot,
): void {
  const current = ensureSidebarPanelsSnapshot();
  const next = updater(current);
  if (next === current) {
    return;
  }

  sidebarPanelsSnapshot = next;
  persistSidebarPanelsSnapshot(next);
  emitSidebarPanelsChange();
}

/**
 * Read the current sidebar panel snapshot (initialized from persisted storage as needed).
 */
export function readSidebarPanelsSnapshot(): SidebarPanelsSnapshot {
  return ensureSidebarPanelsSnapshot();
}

/**
 * Check whether a project row is currently expanded in sidebar state.
 */
export function isProjectTreeOpen(projectPath: string): boolean {
  return ensureSidebarPanelsSnapshot().openProjectPaths.has(projectPath);
}

/**
 * Persist only the target project path's expanded/collapsed bit.
 */
export function setProjectTreeOpen(projectPath: string, open: boolean): void {
  updateSidebarPanelsSnapshot((current) => {
    const nextOpenProjectPaths = new Set(current.openProjectPaths);
    if (open) {
      nextOpenProjectPaths.add(projectPath);
    } else {
      nextOpenProjectPaths.delete(projectPath);
    }

    if (
      nextOpenProjectPaths.size === current.openProjectPaths.size &&
      [...nextOpenProjectPaths].every((path) =>
        current.openProjectPaths.has(path),
      )
    ) {
      // No-op guard: avoid redundant writes and rerenders when path state is unchanged.
      return current;
    }

    return {
      ...current,
      openProjectPaths: nextOpenProjectPaths,
    };
  });
}

/**
 * Toggle whole projects section open/closed state.
 */
export function toggleProjectsPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    projectsOpen: !current.projectsOpen,
  }));
}

/**
 * Toggle whole workspace section open/closed state.
 */
export function toggleWorkspacePanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    workspaceOpen: !current.workspaceOpen,
  }));
}

/**
 * Toggle workspace active section open/closed state.
 */
export function toggleWorkspaceActiveSectionOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    workspaceActiveOpen: !current.workspaceActiveOpen,
  }));
}

/**
 * Toggle all threads section open/closed state.
 */
export function toggleThreadsPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    threadsOpen: !current.threadsOpen,
  }));
}

/**
 * Toggle git history section open/closed state.
 */
export function toggleGitHistoryPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    gitHistoryOpen: !current.gitHistoryOpen,
  }));
}

/**
 * Toggle security audit section open/closed state.
 */
export function toggleSecurityAuditPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    securityAuditOpen: !current.securityAuditOpen,
  }));
}

/**
 * Subscribe to the projects section open state from the shared snapshot.
 */
export function useProjectsPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().projectsOpen,
    () => ensureSidebarPanelsSnapshot().projectsOpen,
  );
}

/**
 * Subscribe to the workspace panel open state from the shared snapshot.
 */
export function useWorkspacePanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().workspaceOpen,
    () => ensureSidebarPanelsSnapshot().workspaceOpen,
  );
}

/**
 * Subscribe to workspace active section open state from the shared snapshot.
 */
export function useWorkspaceActiveSectionOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().workspaceActiveOpen,
    () => ensureSidebarPanelsSnapshot().workspaceActiveOpen,
  );
}

/**
 * Subscribe to threads section open state from the shared snapshot.
 */
export function useThreadsPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().threadsOpen,
    () => ensureSidebarPanelsSnapshot().threadsOpen,
  );
}

/**
 * Subscribe to git history section open state from the shared snapshot.
 */
export function useGitHistoryPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().gitHistoryOpen,
    () => ensureSidebarPanelsSnapshot().gitHistoryOpen,
  );
}

/**
 * Subscribe to security audit section open state from the shared snapshot.
 */
export function useSecurityAuditPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().securityAuditOpen,
    () => ensureSidebarPanelsSnapshot().securityAuditOpen,
  );
}

/**
 * Subscribe to the current set of expanded project paths for tree rendering.
 */
export function useOpenProjectPaths(): Set<string> {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().openProjectPaths,
    () => ensureSidebarPanelsSnapshot().openProjectPaths,
  );
}
