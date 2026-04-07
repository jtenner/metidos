/**
 * @file src/mainview/app/desktop-sidebar-content.tsx
 * @description Module for desktop sidebar content.
 */

import type { ComponentProps, JSX } from "react";
import { materialSymbol } from "../controls/icons";
import { GitHistoryPanel } from "./git-history-panel";
import { PinnedThreadsPanel } from "./pinned-threads-panel";
import { ProjectsPanel } from "./projects-panel";

type DesktopSidebarContentProps = {
  activeSidebarBranchLabel: string;
  collapseControl: JSX.Element | null;
  gitHistoryPanelKey: string;
  gitHistoryPanelProps: ComponentProps<typeof GitHistoryPanel>;
  pinnedThreadsPanelProps: ComponentProps<typeof PinnedThreadsPanel>;
  projectsPanelProps: ComponentProps<typeof ProjectsPanel>;
  selectedProjectName: string | null;
};

/**
 * Renders the desktop-only sidebar shell with project navigation, pinned threads, and git history.
 */
export function DesktopSidebarContent({
  activeSidebarBranchLabel,
  collapseControl,
  gitHistoryPanelKey,
  gitHistoryPanelProps,
  pinnedThreadsPanelProps,
  projectsPanelProps,
  selectedProjectName,
}: DesktopSidebarContentProps): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="select-none border border-[#232b30] bg-[#171b1d] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#1b2a34] text-[#7aa5c4] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            {materialSymbol("folder", "text-[18px]")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-5 text-[#f2f0ef]">
              {selectedProjectName ?? "No project selected"}
            </div>
            <div className="mt-0.5 truncate font-label text-[10px] font-semibold tracking-[0.16em] text-[#8ca6b9]">
              {activeSidebarBranchLabel}
            </div>
          </div>
          {collapseControl}
        </div>
      </div>

      <div className="select-none">
        <PinnedThreadsPanel {...pinnedThreadsPanelProps} />
        <hr className="mt-3 mb-3 w-full border-t border-[#232b30]" />
        <ProjectsPanel {...projectsPanelProps} />
        <hr className="mt-3 mb-3 w-full border-t border-[#232b30]" />
        <GitHistoryPanel key={gitHistoryPanelKey} {...gitHistoryPanelProps} />
      </div>
    </div>
  );
}
