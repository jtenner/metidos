import { afterEach, beforeEach, describe, expect, test } from "bun:test";

class CapturingWorker {
  static messages: unknown[] = [];
  static instances: CapturingWorker[] = [];
  terminated = false;
  readonly listeners = new Map<string, () => void>();

  constructor(_url: URL, _options: WorkerOptions) {
    CapturingWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    CapturingWorker.messages.push(message);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const originalWorker = globalThis.Worker;

async function importLoggingModule() {
  return await import(`./logging.ts?test=${crypto.randomUUID()}`);
}

async function waitForFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("threaded backend logging", () => {
  beforeEach(() => {
    CapturingWorker.messages = [];
    CapturingWorker.instances = [];
    globalThis.Worker = CapturingWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  test("batches normal log traffic into worker messages", async () => {
    const { logMessage } = await importLoggingModule();

    logMessage("INFO", "test", "one");
    logMessage("WARNING", "test", { two: 2n });

    expect(CapturingWorker.messages).toHaveLength(0);
    await waitForFlush();

    expect(CapturingWorker.messages).toHaveLength(1);
    expect(CapturingWorker.messages[0]).toEqual({
      type: "logBatch",
      payload: [
        { level: "INFO", source: "test", description: "one" },
        { level: "WARNING", source: "test", description: { two: "2" } },
      ],
    });
  });

  test("bounds burst traffic and emits a dropped-log diagnostic", async () => {
    const { LOG_QUEUE_LIMIT, logMessage } = await importLoggingModule();

    for (let index = 0; index < LOG_QUEUE_LIMIT + 3; index += 1) {
      logMessage("INFO", "burst", { index });
    }

    await waitForFlush();

    const batches = CapturingWorker.messages as Array<{
      type: string;
      payload: Array<{ description: unknown; source: string; level: string }>;
    }>;
    const entries = batches.flatMap((message) => message.payload);
    expect(entries).toHaveLength(LOG_QUEUE_LIMIT + 1);
    expect(entries.at(-1)).toEqual({
      level: "WARNING",
      source: "logging",
      description: {
        dropped: 3,
        queueLimit: LOG_QUEUE_LIMIT,
        reason: "backend log queue full",
      },
    });
  });

  test("flushes pending logs synchronously before terminating the logging worker", async () => {
    const originalWrite = process.stderr.write;
    const written: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      const { logMessage, shutdownLoggingThread } = await importLoggingModule();

      logMessage("INFO", "startup", "create worker");
      await waitForFlush();
      expect(CapturingWorker.instances).toHaveLength(1);
      CapturingWorker.messages = [];

      logMessage("INFO", "shutdown", "queued");
      shutdownLoggingThread();

      expect(CapturingWorker.messages).toHaveLength(0);
      expect(written.join("")).toContain("shutdown");
      expect(written.join("")).toContain("queued");
      expect(CapturingWorker.instances).toHaveLength(1);
      expect(CapturingWorker.instances[0]?.terminated).toBe(true);
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
