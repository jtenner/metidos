import type { HTMLAttributes, JSX } from "react";
import { BeatLoader } from "react-spinners";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import {
  type ErrorPreviewPopoverState,
  type ProjectNodeState,
  type ThreadSummaryPopoverState,
  formatPathForDisplay,
} from "./state";

export type SharedThreadListProps = {
  acknowledgeThreadErrorSeenInBackground: (threadId: number) => void;
  dismissThreadStatus: (thread: RpcThread) => void;
  errorPreviewHandlers: (
    anchorId: string,
    text: string | null | undefined,
  ) => Pick<
    HTMLAttributes<HTMLElement>,
    "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
  >;
  errorPreviewPopover: ErrorPreviewPopoverState | null;
  getProjectState: (projectId: number) => ProjectNodeState;
  hideErrorPreview: () => void;
  hideThreadSummaryPreview: () => void;
  homeDirectory: string;
  isThreadStatusDismissed: (thread: RpcThread | null) => boolean;
  onOpenThread: (threadId: number) => void;
  onOpenThreadActionMenu: (thread: RpcThread, x: number, y: number) => void;
  projects: RpcProject[];
  selectedThreadId: number | null;
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
};

type ThreadListRowProps = SharedThreadListProps & {
  anchorIdPrefix?: string;
  showLocation?: boolean;
  thread: RpcThread;
};

export function ThreadListRow({
  acknowledgeThreadErrorSeenInBackground,
  anchorIdPrefix = "thread",
  dismissThreadStatus,
  errorPreviewHandlers,
  errorPreviewPopover,
  getProjectState,
  hideErrorPreview,
  hideThreadSummaryPreview,
  homeDirectory,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  projects,
  selectedThreadId,
  showLocation = false,
  supportsTildePath,
  thread,
  threadSummaryPopover,
  threadSummaryPreviewHandlers,
}: ThreadListRowProps): JSX.Element {
  const threadProject =
    projects.find((project) => project.id === thread.projectId) ?? null;
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
  const threadPopoverAnchorId = `${anchorIdPrefix}-sidebar-row-${thread.id}`;
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
    ? errorPreviewHandlers(threadPopoverAnchorId, threadErrorPreviewText)
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
  const secondaryLabel = [
    threadStatusLabel,
    showLocation
      ? [threadProject?.name, threadBranchName].filter(Boolean).join(" · ")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      id={threadPopoverAnchorId}
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
        onOpenThreadActionMenu(thread, event.clientX + 6, event.clientY + 6);
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
          {secondaryLabel ? (
            <div className="mt-0.5 truncate text-[10px] text-[#8f9aa2]">
              {secondaryLabel}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-2">
          {threadPinned ? (
            <span className="pointer-events-none">
              {materialSymbol("push_pin", "text-[14px] text-[#dfebf3]", {
                filled: true,
              })}
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
}
