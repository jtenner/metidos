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

type LoggingThreadMessage = {
  type: "log";
  payload: LogMessage;
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
  switch (message.level) {
    case "ERROR":
      console.error(payload);
      return;
    case "WARNING":
      console.warn(payload);
      return;
    default:
      console.log(payload);
      return;
  }
}

workerScope.onmessage = (event) => {
  const next = event.data;
  if (!next || next.type !== "log") {
    return;
  }

  if (
    typeof next.payload !== "object" ||
    next.payload === null ||
    typeof next.payload.source !== "string" ||
    typeof next.payload.level !== "string"
  ) {
    return;
  }

  handleLogMessage(next.payload);
};
