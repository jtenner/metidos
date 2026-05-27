/**
 * @file src/mainview/app/use-desktop-thread-switcher.ts
 * @description Desktop worktree-thread switcher controller extraction for App.tsx.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import { deriveDesktopThreadSwitcherSections } from "./desktop-thread-switcher";
import { formatPathForDisplay } from "./path-display-state";
import { worktreeThreadPopoverAnchorId } from "./thread-ui-state";

type DesktopThreadSwitcherTarget = {
  projectId: number;
  worktreePath: string;
};

type UseDesktopThreadSwitcherParams = {
  activeSelectedWorktree: RpcWorktree | null;
  activeSelectedWorktreeFolder: string;
  activeSelectedWorktreeName: string;
  activeSelectedWorktreePath: string | null;
  homeDirectory: string;
  isDesktopViewport: boolean;
  selectedProject: RpcProject | null;
  sidebarCollapsed: boolean;
  threads: RpcThread[];
};

/**
 * Keep desktop worktree-thread switcher state and derived labels out of App.tsx.
 */
export function useDesktopThreadSwitcher({
  activeSelectedWorktree,
  activeSelectedWorktreeFolder,
  activeSelectedWorktreeName,
  activeSelectedWorktreePath,
  homeDirectory,
  isDesktopViewport,
  selectedProject,
  sidebarCollapsed,
  threads,
}: UseDesktopThreadSwitcherParams) {
  const [
    desktopThreadSwitcherSearchQuery,
    setDesktopThreadSwitcherSearchQuery,
  ] = useState("");
  const [desktopThreadSwitcherTarget, setDesktopThreadSwitcherTarget] =
    useState<DesktopThreadSwitcherTarget | null>(null);

  const desktopThreadSwitcherOpen =
    desktopThreadSwitcherTarget !== null &&
    selectedProject?.id === desktopThreadSwitcherTarget.projectId &&
    activeSelectedWorktreePath === desktopThreadSwitcherTarget.worktreePath &&
    isDesktopViewport &&
    !sidebarCollapsed;
  const desktopThreadSwitcherAnchorId = desktopThreadSwitcherOpen
    ? worktreeThreadPopoverAnchorId(
        desktopThreadSwitcherTarget.projectId,
        desktopThreadSwitcherTarget.worktreePath,
      )
    : null;

  const selectedWorktreeThreads = useMemo(() => {
    if (!selectedProject || !activeSelectedWorktreePath) {
      return [];
    }

    return threads.filter(
      (thread) =>
        thread.projectId === selectedProject.id &&
        thread.worktreePath === activeSelectedWorktreePath,
    );
  }, [activeSelectedWorktreePath, selectedProject, threads]);

  const desktopThreadSwitcherSections = useMemo(
    () =>
      deriveDesktopThreadSwitcherSections(
        selectedWorktreeThreads,
        desktopThreadSwitcherSearchQuery,
      ),
    [desktopThreadSwitcherSearchQuery, selectedWorktreeThreads],
  );

  const desktopPinnedThreads = useMemo(
    () => threads.filter((thread) => thread.pinnedAt !== null),
    [threads],
  );

  const closeDesktopThreadSwitcher = useCallback(
    (restoreFocus = false): void => {
      // Capture the current anchor before clearing target state; the next render
      // intentionally derives a null anchor while focus restoration still needs
      // the element that opened this switcher.
      const anchorId = desktopThreadSwitcherAnchorId;
      setDesktopThreadSwitcherTarget(null);
      setDesktopThreadSwitcherSearchQuery("");

      if (!restoreFocus || !anchorId || typeof window === "undefined") {
        return;
      }

      window.requestAnimationFrame(() => {
        const anchor = document.getElementById(anchorId);
        if (anchor instanceof HTMLElement) {
          anchor.focus();
        }
      });
    },
    [desktopThreadSwitcherAnchorId],
  );

  const openDesktopThreadSwitcher = useCallback(
    (projectId: number, worktreePath: string): void => {
      if (
        !isDesktopViewport ||
        sidebarCollapsed ||
        selectedProject?.id !== projectId ||
        activeSelectedWorktreePath !== worktreePath
      ) {
        return;
      }

      setDesktopThreadSwitcherSearchQuery("");
      setDesktopThreadSwitcherTarget((current) => {
        if (
          current?.projectId === projectId &&
          current.worktreePath === worktreePath
        ) {
          return current;
        }

        return {
          projectId,
          worktreePath,
        };
      });
    },
    [
      activeSelectedWorktreePath,
      isDesktopViewport,
      selectedProject,
      sidebarCollapsed,
    ],
  );

  useEffect(() => {
    if (!desktopThreadSwitcherTarget) {
      return;
    }

    if (
      !isDesktopViewport ||
      sidebarCollapsed ||
      selectedProject?.id !== desktopThreadSwitcherTarget.projectId ||
      activeSelectedWorktreePath !== desktopThreadSwitcherTarget.worktreePath
    ) {
      setDesktopThreadSwitcherTarget(null);
      setDesktopThreadSwitcherSearchQuery("");
    }
  }, [
    activeSelectedWorktreePath,
    desktopThreadSwitcherTarget,
    isDesktopViewport,
    selectedProject,
    sidebarCollapsed,
  ]);

  return {
    closeDesktopThreadSwitcher,
    desktopPinnedThreads,
    desktopThreadSwitcherAnchorId,
    desktopThreadSwitcherOpen,
    desktopThreadSwitcherSearchQuery,
    desktopThreadSwitcherSections,
    openDesktopThreadSwitcher,
    setDesktopThreadSwitcherSearchQuery,
    worktreeLabel: activeSelectedWorktreeName || activeSelectedWorktreeFolder,
    worktreeSubtitle: activeSelectedWorktreePath
      ? `${activeSelectedWorktree?.branch?.trim() || "Primary"} · ${formatPathForDisplay(
          activeSelectedWorktreePath,
          homeDirectory,
          true,
        )}`
      : activeSelectedWorktreeFolder || "Current worktree",
  };
}
