export function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesSearchQuery(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  if (!query) {
    return true;
  }
  return values.some((value) => value?.toLowerCase().includes(query));
}
