import { describe, expect, it } from "bun:test";

import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  buildLivenessPayload,
  buildLoopbackBrowserOrigins,
  buildRuntimeConfigElement,
  isWebSocketOriginAllowed,
  parseAllowedBrowserOrigins,
  RUNTIME_CONFIG_ELEMENT_ID,
} from "./server-security";

describe("server security helpers", () => {
  it("builds loopback origins for localhost and 127.0.0.1", () => {
    expect(buildLoopbackBrowserOrigins(7599)).toEqual([
      "http://127.0.0.1:7599",
      "https://127.0.0.1:7599",
      "http://localhost:7599",
      "https://localhost:7599",
    ]);
  });

  it("canonicalizes default browser ports when building loopback origins", () => {
    expect(
      buildLoopbackBrowserOrigins(443, {
        protocols: ["https:"],
      }),
    ).toEqual(["https://127.0.0.1", "https://localhost"]);
    expect(
      buildLoopbackBrowserOrigins(80, {
        protocols: ["http:"],
      }),
    ).toEqual(["http://127.0.0.1", "http://localhost"]);
  });

  it("parses and normalizes configured origins", () => {
    expect(
      parseAllowedBrowserOrigins(
        "http://localhost:7599,\nhttps://127.0.0.1:7600 http://localhost:7599",
      ),
    ).toEqual(["http://localhost:7599", "https://127.0.0.1:7600"]);
  });

  it("rejects malformed configured origins", () => {
    expect(() => parseAllowedBrowserOrigins("ws://localhost:7599")).toThrow(
      'Invalid browser origin "ws://localhost:7599".',
    );
  });

  it("allows missing Origin for non-browser local clients", () => {
    expect(
      isWebSocketOriginAllowed(null, buildLoopbackBrowserOrigins(7599)),
    ).toBeTrue();
  });

  it("accepts exact allowlisted browser origins", () => {
    expect(
      isWebSocketOriginAllowed(
        "https://localhost:7599",
        buildLoopbackBrowserOrigins(7599),
      ),
    ).toBeTrue();
  });

  it("normalizes allowlisted browser origins before comparison", () => {
    expect(
      isWebSocketOriginAllowed("https://localhost", ["https://localhost:443"]),
    ).toBeTrue();
  });

  it("rejects non-allowlisted browser origins", () => {
    expect(
      isWebSocketOriginAllowed(
        "https://evil.example",
        buildLoopbackBrowserOrigins(7599),
      ),
    ).toBeFalse();
  });

  it("returns a minimal liveness payload", () => {
    expect(buildLivenessPayload(false)).toEqual({
      ok: false,
    });
  });

  it("builds a content security policy with explicit websocket connect sources", () => {
    expect(
      buildContentSecurityPolicy([
        "/health",
        "wss://127.0.0.1:7600/rpc",
        "ws://127.0.0.1:7600/rpc",
      ]),
    ).toContain("connect-src 'self' wss://127.0.0.1:7600 ws://127.0.0.1:7600");
  });

  it("applies browser security headers to outgoing responses", () => {
    const headers = applySecurityHeaders(new Headers(), {
      connectUrls: ["wss://127.0.0.1:7600/rpc"],
    });

    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get("permissions-policy")).toBe(
      "camera=(), geolocation=(), microphone=()",
    );
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("serializes the runtime config into an inert JSON script tag", () => {
    expect(
      buildRuntimeConfigElement({
        devServer: true,
        healthUrl: "/health",
        rpcWebSocketUrl: "wss://127.0.0.1:7600/rpc",
      }),
    ).toContain(`id="${RUNTIME_CONFIG_ELEMENT_ID}"`);
    expect(
      buildRuntimeConfigElement({
        devServer: false,
        healthUrl: "</script><script>alert(1)</script>",
      }),
    ).not.toContain("</script><script>alert(1)</script>");
  });
});
