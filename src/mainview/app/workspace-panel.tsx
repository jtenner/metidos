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
import { type SharedThreadListProps, ThreadListRow } from "./thread-list-row";

type WorkspacePanelProps = SharedThreadListProps & {
  normalizedSidebarSearchQuery: string;
  threadsError: string;
  workspaceActiveThreads: RpcThread[];
  workspacePinnedThreads: RpcThread[];
};

export const WorkspacePanel = memo(function WorkspacePanel({
  acknowledgeThreadErrorSeenInBackground,
  dismissThreadStatus,
  errorPreviewHandlers,
  errorPreviewPopover,
  getProjectState,
  hideErrorPreview,
  hideThreadSummaryPreview,
  homeDirectory,
  isThreadStatusDismissed,
  normalizedSidebarSearchQuery,
  onOpenThread,
  onOpenThreadActionMenu,
  projects,
  selectedThreadId,
  supportsTildePath,
  threadSummaryPopover,
  threadSummaryPreviewHandlers,
  threadsError,
  workspaceActiveThreads,
  workspacePinnedThreads,
}: WorkspacePanelProps) {
  const workspaceOpen = useWorkspacePanelOpen();
  const workspaceActiveOpen = useWorkspaceActiveSectionOpen();
  const hasThreads =
    workspacePinnedThreads.length > 0 || workspaceActiveThreads.length > 0;

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Workspace"
        open={workspaceOpen}
        onToggle={toggleWorkspacePanelOpen}
      />
      {workspaceOpen ? (
        <div className="mt-3 space-y-4">
          {!hasThreads ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              {normalizedSidebarSearchQuery
                ? "No matching workspace threads."
                : "No pinned or active threads yet."}
            </div>
          ) : null}
          {workspacePinnedThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                Pinned
              </div>
              {workspacePinnedThreads.map((thread) => (
                <ThreadListRow
                  key={thread.id}
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="workspace-thread"
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
                  showLocation
                  supportsTildePath={supportsTildePath}
                  thread={thread}
                  threadSummaryPopover={threadSummaryPopover}
                  threadSummaryPreviewHandlers={threadSummaryPreviewHandlers}
                />
              ))}
            </div>
          ) : null}
          {workspaceActiveThreads.length > 0 ? (
            <div className="space-y-1">
              <button
                type="button"
                className="group flex w-full items-center gap-2 px-3 pb-1 text-left transition-colors"
                onClick={toggleWorkspaceActiveSectionOpen}
                aria-expanded={workspaceActiveOpen}
              >
                <span className="font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                  Active
                </span>
                <span className="ml-auto shrink-0 text-[#62737e] transition-colors group-hover:text-[#bdd5e6]">
                  {materialSymbol(
                    workspaceActiveOpen ? "expand_more" : "chevron_right",
                    "text-[14px]",
                  )}
                </span>
              </button>
              {workspaceActiveOpen
                ? workspaceActiveThreads.map((thread) => (
                    <ThreadListRow
                      key={thread.id}
                      acknowledgeThreadErrorSeenInBackground={
                        acknowledgeThreadErrorSeenInBackground
                      }
                      anchorIdPrefix="workspace-thread"
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
                      showLocation
                      supportsTildePath={supportsTildePath}
                      thread={thread}
                      threadSummaryPopover={threadSummaryPopover}
                      threadSummaryPreviewHandlers={
                        threadSummaryPreviewHandlers
                      }
                    />
                  ))
                : null}
            </div>
          ) : null}
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
