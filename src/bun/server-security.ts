/**
 * @file src/bun/server-security.ts
 * @description Module for server security.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import {
  type InjectedRuntimeConfig,
  RUNTIME_CONFIG_ELEMENT_ID,
} from "../shared/runtime-config";
import { escapeInlineJsonForHtml } from "./mainview-html-bootstrap";

export type { InjectedRuntimeConfig };
export { RUNTIME_CONFIG_ELEMENT_ID };

const LOOPBACK_BROWSER_HOSTS = ["127.0.0.1", "localhost"] as const;
const LOCAL_APP_PROTOCOLS = ["http:", "https:"] as const;
const RUNTIME_CONFIG_SCRIPT_TYPE = "application/json";
const DEFAULT_BROWSER_PORT_BY_PROTOCOL = {
  "http:": 80,
  "https:": 443,
} as const;
const CSP_NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;

/**
 * Canonical loopback bind target for local-only Bun listeners.
 */

export const LOOPBACK_HOSTNAME = "127.0.0.1";
export type BrowserOriginProtocol = (typeof LOCAL_APP_PROTOCOLS)[number];

export function timingSafeTextDigestEqual(
  left: string,
  right: string,
): boolean {
  // Hash-then-compare gives timingSafeEqual fixed-size inputs and avoids its
  // unequal-length throw. Current callers use generated tokens or low-volume
  // operator secrets; do not reuse this helper for high-volume oracle-style
  // comparisons where secret length itself is sensitive.
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function normalizeRuntimeStatsProvidedSecret(
  providedSecret: string | null | undefined,
): string | null {
  if (typeof providedSecret !== "string") {
    return null;
  }

  return providedSecret.trim();
}

export function isRuntimeStatsSecretMatch(
  configuredSecret: string | undefined,
  providedSecret: string | null | undefined,
): boolean {
  const normalizedProvidedSecret =
    normalizeRuntimeStatsProvidedSecret(providedSecret);
  if (!configuredSecret || normalizedProvidedSecret === null) {
    return false;
  }

  // Runtime-stats secrets arrive through HTTP headers or bearer auth, where
  // incidental surrounding whitespace is not significant. Trim the candidate
  // before the fixed-size digest comparison, but do not trim the configured
  // secret so operator configuration remains exact.
  return timingSafeTextDigestEqual(configuredSecret, normalizedProvidedSecret);
}
/**
 * Formats browser origin.
 * @param protocol - The protocol string used to build browser origins.
 * @param host - The host used to build browser origins.
 * @param port - The port used to build browser origins.
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
 * @param origin - The request origin string to validate.
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
 * Build the configured websocket/browser origin allowlist from env-style inputs.
 */
export function buildConfiguredBrowserOrigins(options: {
  allowedOrigins?: string | undefined;
  publicOrigin?: string | undefined;
}): string[] {
  const normalized = new Set<string>();
  for (const origin of parseAllowedBrowserOrigins(options.allowedOrigins)) {
    normalized.add(origin);
  }
  for (const origin of parseAllowedBrowserOrigins(options.publicOrigin)) {
    normalized.add(origin);
  }
  return [...normalized];
}

/**
 * Build the normalized browser-origin allowlist for the main HTTP/WebSocket server.
 *
 * The allowlist is rebuilt after Bun chooses the final listen port so dev-mode
 * port fallback stays same-origin with the actual Mainview URL. Conventional
 * localhost reverse-proxy ports remain explicitly local-only convenience entries;
 * public TLS deployments must still pass their browser-facing origin through
 * METIDOS_PUBLIC_ORIGIN or METIDOS_ALLOWED_WS_ORIGINS.
 */
export function buildMainServerBrowserOrigins(options: {
  activeServerPort: number;
  configuredOrigins: Iterable<string>;
  httpProxyPort: number;
  httpsProxyPort: number;
}): Set<string> {
  return normalizeBrowserOriginSet([
    ...buildLoopbackBrowserOrigins(options.activeServerPort),
    ...buildLoopbackBrowserOrigins(options.httpProxyPort, {
      protocols: ["http:"],
    }),
    ...buildLoopbackBrowserOrigins(options.httpsProxyPort, {
      protocols: ["https:"],
    }),
    ...options.configuredOrigins,
  ]);
}

export function normalizeBrowserOriginSet(
  origins: Iterable<string>,
): Set<string> {
  const normalized = new Set<string>();
  for (const origin of origins) {
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    if (normalizedOrigin) {
      normalized.add(normalizedOrigin);
    }
  }
  return normalized;
}

/**
 * Allow missing Origin for non-browser local clients but validate browser origins strictly.
 */

export function isWebSocketOriginAllowed<
  PreNormalizedAllowedOrigins extends boolean = false,
>(
  origin: string | null,
  allowedOrigins: PreNormalizedAllowedOrigins extends true
    ? Set<string>
    : Iterable<string>,
  options?: {
    requireOrigin?: boolean;
    preNormalizedAllowedOrigins?: PreNormalizedAllowedOrigins;
  },
): boolean {
  if (typeof origin !== "string" || origin.trim() === "") {
    // Intentional compatibility path for trusted local non-browser clients.
    // Browser-facing websocket routes must pass requireOrigin: true so ambient
    // cookies cannot authenticate cross-site or opaque-origin websocket upgrades.
    return options?.requireOrigin !== true;
  }

  const normalizedOrigin = normalizeBrowserOrigin(origin.trim());
  if (!normalizedOrigin) {
    return false;
  }

  const allowed =
    options?.preNormalizedAllowedOrigins === true &&
    allowedOrigins instanceof Set
      ? allowedOrigins
      : normalizeBrowserOriginSet(allowedOrigins);
  return allowed.has(normalizedOrigin);
}
/**
 * Normalizes connect source.
 * @param url - Request URL.
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
 * Builds content security policy.
 * @param connectUrls - The allowed connect URLs used for CSP directives.
 */

function normalizeContentSecurityPolicyNonce(nonce: string): string {
  const normalized = nonce.trim();
  if (!normalized || !CSP_NONCE_PATTERN.test(normalized)) {
    throw new Error(
      "Content Security Policy nonce contains unsupported characters.",
    );
  }
  return normalized;
}

export function buildContentSecurityPolicy(
  connectUrls: string[] = [],
  options?: {
    styleNonce?: string;
  },
): string {
  const connectSources = new Set<string>(["'self'"]);
  for (const url of connectUrls) {
    const source = normalizeConnectSource(url);
    if (source) {
      connectSources.add(source);
    }
  }

  const styleNonce = options?.styleNonce
    ? normalizeContentSecurityPolicyNonce(options.styleNonce)
    : "";
  const styleSources = styleNonce
    ? [`'self'`, `'nonce-${styleNonce}'`]
    : [`'self'`];

  // `wasm-unsafe-eval` and `font-src data:` are deliberate local-app tradeoffs:
  // Ghostty's terminal renderer needs WebAssembly, and packaged font fallbacks
  // may be inlined by the build pipeline. Inline JavaScript stays blocked; the
  // JSON bootstrap/runtime-config elements use application/json and are not
  // executable script. The nonce is only for controlled dynamic style elements.
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
    "script-src 'self' 'wasm-unsafe-eval'",
    `style-src ${styleSources.join(" ")}`,
    `style-src-elem ${styleSources.join(" ")}`,
    "style-src-attr 'none'",
  ].join("; ");
}

const DEFAULT_CONTENT_SECURITY_POLICY = buildContentSecurityPolicy([]);

/**
 * Applies security headers.
 * @param headers - HTTP headers.
 * @param options - Configuration options used by this operation.
 */

export function applySecurityHeaders(
  headers: Headers,
  options?: {
    connectUrls?: string[];
    strictTransportSecurity?: boolean;
    styleNonce?: string;
  },
): Headers {
  headers.set(
    "content-security-policy",
    options?.connectUrls && options.connectUrls.length > 0
      ? buildContentSecurityPolicy(
          options.connectUrls,
          typeof options.styleNonce === "string"
            ? {
                styleNonce: options.styleNonce,
              }
            : undefined,
        )
      : options?.styleNonce
        ? buildContentSecurityPolicy([], {
            styleNonce: options.styleNonce,
          })
        : DEFAULT_CONTENT_SECURITY_POLICY,
  );
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  headers.set("referrer-policy", "no-referrer");
  // HSTS is opt-in because the default deployment is a loopback/local app and
  // development HTTP origins must not be pinned accidentally.
  if (options?.strictTransportSecurity === true) {
    headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return headers;
}
/**
 * Builds runtime config element.
 * @param runtimeConfig - Runtime configuration data embedded into the meta element.
 */

export function buildRuntimeConfigElement(
  runtimeConfig: InjectedRuntimeConfig,
): string {
  return `<script id="${RUNTIME_CONFIG_ELEMENT_ID}" type="${RUNTIME_CONFIG_SCRIPT_TYPE}">${escapeInlineJsonForHtml(
    JSON.stringify(runtimeConfig),
  )}</script>`;
}

/**
 * Smallest health payload allowed before authentication exists.
 * @param ok - The boolean result returned by the check.
 */
export function buildLivenessPayload(ok: boolean): { ok: boolean } {
  return {
    ok,
  };
}
