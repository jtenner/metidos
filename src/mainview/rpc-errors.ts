/**
 * @file src/mainview/rpc-errors.ts
 * @description Module for rpc errors.
 */

type RpcErrorDetails = Record<string, string | null>;

export class RpcError extends Error {
  /**
   * Creates and initializes a new instance.
   * @param message - Message payload.
   * @param code - code argument for constructor.
   * @param details - details argument for constructor.
   */

  constructor(
    message: string,
    readonly code: string,
    readonly details: RpcErrorDetails | null,
  ) {
    super(message);
    this.name = "RpcError";
  }
}
/**
 * Is record.
 * @param value - Input value.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Normalizes rpc error details.
 * @param value - Input value.
 */

export function normalizeRpcErrorDetails(
  value: unknown,
): RpcErrorDetails | null {
  if (!isRecord(value)) {
    return null;
  }

  const next: RpcErrorDetails = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = typeof entry === "string" ? entry : null;
  }
  return next;
}
/**
 * Is step up required error.
 * @param error - Error value to process.
 */

export function isStepUpRequiredError(error: unknown): boolean {
  return error instanceof RpcError && error.code === "step_up_required";
}
/**
 * Is auth required rpc error.
 * @param error - Error value to process.
 */

export function isAuthRequiredRpcError(error: unknown): boolean {
  return (
    error instanceof RpcError &&
    (error.code === "session_required" ||
      error.code === "invalid_websocket_ticket")
  );
}
