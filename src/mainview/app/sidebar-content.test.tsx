/**
 * @file src/mainview/app/sidebar-content.test.tsx
 * @description Tests for desktop and mobile sidebar navigation affordances.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { RpcProject } from "../../bun/rpc-schema";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopSidebarContent } from "./desktop-sidebar-content";
import { SidebarContent } from "./sidebar-content";

const TEST_TIMESTAMP = "2026-06-02T16:00:00.000Z";

const project: RpcProject = {
  createdAt: TEST_TIMESTAMP,
  id: 1,
  isOpen: 1,
  lastOpenedAt: TEST_TIMESTAMP,
  name: "Demo Project",
  path: "/tmp/demo-repo",
  updatedAt: TEST_TIMESTAMP,
};

function noop(): void {
  // Test callback placeholder.
}

function sharedThreadListProps() {
  return {
    acknowledgeThreadErrorSeenInBackground: noop,
    clearCompletedThreadIndicator: noop,
    dismissThreadStatus: noop,
    isThreadStatusDismissed: () => false,
    normalizedSidebarSearchQuery: "",
    onOpenThread: noop,
    onOpenThreadActionMenu: noop,
    pinnedThreads: [],
    projectById: new Map([[project.id, project]]),
    recentThreads: [],
    selectedThreadId: null,
    threadActivityIndicator: () => "none" as const,
    threadPreviewsDisabled: true,
    threadsError: "",
    worktreeByProjectAndPath: new Map(),
    worktreeDisplayPathByKey: new Map(),
  };
}

function sharedGitHistoryProps() {
  return {
    activeSelectedWorktreeMissing: false,
    activeSelectedWorktreePath: "/tmp/demo-repo",
    filteredGitHistoryEntries: [],
    gitHistoryError: "",
    gitHistoryLoading: false,
    gitHistoryLoadingMore: false,
    onLoadMoreGitHistory: noop,
    onOpenGitHistoryDiff: noop,
    selectedProject: project,
  };
}

function sharedPinnedFolderProps() {
  return {
    activeProjectId: project.id,
    activeWorktreePath: "/tmp/demo-repo",
    normalizedSidebarSearchQuery: "",
    onOpenFolder: noop,
    pinnedFolders: [],
  };
}

function renderMobileSidebarContent(): string {
  return renderToStaticMarkup(
    <SidebarContent
      activeSidebarBranchLabel="main"
      activeWorktreePinDisabled={false}
      activeWorktreePinned={false}
      collapseControl={<button type="button">Close sidebar</button>}
      folderSelectorControl={null}
      folderSelectorOpen={false}
      gitHistoryPanelKey="git-history"
      gitHistoryPanelProps={sharedGitHistoryProps()}
      isCreatingThread={false}
      isCreatingWorkspace={false}
      newWorkspaceError=""
      newWorkspaceName=""
      newWorkspaceOpen={false}
      onCloseNewWorkspace={noop}
      onCreateThread={noop}
      onNewWorkspaceNameChange={noop}
      onSidebarSearchQueryChange={noop}
      onSubmitNewWorkspace={(event) => event.preventDefault()}
      onToggleActiveWorktreePinned={noop}
      onToggleFolderSelector={noop}
      onToggleNewWorkspace={noop}
      pinnedFoldersPanelProps={sharedPinnedFolderProps()}
      pinnedThreadsPanelProps={sharedThreadListProps()}
      selectedProjectName={project.name}
      sidebarSearchQuery=""
      workspaceActionDisabled={false}
    />,
  );
}

function renderDesktopSidebarContent(): string {
  return renderToStaticMarkup(
    <DesktopSidebarContent
      activeSidebarBranchLabel="main"
      activeWorktreePinDisabled={false}
      activeWorktreePinned={false}
      collapseControl={<button type="button">Collapse sidebar</button>}
      folderSelectorControl={null}
      folderSelectorOpen={false}
      gitHistoryPanelKey="git-history"
      isCreatingThread={false}
      isCreatingWorkspace={false}
      newWorkspaceError=""
      newWorkspaceName=""
      newWorkspaceOpen={false}
      onCloseNewWorkspace={noop}
      onCreateTerminal={noop}
      onCreateThread={noop}
      onNewWorkspaceNameChange={noop}
      onSidebarSearchQueryChange={noop}
      onSubmitNewWorkspace={(event) => event.preventDefault()}
      onToggleActiveWorktreePinned={noop}
      onToggleFolderSelector={noop}
      onToggleNewWorkspace={noop}
      selectedProjectName={project.name}
      sidebarSearchQuery=""
      terminalAccessAllowed
      {...sharedGitHistoryProps()}
      {...sharedPinnedFolderProps()}
      {...sharedThreadListProps()}
    />,
  );
}

describe("sidebar content navigation affordances", () => {
  it("exposes critical mobile/sidebar drawer navigation labels", () => {
    const markup = renderMobileSidebarContent();

    expect(markup).toContain("Demo Project");
    expect(markup).toContain("main");
    expect(markup).toContain('aria-label="Open folder picker"');
    expect(markup).toContain('aria-label="Pin active folder"');
    expect(markup).toContain('aria-label="New Worktree"');
    expect(markup).toContain('aria-label="New thread"');
    expect(markup).toContain("Close sidebar");
    expect(markup).toContain('aria-label="Search projects and worktrees"');
    expect(markup).toContain("Folders");
    expect(markup).toContain("Threads");
    expect(markup).toContain("Git History");
  });

  it("exposes the same critical desktop sidebar navigation labels", () => {
    const markup = renderDesktopSidebarContent();

    expect(markup).toContain("Demo Project");
    expect(markup).toContain("main");
    expect(markup).toContain('aria-label="Open folder picker"');
    expect(markup).toContain('aria-label="Pin active folder"');
    expect(markup).toContain('aria-label="New Worktree"');
    expect(markup).toContain('aria-label="New thread"');
    expect(markup).toContain('aria-label="New terminal"');
    expect(markup).toContain("Collapse sidebar");
    expect(markup).toContain('aria-label="Search projects and worktrees"');
    expect(markup).toContain("Folders");
    expect(markup).toContain("Threads");
    expect(markup).toContain("Git History");
  });

  it("keeps collapsed desktop rail expansion controls discoverable", () => {
    const markup = renderToStaticMarkup(
      <DesktopSidebar
        initialCollapsed
        onCollapsedChange={noop}
        renderExpandedContent={() => <div>Expanded sidebar content</div>}
      />,
    );

    expect(markup).toContain('aria-label="Expand sidebar"');
    expect(markup).toContain('aria-label="Expand sidebar — Threads"');
    expect(markup).toContain('aria-label="Expand sidebar — Git History"');
  });
});
