/**
 * @file src/bun/pi/web-server/share-thread.ts
 * @description Dedicated share/proxy worker for stable web-server share URLs.
 */

import { Database } from "bun:sqlite";
import { parentPort, workerData } from "node:worker_threads";

import {
  applyAppDatabasePragmas,
  createWebServerShareSession,
  deleteExpiredWebServerShareSessions,
  getActiveWebServerShareByClaimToken,
  getActiveWebServerShareByServerInstanceId,
  resolveActiveWebServerShareSession,
  revokeWebServerShareSessionsByServerInstanceId,
  rotateWebServerShareClaimToken,
  SQL_BUSY_TIMEOUT_MS,
  stopWebServerShareByServerInstanceId,
} from "../../db";
import { createSubsystemLogger } from "../../logging";
import { safeOutboundFetchWithTimeout } from "../../safe-outbound-fetch";
import { applySecurityHeaders } from "../../server-security";
import { createTokenBucketRateLimiter } from "../../token-bucket-rate-limit";
import {
  buildClearedWebServerShareSessionCookieHeader,
  buildWebServerShareRoutePath,
  buildWebServerShareSessionCookieHeader,
  buildWebServerShareSessionCookiePath,
  generateWebServerShareOpaqueToken,
  hashWebServerShareOpaqueToken,
  readWebServerShareSessionCookie,
  stripWebServerShareSessionCookieHeader,
  WEB_SERVER_SHARE_SERVER_HOST,
  WEB_SERVER_SHARE_SESSION_LIFETIME_MS,
  WEB_SERVER_SHARE_UPSTREAM_HOST,
  WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER,
} from "./share";

type WebServerShareWorkerCommand = {
  type: "kill";
};

type WebServerShareWorkerStatusMessage =
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ready";
      host: string;
      port: number;
    }
  | {
      type: "stopped";
    };

type WebServerShareWorkerConfig = {
  dbPath?: string;
  host?: string;
  maxConcurrentProxyFetchesPerShare?: number;
  maxProxyResponseBodyBytes?: number;
  outboundFetchTimeoutMs?: number;
  port?: number;
  secureCookies?: boolean;
};

const logger = createSubsystemLogger("Web Server Share Worker");
const configuredWorkerData =
  typeof workerData === "object" && workerData !== null
    ? (workerData as WebServerShareWorkerConfig)
    : {};
const configuredHost =
  configuredWorkerData.host?.trim() || WEB_SERVER_SHARE_SERVER_HOST;
const configuredPort = configuredWorkerData.port;
const configuredDbPath = configuredWorkerData.dbPath?.trim() ?? "";
const secureCookies = configuredWorkerData.secureCookies === true;
const configuredMaxConcurrentProxyFetchesPerShare =
  configuredWorkerData.maxConcurrentProxyFetchesPerShare;
const configuredMaxProxyResponseBodyBytes =
  configuredWorkerData.maxProxyResponseBodyBytes;
const configuredOutboundFetchTimeoutMs =
  configuredWorkerData.outboundFetchTimeoutMs;
const MAX_SHARE_CLAIM_BODY_BYTES = 4 * 1024;
const MAX_PROXY_REQUEST_BODY_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_PROXY_FETCHES_PER_SHARE = 16;
const DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES = 100 * 1024 * 1024;
const DEFAULT_SHARE_PROXY_OUTBOUND_FETCH_TIMEOUT_MS = 60_000;
const SHARE_DECIMAL_RADIX = 10;
const DEFAULT_HTTP_PORT = "80";
const DEFAULT_HTTPS_PORT = "443";
const maxConcurrentProxyFetchesPerShare =
  typeof configuredMaxConcurrentProxyFetchesPerShare === "number" &&
  Number.isInteger(configuredMaxConcurrentProxyFetchesPerShare) &&
  configuredMaxConcurrentProxyFetchesPerShare > 0
    ? configuredMaxConcurrentProxyFetchesPerShare
    : DEFAULT_MAX_CONCURRENT_PROXY_FETCHES_PER_SHARE;
const maxProxyResponseBodyBytes =
  typeof configuredMaxProxyResponseBodyBytes === "number" &&
  Number.isInteger(configuredMaxProxyResponseBodyBytes) &&
  configuredMaxProxyResponseBodyBytes > 0
    ? configuredMaxProxyResponseBodyBytes
    : DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES;
const shareProxyOutboundFetchTimeoutMs =
  typeof configuredOutboundFetchTimeoutMs === "number" &&
  Number.isInteger(configuredOutboundFetchTimeoutMs) &&
  configuredOutboundFetchTimeoutMs > 0
    ? configuredOutboundFetchTimeoutMs
    : DEFAULT_SHARE_PROXY_OUTBOUND_FETCH_TIMEOUT_MS;
const SHARE_OPEN_CLIENT_SCRIPT = `
(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get("claimToken");
  if (!token) return;
  history.replaceState(null, document.title, location.pathname + location.search);
  const response = await fetch("/share/open", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimToken: token }) });
  if (response.ok) {
    const payload = await response.json();
    if (typeof payload.redirectTo === "string") location.replace(payload.redirectTo);
  }
})();
`;
const SHARE_STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";
const SHARE_PROXY_FAILURE_WINDOW_MS = 60_000;
const SHARE_PROXY_FAILURE_STOP_THRESHOLD = 3;
const SHARE_OPEN_RATE_LIMIT_CAPACITY = 30;
const SHARE_OPEN_RATE_LIMIT_REFILL_INTERVAL_MS = 20_000;
const SHARE_OPEN_RATE_LIMIT_MAX_BUCKETS = 2_048;
const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const SHARE_PROXY_RESPONSE_HEADER_ALLOWLIST = new Set([
  "accept-ranges",
  "cache-control",
  "content-encoding",
  "content-language",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "location",
  "vary",
]);

let database: Database | null = null;
let server: Bun.Server<unknown> | null = null;
const shareProxyFailureBuckets = new Map<string, number[]>();
const shareProxyConcurrentFetches = new Map<string, number>();
const shareOpenRateLimiter = createTokenBucketRateLimiter({
  capacity: SHARE_OPEN_RATE_LIMIT_CAPACITY,
  maxBuckets: SHARE_OPEN_RATE_LIMIT_MAX_BUCKETS,
  refillIntervalMs: SHARE_OPEN_RATE_LIMIT_REFILL_INTERVAL_MS,
  refillTokens: 1,
});

function postStatus(payload: WebServerShareWorkerStatusMessage): void {
  parentPort?.postMessage(payload);
}

function postError(error: unknown): void {
  postStatus({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

function applyShareSecurityHeaders(headers: Headers): Headers {
  applySecurityHeaders(headers);
  if (secureCookies) {
    headers.set("strict-transport-security", SHARE_STRICT_TRANSPORT_SECURITY);
  }
  return headers;
}

function textResponse(
  body: string,
  status: number,
  options?: {
    headers?: HeadersInit;
  },
): Response {
  return new Response(body, {
    headers: applyShareSecurityHeaders(
      new Headers({
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        ...(options?.headers ?? {}),
      }),
    ),
    status,
  });
}

function jsonResponse(
  payload: Record<string, unknown>,
  status: number,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(payload), {
    headers: applyShareSecurityHeaders(
      new Headers({
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        ...(headers ?? {}),
      }),
    ),
    status,
  });
}

async function readLimitedRequestText(
  request: Request,
  maxBytes: number,
  errorMessage: string,
): Promise<string> {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, SHARE_DECIMAL_RADIX);
    if (!Number.isFinite(parsedLength) || parsedLength > maxBytes) {
      throw new Error(errorMessage);
    }
  }
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      bytesRead += next.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(errorMessage);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks, bytesRead));
}

async function readClaimTokenFromBody(request: Request): Promise<string> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Share claims must use application/json.");
  }
  const body = await readLimitedRequestText(
    request,
    MAX_SHARE_CLAIM_BODY_BYTES,
    "Share claim request body is too large.",
  );
  const parsed = JSON.parse(body) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Share claim request body must be an object.");
  }
  const claimToken = (parsed as { claimToken?: unknown }).claimToken;
  return typeof claimToken === "string" ? claimToken.trim() : "";
}

function parseContentLengthHeader(
  headers: Headers,
  errorMessage: string,
): number | null {
  const contentLength = headers.get("content-length")?.trim();
  if (!contentLength) {
    return null;
  }
  const parsedLength = Number.parseInt(contentLength, SHARE_DECIMAL_RADIX);
  if (
    !Number.isFinite(parsedLength) ||
    parsedLength < 0 ||
    String(parsedLength) !== contentLength
  ) {
    throw new Error(errorMessage);
  }
  return parsedLength;
}

function withLimitedRequestBody(
  request: Request,
): ReadableStream<Uint8Array> | null {
  if (!request.body) {
    return null;
  }
  const parsedLength = parseContentLengthHeader(
    request.headers,
    "Proxied request body is too large.",
  );
  if (
    typeof parsedLength === "number" &&
    parsedLength > MAX_PROXY_REQUEST_BODY_BYTES
  ) {
    throw new Error("Proxied request body is too large.");
  }

  let bytesRead = 0;
  const reader = request.body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      bytesRead += next.value.byteLength;
      if (bytesRead > MAX_PROXY_REQUEST_BODY_BYTES) {
        controller.error(new Error("Proxied request body is too large."));
        await reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function withLimitedResponseBody(
  response: Response,
): ReadableStream<Uint8Array> | null {
  const parsedLength = parseContentLengthHeader(
    response.headers,
    "Upstream response body is too large.",
  );
  if (
    typeof parsedLength === "number" &&
    parsedLength > maxProxyResponseBodyBytes
  ) {
    throw new Error("Upstream response body is too large.");
  }
  if (!response.body) {
    return null;
  }

  let bytesRead = 0;
  const reader = response.body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      bytesRead += next.value.byteLength;
      if (bytesRead > maxProxyResponseBodyBytes) {
        controller.error(new Error("Upstream response body is too large."));
        await reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function noteShareProxySuccess(serverInstanceId: string): void {
  shareProxyFailureBuckets.delete(serverInstanceId);
}

function acquireShareProxyFetchSlot(serverInstanceId: string): boolean {
  const activeCount = shareProxyConcurrentFetches.get(serverInstanceId) ?? 0;
  if (activeCount >= maxConcurrentProxyFetchesPerShare) {
    return false;
  }
  shareProxyConcurrentFetches.set(serverInstanceId, activeCount + 1);
  return true;
}

function releaseShareProxyFetchSlot(serverInstanceId: string): void {
  const activeCount = shareProxyConcurrentFetches.get(serverInstanceId) ?? 0;
  if (activeCount <= 1) {
    shareProxyConcurrentFetches.delete(serverInstanceId);
    return;
  }
  shareProxyConcurrentFetches.set(serverInstanceId, activeCount - 1);
}

function noteShareProxyFailure(serverInstanceId: string): number {
  const now = Date.now();
  const cutoff = now - SHARE_PROXY_FAILURE_WINDOW_MS;
  const failures = (
    shareProxyFailureBuckets.get(serverInstanceId) ?? []
  ).filter((failedAt) => failedAt > cutoff);
  failures.push(now);
  shareProxyFailureBuckets.set(serverInstanceId, failures);
  return failures.length;
}

function shouldStopShareAfterProxyFailure(serverInstanceId: string): boolean {
  return (
    noteShareProxyFailure(serverInstanceId) >=
    SHARE_PROXY_FAILURE_STOP_THRESHOLD
  );
}

function resolveDatabase(): Database {
  if (!database) {
    throw new Error("Web server share database is unavailable.");
  }
  return database;
}

function parseStableShareRouteId(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, SHARE_DECIMAL_RADIX);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    String(parsed) !== value
  ) {
    return null;
  }
  return parsed;
}

function normalizeStableShareRemainingPath(
  remainingPath: string | undefined,
): string | null {
  if (!remainingPath || remainingPath === "/") {
    return "/";
  }
  if (!remainingPath.startsWith("/")) {
    return null;
  }

  const normalizedPathname = new URL(
    remainingPath,
    "http://metidos-share-route.invalid/",
  ).pathname;
  if (normalizedPathname !== remainingPath) {
    return null;
  }

  const segments = remainingPath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    if (segment === "") {
      if (index === segments.length - 1) {
        continue;
      }
      return null;
    }
    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decodedSegment === "." || decodedSegment === "..") {
      return null;
    }
  }

  return remainingPath;
}

function parseThreadAndServerIds(pathname: string): {
  remainingPath: string;
  serverId: number;
  threadId: number;
} | null {
  const match = pathname.match(/^\/s\/(\d+)\/(\d+)(\/.*)?$/u);
  if (!match) {
    return null;
  }
  const threadId = parseStableShareRouteId(match[1]);
  const serverId = parseStableShareRouteId(match[2]);
  const remainingPath = normalizeStableShareRemainingPath(match[3]);
  if (threadId === null || serverId === null || remainingPath === null) {
    return null;
  }
  return {
    remainingPath,
    serverId,
    threadId,
  };
}

function normalizedOriginPort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  if (url.protocol === "http:") {
    return DEFAULT_HTTP_PORT;
  }
  if (url.protocol === "https:") {
    return DEFAULT_HTTPS_PORT;
  }
  return "";
}

function normalizedLoopbackHost(hostname: string): string {
  const normalizedHostname = hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
  if (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "0:0:0:0:0:0:0:1"
  ) {
    return "loopback";
  }
  return normalizedHostname;
}

function stripWebServerShareSessionCookie(headers: Headers): void {
  const forwardedCookieHeader = stripWebServerShareSessionCookieHeader(
    headers.get("cookie"),
  );
  if (forwardedCookieHeader) {
    headers.set("cookie", forwardedCookieHeader);
    return;
  }
  headers.delete("cookie");
}

function stripSensitiveProxyRequestHeaders(headers: Headers): void {
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.delete("x-api-key");
  stripWebServerShareSessionCookie(headers);
  for (const headerName of [...headers.keys()]) {
    if (headerName.toLowerCase().startsWith("proxy-")) {
      headers.delete(headerName);
    }
  }
}

function stripHopByHopHeaders(headers: Headers): void {
  const connectionHeaders = headers.get("connection")?.split(",") ?? [];
  for (const headerName of [...HOP_BY_HOP_HEADERS, ...connectionHeaders]) {
    const normalizedHeaderName = headerName.trim();
    if (normalizedHeaderName) {
      headers.delete(normalizedHeaderName);
    }
  }
}

function buildShareProxyResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of upstreamHeaders) {
    const normalizedName = name.toLowerCase();
    if (SHARE_PROXY_RESPONSE_HEADER_ALLOWLIST.has(normalizedName)) {
      headers.append(name, value);
    }
  }
  stripHopByHopHeaders(headers);
  return headers;
}

function locationTargetsUpstreamOrigin(
  location: URL,
  upstreamOrigin: string,
): boolean {
  const upstreamUrl = new URL(upstreamOrigin);
  return (
    location.protocol === upstreamUrl.protocol &&
    normalizedOriginPort(location) === normalizedOriginPort(upstreamUrl) &&
    normalizedLoopbackHost(location.hostname) ===
      normalizedLoopbackHost(upstreamUrl.hostname)
  );
}

function rewriteProxyLocationHeader(options: {
  locationHeader: string;
  requestUrl: URL;
  serverId: number;
  threadId: number;
  upstreamOrigin: string;
}): string {
  try {
    const parsedLocation = new URL(options.locationHeader, options.requestUrl);
    if (
      !locationTargetsUpstreamOrigin(parsedLocation, options.upstreamOrigin)
    ) {
      return options.requestUrl.origin;
    }
    return new URL(
      buildWebServerShareRoutePath(
        options.threadId,
        options.serverId,
        parsedLocation.pathname || "/",
      ) +
        parsedLocation.search +
        parsedLocation.hash,
      options.requestUrl,
    ).toString();
  } catch {
    return options.locationHeader;
  }
}

function requestHasTrustedShareOrigin(
  request: Request,
  requestUrl: URL,
): boolean {
  const expectedOrigin = requestUrl.origin;
  const originHeader = request.headers.get("origin")?.trim();
  if (originHeader) {
    return originHeader === expectedOrigin;
  }
  const refererHeader = request.headers.get("referer")?.trim();
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

async function handleOpenRoute(
  request: Request,
  requestUrl: URL,
  bunServer: Bun.Server<unknown>,
): Promise<Response> {
  const rateLimitResponse = rateLimitShareOpenRoute(
    request,
    bunServer,
    request.method === "POST" ? "post" : "get",
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  if (request.method === "GET") {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Open Metidos Share</title><p>This share link requires a token delivered by Metidos. Open it from the Metidos UI.</p><script src="/share/open/client.js" defer></script>`,
      {
        headers: applyShareSecurityHeaders(
          new Headers({
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          }),
        ),
        status: 200,
      },
    );
  }
  if (request.method !== "POST") {
    return textResponse("Method not allowed.", 405, {
      headers: {
        allow: "GET, POST",
      },
    });
  }

  if (!requestHasTrustedShareOrigin(request, requestUrl)) {
    return textResponse("Invalid share claim origin.", 403);
  }

  let claimToken = "";
  try {
    claimToken = await readClaimTokenFromBody(request);
  } catch {
    return textResponse("Invalid share claim request.", 400);
  }
  if (!claimToken) {
    return textResponse("Share not found.", 404);
  }

  const db = resolveDatabase();
  deleteExpiredWebServerShareSessions(db);

  const share = getActiveWebServerShareByClaimToken(db, claimToken);
  if (!share) {
    return textResponse("Share not found.", 404);
  }

  const sessionToken = generateWebServerShareOpaqueToken();
  const expiresAt = new Date(
    Date.now() + WEB_SERVER_SHARE_SESSION_LIFETIME_MS,
  ).toISOString();
  revokeWebServerShareSessionsByServerInstanceId(db, share.serverInstanceId);
  createWebServerShareSession(db, {
    expiresAt,
    serverId: share.serverId,
    serverInstanceId: share.serverInstanceId,
    sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
    threadId: share.threadId,
  });
  rotateWebServerShareClaimToken(db, share.id);
  const redirectLocation = buildWebServerShareRoutePath(
    share.threadId,
    share.serverId,
    "/",
  );
  const sessionCookie = buildWebServerShareSessionCookieHeader(sessionToken, {
    maxAgeSeconds: Math.ceil(WEB_SERVER_SHARE_SESSION_LIFETIME_MS / 1000),
    path: buildWebServerShareSessionCookiePath(share.threadId, share.serverId),
    secure: secureCookies,
  });
  return jsonResponse(
    {
      ok: true,
      redirectTo: redirectLocation,
    },
    200,
    {
      "set-cookie": sessionCookie,
    },
  );
}

function readRequestPeerAddress(
  request: Request,
  bunServer: Bun.Server<unknown>,
): string | null {
  try {
    return bunServer.requestIP(request)?.address ?? null;
  } catch {
    return null;
  }
}

function rateLimitShareOpenRoute(
  request: Request,
  bunServer: Bun.Server<unknown>,
  route: "client" | "get" | "post",
): Response | null {
  const peerAddress = readRequestPeerAddress(request, bunServer) ?? "unknown";
  const result = shareOpenRateLimiter.hit(`${route}:${peerAddress}`);
  if (result.allowed) {
    return null;
  }
  return textResponse("Too many share-open requests.", 429, {
    headers: {
      "retry-after": String(result.retryAfterSeconds),
    },
  });
}

async function handleStableShareRoute(
  request: Request,
  requestUrl: URL,
  bunServer: Bun.Server<unknown>,
): Promise<Response> {
  const route = parseThreadAndServerIds(requestUrl.pathname);
  if (!route) {
    return textResponse("Not found.", 404);
  }

  const sessionCookiePath = buildWebServerShareSessionCookiePath(
    route.threadId,
    route.serverId,
  );
  const sessionToken = readWebServerShareSessionCookie(
    request.headers.get("cookie"),
  );
  if (!sessionToken) {
    return textResponse("A valid share session is required.", 403, {
      headers: {
        "set-cookie": buildClearedWebServerShareSessionCookieHeader(
          secureCookies,
          {
            path: sessionCookiePath,
          },
        ),
      },
    });
  }

  const session = resolveActiveWebServerShareSession(
    resolveDatabase(),
    sessionToken,
  );
  if (!session) {
    return textResponse("A valid share session is required.", 403, {
      headers: {
        "set-cookie": buildClearedWebServerShareSessionCookieHeader(
          secureCookies,
          {
            path: sessionCookiePath,
          },
        ),
      },
    });
  }

  if (
    session.threadId !== route.threadId ||
    session.serverId !== route.serverId
  ) {
    return textResponse("Share session does not match this route.", 403, {
      headers: {
        "set-cookie": buildClearedWebServerShareSessionCookieHeader(
          secureCookies,
          {
            path: sessionCookiePath,
          },
        ),
      },
    });
  }

  const share = getActiveWebServerShareByServerInstanceId(
    resolveDatabase(),
    session.serverInstanceId,
  );
  if (
    !share ||
    share.threadId !== route.threadId ||
    share.serverId !== route.serverId
  ) {
    return textResponse("Share not found.", 404, {
      headers: {
        "set-cookie": buildClearedWebServerShareSessionCookieHeader(
          secureCookies,
          {
            path: sessionCookiePath,
          },
        ),
      },
    });
  }

  const upstreamBase = new URL(
    `http://${WEB_SERVER_SHARE_UPSTREAM_HOST}:${share.targetPort}/`,
  );
  const upstreamUrl = new URL(upstreamBase);
  upstreamUrl.pathname = route.remainingPath;
  upstreamUrl.search = requestUrl.search;

  const upstreamHeaders = new Headers(request.headers);
  stripHopByHopHeaders(upstreamHeaders);
  stripSensitiveProxyRequestHeaders(upstreamHeaders);
  upstreamHeaders.delete("host");
  upstreamHeaders.set("x-forwarded-host", requestUrl.host);
  upstreamHeaders.set(
    "x-forwarded-proto",
    requestUrl.protocol.replace(/:$/u, ""),
  );
  const peerAddress = readRequestPeerAddress(request, bunServer);
  if (peerAddress) {
    upstreamHeaders.set("x-forwarded-for", peerAddress);
  } else {
    upstreamHeaders.delete("x-forwarded-for");
  }

  if (!acquireShareProxyFetchSlot(share.serverInstanceId)) {
    return textResponse("Too many concurrent share proxy requests.", 503, {
      headers: {
        "retry-after": "1",
      },
    });
  }

  try {
    const upstreamRequestInit: RequestInit = {
      headers: upstreamHeaders,
      method: request.method,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        upstreamRequestInit.body = withLimitedRequestBody(request);
      } catch {
        return textResponse("Request body too large.", 413);
      }
      (upstreamRequestInit as RequestInit & { duplex: "half" }).duplex = "half";
    }
    const upstreamResponse = await safeOutboundFetchWithTimeout({
      init: upstreamRequestInit,
      timeoutMs: shareProxyOutboundFetchTimeoutMs,
      url: upstreamUrl,
    });
    if (
      upstreamResponse.headers.get(
        WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER,
      ) !== share.serverInstanceId
    ) {
      throw new Error(
        "Upstream did not prove ownership of the shared web-server instance.",
      );
    }
    noteShareProxySuccess(share.serverInstanceId);

    const proxyHeaders = buildShareProxyResponseHeaders(
      upstreamResponse.headers,
    );
    const locationHeader = proxyHeaders.get("location");
    if (locationHeader) {
      proxyHeaders.set(
        "location",
        rewriteProxyLocationHeader({
          locationHeader,
          requestUrl,
          serverId: route.serverId,
          threadId: route.threadId,
          upstreamOrigin: upstreamBase.origin,
        }),
      );
    }

    let proxyBody: ReadableStream<Uint8Array> | null;
    try {
      proxyBody = withLimitedResponseBody(upstreamResponse);
    } catch {
      return textResponse("Upstream response body is too large.", 502);
    }

    return new Response(proxyBody, {
      headers: applyShareSecurityHeaders(proxyHeaders),
      status: upstreamResponse.status,
    });
  } catch (error) {
    const shouldStopShare = shouldStopShareAfterProxyFailure(
      share.serverInstanceId,
    );
    logger.warning({
      error: error instanceof Error ? error.message : String(error),
      message: shouldStopShare
        ? "Stable share proxy failed repeatedly; stopping stale share."
        : "Stable share proxy failed; keeping share active for retry.",
      serverInstanceId: share.serverInstanceId,
      targetPort: share.targetPort,
      threadId: share.threadId,
    });
    if (!shouldStopShare) {
      return textResponse("Upstream share is temporarily unavailable.", 502);
    }
    shareProxyFailureBuckets.delete(share.serverInstanceId);
    stopWebServerShareByServerInstanceId(
      resolveDatabase(),
      share.serverInstanceId,
    );
    return textResponse("Share not found.", 404, {
      headers: {
        "set-cookie": buildClearedWebServerShareSessionCookieHeader(
          secureCookies,
          {
            path: sessionCookiePath,
          },
        ),
      },
    });
  } finally {
    releaseShareProxyFetchSlot(share.serverInstanceId);
  }
}

async function handleRequest(
  request: Request,
  bunServer: Bun.Server<unknown>,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/share/open/client.js") {
    const rateLimitResponse = rateLimitShareOpenRoute(
      request,
      bunServer,
      "client",
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    return new Response(SHARE_OPEN_CLIENT_SCRIPT, {
      headers: applyShareSecurityHeaders(
        new Headers({
          "cache-control": "no-store",
          "content-type": "application/javascript; charset=utf-8",
        }),
      ),
      status: 200,
    });
  }
  if (requestUrl.pathname === "/share/open") {
    return handleOpenRoute(request, requestUrl, bunServer);
  }
  if (requestUrl.pathname.startsWith("/share/open/")) {
    return textResponse("Share tokens are no longer accepted in URLs.", 410);
  }
  if (requestUrl.pathname.startsWith("/s/")) {
    return handleStableShareRoute(request, requestUrl, bunServer);
  }
  return textResponse("Not found.", 404);
}

function stopServer(): void {
  if (server) {
    try {
      server.stop(true);
    } catch {
      // Ignore repeated stop attempts during shutdown.
    }
    server = null;
  }
  if (database) {
    database.close(false);
    database = null;
  }
  postStatus({
    type: "stopped",
  });
}

parentPort?.on("message", (command: WebServerShareWorkerCommand) => {
  if (!command || command.type !== "kill") {
    return;
  }
  stopServer();
});

try {
  if (!configuredDbPath) {
    throw new Error("Web server share worker requires a database path.");
  }
  if (
    typeof configuredPort !== "number" ||
    !Number.isInteger(configuredPort) ||
    configuredPort <= 0
  ) {
    throw new Error("Web server share worker requires a fixed listening port.");
  }
  const listeningPort = configuredPort;

  database = new Database(configuredDbPath);
  // Apply the shared app-DB runtime pragmas to this worker's live database
  // handle after opening configuredDbPath. applyAppDatabasePragmas sets
  // journal_mode before synchronous, so WAL and synchronous settings affect
  // this actual share-worker connection and its database file rather than a
  // detached bootstrap handle.
  applyAppDatabasePragmas(database, {
    busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
  });
  server = Bun.serve({
    fetch: handleRequest,
    hostname: configuredHost,
    port: listeningPort,
  });
  if (typeof server.port !== "number") {
    throw new Error("Web server share worker did not report a listening port.");
  }

  postStatus({
    type: "ready",
    host: configuredHost,
    port: server.port,
  });
} catch (error) {
  try {
    database?.close(false);
  } catch {
    // Ignore shutdown failures while surfacing the startup error.
  }
  database = null;
  postError(error);
}
