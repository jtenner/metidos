import { memo } from "react";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleThreadsPanelOpen,
  useThreadsPanelOpen,
} from "./sidebar-panels-state";
import { APP_TITLE } from "./state";
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

type ThreadsPanelProps = SharedThreadListProps & {
  activeSelectedWorktreePath: string | null;
  filteredVisibleThreads: RpcThread[];
  isCreatingThread: boolean;
  normalizedSidebarSearchQuery: string;
  onCreateThread: () => void;
  selectedProject: RpcProject | null;
  sidebarActionButtonClass: string;
  threadPreviewsDisabled: boolean;
  threadsError: string;
};

export const ThreadsPanel = memo(function ThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  activeSelectedWorktreePath,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  filteredVisibleThreads,
  getProjectState,
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
  threadPreviewsDisabled,
  threadActivityIndicator,
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
            <ThreadList
              acknowledgeThreadErrorSeenInBackground={
                acknowledgeThreadErrorSeenInBackground
              }
              anchorIdPrefix="threads-thread"
              clearCompletedThreadIndicator={clearCompletedThreadIndicator}
              dismissThreadStatus={dismissThreadStatus}
              getProjectState={getProjectState}
              homeDirectory={homeDirectory}
              isThreadStatusDismissed={isThreadStatusDismissed}
              onOpenThread={onOpenThread}
              onOpenThreadActionMenu={onOpenThreadActionMenu}
              previewDisabled={threadPreviewsDisabled}
              projects={projects}
              selectedThreadId={selectedThreadId}
              supportsTildePath={supportsTildePath}
              threadActivityIndicator={threadActivityIndicator}
              threads={filteredVisibleThreads}
            />
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
