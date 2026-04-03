import {
  memo,
  type UIEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RpcGitHistoryEntry, RpcProject } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { SidebarSectionHeader } from "../controls/sidebar-section-header";
import {
  toggleGitHistoryPanelOpen,
  useGitHistoryPanelOpen,
} from "./sidebar-panels-state";
import {
  clampNumber,
  formatGitHistoryTimestamp,
  GIT_HISTORY_DOM_WINDOW_SIZE,
  GIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
  GIT_HISTORY_RENDER_OVERSCAN_ROWS,
  GIT_HISTORY_ROW_HEIGHT_PX,
} from "./state";

type GitHistoryPanelProps = {
  activeSelectedWorktreePath: string | null;
  filteredGitHistoryEntries: RpcGitHistoryEntry[];
  gitHistoryError: string;
  gitHistoryLoading: boolean;
  gitHistoryLoadingMore: boolean;
  onCancelPreloadGitHistoryDiff: (entry: RpcGitHistoryEntry) => void;
  onLoadMoreGitHistory: () => void;
  onOpenGitHistoryDiff: (entry: RpcGitHistoryEntry) => void;
  onPreloadGitHistoryDiff: (entry: RpcGitHistoryEntry) => void;
  selectedProject: RpcProject | null;
};

/**
 * Sidebar panel that renders project worktree git history in a virtualized list.
 * Includes progressive loading and lightweight diff preloading on interaction.
 */
export const GitHistoryPanel = memo(function GitHistoryPanel({
  activeSelectedWorktreePath,
  filteredGitHistoryEntries,
  gitHistoryError,
  gitHistoryLoading,
  gitHistoryLoadingMore,
  onCancelPreloadGitHistoryDiff,
  onLoadMoreGitHistory,
  onOpenGitHistoryDiff,
  onPreloadGitHistoryDiff,
  selectedProject,
}: GitHistoryPanelProps) {
  const gitHistoryOpen = useGitHistoryPanelOpen();
  const [scrollTop, setScrollTop] = useState(0);
  const gitHistoryListRef = useRef<HTMLDivElement | null>(null);

  // Build a visible window over the full dataset to keep DOM size bounded.
  const visibleGitHistoryEntries = useMemo(() => {
    const totalEntries = filteredGitHistoryEntries.length;
    if (totalEntries === 0) {
      return {
        entries: [] as RpcGitHistoryEntry[],
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const windowSize = Math.min(GIT_HISTORY_DOM_WINDOW_SIZE, totalEntries);
    const maxStartIndex = Math.max(0, totalEntries - windowSize);
    const startIndex = clampNumber(
      Math.floor(scrollTop / GIT_HISTORY_ROW_HEIGHT_PX) -
        GIT_HISTORY_RENDER_OVERSCAN_ROWS,
      0,
      maxStartIndex,
    );
    const endIndex = Math.min(totalEntries, startIndex + windowSize);

    return {
      entries: filteredGitHistoryEntries.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * GIT_HISTORY_ROW_HEIGHT_PX,
      bottomSpacerHeight: (totalEntries - endIndex) * GIT_HISTORY_ROW_HEIGHT_PX,
    };
  }, [filteredGitHistoryEntries, scrollTop]);

  const handleGitHistoryScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const container = event.currentTarget;
      setScrollTop(container.scrollTop);

      // Trigger lazy load when near viewport end to prefetch next page.
      if (
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        GIT_HISTORY_LOAD_MORE_THRESHOLD_PX
      ) {
        onLoadMoreGitHistory();
      }
    },
    [onLoadMoreGitHistory],
  );

  return (
    <section className="select-none">
      <SidebarSectionHeader
        title="Git History"
        open={gitHistoryOpen}
        onToggle={toggleGitHistoryPanelOpen}
      />
      {gitHistoryOpen ? (
        <div className="mt-3 space-y-1.5">
          {!selectedProject || !activeSelectedWorktreePath ? (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              Select a project worktree first.
            </div>
          ) : gitHistoryLoading ? (
            <div className="bg-[#151b20] px-3 py-2.5 text-xs text-[#d4e4ef]">
              Loading git history...
            </div>
          ) : gitHistoryError && filteredGitHistoryEntries.length === 0 ? (
            <div className="bg-[#2c1117] px-3 py-2.5 text-xs text-[#ff9db0]">
              {gitHistoryError}
            </div>
          ) : filteredGitHistoryEntries.length > 0 ? (
            <div className="space-y-2">
              <div
                ref={gitHistoryListRef}
                className="max-h-64 overflow-y-auto pr-1 hide-scrollbar"
                onScroll={handleGitHistoryScroll}
              >
                {/* Top spacer pushes visible window down to match absolute index in full list. */}
                {visibleGitHistoryEntries.topSpacerHeight > 0 ? (
                  <div
                    aria-hidden="true"
                    style={{
                      height: `${visibleGitHistoryEntries.topSpacerHeight}px`,
                    }}
                  />
                ) : null}
                <div>
                  {visibleGitHistoryEntries.entries.map((entry) => (
                    <button
                      type="button"
                      key={entry.hash}
                      className="w-full px-3 py-2 text-left transition-colors hover:bg-[#171a1b]"
                      style={{ height: `${GIT_HISTORY_ROW_HEIGHT_PX}px` }}
                      onMouseEnter={() => {
                        // Prefetch diff while hovering/focusing to make open feel instant.
                        onPreloadGitHistoryDiff(entry);
                      }}
                      onFocus={() => {
                        onPreloadGitHistoryDiff(entry);
                      }}
                      onBlur={() => {
                        onCancelPreloadGitHistoryDiff(entry);
                      }}
                      onPointerDown={() => {
                        onPreloadGitHistoryDiff(entry);
                      }}
                      onMouseLeave={() => {
                        onCancelPreloadGitHistoryDiff(entry);
                      }}
                      onClick={() => {
                        // Open selected commit diff and keep it in view via persisted preload state.
                        onOpenGitHistoryDiff(entry);
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center bg-[#151a1c] text-[#8ca6b9]">
                          {materialSymbol("history", "text-[14px]")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-[14px] leading-4 text-[#f2f0ef]"
                            title={entry.subject}
                          >
                            {entry.subject}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-[#8f9aa2]">
                            {formatGitHistoryTimestamp(entry.committedAt)} · #
                            {entry.shortHash}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {/* Bottom spacer preserves total scroll height for non-rendered trailing items. */}
                {visibleGitHistoryEntries.bottomSpacerHeight > 0 ? (
                  <div
                    aria-hidden="true"
                    style={{
                      height: `${visibleGitHistoryEntries.bottomSpacerHeight}px`,
                    }}
                  />
                ) : null}
              </div>
              {gitHistoryLoadingMore ? (
                <div className="px-1 text-[11px] text-[#8f9aa2]">
                  Loading more commits...
                </div>
              ) : null}
              {gitHistoryError ? (
                <div className="bg-[#2c1117] px-3 py-2 text-[11px] text-[#ff9db0]">
                  {gitHistoryError}
                </div>
              ) : null}
            </div>
          ) : gitHistoryLoadingMore ? (
            <div className="bg-[#151b20] px-3 py-2.5 text-xs text-[#d4e4ef]">
              Loading more git history...
            </div>
          ) : (
            <div className="bg-[#151515] px-3 py-2.5 text-xs text-[#8f8d8b]">
              No commits found for this worktree yet.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
});
