/**
 * @file src/bun/project-procedures/directory-suggestions.ts
 * @description Module for directory suggestions.
 */

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import {
  lruEntriesNewestFirst,
  readLruValue,
  safeIsDirectory,
  writeLruValue,
} from "./shared";

const DIRECTORY_SUGGESTION_CACHE_TTL_MS = 60_000;
const DIRECTORY_SUGGESTION_CACHE_MAX_ENTRIES = 96;
const DIRECTORY_SUGGESTION_REFRESH_BATCH_SIZE = 6;
const DIRECTORY_SUGGESTION_REFRESH_POLL_INTERVAL_MS = 5_000;
const DIRECTORY_SUGGESTION_REFRESH_RECENT_WINDOW_MS = 90_000;

/**
 * In-memory LRU cache of directory listings by absolute path.
 * Stores sorted child directory names plus freshness metadata.
 */
const directorySuggestionCache = new Map<
  string,
  {
    directoryNames: string[];
    lastAccessedAt: number;
    loadedAt: number;
  }
>();

/**
 * Shared periodic timer handle for refreshing recently-used cache entries.
 */
let directorySuggestionRefreshTimer: ReturnType<typeof setInterval> | null =
  null;

/**
 * Parse user input into:
 * - a directory to inspect
 * - optional name prefix to filter within that directory
 */
function parseDirectorySuggestionQuery(query: string): {
  searchDirectory: string;
  namePrefix: string;
} {
  if (process.platform !== "win32" && (query === "~" || query === "~/")) {
    return {
      searchDirectory: homedir(),
      namePrefix: "",
    };
  }

  const hasTrailingSeparator = /[\\/]$/.test(query);
  const expandedQuery =
    process.platform === "win32"
      ? query
      : query === "~"
        ? homedir()
        : query.startsWith("~/")
          ? resolve(homedir(), query.slice(2))
          : query;
  if (hasTrailingSeparator) {
    return {
      searchDirectory: resolve(expandedQuery),
      namePrefix: "",
    };
  }

  return {
    searchDirectory: resolve(dirname(expandedQuery)),
    namePrefix: basename(expandedQuery),
  };
}

/**
 * Sort names with locale-aware numeric semantics for user-friendly completion order.
 */
function sortDirectoryNames(values: string[]): string[] {
  return [...values].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/**
 * Read only immediate child directories from disk, including safe symlink directories.
 * Hidden entries are excluded to keep suggestions signal-rich.
 */
function readDirectorySuggestionNamesFromDisk(
  searchDirectory: string,
): string[] {
  return sortDirectoryNames(
    readdirSync(searchDirectory, { withFileTypes: true })
      .filter((entry) => {
        if (entry.name.startsWith(".")) {
          return false;
        }
        if (entry.isDirectory()) {
          return true;
        }
        if (entry.isSymbolicLink()) {
          return safeIsDirectory(resolve(searchDirectory, entry.name));
        }
        return false;
      })
      .map((entry) => entry.name),
  );
}

/**
 * Refresh a cache entry from disk and store it in LRU map.
 * On read failure, invalidates the cache key to avoid serving stale data.
 */
function refreshDirectorySuggestionEntries(
  searchDirectory: string,
  lastAccessedAt = Date.now(),
): string[] {
  try {
    const directoryNames =
      readDirectorySuggestionNamesFromDisk(searchDirectory);
    writeLruValue(
      directorySuggestionCache,
      searchDirectory,
      {
        directoryNames,
        lastAccessedAt,
        loadedAt: Date.now(),
      },
      DIRECTORY_SUGGESTION_CACHE_MAX_ENTRIES,
    );
    return directoryNames;
  } catch (error) {
    directorySuggestionCache.delete(searchDirectory);
    throw error;
  }
}

/**
 * Return cached entries if still fresh; otherwise refresh from disk.
 */
function readDirectorySuggestionEntries(searchDirectory: string): string[] {
  const now = Date.now();
  const cached = readLruValue(directorySuggestionCache, searchDirectory);
  if (cached && cached.loadedAt + DIRECTORY_SUGGESTION_CACHE_TTL_MS > now) {
    cached.lastAccessedAt = now;
    return cached.directoryNames;
  }

  return refreshDirectorySuggestionEntries(searchDirectory, now);
}

/**
 * Periodically refresh only recently accessed cache entries, capped in batch.
 * This keeps common paths warm without scanning every entry.
 */
function refreshRecentDirectorySuggestionEntries(): void {
  const now = Date.now();
  for (const [searchDirectory, cached] of lruEntriesNewestFirst(
    directorySuggestionCache,
  )
    .filter(
      ([, entry]) =>
        now - entry.lastAccessedAt <=
        DIRECTORY_SUGGESTION_REFRESH_RECENT_WINDOW_MS,
    )
    .slice(0, DIRECTORY_SUGGESTION_REFRESH_BATCH_SIZE)) {
    try {
      refreshDirectorySuggestionEntries(searchDirectory, cached.lastAccessedAt);
    } catch (error) {
      console.error(
        `Failed to refresh directory suggestion cache for ${searchDirectory}`,
        error,
      );
    }
  }
}

/**
 * Start a single periodic directory-suggestion refresh timer.
 * Repeated calls are idempotent.
 */
export function startDirectorySuggestionCacheMaintenance(): void {
  if (directorySuggestionRefreshTimer !== null) {
    return;
  }

  directorySuggestionRefreshTimer = setInterval(() => {
    refreshRecentDirectorySuggestionEntries();
  }, DIRECTORY_SUGGESTION_REFRESH_POLL_INTERVAL_MS);
}

/**
 * Eagerly prime cache for home directory when available.
 */
export function warmDirectorySuggestionCache(): void {
  const homeDirectory = homedir();
  if (!safeIsDirectory(homeDirectory)) {
    return;
  }

  try {
    readDirectorySuggestionEntries(homeDirectory);
  } catch (error) {
    console.error(
      `Failed to warm directory suggestion cache for ${homeDirectory}`,
      error,
    );
  }
}

/**
 * Return absolute directory path suggestions for autocomplete:
 * parse + validate query, refresh cache as needed, filter by prefix.
 */
export function listDirectorySuggestions(query: string): string[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const { searchDirectory, namePrefix } =
    parseDirectorySuggestionQuery(trimmedQuery);
  if (!safeIsDirectory(searchDirectory)) {
    return [];
  }

  try {
    const normalizedPrefix = namePrefix.toLocaleLowerCase();
    return readDirectorySuggestionEntries(searchDirectory)
      .filter((entry) => {
        if (
          normalizedPrefix &&
          !entry.toLocaleLowerCase().startsWith(normalizedPrefix)
        ) {
          return false;
        }
        return true;
      })
      .map((entry) => resolve(searchDirectory, entry));
  } catch {
    return [];
  }
}

/**
 * Stop periodic maintenance timer and release resources.
 */
export function shutdownDirectorySuggestionCacheMaintenance(): void {
  if (directorySuggestionRefreshTimer === null) {
    return;
  }

  clearInterval(directorySuggestionRefreshTimer);
  directorySuggestionRefreshTimer = null;
}
