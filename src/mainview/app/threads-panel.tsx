import { memo } from "react";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleThreadsPanelOpen,
  useThreadsPanelOpen,
} from "./sidebar-panels-state";
import { APP_TITLE } from "./state";
import { type SharedThreadListProps, ThreadListRow } from "./thread-list-row";

type ThreadsPanelProps = SharedThreadListProps & {
  activeSelectedWorktreePath: string | null;
  filteredVisibleThreads: RpcThread[];
  isCreatingThread: boolean;
  normalizedSidebarSearchQuery: string;
  onCreateThread: () => void;
  selectedProject: RpcProject | null;
  sidebarActionButtonClass: string;
  threadsError: string;
};

export const ThreadsPanel = memo(function ThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  activeSelectedWorktreePath,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  errorPreviewHandlers,
  errorPreviewPopover,
  filteredVisibleThreads,
  getProjectState,
  hideErrorPreview,
  hideThreadSummaryPreview,
  homeDirectory,
  isCreatingThread,
  isThreadStatusDismissed,
  normalizedSidebarSearchQuery,
  onCreateThread,
  onOpenThread,
  onOpenThreadActionMenu,
  projects,
  selectedProject,
  selectedThreadId,
  sidebarActionButtonClass,
  supportsTildePath,
  threadActivityIndicator,
  threadSummaryPopover,
  threadSummaryPreviewHandlers,
  threadsError,
}: ThreadsPanelProps) {
  const threadsOpen = useThreadsPanelOpen();

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Threads"
        open={threadsOpen}
        onToggle={toggleThreadsPanelOpen}
        action={
          <button
            type="button"
            className={sidebarActionButtonClass}
            onClick={onCreateThread}
            aria-label="Create thread"
            disabled={
              isCreatingThread ||
              !selectedProject ||
              !activeSelectedWorktreePath
            }
            title={
              selectedProject && activeSelectedWorktreePath
                ? `Start a new ${APP_TITLE} thread for the selected worktree`
                : "Select a project worktree first"
            }
          >
            +
          </button>
        }
      />
      {threadsOpen ? (
        <div className="mt-3 space-y-1">
          {!selectedProject || !activeSelectedWorktreePath ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              Select a project worktree first.
            </div>
          ) : filteredVisibleThreads.length === 0 ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              {normalizedSidebarSearchQuery
                ? "No matching threads in this worktree."
                : `No threads in this worktree yet. Use + to start a ${APP_TITLE} thread for the selected worktree.`}
            </div>
          ) : (
            filteredVisibleThreads.map((thread) => {
              return (
                <ThreadListRow
                  key={thread.id}
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="threads-thread"
                  clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                  dismissThreadStatus={dismissThreadStatus}
                  errorPreviewHandlers={errorPreviewHandlers}
                  errorPreviewPopover={errorPreviewPopover}
                  getProjectState={getProjectState}
                  hideErrorPreview={hideErrorPreview}
                  hideThreadSummaryPreview={hideThreadSummaryPreview}
                  homeDirectory={homeDirectory}
                  isThreadStatusDismissed={isThreadStatusDismissed}
                  onOpenThread={onOpenThread}
                  onOpenThreadActionMenu={onOpenThreadActionMenu}
                  projects={projects}
                  selectedThreadId={selectedThreadId}
                  supportsTildePath={supportsTildePath}
                  thread={thread}
                  threadActivityIndicator={threadActivityIndicator}
                  threadSummaryPopover={threadSummaryPopover}
                  threadSummaryPreviewHandlers={threadSummaryPreviewHandlers}
                />
              );
            })
          )}
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
