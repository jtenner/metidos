import { type HTMLAttributes, memo } from "react";
import { BeatLoader } from "react-spinners";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleThreadsPanelOpen,
  useThreadsPanelOpen,
} from "./sidebar-panels-state";
import {
  APP_TITLE,
  type ErrorPreviewPopoverState,
  type ProjectNodeState,
  type ThreadSummaryPopoverState,
  formatPathForDisplay,
} from "./state";

type ThreadsPanelProps = {
  acknowledgeThreadErrorSeenInBackground: (threadId: number) => void;
  activeSelectedWorktreePath: string | null;
  dismissThreadStatus: (thread: RpcThread) => void;
  errorPreviewHandlers: (
    anchorId: string,
    text: string | null | undefined,
  ) => Pick<
    HTMLAttributes<HTMLElement>,
    "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
  >;
  errorPreviewPopover: ErrorPreviewPopoverState | null;
  filteredVisibleThreads: RpcThread[];
  getProjectState: (projectId: number) => ProjectNodeState;
  hideErrorPreview: () => void;
  hideThreadSummaryPreview: () => void;
  homeDirectory: string;
  isCreatingThread: boolean;
  isThreadStatusDismissed: (thread: RpcThread | null) => boolean;
  normalizedSidebarSearchQuery: string;
  onCreateThread: () => void;
  onOpenThread: (threadId: number) => void;
  onOpenThreadActionMenu: (thread: RpcThread, x: number, y: number) => void;
  projects: RpcProject[];
  selectedProject: RpcProject | null;
  selectedThreadId: number | null;
  sidebarActionButtonClass: string;
  supportsTildePath: boolean;
  threadSummaryPopover: ThreadSummaryPopoverState | null;
  threadSummaryPreviewHandlers: (
    anchorId: string,
    title: string,
    summary: string,
  ) => Pick<
    HTMLAttributes<HTMLElement>,
    "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
  >;
  threadsError: string;
};

export const ThreadsPanel = memo(function ThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  activeSelectedWorktreePath,
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
              const threadProject =
                projects.find((project) => project.id === thread.projectId) ??
                null;
              const threadWorktree = threadProject
                ? (getProjectState(thread.projectId).worktrees.find(
                    (worktree) => worktree.path === thread.worktreePath,
                  ) ?? null)
                : null;
              const threadBranchName =
                threadWorktree?.branch?.trim() ||
                (threadProject && thread.worktreePath === threadProject.path
                  ? "Primary"
                  : "detached");
              const threadWorktreeDisplayPath = formatPathForDisplay(
                thread.worktreePath,
                homeDirectory,
                supportsTildePath,
              );
              const threadPopoverAnchorId = `thread-sidebar-row-${thread.id}`;
              const threadPinned = Boolean(thread.pinnedAt);
              const isActive = selectedThreadId === thread.id;
              const isWorking = thread.runStatus.state === "working";
              const threadStatusDismissed = isThreadStatusDismissed(thread);
              const hasRunError =
                !threadStatusDismissed && thread.runStatus.state === "failed";
              const hasRunStopped =
                !threadStatusDismissed && thread.runStatus.state === "stopped";
              const hasUnreadError =
                !threadStatusDismissed && thread.runStatus.hasUnreadError;
              const threadErrorPreviewText =
                hasUnreadError || hasRunError || hasRunStopped
                  ? (thread.runStatus.error ?? "")
                  : "";
              const threadAriaLabel = [
                thread.title,
                threadPinned ? "Pinned." : null,
                hasUnreadError
                  ? "Unread error."
                  : hasRunError
                    ? "Error."
                    : hasRunStopped
                      ? "Stopped."
                      : isWorking
                        ? "Working."
                        : null,
                `Branch ${threadBranchName}.`,
                `Worktree ${threadWorktreeDisplayPath}.`,
              ]
                .filter(Boolean)
                .join(" ");
              const threadPreviewHandlers = threadErrorPreviewText
                ? errorPreviewHandlers(
                    threadPopoverAnchorId,
                    threadErrorPreviewText,
                  )
                : threadSummaryPreviewHandlers(
                    threadPopoverAnchorId,
                    thread.title,
                    thread.summary ?? "",
                  );
              const threadPreviewDescriptionId =
                errorPreviewPopover?.anchorId === threadPopoverAnchorId
                  ? "thread-error-popover"
                  : threadSummaryPopover?.anchorId === threadPopoverAnchorId
                    ? "thread-summary-popover"
                    : undefined;
              const threadStatusLabel = hasUnreadError
                ? "Unread error"
                : hasRunError
                  ? "Run failed"
                  : hasRunStopped
                    ? "Stopped"
                    : isWorking
                      ? "Working"
                      : threadPinned
                        ? "Pinned"
                        : null;

              return (
                <button
                  type="button"
                  key={thread.id}
                  aria-describedby={threadPreviewDescriptionId}
                  aria-label={threadAriaLabel}
                  className={`w-full px-3 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-[#181f22] text-[#f2f0ef] shadow-[inset_3px_0_0_0_#7aa5c4]"
                      : "text-[#d7d7d7] hover:bg-[#171a1b]"
                  }`}
                  {...threadPreviewHandlers}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    hideErrorPreview();
                    hideThreadSummaryPreview();
                    onOpenThreadActionMenu(
                      thread,
                      event.clientX + 6,
                      event.clientY + 6,
                    );
                  }}
                  onClick={() => {
                    hideErrorPreview();
                    hideThreadSummaryPreview();
                    dismissThreadStatus(thread);
                    if (thread.runStatus.hasUnreadError) {
                      acknowledgeThreadErrorSeenInBackground(thread.id);
                    }
                    onOpenThread(thread.id);
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center ${
                        isActive
                          ? "bg-[#1f313c] text-[#bdd5e6]"
                          : "bg-[#151a1c] text-[#8ca6b9]"
                      }`}
                    >
                      {materialSymbol("chat_bubble", "text-[14px]")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium leading-4">
                        {thread.title}
                      </div>
                      {threadStatusLabel ? (
                        <div className="mt-0.5 truncate text-[10px] text-[#8f9aa2]">
                          {threadStatusLabel}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pl-2">
                      {threadPinned ? (
                        <span className="pointer-events-none">
                          {materialSymbol(
                            "push_pin",
                            "text-[14px] text-[#dfebf3]",
                            { filled: true },
                          )}
                        </span>
                      ) : null}
                      {hasUnreadError ? (
                        <span className="border border-[#7a2030] bg-[#381018] px-2 py-0.5 font-label text-[9px] font-bold uppercase tracking-[0.16em] text-[#ff8698]">
                          Unread
                        </span>
                      ) : null}
                      {isWorking ? (
                        <BeatLoader
                          color="#bdd5e6"
                          margin={1}
                          size={5}
                          speedMultiplier={0.85}
                        />
                      ) : null}
                    </div>
                  </div>
                </button>
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
