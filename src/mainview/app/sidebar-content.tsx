/**
 * @file src/mainview/app/sidebar-content.tsx
 * @description Module for sidebar content.
 */

import { type ComponentProps, type FormEvent, type JSX, useRef } from "react";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { PopoverSurface } from "../controls/popover";
import { SidebarSearchControl } from "../controls/sidebar-search-control";
import { GitHistoryPanel } from "./git-history-panel";
import { PinnedFoldersPanel } from "./pinned-folders-panel";
import { PinnedThreadsPanel } from "./pinned-threads-panel";

type SidebarContentProps = {
  activeSidebarBranchLabel: string;
  activeWorktreePinDisabled: boolean;
  activeWorktreePinned: boolean;
  collapseControl: JSX.Element | null;
  folderSelectorControl: JSX.Element | null;
  folderSelectorOpen: boolean;
  gitHistoryPanelKey: string;
  gitHistoryPanelProps: ComponentProps<typeof GitHistoryPanel>;
  isCreatingThread: boolean;
  isCreatingWorkspace: boolean;
  newWorkspaceError: string;
  newWorkspaceName: string;
  newWorkspaceOpen: boolean;
  onCloseNewWorkspace: () => void;
  onCreateThread: () => void;
  onNewWorkspaceNameChange: (value: string) => void;
  onSidebarSearchQueryChange: (value: string) => void;
  onSubmitNewWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  onToggleActiveWorktreePinned: () => void;
  onToggleFolderSelector: () => void;
  onToggleNewWorkspace: () => void;
  pinnedFoldersPanelProps: ComponentProps<typeof PinnedFoldersPanel>;
  pinnedThreadsPanelProps: ComponentProps<typeof PinnedThreadsPanel>;
  selectedProjectName: string | null;
  sidebarSearchQuery: string;
  workspaceActionDisabled: boolean;
};

const FOLDER_ADD_ICON: JSX.Element = (
  <span className="relative inline-flex h-[1em] w-[1em] items-center justify-center">
    {materialSymbol("folder", "text-[16px]")}
    <span
      aria-hidden="true"
      className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center border border-surface-2 bg-accent-strong text-surface-3"
    >
      {materialSymbol("plus", "text-[9px]")}
    </span>
  </span>
);

/**
 * Renders the sidebar header plus sectioned content for threads and git history.
 */
export function SidebarContent({
  activeSidebarBranchLabel,
  activeWorktreePinDisabled,
  activeWorktreePinned,
  collapseControl,
  folderSelectorControl,
  folderSelectorOpen,
  gitHistoryPanelKey,
  gitHistoryPanelProps,
  isCreatingThread,
  isCreatingWorkspace,
  newWorkspaceError,
  newWorkspaceName,
  newWorkspaceOpen,
  onCloseNewWorkspace,
  onCreateThread,
  onNewWorkspaceNameChange,
  onSidebarSearchQueryChange,
  onSubmitNewWorkspace,
  onToggleActiveWorktreePinned,
  onToggleFolderSelector,
  onToggleNewWorkspace,
  pinnedFoldersPanelProps,
  pinnedThreadsPanelProps,
  selectedProjectName,
  sidebarSearchQuery,
  workspaceActionDisabled,
}: SidebarContentProps): JSX.Element {
  const folderSelectorToggleLabel = folderSelectorOpen
    ? "Close folder picker"
    : "Open folder picker";
  const newWorkspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const newWorkspaceInputRef = useRef<HTMLInputElement | null>(null);
  const newWorkspaceToggleLabel = newWorkspaceOpen
    ? "Close New Worktree"
    : "New Worktree";

  return (
    <div className="flex flex-col">
      {/* Project context header — flat region with border separation. */}
      <div className="select-none border-b border-border-subtle px-1 pb-2 pt-1">
        <div className="px-2">
          <div className="truncate text-[14px] font-semibold leading-4 text-text-primary">
            {selectedProjectName ?? "No project selected"}
          </div>
          <div className="truncate font-label text-[11px] font-semibold tracking-[0.1em] text-accent">
            {activeSidebarBranchLabel}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
          <AppButton
            aria-label={folderSelectorToggleLabel}
            aria-expanded={folderSelectorOpen}
            buttonStyle={folderSelectorOpen ? "secondary" : "muted"}
            iconOnly
            onClick={onToggleFolderSelector}
            title={folderSelectorToggleLabel}
          >
            {FOLDER_ADD_ICON}
          </AppButton>
          <AppButton
            aria-label={
              activeWorktreePinned ? "Unpin active folder" : "Pin active folder"
            }
            buttonStyle={activeWorktreePinned ? "secondary" : "muted"}
            disabled={activeWorktreePinDisabled}
            iconOnly
            onClick={onToggleActiveWorktreePinned}
            title={
              activeWorktreePinned ? "Unpin active folder" : "Pin active folder"
            }
          >
            {materialSymbol("push_pin", "text-[16px]", {
              filled: activeWorktreePinned,
            })}
          </AppButton>
          <AppButton
            aria-label={newWorkspaceToggleLabel}
            aria-expanded={newWorkspaceOpen}
            buttonStyle={newWorkspaceOpen ? "secondary" : "muted"}
            disabled={workspaceActionDisabled}
            iconOnly
            onClick={onToggleNewWorkspace}
            ref={newWorkspaceButtonRef}
            title={newWorkspaceToggleLabel}
          >
            {materialSymbol("fork_arrow", "text-[19px]")}
          </AppButton>
          <AppButton
            aria-busy={isCreatingThread}
            aria-label="New thread"
            buttonStyle="muted"
            disabled={isCreatingThread}
            iconOnly
            onClick={onCreateThread}
            title={isCreatingThread ? "Creating thread..." : "New Thread"}
          >
            {isCreatingThread
              ? materialSymbol("bolt", "animate-pulse text-[16px]")
              : materialSymbol("plus", "text-[16px]")}
          </AppButton>
          {collapseControl}
        </div>
        <PopoverSurface
          aria-label="New Worktree"
          className="z-[85] w-72 select-none border border-border-default bg-surface-overlay p-3 shadow-overlay backdrop-blur-xl"
          initialFocusRef={newWorkspaceInputRef}
          offsetPx={8}
          onRequestClose={onCloseNewWorkspace}
          open={newWorkspaceOpen}
          placement="bottom-start"
          reference={newWorkspaceButtonRef.current}
          restoreFocusReference={newWorkspaceButtonRef.current}
          surfaceMode="nonmodal-dialog"
        >
          <form className="space-y-3" onSubmit={onSubmitNewWorkspace}>
            <label
              className="block text-[10px] font-label uppercase tracking-[0.1em] text-accent"
              htmlFor="mobile-new-workspace-folder-name"
            >
              Worktree Folder
            </label>
            <input
              id="mobile-new-workspace-folder-name"
              className="h-8 w-full select-text border border-border-default bg-surface-1 px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-faint focus:border-focus-ring"
              ref={newWorkspaceInputRef}
              placeholder="feature-worktree"
              value={newWorkspaceName}
              onChange={(event) => {
                onNewWorkspaceNameChange(event.currentTarget.value);
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="flex items-center justify-end gap-2">
              <AppButton buttonStyle="secondary" onClick={onCloseNewWorkspace}>
                Cancel
              </AppButton>
              <AppButton
                buttonStyle="primary"
                type="submit"
                disabled={isCreatingWorkspace}
              >
                {isCreatingWorkspace ? "Creating" : "Ok"}
              </AppButton>
            </div>
            {newWorkspaceError ? (
              <div className="text-xs text-danger-text">
                {newWorkspaceError}
              </div>
            ) : null}
          </form>
        </PopoverSurface>
        {folderSelectorControl}
        <div className="mt-2 px-2">
          <SidebarSearchControl
            value={sidebarSearchQuery}
            onValueChange={onSidebarSearchQueryChange}
          />
        </div>
      </div>

      {/* Sidebar sections with consistent border separators. */}
      <div className="select-none flex-1 pt-2">
        <PinnedFoldersPanel {...pinnedFoldersPanelProps} />
        <div className="my-2 h-px bg-border-subtle" />
        <PinnedThreadsPanel {...pinnedThreadsPanelProps} />
        <div className="my-2 h-px bg-border-subtle" />
        <GitHistoryPanel key={gitHistoryPanelKey} {...gitHistoryPanelProps} />
      </div>
    </div>
  );
}
