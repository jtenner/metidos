/**
 * @file src/bun/token-bucket-rate-limit.ts
 * @description Bounded in-memory token-bucket rate limiter helpers.
 */

export type TokenBucketRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type TokenBucketRateLimiter = {
  hit: (key: string, nowMs?: number) => TokenBucketRateLimitResult;
  size: () => number;
};

export function createTokenBucketRateLimiter(options: {
  capacity: number;
  maxBuckets: number;
  refillIntervalMs: number;
  refillTokens: number;
}): TokenBucketRateLimiter {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const maxBuckets = Math.max(1, Math.floor(options.maxBuckets));
  const refillIntervalMs = Math.max(1, Math.floor(options.refillIntervalMs));
  const refillTokens = Math.max(1, Math.floor(options.refillTokens));
  const buckets = new Map<string, { lastRefillMs: number; tokens: number }>();

  function refill(
    bucket: { lastRefillMs: number; tokens: number },
    nowMs: number,
  ): void {
    if (nowMs <= bucket.lastRefillMs) return;
    const elapsedIntervals = Math.floor(
      (nowMs - bucket.lastRefillMs) / refillIntervalMs,
    );
    if (elapsedIntervals <= 0) return;
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + elapsedIntervals * refillTokens,
    );
    bucket.lastRefillMs += elapsedIntervals * refillIntervalMs;
  }

  function pruneIfNeeded(): void {
    // The limiter has a hard cardinality cap instead of a TTL: bucket state is
    // tiny, refills on access, and LRU pruning below keeps attacker-controlled
    // peer churn from growing memory beyond maxBuckets.
    if (buckets.size <= maxBuckets) {
      return;
    }
    // Inserting before pruning can momentarily place the Map one entry over the
    // configured cap, but every hit synchronously trims back to maxBuckets. This
    // preserves MRU ordering for the just-touched key without leaving durable
    // attacker-controlled bucket growth.
    while (buckets.size > maxBuckets) {
      const oldestKey = buckets.keys().next().value;
      if (typeof oldestKey !== "string") return;
      buckets.delete(oldestKey);
    }
  }

  return {
    hit: (key, nowMs = Date.now()) => {
      // `hit()` is synchronous and performs the refill/check/decrement without
      // any await points, so callers in Bun's single JS isolate cannot observe a
      // TOCTOU gap between the token check and mutation. lastRefillMs is stored
      // only in this closure and advances in whole refill intervals to avoid
      // minting extra tokens from jitter or repeated boundary hits.

      const bucket = buckets.get(key) ?? {
        lastRefillMs: nowMs,
        tokens: capacity,
      };
      refill(bucket, nowMs);
      if (bucket.tokens <= 0) {
        // Clamping keeps Retry-After positive if a stale bucket or wall-clock
        // jump makes the nominal refill boundary appear to be in the past. The
        // bucket still remains in LRU order below so later hits can refill it
        // normally instead of treating the clock edge as a separate state.
        const retryAfterMs = Math.max(
          1,
          bucket.lastRefillMs + refillIntervalMs - nowMs,
        );
        // Denied hits still count as recent activity. Move the bucket to the
        // MRU end just like allowed hits so the fixed max bucket count evicts
        // truly inactive peers rather than active callers under cooldown.
        buckets.delete(key);
        buckets.set(key, bucket);
        pruneIfNeeded();
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        };
      }

      bucket.tokens -= 1;
      // delete()+set() is the intentional LRU touch operation here; the bucket
      // map is hard-capped, so this small mutation cost buys bounded memory.
      buckets.delete(key);
      buckets.set(key, bucket);
      pruneIfNeeded();
      return { allowed: true };
    },
    size: () => buckets.size,
  };
}
