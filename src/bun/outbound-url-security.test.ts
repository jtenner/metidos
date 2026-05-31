import { describe, expect, test } from "bun:test";

import {
  assertSafeOutboundHttpUrl,
  createSafeOutboundHttpFetch,
  isBlockedOutboundAddress,
  isBlockedPrivateNetworkMetadataAddress,
  resolveSafeRedirectUrl,
} from "./outbound-url-security";

describe("outbound URL security", () => {
  test("blocks loopback and private literal addresses", async () => {
    const blockedUrls = [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[fe80::1]/",
      "http://[fe8a::1]/",
      "http://[fd00::1]/",
      "http://[64:ff9b::c000:201]/",
      "http://[64:ff9b:1::1]/",
      "http://[2001:db8::1]/",
      "http://[2001:123::1]/",
      "http://0177.0.0.1/",
      "http://0x7f000001/",
      "http://2130706433/",
    ];

    for (const url of blockedUrls) {
      await expect(
        assertSafeOutboundHttpUrl(url, { label: "Test URL" }),
      ).rejects.toThrow(/Test URL/);
    }
  });

  test("blocks hostnames that resolve to private addresses", async () => {
    await expect(
      assertSafeOutboundHttpUrl("https://calendar.example.test/feed.ics", {
        label: "External ICS URL",
        resolveHostname: async () => ["127.0.0.1"],
      }),
    ).rejects.toThrow(/resolved to a blocked address/);
  });

  test("blocks resolver results that are not concrete IP addresses", async () => {
    await expect(
      assertSafeOutboundHttpUrl("https://calendar.example.test/feed.ics", {
        label: "External ICS URL",
        resolveHostname: async () => [""],
      }),
    ).rejects.toThrow(/resolved to a non-IP address/);

    await expect(
      assertSafeOutboundHttpUrl("https://calendar.example.test/feed.ics", {
        label: "External ICS URL",
        resolveHostname: async () => ["example.com"],
      }),
    ).rejects.toThrow(/resolved to a non-IP address/);
  });

  test("allows public literal addresses without DNS resolution", async () => {
    let resolveCalls = 0;
    const url = await assertSafeOutboundHttpUrl("https://203.0.113.10/feed", {
      resolveHostname: async () => {
        resolveCalls += 1;
        return ["127.0.0.1"];
      },
    });

    expect(url.hostname).toBe("203.0.113.10");
    expect(resolveCalls).toBe(0);
  });

  test("allows hostnames that resolve to public 2001:67c IPv6 addresses", async () => {
    const url = await assertSafeOutboundHttpUrl(
      "https://api.telegram.org/bot123456:abcdefghijklmnopqrstuvwxyz/sendMessage",
      {
        label: "Plugin fetch URL",
        resolveHostname: async () => [
          "149.154.166.110",
          "2001:67c:4e8:f004::9",
        ],
      },
    );

    expect(url.hostname).toBe("api.telegram.org");
  });

  test("pins the validated DNS answer for the outbound connection", async () => {
    let calls = 0;
    const guardedFetch = createSafeOutboundHttpFetch({
      label: "External ICS URL",
      resolveHostname: async () => {
        calls += 1;
        return calls === 1 ? ["8.8.8.8"] : ["127.0.0.1"];
      },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      guardedFetch(new URL("http://calendar.example.test/feed.ics"), {
        redirect: "manual",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("validates redirect targets", async () => {
    await expect(
      resolveSafeRedirectUrl(
        new URL("https://example.com/start"),
        "http://127.0.0.1/private",
        { label: "Web fetch URL" },
      ),
    ).rejects.toThrow(/Web fetch URL/);
  });

  test("classifies blocked resolved addresses", () => {
    expect(isBlockedOutboundAddress("127.0.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("192.168.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("::1")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:127.0.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:7f00:1")).toBeTrue();
    expect(isBlockedOutboundAddress("0:0:0:0:0:ffff:a9fe:a9fe")).toBeTrue();
    expect(isBlockedOutboundAddress("fe8a::1")).toBeTrue();
    expect(isBlockedOutboundAddress("64:ff9b::a9fe:a9fe")).toBeTrue();
    expect(isBlockedOutboundAddress("64:ff9b::c000:201")).toBeTrue();
    expect(isBlockedOutboundAddress("64:ff9b:1::1")).toBeTrue();
    expect(isBlockedOutboundAddress("2002:a9fe:a9fe::")).toBeTrue();
    expect(isBlockedOutboundAddress("2001:db8::1")).toBeTrue();
    expect(isBlockedOutboundAddress("2001:67c:4e8:f004::9")).toBeFalse();
    expect(isBlockedOutboundAddress("8.8.8.8")).toBeFalse();
    expect(isBlockedOutboundAddress("2001:4860:4860::8888")).toBeFalse();
    expect(isBlockedOutboundAddress("2001:4860:4860::8888junk")).toBeTrue();
    expect(isBlockedOutboundAddress("")).toBeTrue();
    expect(isBlockedOutboundAddress("example.com")).toBeTrue();
  });

  test("blocks metadata addresses across IPv4 and IPv6 forms", () => {
    expect(
      isBlockedPrivateNetworkMetadataAddress("169.254.169.254"),
    ).toBeTrue();
    expect(
      isBlockedPrivateNetworkMetadataAddress("::ffff:169.254.169.254"),
    ).toBeTrue();
    expect(
      isBlockedPrivateNetworkMetadataAddress("::ffff:a9fe:a9fe"),
    ).toBeTrue();
    expect(isBlockedPrivateNetworkMetadataAddress("fd00:ec2::254")).toBeTrue();
    expect(isBlockedPrivateNetworkMetadataAddress("8.8.8.8")).toBeFalse();
  });

  test("rejects IPv6 zone identifiers before outbound validation", async () => {
    await expect(
      assertSafeOutboundHttpUrl("http://[::1%25lo0]/", { label: "Test URL" }),
    ).rejects.toThrow(/Test URL is invalid/);
  });
});
