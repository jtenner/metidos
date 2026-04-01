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

const directorySuggestionCache = new Map<
  string,
  {
    directoryNames: string[];
    lastAccessedAt: number;
    loadedAt: number;
  }
>();

let directorySuggestionRefreshTimer: ReturnType<typeof setInterval> | null =
  null;

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

function sortDirectoryNames(values: string[]): string[] {
  return [...values].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

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

function readDirectorySuggestionEntries(searchDirectory: string): string[] {
  const now = Date.now();
  const cached = readLruValue(directorySuggestionCache, searchDirectory);
  if (cached && cached.loadedAt + DIRECTORY_SUGGESTION_CACHE_TTL_MS > now) {
    cached.lastAccessedAt = now;
    return cached.directoryNames;
  }

  return refreshDirectorySuggestionEntries(searchDirectory, now);
}

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

export function startDirectorySuggestionCacheMaintenance(): void {
  if (directorySuggestionRefreshTimer !== null) {
    return;
  }

  directorySuggestionRefreshTimer = setInterval(() => {
    refreshRecentDirectorySuggestionEntries();
  }, DIRECTORY_SUGGESTION_REFRESH_POLL_INTERVAL_MS);
}

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

export function shutdownDirectorySuggestionCacheMaintenance(): void {
  if (directorySuggestionRefreshTimer === null) {
    return;
  }

  clearInterval(directorySuggestionRefreshTimer);
  directorySuggestionRefreshTimer = null;
}
