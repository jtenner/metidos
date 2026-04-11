/**
 * @file src/mainview/app/state.test.ts
 * @description Test file for state.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import {
  buildProjectWorktreeIndex,
  createProjectStore,
  createThreadStore,
  partitionOrderedThreadsByPinnedState,
  projectStateWorktrees,
  projectStoreItems,
  threadStoreItems,
  upsertProjectStore,
  upsertThreadStore,
} from "./state";

/**
 * Builds a project fixture.
 * @param id - Identifier value.
 * @param name - Display or identifier name.
 */

function project(id: number, name: string): RpcProject {
  return {
    createdAt: "2026-04-04T00:00:00.000Z",
    id,
    isOpen: 1,
    lastOpenedAt: "2026-04-04T00:00:00.000Z",
    name,
    path: `/repos/${name.toLowerCase()}`,
    updatedAt: "2026-04-04T00:00:00.000Z",
  };
}
/**
 * Builds a thread fixture.
 * @param id - Identifier value.
 * @param updatedAt - updatedAt argument for thread.
 * @param pinnedAt - pinnedAt argument for thread.
 */

function thread(
  id: number,
  updatedAt: string,
  pinnedAt: string | null = null,
): RpcThread {
  return {
    id,
    pinnedAt,
    updatedAt,
  } as unknown as RpcThread;
}
/**
 * Builds a worktree fixture.
 * @param path - Filesystem path.
 */

function worktree(path: string): RpcWorktree {
  return {
    bare: false,
    branch: "main",
    head: "abc123",
    path,
    pinnedAt: null,
  };
}

describe("project store helpers", () => {
  it("keeps projects sorted by name while replacing entries incrementally", () => {
    const initialStore = createProjectStore([
      project(2, "Beta"),
      project(1, "Alpha"),
    ]);

    expect(projectStoreItems(initialStore).map((entry) => entry.id)).toEqual([
      1, 2,
    ]);

    const nextStore = upsertProjectStore(initialStore, project(3, "Aardvark"));

    expect(projectStoreItems(nextStore).map((entry) => entry.id)).toEqual([
      3, 1, 2,
    ]);
  });
});

describe("thread store helpers", () => {
  it("keeps recency ordering without rebuilding from arrays", () => {
    const initialStore = createThreadStore([
      thread(1, "2026-04-04T12:00:00.000Z"),
      thread(2, "2026-04-04T11:00:00.000Z"),
    ]);

    const nextStore = upsertThreadStore(
      initialStore,
      thread(3, "2026-04-04T11:30:00.000Z"),
    );

    expect(threadStoreItems(nextStore).map((entry) => entry.id)).toEqual([
      1, 3, 2,
    ]);
  });

  it("moves updated pinned threads into the correct sorted position", () => {
    const initialStore = createThreadStore([
      thread(1, "2026-04-04T12:00:00.000Z", "2026-04-04T12:15:00.000Z"),
      thread(2, "2026-04-04T11:00:00.000Z"),
      thread(3, "2026-04-04T10:00:00.000Z"),
    ]);

    const nextStore = upsertThreadStore(
      initialStore,
      thread(3, "2026-04-04T10:00:00.000Z", "2026-04-04T12:20:00.000Z"),
    );

    expect(threadStoreItems(nextStore).map((entry) => entry.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it("partitions already ordered thread-store rows without resorting them", () => {
    const orderedThreads = threadStoreItems(
      createThreadStore([
        thread(2, "2026-04-04T11:00:00.000Z"),
        thread(1, "2026-04-04T12:00:00.000Z", "2026-04-04T12:15:00.000Z"),
        thread(3, "2026-04-04T10:00:00.000Z", "2026-04-04T12:10:00.000Z"),
        thread(4, "2026-04-04T09:00:00.000Z"),
      ]),
    );

    expect(orderedThreads.map((entry) => entry.id)).toEqual([1, 3, 2, 4]);

    const { activeThreads, pinnedThreads } =
      partitionOrderedThreadsByPinnedState(orderedThreads);

    expect(pinnedThreads.map((entry) => entry.id)).toEqual([1, 3]);
    expect(activeThreads.map((entry) => entry.id)).toEqual([2, 4]);
  });
});

describe("project worktree index helpers", () => {
  it("materializes indexed worktree state back into ordered worktree arrays", () => {
    const state = buildProjectWorktreeIndex([
      worktree("/repos/example"),
      worktree("/repos/example/feature"),
    ]);

    expect(projectStateWorktrees(state).map((entry) => entry.path)).toEqual([
      "/repos/example",
      "/repos/example/feature",
    ]);
  });
});
