/**
 * @file src/bun/auth/usernames.ts
 * @description Shared username normalization and workspace-home safety checks.
 */

export const MAX_USERNAME_LENGTH = 64;
const RESERVED_PATH_CHARACTER_PATTERN = /[:*?"<>|]/u;
const PATH_SEPARATOR_PATTERN = /[\\/]/u;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      typeof codePoint === "number" && (codePoint <= 0x1f || codePoint === 0x7f)
    );
  });
}

export const INVALID_WORKSPACE_HOME_USERNAME_MESSAGE =
  "The username cannot be used for a private workspace home. Choose a name without '.', '..', slashes, or reserved path characters.";

export function normalizeUsername(username: string): string {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }
  if (normalizedUsername.length > MAX_USERNAME_LENGTH) {
    throw new Error(
      `Username must be at most ${MAX_USERNAME_LENGTH} characters.`,
    );
  }
  return normalizedUsername;
}

export function normalizeWorkspaceHomeUsername(username: string): string {
  const normalizedUsername = normalizeUsername(username);
  if (
    normalizedUsername === "." ||
    normalizedUsername === ".." ||
    PATH_SEPARATOR_PATTERN.test(normalizedUsername) ||
    RESERVED_PATH_CHARACTER_PATTERN.test(normalizedUsername) ||
    hasControlCharacters(normalizedUsername)
  ) {
    throw new Error(INVALID_WORKSPACE_HOME_USERNAME_MESSAGE);
  }
  return normalizedUsername;
}
