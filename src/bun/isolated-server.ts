import { resolve } from "node:path";

import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  resolveTlsRuntimeConfig,
} from "./tls-config";

/**
 * Default port for the public static server when no CLI/env override is provided.
 */
const DEFAULT_PUBLIC_PORT = "7599";

/**
 * Process role names that this launcher can start.
 * "backend" runs the API process, "static" runs the HTTP UI process.
 */
type ChildRole = "backend" | "static";

/**
 * Validate a value looks like a non-negative whole-number string for port parsing.
 * We intentionally do not accept whitespace or signs.
 */
function isStringInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Read `--flag value` or `--flag=value` style CLI args.
 * Returns the matching value and skips malformed/unknown args safely.
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
 * Resolve a TCP port from CLI args, then env, then fallback.
 * Parsing is strict: invalid or out-of-range values throw at startup.
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
 * Spawn one side of the isolated server with inherited stdio and merged env.
 * Environment from this process is inherited, then role-specific settings override.
 */
function spawnRole(
  _role: ChildRole,
  args: string[],
  env: Record<string, string>,
): Bun.Subprocess<"inherit", "inherit", "inherit"> {
  return Bun.spawn({
    cmd: [process.execPath, "run", ...args],
    env: {
      ...process.env,
      ...env,
    },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
}

/**
 * Parse startup args once and calculate both ports before any subprocess starts.
 */
const SERVER_ARGS = Bun.argv.slice(2);
const IS_DEV_SERVER =
  SERVER_ARGS.includes("--dev") || process.env.JOLT_DEV === "1";
const TLS_RUNTIME = resolveTlsRuntimeConfig({
  isDevServer: IS_DEV_SERVER,
});
/**
 * Public port supports either --port/CLI, JOLT_PUBLIC_PORT/JOLT_PORT, then default.
 */
const PUBLIC_PORT = resolvePort(
  SERVER_ARGS,
  "--port",
  process.env.JOLT_PUBLIC_PORT ?? process.env.JOLT_PORT,
  DEFAULT_PUBLIC_PORT,
);
const RPC_PORT = resolvePort(
  SERVER_ARGS,
  "--rpc-port",
  process.env.JOLT_RPC_PORT,
  String(PUBLIC_PORT + 1),
);

// Keep these endpoints on distinct ports so UI and RPC never share a socket.
if (PUBLIC_PORT === RPC_PORT) {
  throw new Error(
    `Static port ${PUBLIC_PORT} must differ from RPC port ${RPC_PORT}.`,
  );
}

// Resolve entrypoints relative to the current project root for robust launcher usage.
const backendEntry = resolve(process.cwd(), "src/bun/index.ts");
const staticEntry = resolve(process.cwd(), "src/bun/static-server.ts");

/**
 * Origin/URL pair used by the static server for health checks and websocket client.
 */
const rpcHttpOrigin = formatLoopbackHttpOrigin(RPC_PORT, TLS_RUNTIME.enabled);
const rpcWebSocketUrl = formatLoopbackWebSocketUrl(
  RPC_PORT,
  TLS_RUNTIME.enabled,
);

/**
 * Launch the API/backend process first; it becomes the RPC service dependency
 * for the static UI process.
 */
const backend = spawnRole(
  "backend",
  [backendEntry, "--backend-only", "--port", String(RPC_PORT)],
  {
    JOLT_ALLOWED_WS_ORIGINS: [
      `http://127.0.0.1:${PUBLIC_PORT}`,
      `https://127.0.0.1:${PUBLIC_PORT}`,
      `http://localhost:${PUBLIC_PORT}`,
      `https://localhost:${PUBLIC_PORT}`,
    ].join(","),
    JOLT_BACKEND_ONLY: "1",
    JOLT_DEV: IS_DEV_SERVER ? "1" : process.env.JOLT_DEV || "",
    JOLT_PORT: String(RPC_PORT),
    JOLT_RPC_HTTP_ORIGIN: rpcHttpOrigin,
    JOLT_RPC_URL: rpcWebSocketUrl,
  },
);
/**
 * Launch the UI/static process and point it at the running backend RPC service.
 */
const staticServer = spawnRole(
  "static",
  [staticEntry, "--port", String(PUBLIC_PORT), "--rpc-port", String(RPC_PORT)],
  {
    JOLT_DEV: IS_DEV_SERVER ? "1" : process.env.JOLT_DEV || "",
    JOLT_PUBLIC_PORT: String(PUBLIC_PORT),
    JOLT_RPC_CA_PATH: TLS_RUNTIME.caPath ?? "",
    JOLT_RPC_HEALTH_URL: `${rpcHttpOrigin}/health`,
    JOLT_RPC_HTTP_ORIGIN: rpcHttpOrigin,
    JOLT_RPC_PORT: String(RPC_PORT),
    JOLT_RPC_URL: rpcWebSocketUrl,
  },
);

console.log(
  `Jolt isolated server listening on ${TLS_RUNTIME.httpProtocol}://localhost:${PUBLIC_PORT} with RPC backend ${rpcHttpOrigin}`,
);

let shuttingDown = false;

/**
 * Best-effort shutdown of a subprocess; failures here are ignored intentionally.
 */
function stopChild(
  child: Bun.Subprocess<"inherit", "inherit", "inherit">,
): void {
  try {
    child.kill();
  } catch {
    // Ignore child shutdown failures during process teardown.
  }
}

/**
 * Mark shutdown in progress, stop both subprocesses, wait for exit signals, then exit.
 * If shutdown is already underway, avoid double-calling process exit logic.
 */
async function shutdownAndExit(exitCode: number): Promise<void> {
  if (shuttingDown) {
    process.exit(exitCode);
  }
  shuttingDown = true;
  stopChild(backend);
  stopChild(staticServer);
  await Promise.allSettled([backend.exited, staticServer.exited]);
  process.exit(exitCode);
}

/**
 * Exit cleanly on SIGINT/SIGTERM and ensure both subprocesses are terminated.
 */
process.on("SIGINT", () => {
  void shutdownAndExit(0);
});

process.on("SIGTERM", () => {
  void shutdownAndExit(0);
});

process.on("uncaughtException", (error) => {
  console.error(error);
  void shutdownAndExit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(reason);
  void shutdownAndExit(1);
});

// If either child exits, terminate the other and propagate a non-zero exit code
// (0 means normal shutdown, so child exits there become a failure for this wrapper).
const exitedProcess = await Promise.race([
  backend.exited.then((code) => ({
    code,
    role: "backend" as const,
  })),
  staticServer.exited.then((code) => ({
    code,
    role: "static" as const,
  })),
]);

if (!shuttingDown) {
  console.error(
    `Jolt isolated server child "${exitedProcess.role}" exited with code ${exitedProcess.code}.`,
  );
  await shutdownAndExit(exitedProcess.code === 0 ? 1 : exitedProcess.code);
}
