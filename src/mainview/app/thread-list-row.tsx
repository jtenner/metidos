/**
 * @file src/mainview/app/thread-list-row.tsx
 * @description Module for thread list row.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type HTMLAttributes,
  type JSX,
  memo,
  type MouseEvent as ReactMouseEvent,
  type UIEventHandler,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import { AppBadge } from "../controls/badge";
import { materialSymbol } from "../controls/icons";
import { ListRowButton } from "../controls/list-row";
import { PopoverSurface } from "../controls/popover";
import { StatusIcon } from "../controls/status-icon";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { formatThreadTimestamp } from "./date-format";

export { formatThreadTimestamp } from "./date-format";

import { worktreeKey } from "./project-worktree-state";
import { threadListUpdatedAt } from "./thread-store";
import type {
  ErrorPreviewPopoverState,
  ThreadSummaryPopoverState,
} from "./thread-ui-state";
import { useThreadPreviews } from "./use-thread-previews";

/**
 * Builds the sidebar thread-preview body from summary text plus lightweight
 * context so every row can explain itself even when no summary exists yet.
 */
export function buildThreadSummaryPreviewText({
  branchName,
  projectName,
  summary,
  timestampLabel,
  worktreeDisplayPath,
}: {
  branchName: string;
  projectName: string | null;
  summary: string | null | undefined;
  timestampLabel: string;
  worktreeDisplayPath: string;
}): string {
  const lines: string[] = [];
  const previewSummary = summary?.trim();
  if (previewSummary) {
    lines.push(previewSummary);
  }

  const contextParts = [`Updated ${timestampLabel}`, `Branch ${branchName}`];
  if (projectName) {
    contextParts.push(`Project ${projectName}`);
  }
  contextParts.push(`Worktree ${worktreeDisplayPath}`);
  lines.push(contextParts.join(" · "));

  return lines.join("\n\n");
}

export type ThreadListPreviewIds = {
  errorPreviewPopoverId: string;
  threadSummaryPopoverId: string;
};

// Compact layouts are already gated in `useThreadPreviews`; keeping the
// surface displayable here avoids suppressing the portaled desktop hover card.
export const THREAD_SUMMARY_POPOVER_CLASS_NAME =
  "pointer-events-none z-[108] w-[min(30vw,18rem)] border border-border-default bg-surface-overlay px-3 py-3 text-xs leading-5 text-text-secondary shadow-overlay backdrop-blur-sm";

export function buildThreadListPreviewIds(
  anchorIdPrefix: string,
): ThreadListPreviewIds {
  return {
    errorPreviewPopoverId: `${anchorIdPrefix}-error-popover`,
    threadSummaryPopoverId: `${anchorIdPrefix}-summary-popover`,
  };
}

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
  /** Hides active error preview to prevent lingering overlays after focus changes. */
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
    /** Thread row activity value (`working` adds a square status marker and status text). */
    activityIndicator: "none" | "working" | "completed";
    /** When true, expose rows as chooser options for listbox-style surfaces. */
    chooserOption?: boolean;
    /** Optional row shell class name, used by virtualized absolute positioning. */
    className?: string | undefined;
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

// Thread rows render a title plus dense metadata/status, so the virtual estimate
// intentionally exceeds the generic 44px list-row minimum from STYLE.md.
const THREAD_LIST_ROW_HEIGHT_PX = 60;
const estimateThreadListRowSize = (): number => THREAD_LIST_ROW_HEIGHT_PX;

type ThreadListProps = SharedThreadListProps & {
  /** Optional anchor id prefix for multiple thread lists on one page. */
  anchorIdPrefix?: string;
  /** When true, expose each row as a chooser option for listbox-style surfaces. */
  chooserOption?: boolean;
  /** Disable preview popover state/handlers when heavy re-renders are undesirable. */
  previewDisabled?: boolean;
  /** Shared popover ids when multiple thread lists reuse one preview scope. */
  previewIds?: ThreadListPreviewIds;
  /** External preview scope shared across multiple thread-list sections. */
  previewState?: ReturnType<typeof useThreadPreviews>;
  /** Add project/worktree context to each row label when enabled. */
  showLocation?: boolean;
  /** Threads rendered in this list, usually in thread-list order. */
  threads: RpcThread[];
};

type VirtualThreadListProps = ThreadListProps & {
  /** Accessible label for the scrollable virtual list region. */
  ariaLabel: string;
  /** Optional class name for the scrollable virtual list region. */
  className?: string;
  /** Optional scroll handler for progressive loading. */
  onScroll?: UIEventHandler<HTMLDivElement>;
};

type ThreadListPreviewPortalsProps = {
  errorPreviewPopover: ErrorPreviewPopoverState | null;
  errorPreviewPopoverId: string;
  threadSummaryPopover: ThreadSummaryPopoverState | null;
  threadSummaryPopoverId: string;
};

export function ThreadListPreviewPortals({
  errorPreviewPopover,
  errorPreviewPopoverId,
  threadSummaryPopover,
  threadSummaryPopoverId,
}: ThreadListPreviewPortalsProps): JSX.Element {
  return (
    <>
      <PopoverSurface
        className="pointer-events-none z-[110] w-[min(30vw,18rem)] border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text shadow-overlay backdrop-blur-sm"
        hideWhenEscaped={false}
        id={errorPreviewPopoverId}
        offsetPx={14}
        open={errorPreviewPopover !== null}
        placement="right"
        reference={errorPreviewPopover?.reference ?? null}
        role="tooltip"
      >
        <div className="whitespace-pre-wrap break-words">
          {errorPreviewPopover?.text}
        </div>
      </PopoverSurface>
      <PopoverSurface
        className={THREAD_SUMMARY_POPOVER_CLASS_NAME}
        hideWhenEscaped={false}
        id={threadSummaryPopoverId}
        offsetPx={14}
        open={threadSummaryPopover !== null}
        placement="right-start"
        reference={threadSummaryPopover?.reference ?? null}
        role="tooltip"
      >
        <div className="mb-1 font-label text-[10px] uppercase tracking-[0.1em] text-accent">
          Thread
        </div>
        <div className="mb-2 text-sm font-semibold text-text-primary">
          {threadSummaryPopover?.title}
        </div>
        <div className="whitespace-pre-wrap break-words text-text-secondary">
          {threadSummaryPopover?.summary}
        </div>
      </PopoverSurface>
    </>
  );
}

/** Renders thread rows and shared portal containers for previews. */
export const ThreadList = memo(function ThreadList({
  acknowledgeThreadErrorSeenInBackground,
  anchorIdPrefix = "thread",
  chooserOption = false,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  previewDisabled = false,
  previewIds,
  previewState,
  projectById,
  selectedThreadId,
  showLocation = false,
  threadActivityIndicator,
  threads,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: ThreadListProps): JSX.Element {
  const internalPreviewState = useThreadPreviews({
    disabled: previewDisabled,
  });
  const resolvedPreviewState = previewState ?? internalPreviewState;
  const {
    errorPreviewHandlers,
    errorPreviewPopover,
    hideErrorPreview,
    hideThreadSummaryPreview,
    threadSummaryPopover,
    threadSummaryPreviewHandlers,
  } = resolvedPreviewState;
  const { errorPreviewPopoverId, threadSummaryPopoverId } =
    previewIds ?? buildThreadListPreviewIds(anchorIdPrefix);

  const renderThreadRow = (thread: RpcThread, className?: string) => (
    <ThreadListRow
      key={thread.id}
      acknowledgeThreadErrorSeenInBackground={
        acknowledgeThreadErrorSeenInBackground
      }
      activityIndicator={threadActivityIndicator(thread.id)}
      anchorIdPrefix={anchorIdPrefix}
      chooserOption={chooserOption}
      className={className}
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
  );

  return (
    <>
      {threads.map((thread) => renderThreadRow(thread))}
      {!previewState ? (
        <ThreadListPreviewPortals
          errorPreviewPopover={errorPreviewPopover}
          errorPreviewPopoverId={errorPreviewPopoverId}
          threadSummaryPopover={threadSummaryPopover}
          threadSummaryPopoverId={threadSummaryPopoverId}
        />
      ) : null}
    </>
  );
});

export const VirtualThreadList = memo(function VirtualThreadList({
  acknowledgeThreadErrorSeenInBackground,
  anchorIdPrefix = "thread",
  ariaLabel,
  chooserOption = false,
  className = "",
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  onScroll,
  previewDisabled = false,
  previewIds,
  previewState,
  projectById,
  selectedThreadId,
  showLocation = false,
  threadActivityIndicator,
  threads,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: VirtualThreadListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);
  const getThreadListScrollElement = useCallback(() => listRef.current, []);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: getThreadListScrollElement,
    estimateSize: estimateThreadListRowSize,
    overscan: 8,
  });
  const internalPreviewState = useThreadPreviews({
    disabled: previewDisabled,
  });
  const resolvedPreviewState = previewState ?? internalPreviewState;
  const {
    errorPreviewHandlers,
    errorPreviewPopover,
    hideErrorPreview,
    hideThreadSummaryPreview,
    threadSummaryPopover,
    threadSummaryPreviewHandlers,
  } = resolvedPreviewState;
  const { errorPreviewPopoverId, threadSummaryPopoverId } =
    previewIds ?? buildThreadListPreviewIds(anchorIdPrefix);
  const threadListVirtualHeightClassName = useDynamicCssVariablesClassName(
    {
      "--thread-list-virtual-height": `${virtualizer.getTotalSize()}px`,
    },
    {
      className: "thread-list-virtual-height relative w-full",
      prefix: "thread-list-virtual-height-vars",
    },
  );

  return (
    <>
      <section
        ref={listRef}
        aria-label={ariaLabel}
        className={className}
        onScroll={onScroll}
      >
        <div className={threadListVirtualHeightClassName}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const thread = threads[virtualRow.index];
            if (!thread) {
              return null;
            }
            return (
              <VirtualizedThreadListRow
                key={thread.id}
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                activityIndicator={threadActivityIndicator(thread.id)}
                anchorIdPrefix={anchorIdPrefix}
                chooserOption={chooserOption}
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
                virtualRowSizePx={virtualRow.size}
                virtualRowStartPx={virtualRow.start}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
              />
            );
          })}
        </div>
      </section>
      {!previewState ? (
        <ThreadListPreviewPortals
          errorPreviewPopover={errorPreviewPopover}
          errorPreviewPopoverId={errorPreviewPopoverId}
          threadSummaryPopover={threadSummaryPopover}
          threadSummaryPopoverId={threadSummaryPopoverId}
        />
      ) : null}
    </>
  );
});

function VirtualizedThreadListRow({
  virtualRowSizePx,
  virtualRowStartPx,
  ...props
}: ThreadListRowProps & {
  virtualRowSizePx: number;
  virtualRowStartPx: number;
}): JSX.Element {
  const className = useDynamicCssVariablesClassName(
    {
      "--thread-list-row-height": `${virtualRowSizePx}px`,
      "--thread-list-row-y": `${virtualRowStartPx}px`,
    },
    {
      className: "thread-list-row absolute left-0 top-0",
      prefix: "thread-list-row-vars",
    },
  );

  return <ThreadListRow {...props} className={className} />;
}

const ThreadListRow = memo(function ThreadListRow({
  acknowledgeThreadErrorSeenInBackground,
  activityIndicator,
  anchorIdPrefix = "thread",
  chooserOption = false,
  className,
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
  const threadTimestampLabel = formatThreadTimestamp(
    threadListUpdatedAt(thread),
  );
  const threadSummaryPreviewText = useMemo(
    () =>
      buildThreadSummaryPreviewText({
        branchName: threadBranchName,
        projectName: threadProject?.name ?? null,
        summary: thread.summary,
        timestampLabel: threadTimestampLabel,
        worktreeDisplayPath: threadWorktreeDisplayPath,
      }),
    [
      thread.summary,
      threadBranchName,
      threadProject?.name,
      threadTimestampLabel,
      threadWorktreeDisplayPath,
    ],
  );
  const threadAriaLabel = useMemo(() => {
    const statusLabel = hasUnreadError
      ? "Unread error."
      : hasRunError
        ? "Error."
        : hasRunStopped
          ? "Stopped."
          : isWorking
            ? "Working."
            : hasCompletedActivity
              ? "Completed."
              : null;
    return [
      thread.title,
      threadPinned ? "Pinned." : null,
      statusLabel,
      `Updated ${threadTimestampLabel}.`,
      `Branch ${threadBranchName}.`,
      `Worktree ${threadWorktreeDisplayPath}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }, [
    hasCompletedActivity,
    hasRunError,
    hasRunStopped,
    hasUnreadError,
    isWorking,
    thread.title,
    threadBranchName,
    threadPinned,
    threadTimestampLabel,
    threadWorktreeDisplayPath,
  ]);
  // Prefer error handlers to make error details interactive without switching popover type.
  const threadPreviewHandlers = threadErrorPreviewText
    ? errorPreviewHandlers(threadPopoverAnchorId, threadErrorPreviewText)
    : threadSummaryPreviewHandlers(
        threadPopoverAnchorId,
        thread.title,
        threadSummaryPreviewText,
      );
  // Keep aria-describedby unset unless the matching tooltip is actually
  // mounted, avoiding broken ID references for idle rows.
  const threadPreviewDescriptionId =
    errorPreviewPopover?.anchorId === threadPopoverAnchorId
      ? errorPreviewPopoverId
      : threadSummaryPopover?.anchorId === threadPopoverAnchorId
        ? threadSummaryPopoverId
        : undefined;
  const branchLabel = useMemo(
    () => (
      <span className="inline-flex items-center gap-1">
        {materialSymbol(
          "fork_arrow",
          "text-[12px] leading-none text-text-muted",
        )}
        {threadBranchName}
      </span>
    ),
    [threadBranchName],
  );
  const secondaryLabel = useMemo(
    () => (
      <span className="inline-flex min-w-0 items-center gap-1">
        {threadPinned ? (
          <span className="shrink-0 text-text-secondary" title="Pinned">
            {materialSymbol("push_pin", "text-[13px]", {
              filled: true,
            })}
          </span>
        ) : null}
        <span className="text-text-muted">{threadTimestampLabel}</span>
        {showLocation ? (
          <>
            <span className="text-text-faint"> · </span>
            <span className="text-text-secondary">
              {threadProject?.name ? <>{threadProject.name} · </> : null}
              {branchLabel}
            </span>
          </>
        ) : null}
      </span>
    ),
    [
      branchLabel,
      showLocation,
      threadPinned,
      threadProject?.name,
      threadTimestampLabel,
    ],
  );
  const handleThreadContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      hideErrorPreview();
      hideThreadSummaryPreview();
      onOpenThreadActionMenu(thread, event.clientX + 6, event.clientY + 6);
    },
    [
      hideErrorPreview,
      hideThreadSummaryPreview,
      onOpenThreadActionMenu,
      thread,
    ],
  );
  const handleThreadClick = useCallback((): void => {
    hideErrorPreview();
    hideThreadSummaryPreview();
    dismissThreadStatus(thread);
    clearCompletedThreadIndicator(thread.id);
    if (thread.runStatus.hasUnreadError) {
      acknowledgeThreadErrorSeenInBackground(thread.id);
    }
    onOpenThread(thread.id);
  }, [
    acknowledgeThreadErrorSeenInBackground,
    clearCompletedThreadIndicator,
    dismissThreadStatus,
    hideErrorPreview,
    hideThreadSummaryPreview,
    onOpenThread,
    thread,
  ]);

  // Compose ARIA label and preview handlers to keep keyboard/screen-reader context consistent.
  return (
    <ListRowButton
      active={isActive}
      id={threadPopoverAnchorId}
      aria-current={chooserOption && isActive ? "true" : undefined}
      aria-describedby={threadPreviewDescriptionId}
      aria-label={threadAriaLabel}
      aria-selected={chooserOption ? isActive : undefined}
      data-chooser-option={chooserOption ? "true" : undefined}
      role={chooserOption ? "option" : undefined}
      {...threadPreviewHandlers}
      className={className}
      onContextMenu={handleThreadContextMenu}
      // Left click opens thread details and acknowledges/clears transient indicators first.
      onClick={handleThreadClick}
    >
      <div className="flex items-center gap-3">
        <span
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center ${
            isActive
              ? "bg-surface-2 text-accent-strong"
              : "bg-surface-3 text-accent"
          }`}
        >
          {materialSymbol("chat_bubble", "text-[15px]")}
          {activityIndicator !== "none" ? (
            <StatusIcon
              className={`absolute bottom-0 right-0 border ${
                isActive ? "border-surface-2" : "border-surface-3"
              }`}
              tone={activityIndicator === "completed" ? "success" : "info"}
            />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-4">
            {thread.title}
          </div>
          <div className="mt-1 truncate text-[11px] leading-4 text-text-muted">
            {secondaryLabel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-2">
          {hasUnreadError ? <AppBadge tone="danger">Unread</AppBadge> : null}
        </div>
      </div>
    </ListRowButton>
  );
}, areThreadListRowPropsEqual);

/**
 * Is preview anchor active.
 * @param anchorId - anchorId identifier.
 * @param popover - popover argument for isPreviewAnchorActive.
 */
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
    previous.chooserOption !== next.chooserOption ||
    previous.className !== next.className ||
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
