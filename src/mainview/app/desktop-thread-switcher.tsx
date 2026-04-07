/**
 * @file src/mainview/app/desktop-thread-switcher.tsx
 * @description Module for desktop thread switcher.
 */

import {
  type JSX,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
  normalizeSearchQuery,
} from "../controls/search-utils";
import { clampProjectMenuCoordinate, sortThreads } from "./state";
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

const DESKTOP_THREAD_SWITCHER_WIDTH_PX = 360;
const DESKTOP_THREAD_SWITCHER_ESTIMATED_HEIGHT_PX = 420;

type DesktopThreadSwitcherPosition = {
  maxHeight: number;
  width: number;
  x: number;
  y: number;
};

export const DESKTOP_THREAD_SWITCHER_POPOVER_ID =
  "desktop-thread-switcher-popover";

export type DesktopThreadSwitcherSections = {
  pinnedThreads: RpcThread[];
  recentThreads: RpcThread[];
};

type DesktopThreadSwitcherProps = SharedThreadListProps & {
  anchorId: string | null;
  onClose: (restoreFocus?: boolean) => void;
  onCreateThread: () => void;
  onOpenThread: (threadId: number) => void;
  open: boolean;
  previewDisabled: boolean;
  project: RpcProject | null;
  scrollContainer: HTMLElement | null;
  searchQuery: string;
  sections: DesktopThreadSwitcherSections;
  selectedThreadId: number | null;
  threadsError: string;
  worktreeLabel: string;
  worktreeSubtitle: string;
  onSearchQueryChange: (value: string) => void;
  isCreatingThread: boolean;
};

/**
 * Partition worktree threads into pinned and recent sections after applying search.
 */
export function deriveDesktopThreadSwitcherSections(
  threads: RpcThread[],
  searchQuery: string,
): DesktopThreadSwitcherSections {
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const matchingThreads = sortThreads(threads).filter((thread) =>
    matchesNormalizedSearchText(
      normalizedSearchQuery,
      buildNormalizedSearchText(thread.title, thread.summary),
    ),
  );
  const pinnedThreads: RpcThread[] = [];
  const recentThreads: RpcThread[] = [];

  for (const thread of matchingThreads) {
    if (thread.pinnedAt !== null) {
      pinnedThreads.push(thread);
      continue;
    }

    recentThreads.push(thread);
  }

  return {
    pinnedThreads,
    recentThreads,
  };
}

/**
 * Explicit desktop-only thread switcher popover anchored to the active worktree row action.
 */
export const DesktopThreadSwitcher = memo(function DesktopThreadSwitcher({
  acknowledgeThreadErrorSeenInBackground,
  anchorId,
  clearCompletedThreadIndicator,
  dismissThreadStatus,
  isCreatingThread,
  isThreadStatusDismissed,
  onClose,
  onCreateThread,
  onOpenThread,
  onOpenThreadActionMenu,
  onSearchQueryChange,
  open,
  previewDisabled,
  project,
  projectById,
  scrollContainer,
  searchQuery,
  sections,
  selectedThreadId,
  threadActivityIndicator,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
  worktreeLabel,
  worktreeSubtitle,
}: DesktopThreadSwitcherProps): JSX.Element | null {
  const [position, setPosition] =
    useState<DesktopThreadSwitcherPosition | null>(null);
  const labelId = useId();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasThreads =
    sections.pinnedThreads.length > 0 || sections.recentThreads.length > 0;

  useLayoutEffect(() => {
    if (!open || !anchorId || typeof window === "undefined") {
      setPosition(null);
      return;
    }

    let frameId: number | null = null;
    const updatePosition = (): void => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const anchor = document.getElementById(anchorId);
        if (!(anchor instanceof HTMLElement)) {
          onClose(false);
          return;
        }

        if (anchor.closest('[aria-hidden="true"]')) {
          onClose(false);
          return;
        }

        const rect = anchor.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          onClose(false);
          return;
        }

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const width = Math.min(
          DESKTOP_THREAD_SWITCHER_WIDTH_PX,
          Math.max(0, viewportWidth - 16),
        );
        const x = clampProjectMenuCoordinate(
          rect.right + 14,
          viewportWidth,
          width,
        );
        const y = clampProjectMenuCoordinate(
          rect.top,
          viewportHeight,
          DESKTOP_THREAD_SWITCHER_ESTIMATED_HEIGHT_PX,
        );
        const maxHeight = Math.max(
          180,
          Math.min(
            DESKTOP_THREAD_SWITCHER_ESTIMATED_HEIGHT_PX,
            viewportHeight - y - 12,
          ),
        );

        setPosition((current) => {
          if (
            current &&
            current.x === x &&
            current.y === y &&
            current.width === width &&
            current.maxHeight === maxHeight
          ) {
            return current;
          }

          return {
            maxHeight,
            width,
            x,
            y,
          };
        });
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("resize", updatePosition);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [anchorId, onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (!open || !scrollContainer) {
      return;
    }

    const handleScroll = (): void => {
      onClose(false);
    };

    scrollContainer.addEventListener("scroll", handleScroll, true);
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose, open, scrollContainer]);

  useEffect(() => {
    if (!open || !anchorId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) {
        return;
      }

      const anchor = document.getElementById(anchorId);
      if (anchor?.contains(target)) {
        return;
      }

      onClose(true);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [anchorId, onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose(true);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !anchorId || !position || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      aria-labelledby={labelId}
      aria-modal="false"
      className="fixed z-[85] flex select-none flex-col overflow-hidden border border-[#35414a] bg-[#13181b]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
      id={DESKTOP_THREAD_SWITCHER_POPOVER_ID}
      role="dialog"
      style={{
        left: position.x,
        maxHeight: position.maxHeight,
        top: position.y,
        width: position.width,
      }}
    >
      <div className="space-y-3 border-b border-[#2b343b] bg-[#181f24] px-3 py-3">
        <div className="min-w-0">
          <div
            className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]"
            id={labelId}
          >
            Threads
          </div>
          <div className="truncate text-sm font-semibold text-[#f2f0ef]">
            {worktreeLabel}
          </div>
          <div className="truncate text-[11px] text-[#8f9aa2]">
            {project?.name ?? "Current project"} · {worktreeSubtitle}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 border border-[#2f3b43] bg-[#101214] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <span className="sr-only">Search threads</span>
            {materialSymbol("search", "text-[16px] text-[#98b9d0]")}
            <input
              ref={searchInputRef}
              autoCapitalize="none"
              autoCorrect="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
              onChange={(event) => {
                onSearchQueryChange(event.currentTarget.value);
              }}
              placeholder="Search threads..."
              spellCheck={false}
              value={searchQuery}
            />
            {searchQuery ? (
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center text-[#8f8d8b] transition-colors hover:bg-[#1d2226] hover:text-[#f2f0ef]"
                onClick={() => {
                  onSearchQueryChange("");
                }}
                aria-label="Clear thread search"
              >
                ×
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className="shrink-0 border border-[#bdd5e6] bg-[#bdd5e6] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-widest text-[#2e526b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onCreateThread}
            disabled={isCreatingThread}
          >
            {isCreatingThread ? "Creating" : "New Thread"}
          </button>
        </div>
      </div>
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
        {!hasThreads ? (
          <div className="px-3 py-3 text-xs text-[#8f8d8b]">
            {searchQuery
              ? "No matching threads in this worktree."
              : isCreatingThread
                ? "Creating thread..."
                : "No threads in this worktree yet. Use New Thread to start one."}
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {sections.pinnedThreads.length > 0 ? (
              <div className="space-y-1">
                <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                  Pinned
                </div>
                <ThreadList
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="desktop-thread-switcher-pinned"
                  clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                  dismissThreadStatus={dismissThreadStatus}
                  isThreadStatusDismissed={isThreadStatusDismissed}
                  onOpenThread={onOpenThread}
                  onOpenThreadActionMenu={onOpenThreadActionMenu}
                  previewDisabled={previewDisabled}
                  projectById={projectById}
                  selectedThreadId={selectedThreadId}
                  threadActivityIndicator={threadActivityIndicator}
                  threads={sections.pinnedThreads}
                  worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                  worktreeByProjectAndPath={worktreeByProjectAndPath}
                />
              </div>
            ) : null}
            {sections.recentThreads.length > 0 ? (
              <div className="space-y-1">
                <div className="px-3 pb-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8ca6b9]">
                  Recent
                </div>
                <ThreadList
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="desktop-thread-switcher-recent"
                  clearCompletedThreadIndicator={clearCompletedThreadIndicator}
                  dismissThreadStatus={dismissThreadStatus}
                  isThreadStatusDismissed={isThreadStatusDismissed}
                  onOpenThread={onOpenThread}
                  onOpenThreadActionMenu={onOpenThreadActionMenu}
                  previewDisabled={previewDisabled}
                  projectById={projectById}
                  selectedThreadId={selectedThreadId}
                  threadActivityIndicator={threadActivityIndicator}
                  threads={sections.recentThreads}
                  worktreeDisplayPathByKey={worktreeDisplayPathByKey}
                  worktreeByProjectAndPath={worktreeByProjectAndPath}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
      {threadsError ? (
        <div className="border-t border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff9db0]">
          {threadsError}
        </div>
      ) : null}
    </div>,
    document.body,
  );
});
