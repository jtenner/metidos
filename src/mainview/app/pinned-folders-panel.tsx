/**
 * @file src/mainview/app/pinned-folders-panel.tsx
 * @description Module for pinned folder sidebar shortcuts.
 */

import { type JSX, memo, useCallback } from "react";
import { AppButton } from "../controls/button";
import type { RpcProject, RpcWorktree } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import { shortName } from "./project-worktree-state";
import {
  toggleFoldersPanelOpen,
  useFoldersPanelOpen,
} from "./sidebar-panels-state";

const PINNED_FOLDERS_PANEL_TITLE_ID = "desktop-folders-panel-title";
const PINNED_FOLDERS_PANEL_REGION_ID = "desktop-folders-panel-region";

export type PinnedFolderRow = {
  displayPath: string;
  project: RpcProject;
  worktree: RpcWorktree;
};

type PinnedFoldersPanelProps = {
  activeProjectId: number | null;
  activeWorktreePath: string | null;
  normalizedSidebarSearchQuery: string;
  onOpenFolder: (project: RpcProject, worktreePath: string) => void;
  pinnedFolders: PinnedFolderRow[];
};

type PinnedFolderShortcutProps = {
  active: boolean;
  displayPath: string;
  onOpenFolder: (project: RpcProject, worktreePath: string) => void;
  project: RpcProject;
  worktree: RpcWorktree;
};

const PinnedFolderShortcut = memo(function PinnedFolderShortcut({
  active,
  displayPath,
  onOpenFolder,
  project,
  worktree,
}: PinnedFolderShortcutProps): JSX.Element {
  const branchLabel = worktree.branch?.trim() ?? "Primary";
  const title = shortName(worktree.path);
  const ariaLabel = `Open folder ${title}. Project ${project.name}. Branch ${branchLabel}. Path ${displayPath}.`;
  const handleOpenFolder = useCallback((): void => {
    onOpenFolder(project, worktree.path);
  }, [onOpenFolder, project, worktree.path]);

  return (
    <AppButton
      unstyled
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      className={`w-full px-3 py-2 text-left transition-colors ${
        active
          ? "list-row-active-accent bg-surface-2 text-text-primary"
          : "text-text-secondary hover:bg-surface-1"
      }`}
      onClick={handleOpenFolder}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center ${
            active
              ? "bg-surface-2 text-accent-strong"
              : "bg-surface-3 text-accent"
          }`}
        >
          {project.faviconDataUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="h-4 w-4 object-contain"
              decoding="async"
              src={project.faviconDataUrl}
            />
          ) : (
            materialSymbol(active ? "folder_open" : "folder", "text-[14px]")
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-4">
            {title}
          </div>
          <div className="mt-1 truncate text-[11px] leading-4 text-text-muted">
            {project.name} · {branchLabel} · {displayPath}
          </div>
        </div>
      </div>
    </AppButton>
  );
});

/**
 * Lists pinned folders as quick workspace switches above the thread list.
 */
export const PinnedFoldersPanel = memo(function PinnedFoldersPanel({
  activeProjectId,
  activeWorktreePath,
  normalizedSidebarSearchQuery,
  onOpenFolder,
  pinnedFolders,
}: PinnedFoldersPanelProps): JSX.Element {
  const foldersOpen = useFoldersPanelOpen();

  return (
    <section
      aria-labelledby={PINNED_FOLDERS_PANEL_TITLE_ID}
      className="select-none"
    >
      <SidebarSectionHeader
        controlsId={PINNED_FOLDERS_PANEL_REGION_ID}
        title="Folders"
        titleId={PINNED_FOLDERS_PANEL_TITLE_ID}
        open={foldersOpen}
        onToggle={toggleFoldersPanelOpen}
      />
      {foldersOpen ? (
        <section
          id={PINNED_FOLDERS_PANEL_REGION_ID}
          aria-labelledby={PINNED_FOLDERS_PANEL_TITLE_ID}
          className="mt-3 space-y-1"
        >
          {pinnedFolders.length === 0 ? (
            <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
              {normalizedSidebarSearchQuery
                ? "No matching folders."
                : "No pinned folders yet."}
            </div>
          ) : (
            pinnedFolders.map(({ displayPath, project, worktree }) => (
              <PinnedFolderShortcut
                active={
                  activeProjectId === project.id &&
                  activeWorktreePath === worktree.path
                }
                displayPath={displayPath}
                key={`${project.id}:${worktree.path}`}
                onOpenFolder={onOpenFolder}
                project={project}
                worktree={worktree}
              />
            ))
          )}
        </section>
      ) : null}
    </section>
  );
});
