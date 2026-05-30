/**
 * @file src/bun/pi/web-server/share.ts
 * @description Shared helpers for stable web-server share URLs, cookies, and tokens.
 */

import { createHash } from "node:crypto";

import { isPublicTlsEnabled, TLS_PUBLIC_TRANSPORT_ENV } from "../../tls-config";

export const DEFAULT_WEB_SERVER_SHARE_PORT = 7600;
export const WEB_SERVER_SHARE_PORT_ENV = "METIDOS_WEB_SERVER_SHARE_PORT";
export const WEB_SERVER_SHARE_ORIGIN_ENV = "METIDOS_WEB_SERVER_SHARE_ORIGIN";
export const WEB_SERVER_SHARE_HOST_ENV = "METIDOS_WEB_SERVER_SHARE_HOST";
export const WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST_ENV =
  "METIDOS_WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST";
export const WEB_SERVER_SHARE_COOKIE_NAME = "metidos_web_server_share";
export const WEB_SERVER_SHARE_COOKIE_PATH = "/";
export const WEB_SERVER_SHARE_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER =
  "x-metidos-web-server-instance-id";
export const WEB_SERVER_SHARE_SERVER_HOST = "127.0.0.1";
export const WEB_SERVER_SHARE_UPSTREAM_HOST = "127.0.0.1";

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function generateWebServerShareOpaqueToken(length = 32): string {
  return Buffer.from(randomBytes(length)).toString("base64url");
}

export function hashWebServerShareOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookieHeaderValue(
  cookieHeader: string,
  name: string,
): string | null {
  for (const entry of cookieHeader.split(";")) {
    const trimmedEntry = entry.trim();
    const separatorIndex = trimmedEntry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const rawName = trimmedEntry.slice(0, separatorIndex).trim();
    if (rawName !== name) {
      continue;
    }
    const rawValue = trimmedEntry.slice(separatorIndex + 1).trim();
    if (!rawValue) {
      return null;
    }
    if (
      rawValue.length >= 2 &&
      rawValue.startsWith('"') &&
      rawValue.endsWith('"')
    ) {
      return rawValue.slice(1, -1);
    }
    return rawValue;
  }
  return null;
}

export function readWebServerShareSessionCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  return parseCookieHeaderValue(cookieHeader, WEB_SERVER_SHARE_COOKIE_NAME);
}

export function stripWebServerShareSessionCookieHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const forwardedCookies = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return entry.length > 0;
      }
      return (
        entry.slice(0, separatorIndex).trim() !== WEB_SERVER_SHARE_COOKIE_NAME
      );
    });

  return forwardedCookies.length === 0 ? null : forwardedCookies.join("; ");
}

export function buildWebServerShareSessionCookiePath(
  threadId: number,
  serverId: number,
): string {
  return `/s/${threadId}/${serverId}/`;
}

export function buildWebServerShareSessionCookieHeader(
  sessionToken: string,
  options: {
    maxAgeSeconds: number;
    path?: string;
    secure: boolean;
  },
): string {
  const cookiePath = options.path ?? WEB_SERVER_SHARE_COOKIE_PATH;
  const parts = [
    `${WEB_SERVER_SHARE_COOKIE_NAME}=${sessionToken}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearedWebServerShareSessionCookieHeader(
  secure: boolean,
  options?: {
    path?: string;
  },
): string {
  const cookiePath = options?.path ?? WEB_SERVER_SHARE_COOKIE_PATH;
  const parts = [
    `${WEB_SERVER_SHARE_COOKIE_NAME}=`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function resolveWebServerSharePort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configuredPort = env[WEB_SERVER_SHARE_PORT_ENV]?.trim();
  if (!configuredPort) {
    return DEFAULT_WEB_SERVER_SHARE_PORT;
  }
  if (!/^\d+$/u.test(configuredPort)) {
    throw new Error(
      `Invalid ${WEB_SERVER_SHARE_PORT_ENV} value "${configuredPort}". Expected an integer between 1 and 65535.`,
    );
  }
  const parsedPort = Number.parseInt(configuredPort, 10);
  if (parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(
      `Invalid ${WEB_SERVER_SHARE_PORT_ENV} value "${configuredPort}". Expected an integer between 1 and 65535.`,
    );
  }
  return parsedPort;
}

export function formatWebServerHttpOrigin(
  host: string,
  port: number,
  secure = false,
): string {
  const url = new URL(
    `${secure ? "https" : "http"}://${host.includes(":") ? `[${host}]` : host}`,
  );
  url.port = String(port);
  return url.origin;
}

export function resolveWebServerShareOrigin(
  options: { fallbackHost?: string | null; env?: NodeJS.ProcessEnv } = {},
): string {
  const env = options.env ?? process.env;
  const configuredOrigin = env[WEB_SERVER_SHARE_ORIGIN_ENV]?.trim();
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/u, "");
  }

  const sharePort = resolveWebServerSharePort(env);
  const publicOrigin = env.METIDOS_PUBLIC_ORIGIN?.trim();
  if (publicOrigin) {
    try {
      const parsed = new URL(publicOrigin);
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
      return parsed.origin;
    } catch {
      // Fall through to the computed host-based origin below.
    }
  }

  const fallbackHost = options.fallbackHost?.trim() || "127.0.0.1";
  return formatWebServerHttpOrigin(fallbackHost, sharePort, false);
}

export function buildWebServerShareRoutePath(
  threadId: number,
  serverId: number,
  remainingPath = "/",
): string {
  const normalizedRemainingPath = remainingPath.startsWith("/")
    ? remainingPath
    : `/${remainingPath}`;
  return `/s/${threadId}/${serverId}${normalizedRemainingPath}`;
}

export function buildWebServerShareRouteUrl(
  origin: string,
  threadId: number,
  serverId: number,
  remainingPath = "/",
): string {
  return new URL(
    buildWebServerShareRoutePath(threadId, serverId, remainingPath),
    `${origin.replace(/\/+$/u, "")}/`,
  ).toString();
}

function isLoopbackWebServerShareHost(host: string): boolean {
  const normalizedHost = host.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  return (
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalizedHost)
  );
}

export function resolveWebServerShareHost(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredHost = env[WEB_SERVER_SHARE_HOST_ENV]?.trim();
  if (!configuredHost) {
    return WEB_SERVER_SHARE_SERVER_HOST;
  }
  if (configuredHost === "0.0.0.0" || configuredHost === "::") {
    return WEB_SERVER_SHARE_SERVER_HOST;
  }
  if (isLoopbackWebServerShareHost(configuredHost)) {
    return configuredHost;
  }
  if (
    env[WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST_ENV]?.trim().toLowerCase() === "true"
  ) {
    if (!isPublicTlsEnabled([], env)) {
      throw new Error(
        `Refusing ${WEB_SERVER_SHARE_HOST_ENV} value "${configuredHost}" on a non-loopback interface without TLS. Set ${TLS_PUBLIC_TRANSPORT_ENV}=1 or pass --tls when exposing share routes publicly.`,
      );
    }
    return configuredHost;
  }
  throw new Error(
    `Refusing ${WEB_SERVER_SHARE_HOST_ENV} value "${configuredHost}" because web-server shares bind to loopback by default. Set ${WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST_ENV}=true only if you intentionally want to expose share routes on a non-loopback interface.`,
  );
}

export function buildWebServerShareOpenUrl(
  origin: string,
  claimToken?: string | null,
): string {
  const url = new URL("/share/open", `${origin.replace(/\/+$/u, "")}/`);
  if (claimToken) {
    url.hash = new URLSearchParams({ claimToken }).toString();
  }
  return url.toString();
}
