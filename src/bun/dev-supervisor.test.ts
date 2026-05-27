import { describe, expect, it } from "bun:test";
import { devSupervisorCommands } from "./dev-supervisor";

function supervisorCommand(): string[] {
  return [process.execPath, "src/bun/dev-supervisor.ts"];
}

async function runSupervisorWithCommands(input: {
  server: string[];
  tailwind: string[];
}): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn({
    cmd: supervisorCommand(),
    env: {
      ...process.env,
      METIDOS_DEV_SERVER_CMD_JSON: JSON.stringify(input.server),
      METIDOS_DEV_TAILWIND_CMD_JSON: JSON.stringify(input.tailwind),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);
  return { exitCode, stderr };
}

describe("dev supervisor", () => {
  it("declares the Tailwind watcher and Bun server commands", () => {
    const originalTailwind = process.env.METIDOS_DEV_TAILWIND_CMD_JSON;
    const originalServer = process.env.METIDOS_DEV_SERVER_CMD_JSON;
    delete process.env.METIDOS_DEV_TAILWIND_CMD_JSON;
    delete process.env.METIDOS_DEV_SERVER_CMD_JSON;
    try {
      expect(devSupervisorCommands()).toEqual([
        {
          cmd: [process.execPath, "run", "tailwind:watch"],
          role: "tailwind",
        },
        {
          cmd: [process.execPath, "src/bun/index.ts"],
          role: "server",
        },
      ]);
    } finally {
      if (originalTailwind === undefined) {
        delete process.env.METIDOS_DEV_TAILWIND_CMD_JSON;
      } else {
        process.env.METIDOS_DEV_TAILWIND_CMD_JSON = originalTailwind;
      }
      if (originalServer === undefined) {
        delete process.env.METIDOS_DEV_SERVER_CMD_JSON;
      } else {
        process.env.METIDOS_DEV_SERVER_CMD_JSON = originalServer;
      }
    }
  });

  it("fails when a child exits unexpectedly", async () => {
    const result = await runSupervisorWithCommands({
      server: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      tailwind: [process.execPath, "-e", "process.exit(0)"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("tailwind exited unexpectedly");
  });

  it("returns the failing child exit code", async () => {
    const result = await runSupervisorWithCommands({
      server: [process.execPath, "-e", "process.exit(7)"],
      tailwind: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("server exited unexpectedly with code 7");
  });
});
