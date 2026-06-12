/**
 * @file src/mainview/app/use-mainview-staleness-refresh-controller.test.ts
 * @description Focused tests for mainview stale-state refresh decisions.
 */

import { describe, expect, it } from "bun:test";
import { resolveMainviewStalenessRefreshDecision } from "./use-mainview-staleness-refresh-controller";

describe("mainview staleness refresh decision", () => {
  it("requests refresh after the event loop misses the stale gap threshold", () => {
    expect(
      resolveMainviewStalenessRefreshDecision({
        now: 46_000,
        previousObservedAt: 0,
        lastRefreshRequestedAt: Number.NEGATIVE_INFINITY,
        gapThresholdMs: 45_000,
        cooldownMs: 30_000,
      }),
    ).toEqual({
      shouldRefresh: true,
      nextObservedAt: 46_000,
      nextRefreshRequestedAt: 46_000,
    });
  });

  it("suppresses normal polling gaps and preserves cooldown state", () => {
    expect(
      resolveMainviewStalenessRefreshDecision({
        now: 10_000,
        previousObservedAt: 5_000,
        lastRefreshRequestedAt: 1_000,
        gapThresholdMs: 45_000,
        cooldownMs: 30_000,
      }),
    ).toEqual({
      shouldRefresh: false,
      nextObservedAt: 10_000,
      nextRefreshRequestedAt: 1_000,
    });
  });

  it("coalesces repeated stale observations inside the cooldown window", () => {
    expect(
      resolveMainviewStalenessRefreshDecision({
        now: 70_000,
        previousObservedAt: 20_000,
        lastRefreshRequestedAt: 55_000,
        gapThresholdMs: 45_000,
        cooldownMs: 30_000,
      }),
    ).toEqual({
      shouldRefresh: false,
      nextObservedAt: 70_000,
      nextRefreshRequestedAt: 55_000,
    });
  });
});
