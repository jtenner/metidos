/**
 * @file src/mainview/app/workspace-panel.tsx
 * @description Module for workspace panel.
 */

import { memo } from "react";
import type { RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
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
  // Empty-state is shown only when both pinned and recent lists are empty.
  const hasThreads =
    workspacePinnedThreads.length > 0 || workspaceActiveThreads.length > 0;

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Threads"
        open={workspaceOpen}
        onToggle={toggleWorkspacePanelOpen}
        action={
          <div className="group relative">
            <button
              type="button"
              className={sidebarActionButtonClass}
              onClick={onCreateThread}
              disabled={isCreatingThread || !canCreateThread}
              aria-label="Create thread for selected worktree"
              title={
                canCreateThread
                  ? "Create thread for selected worktree"
                  : "Select an open worktree first"
              }
            >
              +
            </button>
            {canCreateThread ? (
              <div className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 min-w-[220px] -translate-y-1/2 rounded-md border border-[#2b3b47] bg-[#14181a] px-2.5 py-2 text-[10px] text-[#dce6ec] opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100">
                <div className="font-label text-[9px] uppercase tracking-[0.16em] text-[#8ca6b9]">
                  New thread context
                </div>
                <div className="mt-1 space-y-0.5 text-[11px]">
                  <div>
                    <span className="text-[#7c8f99]">Project:</span>{" "}
                    <span className="truncate">
                      {selectedProjectNameForThread}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#7c8f99]">Branch:</span>{" "}
                    <span className="truncate">
                      {activeSelectedWorktreeBranch}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#7c8f99]">Worktree:</span>{" "}
                    <span className="truncate">
                      {activeSelectedWorktreeFolder}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        }
      />
      {workspaceOpen ? (
        <div className="mt-3 space-y-4">
          {!hasThreads ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              No pinned or recent threads yet.
            </div>
          ) : null}
          {/* Pinned section is always visible when present and never collapsible. */}
          {workspacePinnedThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
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
              <button
                type="button"
                className="group flex w-full items-center gap-2 px-3 pb-1 text-left transition-colors"
                onClick={toggleWorkspaceActiveSectionOpen}
                aria-expanded={workspaceActiveOpen}
              >
                <span className="font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                  Recent
                </span>
                <span className="ml-auto shrink-0 text-[#62737e] transition-colors group-hover:text-[#bdd5e6]">
                  {materialSymbol(
                    workspaceActiveOpen ? "expand_more" : "chevron_right",
                    "text-[14px]",
                  )}
                </span>
              </button>
              {workspaceActiveOpen ? (
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
                  threads={workspaceActiveThreads}
                  worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                  worktreeByProjectAndPath={worktreeByProjectAndPath}
                />
              ) : null}
            </div>
          ) : null}
          {/* Thread-level backend/API errors are surfaced directly in the workspace list. */}
          {threadsError ? (
            <div className="bg-[#2c1117] px-3 py-2 text-xs text-[#ff9db0]">
              {threadsError}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
