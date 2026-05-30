/**
 * @file src/bun/http-forwarded.test.ts
 * @description Test file for forwarded HTTP header helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  isForwardedHeaderPeerTrusted,
  isForwardedHeaderTrustEnabled,
  readTrustedForwardedForPeer,
  resolveTrustedForwardedOrigin,
} from "./http-forwarded";

const ORIGINAL_TRUST_PROXY = process.env.METIDOS_TRUST_PROXY;
const ORIGINAL_TRUSTED_PROXY_PEERS = process.env.METIDOS_TRUSTED_PROXY_PEERS;
const ORIGINAL_PUBLIC_ORIGIN = process.env.METIDOS_PUBLIC_ORIGIN;
const ORIGINAL_ALLOWED_FORWARDED_ORIGINS =
  process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;

afterEach(() => {
  if (typeof ORIGINAL_TRUST_PROXY === "undefined") {
    delete process.env.METIDOS_TRUST_PROXY;
  } else {
    process.env.METIDOS_TRUST_PROXY = ORIGINAL_TRUST_PROXY;
  }
  if (typeof ORIGINAL_TRUSTED_PROXY_PEERS === "undefined") {
    delete process.env.METIDOS_TRUSTED_PROXY_PEERS;
  } else {
    process.env.METIDOS_TRUSTED_PROXY_PEERS = ORIGINAL_TRUSTED_PROXY_PEERS;
  }
  if (typeof ORIGINAL_PUBLIC_ORIGIN === "undefined") {
    delete process.env.METIDOS_PUBLIC_ORIGIN;
  } else {
    process.env.METIDOS_PUBLIC_ORIGIN = ORIGINAL_PUBLIC_ORIGIN;
  }
  if (typeof ORIGINAL_ALLOWED_FORWARDED_ORIGINS === "undefined") {
    delete process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;
  } else {
    process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS =
      ORIGINAL_ALLOWED_FORWARDED_ORIGINS;
  }
});

function requestWithForwardedFor(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) {
    headers.set("x-forwarded-for", value);
  }
  return new Request("http://127.0.0.1/test", {
    headers,
  });
}

describe("forwarded HTTP helpers", () => {
  it("accepts true and 1 for explicit proxy trust", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(isForwardedHeaderTrustEnabled()).toBeTrue();

    process.env.METIDOS_TRUST_PROXY = "1";
    expect(isForwardedHeaderTrustEnabled()).toBeTrue();

    process.env.METIDOS_TRUST_PROXY = "yes";
    expect(isForwardedHeaderTrustEnabled()).toBeFalse();
  });

  it("ignores forwarded peer headers unless proxy trust is enabled", () => {
    delete process.env.METIDOS_TRUST_PROXY;
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor("203.0.113.10"), {
        peerAddress: "127.0.0.1",
      }),
    ).toBeNull();
  });

  it("normalizes trusted forwarded peer IP values", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor("203.0.113.10"), {
        peerAddress: "127.0.0.1",
      }),
    ).toBe("forwarded:203.0.113.10");
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor("203.0.113.10:443"), {
        peerAddress: "::ffff:127.0.0.1",
      }),
    ).toBe("forwarded:203.0.113.10");
    expect(
      readTrustedForwardedForPeer(
        requestWithForwardedFor("[2001:db8::1]:443"),
        {
          peerAddress: "::1",
        },
      ),
    ).toBe("forwarded:2001:db8::1");
  });

  it("uses the first trusted forwarded peer hop", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(
      readTrustedForwardedForPeer(
        requestWithForwardedFor("203.0.113.10, 198.51.100.8"),
        { peerAddress: "127.0.0.1" },
      ),
    ).toBe("forwarded:203.0.113.10");
  });

  it("rejects malformed forwarded peer values", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor("evil"), {
        peerAddress: "127.0.0.1",
      }),
    ).toBeNull();
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor("999.1.1.1"), {
        peerAddress: "127.0.0.1",
      }),
    ).toBeNull();
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor(""), {
        peerAddress: "127.0.0.1",
      }),
    ).toBeNull();
  });

  it("ignores forwarded headers from untrusted immediate peers", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(
      readTrustedForwardedForPeer(requestWithForwardedFor("203.0.113.10"), {
        peerAddress: "203.0.113.200",
      }),
    ).toBeNull();
  });

  it("allows explicit trusted proxy peer addresses and CIDRs", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    process.env.METIDOS_TRUSTED_PROXY_PEERS = "10.0.0.1, 192.168.0.0/16";

    expect(
      isForwardedHeaderPeerTrusted({ peerAddress: "10.0.0.1" }),
    ).toBeTrue();
    expect(
      isForwardedHeaderPeerTrusted({ peerAddress: "192.168.12.34" }),
    ).toBeTrue();
    expect(
      isForwardedHeaderPeerTrusted({ peerAddress: "10.0.0.2" }),
    ).toBeFalse();
  });

  it("rejects forwarded origins when no allowlist is configured", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    delete process.env.METIDOS_PUBLIC_ORIGIN;
    delete process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;

    const request = new Request("http://127.0.0.1/test", {
      headers: {
        "x-forwarded-host": "metidos.example.test",
        "x-forwarded-proto": "https",
      },
    });

    expect(
      resolveTrustedForwardedOrigin(request, { peerAddress: "127.0.0.1" }),
    ).toBeNull();
  });

  it("accepts forwarded origins only when pinned in the allowlist", () => {
    process.env.METIDOS_TRUST_PROXY = "true";
    process.env.METIDOS_PUBLIC_ORIGIN = "https://metidos.example.test";

    const request = new Request("http://127.0.0.1/test", {
      headers: {
        "x-forwarded-host": "metidos.example.test",
        "x-forwarded-proto": "https",
      },
    });

    expect(
      resolveTrustedForwardedOrigin(request, { peerAddress: "127.0.0.1" }),
    ).toBe("https://metidos.example.test");
    expect(
      resolveTrustedForwardedOrigin(
        new Request("http://127.0.0.1/test", {
          headers: {
            "x-forwarded-host": "evil.example.test",
            "x-forwarded-proto": "https",
          },
        }),
        { peerAddress: "127.0.0.1" },
      ),
    ).toBeNull();
  });
});
