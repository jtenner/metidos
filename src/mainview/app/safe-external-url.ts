/**
 * @file src/mainview/app/safe-external-url.ts
 * @description Shared URL validation for browser-initiated external navigation.
 */

export function safeExternalHttpUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
