import { type HTMLAttributes, type JSX, memo } from "react";
import { createPortal } from "react-dom";
import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import {
  type ErrorPreviewPopoverState,
  type ThreadSummaryPopoverState,
  worktreeKey,
} from "./state";
import { useThreadPreviews } from "./use-thread-previews";

export type SharedThreadListProps = {
  /** Ack callback for clearing "unread error" thread state when opened in background. */
  acknowledgeThreadErrorSeenInBackground: (threadId: number) => void;
  /** Clears completion indicator after the user returns to that thread row. */
  clearCompletedThreadIndicator: (threadId: number) => void;
  /** Dismisses the inline run-status badge for a thread from persistent state. */
  dismissThreadStatus: (thread: RpcThread) => void;
  /** Returns whether status chips and errors are already dismissed for a thread. */
  isThreadStatusDismissed: (thread: RpcThread | null) => boolean;
  /** Opens the main thread view for a specific thread id. */
  onOpenThread: (threadId: number) => void;
  /** Opens context menu for a thread row at pixel coordinates. */
  onOpenThreadActionMenu: (thread: RpcThread, x: number, y: number) => void;
  /** Memoized project metadata keyed by project id. */
  projectById: ReadonlyMap<number, RpcProject>;
  /** Currently selected thread id to apply active state styling to matching row. */
  selectedThreadId: number | null;
  /** Returns activity state for a thread to drive status badge and visual marker. */
  threadActivityIndicator: (
    threadId: number,
  ) => "none" | "working" | "completed";
  /** Memoized display paths keyed by `worktreeKey(projectId, path)`. */
  worktreeDisplayPathByKey: ReadonlyMap<string, string>;
  /** Memoized worktree metadata keyed by `worktreeKey(projectId, path)`. */
  worktreeByProjectAndPath: ReadonlyMap<string, RpcWorktree>;
};

type ThreadListPreviewProps = {
  /** Event handlers for error preview anchoring and visibility transitions. */
  errorPreviewHandlers: (
    anchorId: string,
    text: string | null | undefined,
  ) => Pick<
    HTMLAttributes<HTMLElement>,
    "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
  >;
  /** Currently open error popover state for this list's render scope. */
  errorPreviewPopover: ErrorPreviewPopoverState | null;
  /** Hides active error preview to prevent stale overlays. */
  hideErrorPreview: () => void;
  /** Hides thread summary overlay when pointer focus leaves or opens another view. */
  hideThreadSummaryPreview: () => void;
  /** Currently open thread-summary popover state for this list's render scope. */
  threadSummaryPopover: ThreadSummaryPopoverState | null;
  /** Event handlers for summary popover anchored to a row when no error is available. */
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
    /** Thread row activity value (`working` adds a dot and status text). */
    activityIndicator: "none" | "working" | "completed";
    /** Prefix that uniquely scopes tooltip/popover IDs for this list instance. */
    anchorIdPrefix?: string;
    /** ID used by react-portal for the error popover element. */
    errorPreviewPopoverId: string;
    /** True when this row is the active selection in the thread list. */
    isActive: boolean;
    /** Whether to append location info to the row's secondary label. */
    showLocation?: boolean;
    /** Thread entity rendered by this row. */
    thread: RpcThread;
    /** Whether thread status indicators are hidden by user dismissal. */
    threadStatusDismissed: boolean;
    /** ID used by react-portal for the summary popover element. */
    threadSummaryPopoverId: string;
  };

type ThreadListProps = SharedThreadListProps & {
  /** Optional anchor id prefix for multiple thread lists on one page. */
  anchorIdPrefix?: string;
  /** Disable preview popover state/handlers when heavy re-renders are undesirable. */
  previewDisabled?: boolean;
  /** Add project/worktree context to each row label when enabled. */
  showLocation?: boolean;
  /** Threads rendered in this list, usually in recency order. */
  threads: RpcThread[];
};

/** Renders thread rows and shared portal containers for previews. */
export const ThreadList = memo(function ThreadList({
  acknowledgeThreadErrorSeenInBackground,
  anchorIdPrefix = "thread",
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  previewDisabled = false,
  projectById,
  selectedThreadId,
  showLocation = false,
  threadActivityIndicator,
  threads,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
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
          hideErrorPreview={hideErrorPreview}
          hideThreadSummaryPreview={hideThreadSummaryPreview}
          isActive={selectedThreadId === thread.id}
          onOpenThread={onOpenThread}
          onOpenThreadActionMenu={onOpenThreadActionMenu}
          projectById={projectById}
          showLocation={showLocation}
          thread={thread}
          threadStatusDismissed={isThreadStatusDismissed(thread)}
          threadSummaryPopover={threadSummaryPopover}
          threadSummaryPopoverId={threadSummaryPopoverId}
          threadSummaryPreviewHandlers={threadSummaryPreviewHandlers}
          worktreeDisplayPathByKey={worktreeDisplayPathByKey}
          worktreeByProjectAndPath={worktreeByProjectAndPath}
        />
      ))}
      <ThreadListPreviewPortal>
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
      </ThreadListPreviewPortal>
    </>
  );
});

function ThreadListPreviewPortal({
  children,
}: {
  children: JSX.Element | null | false | Array<JSX.Element | null | false>;
}): JSX.Element | null {
  // Guard for SSR: `document` is only available in browser environments.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(children, document.body);
}

const ThreadListRow = memo(function ThreadListRow({
  acknowledgeThreadErrorSeenInBackground,
  activityIndicator,
  anchorIdPrefix = "thread",
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  errorPreviewHandlers,
  errorPreviewPopover,
  errorPreviewPopoverId,
  hideErrorPreview,
  hideThreadSummaryPreview,
  isActive,
  onOpenThread,
  onOpenThreadActionMenu,
  projectById,
  showLocation = false,
  thread,
  threadStatusDismissed,
  threadSummaryPopover,
  threadSummaryPopoverId,
  threadSummaryPreviewHandlers,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: ThreadListRowProps): JSX.Element {
  // Resolve thread project/worktree context to compute branch and display path.
  const threadProject = projectById.get(thread.projectId) ?? null;
  const threadWorktree =
    worktreeByProjectAndPath.get(
      worktreeKey(thread.projectId, thread.worktreePath),
    ) ?? null;
  const threadBranchName =
    threadWorktree?.branch?.trim() ||
    (threadProject && thread.worktreePath === threadProject.path
      ? "Primary"
      : "detached");
  const threadWorktreeDisplayPath =
    worktreeDisplayPathByKey.get(
      worktreeKey(thread.projectId, thread.worktreePath),
    ) ?? thread.worktreePath;
  const threadPopoverAnchorId = `${anchorIdPrefix}-sidebar-row-${thread.id}`;
  const threadPinned = Boolean(thread.pinnedAt);
  // Precompute row activity and status bits to keep icon, label, and aria state aligned.
  const isWorking = activityIndicator === "working";
  const hasCompletedActivity = activityIndicator === "completed";
  const hasRunError =
    !threadStatusDismissed && thread.runStatus.state === "failed";
  const hasRunStopped =
    !threadStatusDismissed && thread.runStatus.state === "stopped";
  const hasUnreadError =
    !threadStatusDismissed && thread.runStatus.hasUnreadError;
  // Use error text whenever an unread, failed, or stopped state is active.
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
  // Prefer error handlers to make error details interactive without switching popover type.
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

  // Compose ARIA label and preview handlers to keep keyboard/screen-reader context consistent.
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
      // Left click opens thread details and acknowledges/clears transient indicators first.
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
  // Compare an anchor id against the active popover's anchor ownership.
  return popover?.anchorId === anchorId;
}

/**
 * Memo comparator for a thread row: checks only row-relevant prop changes.
 */
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
    previous.projectById !== next.projectById ||
    previous.threadSummaryPopoverId !== next.threadSummaryPopoverId ||
    previous.worktreeDisplayPathByKey !== next.worktreeDisplayPathByKey ||
    previous.worktreeByProjectAndPath !== next.worktreeByProjectAndPath ||
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
