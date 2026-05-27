/**
 * @file src/mainview/app/path-display-state.ts
 * @description Focused path separator and display formatting helpers.
 */

const FORMAT_PATH_FOR_DISPLAY_CACHE_MAX_ENTRIES = 2_048;
const formatPathForDisplayCache = new Map<string, string>();

/**
 * Detect file separator by inspecting path shape so formatting works cross-platform.
 */
export function pathSeparator(value: string): string {
  return value.includes("\\") ? "\\" : "/";
}

/**
 * Return path with a trailing separator if absent for display/input composition.
 */
export function ensureTrailingSeparator(value: string): string {
  const separator = pathSeparator(value);
  return value.endsWith("/") || value.endsWith("\\")
    ? value
    : `${value}${separator}`;
}

/**
 * Formats directory path for input.
 * @param value - Input value.
 * @param homeDirectory - homeDirectory value.
 * @param supportsTildePath - supportsTildePath path used by formatDirectoryPathForInput.
 */
export function formatDirectoryPathForInput(
  value: string,
  homeDirectory: string,
  supportsTildePath: boolean,
): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (!supportsTildePath || !homeDirectory) {
    return ensureTrailingSeparator(normalized);
  }

  const normalizedHomeDirectory = homeDirectory.replace(/[\\/]+$/, "");
  if (
    normalized === normalizedHomeDirectory ||
    normalized.startsWith(
      `${normalizedHomeDirectory}${pathSeparator(normalized)}`,
    )
  ) {
    const suffix = normalized.slice(normalizedHomeDirectory.length);
    return ensureTrailingSeparator(`~${suffix}`);
  }

  return ensureTrailingSeparator(normalized);
}

/**
 * Render a path with a leading `~` when it shares the same home directory.
 */
export function formatPathForDisplay(
  path: string,
  homeDirectory: string,
  supportsTildePath: boolean,
): string {
  const cacheKey = `${supportsTildePath ? "1" : "0"}\u0000${homeDirectory}\u0000${path}`;
  const cached = formatPathForDisplayCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let formattedPath = path;
  if (supportsTildePath && homeDirectory) {
    const normalizedHomeDirectory = homeDirectory.replace(/[\\/]+$/, "");
    if (path === normalizedHomeDirectory) {
      formattedPath = "~";
    } else if (
      path.startsWith(`${normalizedHomeDirectory}${pathSeparator(path)}`)
    ) {
      formattedPath = `~${path.slice(normalizedHomeDirectory.length)}`;
    }
  }

  formatPathForDisplayCache.set(cacheKey, formattedPath);
  if (
    formatPathForDisplayCache.size > FORMAT_PATH_FOR_DISPLAY_CACHE_MAX_ENTRIES
  ) {
    const firstKey = formatPathForDisplayCache.keys().next().value;
    if (firstKey !== undefined) {
      formatPathForDisplayCache.delete(firstKey);
    }
  }

  return formattedPath;
}
