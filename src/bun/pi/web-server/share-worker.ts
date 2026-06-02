/**
 * @file src/bun/pi/web-server/share-worker.ts
 * @description Main-process bootstrap for the dedicated stable web-server share worker.
 */

import { Worker } from "node:worker_threads";

import { getAppDatabasePath } from "../../db";
import { createSubsystemLogger } from "../../logging";
import { resolveWebServerShareHost, resolveWebServerSharePort } from "./share";

const logger = createSubsystemLogger("Web Server Share");
const WEB_SERVER_SHARE_THREAD_START_TIMEOUT_MS = 5_000;
const WEB_SERVER_SHARE_THREAD_STOP_TIMEOUT_MS = 2_000;
const WEB_SERVER_SHARE_THREAD_URL = new URL(
  "./share-thread.ts",
  import.meta.url,
);

type WebServerShareWorkerCommand = {
  type: "kill";
};

type WebServerShareWorkerStatusMessage =
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ready";
      host: string;
      port: number;
    }
  | {
      type: "stopped";
    };

let shareWorker: Worker | null = null;
let shareWorkerStartPromise: Promise<{ host: string; port: number }> | null =
  null;

function awaitWorkerMessage(
  worker: Worker,
  options: {
    predicate: (message: WebServerShareWorkerStatusMessage) => boolean;
    timeoutMessage: string;
    timeoutMs: number;
  },
): Promise<WebServerShareWorkerStatusMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(options.timeoutMessage));
    }, options.timeoutMs);

    const handleMessage = (message: WebServerShareWorkerStatusMessage) => {
      if (!message || !options.predicate(message)) {
        return;
      }
      cleanup();
      resolve(message);
    };
    const handleError = () => {
      cleanup();
      reject(
        new Error("Web server share worker failed before startup completed."),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off("message", handleMessage);
      worker.off("error", handleError);
    };

    worker.on("message", handleMessage);
    worker.on("error", handleError);
  });
}

export async function startPiWebServerShareWorker(options?: {
  dbPath?: string;
  host?: string;
  maxConcurrentProxyFetchesPerShare?: number;
  maxProxyResponseBodyBytes?: number;
  outboundFetchTimeoutMs?: number;
  port?: number;
  secureCookies?: boolean;
}): Promise<{ host: string; port: number }> {
  if (shareWorkerStartPromise) {
    return shareWorkerStartPromise;
  }
  if (shareWorker) {
    return {
      host: options?.host ?? resolveWebServerShareHost(),
      port: options?.port ?? resolveWebServerSharePort(),
    };
  }

  shareWorkerStartPromise = (async () => {
    const host = options?.host ?? resolveWebServerShareHost();
    const port = options?.port ?? resolveWebServerSharePort();
    const worker = new Worker(WEB_SERVER_SHARE_THREAD_URL, {
      name: "metidos-web-server-share",
      workerData: {
        dbPath: options?.dbPath ?? getAppDatabasePath(),
        host,
        ...(typeof options?.maxConcurrentProxyFetchesPerShare === "number"
          ? {
              maxConcurrentProxyFetchesPerShare:
                options.maxConcurrentProxyFetchesPerShare,
            }
          : {}),
        ...(typeof options?.maxProxyResponseBodyBytes === "number"
          ? { maxProxyResponseBodyBytes: options.maxProxyResponseBodyBytes }
          : {}),
        ...(typeof options?.outboundFetchTimeoutMs === "number"
          ? { outboundFetchTimeoutMs: options.outboundFetchTimeoutMs }
          : {}),
        port,
        secureCookies: options?.secureCookies === true,
      },
    });

    try {
      const message = await awaitWorkerMessage(worker, {
        predicate: (nextMessage) =>
          nextMessage.type === "ready" || nextMessage.type === "error",
        timeoutMessage: "Timed out while starting the web server share worker.",
        timeoutMs: WEB_SERVER_SHARE_THREAD_START_TIMEOUT_MS,
      });
      if (message.type === "error") {
        throw new Error(
          "Web server share worker failed before startup completed. Check share host, port, and database availability.",
        );
      }
      if (message.type !== "ready") {
        throw new Error("Web server share worker did not report readiness.");
      }
      const readyMessage = message;
      shareWorker = worker;
      worker.on("error", () => {
        logger.error({
          error: "redacted",
          message: "Web server share worker failed after startup.",
        });
        shareWorker = null;
        shareWorkerStartPromise = null;
      });
      worker.on("exit", () => {
        shareWorker = null;
        shareWorkerStartPromise = null;
      });
      logger.info(
        `Web server share worker listening on http://localhost:${readyMessage.port}`,
      );
      return {
        host: readyMessage.host,
        port: readyMessage.port,
      };
    } catch (error) {
      shareWorkerStartPromise = null;
      try {
        worker.terminate();
      } catch {
        // Ignore worker termination failures while surfacing the startup error.
      }
      throw error;
    }
  })();

  return shareWorkerStartPromise;
}

export async function stopPiWebServerShareWorker(): Promise<void> {
  shareWorkerStartPromise = null;
  const worker = shareWorker;
  shareWorker = null;
  if (!worker) {
    return;
  }

  try {
    worker.postMessage({
      type: "kill",
    } satisfies WebServerShareWorkerCommand);
    await awaitWorkerMessage(worker, {
      predicate: (message) =>
        message.type === "stopped" || message.type === "error",
      timeoutMessage: "Timed out while stopping the web server share worker.",
      timeoutMs: WEB_SERVER_SHARE_THREAD_STOP_TIMEOUT_MS,
    });
  } catch {
    // Fall through to forced termination below.
  }

  try {
    await worker.terminate();
  } catch {
    // Ignore worker termination failures during shutdown.
  }
}
