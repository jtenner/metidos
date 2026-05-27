/**
 * @file src/bun/plugin/sidecar-worker.ts
 * @description Worker-thread transport wrapper for Plugin System v1 sidecars.
 */

import { parentPort, workerData } from "node:worker_threads";

const parentMessagePort = parentPort;
if (!parentMessagePort) {
  throw new Error("Plugin sidecar worker requires parentPort.");
}
const port = parentMessagePort;

type PluginSidecarWorkerData = {
  env?: Record<string, string>;
};

const data = workerData as PluginSidecarWorkerData | undefined;
for (const [key, value] of Object.entries(data?.env ?? {})) {
  process.env[key] = value;
}

const sidecar = await import("./sidecar-main");
sidecar.configurePluginSidecarIo({
  stderr: (text) => {
    port.postMessage({ channel: "stderr", text });
  },
  stdout: (text) => {
    port.postMessage({ channel: "stdout", text });
  },
});

let buffer = "";
let queue = Promise.resolve();
let closed = false;

function isHostSettlementFrame(frame: string): boolean {
  try {
    const envelope = JSON.parse(frame) as { type?: unknown };
    return envelope.type === "host.response" || envelope.type === "host.error";
  } catch {
    return false;
  }
}

function handleFrameError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  port.postMessage({
    channel: "stderr",
    text: `Plugin sidecar worker failed: ${message}\n`,
  });
  process.exit(1);
}

function enqueueFrame(frame: string): void {
  queue = queue
    .then(async () => {
      if (closed) {
        return;
      }
      const keepRunning = await sidecar.handlePluginSidecarProtocolFrame(frame);
      if (!keepRunning) {
        closed = true;
        port.close();
      }
    })
    .catch(handleFrameError);
}

function dispatchFrame(frame: string): void {
  if (isHostSettlementFrame(frame)) {
    void sidecar
      .handlePluginSidecarProtocolFrame(frame)
      .catch(handleFrameError);
    return;
  }
  enqueueFrame(frame);
}

port.on("message", (message: unknown) => {
  if (closed || typeof message !== "string") {
    return;
  }
  buffer += message;
  while (!closed) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) {
      break;
    }
    const frame = buffer.slice(0, newlineIndex).trimEnd();
    buffer = buffer.slice(newlineIndex + 1);
    if (frame.length > 0) {
      dispatchFrame(frame);
    }
  }
});
