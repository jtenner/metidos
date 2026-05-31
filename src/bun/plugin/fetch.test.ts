/**
 * @file src/bun/plugin/fetch.test.ts
 * @description Tests for permissioned Plugin System v1 network fetch execution.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  executePluginFetch,
  MAX_PLUGIN_FETCH_TEXT_RESPONSE_BODY_BYTES,
  PluginFetchError,
  PluginPermissionError,
} from "./fetch";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const localTestFetch = (url: URL, init?: RequestInit) => fetch(url, init);

function startServer(
  handler: (request: Request) => Response | Promise<Response>,
) {
  const server = Bun.serve({ fetch: handler, port: 0 });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("executePluginFetch", () => {
  it("requires network:fetch permission", async () => {
    await expect(
      executePluginFetch({
        context: {
          network: {
            allow: ["https://api.example.test/**"],
            enforceHttps: true,
          },
          permissions: [],
        },
        url: "https://api.example.test/v1/status",
      }),
    ).rejects.toThrow(PluginPermissionError);
  });

  it("blocks HTTP unless the policy and pattern explicitly allow it", async () => {
    const server = startServer(() => new Response("ok"));
    const url = `http://localhost:${server.port}/status`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: true },
          permissions: ["network:fetch"],
        },
        url,
      }),
    ).rejects.toThrow(PluginFetchError);

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: localTestFetch,
        unsafeAllowPrivateNetwork: true,
        url,
      }),
    ).resolves.toMatchObject({ body: "ok", status: 200, url });
  });

  it("allows all-domain HTTPS fetch patterns only with unsafe permission", async () => {
    const url = "https://example.com/feed.xml";

    await expect(
      executePluginFetch({
        context: {
          network: { allow: ["https://**/**"], enforceHttps: true },
          permissions: ["network:fetch"],
        },
        url,
      }),
    ).rejects.toMatchObject({
      code: "invalid_network_policy",
      message:
        "All-domain network allow patterns require the plugin to declare the unsafe permission.",
    });

    await expect(
      executePluginFetch({
        context: {
          network: { allow: ["https://**/**"], enforceHttps: true },
          permissions: ["network:fetch", "unsafe"],
        },
        fetch: async () =>
          new Response("ok", { headers: { "content-type": "text/plain" } }),
        url,
      }),
    ).resolves.toMatchObject({ body: "ok", status: 200 });
  });

  it("rejects credentialed request URLs before network access", async () => {
    let requestReachedServer = false;
    const server = startServer(() => {
      requestReachedServer = true;
      return new Response("unexpected");
    });
    const origin = `http://localhost:${server.port}`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [`${origin}/private`], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        url: `http://user:secret@localhost:${server.port}/private`,
      }),
    ).rejects.toMatchObject({
      code: "allowlist_denied",
      message: "Plugin fetch URLs must not include credentials.",
    });
    expect(requestReachedServer).toBe(false);
  });

  it("follows allowed redirects and rejects redirect escapes", async () => {
    const allowedServer = startServer((request) => {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname === "/start") {
        return new Response(null, {
          headers: { location: "/allowed/final" },
          status: 302,
        });
      }
      if (requestUrl.pathname === "/escape") {
        return new Response(null, {
          headers: { location: "https://outside.example.test/final" },
          status: 302,
        });
      }
      return new Response("done");
    });
    const origin = `http://localhost:${allowedServer.port}`;
    const context = {
      network: {
        allow: [`${origin}/allowed/**`, `${origin}/start`, `${origin}/escape`],
        enforceHttps: false,
      },
      permissions: ["network:fetch"],
    };

    await expect(
      executePluginFetch({
        context,
        fetch: localTestFetch,
        unsafeAllowPrivateNetwork: true,
        url: `${origin}/start`,
      }),
    ).resolves.toMatchObject({ body: "done", redirected: true });

    await expect(
      executePluginFetch({
        context,
        fetch: localTestFetch,
        unsafeAllowPrivateNetwork: true,
        url: `${origin}/escape`,
      }),
    ).rejects.toMatchObject({
      code: "allowlist_denied",
      message: "Plugin fetch URL is not covered by network.allow.",
    });
  });

  it("reports redirect limit failures distinctly", async () => {
    const server = startServer(
      () => new Response(null, { headers: { location: "/loop" }, status: 302 }),
    );
    const url = `http://localhost:${server.port}/loop`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: localTestFetch,
        unsafeAllowPrivateNetwork: true,
        url,
      }),
    ).rejects.toMatchObject({ code: "redirect_limit_exceeded" });
  });

  it("drops sensitive headers on redirect hops", async () => {
    const seenHeaders: string[] = [];
    const server = startServer((request) => {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname === "/start") {
        return new Response(null, {
          headers: { location: "/final" },
          status: 302,
        });
      }
      seenHeaders.push(request.headers.get("authorization") ?? "");
      return new Response("done");
    });
    const origin = `http://localhost:${server.port}`;
    const context = {
      network: {
        allow: [`${origin}/**`],
        enforceHttps: false,
      },
      permissions: ["network:fetch"],
    };

    await expect(
      executePluginFetch({
        context,
        fetch: localTestFetch,
        options: {
          headers: { Authorization: "Bearer secret-token" },
        },
        unsafeAllowPrivateNetwork: true,
        url: `${origin}/start`,
      }),
    ).resolves.toMatchObject({ body: "done", redirected: true });
    expect(seenHeaders).toEqual([""]);
  });

  it("blocks dangerous request headers before sending the request", async () => {
    let requestReachedServer = false;
    const server = startServer(() => {
      requestReachedServer = true;
      return new Response("unexpected");
    });
    const url = `http://localhost:${server.port}/status`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        options: { headers: { Cookie: "secret", "x-plugin-test": "yes" } },
        url,
      }),
    ).rejects.toMatchObject({ code: "blocked_request_header" });
    expect(requestReachedServer).toBe(false);
  });

  it("sends byte request bodies", async () => {
    let received = "";
    const server = startServer(async (request) => {
      received = Array.from(new Uint8Array(await request.arrayBuffer())).join(
        ",",
      );
      return new Response("ok");
    });
    const url = `http://localhost:${server.port}/upload`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: localTestFetch,
        options: { body: new Uint8Array([0, 1, 2, 255]), method: "PUT" },
        unsafeAllowPrivateNetwork: true,
        url,
      }),
    ).resolves.toMatchObject({ body: "ok", status: 200 });
    expect(received).toBe("0,1,2,255");
  });

  it("reports timeout failures distinctly without leaking query secrets", async () => {
    const server = startServer(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("late")), 50);
        }),
    );
    const url = `http://localhost:${server.port}/slow`;
    const secretUrl = `${url}?token=secret#fragment`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: localTestFetch,
        timeoutMs: 5,
        unsafeAllowPrivateNetwork: true,
        url: secretUrl,
      }),
    ).rejects.toMatchObject({
      code: "timeout",
      message: `Plugin fetch timed out after 5ms for ${url}.`,
    });
  });

  it("rejects private hosts before network access", async () => {
    await expect(
      executePluginFetch({
        context: {
          network: {
            allow: ["http://localhost/**", "http://10.0.0.5/**"],
            enforceHttps: false,
          },
          permissions: ["network:fetch"],
        },
        url: "http://localhost/status",
      }),
    ).rejects.toMatchObject({ code: "network_fetch_failed" });

    await expect(
      executePluginFetch({
        context: {
          network: { allow: ["http://10.0.0.5/**"], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        url: "http://10.0.0.5/status",
      }),
    ).rejects.toMatchObject({ code: "network_fetch_failed" });
  });

  it("keeps cloud metadata hosts blocked in unsafe private-network mode", async () => {
    await expect(
      executePluginFetch({
        context: {
          network: {
            allow: ["http://169.254.169.254/**"],
            enforceHttps: false,
          },
          permissions: ["network:fetch"],
          unsafeAllowPrivateNetwork: true,
        },
        fetch: async () => new Response("unexpected"),
        unsafeAllowPrivateNetwork: true,
        url: "http://169.254.169.254/latest/meta-data",
      }),
    ).rejects.toMatchObject({
      code: "network_fetch_failed",
      message:
        "Plugin fetch URL unsafe private-network mode cannot access cloud metadata hosts.",
    });
  });

  it("keeps DNS-resolved metadata addresses blocked in unsafe private-network mode", async () => {
    let fetched = false;
    await expect(
      executePluginFetch({
        context: {
          network: {
            allow: ["http://metadata-proxy.example.test/**"],
            enforceHttps: false,
          },
          permissions: ["network:fetch"],
          unsafeAllowPrivateNetwork: true,
        },
        fetch: async () => {
          fetched = true;
          return new Response("unexpected");
        },
        resolveHostname: async () => ["169.254.169.254"],
        unsafeAllowPrivateNetwork: true,
        url: "http://metadata-proxy.example.test/latest/meta-data",
      }),
    ).rejects.toMatchObject({
      code: "network_fetch_failed",
      message: "Plugin fetch URL host resolved to a cloud metadata address.",
    });
    expect(fetched).toBe(false);
  });

  it("rejects DNS resolutions to private hosts", async () => {
    await expect(
      executePluginFetch({
        context: {
          network: {
            allow: ["https://api.example.test/**"],
            enforceHttps: true,
          },
          permissions: ["network:fetch"],
        },
        resolveHostname: async () => ["127.0.0.1"],
        url: "https://api.example.test/status",
      }),
    ).rejects.toMatchObject({ code: "network_fetch_failed" });
  });

  it("allows public hosts, including HTTP when explicitly allowed", async () => {
    await expect(
      executePluginFetch({
        context: {
          network: { allow: ["http://93.184.216.34/**"], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: async (url) =>
          new Response("ok", { headers: { "x-url": url.toString() } }),
        url: "http://93.184.216.34/status",
      }),
    ).resolves.toMatchObject({ bodyBase64: "b2s=", status: 200 });
  });

  it("returns textual JSON responses as decoded text for fast plugin json parsing", async () => {
    const response = await executePluginFetch({
      context: {
        network: { allow: ["http://93.184.216.34/**"], enforceHttps: false },
        permissions: ["network:fetch"],
      },
      fetch: async () =>
        Response.json({ models: 371 }, { headers: { "x-test": "json" } }),
      url: "http://93.184.216.34/models",
    });

    expect(response).toEqual(
      expect.objectContaining({ body: '{"models":371}', status: 200 }),
    );
    expect(response.bodyBase64).toBeUndefined();
  });

  it("returns large textual responses as base64 to avoid oversized strings", async () => {
    const largeJson = `{"payload":"${"x".repeat(MAX_PLUGIN_FETCH_TEXT_RESPONSE_BODY_BYTES)}"}`;

    const response = await executePluginFetch({
      context: {
        network: { allow: ["http://93.184.216.34/**"], enforceHttps: false },
        permissions: ["network:fetch"],
      },
      fetch: async () =>
        new Response(largeJson, {
          headers: { "content-type": "application/json" },
        }),
      url: "http://93.184.216.34/large.json",
    });

    expect(response.body).toBeUndefined();
    expect(response.bodyBase64).toBe(Buffer.from(largeJson).toString("base64"));
  });

  it("returns binary response bytes as a base64 payload without eager text duplication", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);

    await expect(
      executePluginFetch({
        context: {
          network: { allow: ["http://93.184.216.34/**"], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: async () => new Response(bytes),
        url: "http://93.184.216.34/binary",
      }),
    ).resolves.toMatchObject({ bodyBase64: "AAEC/w==", status: 200 });
  });

  it("fails safely when response bodies exceed the configured cap", async () => {
    const server = startServer(() => new Response("12345"));
    const url = `http://localhost:${server.port}/large`;

    await expect(
      executePluginFetch({
        context: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
        },
        fetch: localTestFetch,
        maxResponseBodyBytes: 4,
        unsafeAllowPrivateNetwork: true,
        url,
      }),
    ).rejects.toMatchObject({ code: "response_body_too_large" });
  });
});
