import { describe, expect, it } from "bun:test";

import { AuthApiError } from "./auth-client";
import {
  connectRpcTransportWithRetry,
  INITIAL_RPC_CONNECT_BASE_DELAY_MS,
  shouldRetryInitialRpcConnect,
} from "./auth-shell-connect";

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
});
