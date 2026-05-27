/**
 * @file src/mainview/app/pinned-threads-panel.tsx
 * @description Module for pinned threads panel.
 */

import { type JSX, memo } from "react";
import type { RpcThread } from "../../bun/rpc-schema";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleThreadsPanelOpen,
  useThreadsPanelOpen,
} from "./sidebar-panels-state";
import {
  buildThreadListPreviewIds,
  type SharedThreadListProps,
  ThreadList,
  ThreadListPreviewPortals,
  VirtualThreadList,
} from "./thread-list-row";
import { useThreadPreviews } from "./use-thread-previews";

const PINNED_THREADS_PANEL_TITLE_ID = "desktop-threads-panel-title";
const PINNED_THREADS_PANEL_REGION_ID = "desktop-threads-panel-region";

type PinnedThreadsPanelProps = SharedThreadListProps & {
  /** Active sidebar query, used to tailor the empty-state copy. */
  normalizedSidebarSearchQuery: string;
  onLoadMoreThreads?: () => void;
  pinnedThreads: RpcThread[];
  recentThreads: RpcThread[];
  threadPreviewsDisabled: boolean;
  threadsError: string;
};

/**
 * Keep the desktop sidebar thread section scoped to pinned shortcuts plus a scrollable recent-thread window.
 */
export const PinnedThreadsPanel = memo(function PinnedThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  normalizedSidebarSearchQuery,
  onLoadMoreThreads,
  onOpenThread,
  onOpenThreadActionMenu,
  pinnedThreads,
  projectById,
  recentThreads,
  selectedThreadId,
  threadActivityIndicator,
  threadPreviewsDisabled,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: PinnedThreadsPanelProps): JSX.Element {
  const threadsOpen = useThreadsPanelOpen();

  const hasThreads = pinnedThreads.length > 0 || recentThreads.length > 0;
  const threadPreviewState = useThreadPreviews({
    disabled: threadPreviewsDisabled,
  });
  const threadPreviewIds = buildThreadListPreviewIds("sidebar-thread");

  return (
    <section
      aria-labelledby={PINNED_THREADS_PANEL_TITLE_ID}
      className="select-none"
    >
      <SidebarSectionHeader
        controlsId={PINNED_THREADS_PANEL_REGION_ID}
        title="Threads"
        titleId={PINNED_THREADS_PANEL_TITLE_ID}
        open={threadsOpen}
        onToggle={toggleThreadsPanelOpen}
      />
      {threadsOpen ? (
        <section
          id={PINNED_THREADS_PANEL_REGION_ID}
          aria-labelledby={PINNED_THREADS_PANEL_TITLE_ID}
          className="mt-3 space-y-3"
        >
          {!hasThreads ? (
            <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
              {normalizedSidebarSearchQuery
                ? "No matching threads."
                : "No pinned or recent threads yet."}
            </div>
          ) : null}
          {pinnedThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[11px] uppercase tracking-[0.1em] text-accent">
                Pinned
              </div>
              <ThreadList
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                anchorIdPrefix="pinned-thread"
                clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                dismissThreadStatus={dismissThreadStatus}
                isThreadStatusDismissed={isThreadStatusDismissed}
                onOpenThread={onOpenThread}
                onOpenThreadActionMenu={onOpenThreadActionMenu}
                previewDisabled={threadPreviewsDisabled}
                previewIds={threadPreviewIds}
                previewState={threadPreviewState}
                projectById={projectById}
                selectedThreadId={selectedThreadId}
                showLocation
                threadActivityIndicator={threadActivityIndicator}
                threads={pinnedThreads}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
              />
            </div>
          ) : null}
          {recentThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[11px] uppercase tracking-[0.1em] text-accent">
                Recent
              </div>
              <VirtualThreadList
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                anchorIdPrefix="recent-thread"
                ariaLabel="Recent threads"
                className="app-scrollbar max-h-[30rem] overflow-y-auto overscroll-contain border-t border-border-subtle"
                clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                dismissThreadStatus={dismissThreadStatus}
                isThreadStatusDismissed={isThreadStatusDismissed}
                onOpenThread={onOpenThread}
                onOpenThreadActionMenu={onOpenThreadActionMenu}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  if (
                    onLoadMoreThreads &&
                    target.scrollHeight -
                      target.scrollTop -
                      target.clientHeight <
                      240
                  ) {
                    onLoadMoreThreads();
                  }
                }}
                previewDisabled={threadPreviewsDisabled}
                previewIds={threadPreviewIds}
                previewState={threadPreviewState}
                projectById={projectById}
                selectedThreadId={selectedThreadId}
                showLocation
                threadActivityIndicator={threadActivityIndicator}
                threads={recentThreads}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
              />
            </div>
          ) : null}
          {hasThreads ? (
            <ThreadListPreviewPortals
              errorPreviewPopover={threadPreviewState.errorPreviewPopover}
              errorPreviewPopoverId={threadPreviewIds.errorPreviewPopoverId}
              threadSummaryPopover={threadPreviewState.threadSummaryPopover}
              threadSummaryPopoverId={threadPreviewIds.threadSummaryPopoverId}
            />
          ) : null}
          {threadsError ? (
            <div className="bg-danger-surface px-3 py-2 text-xs text-danger-text">
              {threadsError}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
});
