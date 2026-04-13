/**
 * @file src/bun/auth-service-cookies.ts
 * @description Cookie parsing and serialization helpers for auth flows.
 */

import {
  formatHttpDate,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  type SessionCookieOptions,
  WEBSOCKET_TICKET_COOKIE_NAME,
  WEBSOCKET_TICKET_COOKIE_PATH,
  WEBSOCKET_TICKET_LIFETIME_MS,
  type WebSocketTicketCookieOptions,
} from "./auth-service-core";

/**
 * Parse one cookie value from a Cookie header.
 * @param cookieHeader - Raw Cookie header.
 * @param name - Cookie name to parse.
 */
function parseCookieHeaderValue(
  cookieHeader: string,
  name: string,
): string | null {
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) {
      continue;
    }
    return rawValueParts.join("=") || null;
  }
  return null;
}

/**
 * Parse the session cookie from an incoming Cookie header.
 * @param cookieHeader - Raw Cookie header.
 */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  return parseCookieHeaderValue(cookieHeader, SESSION_COOKIE_NAME);
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
  return parseCookieHeaderValue(cookieHeader, WEBSOCKET_TICKET_COOKIE_NAME);
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
  const parts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize the short-lived websocket ticket cookie used during RPC upgrades.
 * @param ticketId - Ticket identifier.
 * @param options - Ticket cookie attributes.
 */
export function buildWebSocketTicketCookieHeader(
  ticketId: string,
  options: WebSocketTicketCookieOptions,
): string {
  const parts = [
    `${WEBSOCKET_TICKET_COOKIE_NAME}=${ticketId}`,
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
    `${SESSION_COOKIE_NAME}=`,
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
    `${WEBSOCKET_TICKET_COOKIE_NAME}=`,
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
