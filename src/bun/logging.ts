/**
 * @file src/bun/logging.ts
 * @description Module for threaded IPC logging.
 */

type LoggingThreadMessage = {
  type: "log";
  payload: LogMessage;
};

export type LogLevel = "INFO" | "WARNING" | "ERROR" | "TRACE";

export type LogDescription = string | Record<string, unknown>;

export type LogMessage = {
  level: LogLevel;
  description: LogDescription;
  source: string;
};

const LOG_THREAD_NAME = "jolt-logging-thread";
const LOG_THREAD_URL = new URL("./logging-thread.ts", import.meta.url);

let loggingThread: Worker | null = null;
let loggingThreadSupported = true;

function normalizeDescription(description: LogDescription): unknown {
  if (typeof description === "string") {
    return description;
  }

  try {
    return JSON.parse(JSON.stringify(description));
  } catch {
    return String(description);
  }
}

function getDescriptionPrefix(level: LogLevel): string {
  switch (level) {
    case "WARNING":
    case "ERROR":
    case "TRACE":
    case "INFO":
      return level;
    default:
      return "INFO";
  }
}

function fallbackConsoleLog(message: LogMessage): void {
  const output = {
    level: message.level,
    source: message.source,
    description: normalizeDescription(message.description),
  };
  const payload = JSON.stringify(output);
  if (!payload) {
    process.stderr.write(`${getDescriptionPrefix(message.level)} ${output.source}\n`);
    return;
  }

  const prefix = `[${getDescriptionPrefix(message.level)}]`;
  process.stderr.write(`${prefix} ${output.source} ${payload}\n`);
}

function resolveLoggingThread(): Worker | null {
  if (!loggingThreadSupported || loggingThread) {
    return loggingThread;
  }

  if (typeof Worker !== "function") {
    loggingThreadSupported = false;
    return null;
  }

  try {
    loggingThread = new Worker(LOG_THREAD_URL, {
      name: LOG_THREAD_NAME,
      type: "module",
    });
  } catch {
    loggingThreadSupported = false;
    return null;
  }

  loggingThread.addEventListener("error", () => {
    loggingThreadSupported = false;
    loggingThread = null;
  });

  return loggingThread;
}

function postToThreadOrFallback(message: LogMessage): void {
  const worker = resolveLoggingThread();
  if (!worker) {
    fallbackConsoleLog(message);
    return;
  }

  try {
    worker.postMessage({
      type: "log",
      payload: message,
    } as LoggingThreadMessage);
  } catch {
    loggingThreadSupported = false;
    loggingThread = null;
    fallbackConsoleLog(message);
  }
}

function log(
  level: LogLevel,
  source: string,
  description: LogDescription,
): void {
  postToThreadOrFallback({
    description,
    level,
    source,
  });
}

export type LogSubsystem = {
  error: (description: LogDescription) => void;
  info: (description: LogDescription) => void;
  trace: (description: LogDescription) => void;
  warning: (description: LogDescription) => void;
};

export function createSubsystemLogger(source: string): LogSubsystem {
  return {
    error(description) {
      log("ERROR", source, description);
    },
    info(description) {
      log("INFO", source, description);
    },
    trace(description) {
      log("TRACE", source, description);
    },
    warning(description) {
      log("WARNING", source, description);
    },
  };
}

export function logMessage(
  level: LogLevel,
  source: string,
  description: LogDescription,
): void {
  log(level, source, description);
}
