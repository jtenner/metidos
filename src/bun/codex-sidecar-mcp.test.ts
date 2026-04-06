/**
 * @file src/bun/codex-sidecar-mcp.test.ts
 * @description Test file for codex sidecar mcp.
 */

import { describe, expect, it, mock } from "bun:test";
import {
  buildRpcSocketConnectionDetails,
  buildRpcSocketCookieHeader,
  buildSessionCookieHeader,
  deriveRpcHttpOrigin,
} from "./codex-sidecar-mcp";

describe("codex sidecar websocket auth handoff", () => {
  it("derives the http origin from the websocket url when needed", () => {
    expect(deriveRpcHttpOrigin("ws://127.0.0.1:7599/rpc")).toBe(
      "http://127.0.0.1:7599",
    );
    expect(deriveRpcHttpOrigin("wss://example.com:443/rpc")).toBe(
      "https://example.com",
    );
  });

  it("requests a fresh websocket ticket and sends the session cookie", async () => {
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            ticket: {
              expiresAt: "2026-04-05T00:01:00.000Z",
            },
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "set-cookie":
                "jolt_ws_ticket=ticket-456; Path=/rpc; HttpOnly; SameSite=Strict; Max-Age=60",
            },
            status: 200,
          },
        ),
    );

    const details = await buildRpcSocketConnectionDetails({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      httpOrigin: "http://127.0.0.1:7599",
      rpcUrl: "ws://127.0.0.1:7599/rpc",
      sessionId: "session-123",
    });

    expect(details).toEqual({
      headers: {
        Cookie: buildRpcSocketCookieHeader("session-123", "ticket-456"),
      },
      url: "ws://127.0.0.1:7599/rpc",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:7599/auth/ws-ticket",
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Cookie: buildSessionCookieHeader("session-123"),
      },
      method: "POST",
    });
  });

  it("skips the websocket ticket flow when no session id is available", async () => {
    const fetchImpl = mock(
      async () =>
        new Response(JSON.stringify({ ok: false }), {
          status: 500,
        }),
    );

    const details = await buildRpcSocketConnectionDetails({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      httpOrigin: "http://127.0.0.1:7599",
      rpcUrl: "ws://127.0.0.1:7599/rpc",
      sessionId: null,
    });

    expect(details).toEqual({
      url: "ws://127.0.0.1:7599/rpc",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
