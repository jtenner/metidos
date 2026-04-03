const LOOPBACK_BROWSER_HOSTS = ["127.0.0.1", "localhost"] as const;
const LOCAL_APP_PROTOCOLS = ["http:", "https:"] as const;

/**
 * Canonical loopback bind target for local-only Bun listeners.
 */
export const LOOPBACK_HOSTNAME = "127.0.0.1";

/**
 * Normalize a browser origin for exact allowlist comparison.
 */
function normalizeBrowserOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (!LOCAL_APP_PROTOCOLS.includes(url.protocol)) {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Build the default browser origins that may legitimately connect to a local port.
 */
export function buildLoopbackBrowserOrigins(port: number): string[] {
  return LOOPBACK_BROWSER_HOSTS.flatMap((host) =>
    LOCAL_APP_PROTOCOLS.map((protocol) => `${protocol}//${host}:${port}`),
  );
}

/**
 * Parse a comma/newline/space separated origin list from configuration.
 */
export function parseAllowedBrowserOrigins(
  value: string | undefined,
): string[] {
  if (!value) {
    return [];
  }

  const normalized = new Set<string>();
  for (const entry of value.split(/[\s,]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const origin = normalizeBrowserOrigin(trimmed);
    if (!origin) {
      throw new Error(`Invalid browser origin "${trimmed}".`);
    }
    normalized.add(origin);
  }
  return [...normalized];
}

/**
 * Allow missing Origin for non-browser local clients but validate browser origins strictly.
 */
export function isWebSocketOriginAllowed(
  origin: string | null,
  allowedOrigins: Iterable<string>,
): boolean {
  if (typeof origin !== "string" || origin.trim() === "") {
    return true;
  }

  const normalizedOrigin = normalizeBrowserOrigin(origin.trim());
  if (!normalizedOrigin) {
    return false;
  }

  const allowed = new Set(allowedOrigins);
  return allowed.has(normalizedOrigin);
}

/**
 * Smallest health payload allowed before authentication exists.
 */
export function buildLivenessPayload(ok: boolean): { ok: boolean } {
  return {
    ok,
  };
}
