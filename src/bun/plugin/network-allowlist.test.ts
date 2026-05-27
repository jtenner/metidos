/**
 * @file src/bun/plugin/network-allowlist.test.ts
 * @description Tests for Plugin System v1 network allowlist URL pattern compilation and matching.
 */

import { describe, expect, it } from "bun:test";

import {
  assertPluginNetworkUrlAllowed,
  compilePluginNetworkAllowlist,
  matchPluginNetworkAllowlist,
  PluginNetworkAllowlistError,
} from "./network-allowlist";

describe("plugin network allowlist", () => {
  it("defaults omitted protocols to HTTPS and normalizes protocol and host", () => {
    const compiled = compilePluginNetworkAllowlist({
      patterns: ["API.EXAMPLE.test/v1/**"],
    });

    expect(compiled.issues).toEqual([]);
    expect(compiled.patterns).toEqual([
      {
        allDomains: false,
        host: "api.example.test",
        pathname: "/v1/**",
        protocol: "https:",
        source: "API.EXAMPLE.test/v1/**",
      },
    ]);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/v1/users",
      ).allowed,
    ).toBe(true);
  });

  it("matches exact URLs while ignoring query strings and fragments", () => {
    const compiled = compilePluginNetworkAllowlist({
      patterns: ["https://api.example.test/v1/items"],
    });

    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://API.EXAMPLE.test/v1/items?cursor=next#section",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/v1/items/extra",
      ),
    ).toMatchObject({
      allowed: false,
      code: "network_url_not_allowed",
    });
  });

  it("keeps pathname matching case-sensitive", () => {
    const compiled = compilePluginNetworkAllowlist({
      patterns: ["https://api.example.test/V1/**"],
    });

    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/V1/users",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/v1/users",
      ),
    ).toMatchObject({
      allowed: false,
      code: "network_url_not_allowed",
    });
  });

  it("supports globstar path allowlist patterns", () => {
    const compiled = compilePluginNetworkAllowlist({
      patterns: ["https://api.example.test/v1/**/summary"],
    });

    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/v1/summary",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/v1/users/active/summary",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://api.example.test/v1/users/active/details",
      ),
    ).toMatchObject({
      allowed: false,
      code: "network_url_not_allowed",
    });
  });

  it("rejects credentialed manifest patterns and request URLs", () => {
    const compiled = compilePluginNetworkAllowlist({
      patterns: ["user:secret@example.test/**", "https://api.example.test/**"],
    });

    expect(compiled.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "credentialed_network_allow_pattern" }),
      ]),
    );
    expect(() =>
      assertPluginNetworkUrlAllowed(
        compiled.patterns,
        "https://user:secret@api.example.test/v1",
      ),
    ).toThrow(PluginNetworkAllowlistError);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://user:secret@api.example.test/v1",
      ),
    ).toMatchObject({
      allowed: false,
      code: "credentialed_network_url",
    });
  });

  it("defaults WebSocket allowlists to WSS and validates secure policy", () => {
    const compiled = compilePluginNetworkAllowlist({
      kind: "websocket",
      patterns: ["stream.example.test/v1/**"],
    });

    expect(compiled.issues).toEqual([]);
    expect(compiled.patterns).toEqual([
      {
        allDomains: false,
        host: "stream.example.test",
        pathname: "/v1/**",
        protocol: "wss:",
        source: "stream.example.test/v1/**",
      },
    ]);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "wss://stream.example.test/v1/events",
      ).allowed,
    ).toBe(true);
    expect(
      compilePluginNetworkAllowlist({
        kind: "websocket",
        patterns: ["ws://localhost:3000/**"],
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "network_https_required" }),
      ]),
    );
    expect(
      compilePluginNetworkAllowlist({
        enforceHttps: false,
        kind: "websocket",
        patterns: ["ws://localhost:3000/**"],
      }).issues,
    ).toEqual([]);
  });

  it("allows all-domain host patterns only with the unsafe all-domain flag", () => {
    expect(
      compilePluginNetworkAllowlist({ patterns: ["https://**/**"] }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe_network_all_domain_required",
        }),
      ]),
    );

    const compiled = compilePluginNetworkAllowlist({
      allowUnsafeAllDomains: true,
      patterns: ["https://**/**"],
    });
    expect(compiled.issues).toEqual([]);
    expect(compiled.patterns).toEqual([
      {
        allDomains: true,
        host: "**",
        pathname: "/**",
        protocol: "https:",
        source: "https://**/**",
      },
    ]);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://first.example.test/feed.xml",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://second.example.test/nested/feed.xml",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "http://second.example.test/feed.xml",
      ),
    ).toMatchObject({ allowed: false, code: "network_url_not_allowed" });
  });

  it("keeps explicit ports on unsafe all-domain host patterns", () => {
    const compiled = compilePluginNetworkAllowlist({
      allowUnsafeAllDomains: true,
      patterns: ["https://**:8443/**"],
    });
    expect(compiled.issues).toEqual([]);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://feeds.example.test:8443/rss.xml",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://feeds.example.test/rss.xml",
      ),
    ).toMatchObject({ allowed: false, code: "network_url_not_allowed" });
  });

  it("matches explicit default ports on unsafe all-domain host patterns", () => {
    const compiled = compilePluginNetworkAllowlist({
      allowUnsafeAllDomains: true,
      enforceHttps: false,
      patterns: ["https://**:443/**", "http://**:80/**"],
    });
    expect(compiled.issues).toEqual([]);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "https://feeds.example.test/rss.xml",
      ).allowed,
    ).toBe(true);
    expect(
      matchPluginNetworkAllowlist(
        compiled.patterns,
        "http://feeds.example.test/rss.xml",
      ).allowed,
    ).toBe(true);
  });

  it("validates HTTPS policy unless explicitly relaxed", () => {
    expect(
      compilePluginNetworkAllowlist({ patterns: ["http://localhost:11434/**"] })
        .issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "network_https_required" }),
      ]),
    );

    const relaxed = compilePluginNetworkAllowlist({
      enforceHttps: false,
      patterns: ["http://localhost:11434/**"],
    });
    expect(relaxed.issues).toEqual([]);
    expect(
      matchPluginNetworkAllowlist(
        relaxed.patterns,
        "http://localhost:11434/api/tags",
      ).allowed,
    ).toBe(true);
  });
});
