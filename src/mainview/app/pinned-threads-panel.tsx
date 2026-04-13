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
import { APP_TITLE, sortThreads } from "./state";
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

const DESKTOP_RECENT_THREADS_VISIBLE_COUNT = 5;

export function deriveVisibleDesktopRecentThreads(
  recentThreads: RpcThread[],
): RpcThread[] {
  return sortThreads(recentThreads).slice(
    0,
    DESKTOP_RECENT_THREADS_VISIBLE_COUNT,
  );
}

type PinnedThreadsPanelProps = SharedThreadListProps & {
  canCreateThread: boolean;
  isCreatingThread: boolean;
  onCreateThread: () => void;
  pinnedThreads: RpcThread[];
  recentThreads: RpcThread[];
  sidebarActionButtonClass: string;
  threadPreviewsDisabled: boolean;
  threadsError: string;
};

/**
 * Keep the desktop sidebar thread section scoped to pinned shortcuts plus the latest recent threads.
 */
export const PinnedThreadsPanel = memo(function PinnedThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  canCreateThread,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isCreatingThread,
  isThreadStatusDismissed,
  onCreateThread,
  onOpenThread,
  onOpenThreadActionMenu,
  pinnedThreads,
  projectById,
  recentThreads,
  selectedThreadId,
  sidebarActionButtonClass,
  threadActivityIndicator,
  threadPreviewsDisabled,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: PinnedThreadsPanelProps): JSX.Element {
  const threadsOpen = useThreadsPanelOpen();
  const visibleRecentThreads = deriveVisibleDesktopRecentThreads(recentThreads);
  const hasThreads =
    pinnedThreads.length > 0 || visibleRecentThreads.length > 0;
  const createThreadDisabled = isCreatingThread || !canCreateThread;

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
            aria-label={
              canCreateThread
                ? "Create thread for selected worktree"
                : "Select a project and worktree first"
            }
            aria-busy={isCreatingThread}
            disabled={createThreadDisabled}
            title={
              canCreateThread
                ? `Start a new ${APP_TITLE} thread for the selected worktree`
                : "Select a project and worktree first"
            }
          >
            +
          </button>
        }
      />
      {threadsOpen ? (
        <div className="mt-3 space-y-3">
          {!hasThreads ? (
            <div className="bg-surface-1 px-3 py-2.5 text-xs text-text-muted">
              {canCreateThread
                ? `No pinned or recent threads yet. Use + to start a ${APP_TITLE} thread for the selected worktree.`
                : "No pinned or recent threads yet."}
            </div>
          ) : null}
          {pinnedThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-widest text-accent">
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
          {visibleRecentThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-widest text-accent">
                Recent
              </div>
              <ThreadList
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                anchorIdPrefix="recent-thread"
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
                threads={visibleRecentThreads}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
              />
            </div>
          ) : null}
          {threadsError ? (
            <div className="bg-danger-surface px-3 py-2 text-xs text-danger-text">
              {threadsError}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
