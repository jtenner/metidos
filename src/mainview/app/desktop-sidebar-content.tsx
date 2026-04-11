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
      <div className="select-none border border-border-subtle bg-surface-1 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-surface-2 text-accent-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            {materialSymbol("folder", "text-[18px]")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-5 text-text-primary">
              {selectedProjectName ?? "No project selected"}
            </div>
            <div className="mt-0.5 truncate font-label text-[10px] font-semibold tracking-widest text-accent">
              {activeSidebarBranchLabel}
            </div>
          </div>
          {collapseControl}
        </div>
      </div>

      <div className="select-none">
        <PinnedThreadsPanel {...pinnedThreadsPanelProps} />
        <hr className="mt-3 mb-3 w-full border-t border-border-subtle" />
        <ProjectsPanel {...projectsPanelProps} />
        <hr className="mt-3 mb-3 w-full border-t border-border-subtle" />
        <GitHistoryPanel key={gitHistoryPanelKey} {...gitHistoryPanelProps} />
      </div>
    </div>
  );
}
