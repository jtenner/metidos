import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TERMINAL_PTY_BRIDGE_PATH = fileURLToPath(
  new URL("./terminal-pty-bridge.cjs", import.meta.url),
);

function runBridgeWithRawInput(
  input: string,
  options: { endStdin?: boolean } = {},
): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  const { endStdin = true } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TERMINAL_PTY_BRIDGE_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stderr, stdout });
    });
    if (endStdin) {
      child.stdin.end(input);
    } else {
      child.stdin.write(input);
    }
  });
}

function runBridgeWithConfig(
  config: unknown,
  options?: { endStdin?: boolean },
): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  const encodedConfig = Buffer.from(JSON.stringify(config), "utf8").toString(
    "base64",
  );
  return runBridgeWithRawInput(`${encodedConfig}\n`, options);
}

describe("terminal PTY bridge", () => {
  it("exits successfully when the host closes stdin before configuration", async () => {
    const result = await runBridgeWithRawInput("");

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  it("reports PTY child exit status separately from bridge success", async () => {
    const result = await runBridgeWithConfig(
      {
        args: [],
        cols: 80,
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "" },
        file: "/bin/false",
        name: "xterm-256color",
        rows: 24,
      },
      { endStdin: false },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      type: "exit",
      exitCode: 1,
      signal: 0,
    });
  });

  it("exits after an oversized partial input buffer", async () => {
    const result = await runBridgeWithRawInput("x".repeat(1024 * 1024 + 1));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      type: "error",
      message:
        "PTY bridge input buffer exceeded 1048576 bytes without a complete JSON line.",
    });
  });

  it("rejects malformed spawn configuration before spawning a PTY", async () => {
    const result = await runBridgeWithConfig({
      args: [],
      cols: 80,
      cwd: "/tmp",
      env: {},
      name: "xterm-256color",
      rows: 24,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      type: "error",
      message:
        "Terminal bridge spawn configuration field file must be a non-empty string without null bytes.",
    });
  });

  it("rejects unsafe spawn arguments before spawning a PTY", async () => {
    const result = await runBridgeWithConfig({
      args: ["safe", "bad\0arg"],
      cols: 80,
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      file: "/bin/echo",
      name: "xterm-256color",
      rows: 24,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      type: "error",
      message:
        "Terminal bridge spawn configuration field args must be an array of strings without null bytes.",
    });
  });

  it("reports invalid executables as PTY child startup failures", async () => {
    const result = await runBridgeWithConfig({
      args: [],
      cols: 80,
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      file: "/tmp/metidos-terminal-pty-bridge-missing-executable",
      name: "xterm-256color",
      rows: 24,
    });

    const messages = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    // node-pty reports execvp startup failures through the PTY stream and then
    // exits the child process; the bridge itself exits successfully because it
    // delivered the child failure to the terminal manager.
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: "data" });
    expect(messages[0].data).toContain("No such file or directory");
    expect(messages[1]).toEqual({ type: "exit", exitCode: 1, signal: 0 });
  });
});
