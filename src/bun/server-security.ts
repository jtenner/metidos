/**
 * @file src/bun/server-security.ts
 * @description Module for server security.
 */

const LOOPBACK_BROWSER_HOSTS = ["127.0.0.1", "localhost"] as const;
const LOCAL_APP_PROTOCOLS = ["http:", "https:"] as const;
const RUNTIME_CONFIG_SCRIPT_TYPE = "application/json";
const DEFAULT_BROWSER_PORT_BY_PROTOCOL = {
  "http:": 80,
  "https:": 443,
} as const;

/**
 * Canonical loopback bind target for local-only Bun listeners.
 */

export const LOOPBACK_HOSTNAME = "127.0.0.1";
export const RUNTIME_CONFIG_ELEMENT_ID = "jolt-runtime-config";
export type BrowserOriginProtocol = (typeof LOCAL_APP_PROTOCOLS)[number];

export type InjectedRuntimeConfig = {
  devServer: boolean;
  healthUrl?: string;
  preferTls?: boolean;
  rpcWebSocketUrl?: string;
};
/**
 * Function of formatBrowserOrigin.
 * @param protocol - The value of `protocol`.
 * @param host - The value of `host`.
 * @param port - The value of `port`.
 */

function formatBrowserOrigin(
  protocol: BrowserOriginProtocol,
  host: (typeof LOOPBACK_BROWSER_HOSTS)[number],
  port: number,
): string {
  const url = new URL(`${protocol}//${host}`);
  if (port !== DEFAULT_BROWSER_PORT_BY_PROTOCOL[protocol]) {
    url.port = String(port);
  }
  return url.origin;
}

/**
 * Normalize a browser origin for exact allowlist comparison.
 * @param origin - The value of `origin`.
 */
function normalizeBrowserOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
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

export function buildLoopbackBrowserOrigins(
  port: number,
  options?: {
    protocols?: readonly BrowserOriginProtocol[];
  },
): string[] {
  const protocols = options?.protocols ?? LOCAL_APP_PROTOCOLS;
  return LOOPBACK_BROWSER_HOSTS.flatMap((host) =>
    protocols.map((protocol) => formatBrowserOrigin(protocol, host, port)),
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

  const allowed = new Set<string>();
  for (const entry of allowedOrigins) {
    const normalizedEntry = normalizeBrowserOrigin(entry);
    if (normalizedEntry) {
      allowed.add(normalizedEntry);
    }
  }
  return allowed.has(normalizedOrigin);
}
/**
 * Function of normalizeConnectSource.
 * @param url - The value of `url`.
 */

function normalizeConnectSource(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "ws:" &&
      parsed.protocol !== "wss:"
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
/**
 * Function of buildContentSecurityPolicy.
 * @param connectUrls - The value of `connectUrls`.
 */

export function buildContentSecurityPolicy(connectUrls: string[] = []): string {
  const connectSources = new Set<string>(["'self'"]);
  for (const url of connectUrls) {
    const source = normalizeConnectSource(url);
    if (source) {
      connectSources.add(source);
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    `connect-src ${[...connectSources].join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");
}
/**
 * Function of applySecurityHeaders.
 * @param headers - The value of `headers`.
 * @param options - The value of `options`.
 */

export function applySecurityHeaders(
  headers: Headers,
  options?: {
    connectUrls?: string[];
  },
): Headers {
  headers.set(
    "content-security-policy",
    buildContentSecurityPolicy(options?.connectUrls ?? []),
  );
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return headers;
}
/**
 * Function of buildRuntimeConfigElement.
 * @param runtimeConfig - The value of `runtimeConfig`.
 */

export function buildRuntimeConfigElement(
  runtimeConfig: InjectedRuntimeConfig,
): string {
  return `<script id="${RUNTIME_CONFIG_ELEMENT_ID}" type="${RUNTIME_CONFIG_SCRIPT_TYPE}">${JSON.stringify(
    runtimeConfig,
  ).replaceAll("</script", "<\\/script")}</script>`;
}

/**
 * Smallest health payload allowed before authentication exists.
 * @param ok - The value of `ok`.
 */
export function buildLivenessPayload(ok: boolean): { ok: boolean } {
  return {
    ok,
  };
}
