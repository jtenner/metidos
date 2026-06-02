/**
 * @file src/mainview/app/workspace-panel.test.tsx
 * @description Tests for workspace sidebar panel empty, busy, and error states.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspacePanel } from "./workspace-panel";

function renderWorkspacePanel(
  overrides: Partial<Parameters<typeof WorkspacePanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    <WorkspacePanel
      acknowledgeThreadErrorSeenInBackground={() => undefined}
      activeSelectedWorktreeBranch="main"
      activeSelectedWorktreeFolder="demo-repo"
      canCreateThread={false}
      clearCompletedThreadIndicator={() => undefined}
      dismissThreadStatus={() => undefined}
      isCreatingThread={false}
      isThreadStatusDismissed={() => false}
      onCreateThread={() => undefined}
      onOpenThread={() => undefined}
      onOpenThreadActionMenu={() => undefined}
      projectById={new Map()}
      selectedProjectNameForThread="No project selected"
      selectedThreadId={null}
      sidebarActionButtonClass="action"
      threadActivityIndicator={() => "none"}
      threadPreviewsDisabled
      threadsError=""
      workspaceActiveThreads={[]}
      workspacePinnedThreads={[]}
      worktreeByProjectAndPath={new Map()}
      worktreeDisplayPathByKey={new Map()}
      {...overrides}
    />,
  );
}

describe("workspace panel", () => {
  it("renders a contributor-friendly empty state when no workspace threads exist", () => {
    const markup = renderWorkspacePanel();

    expect(markup).toContain("Threads");
    expect(markup).toContain("No pinned or recent threads yet.");
    expect(markup).toContain(
      'aria-label="Select a project and worktree first"',
    );
    expect(markup).toContain('aria-disabled="true"');
  });

  it("keeps create-thread busy state separate from backend thread list errors", () => {
    const markup = renderWorkspacePanel({
      canCreateThread: true,
      isCreatingThread: true,
      threadsError: "Thread list could not refresh. Retry from the sidebar.",
    });

    expect(markup).toContain(
      'aria-label="Create thread for selected worktree"',
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(
      "Thread list could not refresh. Retry from the sidebar.",
    );
  });
});
