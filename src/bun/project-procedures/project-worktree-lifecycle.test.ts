/**
 * @file src/bun/project-procedures/project-worktree-lifecycle.test.ts
 * @description Workflow-oriented tests for the focused Project/Worktree lifecycle module.
 */

import { describe, expect, it } from "bun:test";

import type { ProjectRecord } from "../project-store";
import type { RpcWorktree, RpcWorktreeSnapshot } from "../rpc-schema";
import { projectWorktreeLifecycle } from "./project-worktree-lifecycle";

function worktree(path: string): RpcWorktree {
  return {
    path,
    bare: false,
    branch: null,
    head: null,
    pinnedAt: null,
  };
}

function project(input?: Partial<ProjectRecord>): ProjectRecord {
  return {
    createdAt: "2026-05-10T18:00:00.000Z",
    gitRemote: null,
    id: 9,
    isOpen: 1,
    lastOpenedAt: "2026-05-10T18:00:00.000Z",
    name: "Repo",
    path: "/repo",
    updatedAt: "2026-05-10T18:00:00.000Z",
    ...input,
  };
}

function snapshot(input?: Partial<RpcWorktreeSnapshot>): RpcWorktreeSnapshot {
  return {
    changes: [],
    diff: [],
    files: ["README.md"],
    lastUpdatedAt: "2026-05-10T18:02:00.000Z",
    path: "/repo",
    ...input,
  };
}

describe("projectWorktreeLifecycle", () => {
  it("opens a worktree by loading history and snapshot behind one workflow seam", async () => {
    const state = projectWorktreeLifecycle.createPollState(project(), [
      worktree("/repo"),
    ]);
    let limited = false;
    let synced = false;
    let warmedPath = "";

    const opened = await projectWorktreeLifecycle.openWorktree({
      project: state.project,
      queueHistoryWarmup: (worktreeState) => {
        warmedPath = worktreeState.history.worktreePath;
      },
      readAndStoreSnapshot: async () => snapshot(),
      readGitHistoryFirstPage: async () => ({
        history: {
          entries: [
            {
              authorName: "Alice",
              committedAt: "2026-05-10T18:01:00.000Z",
              hash: "abcdef123456",
              shortHash: "abcdef1",
              subject: "Initial",
            },
          ],
          branch: "main",
          headHash: "abcdef123456",
          headShortHash: "abcdef1",
          lastUpdatedAt: "2026-05-10T18:01:00.000Z",
          limit: 50,
          nextOffset: null,
          projectId: 9,
          worktreePath: "/repo",
        },
        signature: "sig-1",
        summary: {
          branch: "main",
          headHash: "abcdef123456",
          headShortHash: "abcdef1",
          lastUpdatedAt: "2026-05-10T18:01:00.000Z",
          projectId: 9,
          worktreePath: "/repo",
        },
      }),
      runWorktreeOpenLimited: async (callback) => {
        limited = true;
        return callback();
      },
      state,
      syncBackgroundPolling: () => {
        synced = true;
      },
      worktreePath: "/repo",
      worktrees: state.worktrees,
    });

    expect(limited).toBe(true);
    expect(synced).toBe(true);
    expect(warmedPath).toBe("/repo");
    expect(opened.worktree.files).toEqual(["README.md"]);
    expect(state.openWorktrees.get("/repo")?.historySignature).toBe("sig-1");
    expect(state.openWorktrees.get("/repo")?.historyEntries).toHaveLength(1);
  });

  it("applies refreshed listings and stops polling for worktrees that disappeared", () => {
    const state = projectWorktreeLifecycle.createPollState(project(), [
      worktree("/repo"),
      worktree("/repo-feature"),
    ]);
    state.activeWorktreePath = "/repo-feature";
    projectWorktreeLifecycle.ensureWorktreePollState(
      state,
      "/repo-feature",
      "2026-05-10T18:02:00.000Z",
    );
    const stopped: string[] = [];

    projectWorktreeLifecycle.applyRefreshedListingToPollState(
      state,
      [worktree("/repo")],
      (worktreePath) => stopped.push(worktreePath),
    );

    expect(stopped).toEqual(["/repo-feature"]);
    expect(state.activeWorktreePath).toBeNull();
    expect(state.worktrees.map((entry) => entry.path)).toEqual(["/repo"]);
  });
});
