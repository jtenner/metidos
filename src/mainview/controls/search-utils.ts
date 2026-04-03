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

  // Lowercase defensively to keep matching behavior stable regardless of input casing.
  return values.some((value) => value?.toLowerCase().includes(query));
}
