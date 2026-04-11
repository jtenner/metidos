/**
 * @file src/mainview/thread-status-refresh.test.ts
 * @description Test file for thread status refresh.
 */

import { describe, expect, it } from "bun:test";

import type { RpcThread, RpcThreadDetail } from "../bun/rpc-schema";
import {
  createThreadStore,
  threadStoreItems,
  upsertThreadList,
} from "./app/state";
import {
  buildSelectedThreadDetailRefreshKey,
  buildThreadStatusRequestKey,
  listWorkingThreadIds,
  mergeThreadStatusSummaries,
  resolveQueuedThreadStatusRefreshRequest,
  resolveThreadStatusRefreshOutcome,
  shouldRefreshSelectedThreadDetail,
} from "./thread-status-refresh";

/**
 * Builds a thread fixture.
 * @param threadId - Thread identifier.
 */

function thread(threadId: number): RpcThread {
  return sortableThread(threadId, "2026-04-04T12:00:00.000Z");
}
/**
 * Performs sortableThread operation.
 * @param threadId - Thread identifier.
 * @param updatedAt - Timestamp used to order threads by update recency.
 * @param pinnedAt - Timestamp used to prioritize pinned threads in sorting.
 */

function sortableThread(
  threadId: number,
  updatedAt: string,
  pinnedAt: string | null = null,
  runState: RpcThread["runStatus"]["state"] = "idle",
): RpcThread {
  return {
    id: threadId,
    pinnedAt,
    runStatus: {
      state: runState,
    },
    updatedAt,
  } as unknown as RpcThread;
}
/**
 * Performs threadDetail operation.
 * @param threadId - Thread identifier.
 */

function threadDetail(threadId: number): RpcThreadDetail {
  return {
    thread: thread(threadId),
    messages: [],
  } as unknown as RpcThreadDetail;
}

describe("thread status refresh helpers", () => {
  it("lists only working thread ids in order", () => {
    expect(
      listWorkingThreadIds([
        sortableThread(3, "2026-04-04T12:00:00.000Z", null, "working"),
        sortableThread(7, "2026-04-04T11:00:00.000Z"),
        sortableThread(9, "2026-04-04T10:00:00.000Z", null, "working"),
      ]),
    ).toEqual([3, 9]);
  });

  it("refreshes selected detail for working and terminal state transitions only", () => {
    expect(
      shouldRefreshSelectedThreadDetail({
        previousSelectedRunState: "idle",
        selectedSummaryDetailRefreshKey: "7:working-a:working:working-a",
        selectedSummaryRunState: "working",
      }),
    ).toBeTrue();
    expect(
      shouldRefreshSelectedThreadDetail({
        previousSelectedRunState: "working",
        selectedSummaryDetailRefreshKey: "7:idle-b:idle:idle-b",
        selectedSummaryRunState: "idle",
      }),
    ).toBeTrue();
    expect(
      shouldRefreshSelectedThreadDetail({
        previousSelectedRunState: "idle",
        selectedSummaryDetailRefreshKey: "7:failed-c:failed:failed-c",
        selectedSummaryRunState: "failed",
      }),
    ).toBeTrue();
    expect(
      shouldRefreshSelectedThreadDetail({
        previousSelectedRunState: "failed",
        selectedSummaryDetailRefreshKey: "7:failed-c:failed:failed-c",
        selectedSummaryRunState: "failed",
      }),
    ).toBeFalse();
    expect(
      shouldRefreshSelectedThreadDetail({
        previousSelectedRunState: "stopped",
        selectedSummaryDetailRefreshKey: "7:stopped-d:stopped:stopped-d",
        selectedSummaryRunState: "stopped",
      }),
    ).toBeFalse();
  });

  it("skips selected detail refresh when the latest loaded detail already matches the summary", () => {
    const refreshKey = buildSelectedThreadDetailRefreshKey(
      sortableThread(7, "2026-04-04T12:00:00.000Z", null, "working"),
    );

    expect(
      shouldRefreshSelectedThreadDetail({
        lastLoadedSelectedDetailRefreshKey: refreshKey,
        previousSelectedRunState: "working",
        selectedSummaryDetailRefreshKey: refreshKey,
        selectedSummaryRunState: "working",
      }),
    ).toBeFalse();
  });

  it("builds stable thread-status request keys and only reruns queued refreshes when ids changed", () => {
    expect(buildThreadStatusRequestKey([3, 9])).toBe("3,9");
    expect(
      resolveQueuedThreadStatusRefreshRequest({
        completedThreadIds: [3, 9],
        queuedThreadIds: [3, 9],
      }),
    ).toBeNull();
    expect(
      resolveQueuedThreadStatusRefreshRequest({
        completedThreadIds: [3, 9],
        queuedThreadIds: [3, 11],
      }),
    ).toEqual([3, 11]);
  });

  it("merges polled thread statuses into the existing thread list", () => {
    const currentThreadStore = createThreadStore([
      thread(3),
      thread(7),
      thread(9),
    ]);
    const loadedThreadStatuses = [
      sortableThread(7, "2026-04-04T12:30:00.000Z"),
    ];

    const nextThreadStore = mergeThreadStatusSummaries({
      currentThreadStore,
      loadedThreadStatuses,
    });

    expect(threadStoreItems(nextThreadStore).map((entry) => entry.id)).toEqual([
      7, 3, 9,
    ]);
  });

  it("applies selected-thread detail when the same thread is still selected", () => {
    const currentThreadStore = createThreadStore([thread(3), thread(7)]);
    const loadedThreadStatuses = [thread(7)];

    const outcome = resolveThreadStatusRefreshOutcome({
      currentThreadStore,
      detail: threadDetail(7),
      loadedThreadStatuses,
      selectedSummaryThreadId: 7,
      selectedThreadId: 7,
    });

    expect(outcome.shouldApplySelectedDetail).toBeTrue();
    expect(
      threadStoreItems(outcome.nextThreadStore).map((entry) => entry.id),
    ).toEqual([3, 7]);
  });

  it("keeps the summary refresh when selection changed before detail commit", () => {
    const currentThreadStore = createThreadStore([thread(3), thread(7)]);
    const loadedThreadStatuses = [thread(7)];

    const outcome = resolveThreadStatusRefreshOutcome({
      currentThreadStore,
      detail: threadDetail(7),
      loadedThreadStatuses,
      selectedSummaryThreadId: 7,
      selectedThreadId: 3,
    });

    expect(outcome.shouldApplySelectedDetail).toBeFalse();
    expect(
      threadStoreItems(outcome.nextThreadStore).map((entry) => entry.id),
    ).toEqual([3, 7]);
  });

  it("keeps the summary refresh when selected-thread detail loading fails", () => {
    const currentThreadStore = createThreadStore([thread(3), thread(7)]);
    const loadedThreadStatuses = [thread(7)];

    const outcome = resolveThreadStatusRefreshOutcome({
      currentThreadStore,
      detail: null,
      loadedThreadStatuses,
      selectedSummaryThreadId: 7,
      selectedThreadId: 7,
    });

    expect(outcome.shouldApplySelectedDetail).toBeFalse();
    expect(
      threadStoreItems(outcome.nextThreadStore).map((entry) => entry.id),
    ).toEqual([3, 7]);
  });
});

describe("upsertThreadList", () => {
  it("inserts new threads without resorting the entire list", () => {
    const threads = [
      sortableThread(1, "2026-04-04T12:00:00.000Z"),
      sortableThread(2, "2026-04-04T11:00:00.000Z"),
    ];

    const next = upsertThreadList(
      threads,
      sortableThread(3, "2026-04-04T11:30:00.000Z"),
    );

    expect(next.map((entry) => entry.id)).toEqual([1, 3, 2]);
  });

  it("replaces a thread in place when the sort position does not change", () => {
    const threads = [
      sortableThread(1, "2026-04-04T12:00:00.000Z"),
      sortableThread(2, "2026-04-04T11:00:00.000Z"),
      sortableThread(3, "2026-04-04T10:00:00.000Z"),
    ];

    const updatedThread = sortableThread(2, "2026-04-04T11:00:00.000Z");
    const next = upsertThreadList(threads, updatedThread);

    expect(next.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(next[1]).toBe(updatedThread);
  });

  it("moves a thread forward when recency changes", () => {
    const threads = [
      sortableThread(1, "2026-04-04T12:00:00.000Z"),
      sortableThread(2, "2026-04-04T11:00:00.000Z"),
      sortableThread(3, "2026-04-04T10:00:00.000Z"),
    ];

    const next = upsertThreadList(
      threads,
      sortableThread(3, "2026-04-04T12:30:00.000Z"),
    );

    expect(next.map((entry) => entry.id)).toEqual([3, 1, 2]);
  });

  it("moves a thread into the pinned section when pinnedAt changes", () => {
    const threads = [
      sortableThread(1, "2026-04-04T12:00:00.000Z", "2026-04-04T12:15:00.000Z"),
      sortableThread(2, "2026-04-04T11:00:00.000Z"),
      sortableThread(3, "2026-04-04T10:00:00.000Z"),
    ];

    const next = upsertThreadList(
      threads,
      sortableThread(3, "2026-04-04T10:00:00.000Z", "2026-04-04T12:20:00.000Z"),
    );

    expect(next.map((entry) => entry.id)).toEqual([3, 1, 2]);
  });
});
