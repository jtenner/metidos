/**
 * @file src/mainview/app/git-history-panel.tsx
 * @description Module for git history panel.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { AppButton } from "../controls/button";
import { memo, type ReactNode, type UIEvent, useCallback, useRef } from "react";
import type { RpcGitHistoryEntry, RpcProject } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { formatGitHistoryTimestamp } from "./date-format";
import {
  GIT_HISTORY_ROW_HEIGHT_PX,
  isGitHistoryLoadMoreThresholdReached,
} from "./git-history-state";
import {
  toggleGitHistoryPanelOpen,
  useGitHistoryPanelOpen,
} from "./sidebar-panels-state";

const estimateGitHistoryRowSize = (): number => GIT_HISTORY_ROW_HEIGHT_PX;

type GitHistoryPanelProps = {
  activeSelectedWorktreeMissing: boolean;
  activeSelectedWorktreePath: string | null;
  filteredGitHistoryEntries: RpcGitHistoryEntry[];
  gitHistoryError: string;
  gitHistoryLoading: boolean;
  gitHistoryLoadingMore: boolean;
  onLoadMoreGitHistory: () => void;
  onOpenGitHistoryDiff: (entry: RpcGitHistoryEntry) => void;
  selectedProject: RpcProject | null;
};

const GIT_HISTORY_PANEL_TITLE_ID = "git-history-panel-title";
const GIT_HISTORY_PANEL_REGION_ID = "git-history-panel-region";

function GitHistoryVirtualRow({
  children,
  onClick,
  sizePx,
  startPx,
}: {
  children: ReactNode;
  onClick: () => void;
  sizePx: number;
  startPx: number;
}) {
  const className = useDynamicCssVariablesClassName(
    {
      "--git-history-row-height": `${sizePx}px`,
      "--git-history-row-y": `${startPx}px`,
    },
    {
      className:
        "git-history-row absolute left-0 top-0 w-full px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px]",
      prefix: "git-history-row-vars",
    },
  );

  return (
    <AppButton unstyled type="button" className={className} onClick={onClick}>
      {children}
    </AppButton>
  );
}

/**
 * Sidebar panel that renders project worktree git history in a virtualized list.
 * Includes progressive loading and lightweight diff preloading on interaction.
 */
export const GitHistoryPanel = memo(function GitHistoryPanel({
  activeSelectedWorktreeMissing,
  activeSelectedWorktreePath,
  filteredGitHistoryEntries,
  gitHistoryError,
  gitHistoryLoading,
  gitHistoryLoadingMore,
  onLoadMoreGitHistory,
  onOpenGitHistoryDiff,
  selectedProject,
}: GitHistoryPanelProps) {
  const gitHistoryOpen = useGitHistoryPanelOpen();
  const gitHistoryListRef = useRef<HTMLDivElement | null>(null);
  const getGitHistoryScrollElement = useCallback(
    () => gitHistoryListRef.current,
    [],
  );
  const gitHistoryVirtualizer = useVirtualizer({
    count: filteredGitHistoryEntries.length,
    getScrollElement: getGitHistoryScrollElement,
    estimateSize: estimateGitHistoryRowSize,
    overscan: 8,
  });
  const muteGitHistoryTitle =
    selectedProject !== null &&
    activeSelectedWorktreePath !== null &&
    activeSelectedWorktreeMissing;

  const handleGitHistoryScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (isGitHistoryLoadMoreThresholdReached(event.currentTarget)) {
        onLoadMoreGitHistory();
      }
    },
    [onLoadMoreGitHistory],
  );
  const gitHistoryVirtualHeightClassName = useDynamicCssVariablesClassName(
    {
      "--git-history-virtual-height": `${gitHistoryVirtualizer.getTotalSize()}px`,
    },
    {
      className: "git-history-virtual-height relative w-full",
      prefix: "git-history-virtual-height-vars",
    },
  );

  return (
    <section
      aria-labelledby={GIT_HISTORY_PANEL_TITLE_ID}
      className="select-none"
    >
      <SidebarSectionHeader
        controlsId={GIT_HISTORY_PANEL_REGION_ID}
        title={
          muteGitHistoryTitle ? (
            <span className="text-text-muted">Git History</span>
          ) : (
            "Git History"
          )
        }
        titleId={GIT_HISTORY_PANEL_TITLE_ID}
        open={gitHistoryOpen}
        onToggle={toggleGitHistoryPanelOpen}
      />
      {gitHistoryOpen ? (
        <section
          id={GIT_HISTORY_PANEL_REGION_ID}
          aria-labelledby={GIT_HISTORY_PANEL_TITLE_ID}
          className="mt-3 space-y-1.5"
        >
          {!selectedProject || !activeSelectedWorktreePath ? (
            <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
              Select a project worktree first.
            </div>
          ) : activeSelectedWorktreeMissing ? null : gitHistoryLoading ? (
            <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
              Loading git history...
            </div>
          ) : gitHistoryError && filteredGitHistoryEntries.length === 0 ? (
            <div className="bg-danger-surface px-3 py-2 text-xs text-danger-text">
              {gitHistoryError}
            </div>
          ) : filteredGitHistoryEntries.length > 0 ? (
            <div className="space-y-2">
              <div
                ref={gitHistoryListRef}
                className="max-h-64 overflow-y-auto pr-1"
                onScroll={handleGitHistoryScroll}
              >
                <div className={gitHistoryVirtualHeightClassName}>
                  {gitHistoryVirtualizer.getVirtualItems().map((virtualRow) => {
                    const entry = filteredGitHistoryEntries[virtualRow.index];
                    if (!entry) {
                      return null;
                    }
                    return (
                      <GitHistoryVirtualRow
                        key={entry.hash}
                        sizePx={virtualRow.size}
                        startPx={virtualRow.start}
                        onClick={() => {
                          // Open only the selected commit diff.
                          onOpenGitHistoryDiff(entry);
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center bg-surface-3 text-accent">
                            {materialSymbol("history", "text-[15px]")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-[14px] leading-4 text-text-primary"
                              title={entry.subject}
                            >
                              {entry.subject}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-text-muted">
                              {formatGitHistoryTimestamp(entry.committedAt)} · #
                              {entry.shortHash}
                            </div>
                          </div>
                        </div>
                      </GitHistoryVirtualRow>
                    );
                  })}
                </div>
              </div>
              {gitHistoryLoadingMore ? (
                <div className="px-1 text-[11px] text-text-muted">
                  Loading more commits...
                </div>
              ) : null}
              {gitHistoryError ? (
                <div className="bg-danger-surface px-3 py-2 text-[11px] text-danger-text">
                  {gitHistoryError}
                </div>
              ) : null}
            </div>
          ) : gitHistoryLoadingMore ? (
            <div className="bg-surface-2 px-3 py-2 text-xs text-text-secondary">
              Loading more git history...
            </div>
          ) : (
            <div className="bg-surface-1 px-3 py-2 text-xs text-text-muted">
              No commits found for this worktree yet.
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
});
