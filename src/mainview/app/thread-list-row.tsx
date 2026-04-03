import { type HTMLAttributes, type JSX, memo } from "react";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import {
  type ErrorPreviewPopoverState,
  type ProjectNodeState,
  type ThreadSummaryPopoverState,
  formatPathForDisplay,
} from "./state";
import { useThreadPreviews } from "./use-thread-previews";

export type SharedThreadListProps = {
  acknowledgeThreadErrorSeenInBackground: (threadId: number) => void;
  clearCompletedThreadIndicator: (threadId: number) => void;
  dismissThreadStatus: (thread: RpcThread) => void;
  getProjectState: (projectId: number) => ProjectNodeState;
  homeDirectory: string;
  isThreadStatusDismissed: (thread: RpcThread | null) => boolean;
  onOpenThread: (threadId: number) => void;
  onOpenThreadActionMenu: (thread: RpcThread, x: number, y: number) => void;
  projects: RpcProject[];
  selectedThreadId: number | null;
  supportsTildePath: boolean;
  threadActivityIndicator: (
    threadId: number,
  ) => "none" | "working" | "completed";
};

type ThreadListPreviewProps = {
  errorPreviewHandlers: (
    anchorId: string,
    text: string | null | undefined,
  ) => Pick<
    HTMLAttributes<HTMLElement>,
    "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
  >;
  errorPreviewPopover: ErrorPreviewPopoverState | null;
  hideErrorPreview: () => void;
  hideThreadSummaryPreview: () => void;
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

type ThreadListRowProps = Omit<
  SharedThreadListProps,
  "isThreadStatusDismissed" | "selectedThreadId" | "threadActivityIndicator"
> &
  ThreadListPreviewProps & {
    activityIndicator: "none" | "working" | "completed";
    anchorIdPrefix?: string;
    errorPreviewPopoverId: string;
    isActive: boolean;
    showLocation?: boolean;
    thread: RpcThread;
    threadStatusDismissed: boolean;
    threadSummaryPopoverId: string;
  };

type ThreadListProps = SharedThreadListProps & {
  anchorIdPrefix?: string;
  previewDisabled?: boolean;
  showLocation?: boolean;
  threads: RpcThread[];
};

export const ThreadList = memo(function ThreadList({
  acknowledgeThreadErrorSeenInBackground,
  anchorIdPrefix = "thread",
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  getProjectState,
  homeDirectory,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  previewDisabled = false,
  projects,
  selectedThreadId,
  showLocation = false,
  supportsTildePath,
  threadActivityIndicator,
  threads,
}: ThreadListProps): JSX.Element {
  const errorPreviewPopoverId = `${anchorIdPrefix}-error-popover`;
  const threadSummaryPopoverId = `${anchorIdPrefix}-summary-popover`;
  const {
    errorPreviewHandlers,
    errorPreviewPopover,
    hideErrorPreview,
    hideThreadSummaryPreview,
    threadSummaryPopover,
    threadSummaryPreviewHandlers,
  } = useThreadPreviews({
    disabled: previewDisabled,
  });

  return (
    <>
      {threads.map((thread) => (
        <ThreadListRow
          key={thread.id}
          acknowledgeThreadErrorSeenInBackground={
            acknowledgeThreadErrorSeenInBackground
          }
          activityIndicator={threadActivityIndicator(thread.id)}
          anchorIdPrefix={anchorIdPrefix}
          clearCompletedThreadIndicator={clearCompletedThreadIndicator}
          dismissThreadStatus={dismissThreadStatus}
          errorPreviewHandlers={errorPreviewHandlers}
          errorPreviewPopover={errorPreviewPopover}
          errorPreviewPopoverId={errorPreviewPopoverId}
          getProjectState={getProjectState}
          hideErrorPreview={hideErrorPreview}
          hideThreadSummaryPreview={hideThreadSummaryPreview}
          homeDirectory={homeDirectory}
          isActive={selectedThreadId === thread.id}
          onOpenThread={onOpenThread}
          onOpenThreadActionMenu={onOpenThreadActionMenu}
          projects={projects}
          showLocation={showLocation}
          supportsTildePath={supportsTildePath}
          thread={thread}
          threadStatusDismissed={isThreadStatusDismissed(thread)}
          threadSummaryPopover={threadSummaryPopover}
          threadSummaryPopoverId={threadSummaryPopoverId}
          threadSummaryPreviewHandlers={threadSummaryPreviewHandlers}
        />
      ))}
      {errorPreviewPopover ? (
        <div
          id={errorPreviewPopoverId}
          role="note"
          className="pointer-events-none fixed z-[110] max-w-[22rem] border border-[#7a2030] bg-[#341019]/96 px-3 py-2 text-xs leading-5 text-[#ffb1bf] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm"
          style={{
            left: errorPreviewPopover.x,
            top: errorPreviewPopover.y,
            transform: "translateY(-50%)",
          }}
        >
          <div className="whitespace-pre-wrap break-words">
            {errorPreviewPopover.text}
          </div>
        </div>
      ) : null}
      {threadSummaryPopover ? (
        <div
          id={threadSummaryPopoverId}
          role="note"
          className="pointer-events-none fixed z-[108] hidden max-w-[22rem] border border-[#31404a] bg-[#13191d]/96 px-3 py-3 text-xs leading-5 text-[#d6e7f2] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm md:block"
          style={{
            left: threadSummaryPopover.x,
            top: threadSummaryPopover.y,
          }}
        >
          <div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#8fb5cd]">
            Thread Summary
          </div>
          <div className="mb-2 text-sm font-semibold text-[#f2f0ef]">
            {threadSummaryPopover.title}
          </div>
          <div className="whitespace-pre-wrap break-words text-[#bfd1dc]">
            {threadSummaryPopover.summary}
          </div>
        </div>
      ) : null}
    </>
  );
});

const ThreadListRow = memo(function ThreadListRow({
  acknowledgeThreadErrorSeenInBackground,
  activityIndicator,
  anchorIdPrefix = "thread",
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  errorPreviewHandlers,
  errorPreviewPopover,
  errorPreviewPopoverId,
  getProjectState,
  hideErrorPreview,
  hideThreadSummaryPreview,
  homeDirectory,
  isActive,
  onOpenThread,
  onOpenThreadActionMenu,
  projects,
  showLocation = false,
  supportsTildePath,
  thread,
  threadStatusDismissed,
  threadSummaryPopover,
  threadSummaryPopoverId,
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
  const isWorking = activityIndicator === "working";
  const hasCompletedActivity = activityIndicator === "completed";
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
            : hasCompletedActivity
              ? "Completed."
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
      ? errorPreviewPopoverId
      : threadSummaryPopover?.anchorId === threadPopoverAnchorId
        ? threadSummaryPopoverId
        : undefined;
  const threadStatusLabel = hasUnreadError
    ? "Unread error"
    : hasRunError
      ? "Run failed"
      : hasRunStopped
        ? "Stopped"
        : hasCompletedActivity
          ? "Completed"
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
        clearCompletedThreadIndicator(thread.id);
        if (thread.runStatus.hasUnreadError) {
          acknowledgeThreadErrorSeenInBackground(thread.id);
        }
        onOpenThread(thread.id);
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center ${
            isActive
              ? "bg-[#1f313c] text-[#bdd5e6]"
              : "bg-[#151a1c] text-[#8ca6b9]"
          }`}
        >
          {materialSymbol("chat_bubble", "text-[14px]")}
          {activityIndicator !== "none" ? (
            <span
              aria-hidden="true"
              className={`absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full border ${
                isActive ? "border-[#1f313c]" : "border-[#151a1c]"
              } ${
                activityIndicator === "completed"
                  ? "bg-[#5df28b]"
                  : "bg-[#4aa8ff]"
              }`}
            />
          ) : null}
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
        </div>
      </div>
    </button>
  );
}, areThreadListRowPropsEqual);

function isPreviewAnchorActive(
  anchorId: string,
  popover: ErrorPreviewPopoverState | ThreadSummaryPopoverState | null,
): boolean {
  return popover?.anchorId === anchorId;
}

function areThreadListRowPropsEqual(
  previous: ThreadListRowProps,
  next: ThreadListRowProps,
): boolean {
  if (
    previous.thread !== next.thread ||
    previous.activityIndicator !== next.activityIndicator ||
    previous.isActive !== next.isActive ||
    previous.threadStatusDismissed !== next.threadStatusDismissed ||
    previous.anchorIdPrefix !== next.anchorIdPrefix ||
    previous.errorPreviewPopoverId !== next.errorPreviewPopoverId ||
    previous.showLocation !== next.showLocation ||
    previous.projects !== next.projects ||
    previous.getProjectState !== next.getProjectState ||
    previous.homeDirectory !== next.homeDirectory ||
    previous.supportsTildePath !== next.supportsTildePath ||
    previous.threadSummaryPopoverId !== next.threadSummaryPopoverId ||
    previous.acknowledgeThreadErrorSeenInBackground !==
      next.acknowledgeThreadErrorSeenInBackground ||
    previous.clearCompletedThreadIndicator !==
      next.clearCompletedThreadIndicator ||
    previous.dismissThreadStatus !== next.dismissThreadStatus ||
    previous.hideErrorPreview !== next.hideErrorPreview ||
    previous.hideThreadSummaryPreview !== next.hideThreadSummaryPreview ||
    previous.onOpenThread !== next.onOpenThread ||
    previous.onOpenThreadActionMenu !== next.onOpenThreadActionMenu ||
    previous.errorPreviewHandlers !== next.errorPreviewHandlers ||
    previous.threadSummaryPreviewHandlers !== next.threadSummaryPreviewHandlers
  ) {
    return false;
  }

  const anchorId = `${next.anchorIdPrefix ?? "thread"}-sidebar-row-${next.thread.id}`;
  return (
    isPreviewAnchorActive(anchorId, previous.errorPreviewPopover) ===
      isPreviewAnchorActive(anchorId, next.errorPreviewPopover) &&
    isPreviewAnchorActive(anchorId, previous.threadSummaryPopover) ===
      isPreviewAnchorActive(anchorId, next.threadSummaryPopover)
  );
}
