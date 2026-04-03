import { resolve } from "node:path";

const DEFAULT_PUBLIC_PORT = "7599";

type ChildRole = "backend" | "static";

function isStringInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

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

const SERVER_ARGS = Bun.argv.slice(2);
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

if (PUBLIC_PORT === RPC_PORT) {
  throw new Error(
    `Static port ${PUBLIC_PORT} must differ from RPC port ${RPC_PORT}.`,
  );
}

const backendEntry = resolve(process.cwd(), "src/bun/index.ts");
const staticEntry = resolve(process.cwd(), "src/bun/static-server.ts");
const rpcHttpOrigin = `http://127.0.0.1:${RPC_PORT}`;
const rpcWebSocketUrl = `ws://127.0.0.1:${RPC_PORT}/rpc`;

const backend = spawnRole(
  "backend",
  [backendEntry, "--backend-only", "--port", String(RPC_PORT)],
  {
    JOLT_BACKEND_ONLY: "1",
    JOLT_PORT: String(RPC_PORT),
    JOLT_RPC_URL: rpcWebSocketUrl,
  },
);
const staticServer = spawnRole(
  "static",
  [staticEntry, "--port", String(PUBLIC_PORT), "--rpc-port", String(RPC_PORT)],
  {
    JOLT_PUBLIC_PORT: String(PUBLIC_PORT),
    JOLT_RPC_HEALTH_URL: `${rpcHttpOrigin}/health`,
    JOLT_RPC_HTTP_ORIGIN: rpcHttpOrigin,
    JOLT_RPC_PORT: String(RPC_PORT),
    JOLT_RPC_URL: rpcWebSocketUrl,
  },
);

console.log(
  `Jolt isolated server listening on http://localhost:${PUBLIC_PORT} with RPC backend http://localhost:${RPC_PORT}`,
);

let shuttingDown = false;

function stopChild(
  child: Bun.Subprocess<"inherit", "inherit", "inherit">,
): void {
  try {
    child.kill();
  } catch {
    // Ignore child shutdown failures during process teardown.
  }
}

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
