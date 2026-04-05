/**
 * @file src/bun/static-server-routing.test.ts
 * @description Test file for static server routing.
 */

import { describe, expect, it } from "bun:test";

import { buildBrowserFacingRpcWebSocketUrl } from "./static-server-routing";

describe("static server rpc routing", () => {
  it("keeps the page host when building a direct rpc websocket url", () => {
    expect(
      buildBrowserFacingRpcWebSocketUrl({
        browserFacingHost: "localhost:7599",
        forwardedProto: "http",
        rpcPort: 7600,
      }),
    ).toBe("ws://localhost:7600/rpc");
    expect(
      buildBrowserFacingRpcWebSocketUrl({
        browserFacingHost: "127.0.0.1:7599",
        forwardedProto: "http",
        rpcPort: 7600,
      }),
    ).toBe("ws://127.0.0.1:7600/rpc");
  });

  it("switches to wss when the browser-facing request is secure", () => {
    expect(
      buildBrowserFacingRpcWebSocketUrl({
        browserFacingHost: "example.com",
        forwardedProto: "https",
        rpcPort: 7600,
      }),
    ).toBe("wss://example.com:7600/rpc");
  });

  it("returns null when no browser host is available", () => {
    expect(
      buildBrowserFacingRpcWebSocketUrl({
        browserFacingHost: null,
        forwardedProto: "http",
        rpcPort: 7600,
      }),
    ).toBeNull();
  });
});
