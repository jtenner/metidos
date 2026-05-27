/**
 * @file src/mainview/auth-shell-connect.ts
 * @description Module for auth shell connect.
 */

import type { AuthStatus } from "./auth-client";
import { AuthApiError, isAuthRequiredError } from "./auth-client";
import { isAuthRequiredRpcError } from "./rpc-errors";

export const INITIAL_RPC_CONNECT_MAX_ATTEMPTS = 4;
export const INITIAL_RPC_CONNECT_BASE_DELAY_MS = 250;
export const INITIAL_RPC_CONNECT_MAX_DELAY_MS = 1_000;
export const AUTH_SHELL_STATUS_TIMEOUT_MS = 5_000;
export const INITIAL_RPC_CONNECT_TIMEOUT_MS = 5_000;

const AUTH_STATUS_TIMEOUT_MESSAGE =
  "Checking authorization timed out. Retry and confirm the local server is responding.";
const INITIAL_RPC_CONNECT_TIMEOUT_MESSAGE =
  "Opening the authenticated workspace timed out. Retry and confirm the local RPC transport is responding.";

export type AuthShellGateResolution =
  | {
      kind: "authenticated";
      status: AuthStatus;
    }
  | {
      kind: "setup";
      notice?: string;
      status: AuthStatus;
    }
  | {
      kind: "login";
      notice?: string;
      status: AuthStatus;
    };

export const DISCARDED_SESSION_NOTICE =
  "The previous session was discarded. Sign in again to continue.";

export type InitialRpcConnectRetryInfo = {
  delayMs: number;
  error: unknown;
  maxAttempts: number;
  nextAttemptNumber: number;
  previousAttemptNumber: number;
};

export class AuthShellTimeoutError extends Error {
  /**
   * Construct the timeout error with a caller-facing message.
   * @param message - Timeout message shown to the auth-shell caller.
   */

  constructor(message: string) {
    super(message);
    this.name = "AuthShellTimeoutError";
  }
}

type ResolveAuthShellGateOptions = {
  connectRpcTransport: () => Promise<void>;
  disconnectRpcTransport?: () => void;
  connectRetryBaseDelayMs?: number;
  connectRetryMaxAttempts?: number;
  connectRetryMaxDelayMs?: number;
  connectRetryWait?: (delayMs: number) => Promise<void>;
  connectTimeoutMs?: number;
  getAuthStatus: () => Promise<AuthStatus>;
  onAuthenticatedConnectRetry?: (info: InitialRpcConnectRetryInfo) => void;
  onAuthenticatedConnectStart?: () => void;
  statusTimeoutMs?: number;
};
/**
 * Sleep for the requested number of milliseconds.
 * @param delayMs - Milliseconds to wait.
 */

function defaultRetryWait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}
/**
 * Should retry initial rpc connect.
 * @param error - Error value to process.
 */

export function shouldRetryInitialRpcConnect(error: unknown): boolean {
  return !(
    (error instanceof AuthApiError && isAuthRequiredError(error)) ||
    isAuthRequiredRpcError(error)
  );
}
/**
 * Wrap an async operation with a hard timeout and reject on expiry.
 * @param options - Timeout configuration and operation.
 */

function withTimeout<T>(options: {
  message: string;
  operation: Promise<T>;
  timeoutMs: number;
}): Promise<T> {
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs) || 1);

  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new AuthShellTimeoutError(options.message));
    }, timeoutMs);

    void options.operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
/**
 * Connects rpc transport with retry.
 * @param options - Configuration options used by this operation.
 */

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

/**
 * Resolve the auth gate into either setup, login, or the authenticated app,
 * while reusing the same bounded transport-retry path for every authenticated
 * bootstrap.
 */
export async function resolveAuthShellGate(
  options: ResolveAuthShellGateOptions,
): Promise<AuthShellGateResolution> {
  const statusTimeoutMs =
    options.statusTimeoutMs ?? AUTH_SHELL_STATUS_TIMEOUT_MS;
  const connectTimeoutMs =
    options.connectTimeoutMs ?? INITIAL_RPC_CONNECT_TIMEOUT_MS;
  const getTimedAuthStatus = () =>
    withTimeout({
      message: AUTH_STATUS_TIMEOUT_MESSAGE,
      operation: options.getAuthStatus(),
      timeoutMs: statusTimeoutMs,
    });
  const connectAuthenticatedTransport = async () => {
    try {
      await withTimeout({
        message: INITIAL_RPC_CONNECT_TIMEOUT_MESSAGE,
        operation: options.connectRpcTransport(),
        timeoutMs: connectTimeoutMs,
      });
    } catch (error) {
      options.disconnectRpcTransport?.();
      throw error;
    }
  };

  const status = await getTimedAuthStatus();

  if (status.authenticated) {
    try {
      options.onAuthenticatedConnectStart?.();
      await connectRpcTransportWithRetry({
        connect: connectAuthenticatedTransport,
        ...(typeof options.connectRetryBaseDelayMs === "number"
          ? {
              baseDelayMs: options.connectRetryBaseDelayMs,
            }
          : {}),
        ...(typeof options.connectRetryMaxAttempts === "number"
          ? {
              maxAttempts: options.connectRetryMaxAttempts,
            }
          : {}),
        ...(typeof options.connectRetryMaxDelayMs === "number"
          ? {
              maxDelayMs: options.connectRetryMaxDelayMs,
            }
          : {}),
        ...(options.onAuthenticatedConnectRetry
          ? {
              onRetry: options.onAuthenticatedConnectRetry,
            }
          : {}),
        ...(options.connectRetryWait
          ? {
              wait: options.connectRetryWait,
            }
          : {}),
      });
      return {
        kind: "authenticated",
        status,
      };
    } catch (error) {
      if (!shouldRetryInitialRpcConnect(error)) {
        const refreshedStatus = await getTimedAuthStatus();
        if (!refreshedStatus.authenticated) {
          if (!refreshedStatus.configured) {
            return {
              kind: "setup",
              notice: DISCARDED_SESSION_NOTICE,
              status: refreshedStatus,
            };
          }

          return {
            kind: "login",
            notice: DISCARDED_SESSION_NOTICE,
            status: refreshedStatus,
          };
        }
      }
      throw error;
    }
  }

  if (!status.configured) {
    return {
      kind: "setup",
      status,
    };
  }

  return {
    kind: "login",
    status,
  };
}
