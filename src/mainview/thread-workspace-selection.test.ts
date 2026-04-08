/**
 * @file src/mainview/thread-workspace-selection.test.ts
 * @description Test file for thread-driven workspace selection helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcThread } from "../bun/rpc-schema";
import {
  derivePrimaryViewForPinnedThreadOpen,
  deriveSelectedThreadWorkspaceTarget,
} from "./thread-workspace-selection";

function project(overrides?: Partial<RpcProject>): RpcProject {
  return {
    createdAt: "2026-04-08T00:00:00.000Z",
    id: 1,
    isOpen: 0,
    lastOpenedAt: "2026-04-08T00:00:00.000Z",
    name: "starshine-mb",
    path: "/repo",
    updatedAt: "2026-04-08T00:00:00.000Z",
    ...overrides,
  };
}

function thread(overrides?: Partial<RpcThread>): RpcThread {
  return {
    agentsAccess: false,
    codexThreadId: null,
    compaction: {
      estimatedTriggerSource: "heuristic",
      estimatedTriggerTokens: 120_000,
      inferredCount: 0,
      lastInferredAfterInputTokens: null,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      maxObservedInputTokens: null,
    },
    createdAt: "2026-04-08T00:00:00.000Z",
    githubAccess: false,
    id: 7,
    joltAccess: true,
    lastRunAt: null,
    model: "gpt-5.4",
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
    summary: "summary",
    title: "Pinned thread",
    unsafeMode: false,
    updatedAt: "2026-04-08T00:00:00.000Z",
    usage: null,
    worktreePath: "/repo/feature",
    ...overrides,
  };
}

describe("deriveSelectedThreadWorkspaceTarget", () => {
  it("returns the thread workspace target even when the project is still closed", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project({ isOpen: 0 }),
        selectedThread: thread(),
        sessionStateReady: true,
      }),
    ).toEqual({
      projectId: 1,
      projectName: "starshine-mb",
      projectOpen: false,
      projectPath: "/repo",
      threadId: 7,
      worktreePath: "/repo/feature",
    });
  });

  it("returns null when the active worktree does not match the selected thread", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/main",
        selectedProject: project({ isOpen: 1 }),
        selectedThread: thread(),
        sessionStateReady: true,
      }),
    ).toBeNull();
  });

  it("returns null when the selected project does not own the selected thread", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project({ id: 2, isOpen: 1 }),
        selectedThread: thread(),
        sessionStateReady: true,
      }),
    ).toBeNull();
  });

  it("returns null until session state is ready", () => {
    expect(
      deriveSelectedThreadWorkspaceTarget({
        activeSelectedWorktreePath: "/repo/feature",
        selectedProject: project({ isOpen: 1 }),
        selectedThread: thread(),
        sessionStateReady: false,
      }),
    ).toBeNull();
  });
});

describe("derivePrimaryViewForPinnedThreadOpen", () => {
  it("returns chat when the current workspace view is diff", () => {
    expect(derivePrimaryViewForPinnedThreadOpen("diff")).toBe("chat");
  });

  it("returns chat when the current workspace view is cronjobs", () => {
    expect(derivePrimaryViewForPinnedThreadOpen("cronjobs")).toBe("chat");
  });

  it("keeps chat selected when the workspace is already on chat", () => {
    expect(derivePrimaryViewForPinnedThreadOpen("chat")).toBe("chat");
  });
});
