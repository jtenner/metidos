import { resolve } from "node:path";

import { buildMainviewBundle } from "./build-mainview";
import {
  applySecurityHeaders,
  buildLivenessPayload,
  buildRuntimeConfigElement,
  type InjectedRuntimeConfig,
  LOOPBACK_HOSTNAME,
} from "./server-security";
import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  isPublicTlsEnabled,
  resolveTlsRuntimeConfig,
} from "./tls-config";

// Runtime defaults and well-known paths used by the local static server.
const DEFAULT_PUBLIC_PORT = "7599";
const MAINVIEW_HTML_PATH = resolve(process.cwd(), "src/mainview/index.html");
const MAINVIEW_CSS_PATH = resolve(process.cwd(), "src/mainview/index.css");
const FIRA_CODE_VARIABLE_FONT_PATH = resolve(
  process.cwd(),
  "node_modules/firacode/distr/woff2/FiraCode-VF.woff2",
);
const INTER_VARIABLE_FONT_LATIN_PATH = resolve(
  process.cwd(),
  "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
);
const INTER_VARIABLE_FONT_LATIN_EXT_PATH = resolve(
  process.cwd(),
  "node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
);
const SERVER_IDLE_TIMEOUT_SECONDS = 30;
const BACKEND_HEALTH_TIMEOUT_MS = 1_500;

/**
 * Runtime config passed to the browser so the client can discover RPC endpoints and
 * health route details without additional round trips.
 */
type RuntimeConfig = InjectedRuntimeConfig & {
  healthUrl: string;
};

/**
 * Returns true when a CLI string value is an unsigned decimal integer.
 */
function isStringInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Reads a string flag from `bun` CLI args. Supports both `--flag value` and
 * `--flag=value` forms and returns null if not provided.
 */
function readCliValue(args: string[], flag: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === flag) {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error(`Missing value for ${flag}`);
      }
      return nextArg;
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }

  return null;
}

/**
 * Resolves a validated port number from CLI arg, environment variable, and a fallback.
 * Throws if the resolved value is missing or outside the TCP port range.
 */
function resolvePort(
  args: string[],
  flag: string,
  envValue: string | undefined,
  fallback: string,
): number {
  const configuredPort = readCliValue(args, flag) ?? envValue ?? fallback;
  if (!isStringInteger(configuredPort)) {
    throw new Error(`Invalid port "${configuredPort}" for ${flag}.`);
  }

  const parsedPort = Number.parseInt(configuredPort, 10);
  if (parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Port for ${flag} must be between 1 and 65535.`);
  }

  return parsedPort;
}

/**
 * Creates an HTTP response with a plain text body and explicit content type.
 */
function stringResponse(
  body: string,
  contentType: string,
  status = 200,
  connectUrls: string[] = [],
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": contentType,
  });
  applySecurityHeaders(headers, {
    connectUrls,
  });
  return new Response(body, {
    status,
    headers,
  });
}

/**
 * Creates an HTTP response by streaming the file at `path` and forcing no-cache
 * behavior to ensure UI updates are immediately visible during development.
 */
function fileResponse(
  path: string,
  contentType: string,
  connectUrls: string[] = [],
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": contentType,
  });
  applySecurityHeaders(headers, {
    connectUrls,
  });
  return new Response(Bun.file(path), {
    headers,
  });
}

/**
 * Builds the application HTML response by injecting inert runtime bootstrap data.
 */
async function buildHtmlResponse(
  runtimeConfig: RuntimeConfig,
  connectUrls: string[],
): Promise<Response> {
  const runtimeConfigElement = buildRuntimeConfigElement(runtimeConfig);
  const template = await Bun.file(MAINVIEW_HTML_PATH).text();
  const html = template.includes("</head>")
    ? template.replace("</head>", `${runtimeConfigElement}\n\t</head>`)
    : `${runtimeConfigElement}\n${template}`;

  return stringResponse(html, "text/html; charset=utf-8", 200, connectUrls);
}

/**
 * Probes the backend health endpoint with a short timeout.
 * Returns true only when the backend emits an explicit liveness success.
 */
async function readBackendHealthSnapshot(
  backendHealthUrl: string,
): Promise<boolean> {
  const controller = new AbortController();
  // Use AbortController so a stalled backend does not block /health forever.
  const timeout = setTimeout(() => {
    controller.abort(new Error("Backend health probe timed out."));
  }, BACKEND_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(backendHealthUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    const rawText = await response.text();
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText);
    } catch {
      // Fall back to the raw text body if the backend health response changes.
    }

    return (
      response.ok &&
      typeof body === "object" &&
      body !== null &&
      "ok" in body &&
      body.ok === true
    );
  } catch (error) {
    void error;
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// Top-level CLI parsing and environment-derived defaults for all static-server ports/URLs.
const SERVER_ARGS = Bun.argv.slice(2);
const IS_DEV_SERVER =
  SERVER_ARGS.includes("--dev") || process.env.JOLT_DEV === "1";
const PUBLIC_TLS_ENABLED = isPublicTlsEnabled(SERVER_ARGS, process.env);
const TLS_RUNTIME = resolveTlsRuntimeConfig({
  forceTls: PUBLIC_TLS_ENABLED,
});
const PUBLIC_PORT = resolvePort(
  SERVER_ARGS,
  "--port",
  process.env.JOLT_PUBLIC_PORT,
  DEFAULT_PUBLIC_PORT,
);
const RPC_PORT = resolvePort(
  SERVER_ARGS,
  "--rpc-port",
  process.env.JOLT_RPC_PORT,
  String(PUBLIC_PORT + 1),
);
const RPC_HTTP_ORIGIN =
  process.env.JOLT_RPC_HTTP_ORIGIN?.trim() ||
  formatLoopbackHttpOrigin(RPC_PORT, false);
const RPC_WEBSOCKET_URL =
  process.env.JOLT_RPC_URL?.trim() ||
  formatLoopbackWebSocketUrl(RPC_PORT, false);
const BACKEND_HEALTH_URL =
  process.env.JOLT_RPC_HEALTH_URL?.trim() || `${RPC_HTTP_ORIGIN}/health`;

function resolveForwardedProto(request: Request): "http" | "https" {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();
  if (forwardedProto === "https") {
    return "https";
  }
  if (forwardedProto === "http") {
    return "http";
  }
  if (TLS_RUNTIME.publicTls) {
    return "https";
  }
  return new URL(request.url).protocol === "https:" ? "https" : "http";
}

function readBrowserFacingHost(request: Request): string | null {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    return forwardedHost;
  }

  const hostHeader = request.headers.get("host")?.trim();
  if (hostHeader) {
    return hostHeader;
  }

  try {
    return new URL(request.url).host;
  } catch {
    return null;
  }
}

function isLoopbackBrowserHost(host: string | null): boolean {
  if (!host) {
    return false;
  }

  try {
    const url = new URL(`http://${host}`);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function shouldInjectDirectRpcWebSocketUrlForRequest(
  request: Request,
): boolean {
  if (process.env.JOLT_RPC_URL?.trim()) {
    return true;
  }

  if (resolveForwardedProto(request) === "https") {
    return false;
  }

  return isLoopbackBrowserHost(readBrowserFacingHost(request));
}

function buildBrowserFacingWebSocketUrl(request: Request): string | null {
  const browserFacingHost = readBrowserFacingHost(request);
  if (!browserFacingHost) {
    return null;
  }

  return `${resolveForwardedProto(request) === "https" ? "wss" : "ws"}://${browserFacingHost}/rpc`;
}

function buildConnectUrlsForRequest(request: Request): string[] {
  const connectUrls = new Set<string>();
  if (shouldInjectDirectRpcWebSocketUrlForRequest(request)) {
    connectUrls.add(RPC_WEBSOCKET_URL);
  }

  const browserFacingWebSocketUrl = buildBrowserFacingWebSocketUrl(request);
  if (browserFacingWebSocketUrl) {
    connectUrls.add(browserFacingWebSocketUrl);
  }

  return [...connectUrls];
}

function buildRuntimeConfigForRequest(request: Request): RuntimeConfig {
  const forwardedProto = resolveForwardedProto(request);
  const shouldInjectDirectRpcWebSocketUrl =
    shouldInjectDirectRpcWebSocketUrlForRequest(request);

  return {
    devServer: IS_DEV_SERVER,
    healthUrl: "/health",
    ...(forwardedProto === "https" || TLS_RUNTIME.publicTls
      ? {
          preferTls: true,
        }
      : {}),
    ...(shouldInjectDirectRpcWebSocketUrl
      ? {
          rpcWebSocketUrl: RPC_WEBSOCKET_URL,
        }
      : {}),
  };
}

async function proxyBackendAuthRequest(
  request: Request,
  connectUrls: string[],
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    RPC_HTTP_ORIGIN,
  );
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", resolveForwardedProto(request));

  const method = request.method.toUpperCase();
  const init: BunFetchRequestInit = {
    headers,
    method,
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const response = await fetch(targetUrl, init);
  const responseHeaders = new Headers(response.headers);
  applySecurityHeaders(responseHeaders, {
    connectUrls,
  });

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
  });
}

const mainviewBundlePath = await buildMainviewBundle();

let server: ReturnType<typeof Bun.serve>;

server = Bun.serve({
  hostname: LOOPBACK_HOSTNAME,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
  port: PUBLIC_PORT,
  async fetch(request): Promise<Response> {
    // Route only what the frontend requires and leave unknown paths as 404.
    const { pathname } = new URL(request.url);
    const connectUrls = buildConnectUrlsForRequest(request);

    if (pathname.startsWith("/auth/")) {
      try {
        return await proxyBackendAuthRequest(request, connectUrls);
      } catch (error) {
        console.error("Failed to proxy auth request to backend", error);
        return stringResponse(
          JSON.stringify({
            error: "Auth backend unavailable.",
            ok: false,
          }),
          "application/json; charset=utf-8",
          502,
          connectUrls,
        );
      }
    }

    if (pathname === "/" || pathname === "/index.html") {
      return buildHtmlResponse(
        buildRuntimeConfigForRequest(request),
        connectUrls,
      );
    }

    if (pathname === "/index.css") {
      return fileResponse(
        MAINVIEW_CSS_PATH,
        "text/css; charset=utf-8",
        connectUrls,
      );
    }

    if (pathname === "/index.js") {
      return fileResponse(
        mainviewBundlePath,
        "application/javascript; charset=utf-8",
        connectUrls,
      );
    }

    if (pathname === "/fonts/fira-code-vf.woff2") {
      return fileResponse(
        FIRA_CODE_VARIABLE_FONT_PATH,
        "font/woff2",
        connectUrls,
      );
    }

    if (pathname === "/fonts/inter-latin-wght-normal.woff2") {
      return fileResponse(
        INTER_VARIABLE_FONT_LATIN_PATH,
        "font/woff2",
        connectUrls,
      );
    }

    if (pathname === "/fonts/inter-latin-ext-wght-normal.woff2") {
      return fileResponse(
        INTER_VARIABLE_FONT_LATIN_EXT_PATH,
        "font/woff2",
        connectUrls,
      );
    }

    if (pathname === "/health") {
      const backendOk = await readBackendHealthSnapshot(BACKEND_HEALTH_URL);
      return stringResponse(
        JSON.stringify(buildLivenessPayload(backendOk)),
        "application/json; charset=utf-8",
        backendOk ? 200 : 503,
        connectUrls,
      );
    }

    return stringResponse(
      "Not found",
      "text/plain; charset=utf-8",
      404,
      connectUrls,
    );
  },
});

console.log(
  `Jolt static server listening on http://localhost:${server.port} (RPC ${RPC_WEBSOCKET_URL})${TLS_RUNTIME.publicTls ? " with public HTTPS/WSS expected via reverse proxy" : ""}`,
);

/**
 * Stops the Bun server and exits the process.
 */
function shutdownAndExit(exitCode: number): void {
  try {
    // `server.stop(true)` may throw during early startup or repeated shutdown signals.
    server.stop(true);
  } catch {
    // Ignore stop failures during shutdown.
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  shutdownAndExit(0);
});

process.on("SIGTERM", () => {
  shutdownAndExit(0);
});
