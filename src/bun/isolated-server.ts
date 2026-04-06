/**
 * @file src/bun/isolated-server.ts
 * @description Module for isolated server.
 */

import { resolve } from "node:path";
import { createSubsystemLogger } from "./logging";
import {
  buildLoopbackBrowserOrigins,
  parseAllowedBrowserOrigins,
} from "./server-security";
import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  isPublicTlsEnabled,
  resolveTlsRuntimeConfig,
  TLS_PUBLIC_TRANSPORT_ENV,
} from "./tls-config";

/**
 * Default port for the public static server when no CLI/env override is provided.
 */

const DEFAULT_PUBLIC_PORT = "7599";
const isolatedServerLogger = createSubsystemLogger("Web Server");
const TASK_EXIT_CODE_OFFSET = 128;
const EXIT_SIGNAL_CODES: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  4: "SIGILL",
  5: "SIGTRAP",
  6: "SIGABRT",
  7: "SIGBUS",
  8: "SIGFPE",
  9: "SIGKILL",
  10: "SIGUSR1",
  11: "SIGSEGV",
  12: "SIGUSR2",
  13: "SIGPIPE",
  14: "SIGALRM",
  15: "SIGTERM",
  16: "SIGCHLD",
  17: "SIGCONT",
  18: "SIGSTOP",
  19: "SIGTSTP",
  20: "SIGTTIN",
  21: "SIGTTOU",
  22: "SIGURG",
  23: "SIGXCPU",
  24: "SIGXFSZ",
  25: "SIGVTALRM",
  26: "SIGPROF",
  27: "SIGWINCH",
  28: "SIGIO",
  29: "SIGPWR",
  30: "SIGSYS",
};

/**
 * Process role names that this launcher can start.
 * "backend" runs the API process, "static" runs the HTTP UI process.
 */

type ChildRole = "backend" | "static";

/**
 * Validate a value looks like a non-negative whole-number string for port parsing.
 * Parsing accepts only a non-empty decimal integer without whitespace/sign characters.
 * @param value - Input value.
 */
function isStringInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Read `--flag value` or `--flag=value` style CLI args.
 * Returns the matching value and skips malformed/unknown args safely.
 * @param args - Argument list passed to args.
 * @param flag - flag argument for flag.
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
 * Spawn one side of the isolated server with captured stdio streams and merged env.
 * Environment from this process is inherited, then role-specific settings override.
 */

function signalNameFromExitCode(exitCode: number): string | null {
  return exitCode >= TASK_EXIT_CODE_OFFSET && exitCode <= 255
    ? (EXIT_SIGNAL_CODES[exitCode - TASK_EXIT_CODE_OFFSET] ?? null)
    : null;
}

function logChildOutputLine(
  role: ChildRole,
  source: "stdout" | "stderr",
  line: string,
): void {
  if (!line.trim()) {
    return;
  }
  const message = `[${role}] ${source}: ${line}`;
  if (source === "stderr") {
    isolatedServerLogger.error(message);
  } else {
    isolatedServerLogger.info(message);
  }
}

async function pipeStreamToLogger(
  role: ChildRole,
  source: "stdout" | "stderr",
  stream: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (stream === null) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        logChildOutputLine(role, source, line);
      }
    }

    buffered += decoder.decode();
    if (buffered.trim()) {
      logChildOutputLine(role, source, buffered);
    }
  } catch (error) {
    isolatedServerLogger.error(
      error instanceof Error
        ? `Failed reading ${role} ${source}: ${error.message}`
        : `Failed reading ${role} ${source}`,
    );
  } finally {
    reader.releaseLock();
  }
}

function spawnRole(
  _role: ChildRole,
  args: string[],
  env: Record<string, string>,
): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", ...args],
    env: {
      ...process.env,
      ...env,
    },
    stderr: "pipe",
    stdin: "inherit",
    stdout: "pipe",
  });

  void pipeStreamToLogger(_role, "stdout", child.stdout);
  void pipeStreamToLogger(_role, "stderr", child.stderr);
  isolatedServerLogger.info(
    `Launched ${_role} child ${child.pid} (${args[0]}).`,
  );
  return child;
}

/**
 * Parse startup args once and calculate both ports before any subprocess starts.
 */

const SERVER_ARGS = Bun.argv.slice(2);
const IS_DEV_SERVER =
  SERVER_ARGS.includes("--dev") || process.env.JOLT_DEV === "1";
const PUBLIC_TLS_ENABLED = isPublicTlsEnabled(SERVER_ARGS, process.env);
const TLS_RUNTIME = resolveTlsRuntimeConfig({
  forceTls: PUBLIC_TLS_ENABLED,
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

const rpcWebSocketUrl = formatLoopbackWebSocketUrl(RPC_PORT, false);
const rpcHttpOrigin = formatLoopbackHttpOrigin(RPC_PORT, false);
const allowedBrowserOrigins = new Set<string>([
  ...parseAllowedBrowserOrigins(process.env.JOLT_ALLOWED_WS_ORIGINS),
  ...buildLoopbackBrowserOrigins(PUBLIC_PORT),
]);

/**
 * Launch the API/backend process first; it becomes the RPC service dependency
 * for the static UI process.
 */

const backend = spawnRole(
  "backend",
  [backendEntry, "--backend-only", "--port", String(RPC_PORT)],
  {
    JOLT_ALLOWED_WS_ORIGINS: [...allowedBrowserOrigins].join(","),
    JOLT_BACKEND_ONLY: "1",
    JOLT_DEV: IS_DEV_SERVER ? "1" : process.env.JOLT_DEV || "",
    JOLT_PORT: String(RPC_PORT),
    JOLT_RPC_HTTP_ORIGIN: rpcHttpOrigin,
    JOLT_RPC_URL: rpcWebSocketUrl,
    [TLS_PUBLIC_TRANSPORT_ENV]: PUBLIC_TLS_ENABLED ? "1" : "",
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
    JOLT_RPC_HEALTH_URL: `${rpcHttpOrigin}/health`,
    JOLT_RPC_HTTP_ORIGIN: rpcHttpOrigin,
    JOLT_RPC_PORT: String(RPC_PORT),
    [TLS_PUBLIC_TRANSPORT_ENV]: PUBLIC_TLS_ENABLED ? "1" : "",
  },
);

isolatedServerLogger.info(
  `Jolt isolated server listening on http://localhost:${PUBLIC_PORT} with RPC backend ${rpcHttpOrigin}${TLS_RUNTIME.publicTls ? " and public HTTPS/WSS expected via reverse proxy" : ""}`,
);

let shuttingDown = false;

/**
 * Best-effort shutdown of a subprocess; failures here are ignored intentionally.
 */

function stopChild(
  child:
    | Bun.Subprocess<"inherit", "inherit", "inherit">
    | Bun.Subprocess<"pipe", "pipe", "pipe">,
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
 * @param exitCode - exitCode argument for exitCode.
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
  isolatedServerLogger.error(
    error instanceof Error
      ? `Jolt isolated server uncaught exception: ${error.message}`
      : "Jolt isolated server uncaught exception",
  );
  void shutdownAndExit(1);
});

process.on("unhandledRejection", (reason) => {
  isolatedServerLogger.error(
    reason instanceof Error
      ? `Jolt isolated server unhandled rejection: ${reason.message}`
      : "Jolt isolated server unhandled rejection",
  );
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
  const signalName = signalNameFromExitCode(exitedProcess.code);
  const exitDescription = signalName
    ? `code ${exitedProcess.code} (${signalName})`
    : `code ${exitedProcess.code}`;
  isolatedServerLogger.error(
    `Jolt isolated server child "${exitedProcess.role}" exited with ${exitDescription}.`,
  );
  await shutdownAndExit(exitedProcess.code === 0 ? 1 : exitedProcess.code);
}
