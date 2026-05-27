/**
 * Normalize user-entered search text for consistent matching.
 *
 * We trim surrounding whitespace and force lower-case so:
 * - accidental leading/trailing spaces no longer affect matching.
 * - comparisons become case-insensitive.
 */
export function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSearchSeparators(value: string): string {
  return normalizeSearchQuery(value)
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchCompact(value: string): string {
  return normalizeSearchQuery(value).replace(/[^a-z0-9]+/g, "");
}

/**
 * Build one normalized searchable text blob from many candidate values.
 *
 * Values are trimmed, lowercased, and joined with spaces so callers can cache
 * one normalized haystack instead of re-normalizing many strings on every
 * search pass.
 */
export function buildNormalizedSearchText(
  ...values: Array<string | null | undefined>
): string {
  return values
    .flatMap((value) => {
      const normalized = normalizeSearchQuery(value ?? "");
      return normalized ? [normalized] : [];
    })
    .join(" ");
}

/**
 * Determine whether a pre-normalized searchable text blob matches the query.
 */
export function matchesNormalizedSearchText(
  query: string,
  searchText: string,
): boolean {
  return !query || searchText.includes(query);
}

/**
 * Determine whether any of the provided values match the normalized query.
 *
 * @param query - A normalized (trimmed/lowercase) search query.
 * @param values - Candidate values to check (strings, null, or undefined).
 * @returns `true` when no query is present or when at least one value contains
 * the query case-insensitively.
 */
export function matchesSearchQuery(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  // Empty query means "show everything" in list filtering contexts.
  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchQuery(query);
  const separatedQuery = normalizeSearchSeparators(query);
  const compactQuery = normalizeSearchCompact(query);
  return values.some((value) => {
    if (!value) {
      return false;
    }

    const normalizedValue = normalizeSearchQuery(value);
    return (
      normalizedValue.includes(normalizedQuery) ||
      (!!separatedQuery &&
        normalizeSearchSeparators(value).includes(separatedQuery)) ||
      (!!compactQuery && normalizeSearchCompact(value).includes(compactQuery))
    );
  });
}
