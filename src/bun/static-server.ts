import { resolve } from "node:path";

import { buildMainviewBundle } from "./build-mainview";
import { buildLivenessPayload, LOOPBACK_HOSTNAME } from "./server-security";

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
type RuntimeConfig = {
  devServer: boolean;
  healthUrl: string;
  rpcWebSocketUrl: string;
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
): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
    },
  });
}

/**
 * Creates an HTTP response by streaming the file at `path` and forcing no-cache
 * behavior to ensure UI updates are immediately visible during development.
 */
function fileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
    },
  });
}

/**
 * Converts an HTTP origin URL into a WebSocket URL targeting `/rpc`,
 * preserving host/port and selecting `ws` vs `wss` by request scheme.
 */
function websocketUrlFromOrigin(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/rpc";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Builds the application HTML response by injecting runtime state and inline CSS if the
 * CSS asset exists on disk.
 */
async function buildHtmlResponse(
  runtimeConfig: RuntimeConfig,
): Promise<Response> {
  const cssFile = Bun.file(MAINVIEW_CSS_PATH);
  const inlineCss = (await cssFile.exists())
    ? `<style>${(await cssFile.text()).replaceAll("</style", "<\\/style")}</style>`
    : "";
  const runtimeScript = `<script>window.__joltRuntime=${JSON.stringify(runtimeConfig)};</script>`;
  const template = await Bun.file(MAINVIEW_HTML_PATH).text();
  const html = template.includes("</head>")
    ? template.replace(
        "</head>",
        `${inlineCss ? `${inlineCss}\n\t\t` : ""}${runtimeScript}\n\t</head>`,
      )
    : `${inlineCss}${runtimeScript}\n${template}`;

  return stringResponse(html, "text/html; charset=utf-8");
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
  process.env.JOLT_RPC_HTTP_ORIGIN?.trim() || `http://127.0.0.1:${RPC_PORT}`;
const RPC_WEBSOCKET_URL =
  process.env.JOLT_RPC_URL?.trim() || websocketUrlFromOrigin(RPC_HTTP_ORIGIN);
const BACKEND_HEALTH_URL =
  process.env.JOLT_RPC_HEALTH_URL?.trim() || `${RPC_HTTP_ORIGIN}/health`;

const mainviewBundlePath = await buildMainviewBundle();
const runtimeConfig: RuntimeConfig = {
  devServer: false,
  healthUrl: "/health",
  rpcWebSocketUrl: RPC_WEBSOCKET_URL,
};

let server: ReturnType<typeof Bun.serve>;

server = Bun.serve({
  hostname: LOOPBACK_HOSTNAME,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
  port: PUBLIC_PORT,
  async fetch(request): Promise<Response> {
    // Route only what the frontend requires and leave unknown paths as 404.
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/index.html") {
      return buildHtmlResponse(runtimeConfig);
    }

    if (pathname === "/index.css") {
      return fileResponse(MAINVIEW_CSS_PATH, "text/css; charset=utf-8");
    }

    if (pathname === "/index.js") {
      return fileResponse(
        mainviewBundlePath,
        "application/javascript; charset=utf-8",
      );
    }

    if (pathname === "/fonts/fira-code-vf.woff2") {
      return fileResponse(FIRA_CODE_VARIABLE_FONT_PATH, "font/woff2");
    }

    if (pathname === "/fonts/inter-latin-wght-normal.woff2") {
      return fileResponse(INTER_VARIABLE_FONT_LATIN_PATH, "font/woff2");
    }

    if (pathname === "/fonts/inter-latin-ext-wght-normal.woff2") {
      return fileResponse(INTER_VARIABLE_FONT_LATIN_EXT_PATH, "font/woff2");
    }

    if (pathname === "/health") {
      const backendOk = await readBackendHealthSnapshot(BACKEND_HEALTH_URL);
      return stringResponse(
        JSON.stringify(buildLivenessPayload(backendOk)),
        "application/json; charset=utf-8",
        backendOk ? 200 : 503,
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `Jolt static server listening on http://localhost:${server.port} (RPC ${RPC_WEBSOCKET_URL})`,
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
