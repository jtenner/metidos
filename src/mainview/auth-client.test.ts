/**
 * @file src/mainview/auth-client.test.ts
 * @description Test file for auth client.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { clearCachedCsrfToken, issueWebSocketTicket } from "./auth-client";

const originalFetch = globalThis.fetch;

describe("auth client", () => {
  beforeEach(() => {
    clearCachedCsrfToken();
  });

  afterEach(() => {
    clearCachedCsrfToken();
    globalThis.fetch = originalFetch;
  });

  it("includes endpoint and HTTP status when an auth endpoint returns non-JSON", async () => {
    const responses = [
      new Response(JSON.stringify({ csrfToken: "csrf-token" }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }),
      new Response("<html><body>Bad Gateway</body></html>", {
        headers: {
          "content-type": "text/html",
        },
        status: 502,
        statusText: "Bad Gateway",
      }),
    ];
    globalThis.fetch = (async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected fetch call");
      }
      return response;
    }) as unknown as typeof fetch;

    await expect(issueWebSocketTicket()).rejects.toThrow(
      "Auth endpoint /auth/ws-ticket returned invalid JSON with status 502 Bad Gateway.",
    );
  });
});
