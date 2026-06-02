/**
 * @file src/bun/safe-outbound-fetch.test.ts
 * @description Tests for shared outbound fetch timeout helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  SafeOutboundFetchTimeoutError,
  safeOutboundFetchWithTimeout,
} from "./safe-outbound-fetch";

describe("safeOutboundFetchWithTimeout", () => {
  it("resolves successful fetches before the timeout", async () => {
    const response = await safeOutboundFetchWithTimeout({
      fetch: async () => new Response("ok", { status: 201 }),
      timeoutMs: 1_000,
      url: "http://example.test/",
    });

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("ok");
  });

  it("rejects with a typed timeout error and exposes the timeout reason to fetch", async () => {
    let abortReason: unknown = null;

    await expect(
      safeOutboundFetchWithTimeout({
        fetch: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              abortReason = init.signal?.reason;
              reject(new Error("runtime-specific abort rejection"));
            });
          }),
        timeoutMessage: "custom timeout",
        timeoutMs: 1.9,
        url: "http://example.test/hung",
      }),
    ).rejects.toMatchObject({
      message: "custom timeout",
      timeoutMs: 1,
    });

    expect(abortReason).toBeInstanceOf(SafeOutboundFetchTimeoutError);
    expect(abortReason).toMatchObject({
      message: "custom timeout",
      timeoutMs: 1,
    });
  });

  it("preserves caller aborts instead of converting them to timeouts", async () => {
    const controller = new AbortController();
    const abortReason = new Error("caller canceled");
    controller.abort(abortReason);

    await expect(
      safeOutboundFetchWithTimeout({
        fetch: (_url, init) => Promise.reject(init?.signal?.reason),
        init: { signal: controller.signal },
        timeoutMs: 1_000,
        url: "http://example.test/aborted",
      }),
    ).rejects.toBe(abortReason);
  });
});
