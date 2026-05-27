/**
 * @file src/bun/fixed-window-rate-limit.test.ts
 * @description Tests for bounded fixed-window rate-limit buckets.
 */

import { describe, expect, it } from "bun:test";

import { createFixedWindowRateLimiter } from "./fixed-window-rate-limit";

describe("fixed window rate limiter", () => {
  it("evicts stale peer buckets while enforcing active limits", () => {
    const limiter = createFixedWindowRateLimiter({
      maxBuckets: 2,
      maxRequests: 2,
      windowMs: 1_000,
    });

    expect(limiter.hit("peer-a", 1_000)).toEqual({ allowed: true });
    expect(limiter.hit("peer-a", 1_100)).toEqual({ allowed: true });
    expect(limiter.hit("peer-a", 1_200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.size()).toBe(1);

    expect(limiter.hit("peer-b", 2_500)).toEqual({ allowed: true });
    expect(limiter.size()).toBe(1);

    expect(limiter.hit("peer-c", 2_600)).toEqual({ allowed: true });
    expect(limiter.hit("peer-d", 2_700)).toEqual({ allowed: true });
    expect(limiter.size()).toBe(2);
  });

  it("refreshes peer recency before capacity eviction", () => {
    const limiter = createFixedWindowRateLimiter({
      maxBuckets: 2,
      maxRequests: 2,
      windowMs: 10_000,
    });

    expect(limiter.hit("peer-a", 1_000)).toEqual({ allowed: true });
    expect(limiter.hit("peer-b", 1_100)).toEqual({ allowed: true });
    expect(limiter.hit("peer-a", 1_200)).toEqual({ allowed: true });
    expect(limiter.hit("peer-c", 1_300)).toEqual({ allowed: true });
    expect(limiter.size()).toBe(2);

    // peer-b was the least-recently accepted bucket and should have been
    // evicted. If it had been retained, this second hit would exceed
    // maxRequests because peer-b already had one retained timestamp.
    expect(limiter.hit("peer-b", 1_400)).toEqual({ allowed: true });
    expect(limiter.hit("peer-b", 1_410)).toEqual({ allowed: true });
  });
});
