type ChildRole = "tailwind" | "server";

type ManagedChild = ReturnType<typeof Bun.spawn> & {
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
};

type ChildCommand = {
  cmd: string[];
  role: ChildRole;
};

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

function parseCommandOverride(envName: string, fallback: string[]): string[] {
  const raw = process.env[envName];
  if (!raw) {
    return fallback;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(`${envName} must be a non-empty JSON string array`);
  }
  return parsed;
}

export function devSupervisorCommands(): ChildCommand[] {
  return [
    {
      cmd: parseCommandOverride("METIDOS_DEV_TAILWIND_CMD_JSON", [
        process.execPath,
        "run",
        "tailwind:watch",
      ]),
      role: "tailwind",
    },
    {
      cmd: parseCommandOverride("METIDOS_DEV_SERVER_CMD_JSON", [
        process.execPath,
        "src/bun/index.ts",
      ]),
      role: "server",
    },
  ];
}

function spawnManagedChild(command: ChildCommand): ManagedChild {
  console.error(`[dev] starting ${command.role}: ${command.cmd.join(" ")}`);
  return Bun.spawn({
    cmd: command.cmd,
    cwd: process.cwd(),
    env: process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  }) as ManagedChild;
}

async function killChildren(
  children: ManagedChild[],
  signal: NodeJS.Signals,
): Promise<void> {
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // The child may already have exited.
    }
  }
  await Promise.allSettled(children.map((child) => child.exited));
}

export async function runDevSupervisor(): Promise<number> {
  const commands = devSupervisorCommands();
  const children = commands.map(spawnManagedChild);
  let shuttingDown = false;

  const shutdownPromises = SHUTDOWN_SIGNALS.map(
    (signal) =>
      new Promise<number>((resolve) => {
        process.once(signal, async () => {
          shuttingDown = true;
          console.error(`[dev] received ${signal}; stopping children`);
          await killChildren(children, signal);
          resolve(signal === "SIGINT" ? 130 : 143);
        });
      }),
  );

  const childExitPromises = children.map(async (child, index) => {
    const exitCode = await child.exited;
    return { exitCode, role: commands[index]?.role ?? "server" };
  });

  const result = await Promise.race([
    ...childExitPromises,
    ...shutdownPromises,
  ]);

  if (typeof result === "number") {
    return result;
  }

  if (shuttingDown) {
    return result.exitCode;
  }

  console.error(
    `[dev] ${result.role} exited unexpectedly with code ${result.exitCode}; stopping remaining children`,
  );
  await killChildren(children, "SIGTERM");
  return result.exitCode === 0 ? 1 : result.exitCode;
}

if (import.meta.main) {
  const exitCode = await runDevSupervisor();
  process.exit(exitCode);
}
