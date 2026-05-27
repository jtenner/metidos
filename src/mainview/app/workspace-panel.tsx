/**
 * @file src/mainview/app/workspace-panel.tsx
 * @description Module for workspace panel.
 */

import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { memo, useCallback, useState } from "react";
import { AppButton } from "../controls/button";
import type { RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { PopoverSurface } from "../controls/popover";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleWorkspaceActiveSectionOpen,
  toggleWorkspacePanelOpen,
  useWorkspaceActiveSectionOpen,
  useWorkspacePanelOpen,
} from "./sidebar-panels-state";
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

type WorkspacePanelProps = SharedThreadListProps & {
  /** Suppresses popover previews for thread rows when true. */
  threadPreviewsDisabled: boolean;
  /** Branch of the selected worktree for thread create popover details. */
  activeSelectedWorktreeBranch: string;
  /** Folder name of the selected worktree for thread create popover details. */
  activeSelectedWorktreeFolder: string;
  /** Error text shown at the bottom of the threads panel. */
  threadsError: string;
  /** Indicates whether a thread can be started from the currently selected worktree. */
  canCreateThread: boolean;
  /** Disables the create-thread button while a new thread request is pending. */
  isCreatingThread: boolean;
  /** Name of the selected project for thread create popover details. */
  selectedProjectNameForThread: string;
  /** Shared class names for the header action button. */
  sidebarActionButtonClass: string;
  /** Threads marked as pinned in workspace state. */
  workspaceActiveThreads: RpcThread[];
  /** Unpinned recent threads in workspace state. */
  workspacePinnedThreads: RpcThread[];
  /** Creates a thread for the currently selected open worktree. */
  onCreateThread: () => void;
};

const CREATE_THREAD_POPOVER_ANCHOR_ID = "workspace-create-thread-button";
const WORKSPACE_PANEL_TITLE_ID = "workspace-panel-title";
const WORKSPACE_PANEL_REGION_ID = "workspace-panel-region";
const WORKSPACE_RECENT_THREADS_TOGGLE_ID = "workspace-recent-threads-toggle";
const WORKSPACE_RECENT_THREADS_REGION_ID = "workspace-recent-threads-region";

function createThreadAnchorStillActive(anchorId: string): boolean {
  // Keep the popover visible when hover/focus remains on the anchor.
  if (typeof document === "undefined") {
    return false;
  }

  const anchor = document.getElementById(anchorId);
  if (!(anchor instanceof HTMLElement)) {
    return false;
  }

  const activeElement = document.activeElement;
  return (
    anchor.matches(":hover") ||
    anchor === activeElement ||
    anchor.contains(activeElement)
  );
}

/**
 * Renders the threads workspace section in the left panel.
 * Shows pinned threads, a collapsible recent threads section, and panel-level error text.
 */
export const WorkspacePanel = memo(function WorkspacePanel({
  acknowledgeThreadErrorSeenInBackground,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  projectById,
  activeSelectedWorktreeBranch,
  activeSelectedWorktreeFolder,
  selectedThreadId,
  threadPreviewsDisabled,
  threadActivityIndicator,
  canCreateThread,
  isCreatingThread,
  onCreateThread,
  threadsError,
  sidebarActionButtonClass,
  selectedProjectNameForThread,
  worktreeDisplayPathByKey,
  workspaceActiveThreads,
  workspacePinnedThreads,
  worktreeByProjectAndPath,
}: WorkspacePanelProps) {
  // Global panel + section open state is shared with the sidebar panel reducer.
  const workspaceOpen = useWorkspacePanelOpen();
  const workspaceActiveOpen = useWorkspaceActiveSectionOpen();
  const createThreadDisabled = isCreatingThread || !canCreateThread;
  const [createThreadPopoverAnchor, setCreateThreadPopoverAnchor] =
    useState<HTMLElement | null>(null);
  // Empty-state is shown only when both pinned and recent lists are empty.
  const hasThreads =
    workspacePinnedThreads.length > 0 || workspaceActiveThreads.length > 0;

  const showCreateThreadPopover = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
    ): void => {
      setCreateThreadPopoverAnchor(event.currentTarget);
    },
    [],
  );

  const hideCreateThreadPopover = useCallback((): void => {
    setCreateThreadPopoverAnchor(null);
  }, []);

  const deferHideCreateThreadPopover = useCallback((): void => {
    if (typeof window === "undefined") {
      hideCreateThreadPopover();
      return;
    }

    window.requestAnimationFrame(() => {
      if (createThreadAnchorStillActive(CREATE_THREAD_POPOVER_ANCHOR_ID)) {
        return;
      }

      hideCreateThreadPopover();
    });
  }, [hideCreateThreadPopover]);

  return (
    <section aria-labelledby={WORKSPACE_PANEL_TITLE_ID} className="select-none">
      <SidebarSectionHeader
        controlsId={WORKSPACE_PANEL_REGION_ID}
        title="Threads"
        titleId={WORKSPACE_PANEL_TITLE_ID}
        open={workspaceOpen}
        onToggle={toggleWorkspacePanelOpen}
        action={
          <div className="group relative">
            <AppButton
              unstyled
              id={CREATE_THREAD_POPOVER_ANCHOR_ID}
              type="button"
              className={`${sidebarActionButtonClass} ${
                createThreadDisabled ? "cursor-not-allowed opacity-50" : ""
              }`}
              onClick={() => {
                if (createThreadDisabled) {
                  return;
                }
                onCreateThread();
              }}
              disabled={isCreatingThread}
              aria-disabled={createThreadDisabled}
              aria-busy={isCreatingThread}
              aria-label={
                canCreateThread
                  ? "Create thread for selected worktree"
                  : "Select a project and worktree first"
              }
              onMouseEnter={showCreateThreadPopover}
              onMouseLeave={deferHideCreateThreadPopover}
              onFocus={showCreateThreadPopover}
              onBlur={deferHideCreateThreadPopover}
            >
              {materialSymbol("plus", "text-[15px]")}
            </AppButton>
          </div>
        }
      />
      <PopoverSurface
        className="z-[150] max-w-[240px] border border-border-default bg-surface-2 px-3 py-2 text-[10px] text-text-secondary shadow-overlay backdrop-blur-sm"
        hideWhenEscaped={false}
        offsetPx={12}
        open={createThreadPopoverAnchor !== null}
        placement="right"
        reference={createThreadPopoverAnchor}
        role="tooltip"
      >
        <div className="uppercase-label text-text-muted">
          New thread context
        </div>
        <div className="mt-1 text-[11px] leading-5">
          <div className="truncate text-text-secondary">
            {selectedProjectNameForThread}{" "}
            <span className="inline-flex items-center gap-1 text-text-muted">
              {materialSymbol("fork_arrow", "text-[12px] leading-none")}
              <span className="truncate">{activeSelectedWorktreeBranch}</span>
            </span>
          </div>
          <div className="mt-1 truncate text-text-faint">
            {activeSelectedWorktreeFolder}
          </div>
        </div>
      </PopoverSurface>
      {workspaceOpen ? (
        <section
          id={WORKSPACE_PANEL_REGION_ID}
          aria-labelledby={WORKSPACE_PANEL_TITLE_ID}
          className="mt-3 space-y-4"
        >
          {!hasThreads ? (
            <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
              No pinned or recent threads yet.
            </div>
          ) : null}
          {/* Pinned section is always visible when present and never collapsible. */}
          {workspacePinnedThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 uppercase-label text-text-muted">
                Pinned
              </div>
              <ThreadList
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                anchorIdPrefix="workspace-thread"
                clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                dismissThreadStatus={dismissThreadStatus}
                isThreadStatusDismissed={isThreadStatusDismissed}
                onOpenThread={onOpenThread}
                onOpenThreadActionMenu={onOpenThreadActionMenu}
                previewDisabled={threadPreviewsDisabled}
                projectById={projectById}
                selectedThreadId={selectedThreadId}
                showLocation
                threadActivityIndicator={threadActivityIndicator}
                threads={workspacePinnedThreads}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
              />
            </div>
          ) : null}
          {/* Recent threads are behind an explicit toggle and can be hidden to reduce noise. */}
          {workspaceActiveThreads.length > 0 ? (
            <div className="space-y-1">
              <AppButton
                unstyled
                id={WORKSPACE_RECENT_THREADS_TOGGLE_ID}
                type="button"
                className="group flex w-full items-center gap-2 px-3 pb-1 text-left transition-colors"
                onClick={toggleWorkspaceActiveSectionOpen}
                aria-controls={WORKSPACE_RECENT_THREADS_REGION_ID}
                aria-expanded={workspaceActiveOpen}
              >
                <span className="uppercase-label text-text-muted">Recent</span>
                <span className="ml-auto shrink-0 text-text-faint transition-colors group-hover:text-accent-strong">
                  {materialSymbol(
                    workspaceActiveOpen ? "expand_more" : "chevron_right",
                    "text-[14px]",
                  )}
                </span>
              </AppButton>
              {workspaceActiveOpen ? (
                <section
                  id={WORKSPACE_RECENT_THREADS_REGION_ID}
                  aria-labelledby={WORKSPACE_RECENT_THREADS_TOGGLE_ID}
                >
                  <ThreadList
                    acknowledgeThreadErrorSeenInBackground={
                      acknowledgeThreadErrorSeenInBackground
                    }
                    anchorIdPrefix="workspace-thread"
                    clearCompletedThreadIndicator={
                      clearCompletedThreadIndicator
                    }
                    dismissThreadStatus={dismissThreadStatus}
                    isThreadStatusDismissed={isThreadStatusDismissed}
                    onOpenThread={onOpenThread}
                    onOpenThreadActionMenu={onOpenThreadActionMenu}
                    previewDisabled={threadPreviewsDisabled}
                    projectById={projectById}
                    selectedThreadId={selectedThreadId}
                    showLocation
                    threadActivityIndicator={threadActivityIndicator}
                    threads={workspaceActiveThreads}
                    worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                    worktreeByProjectAndPath={worktreeByProjectAndPath}
                  />
                </section>
              ) : null}
            </div>
          ) : null}
          {/* Thread-level backend/API errors are surfaced directly in the workspace list. */}
          {threadsError ? (
            <div className="bg-danger-surface px-3 py-2 text-xs text-danger-text">
              {threadsError}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
});
