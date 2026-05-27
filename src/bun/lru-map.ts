/**
 * @file src/bun/lru-map.ts
 * @description Small helpers for Map-backed least-recently-used caches.
 */

/**
 * Read a value from an insertion-ordered Map and promote it to most-recent.
 */
export function readLruMapValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
): Value | undefined {
  if (!cache.has(key)) {
    return undefined;
  }

  const value = cache.get(key);
  if (typeof value === "undefined") {
    return undefined;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

/**
 * Write a value and promote it to most-recent insertion order.
 */
export function writeLruMapValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
}

/**
 * Delete oldest entries until the Map is no larger than maxEntries.
 */
export function pruneLruMapToMaxEntries<Key, Value>(
  cache: Map<Key, Value>,
  maxEntries: number,
): void {
  const limit = Math.max(0, Math.trunc(maxEntries));
  while (cache.size > limit) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      return;
    }
    cache.delete(oldest.value);
  }
}

/**
 * Return cache entries from most-recent to oldest.
 */
export function lruMapEntriesNewestFirst<Key, Value>(
  cache: Map<Key, Value>,
): Array<[Key, Value]> {
  return [...cache.entries()].reverse();
}
