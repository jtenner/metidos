/**
 * @file src/bun/logging-thread.ts
 * @description Worker thread for logging output.
 */

type LogLevel = "INFO" | "WARNING" | "ERROR" | "TRACE";

type LogDescription = string | Record<string, unknown>;

type LogMessage = {
  level: LogLevel;
  description: LogDescription;
  source: string;
};

type LoggingThreadMessage =
  | {
      type: "log";
      payload: LogMessage;
    }
  | {
      type: "logBatch";
      payload: LogMessage[];
    };

type LoggingWorkerScope = {
  onmessage: ((event: MessageEvent<LoggingThreadMessage>) => void) | null;
};

const workerScope = globalThis as unknown as LoggingWorkerScope;

function formatDescription(description: LogDescription): string {
  if (typeof description === "string") {
    return description;
  }

  try {
    return JSON.stringify(description);
  } catch {
    return String(description);
  }
}

function formatLogEntry(message: LogMessage): {
  level: LogLevel;
  source: string;
  description: string;
} {
  return {
    description: formatDescription(message.description),
    level: message.level,
    source: message.source,
  };
}

function handleLogMessage(message: LogMessage): void {
  const payload = formatLogEntry(message);
  const serialized =
    JSON.stringify(payload) ??
    `{"level":"${payload.level}","source":"${payload.source}","description":"${payload.description}"}`;
  process.stderr.write(`${serialized}\n`);
}

function isLogMessage(payload: unknown): payload is LogMessage {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as LogMessage).source === "string" &&
    typeof (payload as LogMessage).level === "string"
  );
}

workerScope.onmessage = (event) => {
  const next = event.data;
  if (!next) {
    return;
  }

  if (next.type === "logBatch") {
    if (!Array.isArray(next.payload)) {
      return;
    }
    for (const message of next.payload) {
      if (isLogMessage(message)) {
        handleLogMessage(message);
      }
    }
    return;
  }

  if (next.type !== "log" || !isLogMessage(next.payload)) {
    return;
  }

  handleLogMessage(next.payload);
};
