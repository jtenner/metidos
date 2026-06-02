/**
 * @file src/mainview/app/use-thread-status-controller.test.ts
 * @description Test file for thread status controller polling options.
 */

import { describe, expect, it } from "bun:test";
import type { RpcThread } from "../../bun/rpc-schema";

import {
  buildThreadDiscoverySeedKey,
  SELECTED_THREAD_DETAIL_UNCHANGED_WORKING_MIN_INTERVAL_MS,
  shouldCommitThreadDiscoveryPoll,
  shouldRequestEmptyThreadDiscard,
  shouldRunThreadStatusPollInterval,
  shouldSkipSelectedThreadDetailPoll,
  STUCK_WORKING_THREAD_BACKOFF_AFTER_MS,
  STUCK_WORKING_THREAD_POLL_INTERVAL_MS,
  resolveThreadStatusPollIntervalMs,
} from "./use-thread-status-controller";

function workingThread(updatedAt: string): RpcThread {
  return {
    id: 1,
    projectId: 1,
    worktreePath: "/repo",
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: updatedAt,
      state: "working",
      updatedAt,
    },
    updatedAt,
  } as RpcThread;
}

describe("thread status controller polling RPC options", () => {
  it("keeps the thread discovery seed key stable for equivalent thread arrays", () => {
    const first = workingThread("2026-05-06T16:59:30.000Z");
    const second = { ...first, runStatus: { ...first.runStatus } };

    expect(buildThreadDiscoverySeedKey([first])).toBe(
      buildThreadDiscoverySeedKey([second]),
    );
    expect(
      buildThreadDiscoverySeedKey([
        { ...second, runStatus: { ...second.runStatus, state: "idle" } },
      ]),
    ).not.toBe(buildThreadDiscoverySeedKey([first]));
  });

  it("does not commit cancelled thread discovery poll results", () => {
    expect(shouldCommitThreadDiscoveryPoll({ cancelled: true })).toBe(false);
    expect(shouldCommitThreadDiscoveryPoll({ cancelled: false })).toBe(true);
  });

  it("skips empty-thread discard while the previous thread is protected", () => {
    expect(
      shouldRequestEmptyThreadDiscard({
        previousThreadId: 7,
        selectedThreadId: 11,
      }),
    ).toBe(true);
    expect(
      shouldRequestEmptyThreadDiscard({
        isProtected: true,
        previousThreadId: 7,
        selectedThreadId: 11,
      }),
    ).toBe(false);
    expect(
      shouldRequestEmptyThreadDiscard({
        previousThreadId: 7,
        selectedThreadId: 7,
      }),
    ).toBe(false);
    expect(
      shouldRequestEmptyThreadDiscard({
        previousThreadId: null,
        selectedThreadId: 7,
      }),
    ).toBe(false);
  });

  it("does not run the working-thread status poll interval while hidden", () => {
    expect(
      shouldRunThreadStatusPollInterval({
        isDocumentVisible: false,
        polledThreadIds: [1],
      }),
    ).toBe(false);
    expect(
      shouldRunThreadStatusPollInterval({
        isDocumentVisible: true,
        polledThreadIds: [],
      }),
    ).toBe(false);
    expect(
      shouldRunThreadStatusPollInterval({
        isDocumentVisible: true,
        polledThreadIds: [1],
      }),
    ).toBe(true);
  });

  it("backs off status polling when every working thread is stale", () => {
    const nowMs = Date.parse("2026-05-06T17:00:00.000Z");
    expect(
      resolveThreadStatusPollIntervalMs({
        isDocumentVisible: false,
        nowMs,
        polledThreads: [workingThread("2026-05-06T16:59:30.000Z")],
      }),
    ).toBeNull();
    expect(
      resolveThreadStatusPollIntervalMs({
        isDocumentVisible: true,
        nowMs,
        polledThreads: [workingThread("2026-05-06T16:59:30.000Z")],
      }),
    ).toBe(3_000);
    expect(
      resolveThreadStatusPollIntervalMs({
        isDocumentVisible: true,
        nowMs,
        polledThreads: [
          workingThread(
            new Date(
              nowMs - STUCK_WORKING_THREAD_BACKOFF_AFTER_MS,
            ).toISOString(),
          ),
        ],
      }),
    ).toBe(STUCK_WORKING_THREAD_POLL_INTERVAL_MS);
  });

  it("throttles selected detail polling for unchanged working summaries", () => {
    const nowMs = 10_000;
    expect(
      shouldSkipSelectedThreadDetailPoll({
        lastPoll: null,
        nowMs,
        selectedSummaryDetailRefreshKey: "1:key",
        selectedSummaryRunState: "working",
      }),
    ).toBe(false);
    expect(
      shouldSkipSelectedThreadDetailPoll({
        lastPoll: { key: "1:key", polledAtMs: nowMs - 1_000 },
        nowMs,
        selectedSummaryDetailRefreshKey: "1:key",
        selectedSummaryRunState: "working",
      }),
    ).toBe(true);
    expect(
      shouldSkipSelectedThreadDetailPoll({
        lastPoll: {
          key: "1:key",
          polledAtMs:
            nowMs - SELECTED_THREAD_DETAIL_UNCHANGED_WORKING_MIN_INTERVAL_MS,
        },
        nowMs,
        selectedSummaryDetailRefreshKey: "1:key",
        selectedSummaryRunState: "working",
      }),
    ).toBe(false);
    expect(
      shouldSkipSelectedThreadDetailPoll({
        lastPoll: { key: "1:key", polledAtMs: nowMs - 1_000 },
        nowMs,
        selectedSummaryDetailRefreshKey: "1:key",
        selectedSummaryRunState: "idle",
      }),
    ).toBe(false);
  });
});
