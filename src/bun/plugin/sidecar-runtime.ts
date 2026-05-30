/**
 * @file src/bun/plugin/sidecar-runtime.ts
 * @description Runtime process/worker primitives for Plugin System v1 sidecars.
 */

import { lstatSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import type { PluginCapturedEnvVar } from "./env";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

export const DEFAULT_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
// This is a virtual-memory ceiling for the Bun sidecar host process, not a
// target RSS allocation. Bun/JSC reserves substantially more address space than
// it commits; OpenRouter startup currently needs >640 MiB of virtual address
// space while resident memory stays around 50-60 MiB.
export const DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES = 768 * 1024 * 1024;
export const PLUGIN_SIDECAR_TRUNCATED_LINE_SUFFIX = "… [truncated by host]";

const PLUGIN_SIDECAR_ENTRYPOINT_PATH = fileURLToPath(
  new URL("./sidecar-main.ts", import.meta.url),
);
const PLUGIN_SIDECAR_WINDOWS_JOB_WRAPPER_PATH = fileURLToPath(
  new URL("./sidecar-windows-job.ts", import.meta.url),
);
const PLUGIN_SIDECAR_WORKER_PATH = fileURLToPath(
  new URL("./sidecar-worker.ts", import.meta.url),
);

type PluginSidecarInputStream =
  | WritableStream<Uint8Array>
  | {
      flush?: () => unknown;
      write: (chunk: string | Uint8Array) => unknown;
    };

export type PluginSidecarRuntimeKind = "process" | "worker";

export type PluginSidecarProcess = {
  exited: Promise<number>;
  kill: (signal?: string) => void;
  pid?: number;
  stderr: ReadableStream<Uint8Array> | null;
  stdin: PluginSidecarInputStream | null;
  stdout: ReadableStream<Uint8Array> | null;
};

export type PluginSidecarSpawnInput = {
  capturedEnv: PluginCapturedEnvVar[];
  plugin: RpcPluginInventoryPlugin;
  reviewHash: string;
};

export function resolvePluginSidecarRuntimeKind(
  configuredRuntimeKind?: string,
): PluginSidecarRuntimeKind {
  const normalizedRuntimeKind = configuredRuntimeKind?.trim().toLowerCase();
  if (!normalizedRuntimeKind) {
    return "process";
  }
  if (
    normalizedRuntimeKind === "process" ||
    normalizedRuntimeKind === "worker"
  ) {
    return normalizedRuntimeKind;
  }
  throw new Error(
    `Invalid METIDOS_PLUGIN_RUNTIME_KIND "${configuredRuntimeKind}". Expected "worker" or "process".`,
  );
}

export function buildDefaultPluginSidecarCommand(
  memoryLimitBytes = DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES,
): string[] {
  const directCommand = [
    process.execPath,
    "run",
    PLUGIN_SIDECAR_ENTRYPOINT_PATH,
  ];
  if (!Number.isFinite(memoryLimitBytes) || memoryLimitBytes <= 0) {
    return directCommand;
  }
  if (process.platform === "win32") {
    return [
      process.execPath,
      "run",
      PLUGIN_SIDECAR_WINDOWS_JOB_WRAPPER_PATH,
      "--",
      ...directCommand,
    ];
  }
  const memoryLimitKiB = Math.max(1, Math.floor(memoryLimitBytes / 1024));
  return [
    "sh",
    "-c",
    `ulimit -v ${memoryLimitKiB}; exec "$@"`,
    "metidos-plugin-sidecar",
    ...directCommand,
  ];
}

function assertPluginSidecarRoot(input: RpcPluginInventoryPlugin): string {
  const stats = lstatSync(input.folderPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      `Refusing to start plugin ${input.directoryName} because its plugin root is not a real directory: ${input.folderPath}`,
    );
  }
  // Use the resolved path consistently for cwd and METIDOS_PLUGIN_ROOT. The
  // lstat check rejects symlink roots, while realpath canonicalizes benign
  // spelling differences so later filesystem capability checks and sidecar
  // diagnostics refer to the same directory that was checked immediately before
  // startup.
  return realpathSync(input.folderPath);
}

function pluginSidecarEnvironment(
  input: PluginSidecarSpawnInput & { memoryLimitBytes?: number },
  pluginRoot: string,
): Record<string, string> {
  const memoryLimitBytes =
    input.memoryLimitBytes ?? DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES;
  return {
    METIDOS_PLUGIN_DIRECTORY_NAME: input.plugin.directoryName,
    METIDOS_PLUGIN_ID: input.plugin.pluginId ?? "",
    METIDOS_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES: String(
      DEFAULT_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES,
    ),
    METIDOS_PLUGIN_REVIEW_HASH: input.reviewHash,
    METIDOS_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES: String(memoryLimitBytes),
    METIDOS_PLUGIN_ROOT: pluginRoot,
  };
}

export function buildPluginSidecarHostEnvironment(
  hostEnv: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Record<string, string> {
  // Deliberately do not forward DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR, or
  // other desktop/session variables to Plugin sidecars. start.ts deletes the
  // primary clipboard-enabling variables for the host, and this allowlist keeps
  // sidecars from regaining native clipboard/display access through inheritance.
  const safeHostEnv: Record<string, string> = {};
  if (hostEnv.PATH) {
    safeHostEnv.PATH = hostEnv.PATH;
  }
  if (platform === "win32" && hostEnv.SystemRoot) {
    safeHostEnv.SystemRoot = hostEnv.SystemRoot;
  }
  return safeHostEnv;
}

export function createDefaultPluginSidecarProcess(
  input: PluginSidecarSpawnInput & { memoryLimitBytes?: number },
): PluginSidecarProcess {
  const memoryLimitBytes =
    input.memoryLimitBytes ?? DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES;
  const pluginRoot = assertPluginSidecarRoot(input.plugin);
  return Bun.spawn({
    cmd: buildDefaultPluginSidecarCommand(memoryLimitBytes),
    cwd: pluginRoot,
    env: {
      ...buildPluginSidecarHostEnvironment(),
      ...pluginSidecarEnvironment(input, pluginRoot),
    },
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  }) as unknown as PluginSidecarProcess;
}

function createTextReadableStream(): {
  close: () => void;
  stream: ReadableStream<Uint8Array>;
  write: (text: string) => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(startController) {
      controller = startController;
      for (const chunk of pending.splice(0)) {
        controller.enqueue(chunk);
      }
      if (closed) {
        controller.close();
      }
    },
  });
  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      controller?.close();
    },
    stream,
    write(text) {
      if (closed) {
        return;
      }
      const encoded = TEXT_ENCODER.encode(text);
      if (controller) {
        controller.enqueue(encoded);
      } else {
        pending.push(encoded);
      }
    },
  };
}

export function createWorkerPluginSidecarProcess(
  input: PluginSidecarSpawnInput & { memoryLimitBytes?: number },
): PluginSidecarProcess {
  const pluginRoot = assertPluginSidecarRoot(input.plugin);
  const stdout = createTextReadableStream();
  const stderr = createTextReadableStream();
  const worker = new Worker(PLUGIN_SIDECAR_WORKER_PATH, {
    env: buildPluginSidecarHostEnvironment(),
    workerData: {
      env: pluginSidecarEnvironment(input, pluginRoot),
    },
  });
  worker.on("message", (message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("channel" in message) ||
      !("text" in message)
    ) {
      return;
    }
    const channel = (message as { channel?: unknown }).channel;
    const text = (message as { text?: unknown }).text;
    if (typeof text !== "string") {
      return;
    }
    if (channel === "stdout") {
      stdout.write(text);
    } else if (channel === "stderr") {
      stderr.write(text);
    }
  });
  worker.on("error", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Plugin sidecar worker error: ${message}\n`);
  });
  const exited = new Promise<number>((resolve) => {
    worker.on("exit", (code) => {
      stdout.close();
      stderr.close();
      resolve(typeof code === "number" ? code : 0);
    });
  });
  return {
    exited,
    kill() {
      void worker.terminate();
    },
    pid: worker.threadId,
    stderr: stderr.stream,
    stdin: {
      write(chunk: string | Uint8Array) {
        worker.postMessage(
          typeof chunk === "string" ? chunk : TEXT_DECODER.decode(chunk),
        );
      },
    },
    stdout: stdout.stream,
  };
}

export async function writeSidecarFrame(
  process: PluginSidecarProcess,
  frame: string,
): Promise<void> {
  if (!process.stdin) {
    throw new Error("Plugin sidecar process did not expose stdin.");
  }
  if ("getWriter" in process.stdin) {
    const writer = process.stdin.getWriter();
    try {
      await writer.write(TEXT_ENCODER.encode(frame));
    } finally {
      writer.releaseLock();
    }
    return;
  }
  await process.stdin.write(frame);
  await process.stdin.flush?.();
}

export async function readTextLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void | Promise<void>,
  options: { maxLineLength: number },
): Promise<void> {
  const reader = stream.getReader();
  const maxLineLength = Math.max(1, Math.trunc(options.maxLineLength));
  let buffer = "";
  let discardingOversizedLine = false;

  const emitLine = async (line: string): Promise<void> => {
    const trimmed = line.trimEnd();
    if (trimmed.length > 0) {
      await onLine(trimmed);
    }
  };

  const emitTruncatedLine = async (): Promise<void> => {
    const truncated = `${buffer.slice(0, maxLineLength)}${PLUGIN_SIDECAR_TRUNCATED_LINE_SUFFIX}`;
    buffer = "";
    discardingOversizedLine = true;
    await emitLine(truncated);
  };

  const consumeDecodedText = async (text: string): Promise<void> => {
    buffer += text;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (discardingOversizedLine) {
        if (newlineIndex === -1) {
          buffer = "";
          return;
        }
        buffer = buffer.slice(newlineIndex + 1);
        discardingOversizedLine = false;
        continue;
      }
      if (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > maxLineLength) {
          await emitLine(
            `${line.slice(0, maxLineLength)}${PLUGIN_SIDECAR_TRUNCATED_LINE_SUFFIX}`,
          );
        } else {
          await emitLine(line);
        }
        continue;
      }
      if (buffer.length > maxLineLength) {
        // Once a line crosses maxLineLength, emit only the retained prefix and
        // discard subsequent chunks until the next newline. This bounds memory
        // for malicious or noisy sidecars that write unbounded lines.
        await emitTruncatedLine();
        continue;
      }
      return;
    }
  };

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      await consumeDecodedText(
        TEXT_DECODER.decode(chunk.value, { stream: true }),
      );
    }
    await consumeDecodedText(TEXT_DECODER.decode());
    if (!discardingOversizedLine && buffer.length > 0) {
      await emitLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}
