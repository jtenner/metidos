/**
 * @file src/bun/logging.ts
 * @description Module for threaded IPC logging.
 */

type LoggingThreadMessage =
  | {
      type: "log";
      payload: LogMessage;
    }
  | {
      type: "logBatch";
      payload: LogMessage[];
    };

export const TRACE_LOGGING_ENV = "METIDOS_TRACE_LOGS";

export type LogLevel = "INFO" | "WARNING" | "ERROR" | "TRACE";

export type LogDescription = string | Record<string, unknown>;

export type LogMessage = {
  level: LogLevel;
  description: LogDescription;
  source: string;
};

const LOG_THREAD_NAME = "metidos-logging-thread";
const LOG_THREAD_URL = new URL("./logging-thread.ts", import.meta.url);
const LOG_BATCH_SIZE = 64;
export const LOG_QUEUE_LIMIT = 1024;

let loggingThread: Worker | null = null;
let loggingThreadSupported = true;
let flushScheduled = false;
let droppedLogCount = 0;
const pendingLogMessages: LogMessage[] = [];

export function isTraceLoggingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[TRACE_LOGGING_ENV]?.trim() === "1";
}

export function shouldEmitLogLevel(
  level: LogLevel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return level !== "TRACE" || isTraceLoggingEnabled(env);
}

export function normalizeLogDescription(description: LogDescription): unknown {
  // Normalize before worker postMessage so BigInt and circular objects cannot
  // make logging throw on hot request paths. Trace logs remain opt-in, and the
  // bounded queue drops excess burst traffic before this becomes unbounded work.
  if (typeof description === "string") {
    return description;
  }

  const seen = new WeakSet<object>();
  try {
    return JSON.parse(
      JSON.stringify(description, (_key, value: unknown) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        if (typeof value !== "object" || value === null) {
          return value;
        }
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
        return value;
      }),
    );
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
    description: normalizeLogDescription(message.description),
  };
  const payload = JSON.stringify(output);
  if (!payload) {
    process.stderr.write(
      `${getDescriptionPrefix(message.level)} ${output.source}\n`,
    );
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

function normalizeMessageForThread(message: LogMessage): LogMessage {
  return {
    ...message,
    description: normalizeLogDescription(message.description) as LogDescription,
  };
}

function postBatchToThreadOrFallback(messages: LogMessage[]): void {
  const worker = resolveLoggingThread();
  if (!worker) {
    for (const message of messages) {
      fallbackConsoleLog(message);
    }
    return;
  }

  try {
    worker.postMessage({
      type: "logBatch",
      payload: messages,
    } satisfies LoggingThreadMessage);
  } catch {
    loggingThreadSupported = false;
    loggingThread = null;
    for (const message of messages) {
      fallbackConsoleLog(message);
    }
  }
}

function enqueueDroppedLogDiagnostic(): void {
  if (droppedLogCount <= 0) {
    return;
  }

  const dropped = droppedLogCount;
  droppedLogCount = 0;
  pendingLogMessages.push({
    description: {
      dropped,
      queueLimit: LOG_QUEUE_LIMIT,
      reason: "backend log queue full",
    },
    level: "WARNING",
    source: "logging",
  });
}

function drainPendingLogMessages(
  handleBatch: (messages: LogMessage[]) => void,
): void {
  const messageCount = pendingLogMessages.length;
  for (let index = 0; index < messageCount; index += LOG_BATCH_SIZE) {
    handleBatch(pendingLogMessages.slice(index, index + LOG_BATCH_SIZE));
  }
  pendingLogMessages.length = 0;
}

function flushLogQueue(): void {
  flushScheduled = false;
  enqueueDroppedLogDiagnostic();
  drainPendingLogMessages(postBatchToThreadOrFallback);
}

function flushLogQueueToConsole(): void {
  flushScheduled = false;
  enqueueDroppedLogDiagnostic();
  drainPendingLogMessages((messages) => {
    for (const message of messages) {
      fallbackConsoleLog(message);
    }
  });
}

function scheduleLogFlush(): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  queueMicrotask(flushLogQueue);
}

function postToThreadOrFallback(message: LogMessage): void {
  if (pendingLogMessages.length >= LOG_QUEUE_LIMIT) {
    droppedLogCount += 1;
    scheduleLogFlush();
    return;
  }

  pendingLogMessages.push(normalizeMessageForThread(message));
  scheduleLogFlush();
}

function log(
  level: LogLevel,
  source: string,
  description: LogDescription,
): void {
  if (!shouldEmitLogLevel(level)) {
    return;
  }

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

export function shutdownLoggingThread(): void {
  flushLogQueueToConsole();
  const worker = loggingThread;
  loggingThread = null;
  if (worker && typeof worker.terminate === "function") {
    try {
      worker.terminate();
    } catch {
      // Best-effort cleanup during process shutdown.
    }
  }
}
