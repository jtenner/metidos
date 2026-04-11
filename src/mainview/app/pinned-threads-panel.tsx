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
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

type PinnedThreadsPanelProps = SharedThreadListProps & {
  pinnedThreads: RpcThread[];
  threadPreviewsDisabled: boolean;
  threadsError: string;
};

/**
 * Renders globally pinned threads as always-available shortcuts in the desktop sidebar.
 */
export const PinnedThreadsPanel = memo(function PinnedThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  pinnedThreads,
  projectById,
  selectedThreadId,
  threadActivityIndicator,
  threadPreviewsDisabled,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: PinnedThreadsPanelProps): JSX.Element {
  const threadsOpen = useThreadsPanelOpen();

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Pinned Threads"
        open={threadsOpen}
        onToggle={toggleThreadsPanelOpen}
      />
      {threadsOpen ? (
        <div className="mt-3 space-y-1.5">
          {pinnedThreads.length > 0 ? (
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
          ) : (
            <div className="bg-surface-1 px-3 py-2.5 text-xs text-text-muted">
              Pin threads to keep quick access shortcuts here.
            </div>
          )}
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
