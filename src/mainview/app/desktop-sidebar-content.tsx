/**
 * @file src/mainview/app/desktop-sidebar-content.tsx
 * @description Module for desktop sidebar content.
 */

import {
  type ComponentProps,
  type FormEvent,
  type JSX,
  type Ref,
  useRef,
} from "react";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { PopoverSurface } from "../controls/popover";
import { SidebarSearchControl } from "../controls/sidebar-search-control";
import { GitHistoryPanel } from "./git-history-panel";
import { PinnedFoldersPanel } from "./pinned-folders-panel";
import { PinnedThreadsPanel } from "./pinned-threads-panel";

type DesktopSidebarContentProps = {
  activeSidebarBranchLabel: string;
  activeWorktreePinDisabled: boolean;
  activeWorktreePinned: boolean;
  collapseControl: JSX.Element | null;
  folderSelectorControl: JSX.Element | null;
  folderSelectorOpen: boolean;
  gitHistoryPanelKey: string;
  isCreatingWorkspace: boolean;
  isCreatingThread: boolean;
  terminalAccessAllowed: boolean;
  newWorkspaceError: string;
  newWorkspaceName: string;
  newWorkspaceOpen: boolean;
  onCreateThread: () => void;
  onCreateTerminal: () => void;
  onCloseNewWorkspace: () => void;
  onNewWorkspaceNameChange: (value: string) => void;
  onSidebarSearchQueryChange: (value: string) => void;
  onSubmitNewWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  onToggleActiveWorktreePinned: () => void;
  onToggleFolderSelector: () => void;
  onToggleNewWorkspace: () => void;
  scrollRef?: Ref<HTMLDivElement>;
  selectedProjectName: string | null;
  sidebarSearchQuery: string;
} & ComponentProps<typeof GitHistoryPanel> &
  ComponentProps<typeof PinnedFoldersPanel> &
  ComponentProps<typeof PinnedThreadsPanel>;

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
 * Renders the desktop-only sidebar shell with folder selector, threads, and git history.
 */
export function DesktopSidebarContent({
  activeSidebarBranchLabel,
  activeWorktreePinDisabled,
  activeWorktreePinned,
  collapseControl,
  folderSelectorControl,
  folderSelectorOpen,
  gitHistoryPanelKey,
  isCreatingWorkspace,
  activeSelectedWorktreeMissing,
  activeSelectedWorktreePath,
  filteredGitHistoryEntries,
  gitHistoryError,
  gitHistoryLoading,
  gitHistoryLoadingMore,
  isCreatingThread,
  terminalAccessAllowed,
  newWorkspaceError,
  newWorkspaceName,
  newWorkspaceOpen,
  normalizedSidebarSearchQuery,
  onLoadMoreGitHistory,
  onLoadMoreThreads,
  onCreateThread,
  onCreateTerminal,
  onCloseNewWorkspace,
  onNewWorkspaceNameChange,
  onOpenFolder,
  onOpenGitHistoryDiff,
  onOpenThread,
  onOpenThreadActionMenu,
  onSidebarSearchQueryChange,
  onSubmitNewWorkspace,
  onToggleActiveWorktreePinned,
  onToggleFolderSelector,
  onToggleNewWorkspace,
  pinnedFolders,
  pinnedThreads,
  recentThreads,
  scrollRef,
  selectedProject,
  selectedProjectName,
  activeProjectId,
  activeWorktreePath,
  acknowledgeThreadErrorSeenInBackground,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  projectById,
  selectedThreadId,
  sidebarSearchQuery,
  threadActivityIndicator,
  threadPreviewsDisabled,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: DesktopSidebarContentProps): JSX.Element {
  const folderSelectorToggleLabel = folderSelectorOpen
    ? "Close folder picker"
    : "Open folder picker";
  const newWorkspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const newWorkspaceInputRef = useRef<HTMLInputElement | null>(null);
  const newWorkspaceToggleLabel = newWorkspaceOpen
    ? "Close New Worktree"
    : "New Worktree";

  return (
    <div className="flex h-full flex-col">
      {/* Top controls row — collapse only; folder actions live with the active folder. */}
      <div className="flex items-center justify-end border-b border-border-subtle px-3 py-2">
        {collapseControl}
      </div>

      {/* Project context header — folder name, branch, and active-folder actions. */}
      <div className="select-none border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-4 text-text-primary">
              {selectedProjectName ?? "No project selected"}
            </div>
            <div className="truncate font-label text-[11px] font-semibold tracking-[0.1em] text-accent">
              {activeSidebarBranchLabel}
            </div>
          </div>
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
          {terminalAccessAllowed ? (
            <AppButton
              aria-label="New terminal"
              buttonStyle="muted"
              disabled={!selectedProject || !activeSelectedWorktreePath}
              iconOnly
              onClick={onCreateTerminal}
              title="New Terminal"
            >
              {materialSymbol("terminal", "text-[16px]")}
            </AppButton>
          ) : null}
          <AppButton
            aria-label={newWorkspaceToggleLabel}
            aria-expanded={newWorkspaceOpen}
            buttonStyle={newWorkspaceOpen ? "secondary" : "muted"}
            disabled={!selectedProject}
            iconOnly
            onClick={onToggleNewWorkspace}
            ref={newWorkspaceButtonRef}
            title={newWorkspaceToggleLabel}
          >
            {materialSymbol("fork_arrow", "text-[19px]")}
          </AppButton>
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
        </div>
      </div>

      <PopoverSurface
        aria-label="New Worktree"
        className="z-[85] w-72 select-none border border-border-default bg-surface-overlay p-3 shadow-overlay backdrop-blur-xl"
        initialFocusRef={newWorkspaceInputRef}
        offsetPx={8}
        onRequestClose={onCloseNewWorkspace}
        open={newWorkspaceOpen}
        placement="bottom-end"
        reference={newWorkspaceButtonRef.current}
        restoreFocusReference={newWorkspaceButtonRef.current}
        surfaceMode="nonmodal-dialog"
      >
        <form className="space-y-3" onSubmit={onSubmitNewWorkspace}>
          <label
            className="block text-[10px] font-label uppercase tracking-[0.1em] text-accent"
            htmlFor="new-workspace-folder-name"
          >
            Worktree Folder
          </label>
          <input
            id="new-workspace-folder-name"
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
            <div className="text-xs text-danger-text">{newWorkspaceError}</div>
          ) : null}
        </form>
      </PopoverSurface>

      {folderSelectorControl}

      {/* Search — filters sidebar lists. */}
      <div className="px-3 pt-2">
        <SidebarSearchControl
          value={sidebarSearchQuery}
          onValueChange={onSidebarSearchQueryChange}
        />
      </div>

      {/* Sidebar sections with consistent border separators. */}
      <div
        ref={scrollRef}
        className="app-scrollbar select-none flex-1 overflow-y-auto px-3 pb-5 pt-2"
      >
        <PinnedFoldersPanel
          activeProjectId={activeProjectId}
          activeWorktreePath={activeWorktreePath}
          normalizedSidebarSearchQuery={normalizedSidebarSearchQuery}
          onOpenFolder={onOpenFolder}
          pinnedFolders={pinnedFolders}
        />
        <div className="my-2 h-px bg-border-subtle" />
        <PinnedThreadsPanel
          acknowledgeThreadErrorSeenInBackground={
            acknowledgeThreadErrorSeenInBackground
          }
          clearCompletedThreadIndicator={clearCompletedThreadIndicator}
          dismissThreadStatus={dismissThreadStatus}
          isThreadStatusDismissed={isThreadStatusDismissed}
          normalizedSidebarSearchQuery={normalizedSidebarSearchQuery}
          {...(onLoadMoreThreads ? { onLoadMoreThreads } : {})}
          onOpenThread={onOpenThread}
          onOpenThreadActionMenu={onOpenThreadActionMenu}
          pinnedThreads={pinnedThreads}
          projectById={projectById}
          recentThreads={recentThreads}
          selectedThreadId={selectedThreadId}
          threadActivityIndicator={threadActivityIndicator}
          threadPreviewsDisabled={threadPreviewsDisabled}
          threadsError={threadsError}
          worktreeDisplayPathByKey={worktreeDisplayPathByKey}
          worktreeByProjectAndPath={worktreeByProjectAndPath}
        />
        <div className="my-2 h-px bg-border-subtle" />
        <GitHistoryPanel
          key={gitHistoryPanelKey}
          activeSelectedWorktreeMissing={activeSelectedWorktreeMissing}
          activeSelectedWorktreePath={activeSelectedWorktreePath}
          filteredGitHistoryEntries={filteredGitHistoryEntries}
          gitHistoryError={gitHistoryError}
          gitHistoryLoading={gitHistoryLoading}
          gitHistoryLoadingMore={gitHistoryLoadingMore}
          onLoadMoreGitHistory={onLoadMoreGitHistory}
          onOpenGitHistoryDiff={onOpenGitHistoryDiff}
          selectedProject={selectedProject}
        />
      </div>
    </div>
  );
}
