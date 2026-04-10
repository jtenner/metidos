/**
 * @file src/mainview/app/desktop-thread-switcher.test.ts
 * @description Test file for desktop thread switcher.
 */

import { describe, expect, it } from "bun:test";

import type { RpcThread } from "../../bun/rpc-schema";
import { deriveDesktopThreadSwitcherSections } from "./desktop-thread-switcher";

function createThread(
  id: number,
  title: string,
  summary: string | null,
  updatedAt: string,
  pinnedAt: string | null,
): RpcThread {
  return {
    id,
    projectId: 7,
    worktreePath: "/repos/example",
    title,
    summary,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    githubAccess: false,
    agentsAccess: false,
    metidosAccess: true,
    unsafeMode: false,
    piSessionId: null,
    piSessionFile: null,
    piLeafEntryId: null,
    pinnedAt,
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

describe("deriveDesktopThreadSwitcherSections", () => {
  it("partitions matching worktree threads into pinned and recent groups", () => {
    const sections = deriveDesktopThreadSwitcherSections(
      [
        createThread(
          1,
          "Pinned thread",
          "important",
          "2026-04-04T10:00:00.000Z",
          "2026-04-04T10:30:00.000Z",
        ),
        createThread(
          2,
          "Newest recent",
          "summary",
          "2026-04-04T11:00:00.000Z",
          null,
        ),
        createThread(
          3,
          "Older recent",
          "summary",
          "2026-04-04T09:00:00.000Z",
          null,
        ),
      ],
      "",
    );

    expect(sections.pinnedThreads.map((thread) => thread.id)).toEqual([1]);
    expect(sections.recentThreads.map((thread) => thread.id)).toEqual([2, 3]);
  });

  it("matches thread search against title and summary", () => {
    const threads = [
      createThread(
        1,
        "Refactor sidebar shell",
        "desktop only",
        "2026-04-04T10:00:00.000Z",
        null,
      ),
      createThread(
        2,
        "Investigate layout",
        "popover search regression",
        "2026-04-04T09:00:00.000Z",
        null,
      ),
    ];

    expect(
      deriveDesktopThreadSwitcherSections(threads, "sidebar").recentThreads.map(
        (thread) => thread.id,
      ),
    ).toEqual([1]);
    expect(
      deriveDesktopThreadSwitcherSections(
        threads,
        "regression",
      ).recentThreads.map((thread) => thread.id),
    ).toEqual([2]);
  });

  it("keeps pinned matches ahead of recent matches when both satisfy the search", () => {
    const sections = deriveDesktopThreadSwitcherSections(
      [
        createThread(
          1,
          "Fix desktop thread switcher",
          "follow-up",
          "2026-04-04T08:00:00.000Z",
          "2026-04-04T12:00:00.000Z",
        ),
        createThread(
          2,
          "Thread switcher polish",
          "follow-up",
          "2026-04-04T11:00:00.000Z",
          null,
        ),
      ],
      "thread switcher",
    );

    expect(sections.pinnedThreads.map((thread) => thread.id)).toEqual([1]);
    expect(sections.recentThreads.map((thread) => thread.id)).toEqual([2]);
  });
});
