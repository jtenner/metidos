/**
 * @file src/bun/rpc-websocket-abuse-control.test.ts
 * @description Tests for RPC websocket pre-parse abuse control.
 */

import { describe, expect, it } from "bun:test";

import { createRpcWebSocketPreParseBudget } from "./rpc-websocket-abuse-control";

describe("createRpcWebSocketPreParseBudget", () => {
  it("accounts for every message before JSON parsing can succeed", () => {
    const consumeBudget = createRpcWebSocketPreParseBudget({
      burstTokens: 6,
      refillTokensPerSecond: 1,
      bytesPerToken: 100,
    });
    const connection = {};

    for (let index = 0; index < 6; index += 1) {
      expect(consumeBudget(connection, 1, 0).allowed).toBe(true);
    }
    expect(consumeBudget(connection, 1, 0).allowed).toBe(false);
  });

  it("charges larger malformed payloads more than tiny cancel frames", () => {
    const consumeBudget = createRpcWebSocketPreParseBudget({
      burstTokens: 6,
      refillTokensPerSecond: 1,
      bytesPerToken: 100,
    });
    const connection = {};

    expect(consumeBudget(connection, 250, 0)).toMatchObject({
      allowed: true,
      remainingTokens: 3,
    });
    expect(consumeBudget(connection, 1, 0).allowed).toBe(true);
    expect(consumeBudget(connection, 1, 0).allowed).toBe(true);
    expect(consumeBudget(connection, 1, 0).allowed).toBe(true);
    expect(consumeBudget(connection, 1, 0).allowed).toBe(false);
  });

  it("refills per connection and keeps separate clients isolated", () => {
    const consumeBudget = createRpcWebSocketPreParseBudget({
      burstTokens: 2,
      refillTokensPerSecond: 1,
      bytesPerToken: 100,
    });
    const firstConnection = {};
    const secondConnection = {};

    expect(consumeBudget(firstConnection, 1, 0).allowed).toBe(true);
    expect(consumeBudget(firstConnection, 1, 0).allowed).toBe(true);
    expect(consumeBudget(firstConnection, 1, 0).allowed).toBe(false);
    expect(consumeBudget(secondConnection, 1, 0).allowed).toBe(true);
    expect(consumeBudget(firstConnection, 1, 1000).allowed).toBe(true);
  });

  it("treats non-finite byte lengths as over-budget instead of producing NaN", () => {
    const consumeBudget = createRpcWebSocketPreParseBudget({
      burstTokens: 6,
      refillTokensPerSecond: 1,
      bytesPerToken: 100,
    });
    const connection = {};

    expect(
      consumeBudget(connection, Number.POSITIVE_INFINITY, 0),
    ).toMatchObject({
      allowed: false,
      remainingTokens: 6,
    });
  });

  it("allows a normal maximum-size image RPC under the default byte budget", () => {
    const consumeBudget = createRpcWebSocketPreParseBudget();
    const connection = {};
    const tenMegabyteImageAsBase64Bytes = Math.ceil((10 * 1024 * 1024 * 4) / 3);

    expect(
      consumeBudget(connection, tenMegabyteImageAsBase64Bytes, 0).allowed,
    ).toBe(true);
  });
});
