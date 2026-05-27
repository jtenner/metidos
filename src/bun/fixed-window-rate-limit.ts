/**
 * @file src/bun/fixed-window-rate-limit.ts
 * @description Bounded in-memory fixed-window rate limiter helpers.
 */

export type FixedWindowRateLimitResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

export type FixedWindowRateLimiter = {
  hit: (key: string, nowMs?: number) => FixedWindowRateLimitResult;
  size: () => number;
};

export function createFixedWindowRateLimiter(options: {
  maxBuckets: number;
  maxRequests: number;
  windowMs: number;
}): FixedWindowRateLimiter {
  const maxBuckets = Math.max(1, Math.floor(options.maxBuckets));
  const maxRequests = Math.max(1, Math.floor(options.maxRequests));
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const buckets = new Map<string, number[]>();

  function prune(nowMs: number): void {
    const cutoffMs = nowMs - windowMs;
    for (const [key, timestamps] of buckets) {
      let firstRecentIndex = 0;
      while (
        firstRecentIndex < timestamps.length &&
        (timestamps[firstRecentIndex] ?? 0) <= cutoffMs
      ) {
        firstRecentIndex += 1;
      }
      if (firstRecentIndex >= timestamps.length) {
        buckets.delete(key);
      } else if (firstRecentIndex > 0) {
        // Preserve the existing timestamp array object so pruning a hot bucket
        // does not allocate a replacement array or shift via splice on every hit.
        timestamps.copyWithin(0, firstRecentIndex);
        timestamps.length -= firstRecentIndex;
      }
    }

    while (buckets.size > maxBuckets) {
      // hit() refreshes Map insertion order with delete()+set(), so the first
      // key is the least-recently accepted active bucket, not merely the oldest
      // originally-created bucket.
      const oldestKey = buckets.keys().next().value;
      if (typeof oldestKey !== "string") {
        return;
      }
      buckets.delete(oldestKey);
    }
  }

  return {
    hit: (key, nowMs = Date.now()) => {
      prune(nowMs);
      const recent = buckets.get(key) ?? [];
      if (recent.length >= maxRequests) {
        const oldest = recent[0] ?? nowMs;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + windowMs - nowMs) / 1000),
          ),
        };
      }

      recent.push(nowMs);
      // Refresh insertion order so capacity pruning evicts least-recently
      // accepted buckets while preserving active peers.
      buckets.delete(key);
      buckets.set(key, recent);
      prune(nowMs);
      return {
        allowed: true,
      };
    },
    size: () => buckets.size,
  };
}
