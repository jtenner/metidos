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
  /** Error text shown at the bottom of the threads panel. */
  threadsError: string;
  /** Threads marked as pinned in workspace state. */
  workspaceActiveThreads: RpcThread[];
  /** Unpinned recent threads in workspace state. */
  workspacePinnedThreads: RpcThread[];
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
  selectedThreadId,
  threadPreviewsDisabled,
  threadActivityIndicator,
  threadsError,
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
