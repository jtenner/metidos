import type { ComponentProps, JSX } from "react";
import { materialSymbol } from "../controls/icons";
import { SidebarSearchControl } from "../controls/sidebar-search-control";
import { GitHistoryPanel } from "./git-history-panel";
import { ProjectsPanel } from "./projects-panel";
import { SecurityAuditPanel } from "./security-audit-panel";
import { WorkspacePanel } from "./workspace-panel";

type SidebarContentProps = {
  activeSidebarBranchLabel: string;
  collapseControl: JSX.Element | null;
  gitHistoryPanelKey: string;
  gitHistoryPanelProps: ComponentProps<typeof GitHistoryPanel>;
  onSidebarSearchQueryChange: (value: string) => void;
  projectsPanelProps: ComponentProps<typeof ProjectsPanel>;
  securityAuditPanelProps: ComponentProps<typeof SecurityAuditPanel>;
  selectedProjectName: string | null;
  sidebarSearchQuery: string;
  workspacePanelProps: ComponentProps<typeof WorkspacePanel>;
};

/**
 * Renders the sidebar header plus sectioned content for workspace, projects, and git history.
 */
export function SidebarContent({
  activeSidebarBranchLabel,
  collapseControl,
  gitHistoryPanelKey,
  gitHistoryPanelProps,
  onSidebarSearchQueryChange,
  projectsPanelProps,
  securityAuditPanelProps,
  selectedProjectName,
  sidebarSearchQuery,
  workspacePanelProps,
}: SidebarContentProps): JSX.Element {
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
        <div className="mt-3">
          <SidebarSearchControl
            value={sidebarSearchQuery}
            onChange={(event) => {
              // Keep search query state in parent to drive filtering across all sidebar sections.
              onSidebarSearchQueryChange(event.currentTarget.value);
            }}
            onClear={() => {
              // Clearing search resets query for every filtered project/worktree/git list.
              onSidebarSearchQueryChange("");
            }}
          />
        </div>
      </div>

      <div className="select-none space-y-5">
        {/* Main panel stack: workspace context first, then worktrees/projects, then history. */}
        <WorkspacePanel {...workspacePanelProps} />
        <ProjectsPanel {...projectsPanelProps} />
        <GitHistoryPanel key={gitHistoryPanelKey} {...gitHistoryPanelProps} />
        <SecurityAuditPanel {...securityAuditPanelProps} />
      </div>
    </div>
  );
}
