/**
 * @file src/bun/auth/service-cookies.ts
 * @description Cookie parsing and serialization helpers for auth flows.
 */

export const AUTH_CLEAR_SITE_DATA_HEADER_VALUE =
  '"cache", "cookies", "storage"';
export const AUTH_CSRF_COOKIE_NAME = "metidos_csrf";
export const AUTH_CSRF_HOST_COOKIE_NAME = "__Host-metidos_csrf";
// Secure deployments use the __Host- CSRF cookie variant below. Plain loopback
// HTTP cannot set Secure cookies, so it falls back to a Path=/auth scoped name;
// the value is still non-authenticating and must match a custom header plus
// same-site/origin checks before any auth mutation is accepted.
export const AUTH_CSRF_COOKIE_PATH = "/auth";
export const AUTH_CSRF_HOST_COOKIE_PATH = "/";
// Keep setup/login usable across page refreshes without making the token a
// long-lived credential: mutation routes still require same-site/fetch-metadata
// origin checks plus a matching custom header, and this cookie is HttpOnly so
// browser JavaScript cannot read it for exfiltration.
export const AUTH_CSRF_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60;
// Bound parsed CSRF token bytes before the digest comparison so malformed or
// hostile Cookie headers cannot force unbounded hashing work on auth routes.
const AUTH_CSRF_TOKEN_MAX_BYTES = 256;
const COOKIE_VALUE_PATTERN = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/u;

import {
  formatHttpDate,
  HOST_SESSION_COOKIE_NAME,
  HOST_WEBSOCKET_TICKET_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  type SessionCookieOptions,
  WEBSOCKET_TICKET_COOKIE_NAME,
  WEBSOCKET_TICKET_COOKIE_PATH,
  WEBSOCKET_TICKET_LIFETIME_MS,
  type WebSocketTicketCookieOptions,
} from "./service-core";

/**
 * Parse one cookie value from a Cookie header.
 * @param cookieHeader - Raw Cookie header.
 * @param name - Cookie name to parse.
 */
export function readUniqueCookieValue(
  cookieHeader: string,
  name: string,
): string | null {
  let value: string | null = null;
  let matchCount = 0;
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) {
      continue;
    }
    matchCount += 1;
    if (matchCount > 1) {
      return null;
    }
    value = rawValueParts.join("=") || null;
  }
  return value;
}

/**
 * Parse the session cookie from an incoming Cookie header.
 * @param cookieHeader - Raw Cookie header.
 */
function assertSafeCookieValue(value: string, label: string): void {
  if (!COOKIE_VALUE_PATTERN.test(value)) {
    throw new Error(
      `${label} contains characters that cannot be serialized in a cookie value.`,
    );
  }
}

function readCookieMatch(
  cookieHeader: string,
  name: string,
): { present: boolean; value: string | null } {
  let value: string | null = null;
  let matchCount = 0;
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) {
      continue;
    }
    matchCount += 1;
    if (matchCount > 1) {
      return { present: true, value: null };
    }
    value = rawValueParts.join("=") || null;
  }
  return { present: matchCount > 0, value };
}

function readPreferredCookieValue(
  cookieHeader: string,
  preferredName: string,
  fallbackName: string,
): string | null {
  // Secure deployments prefer the __Host- cookie, while plain loopback HTTP and
  // migrated browsers may still carry the fallback name. The fallback is not a
  // downgrade path when both are present: any host-prefixed cookie presence wins,
  // and duplicated or empty host-prefixed values reject the request instead of
  // falling back to the legacy name.
  const preferred = readCookieMatch(cookieHeader, preferredName);
  if (preferred.present) {
    return preferred.value;
  }
  return readUniqueCookieValue(cookieHeader, fallbackName);
}

export function readAuthCsrfCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  const token = readPreferredCookieValue(
    cookieHeader,
    AUTH_CSRF_HOST_COOKIE_NAME,
    AUTH_CSRF_COOKIE_NAME,
  );
  if (!token || Buffer.byteLength(token, "utf8") > AUTH_CSRF_TOKEN_MAX_BYTES) {
    return null;
  }
  return token;
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  return readPreferredCookieValue(
    cookieHeader,
    HOST_SESSION_COOKIE_NAME,
    SESSION_COOKIE_NAME,
  );
}

/**
 * Parse the websocket ticket cookie from an incoming Cookie header.
 * @param cookieHeader - Raw Cookie header.
 */
export function readWebSocketTicketCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  return readPreferredCookieValue(
    cookieHeader,
    HOST_WEBSOCKET_TICKET_COOKIE_NAME,
    WEBSOCKET_TICKET_COOKIE_NAME,
  );
}

/**
 * Serialize an authenticated session cookie header.
 * @param sessionId - Session identifier value.
 * @param options - Session cookie attributes.
 */
export function buildSessionCookieHeader(
  sessionId: string,
  options: SessionCookieOptions,
): string {
  assertSafeCookieValue(sessionId, "Session id");
  const parts = [
    `${options.secure ? HOST_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME}=${sessionId}`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    // Metidos is a local/operator app, not an embeddable cross-site widget.
    // Keep ambient credentials out of iframes and cross-site navigations; if an
    // integration later needs embedding, it must add a deliberate auth design
    // rather than weakening the default session cookie.
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize the short-lived websocket ticket cookie used during websocket upgrades.
 * @param ticketId - Ticket identifier.
 * @param options - Ticket cookie attributes.
 */
export function buildAuthCsrfCookieHeader(
  token: string,
  secure: boolean,
): string {
  assertSafeCookieValue(token, "CSRF token");
  const parts = [
    `${secure ? AUTH_CSRF_HOST_COOKIE_NAME : AUTH_CSRF_COOKIE_NAME}=${token}`,
    `Path=${secure ? AUTH_CSRF_HOST_COOKIE_PATH : AUTH_CSRF_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${AUTH_CSRF_TOKEN_MAX_AGE_SECONDS}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildWebSocketTicketCookieHeader(
  ticketId: string,
  options: WebSocketTicketCookieOptions,
): string {
  assertSafeCookieValue(ticketId, "WebSocket ticket id");
  const parts = [
    `${options.secure ? HOST_WEBSOCKET_TICKET_COOKIE_NAME : WEBSOCKET_TICKET_COOKIE_NAME}=${ticketId}`,
    // The ticket is consumed by the /rpc websocket upgrade, so it must be
    // visible outside /auth. It remains HttpOnly, SameSite=Strict, short-lived,
    // and single-use; issuance is protected by auth-route CSRF validation.
    `Path=${WEBSOCKET_TICKET_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds ?? Math.ceil(WEBSOCKET_TICKET_LIFETIME_MS / 1000)}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize a session cookie that forces immediate browser removal.
 * @param secure - Whether to include the Secure attribute.
 */
export function buildClearedSessionCookieHeader(secure: boolean): string {
  const parts = [
    `${secure ? HOST_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME}=`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    `Expires=${formatHttpDate(new Date(0))}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize a websocket ticket cookie that forces immediate removal.
 * @param secure - Whether to include the Secure attribute.
 */
export function buildClearedWebSocketTicketCookieHeader(
  secure: boolean,
): string {
  const parts = [
    `${secure ? HOST_WEBSOCKET_TICKET_COOKIE_NAME : WEBSOCKET_TICKET_COOKIE_NAME}=`,
    `Path=${WEBSOCKET_TICKET_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    `Expires=${formatHttpDate(new Date(0))}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildAllClearedSessionCookieHeaders(): string[] {
  return [
    buildClearedSessionCookieHeader(false),
    buildClearedSessionCookieHeader(true),
  ];
}

export function buildAllClearedWebSocketTicketCookieHeaders(): string[] {
  return [
    buildClearedWebSocketTicketCookieHeader(false),
    buildClearedWebSocketTicketCookieHeader(true),
  ];
}

export function appendAllClearedSessionCookies(headers: Headers): void {
  for (const cookie of buildAllClearedSessionCookieHeaders()) {
    headers.append("set-cookie", cookie);
  }
}

export function appendAllClearedWebSocketTicketCookies(headers: Headers): void {
  for (const cookie of buildAllClearedWebSocketTicketCookieHeaders()) {
    headers.append("set-cookie", cookie);
  }
}

/**
 * Serialize Clear-Site-Data for logout responses so browser caches and storage
 * are dropped alongside explicit cookie expiration.
 */
export function buildLogoutClearSiteDataHeader(): string {
  return AUTH_CLEAR_SITE_DATA_HEADER_VALUE;
}
