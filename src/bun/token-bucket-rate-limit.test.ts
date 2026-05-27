/**
 * @file src/bun/token-bucket-rate-limit.test.ts
 * @description Tests for bounded token-bucket rate-limit buckets.
 */

import { describe, expect, it } from "bun:test";

import { createTokenBucketRateLimiter } from "./token-bucket-rate-limit";

describe("token bucket rate limiter", () => {
  it("smooths boundary bursts by refilling gradually", () => {
    const limiter = createTokenBucketRateLimiter({
      capacity: 2,
      maxBuckets: 10,
      refillIntervalMs: 1_000,
      refillTokens: 1,
    });

    expect(limiter.hit("peer", 0)).toEqual({ allowed: true });
    expect(limiter.hit("peer", 999)).toEqual({ allowed: true });
    expect(limiter.hit("peer", 1_000)).toEqual({ allowed: true });
    expect(limiter.hit("peer", 1_001)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.hit("peer", 2_000)).toEqual({ allowed: true });
  });

  it("evicts least-recently-used buckets when bounded", () => {
    const limiter = createTokenBucketRateLimiter({
      capacity: 1,
      maxBuckets: 2,
      refillIntervalMs: 1_000,
      refillTokens: 1,
    });

    expect(limiter.hit("a", 0)).toEqual({ allowed: true });
    expect(limiter.hit("b", 0)).toEqual({ allowed: true });
    expect(limiter.hit("c", 0)).toEqual({ allowed: true });
    expect(limiter.size()).toBe(2);
    expect(limiter.hit("a", 1)).toEqual({ allowed: true });
  });
});
