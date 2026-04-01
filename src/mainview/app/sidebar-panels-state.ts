import { useSyncExternalStore } from "react";
import {
  TREE_VIEW_STATE_STORAGE_VERSION,
  readPersistedTreeViewState,
  writePersistedTreeViewState,
} from "./state";

type SidebarPanelsSnapshot = {
  gitHistoryOpen: boolean;
  openProjectPaths: Set<string>;
  projectsOpen: boolean;
  threadsOpen: boolean;
};

const listeners = new Set<() => void>();

let sidebarPanelsSnapshot: SidebarPanelsSnapshot | null = null;

function ensureSidebarPanelsSnapshot(): SidebarPanelsSnapshot {
  if (sidebarPanelsSnapshot) {
    return sidebarPanelsSnapshot;
  }

  const persistedState = readPersistedTreeViewState();
  sidebarPanelsSnapshot = {
    gitHistoryOpen: persistedState.gitSectionOpen,
    openProjectPaths: new Set(persistedState.openProjectPaths),
    projectsOpen: persistedState.projectsSectionOpen,
    threadsOpen: persistedState.threadsSectionOpen,
  };
  return sidebarPanelsSnapshot;
}

function emitSidebarPanelsChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function persistSidebarPanelsSnapshot(snapshot: SidebarPanelsSnapshot): void {
  writePersistedTreeViewState({
    version: TREE_VIEW_STATE_STORAGE_VERSION,
    projectsSectionOpen: snapshot.projectsOpen,
    threadsSectionOpen: snapshot.threadsOpen,
    gitSectionOpen: snapshot.gitHistoryOpen,
    openProjectPaths: [...snapshot.openProjectPaths],
  });
}

function subscribeToSidebarPanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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

export function readSidebarPanelsSnapshot(): SidebarPanelsSnapshot {
  return ensureSidebarPanelsSnapshot();
}

export function isProjectTreeOpen(projectPath: string): boolean {
  return ensureSidebarPanelsSnapshot().openProjectPaths.has(projectPath);
}

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
      return current;
    }

    return {
      ...current,
      openProjectPaths: nextOpenProjectPaths,
    };
  });
}

export function toggleProjectsPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    projectsOpen: !current.projectsOpen,
  }));
}

export function toggleThreadsPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    threadsOpen: !current.threadsOpen,
  }));
}

export function toggleGitHistoryPanelOpen(): void {
  updateSidebarPanelsSnapshot((current) => ({
    ...current,
    gitHistoryOpen: !current.gitHistoryOpen,
  }));
}

export function useProjectsPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().projectsOpen,
    () => ensureSidebarPanelsSnapshot().projectsOpen,
  );
}

export function useThreadsPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().threadsOpen,
    () => ensureSidebarPanelsSnapshot().threadsOpen,
  );
}

export function useGitHistoryPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().gitHistoryOpen,
    () => ensureSidebarPanelsSnapshot().gitHistoryOpen,
  );
}

export function useOpenProjectPaths(): Set<string> {
  return useSyncExternalStore(
    subscribeToSidebarPanels,
    () => ensureSidebarPanelsSnapshot().openProjectPaths,
    () => ensureSidebarPanelsSnapshot().openProjectPaths,
  );
}
