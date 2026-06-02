/**
 * @file src/mainview/app/git-history-panel.test.tsx
 * @description Focused presentation tests for git history sidebar panel states.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { RpcGitHistoryEntry, RpcProject } from "../../bun/rpc-schema";
import { GitHistoryPanel } from "./git-history-panel";

const selectedProject: RpcProject = {
  id: 7,
  path: "/tmp/metidos-demo",
} as RpcProject;

function entry(overrides?: Partial<RpcGitHistoryEntry>): RpcGitHistoryEntry {
  return {
    authorName: "Alice Example",
    committedAt: "2026-05-05T14:30:00.000Z",
    hash: "abcdef1234567890",
    shortHash: "abcdef1",
    subject: "Improve demo docs",
    ...overrides,
  };
}

function renderPanel(
  overrides?: Partial<Parameters<typeof GitHistoryPanel>[0]>,
): string {
  return renderToStaticMarkup(
    <GitHistoryPanel
      activeSelectedWorktreeMissing={false}
      activeSelectedWorktreePath="/tmp/metidos-demo"
      filteredGitHistoryEntries={[]}
      gitHistoryError=""
      gitHistoryLoading={false}
      gitHistoryLoadingMore={false}
      onLoadMoreGitHistory={() => undefined}
      onOpenGitHistoryDiff={() => undefined}
      selectedProject={selectedProject}
      {...overrides}
    />,
  );
}

describe("GitHistoryPanel presentation states", () => {
  it("renders loading, empty, and selection guidance states", () => {
    expect(renderPanel({ gitHistoryLoading: true })).toContain(
      "Loading git history...",
    );

    expect(renderPanel()).toContain("No commits found for this worktree yet.");

    expect(
      renderPanel({
        activeSelectedWorktreePath: null,
        selectedProject: selectedProject,
      }),
    ).toContain("Select a project worktree first.");
  });

  it("renders initial and paginated failure states", () => {
    expect(
      renderPanel({ gitHistoryError: "Unable to read history." }),
    ).toContain("Unable to read history.");

    const paginatedFailureMarkup = renderPanel({
      filteredGitHistoryEntries: [entry()],
      gitHistoryError: "Unable to load more commits.",
    });

    expect(paginatedFailureMarkup).toContain("Unable to load more commits.");
    expect(paginatedFailureMarkup).not.toContain(
      "No commits found for this worktree yet.",
    );
  });

  it("renders pagination feedback without hiding existing entries", () => {
    const markup = renderPanel({
      filteredGitHistoryEntries: [entry({ subject: "Keep fake data safe" })],
      gitHistoryLoadingMore: true,
    });

    expect(markup).toContain("Loading more commits...");
    expect(markup).not.toContain("Loading more git history...");
  });
});
