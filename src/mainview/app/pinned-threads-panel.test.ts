/**
 * @file src/mainview/app/pinned-threads-panel.test.ts
 * @description Test file for pinned threads panel.
 */

import { describe, expect, it } from "bun:test";

import type { RpcThread } from "../../bun/rpc-schema";
import { deriveVisibleDesktopRecentThreads } from "./pinned-threads-panel";

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
