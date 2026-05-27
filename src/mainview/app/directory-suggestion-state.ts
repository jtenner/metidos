/**
 * @file src/mainview/app/directory-suggestion-state.ts
 * @description Directory suggestion state and cache configuration.
 */

/**
 * Cached directory suggestions for filesystem path autocomplete.
 */
export type DirectorySuggestionResultCacheEntry = {
  directories: string[];
  loadedAt: number;
};

/**
 * Delay before firing directory suggestion network calls to avoid noisy typing.
 */
export const DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS = 50;
export const DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES = 128;
export const DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS = 30_000;
