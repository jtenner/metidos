#!/usr/bin/env node
/**
 * @file src/bun/terminal-pty-bridge.cjs
 * @description Node-hosted node-pty bridge used by the Bun server runtime.
 */

const pty = require("node-pty");

function send(message, callback) {
  const line = `${JSON.stringify(message)}\n`;
  if (callback) {
    process.stdout.write(line, callback);
    return;
  }
  process.stdout.write(line);
}

function fatal(error) {
  send(
    {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    },
    () => {
      process.exit(1);
    },
  );
}

function decodeConfig(value) {
  if (!value) {
    throw new Error("Terminal bridge requires a spawn configuration.");
  }
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(
      `Terminal bridge spawn configuration field ${fieldName} must be a non-empty string without null bytes.`,
    );
  }
  return value;
}

function requireSafeInteger(value, fieldName, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Terminal bridge spawn configuration field ${fieldName} must be an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

function validateSpawnConfig(config) {
  if (!isPlainRecord(config)) {
    throw new Error("Terminal bridge spawn configuration must be an object.");
  }
  const args = config.args ?? [];
  if (
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
  ) {
    throw new Error(
      "Terminal bridge spawn configuration field args must be an array of strings without null bytes.",
    );
  }
  if (!isPlainRecord(config.env)) {
    throw new Error(
      "Terminal bridge spawn configuration field env must be an object.",
    );
  }
  const env = {};
  for (const [key, value] of Object.entries(config.env)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      typeof value !== "string" ||
      value.includes("\0")
    ) {
      throw new Error(
        "Terminal bridge spawn configuration field env must contain safe string variables.",
      );
    }
    env[key] = value;
  }
  return {
    args,
    cols: requireSafeInteger(config.cols, "cols", 1, 1000),
    cwd: requireSafeString(config.cwd, "cwd"),
    env,
    file: requireSafeString(config.file, "file"),
    name: requireSafeString(config.name, "name"),
    rows: requireSafeInteger(config.rows, "rows", 1, 1000),
  };
}

function attachPtyEventHandlers(processHandle) {
  processHandle.onData((data) => {
    send({ type: "data", data });
  });

  processHandle.onExit((event) => {
    // The bridge exits successfully after faithfully reporting the PTY child's
    // exit status. The terminal manager treats the JSON event as the child
    // result and reserves the bridge process exit code for bridge failures.
    send(
      {
        type: "exit",
        exitCode: event.exitCode,
        signal: event.signal ?? null,
      },
      () => {
        process.exit(0);
      },
    );
  });
}

let ptyProcess;
let configLoaded = false;

function loadConfig(line) {
  const config = validateSpawnConfig(decodeConfig(line.trim()));
  ptyProcess = pty.spawn(config.file, config.args ?? [], {
    cols: config.cols,
    cwd: config.cwd,
    env: config.env,
    name: config.name,
    rows: config.rows,
  });
  attachPtyEventHandlers(ptyProcess);
  configLoaded = true;
}

const MAX_INPUT_BUFFER_BYTES = 1024 * 1024;

let inputBuffer = "";
let parentGone = false;

function exitWhenParentGone() {
  if (parentGone) {
    return;
  }
  parentGone = true;
  try {
    ptyProcess?.kill();
  } catch {
    // The PTY may already be gone.
  }
  // EOF from the Bun host means the owning terminal session is gone. Treat it
  // as an orderly bridge shutdown even if no spawn configuration was received.
  setTimeout(() => {
    process.exit(0);
  }, 100).unref?.();
}

function handleRuntimeMessage(line) {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    send({
      type: "error",
      message: `PTY bridge received malformed JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return;
  }
  try {
    if (message.type === "input") {
      ptyProcess.write(String(message.data ?? ""));
    } else if (message.type === "resize") {
      ptyProcess.resize(Number(message.cols), Number(message.rows));
    } else if (message.type === "kill") {
      ptyProcess.kill(message.signal ? String(message.signal) : undefined);
    }
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  if (Buffer.byteLength(inputBuffer, "utf8") > MAX_INPUT_BUFFER_BYTES) {
    inputBuffer = "";
    send(
      {
        type: "error",
        message:
          "PTY bridge input buffer exceeded 1048576 bytes without a complete JSON line.",
      },
      () => {
        process.exit(1);
      },
    );
    return;
  }
  let newlineIndex = inputBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = inputBuffer.slice(0, newlineIndex);
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    newlineIndex = inputBuffer.indexOf("\n");
    if (!line.trim()) {
      continue;
    }
    if (!configLoaded) {
      try {
        loadConfig(line);
      } catch (error) {
        fatal(error);
      }
      continue;
    }
    handleRuntimeMessage(line);
  }
});

process.stdin.on("end", exitWhenParentGone);
process.stdin.on("close", exitWhenParentGone);

setInterval(() => {
  if (!process.connected && !process.stdin.readable) {
    exitWhenParentGone();
  }
}, 1000).unref?.();

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    try {
      ptyProcess?.kill(signal);
    } catch {
      process.exit(0);
    }
  });
}
