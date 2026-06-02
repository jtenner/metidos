/**
 * @file src/bun/server-security.test.ts
 * @description Test file for server security.
 */

import { describe, expect, it } from "bun:test";

import {
  applySecurityHeaders,
  buildConfiguredBrowserOrigins,
  buildContentSecurityPolicy,
  buildLoopbackBrowserOrigins,
  buildMainServerBrowserOrigins,
  buildRuntimeConfigElement,
  isRuntimeStatsSecretMatch,
  isWebSocketOriginAllowed,
  normalizeRuntimeStatsProvidedSecret,
  parseAllowedBrowserOrigins,
  RUNTIME_CONFIG_ELEMENT_ID,
} from "./server-security";

describe("server security helpers", () => {
  it("normalizes runtime stats header secrets before comparison", () => {
    expect(normalizeRuntimeStatsProvidedSecret(" secret \t")).toBe("secret");
    expect(normalizeRuntimeStatsProvidedSecret(null)).toBeNull();
  });

  it("compares runtime stats secrets without accepting malformed candidates", () => {
    expect(isRuntimeStatsSecretMatch("secret", "secret")).toBeTrue();
    expect(isRuntimeStatsSecretMatch("secret", "secret ")).toBeTrue();
    expect(isRuntimeStatsSecretMatch("secret ", "secret")).toBeFalse();
    expect(isRuntimeStatsSecretMatch("secret", "secreu")).toBeFalse();
    expect(isRuntimeStatsSecretMatch("secret", "sec")).toBeFalse();
    expect(isRuntimeStatsSecretMatch("", "secret")).toBeFalse();
  });

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

  it("builds main-server browser origins around the active fallback port", () => {
    const origins = buildMainServerBrowserOrigins({
      activeServerPort: 49152,
      configuredOrigins: ["https://public.example", "http://localhost:49152"],
      httpProxyPort: 80,
      httpsProxyPort: 443,
    });

    expect(origins).toContain("http://127.0.0.1:49152");
    expect(origins).toContain("https://localhost:49152");
    expect(origins).toContain("http://localhost");
    expect(origins).toContain("https://localhost");
    expect(origins).toContain("https://public.example");
    expect(origins).not.toContain("http://127.0.0.1:7599");
  });

  it("uses the same main-server origin allowlist for required browser websocket checks", () => {
    const origins = buildMainServerBrowserOrigins({
      activeServerPort: 49152,
      configuredOrigins: ["https://public.example"],
      httpProxyPort: 80,
      httpsProxyPort: 443,
    });

    expect(
      isWebSocketOriginAllowed("http://localhost:49152", origins, {
        preNormalizedAllowedOrigins: true,
        requireOrigin: true,
      }),
    ).toBeTrue();
    expect(
      isWebSocketOriginAllowed("http://localhost:7599", origins, {
        preNormalizedAllowedOrigins: true,
        requireOrigin: true,
      }),
    ).toBeFalse();
    expect(
      isWebSocketOriginAllowed(null, origins, {
        preNormalizedAllowedOrigins: true,
        requireOrigin: true,
      }),
    ).toBeFalse();
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

  it("merges the public origin into configured websocket origins", () => {
    expect(
      buildConfiguredBrowserOrigins({
        allowedOrigins: "https://other-host.example https://notwindows",
        publicOrigin: "https://notwindows",
      }),
    ).toEqual(["https://other-host.example", "https://notwindows"]);
  });

  it("allows missing Origin for non-browser local clients", () => {
    expect(
      isWebSocketOriginAllowed(null, buildLoopbackBrowserOrigins(7599)),
    ).toBeTrue();
  });

  it("rejects missing Origin when required for public browser deployments", () => {
    expect(
      isWebSocketOriginAllowed(null, buildLoopbackBrowserOrigins(7599), {
        requireOrigin: true,
      }),
    ).toBeFalse();
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

  it("can compare against pre-normalized allowlists", () => {
    expect(
      isWebSocketOriginAllowed(
        "https://localhost",
        new Set(["https://localhost"]),
        {
          preNormalizedAllowedOrigins: true,
        },
      ),
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

  it("builds a content security policy with explicit websocket connect sources", () => {
    expect(
      buildContentSecurityPolicy([
        "/health",
        "wss://127.0.0.1:7600/rpc",
        "ws://127.0.0.1:7600/rpc",
      ]),
    ).toContain("connect-src 'self' wss://127.0.0.1:7600 ws://127.0.0.1:7600");
  });

  it("rejects malformed CSP style nonces before interpolation", () => {
    expect(() =>
      buildContentSecurityPolicy([], {
        styleNonce: "safe_nonce-123",
      }),
    ).not.toThrow();
    expect(() =>
      buildContentSecurityPolicy([], {
        styleNonce: "bad' nonce",
      }),
    ).toThrow("Content Security Policy nonce contains unsupported characters.");
  });

  it("applies browser security headers to outgoing responses", () => {
    const headers = applySecurityHeaders(new Headers(), {
      connectUrls: ["wss://127.0.0.1:7600/rpc"],
      styleNonce: "nonce-value",
    });

    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get("content-security-policy")).toContain(
      "style-src 'self' 'nonce-nonce-value'",
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
    const maliciousConfig = buildRuntimeConfigElement({
      devServer: false,
      healthUrl: "</script><script>alert(1)</script>",
    });
    expect(maliciousConfig).not.toContain("</script><script>alert(1)</script>");
    expect(maliciousConfig).toContain("\\/script");
  });
});
