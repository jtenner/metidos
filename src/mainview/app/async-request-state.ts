/**
 * @file src/mainview/app/async-request-state.ts
 * @description Shared async request, cancellation, and cache helpers.
 */

/**
 * Internal tracker for a deduplicated async request and its waiting consumers.
 */
export type PendingSharedRequest<T> = {
  controller: AbortController;
  promise: Promise<T>;
  waiterCount: number;
};

/**
 * Read-most-recently-used helper for cache access.
 */
export function readLruValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
): Value | null {
  if (!cache.has(key)) {
    return null;
  }

  const value = cache.get(key);
  if (typeof value === "undefined") {
    return null;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

/**
 * Write to an LRU-style cache and evict oldest keys when capacity is exceeded.
 */
export function writeLruValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  maxEntries: number,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      return;
    }
    cache.delete(oldest.value);
  }
}

/**
 * Normalize cancellation errors into typed `Error` values with stable `name`.
 */
export function createAbortError(
  reason: unknown,
  fallbackMessage: string,
): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" && reason.trim() ? reason : fallbackMessage,
    {
      cause: reason,
    },
  );
  if (reason instanceof DOMException && reason.name) {
    error.name = reason.name;
  } else {
    error.name = "AbortError";
  }
  return error;
}

/**
 * Detect abort/timeout errors for expected cancellation paths.
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Await a promise with optional abort support and a fallback reason message.
 */
export async function awaitAbortableResult<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined,
  fallbackMessage: string,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw createAbortError(signal.reason, fallbackMessage);
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(createAbortError(signal.reason, fallbackMessage));
    };
    signal.addEventListener("abort", handleAbort, {
      once: true,
    });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

/**
 * Clamp numeric value to inclusive min/max bounds.
 */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
