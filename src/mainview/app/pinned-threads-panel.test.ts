/**
 * @file src/mainview/app/pinned-threads-panel.test.ts
 * @description Test file for pinned threads panel.
 */

import { describe, expect, it } from "bun:test";
import { type ComponentProps, createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

import type { RpcThread } from "../../bun/rpc-schema";
import {
  deriveVisibleDesktopRecentThreads,
  PinnedThreadsPanel,
} from "./pinned-threads-panel";
import { APP_TITLE } from "./state";

function createThread(id: number, updatedAt: string): RpcThread {
  return {
    id,
    projectId: 7,
    worktreePath: `/repos/example-${id}`,
    title: `Thread ${id}`,
    summary: null,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    webSearchAccess: true,
    githubAccess: false,
    agentsAccess: false,
    metidosAccess: true,
    unsafeMode: false,
    piSessionId: null,
    piSessionFile: null,
    piLeafEntryId: null,
    pinnedAt: null,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt,
    lastRunAt: null,
    usage: null,
    compaction: {
      estimatedTriggerTokens: 0,
      estimatedTriggerSource: "heuristic",
      maxObservedInputTokens: null,
      inferredCount: 0,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      lastInferredAfterInputTokens: null,
    },
    runStatus: {
      state: "idle",
      startedAt: null,
      updatedAt,
      error: null,
      hasUnreadError: false,
    },
  };
}

describe("deriveVisibleDesktopRecentThreads", () => {
  it("limits desktop recent threads to the five newest entries", () => {
    const threads = [
      createThread(6, "2026-04-04T06:00:00.000Z"),
      createThread(2, "2026-04-04T10:00:00.000Z"),
      createThread(4, "2026-04-04T08:00:00.000Z"),
      createThread(1, "2026-04-04T11:00:00.000Z"),
      createThread(5, "2026-04-04T07:00:00.000Z"),
      createThread(3, "2026-04-04T09:00:00.000Z"),
    ];

    expect(
      deriveVisibleDesktopRecentThreads(threads).map((thread) => thread.id),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});

async function renderPinnedThreadsPanel(
  props: Partial<ComponentProps<typeof PinnedThreadsPanel>> = {},
): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(PinnedThreadsPanel, {
      acknowledgeThreadErrorSeenInBackground: () => {},
      canCreateThread: false,
      clearCompletedThreadIndicator: () => {},
      dismissThreadStatus: () => {},
      isCreatingThread: false,
      isThreadStatusDismissed: () => false,
      onCreateThread: () => {},
      onOpenThread: () => {},
      onOpenThreadActionMenu: () => {},
      pinnedThreads: [],
      projectById: new Map(),
      recentThreads: [],
      selectedThreadId: null,
      sidebarActionButtonClass: "thread-action",
      threadActivityIndicator: (): "none" => "none",
      threadPreviewsDisabled: false,
      threadsError: "",
      worktreeDisplayPathByKey: new Map(),
      worktreeByProjectAndPath: new Map(),
      ...props,
    }),
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("PinnedThreadsPanel", () => {
  it("renders an enabled create button when the selected worktree can start a thread", async () => {
    const markup = await renderPinnedThreadsPanel({
      canCreateThread: true,
    });

    expect(markup).toContain(
      'aria-label="Create thread for selected worktree"',
    );
    expect(markup).toContain(
      `title="Start a new ${APP_TITLE} thread for the selected worktree"`,
    );
    expect(markup).not.toContain('disabled=""');
  });

  it("disables the create button when no sidebar project/worktree is active", async () => {
    const markup = await renderPinnedThreadsPanel({
      canCreateThread: false,
    });

    expect(markup).toContain(
      'aria-label="Select a project and worktree first"',
    );
    expect(markup).toContain('title="Select a project and worktree first"');
    expect(markup).toContain('disabled=""');
  });
});
