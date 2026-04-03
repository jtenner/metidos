import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

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

export function lruEntriesNewestFirst<Key, Value>(
  cache: Map<Key, Value>,
): Array<[Key, Value]> {
  return [...cache.entries()].reverse();
}

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

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function throwIfAborted(
  signal: AbortSignal | null | undefined,
  fallbackMessage: string,
): void {
  if (signal?.aborted) {
    throw createAbortError(signal.reason, fallbackMessage);
  }
}

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

export function createAsyncConcurrencyLimit(maxConcurrent: number): {
  run: <T>(
    callback: () => Promise<T> | T,
    options?: {
      abortMessage?: string;
      signal?: AbortSignal | null;
    },
  ) => Promise<T>;
  stats: () => {
    activeCount: number;
    maxConcurrent: number;
    pendingCount: number;
  };
} {
  const concurrency = Math.max(1, Math.trunc(maxConcurrent) || 1);
  let activeCount = 0;
  const pendingTasks: Array<{
    abortMessage: string;
    detachAbortListener: () => void;
    reject: (reason?: unknown) => void;
    signal: AbortSignal | null;
    start: () => void;
  }> = [];

  const removePendingTask = (task: (typeof pendingTasks)[number]): void => {
    const index = pendingTasks.indexOf(task);
    if (index >= 0) {
      pendingTasks.splice(index, 1);
    }
  };

  const schedule = (): void => {
    while (activeCount < concurrency) {
      const nextTask = pendingTasks.shift();
      if (!nextTask) {
        return;
      }
      if (nextTask.signal?.aborted) {
        nextTask.detachAbortListener();
        nextTask.reject(
          createAbortError(nextTask.signal.reason, nextTask.abortMessage),
        );
        continue;
      }

      nextTask.detachAbortListener();
      activeCount += 1;
      nextTask.start();
    }
  };

  return {
    run: <T>(
      callback: () => Promise<T> | T,
      options?: {
        abortMessage?: string;
        signal?: AbortSignal | null;
      },
    ): Promise<T> => {
      const abortMessage =
        options?.abortMessage ?? "Limited operation was aborted.";
      const signal = options?.signal ?? null;

      return new Promise<T>((resolve, reject) => {
        const task = {
          abortMessage,
          detachAbortListener: () => {},
          reject,
          signal,
          start: () => {
            void Promise.resolve()
              .then(callback)
              .then(resolve, reject)
              .finally(() => {
                activeCount = Math.max(0, activeCount - 1);
                schedule();
              });
          },
        };

        if (signal) {
          const handleAbort = () => {
            removePendingTask(task);
            task.detachAbortListener();
            reject(createAbortError(signal.reason, abortMessage));
          };
          signal.addEventListener("abort", handleAbort, {
            once: true,
          });
          task.detachAbortListener = () => {
            signal.removeEventListener("abort", handleAbort);
          };
        }

        pendingTasks.push(task);
        schedule();
      });
    },
    stats: () => ({
      activeCount,
      maxConcurrent: concurrency,
      pendingCount: pendingTasks.length,
    }),
  };
}

export function expandHomeShorthandPath(value: string): string {
  if (process.platform === "win32") {
    return value;
  }
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  return value;
}

export function normalizePath(value: string): string {
  return resolve(expandHomeShorthandPath(value));
}

export function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function safeIsDirectoryAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function safeIsFileAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function shortName(value: string): string {
  const normalized = value.replace(/[\\/]$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}
