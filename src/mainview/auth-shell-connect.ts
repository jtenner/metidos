import { AuthApiError, isAuthRequiredError } from "./auth-client";

export const INITIAL_RPC_CONNECT_MAX_ATTEMPTS = 4;
export const INITIAL_RPC_CONNECT_BASE_DELAY_MS = 250;
export const INITIAL_RPC_CONNECT_MAX_DELAY_MS = 1_000;

export type InitialRpcConnectRetryInfo = {
  delayMs: number;
  error: unknown;
  maxAttempts: number;
  nextAttemptNumber: number;
  previousAttemptNumber: number;
};

function defaultRetryWait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export function shouldRetryInitialRpcConnect(error: unknown): boolean {
  return !(error instanceof AuthApiError && isAuthRequiredError(error));
}

export async function connectRpcTransportWithRetry(options: {
  baseDelayMs?: number;
  connect: () => Promise<void>;
  maxAttempts?: number;
  maxDelayMs?: number;
  onRetry?: (info: InitialRpcConnectRetryInfo) => void;
  shouldRetry?: (error: unknown) => boolean;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  const maxAttempts = Math.max(
    1,
    Math.trunc(options.maxAttempts ?? INITIAL_RPC_CONNECT_MAX_ATTEMPTS) ||
      INITIAL_RPC_CONNECT_MAX_ATTEMPTS,
  );
  const maxDelayMs = Math.max(
    0,
    Math.trunc(options.maxDelayMs ?? INITIAL_RPC_CONNECT_MAX_DELAY_MS) ||
      INITIAL_RPC_CONNECT_MAX_DELAY_MS,
  );
  let nextDelayMs = Math.min(
    Math.max(
      0,
      Math.trunc(options.baseDelayMs ?? INITIAL_RPC_CONNECT_BASE_DELAY_MS) ||
        INITIAL_RPC_CONNECT_BASE_DELAY_MS,
    ),
    maxDelayMs,
  );
  const wait = options.wait ?? defaultRetryWait;
  const shouldRetry = options.shouldRetry ?? shouldRetryInitialRpcConnect;

  for (
    let attemptNumber = 1;
    attemptNumber <= maxAttempts;
    attemptNumber += 1
  ) {
    try {
      await options.connect();
      return;
    } catch (error) {
      if (attemptNumber >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = nextDelayMs;
      options.onRetry?.({
        delayMs,
        error,
        maxAttempts,
        nextAttemptNumber: attemptNumber + 1,
        previousAttemptNumber: attemptNumber,
      });
      await wait(delayMs);
      nextDelayMs = Math.min(
        Math.max(delayMs * 2, INITIAL_RPC_CONNECT_BASE_DELAY_MS),
        maxDelayMs,
      );
    }
  }
}
