/**
 * @file src/mainview/app/thread-store.test.ts
 * @description Tests for focused Thread store, ordering, and error-preview helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcProject, RpcThread } from "../../bun/rpc-schema";
import { createProjectStore } from "./project-store";
import {
  createThreadStore,
  latestThreadForWorktree,
  partitionOrderedThreadsByPinnedState,
  pinnedThreadForWorktree,
  pruneThreadStore,
  shouldAcceptThreadStoreUpdate,
  threadListUpdatedAt,
  threadStoreItems,
  threadStoresEquivalent,
  threadsEquivalent,
  upsertThreadList,
  upsertThreadStore,
} from "./thread-store";

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

function thread(
  id: number,
  updatedAt: string,
  pinnedAt: string | null = null,
  overrides?: Partial<Omit<RpcThread, "runStatus">> & {
    runStatus?: Partial<RpcThread["runStatus"]>;
  },
): RpcThread {
  const { runStatus: runStatusOverride, ...threadOverrides } = overrides ?? {};
  return {
    id,
    model: `model-${id}`,
    pinnedAt,
    projectId: 1,
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt,
      ...runStatusOverride,
    },
    updatedAt,
    worktreePath: "/repos/alpha",
    ...threadOverrides,
  } as unknown as RpcThread;
}

describe("thread store helpers", () => {
  it("merges freshly opened threads into recency-ordered lists", () => {
    const orderedThreads = [
      thread(2, "2026-04-04T11:00:00.000Z"),
      thread(1, "2026-04-04T10:00:00.000Z"),
    ];

    const nextThreads = upsertThreadList(
      orderedThreads,
      thread(3, "2026-04-04T12:00:00.000Z"),
    );

    expect(nextThreads.map((entry) => entry.id)).toEqual([3, 2, 1]);
  });

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

  it("orders actively turning threads before idle threads, then by recency", () => {
    const store = createThreadStore([
      thread(1, "2026-04-04T12:00:00.000Z"),
      thread(2, "2026-04-04T11:00:00.000Z", null, {
        runStatus: { state: "working" },
      }),
      thread(3, "2026-04-04T10:00:00.000Z", null, {
        runStatus: { state: "working" },
      }),
    ]);

    expect(threadStoreItems(store).map((entry) => entry.id)).toEqual([2, 3, 1]);
  });

  it("moves a thread into the actively turning group when work starts", () => {
    const initialStore = createThreadStore([
      thread(1, "2026-04-04T12:00:00.000Z"),
      thread(2, "2026-04-04T11:00:00.000Z"),
      thread(3, "2026-04-04T10:00:00.000Z"),
    ]);

    const nextStore = upsertThreadStore(
      initialStore,
      thread(3, "2026-04-04T10:00:00.000Z", null, {
        runStatus: {
          state: "working",
          updatedAt: "2026-04-04T12:30:00.000Z",
        },
      }),
    );

    expect(threadStoreItems(nextStore).map((entry) => entry.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it("reflects a stopped timestamp in thread list ordering and display date", () => {
    const stoppedThread = thread(2, "2026-04-04T11:00:00.000Z", null, {
      runStatus: {
        state: "stopped",
        updatedAt: "2026-04-04T12:30:00.000Z",
      },
    });
    const store = createThreadStore([
      thread(1, "2026-04-04T12:00:00.000Z"),
      stoppedThread,
    ]);

    expect(threadStoreItems(store).map((entry) => entry.id)).toEqual([2, 1]);
    expect(threadListUpdatedAt(stoppedThread)).toBe("2026-04-04T12:30:00.000Z");
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

  it("skips equivalent fresh thread snapshots to avoid idle state churn", () => {
    const currentThread = thread(7, "2026-04-04T12:30:00.000Z", null, {
      permissions: ["metidos:threads"],
      pluginAccessGroups: ["alpha/default"],
      runStatus: {
        queue: {
          followUpMessageCount: 0,
          pendingMessageCount: 1,
          steeringMessageCount: 0,
        },
        state: "working",
        updatedAt: "2026-04-04T12:31:00.000Z",
      },
    });
    const equivalentThread = {
      ...currentThread,
      runStatus: { ...currentThread.runStatus },
      permissions: [...(currentThread.permissions ?? [])],
      pluginAccessGroups: [...(currentThread.pluginAccessGroups ?? [])],
    };
    const initialStore = createThreadStore([currentThread]);

    expect(threadsEquivalent(currentThread, equivalentThread)).toBe(true);
    expect(upsertThreadStore(initialStore, equivalentThread)).toBe(
      initialStore,
    );
    expect(upsertThreadList([currentThread], equivalentThread)).toEqual([
      currentThread,
    ]);
  });

  it("compares thread stores by order and semantic thread content", () => {
    const firstThread = thread(1, "2026-04-04T12:30:00.000Z");
    const secondThread = thread(2, "2026-04-04T12:00:00.000Z");
    const leftStore = createThreadStore([firstThread, secondThread]);
    const rightStore = createThreadStore([
      { ...firstThread, runStatus: { ...firstThread.runStatus } },
      { ...secondThread, runStatus: { ...secondThread.runStatus } },
    ]);

    expect(threadStoresEquivalent(leftStore, rightStore)).toBe(true);
    expect(
      threadStoresEquivalent(
        leftStore,
        createThreadStore([
          { ...firstThread, updatedAt: "2026-04-04T12:31:00.000Z" },
          secondThread,
        ]),
      ),
    ).toBe(false);
  });

  it("keeps a newer thread snapshot when an older update arrives later", () => {
    const currentThread = thread(7, "2026-04-04T12:30:00.000Z");
    const staleThread = thread(7, "2026-04-04T12:00:00.000Z");
    const initialStore = createThreadStore([currentThread]);

    expect(upsertThreadStore(initialStore, staleThread)).toBe(initialStore);
    expect(upsertThreadList([currentThread], staleThread)[0]).toBe(
      currentThread,
    );
  });

  it("accepts fresher runtime status snapshots even when metadata timestamps match", () => {
    const currentThread = {
      ...thread(7, "2026-04-04T12:30:00.000Z"),
      runStatus: {
        state: "working",
        updatedAt: "2026-04-04T12:31:00.000Z",
      },
    } as RpcThread;
    const fresherStatusThread = {
      ...thread(7, "2026-04-04T12:30:00.000Z"),
      runStatus: {
        state: "idle",
        updatedAt: "2026-04-04T12:32:00.000Z",
      },
    } as RpcThread;

    const nextStore = upsertThreadStore(
      createThreadStore([currentThread]),
      fresherStatusThread,
    );

    expect(threadStoreItems(nextStore)[0]).toBe(fresherStatusThread);
  });

  it("keeps the freshest snapshot when createThreadStore receives duplicate ids", () => {
    const staleThread = {
      ...thread(7, "2026-04-04T12:30:00.000Z"),
      runStatus: {
        state: "working",
        updatedAt: "2026-04-04T12:31:00.000Z",
      },
    } as RpcThread;
    const fresherThread = {
      ...thread(7, "2026-04-04T12:30:00.000Z"),
      runStatus: {
        state: "idle",
        updatedAt: "2026-04-04T12:32:00.000Z",
      },
    } as RpcThread;

    const store = createThreadStore([staleThread, fresherThread]);

    expect(threadStoreItems(store)).toEqual([fresherThread]);
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

  it("finds the latest and latest pinned worktree thread in one pass", () => {
    const threads = [
      thread(1, "2026-04-04T09:00:00.000Z", null, {
        projectId: 1,
        worktreePath: "/repos/alpha",
      }),
      thread(2, "2026-04-04T11:00:00.000Z", null, {
        projectId: 1,
        worktreePath: "/repos/alpha",
      }),
      thread(3, "2026-04-04T10:30:00.000Z", "2026-04-04T10:45:00.000Z", {
        projectId: 1,
        worktreePath: "/repos/alpha",
      }),
      thread(4, "2026-04-04T12:00:00.000Z", "2026-04-04T12:15:00.000Z", {
        projectId: 1,
        worktreePath: "/repos/alpha",
      }),
      thread(5, "2026-04-04T13:00:00.000Z", null, {
        projectId: 1,
        worktreePath: "/repos/beta",
      }),
    ];

    expect(latestThreadForWorktree(threads, 1, "/repos/alpha")?.id).toBe(4);
    expect(pinnedThreadForWorktree(threads, 1, "/repos/alpha")?.id).toBe(4);
    expect(pinnedThreadForWorktree(threads, 1, "/repos/beta")).toBeNull();
  });

  it("bounds retained thread stores while preserving active and important threads", () => {
    const initialStore = createThreadStore([
      thread(1, "2026-04-04T12:00:00.000Z"),
      thread(2, "2026-04-04T11:00:00.000Z"),
      thread(3, "2026-04-04T10:00:00.000Z", "2026-04-04T12:15:00.000Z"),
      thread(4, "2026-04-04T09:00:00.000Z", null, {
        runStatus: {
          state: "working",
          updatedAt: "2026-04-04T09:30:00.000Z",
        },
      }),
      thread(5, "2026-04-04T08:00:00.000Z"),
    ]);

    const prunedStore = pruneThreadStore(initialStore, {
      maxRetainedThreads: 4,
      preserveThreadIds: [5],
    });

    expect(threadStoreItems(prunedStore).map((entry) => entry.id)).toEqual([
      3, 4, 1, 5,
    ]);
  });

  it("rejects thread-store updates for unknown projects unless the thread is already tracked", () => {
    const projectStore = createProjectStore([project(1, "Alpha")]);
    const knownThread = thread(7, "2026-04-04T12:00:00.000Z", null, {
      projectId: 1,
    });
    const threadStore = createThreadStore([knownThread]);

    expect(
      shouldAcceptThreadStoreUpdate(
        projectStore,
        threadStore,
        thread(8, "2026-04-04T12:05:00.000Z", null, {
          projectId: 999,
        }),
      ),
    ).toBeFalse();
    expect(
      shouldAcceptThreadStoreUpdate(projectStore, threadStore, {
        ...knownThread,
        updatedAt: "2026-04-04T12:10:00.000Z",
        runStatus: {
          state: "working",
          startedAt: "2026-04-04T12:10:00.000Z",
          updatedAt: "2026-04-04T12:10:00.000Z",
          error: null,
          hasUnreadError: false,
        },
      }),
    ).toBeTrue();
  });
});
