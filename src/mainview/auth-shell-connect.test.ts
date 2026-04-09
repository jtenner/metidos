/**
 * @file src/mainview/auth-shell-connect.test.ts
 * @description Test file for auth shell connect.
 */

import { describe, expect, it } from "bun:test";

import type { AuthStatus } from "./auth-client";
import { AuthApiError } from "./auth-client";
import {
  AuthShellTimeoutError,
  connectRpcTransportWithRetry,
  DISCARDED_SESSION_NOTICE,
  INITIAL_RPC_CONNECT_BASE_DELAY_MS,
  INITIAL_RPC_CONNECT_TIMEOUT_MS,
  resolveAuthShellGate,
  shouldRetryInitialRpcConnect,
} from "./auth-shell-connect";
import { RpcError } from "./rpc-errors";

/**
 * Builds auth status.
 * @param overrides - Optional overrides passed to construct auth status in tests.
 */

function buildAuthStatus(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    authenticated: false,
    configured: true,
    devBypass: false,
    lockedUntil: null,
    primaryFactorType: "pin",
    sessionExpiresAt: null,
    ...overrides,
  };
}

describe("auth shell connect retry helpers", () => {
  it("retries transient initial RPC connect failures until a later attempt succeeds", async () => {
    const waits: number[] = [];
    const retries: Array<{
      delayMs: number;
      nextAttemptNumber: number;
      previousAttemptNumber: number;
    }> = [];
    let attempts = 0;

    await connectRpcTransportWithRetry({
      connect: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(`transient failure ${attempts}`);
        }
      },
      onRetry: ({ delayMs, nextAttemptNumber, previousAttemptNumber }) => {
        retries.push({
          delayMs,
          nextAttemptNumber,
          previousAttemptNumber,
        });
      },
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    });

    expect(attempts).toBe(3);
    expect(waits).toEqual([
      INITIAL_RPC_CONNECT_BASE_DELAY_MS,
      INITIAL_RPC_CONNECT_BASE_DELAY_MS * 2,
    ]);
    expect(retries).toEqual([
      {
        delayMs: INITIAL_RPC_CONNECT_BASE_DELAY_MS,
        nextAttemptNumber: 2,
        previousAttemptNumber: 1,
      },
      {
        delayMs: INITIAL_RPC_CONNECT_BASE_DELAY_MS * 2,
        nextAttemptNumber: 3,
        previousAttemptNumber: 2,
      },
    ]);
  });

  it("throws the last transient failure after the bounded retry budget is exhausted", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const failure = new Error("socket open failed");

    await expect(
      connectRpcTransportWithRetry({
        connect: async () => {
          attempts += 1;
          throw failure;
        },
        maxAttempts: 3,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      }),
    ).rejects.toBe(failure);

    expect(attempts).toBe(3);
    expect(waits).toEqual([
      INITIAL_RPC_CONNECT_BASE_DELAY_MS,
      INITIAL_RPC_CONNECT_BASE_DELAY_MS * 2,
    ]);
  });

  it("does not retry auth-required failures", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const failure = new AuthApiError(
      "session_required",
      "Sign in required.",
      401,
      null,
    );

    await expect(
      connectRpcTransportWithRetry({
        connect: async () => {
          attempts += 1;
          throw failure;
        },
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      }),
    ).rejects.toBe(failure);

    expect(attempts).toBe(1);
    expect(waits).toEqual([]);
    expect(shouldRetryInitialRpcConnect(failure)).toBeFalse();
  });

  it("does not retry auth-required websocket failures", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const failure = new RpcError(
      "The websocket ticket is invalid or expired.",
      "invalid_websocket_ticket",
      null,
    );

    await expect(
      connectRpcTransportWithRetry({
        connect: async () => {
          attempts += 1;
          throw failure;
        },
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      }),
    ).rejects.toBe(failure);

    expect(attempts).toBe(1);
    expect(waits).toEqual([]);
    expect(shouldRetryInitialRpcConnect(failure)).toBeFalse();
  });

  it("times out a stalled initial RPC bootstrap, resets the transport, and retries fresh", async () => {
    const retries: number[] = [];
    let connectAttempts = 0;
    let disconnects = 0;

    const result = await resolveAuthShellGate({
      connectRetryBaseDelayMs: 1,
      connectRetryMaxAttempts: 2,
      connectRetryMaxDelayMs: 1,
      connectRetryWait: async () => {},
      connectRpcTransport: async () => {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          return new Promise<void>(() => {});
        }
      },
      connectTimeoutMs: 5,
      disconnectRpcTransport: () => {
        disconnects += 1;
      },
      getAuthStatus: async () =>
        buildAuthStatus({
          authenticated: true,
        }),
      onAuthenticatedConnectRetry: ({ nextAttemptNumber }) => {
        retries.push(nextAttemptNumber);
      },
      prepareSetupEnrollment: async () => {
        throw new Error(
          "setup enrollment should not load for authenticated sessions",
        );
      },
    });

    expect(result).toEqual({
      kind: "authenticated",
      status: buildAuthStatus({
        authenticated: true,
      }),
    });
    expect(connectAttempts).toBe(2);
    expect(disconnects).toBe(1);
    expect(retries).toEqual([2]);
  });

  it("times out stalled auth-status loads instead of waiting forever", async () => {
    try {
      await resolveAuthShellGate({
        connectRpcTransport: async () => {},
        connectTimeoutMs: INITIAL_RPC_CONNECT_TIMEOUT_MS,
        getAuthStatus: async () => new Promise<AuthStatus>(() => {}),
        prepareSetupEnrollment: async () => {
          throw new Error(
            "setup enrollment should not load when auth status stalls",
          );
        },
        statusTimeoutMs: 5,
      });
      throw new Error("expected stalled auth status to time out");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthShellTimeoutError);
      expect((error as Error).message).toBe(
        "Checking authorization timed out. Retry and confirm the local server is responding.",
      );
    }
  });

  it("reuses the authenticated gate retry path when a fresh login reaches RPC bootstrap", async () => {
    const retries: number[] = [];
    let connectAttempts = 0;
    let connectStarted = 0;

    const result = await resolveAuthShellGate({
      connectRpcTransport: async () => {
        connectAttempts += 1;
        if (connectAttempts < 3) {
          throw new Error(`transient connect failure ${connectAttempts}`);
        }
      },
      getAuthStatus: async () =>
        buildAuthStatus({
          authenticated: true,
        }),
      onAuthenticatedConnectRetry: ({ nextAttemptNumber }) => {
        retries.push(nextAttemptNumber);
      },
      onAuthenticatedConnectStart: () => {
        connectStarted += 1;
      },
      prepareSetupEnrollment: async () => {
        throw new Error(
          "setup enrollment should not load for authenticated sessions",
        );
      },
    });

    expect(result).toEqual({
      kind: "authenticated",
      status: buildAuthStatus({
        authenticated: true,
      }),
    });
    expect(connectAttempts).toBe(3);
    expect(connectStarted).toBe(1);
    expect(retries).toEqual([2, 3]);
  });

  it("reuses the authenticated gate retry path when a recovery-code login reaches RPC bootstrap", async () => {
    const retries: number[] = [];
    let connectAttempts = 0;
    let connectStarted = 0;

    const result = await resolveAuthShellGate({
      connectRpcTransport: async () => {
        connectAttempts += 1;
        if (connectAttempts < 2) {
          throw new Error(`transient connect failure ${connectAttempts}`);
        }
      },
      getAuthStatus: async () =>
        buildAuthStatus({
          authenticated: true,
        }),
      onAuthenticatedConnectRetry: ({ nextAttemptNumber }) => {
        retries.push(nextAttemptNumber);
      },
      onAuthenticatedConnectStart: () => {
        connectStarted += 1;
      },
      prepareSetupEnrollment: async () => {
        throw new Error(
          "setup enrollment should not load for authenticated sessions",
        );
      },
    });

    expect(result).toEqual({
      kind: "authenticated",
      status: buildAuthStatus({
        authenticated: true,
      }),
    });
    expect(connectAttempts).toBe(2);
    expect(connectStarted).toBe(1);
    expect(retries).toEqual([2]);
  });

  it("returns setup enrollment when auth is not configured", async () => {
    let connectAttempts = 0;
    let setupLoads = 0;

    const result = await resolveAuthShellGate({
      connectRpcTransport: async () => {
        connectAttempts += 1;
      },
      getAuthStatus: async () =>
        buildAuthStatus({
          configured: false,
          primaryFactorType: null,
        }),
      prepareSetupEnrollment: async () => {
        setupLoads += 1;
        return {
          totpSecret: "secret",
          totpUri: "otpauth://example",
        };
      },
    });

    expect(result).toEqual({
      enrollment: {
        totpSecret: "secret",
        totpUri: "otpauth://example",
      },
      kind: "setup",
      status: buildAuthStatus({
        configured: false,
        primaryFactorType: null,
      }),
    });
    expect(connectAttempts).toBe(0);
    expect(setupLoads).toBe(1);
  });

  it("returns the login gate with a discarded-session notice when authenticated bootstrap loses the session", async () => {
    const statuses = [
      buildAuthStatus({
        authenticated: true,
      }),
      buildAuthStatus(),
    ];
    let connectAttempts = 0;

    const result = await resolveAuthShellGate({
      connectRpcTransport: async () => {
        connectAttempts += 1;
        throw new AuthApiError(
          "session_required",
          "A valid authenticated session is required.",
          401,
          null,
        );
      },
      getAuthStatus: async () => {
        const nextStatus = statuses.shift();
        if (!nextStatus) {
          throw new Error("unexpected extra auth status request");
        }
        return nextStatus;
      },
      prepareSetupEnrollment: async () => {
        throw new Error(
          "setup enrollment should not load after a discarded session",
        );
      },
    });

    expect(result).toEqual({
      kind: "login",
      notice: DISCARDED_SESSION_NOTICE,
      status: buildAuthStatus(),
    });
    expect(connectAttempts).toBe(1);
  });

  it("returns the login gate when auth is configured but no session is active", async () => {
    let connectAttempts = 0;
    let setupLoads = 0;

    const result = await resolveAuthShellGate({
      connectRpcTransport: async () => {
        connectAttempts += 1;
      },
      getAuthStatus: async () => buildAuthStatus(),
      prepareSetupEnrollment: async () => {
        setupLoads += 1;
        return {
          totpSecret: "secret",
          totpUri: "otpauth://example",
        };
      },
    });

    expect(result).toEqual({
      kind: "login",
      status: buildAuthStatus(),
    });
    expect(connectAttempts).toBe(0);
    expect(setupLoads).toBe(0);
  });
});
