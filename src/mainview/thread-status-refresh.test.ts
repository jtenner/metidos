import { describe, expect, it } from "bun:test";

import type { RpcThread, RpcThreadDetail } from "../bun/rpc-schema";
import { resolveThreadStatusRefreshOutcome } from "./thread-status-refresh";

function thread(threadId: number): RpcThread {
  return {
    id: threadId,
  } as unknown as RpcThread;
}

function threadDetail(threadId: number): RpcThreadDetail {
  return {
    thread: thread(threadId),
    messages: [],
  } as unknown as RpcThreadDetail;
}

describe("thread status refresh helpers", () => {
  it("applies selected-thread detail when the same thread is still selected", () => {
    const loadedThreads = [thread(3), thread(7)];

    const outcome = resolveThreadStatusRefreshOutcome({
      detail: threadDetail(7),
      loadedThreads,
      selectedSummaryThreadId: 7,
      selectedThreadId: 7,
    });

    expect(outcome.shouldApplySelectedDetail).toBeTrue();
    expect(outcome.nextThreads.map((entry) => entry.id)).toEqual([3, 7]);
  });

  it("keeps the summary refresh when selection changed before detail commit", () => {
    const loadedThreads = [thread(3), thread(7)];

    const outcome = resolveThreadStatusRefreshOutcome({
      detail: threadDetail(7),
      loadedThreads,
      selectedSummaryThreadId: 7,
      selectedThreadId: 3,
    });

    expect(outcome.shouldApplySelectedDetail).toBeFalse();
    expect(outcome.nextThreads).toBe(loadedThreads);
  });

  it("keeps the summary refresh when selected-thread detail loading fails", () => {
    const loadedThreads = [thread(3), thread(7)];

    const outcome = resolveThreadStatusRefreshOutcome({
      detail: null,
      loadedThreads,
      selectedSummaryThreadId: 7,
      selectedThreadId: 7,
    });

    expect(outcome.shouldApplySelectedDetail).toBeFalse();
    expect(outcome.nextThreads).toBe(loadedThreads);
  });
});
