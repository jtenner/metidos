/**
 * @file src/bun/plugin/websocket.test.ts
 * @description Tests for Plugin System v1 WebSocket client execution.
 */

import { afterEach, describe, expect, it } from "bun:test";

import { PluginPermissionError } from "./context";
import {
  executePluginWebSocketOperation,
  PluginWebSocketError,
  PluginWebSocketRegistry,
} from "./websocket";

const testServers: Array<ReturnType<typeof Bun.serve>> = [];

function createEchoServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    fetch(request, bunServer) {
      if (bunServer.upgrade(request)) {
        return undefined;
      }
      return new Response("upgrade required", { status: 426 });
    },
    port: 0,
    websocket: {
      message(socket, message) {
        socket.send(`echo:${String(message)}`);
      },
      open(socket) {
        socket.send("ready");
      },
    },
  });
  testServers.push(server);
  return server;
}

afterEach(() => {
  for (const server of testServers.splice(0)) {
    server.stop(true);
  }
});

describe("PluginWebSocketRegistry", () => {
  it("requires network:websocket permission", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: true,
        webSocketAllow: ["wss://example.test/**"],
      },
      permissions: [],
    });

    await expect(
      registry.connect({ url: "wss://example.test/events" }),
    ).rejects.toThrow(PluginPermissionError);
  });

  it("enforces the WebSocket allowlist and HTTPS policy", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: true,
        webSocketAllow: ["wss://allowed.example.test/**"],
      },
      permissions: ["network:websocket"],
    });

    await expect(
      registry.connect({ url: "ws://allowed.example.test/events" }),
    ).rejects.toMatchObject({ code: "allowlist_denied" });
    await expect(
      registry.connect({ url: "wss://other.example.test/events" }),
    ).rejects.toMatchObject({ code: "allowlist_denied" });
  });

  it("rejects DNS WebSocket hostnames without unsafe access because dialing cannot pin DNS", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: ["ws://api.example.test/**"],
      },
      permissions: ["network:websocket"],
      resolveHostname: async () => ["203.0.113.30"],
    });

    await expect(
      registry.connect({ url: "ws://api.example.test/socket" }),
    ).rejects.toMatchObject({
      code: "network_websocket_failed",
      message:
        "Plugin WebSocket DNS hostnames require unsafe private-network access until DNS-pinned WebSocket dialing is available.",
    });
  });

  it("rejects DNS WebSocket hostnames even in unsafe private-network mode", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: ["ws://api.example.test/**"],
      },
      permissions: ["network:websocket"],
      resolveHostname: async () => ["127.0.0.1"],
      unsafeAllowPrivateNetwork: true,
    });

    await expect(
      registry.connect({ url: "ws://api.example.test/socket" }),
    ).rejects.toMatchObject({
      code: "network_websocket_failed",
      message:
        "Plugin WebSocket DNS hostnames are denied until DNS-pinned WebSocket dialing is available.",
    });
  });

  it("keeps cloud metadata hosts blocked in unsafe private-network mode", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: ["ws://169.254.169.254/**"],
      },
      permissions: ["network:websocket"],
      unsafeAllowPrivateNetwork: true,
    });

    await expect(
      registry.connect({ url: "ws://169.254.169.254/latest/meta-data" }),
    ).rejects.toMatchObject({
      code: "network_websocket_failed",
      message:
        "Plugin WebSocket URL unsafe private-network mode cannot access cloud metadata hosts.",
    });
  });

  it("rejects private WebSocket targets before connecting", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: ["ws://localhost/**", "ws://api.example.test/**"],
      },
      permissions: ["network:websocket"],
      resolveHostname: async () => ["127.0.0.1"],
    });

    await expect(
      registry.connect({ url: "ws://localhost/socket" }),
    ).rejects.toMatchObject({ code: "network_websocket_failed" });
    await expect(
      registry.connect({ url: "ws://api.example.test/socket" }),
    ).rejects.toMatchObject({ code: "network_websocket_failed" });
  });

  it("connects, sends, receives, reports state, and closes", async () => {
    const server = createEchoServer();
    const origin = `ws://127.0.0.1:${server.port}`;
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: [`${origin}/socket`],
      },
      permissions: ["network:websocket"],
      unsafeAllowPrivateNetwork: true,
    });

    const connected = await registry.connect({ url: `${origin}/socket` });
    expect(connected.id).toBe(1);

    await expect(registry.receive(connected.id)).resolves.toEqual({
      text: "ready",
      type: "message",
    });
    await registry.sendText(connected.id, "hello");
    await expect(registry.receive(connected.id)).resolves.toEqual({
      text: "echo:hello",
      type: "message",
    });
    await expect(registry.state(connected.id)).resolves.toEqual({
      state: "open",
    });
    await expect(registry.close(connected.id)).resolves.toEqual({
      success: true,
    });
  });

  it("dispatches operation payloads through executePluginWebSocketOperation", async () => {
    const server = createEchoServer();
    const origin = `ws://127.0.0.1:${server.port}`;
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: [`${origin}/socket`],
      },
      permissions: ["network:websocket"],
      unsafeAllowPrivateNetwork: true,
    });

    const connected = (await executePluginWebSocketOperation({
      operation: "websocket.connect",
      params: { url: `${origin}/socket` },
      registry,
    })) as { id: number };
    expect(connected.id).toBe(1);
    await expect(
      executePluginWebSocketOperation({
        operation: "websocket.receive",
        params: { id: connected.id },
        registry,
      }),
    ).resolves.toEqual({ text: "ready", type: "message" });
  });

  it("blocks plugin-controlled WebSocket handshake headers", async () => {
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: ["ws://127.0.0.1/**"],
      },
      permissions: ["network:websocket"],
      unsafeAllowPrivateNetwork: true,
    });

    for (const headerName of [
      "Origin",
      "Sec-WebSocket-Key",
      "sec-websocket-protocol",
    ]) {
      await expect(
        registry.connect({
          options: { headers: { [headerName]: "plugin-controlled" } },
          url: "ws://127.0.0.1/socket",
        }),
      ).rejects.toMatchObject({
        code: "blocked_request_header",
        message: `Plugin WebSocket cannot set blocked request header "${headerName}".`,
      });
    }
  });

  it("rejects pending receives and drops connections during shutdown", async () => {
    const server = createEchoServer();
    const origin = `ws://127.0.0.1:${server.port}`;
    const registry = new PluginWebSocketRegistry({
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: [`${origin}/socket`],
      },
      permissions: ["network:websocket"],
      unsafeAllowPrivateNetwork: true,
    });

    const connected = await registry.connect({ url: `${origin}/socket` });
    await expect(registry.receive(connected.id)).resolves.toEqual({
      text: "ready",
      type: "message",
    });

    const pendingReceive = registry.receive(connected.id, {
      timeoutMs: 60_000,
    });
    registry.closeAll();

    await expect(pendingReceive).rejects.toMatchObject({
      code: "network_websocket_failed",
      message: "Plugin WebSocket closed during plugin shutdown.",
    });
    await expect(registry.state(connected.id)).rejects.toMatchObject({
      code: "invalid_connection_id",
    });
  });

  it("bounds message size and connection count", async () => {
    const server = createEchoServer();
    const origin = `ws://127.0.0.1:${server.port}`;
    const registry = new PluginWebSocketRegistry({
      limits: {
        maxConnections: 1,
        maxMessageBytes: 10,
      },
      network: {
        allow: [],
        enforceHttps: false,
        webSocketAllow: [`${origin}/socket`],
      },
      permissions: ["network:websocket"],
      unsafeAllowPrivateNetwork: true,
    });

    const connected = await registry.connect({ url: `${origin}/socket` });
    await expect(registry.connect({ url: `${origin}/socket` })).rejects.toThrow(
      PluginWebSocketError,
    );
    await expect(
      registry.sendText(connected.id, "this is too long"),
    ).rejects.toMatchObject({ code: "message_too_large" });
  });
});
