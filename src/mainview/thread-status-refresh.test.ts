import { describe, expect, it } from "bun:test";

import type { RpcThread, RpcThreadDetail } from "../bun/rpc-schema";
import {
  createThreadStore,
  threadStoreItems,
  upsertThreadList,
} from "./app/state";
import {
  mergeThreadStatusSummaries,
  resolveThreadStatusRefreshOutcome,
} from "./thread-status-refresh";

function thread(threadId: number): RpcThread {
  return sortableThread(threadId, "2026-04-04T12:00:00.000Z");
}

function sortableThread(
  threadId: number,
  updatedAt: string,
  pinnedAt: string | null = null,
): RpcThread {
  return {
    id: threadId,
    pinnedAt,
    updatedAt,
  } as unknown as RpcThread;
}

function threadDetail(threadId: number): RpcThreadDetail {
  return {
    thread: thread(threadId),
    messages: [],
  } as unknown as RpcThreadDetail;
}

describe("thread status refresh helpers", () => {
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
