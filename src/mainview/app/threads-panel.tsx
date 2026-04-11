/**
 * @file src/mainview/app/threads-panel.tsx
 * @description Module for threads panel.
 */

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
  /** Active worktree path for the selected project; null means no thread operations. */
  activeSelectedWorktreePath: string | null;
  /** Threads after applying search/project filters for the active worktree. */
  filteredVisibleThreads: RpcThread[];
  /** Disables thread creation action while a new thread is being created. */
  isCreatingThread: boolean;
  /** Lowercased query string used for sidebar thread filtering. */
  normalizedSidebarSearchQuery: string;
  /** Opens a create-thread flow for the selected worktree. */
  onCreateThread: () => void;
  /** Selected project; must be present to allow create/list actions. */
  selectedProject: RpcProject | null;
  /** Shared class names for the section action button. */
  sidebarActionButtonClass: string;
  /** Toggles thread popovers and preview handling in the child ThreadList. */
  threadPreviewsDisabled: boolean;
  /** Inline threads panel error text from thread operations. */
  threadsError: string;
};

/** Sidebar section for rendering and interacting with project threads. */
export const ThreadsPanel = memo(function ThreadsPanel({
  acknowledgeThreadErrorSeenInBackground,
  activeSelectedWorktreePath,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  filteredVisibleThreads,
  isCreatingThread,
  isThreadStatusDismissed,
  normalizedSidebarSearchQuery,
  onCreateThread,
  onOpenThread,
  onOpenThreadActionMenu,
  projectById,
  selectedProject,
  selectedThreadId,
  sidebarActionButtonClass,
  threadPreviewsDisabled,
  threadActivityIndicator,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
}: ThreadsPanelProps) {
  // Panel open state comes from shared sidebar state persisted by user preference.
  const threadsOpen = useThreadsPanelOpen();

  // Render guard states first (no selection / no worktree), then list + optional error.
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
          {/* Threads list is shown only when a project and worktree are selected. */}
          {!selectedProject || !activeSelectedWorktreePath ? (
            <div className="bg-surface-1 px-3 py-2.5 text-xs text-text-muted">
              Select a project worktree first.
            </div>
          ) : filteredVisibleThreads.length === 0 ? (
            <div className="bg-surface-1 px-3 py-2.5 text-xs text-text-muted">
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
              isThreadStatusDismissed={isThreadStatusDismissed}
              onOpenThread={onOpenThread}
              onOpenThreadActionMenu={onOpenThreadActionMenu}
              previewDisabled={threadPreviewsDisabled}
              projectById={projectById}
              selectedThreadId={selectedThreadId}
              threadActivityIndicator={threadActivityIndicator}
              threads={filteredVisibleThreads}
              worktreeDisplayPathByKey={worktreeDisplayPathByKey}
              worktreeByProjectAndPath={worktreeByProjectAndPath}
            />
          )}
          {/* Keep error messaging visible beneath the list so list context remains visible. */}
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
