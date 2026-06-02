import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";

import {
  assertPrivateNetworkOutboundHttpUrl,
  assertSafeOutboundHttpUrl,
  createPrivateNetworkOutboundHttpFetch,
  createSafeOutboundHttpFetch,
  isBlockedOutboundAddress,
  isBlockedPrivateNetworkMetadataAddress,
  pinResolvedOutboundLookupAddress,
  resolveSafeRedirectUrl,
} from "./outbound-url-security";

describe("outbound URL security", () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

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

  test("blocks hostnames when any mixed A or AAAA answer is blocked", async () => {
    await expect(
      assertSafeOutboundHttpUrl("https://mixed-address.example.test/feed.ics", {
        label: "External ICS URL",
        resolveHostname: async () => ["8.8.8.8", "fd00::10"],
      }),
    ).rejects.toThrow(/resolved to a blocked address/);

    await expect(
      assertSafeOutboundHttpUrl("https://mixed-address.example.test/feed.ics", {
        label: "External ICS URL",
        resolveHostname: async () => ["2001:4860:4860::8888", "10.0.0.10"],
      }),
    ).rejects.toThrow(/resolved to a blocked address/);
  });

  test("collapses resolver failures into a generic policy error", async () => {
    await expect(
      assertSafeOutboundHttpUrl("https://calendar.example.test/feed.ics", {
        label: "External ICS URL",
        resolveHostname: async () => {
          throw new Error("SERVFAIL from internal resolver 10.0.0.53");
        },
      }),
    ).rejects.toThrow(/^External ICS URL host could not be resolved\.$/);
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

  test("returns pinned DNS answers using Node lookup callback shapes", () => {
    const lookup = pinResolvedOutboundLookupAddress("2001:4860:4860::8888");
    let singleAddress: string | undefined;
    let singleFamily: number | undefined;
    let allAddresses: Array<{ address: string; family: number }> | undefined;

    lookup("ignored.example.test", {}, (error, address, family) => {
      expect(error).toBeNull();
      singleAddress = address;
      singleFamily = family;
    });
    lookup(
      "ignored.example.test",
      { all: true },
      (
        error: Error | null,
        addresses: Array<{ address: string; family: number }>,
      ) => {
        expect(error).toBeNull();
        allAddresses = addresses;
      },
    );

    expect(singleAddress).toBe("2001:4860:4860::8888");
    expect(singleFamily).toBe(6);
    expect(allAddresses).toEqual([
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
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

  test("materializes Node responses as Web streams", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("streamed ");
      response.end("body");
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected local HTTP server to listen on a TCP port.");
    }

    const guardedFetch = createPrivateNetworkOutboundHttpFetch({
      label: "Plugin fetch URL",
    });
    const response = await guardedFetch(
      new URL(`http://127.0.0.1:${address.port}/stream`),
      { redirect: "manual" },
    );

    expect(response.body).toBeInstanceOf(ReadableStream);
    await expect(response.text()).resolves.toBe("streamed body");
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

  test("validates scheme-relative redirect targets", async () => {
    await expect(
      resolveSafeRedirectUrl(
        new URL("https://origin.example.test/start"),
        "//127.0.0.1/private",
        { label: "Web fetch URL" },
      ),
    ).rejects.toThrow(/Web fetch URL/);

    await expect(
      resolveSafeRedirectUrl(
        new URL("https://origin.example.test/start"),
        "//public.example.test/final",
        {
          label: "Web fetch URL",
          resolveHostname: async (hostname) => {
            expect(hostname).toBe("public.example.test");
            return ["8.8.8.8"];
          },
        },
      ),
    ).resolves.toMatchObject({
      hostname: "public.example.test",
      pathname: "/final",
      protocol: "https:",
    });
  });

  test("revalidates each redirect hop", async () => {
    const resolvedHostnames: string[] = [];
    const resolveHostname = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return hostname === "second.example.test" ? ["127.0.0.1"] : ["8.8.8.8"];
    };

    const firstHop = await resolveSafeRedirectUrl(
      new URL("https://origin.example.test/start"),
      "https://first.example.test/next",
      { label: "Web fetch URL", resolveHostname },
    );

    await expect(
      resolveSafeRedirectUrl(firstHop, "//second.example.test/final", {
        label: "Web fetch URL",
        resolveHostname,
      }),
    ).rejects.toThrow(/resolved to a blocked address/);

    expect(resolvedHostnames).toEqual([
      "first.example.test",
      "second.example.test",
    ]);
  });

  test("classifies blocked resolved addresses", () => {
    expect(isBlockedOutboundAddress("127.0.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("192.168.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("::1")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:127.0.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:7f00:1")).toBeTrue();
    expect(isBlockedOutboundAddress("0:0:0:0:0:ffff:a9fe:a9fe")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:8.8.8.8")).toBeFalse();
    expect(isBlockedOutboundAddress("::8.8.8.8")).toBeFalse();
    expect(isBlockedOutboundAddress("0:0:0:0:0:0:0808:0808")).toBeFalse();
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

  test("blocks wildcard and reserved IPv4 ranges", () => {
    const blockedAddresses = [
      ["0.0.0.0", "wildcard this host"],
      ["0.1.2.3", "this network"],
      ["10.20.30.40", "private-use network"],
      ["100.64.0.1", "carrier-grade NAT range start"],
      ["100.127.255.254", "carrier-grade NAT range end"],
      ["127.255.255.255", "loopback range"],
      ["169.254.10.20", "link-local range"],
      ["172.16.0.1", "private 172.16/12 range start"],
      ["172.31.255.254", "private 172.16/12 range end"],
      ["192.168.255.254", "private 192.168/16 range"],
      ["198.18.0.1", "benchmark range start"],
      ["198.19.255.254", "benchmark range end"],
      ["224.0.0.1", "multicast and higher reserved space"],
      ["240.0.0.1", "reserved future-use space"],
      ["255.255.255.255", "limited broadcast address"],
    ] as const;

    for (const [address, label] of blockedAddresses) {
      expect(isBlockedOutboundAddress(address), label).toBeTrue();
    }

    expect(isBlockedOutboundAddress("100.128.0.1")).toBeFalse();
    expect(isBlockedOutboundAddress("172.32.0.1")).toBeFalse();
    expect(isBlockedOutboundAddress("198.20.0.1")).toBeFalse();
    expect(isBlockedOutboundAddress("223.255.255.254")).toBeFalse();
  });

  test("fails closed for malformed IPv4-mapped IPv6 forms", () => {
    expect(isBlockedOutboundAddress("::ffff:127.0.0.1")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:127.0.0.999")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:127.0.0.1junk")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:127.0.0")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:127.0.0.-1")).toBeTrue();
    expect(isBlockedOutboundAddress("::ffff:0127.0.0.1")).toBeTrue();
  });

  test("blocks metadata addresses across IPv4 and IPv6 forms", () => {
    const blockedMetadataAddresses = [
      "100.100.100.200",
      "169.254.169.254",
      "169.254.170.2",
      "::ffff:169.254.169.254",
      "::ffff:169.254.170.2",
      "::ffff:100.100.100.200",
      "::ffff:a9fe:a9fe",
      "::ffff:a9fe:aa02",
      "::ffff:6464:64c8",
      "fd00:ec2::254",
    ];

    for (const address of blockedMetadataAddresses) {
      expect(
        isBlockedPrivateNetworkMetadataAddress(address),
        address,
      ).toBeTrue();
    }

    expect(isBlockedPrivateNetworkMetadataAddress("8.8.8.8")).toBeFalse();
    expect(isBlockedPrivateNetworkMetadataAddress("10.0.0.1")).toBeFalse();
    expect(isBlockedPrivateNetworkMetadataAddress("fd00::1")).toBeFalse();
  });

  test("unsafe private-network mode is required for localhost and RFC1918 addresses", async () => {
    await expect(
      assertSafeOutboundHttpUrl("http://localhost:3000/status", {
        label: "Plugin fetch URL",
      }),
    ).rejects.toThrow(/host is not allowed/);
    await expect(
      assertSafeOutboundHttpUrl("http://10.0.0.10/status", {
        label: "Plugin fetch URL",
      }),
    ).rejects.toThrow(/host is not allowed/);

    await expect(
      assertPrivateNetworkOutboundHttpUrl("http://localhost:3000/status", {
        label: "Plugin fetch URL",
      }),
    ).resolves.toMatchObject({ hostname: "localhost" });
    await expect(
      assertPrivateNetworkOutboundHttpUrl("http://10.0.0.10/status", {
        label: "Plugin fetch URL",
      }),
    ).resolves.toMatchObject({ hostname: "10.0.0.10" });
    await expect(
      assertPrivateNetworkOutboundHttpUrl("http://[fd00::10]/status", {
        label: "Plugin fetch URL",
      }),
    ).resolves.toMatchObject({ hostname: "[fd00::10]" });
  });

  test("blocks known metadata hosts and addresses in unsafe private-network mode", async () => {
    for (const hostname of ["metadata", "metadata.google.internal"]) {
      await expect(
        assertPrivateNetworkOutboundHttpUrl(
          `http://${hostname}/computeMetadata/v1/`,
          {
            label: "Plugin fetch URL",
            resolveHostname: async () => ["8.8.8.8"],
          },
        ),
      ).rejects.toThrow(/cloud metadata hosts/);
    }

    await expect(
      assertPrivateNetworkOutboundHttpUrl(
        "http://169.254.169.254/latest/meta-data",
        {
          label: "Plugin fetch URL",
        },
      ),
    ).rejects.toThrow(/cloud metadata hosts/);

    await expect(
      assertPrivateNetworkOutboundHttpUrl(
        "http://[fd00:ec2::254]/latest/meta-data",
        {
          label: "Plugin fetch URL",
        },
      ),
    ).rejects.toThrow(/cloud metadata hosts/);

    await expect(
      assertPrivateNetworkOutboundHttpUrl("https://internal.example.test/api", {
        label: "Plugin fetch URL",
        resolveHostname: async () => ["10.0.0.10", "fd00::10"],
      }),
    ).resolves.toMatchObject({ hostname: "internal.example.test" });
  });

  test("rejects IPv6 zone identifiers before outbound validation", async () => {
    await expect(
      assertSafeOutboundHttpUrl("http://[::1%25lo0]/", { label: "Test URL" }),
    ).rejects.toThrow(/Test URL is invalid/);
  });
});
