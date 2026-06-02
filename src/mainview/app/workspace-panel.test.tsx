/**
 * @file src/mainview/app/workspace-panel.test.tsx
 * @description Tests for workspace sidebar panel empty, busy, and error states.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import { worktreeKey } from "./project-worktree-state";
import { WorkspacePanel } from "./workspace-panel";

const TEST_TIMESTAMP = "2026-06-02T16:00:00.000Z";

function makeThread(overrides: Partial<RpcThread> = {}): RpcThread {
  return {
    agentsAccess: false,
    compaction: {
      estimatedTriggerSource: "heuristic",
      estimatedTriggerTokens: 120000,
      inferredCount: 0,
      lastInferredAfterInputTokens: null,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      maxObservedInputTokens: null,
    },
    createdAt: TEST_TIMESTAMP,
    githubAccess: false,
    id: 1,
    lastRunAt: null,
    metidosAccess: false,
    model: "test-model",
    piLeafEntryId: null,
    piSessionFile: null,
    piSessionId: null,
    pinnedAt: null,
    projectId: 1,
    reasoningEffort: "medium",
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    summary: null,
    title: "Example thread",
    unsafeMode: false,
    updatedAt: TEST_TIMESTAMP,
    usage: null,
    webSearchAccess: false,
    worktreePath: "/tmp/demo-repo",
    ...overrides,
  };
}

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

  it("renders pinned and recent thread labels with selected, busy, and error indicators", () => {
    const project: RpcProject = {
      createdAt: TEST_TIMESTAMP,
      id: 1,
      isOpen: 1,
      lastOpenedAt: TEST_TIMESTAMP,
      name: "Demo Project",
      path: "/tmp/demo-repo",
      updatedAt: TEST_TIMESTAMP,
    };
    const worktree: RpcWorktree = {
      bare: false,
      branch: "feature/sidebar-tests",
      head: "abc1234",
      path: "/tmp/demo-repo",
      pinnedAt: null,
    };
    const pinnedThread = makeThread({
      id: 11,
      pinnedAt: TEST_TIMESTAMP,
      title: "Pinned design review",
    });
    const recentThread = makeThread({
      id: 12,
      runStatus: {
        error: "Provider timed out while streaming.",
        hasUnreadError: true,
        startedAt: TEST_TIMESTAMP,
        state: "failed",
        updatedAt: TEST_TIMESTAMP,
      },
      title: "Recent failing run",
    });

    const markup = renderWorkspacePanel({
      projectById: new Map([[project.id, project]]),
      selectedThreadId: pinnedThread.id,
      threadActivityIndicator: (threadId) =>
        threadId === pinnedThread.id ? "working" : "none",
      workspaceActiveThreads: [recentThread],
      workspacePinnedThreads: [pinnedThread],
      worktreeByProjectAndPath: new Map([
        [worktreeKey(project.id, worktree.path), worktree],
      ]),
      worktreeDisplayPathByKey: new Map([
        [worktreeKey(project.id, worktree.path), "demo-repo"],
      ]),
    });

    expect(markup).toContain("Pinned");
    expect(markup).toContain("Recent");
    expect(markup).toContain("Pinned design review");
    expect(markup).toContain("Recent failing run");
    expect(markup).toContain("Demo Project");
    expect(markup).toContain("feature/sidebar-tests");
    expect(markup).toContain("list-row-active-accent");
    expect(markup).toContain("Pinned design review Pinned. Working.");
    expect(markup).toContain("Recent failing run Unread error.");
    expect(markup).toContain("Unread");
  });
});
