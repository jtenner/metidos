/**
 * @file src/mainview/app/workspace-panel.tsx
 * @description Module for workspace panel.
 */

import { memo, useCallback, useState } from "react";
import type { JSX } from "react";
import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleWorkspaceActiveSectionOpen,
  toggleWorkspacePanelOpen,
  useWorkspaceActiveSectionOpen,
  useWorkspacePanelOpen,
} from "./sidebar-panels-state";
import { clampProjectMenuCoordinate } from "./state";
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

type WorkspacePanelProps = SharedThreadListProps & {
  /** Suppresses popover previews for thread rows when true. */
  threadPreviewsDisabled: boolean;
  /** Branch of the selected worktree for thread create popover details. */
  activeSelectedWorktreeBranch: string;
  /** Folder name of the selected worktree for thread create popover details. */
  activeSelectedWorktreeFolder: string;
  /** Error text shown at the bottom of the threads panel. */
  threadsError: string;
  /** Indicates whether a thread can be started from the currently selected worktree. */
  canCreateThread: boolean;
  /** Disables the create-thread button while a new thread request is pending. */
  isCreatingThread: boolean;
  /** Name of the selected project for thread create popover details. */
  selectedProjectNameForThread: string;
  /** Shared class names for the header action button. */
  sidebarActionButtonClass: string;
  /** Threads marked as pinned in workspace state. */
  workspaceActiveThreads: RpcThread[];
  /** Unpinned recent threads in workspace state. */
  workspacePinnedThreads: RpcThread[];
  /** Creates a thread for the currently selected open worktree. */
  onCreateThread: () => void;
};

type CreateThreadPopoverState = {
  /** Coordinates used for fixed positioning of the create-thread popover. */
  x: number;
  /** Coordinates used for fixed positioning of the create-thread popover. */
  y: number;
};

const CREATE_THREAD_POPOVER_ANCHOR_ID = "workspace-create-thread-button";

function createThreadAnchorStillActive(anchorId: string): boolean {
  // Keep the popover visible when hover/focus remains on the anchor.
  if (typeof document === "undefined") {
    return false;
  }

  const anchor = document.getElementById(anchorId);
  if (!(anchor instanceof HTMLElement)) {
    return false;
  }

  const activeElement = document.activeElement;
  return (
    anchor.matches(":hover") ||
    anchor === activeElement ||
    anchor.contains(activeElement)
  );
}

/**
 * Renders the threads workspace section in the left panel.
 * Shows pinned threads, a collapsible recent threads section, and panel-level error text.
 */
export const WorkspacePanel = memo(function WorkspacePanel({
  acknowledgeThreadErrorSeenInBackground,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isThreadStatusDismissed,
  onOpenThread,
  onOpenThreadActionMenu,
  projectById,
  activeSelectedWorktreeBranch,
  activeSelectedWorktreeFolder,
  selectedThreadId,
  threadPreviewsDisabled,
  threadActivityIndicator,
  canCreateThread,
  isCreatingThread,
  onCreateThread,
  threadsError,
  sidebarActionButtonClass,
  selectedProjectNameForThread,
  worktreeDisplayPathByKey,
  workspaceActiveThreads,
  workspacePinnedThreads,
  worktreeByProjectAndPath,
}: WorkspacePanelProps) {
  // Global panel + section open state is shared with the sidebar panel reducer.
  const workspaceOpen = useWorkspacePanelOpen();
  const workspaceActiveOpen = useWorkspaceActiveSectionOpen();
  const createThreadDisabled = isCreatingThread || !canCreateThread;
  const [createThreadPopover, setCreateThreadPopover] =
    useState<CreateThreadPopoverState | null>(null);
  // Empty-state is shown only when both pinned and recent lists are empty.
  const hasThreads =
    workspacePinnedThreads.length > 0 || workspaceActiveThreads.length > 0;

  const showCreateThreadPopover = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
    ): void => {
      if (typeof window === "undefined") {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const x = clampProjectMenuCoordinate(rect.right + 12, viewportWidth, 240);
      const y = clampProjectMenuCoordinate(
        rect.top + rect.height / 2 - 60,
        viewportHeight,
        160,
      );

      setCreateThreadPopover({
        x,
        y,
      });
    },
    [],
  );

  const hideCreateThreadPopover = useCallback((): void => {
    setCreateThreadPopover(null);
  }, []);

  const deferHideCreateThreadPopover = useCallback((): void => {
    if (typeof window === "undefined") {
      hideCreateThreadPopover();
      return;
    }

    window.requestAnimationFrame(() => {
      if (createThreadAnchorStillActive(CREATE_THREAD_POPOVER_ANCHOR_ID)) {
        return;
      }

      hideCreateThreadPopover();
    });
  }, [hideCreateThreadPopover]);

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Threads"
        open={workspaceOpen}
        onToggle={toggleWorkspacePanelOpen}
        action={
          <div className="group relative">
            <button
              id={CREATE_THREAD_POPOVER_ANCHOR_ID}
              type="button"
              className={`${sidebarActionButtonClass} ${
                createThreadDisabled ? "cursor-not-allowed opacity-50" : ""
              }`}
              onClick={() => {
                if (createThreadDisabled) {
                  return;
                }
                onCreateThread();
              }}
              disabled={isCreatingThread}
              aria-disabled={createThreadDisabled}
              aria-busy={isCreatingThread}
              aria-label={
                canCreateThread
                  ? "Create thread for selected worktree"
                  : "Select an open worktree first"
              }
              onMouseEnter={showCreateThreadPopover}
              onMouseLeave={deferHideCreateThreadPopover}
              onFocus={showCreateThreadPopover}
              onBlur={deferHideCreateThreadPopover}
            >
              +
            </button>
          </div>
        }
      />
      <CreateThreadPopoverPortal>
        {createThreadPopover ? (
          <div
            className="pointer-events-none fixed z-[150] max-w-[240px] border border-[#2b3b47] bg-[#14181a]/96 px-2.5 py-2 text-[10px] text-[#dce6ec] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm"
            style={{
              left: createThreadPopover.x,
              top: createThreadPopover.y,
            }}
          >
            <div className="font-label text-[9px] uppercase tracking-[0.16em] text-[#8ca6b9]">
              New thread context
            </div>
            <div className="mt-1 text-[11px] leading-5">
              <div className="truncate text-[#dce6ec]">
                {selectedProjectNameForThread}{" "}
                <span className="inline-flex items-center gap-1 text-[#8ca6b9]">
                  <span className="material-symbols-outlined text-[12px] leading-none text-[#8ca6b9]">
                    call_split
                  </span>
                  <span className="truncate">
                    {activeSelectedWorktreeBranch}
                  </span>
                </span>
              </div>
              <div className="mt-0.5 truncate text-[#65737f]">
                {activeSelectedWorktreeFolder}
              </div>
            </div>
          </div>
        ) : null}
      </CreateThreadPopoverPortal>
      {workspaceOpen ? (
        <div className="mt-3 space-y-4">
          {!hasThreads ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              No pinned or recent threads yet.
            </div>
          ) : null}
          {/* Pinned section is always visible when present and never collapsible. */}
          {workspacePinnedThreads.length > 0 ? (
            <div className="space-y-1">
              <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                Pinned
              </div>
              <ThreadList
                acknowledgeThreadErrorSeenInBackground={
                  acknowledgeThreadErrorSeenInBackground
                }
                anchorIdPrefix="workspace-thread"
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
                threads={workspacePinnedThreads}
                worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                worktreeByProjectAndPath={worktreeByProjectAndPath}
              />
            </div>
          ) : null}
          {/* Recent threads are behind an explicit toggle and can be hidden to reduce noise. */}
          {workspaceActiveThreads.length > 0 ? (
            <div className="space-y-1">
              <button
                type="button"
                className="group flex w-full items-center gap-2 px-3 pb-1 text-left transition-colors"
                onClick={toggleWorkspaceActiveSectionOpen}
                aria-expanded={workspaceActiveOpen}
              >
                <span className="font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                  Recent
                </span>
                <span className="ml-auto shrink-0 text-[#62737e] transition-colors group-hover:text-[#bdd5e6]">
                  {materialSymbol(
                    workspaceActiveOpen ? "expand_more" : "chevron_right",
                    "text-[14px]",
                  )}
                </span>
              </button>
              {workspaceActiveOpen ? (
                <ThreadList
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="workspace-thread"
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
                  threads={workspaceActiveThreads}
                  worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                  worktreeByProjectAndPath={worktreeByProjectAndPath}
                />
              ) : null}
            </div>
          ) : null}
          {/* Thread-level backend/API errors are surfaced directly in the workspace list. */}
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

function CreateThreadPopoverPortal({
  children,
}: {
  children: JSX.Element | null | false;
}): JSX.Element | null {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(children, document.body);
}
