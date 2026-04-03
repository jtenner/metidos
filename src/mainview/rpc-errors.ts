type RpcErrorDetails = Record<string, string | null>;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: RpcErrorDetails | null,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function isStepUpRequiredError(error: unknown): boolean {
  return error instanceof RpcError && error.code === "step_up_required";
}
