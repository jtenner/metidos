import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TERMINAL_PTY_BRIDGE_PATH = fileURLToPath(
  new URL("./terminal-pty-bridge.cjs", import.meta.url),
);

function runBridgeWithRawInput(input: string): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
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
    child.stdin.end(input);
  });
}

function runBridgeWithConfig(config: unknown): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  const encodedConfig = Buffer.from(JSON.stringify(config), "utf8").toString(
    "base64",
  );
  return runBridgeWithRawInput(`${encodedConfig}\n`);
}

describe("terminal PTY bridge", () => {
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
});
