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
} from "./app/thread-store";
import {
  buildSelectedThreadDetailRefreshKey,
  buildThreadRunStateSnapshot,
  buildThreadStatusRequestKey,
  haveSameCompletedThreadIndicatorIds,
  listWorkingThreadIds,
  MAX_COMPLETED_THREAD_INDICATOR_IDS,
  mergeThreadStatusSummaries,
  readThreadActivityIndicator,
  resolveCompletedThreadIndicatorState,
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

  it("keeps refreshing selected detail while the thread is still working", () => {
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
    ).toBeTrue();
  });

  it("skips selected detail refresh once a non-working summary still matches the latest loaded detail", () => {
    const refreshKey = buildSelectedThreadDetailRefreshKey(
      sortableThread(7, "2026-04-04T12:00:00.000Z"),
    );

    expect(
      shouldRefreshSelectedThreadDetail({
        lastLoadedSelectedDetailRefreshKey: refreshKey,
        previousSelectedRunState: "idle",
        selectedSummaryDetailRefreshKey: refreshKey,
        selectedSummaryRunState: "idle",
      }),
    ).toBeFalse();
  });

  it("builds compact thread run-state snapshots without intermediate tuple arrays", () => {
    expect(
      buildThreadRunStateSnapshot([
        sortableThread(3, "2026-04-04T12:00:00.000Z", null, "working"),
        sortableThread(7, "2026-04-04T11:00:00.000Z"),
      ]),
    ).toEqual(
      new Map([
        [3, "working"],
        [7, "idle"],
      ]),
    );
  });

  it("compares completed-thread indicator sets without sorting", () => {
    expect(
      haveSameCompletedThreadIndicatorIds(
        new Set<number>([3, 7]),
        new Set<number>([7, 3]),
      ),
    ).toBeTrue();
    expect(
      haveSameCompletedThreadIndicatorIds(
        new Set<number>([3, 7]),
        new Set<number>([3, 9]),
      ),
    ).toBeFalse();
  });

  it("builds stable thread-status request keys and only reruns queued refreshes when ids changed", () => {
    expect(buildThreadStatusRequestKey([3, 9])).toBe("3,9");
    expect(buildThreadStatusRequestKey([9, 3])).toBe("3,9");
    expect(
      resolveQueuedThreadStatusRefreshRequest({
        completedThreadIds: [3, 9],
        queuedThreadIds: [9, 3],
      }),
    ).toBeNull();
    expect(
      resolveQueuedThreadStatusRefreshRequest({
        completedThreadIds: [3, 9],
        queuedThreadIds: [3, 11],
      }),
    ).toEqual([3, 11]);
  });

  it("treats only background thread completions as unread completed activity", () => {
    const outcome = resolveCompletedThreadIndicatorState({
      currentCompletedThreadIds: new Set<number>(),
      previousThreadRunStates: new Map<number, RpcThread["runStatus"]["state"]>(
        [
          [3, "working"],
          [7, "working"],
        ],
      ),
      selectedThreadId: 7,
      threads: [
        sortableThread(3, "2026-04-04T12:00:00.000Z"),
        sortableThread(7, "2026-04-04T12:00:00.000Z"),
      ],
    });

    expect(outcome.hasUnreadCompletedThread).toBeTrue();
    expect([...outcome.nextCompletedThreadIds]).toEqual([3]);
  });

  it("bounds retained completed thread indicator ids", () => {
    const threadCount = MAX_COMPLETED_THREAD_INDICATOR_IDS + 10;
    const outcome = resolveCompletedThreadIndicatorState({
      currentCompletedThreadIds: new Set<number>(),
      previousThreadRunStates: new Map<number, RpcThread["runStatus"]["state"]>(
        Array.from({ length: threadCount }, (_, index) => [
          index + 1,
          "working",
        ]),
      ),
      selectedThreadId: null,
      threads: Array.from({ length: threadCount }, (_, index) =>
        sortableThread(index + 1, "2026-04-04T12:00:00.000Z"),
      ),
    });

    expect(outcome.hasUnreadCompletedThread).toBe(true);
    expect(outcome.nextCompletedThreadIds.size).toBe(
      MAX_COMPLETED_THREAD_INDICATOR_IDS,
    );
  });

  it("clears the completed state once that thread becomes the selected thread", () => {
    const outcome = resolveCompletedThreadIndicatorState({
      currentCompletedThreadIds: new Set<number>([7]),
      previousThreadRunStates: new Map<
        number,
        RpcThread["runStatus"]["state"]
      >(),
      selectedThreadId: 7,
      threads: [sortableThread(7, "2026-04-04T12:00:00.000Z")],
    });

    expect(outcome.hasUnreadCompletedThread).toBeFalse();
    expect([...outcome.nextCompletedThreadIds]).toEqual([]);
  });

  it("does not render a completed activity indicator for the selected thread", () => {
    expect(
      readThreadActivityIndicator({
        completedThreadIndicatorIds: new Set<number>([7]),
        selectedThreadId: 7,
        thread: sortableThread(7, "2026-04-04T12:00:00.000Z"),
      }),
    ).toBe("none");
    expect(
      readThreadActivityIndicator({
        completedThreadIndicatorIds: new Set<number>([7]),
        selectedThreadId: 3,
        thread: sortableThread(7, "2026-04-04T12:00:00.000Z"),
      }),
    ).toBe("completed");
    expect(
      readThreadActivityIndicator({
        completedThreadIndicatorIds: new Set<number>([7]),
        selectedThreadId: 7,
        thread: sortableThread(7, "2026-04-04T12:00:00.000Z", null, "working"),
      }),
    ).toBe("working");
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

    const updatedThread = {
      ...sortableThread(2, "2026-04-04T11:00:00.000Z"),
      title: "Updated title",
    };
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
