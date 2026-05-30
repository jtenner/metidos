/**
 * @file src/mainview/app/desktop-thread-switcher.tsx
 * @description Module for desktop thread switcher.
 */

import {
  type JSX,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { AppButton } from "../controls/button";
import {
  chooserOptionIndexForKey,
  findChooserOptionElements,
} from "../controls/dropdown";
import { materialSymbol } from "../controls/icons";
import { PopoverSurface } from "../controls/popover";
import {
  buildNormalizedSearchText,
  matchesNormalizedSearchText,
  normalizeSearchQuery,
} from "../controls/search-utils";
import { type SharedThreadListProps, ThreadList } from "./thread-list-row";

export const DESKTOP_THREAD_SWITCHER_POPOVER_ID =
  "desktop-thread-switcher-popover";

function elementKeepsThreadSwitcherActive(
  element: HTMLElement | null,
): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const activeElement = document.activeElement;
  return (
    element.matches(":hover") ||
    element === activeElement ||
    element.contains(activeElement)
  );
}

export function desktopThreadSwitcherSurfaceStillActive(
  anchorId: string,
): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const anchor = document.getElementById(anchorId);
  const popover = document.getElementById(DESKTOP_THREAD_SWITCHER_POPOVER_ID);
  return (
    elementKeepsThreadSwitcherActive(
      anchor instanceof HTMLElement ? anchor : null,
    ) ||
    elementKeepsThreadSwitcherActive(
      popover instanceof HTMLElement ? popover : null,
    )
  );
}

export function deferCloseDesktopThreadSwitcher(
  anchorId: string,
  onClose: (restoreFocus?: boolean) => void,
  restoreFocus = false,
): void {
  if (typeof window === "undefined") {
    onClose(restoreFocus);
    return;
  }

  window.requestAnimationFrame(() => {
    if (desktopThreadSwitcherSurfaceStillActive(anchorId)) {
      return;
    }

    onClose(restoreFocus);
  });
}

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
 * Partition an already-ordered worktree thread list after applying search.
 */
export function deriveDesktopThreadSwitcherSections(
  threads: RpcThread[],
  searchQuery: string,
): DesktopThreadSwitcherSections {
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const pinnedThreads: RpcThread[] = [];
  const recentThreads: RpcThread[] = [];

  for (const thread of threads) {
    if (
      normalizedSearchQuery &&
      !matchesNormalizedSearchText(
        normalizedSearchQuery,
        buildNormalizedSearchText(thread.title, thread.summary),
      )
    ) {
      continue;
    }

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

export function DesktopThreadSwitcherPanelContent({
  acknowledgeThreadErrorSeenInBackground,
  clearCompletedThreadIndicator,
  descriptionId,
  dismissThreadStatus,
  isCreatingThread,
  isThreadStatusDismissed,
  labelId,
  listboxId,
  onCreateThread,
  onOpenThread,
  onOpenThreadActionMenu,
  onSearchKeyDown,
  onSearchQueryChange,
  previewDisabled,
  project,
  projectById,
  searchInputRef,
  searchQuery,
  sections,
  selectedThreadId,
  threadActivityIndicator,
  threadsError,
  worktreeDisplayPathByKey,
  worktreeByProjectAndPath,
  worktreeLabel,
  worktreeSubtitle,
}: {
  acknowledgeThreadErrorSeenInBackground: SharedThreadListProps["acknowledgeThreadErrorSeenInBackground"];
  clearCompletedThreadIndicator: SharedThreadListProps["clearCompletedThreadIndicator"];
  descriptionId: string;
  dismissThreadStatus: SharedThreadListProps["dismissThreadStatus"];
  isCreatingThread: boolean;
  isThreadStatusDismissed: SharedThreadListProps["isThreadStatusDismissed"];
  labelId: string;
  listboxId: string;
  onCreateThread: () => void;
  onOpenThread: (threadId: number) => void;
  onOpenThreadActionMenu: SharedThreadListProps["onOpenThreadActionMenu"];
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onSearchQueryChange: (value: string) => void;
  previewDisabled: boolean;
  project: RpcProject | null;
  projectById: SharedThreadListProps["projectById"];
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  sections: DesktopThreadSwitcherSections;
  selectedThreadId: number | null;
  threadActivityIndicator: SharedThreadListProps["threadActivityIndicator"];
  threadsError: string;
  worktreeDisplayPathByKey: SharedThreadListProps["worktreeDisplayPathByKey"];
  worktreeByProjectAndPath: SharedThreadListProps["worktreeByProjectAndPath"];
  worktreeLabel: string;
  worktreeSubtitle: string;
}): JSX.Element {
  const hasThreads =
    sections.pinnedThreads.length > 0 || sections.recentThreads.length > 0;

  return (
    <>
      <p className="sr-only" id={descriptionId}>
        Search and choose a thread for the current worktree.
      </p>
      <div className="space-y-3 border-b border-border-default bg-surface-2 px-3 py-3">
        <div className="min-w-0">
          <div
            className="font-label text-[11px] uppercase tracking-[0.1em] text-accent"
            id={labelId}
          >
            Threads
          </div>
          <div className="truncate text-sm font-semibold text-text-primary">
            {worktreeLabel}
          </div>
          <div className="truncate text-[11px] text-text-muted">
            {project?.name ?? "Current project"} · {worktreeSubtitle}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 border border-border-default bg-surface-1 px-3 py-2">
            <span className="sr-only">Search threads</span>
            {materialSymbol("search", "text-[17px] text-accent")}
            <input
              ref={searchInputRef}
              aria-controls={listboxId}
              aria-label="Search threads"
              autoCapitalize="none"
              autoCorrect="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-faint focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring"
              data-chooser-search="true"
              name="thread-search"
              onChange={(event) => {
                onSearchQueryChange(event.currentTarget.value);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Search threads..."
              spellCheck={false}
              value={searchQuery}
            />
            {searchQuery ? (
              <AppButton
                aria-label="Clear thread search"
                buttonStyle="muted"
                className="border-transparent"
                iconOnly
                onClick={() => {
                  onSearchQueryChange("");
                }}
              >
                {materialSymbol("close", "text-[15px]")}
              </AppButton>
            ) : null}
          </label>
          <AppButton
            buttonStyle="primary"
            onClick={onCreateThread}
            disabled={isCreatingThread}
          >
            {isCreatingThread ? "Creating" : "New Thread"}
          </AppButton>
        </div>
      </div>
      <fieldset
        aria-label={`Threads for ${worktreeLabel}`}
        className="app-scrollbar min-w-0 flex-1 overflow-y-auto border-0 p-0 py-1"
        id={listboxId}
      >
        {!hasThreads ? (
          <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
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
                <div className="px-3 pb-1 font-label text-[11px] uppercase tracking-[0.1em] text-accent">
                  Pinned
                </div>
                <ThreadList
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="desktop-thread-switcher-pinned"
                  chooserOption
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
                <div className="px-3 pb-1 font-label text-[11px] uppercase tracking-[0.1em] text-accent">
                  Recent
                </div>
                <ThreadList
                  acknowledgeThreadErrorSeenInBackground={
                    acknowledgeThreadErrorSeenInBackground
                  }
                  anchorIdPrefix="desktop-thread-switcher-recent"
                  chooserOption
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
      </fieldset>
      {threadsError ? (
        <div className="border-t border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
          {threadsError}
        </div>
      ) : null}
    </>
  );
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
  const labelId = useId();
  const descriptionId = useId();
  const listboxId = useId();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const _hasThreads =
    sections.pinnedThreads.length > 0 || sections.recentThreads.length > 0;
  const anchorElement =
    anchorId && typeof document !== "undefined"
      ? document.getElementById(anchorId)
      : null;

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
    if (!open) {
      return;
    }

    if (!(anchorElement instanceof HTMLElement)) {
      onClose(false);
      return;
    }

    if (anchorElement.closest('[aria-hidden="true"]')) {
      onClose(false);
      return;
    }

    const rect = anchorElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      onClose(false);
    }
  }, [anchorElement, onClose, open]);

  if (!open || !(anchorElement instanceof HTMLElement)) {
    return null;
  }

  const deferClose = (): void => {
    if (!anchorId) {
      onClose(false);
      return;
    }

    deferCloseDesktopThreadSwitcher(anchorId, onClose, false);
  };

  const handlePanelKeyDownCapture = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    const panelElement = popoverRef.current;
    if (!panelElement) {
      return;
    }

    const optionTarget =
      event.target instanceof Element
        ? event.target.closest('[data-chooser-option="true"]')
        : null;
    if (!(optionTarget instanceof HTMLElement)) {
      return;
    }

    const options = findChooserOptionElements(panelElement);
    const nextIndex = chooserOptionIndexForKey({
      currentIndex: options.indexOf(optionTarget),
      key: event.key,
      optionCount: options.length,
    });
    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    options[nextIndex]?.focus({ preventScroll: true });
  };

  const handleSearchKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const options = findChooserOptionElements(popoverRef.current);
    const nextIndex = chooserOptionIndexForKey({
      currentIndex: -1,
      key: event.key,
      optionCount: options.length,
    });
    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    options[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <PopoverSurface
      ref={popoverRef}
      aria-describedby={descriptionId}
      aria-labelledby={labelId}
      className="z-[85] flex w-[min(360px,calc(100vw-1rem))] select-none flex-col overflow-hidden border border-border-default bg-surface-overlay shadow-overlay backdrop-blur-xl"
      hideWhenEscaped={false}
      id={DESKTOP_THREAD_SWITCHER_POPOVER_ID}
      initialFocusRef={searchInputRef}
      onBlur={deferClose}
      onKeyDownCapture={handlePanelKeyDownCapture}
      onMouseLeave={deferClose}
      onRequestClose={(restoreFocus) => {
        onClose(restoreFocus === true);
      }}
      offsetPx={14}
      open={open}
      placement="right-start"
      reference={anchorElement}
      restoreFocus={false}
      restoreFocusReference={anchorElement}
      surfaceMode="chooser"
    >
      <DesktopThreadSwitcherPanelContent
        acknowledgeThreadErrorSeenInBackground={
          acknowledgeThreadErrorSeenInBackground
        }
        clearCompletedThreadIndicator={clearCompletedThreadIndicator}
        descriptionId={descriptionId}
        dismissThreadStatus={dismissThreadStatus}
        isCreatingThread={isCreatingThread}
        isThreadStatusDismissed={isThreadStatusDismissed}
        labelId={labelId}
        listboxId={listboxId}
        onCreateThread={onCreateThread}
        onOpenThread={onOpenThread}
        onOpenThreadActionMenu={onOpenThreadActionMenu}
        onSearchKeyDown={handleSearchKeyDown}
        onSearchQueryChange={onSearchQueryChange}
        previewDisabled={previewDisabled}
        project={project}
        projectById={projectById}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        sections={sections}
        selectedThreadId={selectedThreadId}
        threadActivityIndicator={threadActivityIndicator}
        threadsError={threadsError}
        worktreeDisplayPathByKey={worktreeDisplayPathByKey}
        worktreeByProjectAndPath={worktreeByProjectAndPath}
        worktreeLabel={worktreeLabel}
        worktreeSubtitle={worktreeSubtitle}
      />
    </PopoverSurface>
  );
});
