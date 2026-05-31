import type { ProjectProcedures, RpcClientLogRequest } from "../bun/rpc-schema";

const SECRET_KEY_PATTERN =
  /(authorization|cookie|credential|password|secret|token|totp|recovery)/i;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;

let procedures: Pick<ProjectProcedures, "logClientEvent"> | null = null;

export function configureClientLogger(
  nextProcedures: Pick<ProjectProcedures, "logClientEvent">,
): void {
  procedures = nextProcedures;
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: truncateString(value.name),
      message: truncateString(value.message),
      stack:
        typeof value.stack === "string"
          ? truncateString(value.stack, 2000)
          : null,
    };
  }
  if (depth <= 0) {
    return "[Truncated]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth - 1));
  }
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(
      0,
      MAX_OBJECT_KEYS,
    )) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? "[Redacted]"
        : sanitizeValue(child, depth - 1);
    }
    return output;
  }
  return String(value);
}

export function normalizeClientLogPayload(
  payload: RpcClientLogRequest,
): RpcClientLogRequest {
  return {
    severity: payload.severity,
    message: truncateString(payload.message, 2000),
    ...(payload.context ? { context: truncateString(payload.context) } : {}),
    ...(payload.route ? { route: truncateString(payload.route) } : {}),
    ...(payload.timestamp
      ? { timestamp: truncateString(payload.timestamp) }
      : {}),
    ...(payload.details
      ? {
          details: sanitizeValue(payload.details, MAX_DEPTH) as Record<
            string,
            unknown
          >,
        }
      : {}),
  };
}

export function logClientEvent(payload: RpcClientLogRequest): void {
  const configuredProcedures = procedures;
  if (!configuredProcedures) {
    return;
  }
  void configuredProcedures
    .logClientEvent(normalizeClientLogPayload(payload), {
      priority: "background",
      timeoutMs: 10_000,
    })
    .catch(() => {
      // Avoid recursive logging if the production-safe logging path itself fails.
    });
}

export function logClientError(
  message: string,
  error: unknown,
  options?: Pick<RpcClientLogRequest, "context" | "route">,
): void {
  logClientEvent({
    severity: "error",
    message,
    details: { error: sanitizeValue(error, MAX_DEPTH) } as Record<
      string,
      unknown
    >,
    route:
      options?.route ??
      (typeof window !== "undefined" ? window.location.pathname : null),
    context: options?.context ?? null,
    timestamp: new Date().toISOString(),
  });
}
